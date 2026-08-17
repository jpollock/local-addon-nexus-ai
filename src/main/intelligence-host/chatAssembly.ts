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
import { getIntelligenceCore } from './coreRegistry';
import {
  armProcedureRun,
  foldProcedureCursor,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from './procedureCursor';
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

/** Drop a session's remembered assertions (chat clear / session delete). */
export function forgetChatAssemblySession(sessionId: string): void {
  sessionPolicyHash.delete(sessionId);
  sessionProcedureHash.delete(sessionId);
  // WP-20d: and the checkpoint run, which is the same kind of "what has this
  // actor already done" state, held for the same ADR-10 reason.
  forgetProcedureRun(sessionId);
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

    const request: AssembleRequest = {
      actor: { id: 'act_chat_assembler', kind: 'system', autonomy: 'interactive' },
      capability: null, // v0 chat runs under no capability grant
      task: { id: taskId, intent: req.userMessage },
      targets,
      ...(frame ? { frame } : {}),
      // WP-20d attaches the checkpoint cursor to whatever procedure request
      // reaches here (20b decides arming; this packet decides nothing about
      // it). Absent when nothing is armed, which is what keeps an unarmed turn
      // byte-identical.
      ...(req.procedure ? { procedure: withCursor(req.procedure, req.sessionId, taskId) } : {}),
      surface: CHAT_SURFACE,
      policyDivergences,
      context: {
        policyVersionHash: sessionPolicyHash.get(req.sessionId),
        procedureHash: sessionProcedureHash.get(req.sessionId),
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
    if (bundle.procedure?.status === 'delivered') {
      sessionProcedureHash.set(req.sessionId, bundle.procedure.hash);
    } else {
      sessionProcedureHash.delete(req.sessionId);
      // A turn that delivers nothing ends the run: the checkpoints attested
      // against a procedure the actor was told to stop following must not carry
      // into the next arming. Same reasoning as the hash above (WP-20c f6).
      forgetProcedureRun(req.sessionId);
    }

    emitManifest(core, bundle, targets);

    return {
      taskId,
      ambientBlock: bundle.blocks.ambient,
      turnBlock: bundle.blocks.turn,
      // See ChatAssemblyResult.grants — [] must never become a filter.
      grants: bundle.tools.length > 0 ? bundle.tools.map((t) => t.name) : undefined,
      procedure: bundle.procedure,
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
function withCursor(
  procedure: ProcedureRequest,
  sessionId: string,
  taskId: string
): ProcedureRequest {
  try {
    const armed = procedure.armed;
    if (!armed) return procedure;

    const core = getIntelligenceCore();
    const runbook = core?.law?.runbooks.byCapability(armed.capability);
    if (!core || !runbook) return procedure;

    armProcedureRun({
      sessionId,
      capability: armed.capability,
      runbookId: runbook.id,
      runbookHash: runbook.hash,
    });
    registerProcedureTurn({ sessionId, taskId });
    const run = runForTask(taskId);
    if (!run) return procedure;

    const state = foldProcedureCursor(run, runbook.checkpoints, core.ledger);
    // A fault is NOT rendered as an empty cursor: an empty cursor says "nothing
    // attested yet", and an unreadable ledger says nothing of the kind. The
    // guard refuses this capability's calls in that state; the carrier stays
    // silent rather than claiming progress it could not read.
    if (state.fault) return procedure;

    return {
      ...procedure,
      cursor: { attested: state.attested, narrative: state.narrative, denied: state.denied },
    };
  } catch {
    return procedure;
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
  targets: EntityRef[]
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
      payload: bundle.manifest as unknown as Record<string, unknown>,
    });
    core.scheduleFolds();
  } catch {
    /* a lost manifest must not cost the user their turn */
  }
}
