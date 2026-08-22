/**
 * WP-19 · The gateway producer — architecture §7's "the gateway emits
 * task.action_executed for every call", made real against the respelled
 * taxonomy (§4.2: `task.action.executed`, `task.outcome.recorded`,
 * `task.rationale.recorded`).
 *
 * WHY A PRODUCER AND NOT A LOG LINE. `operation-audit.log` already records
 * every gated call, and this deliberately does not replace it: the audit file
 * is the compliance record, flat and per-line; the ledger is the EPISODIC
 * spine, where an act is joinable to the context that produced it
 * (`WHERE correlation = <task id>` reaches the assembly manifest, the
 * approval, the action and its outcome as one thread) and to the entities it
 * touched. Two sinks, two questions. CLAUDE.md's "three sinks, not one" now
 * reads four; this file is the fourth, and it obeys the same redaction rules
 * as the other three for exactly that reason.
 *
 * FIVE RULES, each of which a reviewer should be able to check against the
 * code below:
 *
 *   1. TIER BOUNDARY — Tier 2+ only. A Tier-1 read is not an act. `task.*`
 *      events are NEVER deleted (architecture §4.4), so recording reads would
 *      make the audit substrate a permanent keystroke log of every fleet
 *      browse. The gate is the same `getToolSafety` the audit chokepoint
 *      uses, so the two records cover the same population by construction.
 *   2. NEVER FABRICATE — an outcome is the CALL's outcome, attached to each
 *      target the layer could RESOLVE (never derive: audit A7). A target it
 *      cannot identify produces no invented entity id, and the payload says
 *      how many were unresolved rather than quietly dropping them.
 *   3. RATIONALE IS VERBATIM — the approval card's own warning text, the tool,
 *      and the redacted args. Nothing is composed here. Synthesising prose the
 *      actor never produced would poison the one record an incident review
 *      trusts most.
 *   4. REDACTION AT THE WALK, NOT THE CALL SITE — `redactParams` /
 *      `maskSecretsInString` from `mcp/audit.ts`, so `FREEFORM_FIELDS` and
 *      every masking layer apply here too and a new call site cannot leak by
 *      forgetting.
 *   5. NON-FATAL, AND ORDERED AFTER THE ACT — the gate blocks; the audit
 *      records. Emission happens after the call has already succeeded or
 *      failed and is individually wrapped, so an audit fault can neither
 *      prevent an act nor convert a successful call into an error.
 *
 * Out of scope, deliberately: a call REFUSED by the Tier-3 confirmation gate
 * emits nothing here. It did not execute, so `task.action.executed` would be
 * false; a refusal is a `control.*` fact and wants its own packet.
 */
import { getToolSafety } from '../mcp/safety';
import { maskSecretsInString, redactParams } from '../mcp/audit';
import { resolveLocalSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';
import type { IntelligenceCore } from './bootstrap';
import { getIntelligenceCore } from './coreRegistry';
import { environmentEntityId, siteEntityId } from './provisionalEntity';
import { CANARY_POLICIES, CanaryPolicy } from './procedureView';

/** Topics — architecture doc §4.2, three-segment spelling (WP-11 respell). */
export const ACTION_EXECUTED_TOPIC = 'task.action.executed';
export const OUTCOME_RECORDED_TOPIC = 'task.outcome.recorded';
export const RATIONALE_RECORDED_TOPIC = 'task.rationale.recorded';

export const ACTION_EXECUTED_SCHEMA = 'action.executed/1';
export const OUTCOME_RECORDED_SCHEMA = 'outcome.recorded/1';
export const RATIONALE_RECORDED_SCHEMA = 'rationale.recorded/1';

/**
 * The tier at which a tool call becomes an ACT. Same floor as the durable
 * audit write in `ToolRegistry.call` — if you change one, the two records stop
 * describing the same population.
 */
export const GATED_TIER_FLOOR = 2;

/** `source.system` — one value, so liveness is one row in the health table. */
export const GATEWAY_SYSTEM = 'gateway:tool-call';
/** The approval card is a different source: a human's decision, not the layer's. */
export const APPROVAL_SYSTEM = 'gateway:approval';

/**
 * Which dispatch path executed the call. Load-bearing, not decorative: the
 * `agent__*` contributed path reaches NEITHER `ToolRegistry.call` nor its
 * audit write (recon §2.2; CLAUDE.md's audit-chokepoint list says the same),
 * so an audit record that could not distinguish them would be unable to show
 * that the bypass is covered at all.
 */
export type DispatchPath = 'registry' | 'contributed';

export interface GatedActionRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** For target resolution. Absent is fine — targets simply go unresolved. */
  services?: NexusServices;
  accessMethod?: string;
  dispatch: DispatchPath;
  /**
   * The caller's authoritative tier, where it has one. Contributed agent tools
   * DECLARE a permission tier (`ContributedToolRegistry`), and their MCP names
   * are absent from `TIER_OVERRIDES` — so without this the safety table's
   * default (2) would record a Tier-1 contributed read that the durable audit
   * deliberately skips, and the two records would stop covering the same
   * population.
   */
  tier?: number;
  /** The turn's TaskId (chatAssembly). Absent on surfaces with no task frame. */
  taskId?: string;
  /** The approval event this act followed from, where one exists. */
  causation?: string;
  outcome: 'success' | 'failure';
  error?: string;
  durationMs?: number;
}

export interface ApprovalRationaleRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** The approval card's warning text, VERBATIM. Never composed here. */
  cardText: string;
  decision: 'approved' | 'denied';
  taskId?: string;
  services?: NexusServices;
  /**
   * WP-26 · the canary policy the human chose ON this approval.
   *
   * **Absence is meaningful and must stay meaningful.** `deriveCanaryPolicy`
   * reports `declared: false` when no approval carried one, and the surface
   * renders the default AS a default; a gateway-authored value would turn that
   * flag into a lie and put a decision in the user's mouth. So this is written
   * only when the card actually offered the choice and the human made it —
   * never defaulted here, never inferred.
   */
  canaryPolicy?: CanaryPolicy;
  /**
   * WP-36 · THE CHECKPOINT THIS CONSENT ATTESTS — and `null` is a value here,
   * not a missing one.
   *
   * The 2026-08-19 incident: a human approved a live re-verify of one site, and
   * the fold read that approval as `cp.approval` — the runbook's "explicit,
   * informed consent" to the presented plan — because the join asked only
   * "is there an approved rationale in this run?" and nothing about its
   * subject. `foldProcedureCursor` discarded the tool key it had built. The
   * repair cannot live in the fold alone: the checkpoint existed only inside
   * the free-text `prompt`, and matching on prose is not a join.
   *
   * **ALWAYS WRITTEN from the flip forward** (ruled at the WP-36 gate): the
   * checkpoint id when WP-26's card fired as a procedure's approval, and
   * `null` for a plain tool confirm. The always-written null is the
   * load-bearing half. It makes ABSENCE of the key an unambiguous legacy
   * discriminator, so a new plain confirm can never be mistaken for an old
   * procedure approval — which is exactly what a "write it only when we have
   * one" shape would have allowed, and it would have been indistinguishable
   * from the pre-fix events it must not resemble.
   *
   * `null` and a foreign checkpoint id are the same answer to any checkpoint
   * asking whether this consent was for it: no.
   */
  checkpoint: string | null;
}

/**
 * Record one gated tool call: one `task.action.executed`, plus one
 * `task.outcome.recorded` per resolved target (or exactly one when no target
 * could be resolved — an act with an unknown target is still an act).
 *
 * Returns the action event's id so a caller can chain from it; `undefined`
 * when nothing was recorded (no core, a Tier-1 read, or a fault — all three
 * are silent by design).
 */
export function recordGatedAction(record: GatedActionRecord): string | undefined {
  try {
    const core = getIntelligenceCore();
    if (!core) return undefined; // core optional by contract — degrade silently

    const tier = record.tier ?? getToolSafety(record.toolName).tier;
    if (tier < GATED_TIER_FLOOR) return undefined; // rule 1

    const targets = resolveTargets(core, record.args, record.services);
    const resolved = targets.filter((t) => t.refs);
    // An entity map naming ONE of several targets would misattribute the call
    // to that site. The per-target outcomes below carry the refs instead.
    const actionEntity = resolved.length === 1 ? resolved[0].refs! : {};

    // `observed_at`: a tool call is observed live — the fact ("this ran") is
    // true at the moment the call returns, which is now. cp.observed-at's
    // "now ONLY for genuinely live observation" case.
    const observedAt = new Date().toISOString();

    const action = core.emitter.emit({
      observed_at: observedAt,
      topic: ACTION_EXECUTED_TOPIC,
      schema: ACTION_EXECUTED_SCHEMA,
      entity: actionEntity,
      actor: actorFor(core, record.accessMethod),
      source: { class: 'work', system: GATEWAY_SYSTEM, trust: 'emitted' },
      ...(record.taskId ? { correlation: record.taskId } : {}),
      // Absent when no approval preceded this call — honest, not empty.
      ...(record.causation ? { causation: record.causation } : {}),
      payload: {
        tool: record.toolName,
        tier,
        dispatch: record.dispatch,
        access_method: record.accessMethod ?? 'unknown',
        targets: targets.length,
        targets_resolved: resolved.length,
        args: redactParams(record.args),
      },
    });

    const outcomeEntities = resolved.length ? resolved.map((t) => t.refs!) : [{}];
    for (const entity of outcomeEntities) {
      core.emitter.emit({
        observed_at: observedAt,
        topic: OUTCOME_RECORDED_TOPIC,
        schema: OUTCOME_RECORDED_SCHEMA,
        entity,
        actor: actorFor(core, record.accessMethod),
        source: { class: 'work', system: GATEWAY_SYSTEM, trust: 'emitted' },
        ...(record.taskId ? { correlation: record.taskId } : {}),
        causation: action.id,
        payload: {
          tool: record.toolName,
          result: record.outcome,
          // v0 records the CALL's result against each target, not an
          // independently observed per-site one. Saying so is the difference
          // between a record and a claim: nothing here re-checked each site,
          // and a reader must not mistake fan-out for per-site verification.
          result_scope: 'call',
          ...(record.durationMs !== undefined ? { duration_ms: record.durationMs } : {}),
          // Raw tool output — masked, exactly as the audit sinks mask `error`.
          ...(record.error ? { error: maskSecretsInString(record.error) } : {}),
        },
      });
    }

    // NO CHANGE GATE, and this is not the pattern's cp.dedup being skipped —
    // same reasoning WP-14 recorded for sync events. The gate compares a value
    // against `twin_facts`; an act folds into no twin and HAS no current
    // value. Two identical plugin updates are two acts, and collapsing them
    // would erase exactly the record this packet exists to create.
    core.scheduleFolds();
    return action.id;
  } catch {
    // Rule 5. A record lost is a record lost; a call broken by its own audit
    // would be a far worse failure than the gap it leaves.
    return undefined;
  }
}

/**
 * Record the human's approval decision as `task.rationale.recorded` v0.
 *
 * v0 rationale is the minimal HONEST one: the card the human was shown and
 * the arguments they approved, plus the decision. It is not an explanation —
 * no actor produced one at this seam — and inventing one is precisely the
 * "boilerplate rationale" the E-02 spec forbids, dressed up as content. A
 * richer rationale becomes possible when the procedure packet (WP-20) gives
 * the actor a runbook and steps to reason against.
 *
 * A DENIED decision is recorded too, and that is the point: without the
 * denial in the ledger, "did it proceed past a denied approval?" has only one
 * side of the comparison.
 *
 * Returns the event id, so the action that follows can chain its causation.
 */
function isCanaryPolicy(value: unknown): value is CanaryPolicy {
  return typeof value === 'string' && (CANARY_POLICIES as readonly string[]).includes(value);
}

export function recordApprovalRationale(record: ApprovalRationaleRecord): string | undefined {
  try {
    const core = getIntelligenceCore();
    if (!core) return undefined;

    const targets = resolveTargets(core, record.args, record.services);
    const resolved = targets.filter((t) => t.refs);

    const event = core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: resolved.length === 1 ? resolved[0].refs! : {},
      // The click IS a human act, even on a machine whose session actor is
      // unknown — so the fallback keeps `kind: 'human'` and admits the id.
      actor: core.identity?.actor() ?? { id: 'act_local_operator', kind: 'human' },
      // Provenance: an approval is elicited intent, not a platform
      // observation. Trust ranks it accordingly wherever it is read.
      source: { class: 'intent', system: APPROVAL_SYSTEM, trust: 'elicited' },
      ...(record.taskId ? { correlation: record.taskId } : {}),
      payload: {
        tool: record.toolName,
        decision: record.decision,
        prompt: record.cardText,
        args: redactParams(record.args),
        source: 'approval-card',
        // WP-36 · written on EVERY approval, `null` included. Not spread
        // conditionally: a key that appears only sometimes is the shape whose
        // absence the fold reads as "legacy, grandfathered", and a present-day
        // plain confirm must never land in that lane.
        checkpoint: record.checkpoint,
        // Validated against the vocabulary HERE, at the producer, so no call
        // site can widen the field by passing something else through. A denial
        // carries none: there is no canary to have a policy about.
        ...(record.decision === 'approved' && isCanaryPolicy(record.canaryPolicy)
          ? { canary_policy: record.canaryPolicy }
          : {}),
      },
    });

    core.scheduleFolds();
    return event.id;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// WP-56 · The deferral — a session act on the run's own record
// ---------------------------------------------------------------------------

/**
 * `source.system` for a deferral. A DISTINCT system from `gateway:approval`,
 * deliberately: a deferral is not a consent decision, and a provenance reader
 * that could not tell them apart would be unable to answer "did anyone actually
 * approve this?" — which is the one question this family exists to answer.
 *
 * **No health SLO line is added for it, and the reasoning is `gateway:approval`'s
 * own, verbatim in substance** (`health.ts`, the NOTE beside `gateway:tool-call`):
 * it fires only when a human defers something, which many users will never do,
 * so a liveness line for it would read "nothing yet" forever on a perfectly
 * healthy machine. `unlistedProducersLine` still surfaces it as an unmonitored
 * source once it appears — at verdict `OK`, so it can never darken the reserved
 * row — which is the honest treatment: visible, without a liveness claim nobody
 * can meet.
 */
export const DEFERRAL_SYSTEM = 'gateway:deferral';

/** `payload.source` — the discriminator, mirroring the approval's own. */
export const DEFERRAL_PAYLOAD_SOURCE = 'deferral-card';

/** What a deferral record does. `defer` opens one; `end` supersedes it. */
export type DeferralAct = 'defer' | 'end';

/**
 * WHEN A DEFERRAL WAKES — "a deferral may carry a derivable wake condition, and
 * a woken deferral ends loudly" (cycle two, 2026-08-18).
 *
 * Two kinds, because the ruling names two: "a time, or a record condition (the
 * window opening, a producer coming back)". A `record` condition names WHAT
 * derives it and carries no value of its own — the same shape and the same
 * discipline as `DerivedDeadline.from`, whose comment is the precedent: never
 * author a value beside the thing that derives it.
 *
 * An UNCONDITIONED deferral is permitted and is represented by the ABSENCE of
 * this, never by a `kind: 'none'`. "The item keeps its tier and place forever at
 * low intensity, which is your never-a-dismissal rule holding."
 */
export type DeferralWake =
  | { kind: 'time'; at: string }
  | { kind: 'record'; from: string };

/**
 * WHICH WAKE CONDITIONS MAY BE OFFERED AND RECORDED TODAY — ruled at WP-56's
 * gate, and it is the ruling's own sentence: **the surface does not offer a wake
 * condition the platform cannot fire.**
 *
 * `wakeSource` on the snapshot discloses the missing `wakeFired` port to a
 * reader of the fold. It does not disclose it to the PERSON CHOOSING THE WAKE
 * CONDITION, and that is the person the disclosure is for: offering "wake me
 * when the incident is closed" against a port nothing supplies would record a
 * promise the platform cannot keep, and a deferral that silently never wakes is
 * the furniture problem this affordance exists to prevent — manufactured by the
 * affordance itself.
 *
 * So `record` is absent from this list, and until a producer publishes a
 * vocabulary of record conditions the offer is **time, or unconditioned**.
 * Unconditioned is the ABSENCE of a wake rather than a member here.
 *
 * **ONE LIST, TWO CONSUMERS, and that is the point of exporting it.** The
 * producer's guard reads it and the picker reads it, so the day a record-wake
 * producer lands, this list gains `'record'` and both the guard and the offer
 * change together. A hardcoded picker and a hardcoded guard would be two places
 * to remember, which is how the two would disagree.
 *
 * **The FOLD still implements `record` in full** (`wakeHasFired`, the
 * `wakeFired` port). The ruled rule is built and pinned; what is withheld is the
 * offer, not the mechanism. Dropping the mechanism would be silently not
 * implementing a ruled rule — `deadlineFor`'s standing reasoning, applied here.
 */
export const OFFERABLE_WAKE_KINDS = ['time'] as const;

export interface DeferralRecord {
  /**
   * THE SITUATION being deferred — never one of its parts.
   *
   * XD-28: "deferral applies to the situation, never to its parts — deferring
   * one member while its siblings escalate would split a situation the platform
   * just asserted is one thing." The record names a situation id and the fold
   * matches it against situation ids alone, so a record naming a part's event id
   * resolves to nothing and the situation goes on escalating. That is the rule
   * enforced by what the fold can look up, rather than by a check someone has to
   * remember to write.
   */
  situationId: string;
  /**
   * The turn's TaskId — the run this is recorded ON.
   *
   * Cycle two: "recorded on the run (the rationale family)". This becomes the
   * envelope's `correlation`, which is how every other run-scoped fact in this
   * ledger joins to its run.
   */
  taskId?: string;
  /** The user's own words. Required, and never composed here. */
  reason: string;
  /** Absent ⇒ unconditioned, which is permitted and simply never wakes. */
  wake?: DeferralWake | null;
}

export interface DeferralEndRecord {
  situationId: string;
  taskId?: string;
  /** The deferral event this ends. Superseding, never mutating. */
  supersedes: string;
}

/**
 * A DEFERRAL PAYLOAD CARRIES NO `decision` KEY, AND THAT IS LOAD-BEARING RATHER
 * THAN A STYLE CHOICE. Read this before adding one.
 *
 * Four readers fold `task.rationale.recorded`, and every one of them keys off
 * `decision`:
 *
 *   1. `foldProcedureCursor` (`procedureCursor.ts:263`) — `if (typeof
 *      payload.decision !== 'string') continue`.
 *   2. `abortRecord` (`procedureStream.ts:403`) — `denied` sets the abort,
 *      `approved` clears it.
 *   3. `deriveCanaryPolicy` (`procedureView.ts:703`) — keys off `canary_policy`.
 *   4. `deriveApprovals` (`sessionRegistry.ts`) — reads the cursor, so (1) covers it.
 *
 * MEASURED, and both branches of (1) are hostile to a deferral that carries a
 * decision. With `decision: 'deferred'` and no `checkpoint` key, the record
 * enters the LEGACY lane, where `legacyLatest.set(payload.tool, 'deferred')`
 * **overwrites a standing legacy approval for that tool** — so deferring a
 * situation would silently REVOKE consent already given. With a `checkpoint`
 * id, it enters the BOUND lane, where any decision that is not the wanted one
 * is pushed to `denied` — and `deriveCheckpointStates` rule 2 is that "a denial
 * is an abort", so deferring would ABORT the run. One key, two ways to convert
 * "not now" into "no".
 *
 * So the payload carries no `decision`, and it is honest for exactly the reason
 * that makes it safe: **a deferral is not a consent decision.** It is a recorded
 * statement about this item's urgency. Guard (1) already says "an event that
 * records no decision is not a decision", and that guard is the one that keeps
 * all four readers still. `deferralIsNotConsent.test.ts` drives all four with a
 * real deferral event and pins that none of them move.
 */
function emitDeferralRecord(
  act: DeferralAct,
  situationId: string,
  taskId: string | undefined,
  extra: Record<string, unknown>,
  causation?: string
): string | undefined {
  try {
    const core = getIntelligenceCore();
    if (!core) return undefined; // core optional by contract — degrade silently
    if (!situationId) return undefined;

    // ONLY THE USER DEFERS. "An agent quieting its own gate is the
    // self-promotion power inverted" — so a non-human actor is refused HERE, at
    // the write, as well as dropped at the fold. Two enforcements rather than
    // one because they fail differently: this one means the record never
    // exists, and the fold's means a record that somehow does exist can still
    // never lower an escalation.
    const actor = core.identity?.actor() ?? { id: 'act_local_operator', kind: 'human' as const };
    if (actor.kind !== 'human') return undefined;

    const event = core.emitter.emit({
      // The click IS observed live: the fact ("this person deferred this now")
      // is true at the moment the call returns. cp.observed-at's "now ONLY for
      // genuinely live observation" case, same as the approval beside it.
      observed_at: new Date().toISOString(),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      // A deferral is about a SITUATION, not about a site. Stamping it with the
      // situation's places would make an entity-scoped query return a fact that
      // is not about that entity.
      entity: {},
      actor,
      // Provenance: a deferral is elicited intent, not a platform observation —
      // the approval's own classification, for the same reason.
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      ...(taskId ? { correlation: taskId } : {}),
      ...(causation ? { causation } : {}),
      payload: {
        source: DEFERRAL_PAYLOAD_SOURCE,
        act,
        situation: situationId,
        ...extra,
      },
    });

    core.scheduleFolds();
    return event.id;
  } catch {
    // Non-fatal by construction, like every producer on this seam.
    return undefined;
  }
}

/**
 * Record a deferral. Returns the event id, or `undefined` when nothing was
 * recorded.
 *
 * REFUSES rather than degrades, on three inputs, because each degradation would
 * be worse than the refusal:
 *
 *  - **No reason.** The ruling records one ("say why, so the record carries
 *    it"); a deferral with an empty reason is a dismissal with a nicer name.
 *  - **A malformed wake.** Dropping an unparseable condition would silently
 *    convert a deferral the user CONDITIONED into one that never wakes —
 *    exactly the furniture problem this affordance exists to prevent, created
 *    by the affordance itself.
 *  - **A non-human actor** — see `emitDeferralRecord`.
 */
export function recordDeferral(record: DeferralRecord): string | undefined {
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (!reason) return undefined;

  const wake = record.wake ?? null;
  if (wake !== null) {
    // RULED AT THE GATE: a wake kind the platform cannot fire is not offered,
    // and therefore not recorded. `record` is absent from `OFFERABLE_WAKE_KINDS`
    // until a producer supplies the `wakeFired` port — see that constant. This
    // is the FAIL-CLOSED half: refusing here means the promise is never written,
    // rather than written and silently never kept.
    if (!(OFFERABLE_WAKE_KINDS as readonly string[]).includes(wake.kind)) return undefined;
    if (wake.kind === 'time') {
      if (typeof wake.at !== 'string' || !Number.isFinite(Date.parse(wake.at))) return undefined;
    } else if (wake.kind === 'record') {
      if (typeof wake.from !== 'string' || !wake.from.trim()) return undefined;
    } else {
      return undefined;
    }
  }

  return emitDeferralRecord('defer', record.situationId, record.taskId, {
    // MASKED, not withheld and not verbatim. The reason is free text a person
    // typed into a box, and it lands in a sink whose `task.*` events are NEVER
    // deleted (architecture §4.4) — so the value-shape layer runs on it, exactly
    // as it runs on `error`. It is not on `FREEFORM_FIELDS` because it is body
    // text rather than executed syntax the caller composes, which is the line
    // that list draws (CLAUDE.md, "Withholding is the primary defense").
    //
    // The approval's `prompt` beside this is deliberately NOT masked, and the
    // difference is real: `cardText` is copy the PLATFORM composed and handed to
    // the user, so it can carry nothing the user typed. This can.
    //
    // The cost, stated rather than hidden: a reason that trips the masker no
    // longer reads back as the user's exact words. That is visible ([REDACTED])
    // rather than silent, and it is the correct trade against a credential
    // living forever in an append-only ledger.
    reason: maskSecretsInString(reason),
    wake,
  });
}

/**
 * End a deferral early — the user's second statement, superseding the first.
 *
 * "Ending it early is a second statement that supersedes the first — recorded
 * the same way, superseding never mutating" (cycle two §3). The `causation`
 * edge to the deferral event is what makes it a supersession rather than an
 * unrelated act, and it is the resolution pattern the incident producer already
 * uses. Nothing the agent does can end a deferral any more than start one, which
 * is why this refuses a non-human actor on the identical check.
 */
export function recordDeferralEnded(record: DeferralEndRecord): string | undefined {
  if (!record.supersedes) return undefined;
  return emitDeferralRecord(
    'end',
    record.situationId,
    record.taskId,
    { supersedes: record.supersedes },
    record.supersedes
  );
}

// ---------------------------------------------------------------------------
// Actors (ADR-14: actor.id + actor.via)
// ---------------------------------------------------------------------------

/**
 * `via` is filled by the emitter from the satellite identity — never set here.
 * `id`/`kind` name WHO acted, as coarsely as the surface honestly allows:
 * the chat/MCP model and the agent runtime are agents; anything else is the
 * machine's session actor (the OS user, until real session auth exists —
 * architecture §11 watch item 4). This is the first consumer of
 * `IdentityPort.actor()`, which has existed unused since WP-01.
 */
function actorFor(
  core: IntelligenceCore,
  accessMethod: string | undefined
): { id: string; kind: 'human' | 'agent' | 'ability' | 'system' } {
  if (accessMethod === 'mcp') return { id: 'act_chat_agent', kind: 'agent' };
  if (accessMethod === 'agent') return { id: 'act_agent_runtime', kind: 'agent' };
  // 'cli' and unknown: a session on this machine drove it. An unknown session
  // is 'system', never a fabricated human.
  return core.identity?.actor() ?? { id: 'act_unknown_caller', kind: 'system' };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * The argument names that carry a target across this codebase's tool surface.
 * A tool whose target rides under some other name simply resolves nothing —
 * which the payload reports as `targets_resolved: 0` rather than hiding.
 */
const TARGET_KEYS = ['site', 'site_id', 'site_ids', 'install_name', 'install_id', 'ssh_target'];

/** WPE aliases the site-link mirror writes. RESOLVE-only; nothing is derived. */
const REMOTE_NAMESPACES = ['wpe.install_id', 'wpe.install_name', 'graph.site_row'];

interface TargetRef {
  value: string;
  refs?: Record<string, string>;
}

function resolveTargets(
  core: IntelligenceCore,
  args: Record<string, unknown>,
  services: NexusServices | undefined
): TargetRef[] {
  const values: string[] = [];
  for (const key of TARGET_KEYS) {
    const raw = args?.[key];
    if (typeof raw === 'string' && raw) values.push(raw);
    else if (Array.isArray(raw)) values.push(...raw.filter((v): v is string => typeof v === 'string' && !!v));
  }
  return values.map((value) => ({ value, refs: entityRefsFor(core, value, services) }));
}

/**
 * A target's entity refs, or nothing.
 *
 * Local sites go through the SAME derivation every other producer uses, so an
 * action lands on the entity the ledger already holds for that site. Remote
 * targets are RESOLVED through aliases the mirror wrote and never derived: a
 * derived id for an install would mint a second entity beside the real one,
 * which is audit A7's defect and the exact thing WP-14 fixed for lineage.
 *
 * EXPORTED at WP-25, unchanged: the incident producer resolves the same kind of
 * target (a site the sentinel names) and a second copy of this ladder is how
 * two producers start disagreeing about which entity a site is. Consumers must
 * treat `undefined` as "do not record", never as "derive one".
 */
export function entityRefsFor(
  core: IntelligenceCore,
  value: string,
  services: NexusServices | undefined
): Record<string, string> | undefined {
  try {
    const local = services?.siteData ? resolveLocalSite(value, services.siteData, services.graphService) : null;
    if (local) {
      return {
        environment: environmentEntityId(core.entities, local.id),
        site: siteEntityId(core.entities, local.id),
      };
    }

    const entities = core.entities;
    if (!entities) return undefined;
    for (const namespace of REMOTE_NAMESPACES) {
      const candidate = entities
        .resolve(value, namespace)
        .filter((c) => c.type === 'env')
        .sort((a, b) => b.matchedAlias.confidence - a.matchedAlias.confidence)[0]?.entityId;
      if (!candidate) continue;
      // WP-16's dual stamp: the logical Site rides alongside the environment
      // where the graph knows it, so a Site-scoped query sees this act too.
      let site: string | undefined;
      try {
        site = entities.siteOf(candidate) ?? undefined;
      } catch {
        /* a faulty entity service must never break a producer */
      }
      return { environment: candidate, ...(site ? { site } : {}) };
    }
    return undefined;
  } catch {
    return undefined; // resolution is best-effort; absence is honest
  }
}
