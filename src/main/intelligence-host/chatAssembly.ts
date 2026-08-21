/**
 * WP-11 · The host side of the context assembler, bound to the chat surface.
 *
 * ADR-19's anchor actor is the Docked Panel chat. This module is the only new
 * file in `src/main/` for that wiring: it builds the AssembleRequest from what
 * `ChatService` has, hands the core its host ports, emits the manifest as a
 * ledger event, and returns two rendered strings plus the turn's TaskId.
 *
 * Everything a chat turn needs to know about the intelligence layer lives
 * here, so `ChatService` gains three call sites and no logic — the same ruling
 * WP-04 made about inlining logic into a locked handler.
 *
 * NON-FATAL BY CONSTRUCTION. Every path returns `null` rather than throwing:
 * an intelligence-layer fault must never break a chat turn. `null` means "the
 * assembler contributed nothing", and the caller's behaviour is then
 * byte-identical to the pre-WP-11 build (the additive-parity pin).
 */
import {
  assemble,
  taskId as mintTaskId,
  AssembleRequest,
  ContextBundle,
  EntityRef,
  ProcedureOutcome,
  ProcedureRequest,
  SemanticHit,
  TaskFrame,
} from '../../intelligence';
import type { BundleManifest, Runbook } from '../../intelligence';
import { CITATION_CONVENTION_VERSION } from '../../intelligence/citation/convention';
import { supplyFromBundle } from '../../intelligence/citation/resolve';
import type { CitationSupply } from '../../intelligence/citation/resolve';
import { getIntelligenceCore } from './coreRegistry';
import { procedureRequestForTurn } from './procedureArming';
import type { ProcedureScope } from './procedureScope';
import {
  armProcedureRun,
  foldProcedureCursor,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from './procedureCursor';
import type { ProcedureCursorState, ProcedureRun } from './procedureCursor';
import { recordAbortIncidents } from './incidentProducer';
import { forgetProcedureStream, notifyProcedureState } from './procedureStream';
import { environmentEntityId, siteEntityId } from './provisionalEntity';
import { buildTaskFrame, describeEnvironmentsFor } from './taskFrame';
import { wrapUntrusted } from '../mcp/pii';
import { resolveSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';

/** ADR-19 refinement: the anchor surface is the Docked Panel specifically. */
const CHAT_SURFACE = 'chat.docked-panel';

/** The manifest's topic + payload schema (architecture doc §4.2, §6.4). */
export const CONTEXT_ASSEMBLED_TOPIC = 'task.context.assembled';
export const CONTEXT_ASSEMBLED_SCHEMA = 'context.assembled/1';

/**
 * WP-48b · THE ARMING'S OWN SCOPE, ON THE RECORD — the producer's registered debt.
 *
 * WP-48 bound the designer's `{total}` slot ("size of the derived target set")
 * to the manifest's `scope.runnable`, and then measured that **0 of 36 manifests
 * on the owner's real ledger carry a `scope` key at all**. The reader was
 * complete and nothing filled it, so `targetSet` read `null` on every row and
 * both waiting classes withheld their sentences. This is the writer.
 *
 * **The comment WP-48 left here was wrong, and correcting it is half the fix.**
 * `sessionRegistry.armedTargetSetOf` says "`chatAssembly` spreads the honoured
 * arming's `scope` onto the manifest payload (WP-37's carrier)". It never did:
 * the scope is spread onto `notifyProcedureState`, which is an IPC STREAM to the
 * renderer and not the ledger. Measured, not inferred — no event of any topic on
 * that ledger carries a `runnable` key.
 *
 * **AND `[]` IS THE OTHER HALF, WHICH IS THE HALF THAT LIGHTS THE SCREEN.** Every
 * run on the real fleet was armed by a model request or a predicate, and neither
 * carries a selection. It would be easy to read that as "no scope to record" and
 * write nothing — which is what leaves `targetSet` null and the sentences
 * withheld. It is the wrong reading. **An arming that selected nothing KNOWS it
 * selected nothing**, and that is a fact, not an absence:
 *
 *   `null`  — nothing on record says anything about a target set (UNKNOWN)
 *   `0`     — the arming resolved its target set and it was empty (KNOWN)
 *
 * WP-48's own rule, applied in the direction it had not yet been applied in.
 * Recording the empty set is what makes the designer's class 1 fire — *"An update
 * run has waited 60 hours and changed nothing / It never received a target list,
 * so it cannot start"* — on the two real runs that are exactly that, and it is
 * the whole of "a fact the armer knows reaches the record".
 *
 * **NOTHING IS DERIVED FROM THE TURN.** The turn's own resolved site is NOT the
 * arming's target set, and binding it here would rebuild WP-48's name collision
 * one field over: `places` is the set with an OUTCOME, this is the set a
 * SELECTION chose, and the turn's subject is neither. A model request that named
 * a capability while a site happened to be open in the panel selected nothing,
 * and the record says so.
 */
export interface ManifestScope {
  /** The site ids the arming selected. Empty when the arming selected nothing. */
  runnable: string[];
  /**
   * How the set was resolved, so a reader never has to infer it from a length.
   * `selection` is WP-37's comparator carrier; `no-selection` is a predicate or
   * a model request, which arm from words and select no targets.
   */
  from: 'selection' | 'no-selection';
}

/**
 * The scope this turn's manifest records. One derivation, both cases.
 *
 * Exported so the acceptance exhibit (`scripts/wp50-refold-exhibit.ts`) folds the
 * real ledger through the SHIPPED function rather than through a copy of its
 * reasoning — the exhibit proves this code, or it proves nothing.
 */
export function manifestScopeFor(armed: ProcedureScope | undefined): ManifestScope {
  if (!armed) return { runnable: [], from: 'no-selection' };
  return { runnable: armed.runnable.map((cell) => cell.siteId), from: 'selection' };
}

/**
 * WP-51 item 3 · THE ARMING'S CAUSE, ON THE MANIFEST — the third producer debt.
 *
 * WP-48b put the arming's SCOPE on the record; this puts what the arming was
 * ANSWERING there, and the two are deliberately parallel in shape and opposite
 * in one rule:
 *
 *   `scope`  — an arming that selected nothing records the EMPTY SET, because
 *              "a predicate armed this and nobody chose targets" is a fact.
 *   `cause`  — an arming that answers nothing records NOTHING AT ALL, because
 *              there is no empty-set fact to state. A containment run that
 *              answers no particular incident is not answering; `answers: []`
 *              would assert that it was.
 *
 * A reader must never have to tell those two apart by reading a length, which
 * is the whole reason `ManifestScope.from` exists — and here the distinction is
 * carried by the key's presence instead, because there is no second provenance
 * to name.
 */
export interface ManifestCause {
  /** Ledger event ids of the incidents this arming answers. Never empty. */
  answers: string[];
}

/**
 * The cause this turn's manifest records, or nothing.
 *
 * Format-gated upstream, at `recordArmingRequest` — the queue is where a
 * caller's value first meets this system, and gating at both ends would put the
 * rule in two places.
 */
export function manifestCauseFor(answers: readonly string[] | undefined): ManifestCause | undefined {
  return answers && answers.length > 0 ? { answers: [...answers] } : undefined;
}

const SEMANTIC_LIMIT = 5;

export interface ChatAssemblyRequest {
  services: NexusServices;
  sessionId: string;
  userMessage: string;
  siteId?: string;
  /**
   * True when this turn (re)builds the system prompt — the full policy set
   * rides there, so the per-turn carrier re-asserts by hash alone (ADR-20).
   */
  buildingSystemPrompt: boolean;
  /**
   * WP-20c. The grants this actor holds and the capability armed for this turn.
   *
   * **WP-20b owns everything that decides those two things** — the
   * `capabilityGrants` setting, `armFor()`, and the mid-turn injection for a
   * model-requested procedure. This packet owns only what happens once one of
   * them says a capability is armed. Absent (every caller today) ⇒ no procedure
   * section, no index, and a turn block byte-identical to the pre-WP-20 build.
   */
  procedure?: ProcedureRequest;
}

export interface ChatAssemblyResult {
  /** ULID TaskId, threaded as `correlation` on every event this turn produces. */
  taskId: string;
  /** For the system prompt. Null when there is no policy set to assert. */
  ambientBlock: string | null;
  /** Per-turn carrier. Null when the assembler has nothing to say this turn. */
  turnBlock: string | null;
  /**
   * Scoped tool grants for `adaptToolsForChat`.
   *
   * ALWAYS `undefined` in v0, and the mapping is load-bearing: the assembler
   * returns `tools: []`, and an empty array must NEVER reach the tool adapter
   * as a filter. `[]` means deny-all in the one existing scoping surface in
   * this codebase (`agent.tools`, buildAgentContext.ts) — passing it through
   * would silently strip every tool from the chat model.
   */
  grants: string[] | undefined;
  /**
   * WP-20c: what the procedure plane did this turn — delivered, refused, or
   * `null` for "nothing armed". The turn block already carries the prose; this
   * is the structured half, for the §7 render shapes and for WP-20d's cursor.
   */
  procedure: ProcedureOutcome | null;
  /**
   * WP-34 · what this turn made citable (ADR-24 P1's universe, the half the
   * platform knows at assembly time): the ledger event ids that rode, and the
   * carrier lines that rendered.
   *
   * `toolCalls` is EMPTY here and that is not an oversight — tool calls happen
   * after assembly, so the trace is the caller's to add (`numberToolCalls`).
   * Publishing an empty list rather than omitting the field keeps the shape
   * honest: "no tool call is citable YET" is a true statement about the moment
   * a carrier is built, where an absent field would read as "this turn has no
   * citation supply at all".
   *
   * Derived by `supplyFromBundle` — the SAME function the eval sheet and the
   * M5 render resolve through. One derivation, or the judge and the user are
   * looking at two different universes (P5).
   */
  citationSupply: CitationSupply;
  /**
   * WP-43 · the manifest's own `citation` field, handed across verbatim.
   *
   * The supply above says what this turn made CITABLE; this says whether the
   * turn was under the convention at all, and it is the second half the render
   * needs — `conventionState` reads this and nothing else. Publishing it beside
   * the supply rather than making the renderer re-derive it is the P5 discipline
   * again: the manifest is the record of what governed the reply, and a surface
   * inferring that from the presence of markers would be a second opinion about
   * a fact the platform already wrote down.
   *
   * `null` carries through with its ratified meaning — "no convention rode this
   * turn" — and is a different fact from the field being ABSENT, which means the
   * caller predates the convention entirely. This field is never absent on a
   * successful assembly, because `BundleManifest.citation` is not optional; a
   * live turn is therefore always `in-effect` or `did-not-ride`, never the
   * legacy card. That is deliberate and pinned.
   */
  citationManifest: BundleManifest['citation'];
}

/**
 * Which policy version each session has already been shown.
 *
 * Host state, not assembler state: the assembler is stateless by ADR-10, so
 * "what does this actor already carry" has to be remembered on this side. A
 * process restart empties the map, which is the correct failure direction —
 * the next turn re-asserts the full set rather than assuming it is present.
 */
const sessionPolicyHash = new Map<string, string>();

/**
 * WP-20c: the same memory, for procedure (ADR-20 extended, §3's cadence).
 *
 * Host state for the same ADR-10 reason as the policy map above. Two rules make
 * it correct rather than merely present:
 *
 *  - It records the hash of the DOCUMENT that rode, not the capability, so a
 *    second capability arming in the same session re-delivers in full (its hash
 *    differs), and an edited runbook re-delivers in full (same).
 *  - It is CLEARED whenever a turn does not deliver — a disarm, a refusal, a
 *    turn with nothing armed. The next arming turn then re-asserts the whole
 *    document rather than assuming the actor still carries a procedure it was
 *    told to stop following.
 */
const sessionProcedureHash = new Map<string, string>();

/**
 * WP-34 · the same memory again, for the citation convention (ADR-24 + ADR-20).
 *
 * POLICY-SHAPED, not procedure-shaped, and the difference is the whole reason
 * this is a third map rather than a reuse of the second. A procedure is armed
 * and disarmed, so its memory is CLEARED the moment a turn stops delivering one
 * — an actor must not carry checkpoints for a document it was told to stop
 * following. The citation convention is standing: once an actor has been taught
 * it, it has been taught it, and a quiet turn is not a retraction. So this map
 * is only ever written, never cleared by a turn's outcome — only by the session
 * ending.
 */
const sessionCitationHash = new Map<string, string>();

/** Drop a session's remembered assertions (chat clear / session delete). */
export function forgetChatAssemblySession(sessionId: string): void {
  sessionPolicyHash.delete(sessionId);
  sessionProcedureHash.delete(sessionId);
  sessionCitationHash.delete(sessionId);
  // WP-20d: and the checkpoint run, which is the same kind of "what has this
  // actor already done" state, held for the same ADR-10 reason.
  forgetProcedureRun(sessionId);
  // WP-26: and the stream's memory of what it has already announced, so a
  // re-armed session announces its declaration again rather than diffing
  // against a run that no longer exists.
  forgetProcedureStream(sessionId);
}

export async function assembleForChatTurn(
  req: ChatAssemblyRequest
): Promise<ChatAssemblyResult | null> {
  try {
    const core = getIntelligenceCore();
    if (!core) return null; // core optional by contract — degrade silently

    const taskId = mintTaskId();
    const resolved = resolveTargets(req);
    const targets = resolved.targets;

    // WP-21 · the task frame (ADR-22). Built only when a site is actually
    // selected: a frame whose every slot is empty would route four planes at
    // nothing and record four fallbacks for a turn that named no site, where
    // today's behaviour — targets, unrouted — is exactly right.
    const frame = resolved.copy ? await buildFrame(req, resolved) : undefined;

    // WP-08's tripwire, run at assembly time so a mirror that has drifted from
    // the live settings is disclosed on the turn it matters, not at startup.
    let policyDivergences = 0;
    try {
      policyDivergences = core.law?.verifyMirror().length ?? 0;
    } catch {
      /* the tripwire must never break the turn it guards */
    }

    // WP-37 · the turn's procedure plane AND the scope its arming carried. A
    // caller-supplied request stays authoritative (it is 20c's contract) and
    // carries no scope: nothing selected anything for it.
    const turnProcedure = req.procedure
      ? { request: req.procedure }
      : procedureRequestForTurn({ runbooks: core.law?.runbooks, userMessage: req.userMessage });
    const procedureRequest = turnProcedure?.request;

    // WP-20d folds the cursor here; WP-26 keeps what the fold saw, because the
    // stream needs the same slice and a second fold would be a second opinion.
    const folded = procedureRequest
      ? withCursor(procedureRequest, req.sessionId, taskId)
      : undefined;

    const request: AssembleRequest = {
      actor: { id: 'act_chat_assembler', kind: 'system', autonomy: 'interactive' },
      capability: null, // v0 chat runs under no capability grant
      task: { id: taskId, intent: req.userMessage },
      targets,
      ...(frame ? { frame } : {}),
      // WP-20b decides what the procedure plane is owed (grants + the two
      // assembly-time arming paths); a caller that supplies its own request
      // stays authoritative, because the field is 20c's contract. WP-20d then
      // attaches the checkpoint cursor to whatever that produced — it decides
      // nothing about arming, and with nothing armed it changes nothing.
      ...(folded ? { procedure: folded.request } : {}),
      surface: CHAT_SURFACE,
      policyDivergences,
      context: {
        policyVersionHash: sessionPolicyHash.get(req.sessionId),
        procedureHash: sessionProcedureHash.get(req.sessionId),
        citationConventionHash: sessionCitationHash.get(req.sessionId),
        rebuildingDurableContext: req.buildingSystemPrompt,
      },
      retrieval: { semanticLimit: SEMANTIC_LIMIT },
    };

    const bundle = await assemble(request, {
      law: core.law?.registry,
      // WP-20a built this index at bootstrap; 20c reads it rather than opening
      // the law directory a second time.
      runbooks: core.law?.runbooks,
      ledger: core.ledger,
      twins: core.twins,
      semantic: semanticPortFor(req.services),
      wrapUntrusted,
    });

    if (bundle.ambient) sessionPolicyHash.set(req.sessionId, bundle.ambient.versionHash);
    // WP-34: remembered only when the section ACTUALLY rode. A turn whose
    // carrier was empty taught nothing, and recording it as taught would leave
    // the next turn re-asserting a version the actor has never seen — the one
    // failure mode of a hash re-assert, and the one it is hardest to notice.
    if (bundle.blocks.turnSections.includes('citation-convention')) {
      sessionCitationHash.set(req.sessionId, CITATION_CONVENTION_VERSION);
    }
    if (bundle.procedure?.status === 'delivered') {
      sessionProcedureHash.set(req.sessionId, bundle.procedure.hash);
    } else {
      sessionProcedureHash.delete(req.sessionId);
      // A turn that delivers nothing ends the run: the checkpoints attested
      // against a procedure the actor was told to stop following must not carry
      // into the next arming. Same reasoning as the hash above (WP-20c f6).
      forgetProcedureRun(req.sessionId);
    }

    // WP-48b · the arming's scope, recorded on the manifest the fold reads.
    //
    // ONLY ON A DELIVERED PROCEDURE, and that bound is the parity floor: a turn
    // that armed nothing has no arming and therefore no scope, and its manifest
    // stays byte-identical to every manifest written before this packet. A
    // REFUSED procedure is not a turn of the run either (`sessionRegistry`'s own
    // rule — a refusal's hash may be null, which would fork the run key on a
    // value naming no document), so it records none.
    emitManifest(
      core,
      bundle,
      targets,
      bundle.procedure?.status === 'delivered'
        ? manifestScopeFor(turnProcedure?.scope)
        : undefined,
      // WP-51 · the arming's cause, on the same bound and for the same reason:
      // a turn that armed nothing has no arming, and a REFUSED turn is not a
      // turn of the run, so neither records what it was answering.
      bundle.procedure?.status === 'delivered'
        ? manifestCauseFor(turnProcedure?.answers)
        : undefined,
    );

    // WP-26 · the three stream events, from the seam that folds the cursor.
    // AFTER the manifest, deliberately, and the stream re-folds rather than
    // reusing `folded.cursor`: this turn's manifest is what attests
    // `cp.consult-history`, and the surface must stand where the sequence guard
    // stands, not where the carrier does. See `procedureStream.notifyProcedureState`.
    notifyProcedureState({
      sessionId: req.sessionId,
      outcome: bundle.procedure,
      runbook: folded?.runbook,
      run: folded?.run,
      ledger: core.ledger,
      // WP-37 · the arming's scope, handed straight across. The absent-key
      // parity floor is enforced by `deriveDeclaredProcedure`'s own conditional
      // spread, not by this one (battery M16 is an equivalent mutant and M17 is
      // the witness); this stays because a seam that passes an explicit
      // `undefined` reads as though absence were a value it chose to send.
      ...(turnProcedure?.scope ? { scope: turnProcedure.scope } : {}),
    });

    // WP-25 · the incident producer's abort tap, on the same seam and reading
    // the same slice `foldProcedureCursor` reads. AFTER the assembly, so this
    // turn's bundle is unaffected and the incident is retrievable by the NEXT
    // turn's cp.consult-history — which is the loop the design note is for.
    // Nothing is recorded when no procedure is armed.
    if (folded?.run && folded?.runbook && core.ledger) {
      recordAbortIncidents({ run: folded.run, runbook: folded.runbook, ledger: core.ledger });
    }

    return {
      taskId,
      ambientBlock: bundle.blocks.ambient,
      turnBlock: bundle.blocks.turn,
      // See ChatAssemblyResult.grants — [] must never become a filter.
      grants: bundle.tools.length > 0 ? bundle.tools.map((t) => t.name) : undefined,
      procedure: bundle.procedure,
      citationSupply: supplyFromBundle(bundle),
      // WP-43 · verbatim off the manifest that was just emitted to the ledger,
      // so what the panel renders and what the record says are the same value
      // read once, not two derivations that can drift.
      citationManifest: bundle.manifest.citation,
    };
  } catch {
    return null; // swallow everything: a chat turn is never broken by this layer
  }
}

/**
 * WP-20d · the cursor, attached to this turn's procedure request.
 *
 * Arming registers the turn with the run FIRST, so the fold covers this turn as
 * well as the earlier ones: `correlation` is per-turn and the run is not, which
 * is the measurement this whole packet turns on. Nothing here decides whether a
 * capability is armed — that is WP-20b's, and an absent `armed` means no run,
 * no cursor, and a request identical to the one 20c already handles.
 *
 * Non-fatal like everything on this seam: a fold that cannot run leaves the
 * request without a cursor, and 20c renders "the platform is not attesting
 * checkpoints", which is then exactly true.
 */
interface FoldedProcedure {
  request: ProcedureRequest;
  /** What the fold saw, kept for the stream. Absent when no fold ran. */
  cursor?: ProcedureCursorState;
  runbook?: Runbook;
  run?: ProcedureRun;
}

function withCursor(
  procedure: ProcedureRequest,
  sessionId: string,
  taskId: string
): FoldedProcedure {
  try {
    const armed = procedure.armed;
    if (!armed) return { request: procedure };

    const core = getIntelligenceCore();
    const runbook = core?.law?.runbooks.byCapability(armed.capability);
    if (!core || !runbook) return { request: procedure };

    armProcedureRun({
      sessionId,
      capability: armed.capability,
      runbookId: runbook.id,
      runbookHash: runbook.hash,
    });
    registerProcedureTurn({ sessionId, taskId });
    const run = runForTask(taskId);
    if (!run) return { request: procedure };

    const state = foldProcedureCursor(run, runbook.checkpoints, core.ledger);
    // A fault is NOT rendered as an empty cursor: an empty cursor says "nothing
    // attested yet", and an unreadable ledger says nothing of the kind. The
    // guard refuses this capability's calls in that state; the carrier stays
    // silent rather than claiming progress it could not read. The stream is
    // handed the faulted state too and makes the same call for itself.
    if (state.fault) return { request: procedure, cursor: state, runbook, run };

    return {
      request: {
        ...procedure,
        cursor: { attested: state.attested, narrative: state.narrative, denied: state.denied },
      },
      cursor: state,
      runbook,
      run,
    };
  } catch {
    return { request: procedure };
  }
}

/**
 * The chat turn's targets. A Local site id resolves to its environment entity
 * through the same derivation every producer uses, so the assembler's episodic
 * and freshness queries key on ids the ledger already holds.
 *
 * WP-16 (audit A3): the logical Site rides alongside the environment. Every
 * producer dual-stamps `site` and `Ledger.query`'s entity filter matches ANY
 * role, so with the environment alone the episodic slice was scoped to this one
 * copy — prior activity on another environment of the same Site was invisible
 * to a turn that is plainly about that Site. Additive: the assembler is
 * unchanged, twin facts key to the environment so freshness is untouched, and
 * the extra role makes the manifest's entity block honest about what was
 * retrieved. Per-plane routing over those ids is WP-21's frame, built below:
 * `targets` stays the flat list every shipped path expects, and the frame is what
 * tells the assembler which plane reads which of them.
 */
function resolveTargets(req: ChatAssemblyRequest): ResolvedTargets {
  if (!req.siteId) return { targets: [] };
  try {
    const site = resolveSite(req.siteId, req.services.siteData);
    if (!site) return { targets: [] };
    const core = getIntelligenceCore();
    const copy: EntityRef = {
      role: 'environment',
      id: environmentEntityId(core?.entities, site.id),
      label: site.name,
    };
    const logicalSite: EntityRef = {
      role: 'site',
      id: siteEntityId(core?.entities, site.id),
      label: site.name,
    };
    return { targets: [copy, logicalSite], copy, site: logicalSite };
  } catch {
    return { targets: [] };
  }
}

interface ResolvedTargets {
  targets: EntityRef[];
  /** The copy this turn is about, when a site was selected and resolved. */
  copy?: EntityRef;
  /** The Site role, which is ALSO the id this turn's events are stamped with. */
  site?: EntityRef;
}

/**
 * The turn's frame (WP-21 · ADR-22).
 *
 * The Site slot is the id `resolveTargets` derived, NOT `entities.siteOf()`.
 * They can differ: for a mirrored WPE site the mirror establishes a
 * `wpe.site_id` Site, while every producer in this process stamps the
 * `local.site_id.logical` one — so routing episodic at the relational Site would
 * query an id no event carries and the history would go dark. The frame routes at
 * the id the history is keyed by; the links are still what resolve production,
 * inside `buildTaskFrame`.
 *
 * Non-fatal like everything on this seam: a frame that cannot be built is simply
 * absent, and the turn assembles exactly as it did before frames existed.
 */
async function buildFrame(
  req: ChatAssemblyRequest,
  resolved: ResolvedTargets
): Promise<TaskFrame | undefined> {
  try {
    const core = getIntelligenceCore();
    if (!core || !resolved.copy) return undefined;
    return buildTaskFrame({
      core,
      copyEntityId: resolved.copy.id,
      siteEntityId: resolved.site?.id,
      label: resolved.copy.label ?? req.siteId ?? '',
      describeEnvironment: await describeEnvironmentsFor(req.services),
    }).frame;
  } catch {
    return undefined;
  }
}

/** Bridges the existing fleet search service onto the core's SemanticPort. */
function semanticPortFor(services: NexusServices) {
  const search = (services as { searchService?: unknown }).searchService as
    | {
        searchFleet: (
          query: string,
          filters?: unknown,
          options?: unknown
        ) => Promise<{ results?: Array<Record<string, unknown>> }>;
      }
    | undefined;
  if (!search?.searchFleet) return undefined;

  return {
    async search(query: string, _entityIds: string[], limit: number): Promise<SemanticHit[]> {
      // Scoping note: the search service filters by LOCAL site id, and the
      // assembler speaks entity ids. v0 therefore searches fleet-wide and
      // labels each hit with its site, exactly as surface B does today
      // (ipc-handlers.ts:2878). Per-entity scoping is B-04's job and needs the
      // entity→siteId reverse lookup that WP-07 has not exposed yet.
      const res = await search.searchFleet(query, undefined, { limit });
      return (res?.results ?? []).slice(0, limit).map((r, i) => ({
        id: String(r.id ?? `${r.siteId ?? 'result'}:${i}`),
        title: String(r.title ?? 'untitled'),
        ...(typeof r.excerpt === 'string' ? { excerpt: truncate(r.excerpt, 200) } : {}),
        ...(typeof r.siteName === 'string' ? { label: r.siteName } : {}),
        ...(typeof r.score === 'number' ? { score: r.score } : {}),
      }));
    },
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * The manifest IS an event, so it goes to the LEDGER — not to
 * `operation-audit.log`. This codebase has three audit sinks with documented
 * drift (CLAUDE.md "Three sinks, not one") and the pull toward the audit file
 * is strong; recon §4.4 pin 2 exists to settle it. `correlation` is the turn's
 * TaskId, which makes "what did the agent know when it acted" a
 * `WHERE correlation = ?` query joining this manifest to every other event the
 * turn produces.
 *
 * First `task.*` producer in the codebase.
 */
function emitManifest(
  core: NonNullable<ReturnType<typeof getIntelligenceCore>>,
  bundle: ContextBundle,
  targets: EntityRef[],
  /** WP-48b. Absent on an unarmed or refused turn — see the call site. */
  scope?: ManifestScope,
  /** WP-51. Absent on the same terms, and also when the arming answered nothing. */
  cause?: ManifestCause
): void {
  try {
    const entity: Record<string, string> = {};
    for (const t of targets) entity[t.role] = t.id;

    core.emitter.emit({
      // Assembly is observed live: the manifest is true at the moment it is
      // built, so "now" is the honest observed_at (cp.observed-at).
      observed_at: bundle.manifest.assembled_at,
      topic: CONTEXT_ASSEMBLED_TOPIC,
      schema: CONTEXT_ASSEMBLED_SCHEMA,
      entity,
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      correlation: bundle.manifest.task,
      // The manifest, plus the arming's scope when there was an arming. Spread
      // CONDITIONALLY: an absent key and a present-`undefined` one are not the
      // same fact, and only the first is byte-identical to every manifest that
      // predates WP-48b. Same rule the arming carrier itself holds to.
      payload: {
        ...(bundle.manifest as unknown as Record<string, unknown>),
        ...(scope ? { scope } : {}),
        ...(cause ? { cause } : {}),
      },
    });
    core.scheduleFolds();
  } catch {
    /* a lost manifest must not cost the user their turn */
  }
}
