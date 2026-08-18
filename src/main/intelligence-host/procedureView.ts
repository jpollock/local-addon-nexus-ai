/**
 * The procedure render seam (WP-20e · design note §7/P7, and the designer's
 * §5b decisions in `docs/intelligence/wp20-design-inputs.md`).
 *
 * TYPES AND DERIVATIONS ONLY. Nothing here renders anything: the transcript
 * (RB-A2's collapsing checklist) and the audit view (RB-B's two columns) are the
 * designer's surfaces, and this module is the data contract they build against.
 * The point of naming these shapes here rather than letting each surface invent
 * its own is stated in §7 and worth repeating: **if the UI invents its own, the
 * transcript will claim verification the platform does not have.**
 *
 * THE ONE RULE EVERYTHING ELSE SERVES (P7, ratified at the WP-20d adjudication):
 *
 *   > If the rail renders all eight checkpoints with the same green tick, the
 *   > product is lying.
 *
 * Four of `rb.bulk-plugin-update`'s eight checkpoints are `attest: narrative` —
 * the platform can never prove them. So `CheckpointState` carries `attest`
 * beside `status`, and it carries a derived `verified` flag as well, because the
 * easy render (`status === 'attested' ? tick : blank`) is exactly the wrong one
 * and a surface should not have to remember that. **`verified` is true only when
 * the ledger proved it**, and no input to this module can make it true for a
 * narrative checkpoint — a hostile cursor claiming one is attested is ignored,
 * with a test that hands it one.
 *
 * This is the designer's own already-ruled supplied / quoted-in-this-answer /
 * neither distinction (ux-brief R3), applied to procedure instead of to facts.
 *
 * WHAT IS DERIVED, AND FROM WHAT — nothing here is authored beside the run:
 *
 * | shape | derived from |
 * |---|---|
 * | `CheckpointState` | the runbook's ordered checkpoints + WP-20d's folded cursor |
 * | the badge's reason line | the runbook body's own `## cp.x — reason` heading |
 * | `CommunicationObligation` | the runbook's `communication:` frontmatter |
 * | `ProcedureAuditRow.expected` | the sequence guard's own remedy sentence |
 * | the four abort groups | `task.outcome.recorded` events, per resolved target |
 * | the abort headline | the group counts |
 *
 * NAMING, WHERE TWO RECORDS WOULD HAVE DISAGREED (packet instruction: unify on
 * the eval's name and say so):
 *
 *  - `attest` / `event|manifest|narrative` — the eval's `checks.ts` adjudicates
 *    against these words because ADR-17 authors them, so the seam uses them
 *    verbatim rather than inventing `proved/claimed`.
 *  - `PROCEDURE_AUDIT_COLUMNS` is imported by the eval's B-03 judgment sheet, so
 *    "column-for-column consistent with the eval harness's judgment sheet"
 *    (design inputs §3) is a compile-time fact rather than a convention.
 *  - The words a surface shows for each attest class are `ATTEST_WORDS`, moved
 *    here from `nexus_load_procedure`'s handler and imported back by it. The
 *    model is told "the platform cannot verify this" about the same checkpoint a
 *    human sees on the rail; two vocabularies would let those two sentences
 *    drift apart.
 *  - A criterion is identified by the eval's own id (`<specId>#<kind>[<index>]`),
 *    never by the design note's K1…M4 shorthand, which is prose only.
 *
 * WHAT THIS PACKET DELIBERATELY DOES NOT DO. §7 also names three chat stream
 * event types. Their SHAPES are here (`procedureArmedEvent`,
 * `checkpointChangedEvent`, `procedureAbortedEvent`), because the designer's
 * surfaces need to build against them — but they are not added to the
 * `ChatStreamEvent` union and nothing emits them. Widening that union puts dead
 * branches in `ChatService`'s switches and a silent drop in the renderer's
 * handler; the wiring belongs with the surface that consumes it.
 */
import {
  AttestClass,
  EventEnvelope,
  nextGatedCheckpoint,
  ProcedureArmedBy,
  ProcedureOutcome,
  ProcedureRefusalCode,
  Runbook,
  RunbookCheckpoint,
  RunbookStrictness,
} from '../../intelligence';
import type { ProcedureCursorState } from './procedureCursor';
import type { ProcedureScope } from './procedureScope';
import { attestationRemedy } from './sequenceGuard';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * What each attest class MEANS, in the words already shipped to the model by
 * `nexus_load_procedure`. Shared rather than duplicated: see the header.
 */
/**
 * WP-31 · IN CAPABILITY TENSE, after the 2026-08-18 incident.
 *
 * These name attestation CLASSES — what the platform CAN prove about a
 * checkpoint. The previous wording ("verified from records" / "verified as
 * supplied" / "your account only, not verified") named the same classes and
 * READ AS COMPLETION STATES. A live run split the acknowledgement's list into
 * "already satisfied" (exactly the four labelled verified) and "still need to
 * perform" (exactly the four labelled not verified), then executed Tier-2
 * writes with no approval and no backup on record. The model did what the words
 * said.
 *
 * Every string is now a sentence about the PLATFORM's ability, which has no
 * reading as a claim about the run. The acknowledgement adds "— nothing is
 * attested yet" to the two provable classes and a hard line of its own, because
 * that is the surface where no state accompanies the label; the rail carries
 * these words only on a PENDING or ACTIVE checkpoint, where its own status
 * badge supplies the state.
 */
export const ATTEST_WORDS: Record<AttestClass, string> = {
  event: 'the platform can verify this from records',
  manifest: 'the platform can verify this from what it supplied',
  narrative: 'on your account only — the platform cannot verify this',
};

/**
 * The badge on a step the user did not ask for (§5b: "unasked-for steps are
 * badged", each with its own reason line).
 *
 * **WP-28: it is no longer on every step.** v0 badged every declared checkpoint,
 * on the reasoning that the runbook is the only source of steps — which made the
 * badge a synonym for "declared", so the first live run rendered "runbook added
 * this" over `cp.approval` and `cp.backup` too. If everything is badged, nothing
 * is: that is the uniform-rail defect wearing a different hat.
 *
 * Which steps qualify is AUTHORED in the reviewed document (`unrequested:` on the
 * checkpoint) and DERIVED here. It cannot be derived from structure: the ruled
 * set badges `cp.canary`, which uses the capability's own primary tool, and does
 * not badge `cp.roll-fleet`, which uses the same one. The difference is a
 * judgement about what the person asking had in mind, and the only place that
 * judgement belongs is the document a human reviewed.
 *
 * The `source` field on `CheckpointState` remains what a later packet would use
 * to tell a model-proposed step from a procedure's own — a different question.
 */
export const BADGE_LABEL = 'runbook added this';

/**
 * §5b: the canary policy is chosen once, at approval, rather than by
 * interrupting mid-run.
 */
export const CANARY_POLICIES = ['pause-after-canary', 'continue-if-clean'] as const;
export type CanaryPolicy = (typeof CANARY_POLICIES)[number];
export const DEFAULT_CANARY_POLICY: CanaryPolicy = 'pause-after-canary';

/** The audit view's columns — spec beside actual (RB-B). Shared with the eval's sheet. */
export const PROCEDURE_AUDIT_COLUMNS = [
  'checkpoint',
  'attest',
  'expected',
  'status',
  'evidence',
] as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** §7's five statuses, unchanged. `attested` never means "we took its word". */
export type CheckpointStatus = 'pending' | 'active' | 'attested' | 'skipped' | 'aborted';

export interface CheckpointEvidence {
  /** The ledger event that attests it, when one does. */
  eventId?: string;
  topic?: string;
  /** Always present: a blank cell reads as "not done yet", which is a different fact. */
  summary: string;
}

export interface CheckpointState {
  id: string;
  status: CheckpointStatus;
  attest: AttestClass;
  /**
   * The ONLY field a tick may be rendered from. True ⇒ the platform proved this
   * from the ledger. Never true for a narrative checkpoint, by construction.
   */
  verified: boolean;
  evidence?: CheckpointEvidence;
  /** The runbook's own authored one-liner for this step, or null if it authored none. */
  reason: string | null;
  /** Where the step came from. v0 has one answer; the field is what keeps it honest later. */
  source: 'runbook';
  /**
   * Whether the reviewed document marked this step as one the user did not ask
   * for (WP-28). The ONLY field a badge may be rendered from — see `BADGE_LABEL`.
   *
   * `false` for a checkpoint the document does not mark, INCLUDING a document
   * that predates the field: a rail asks one question and gets one answer, and
   * the answer to silence is the conservative one.
   */
  unrequested: boolean;
}

/**
 * The declared procedure (§5b: named, versioned, strict, every checkpoint listed
 * while approval is pending). Half-adherence becomes visible structure — a
 * checkpoint with no attestation — instead of a transcript confession.
 */
export interface DeclaredProcedure {
  capability: string;
  runbookId: string | null;
  version: string | null;
  strictness: RunbookStrictness | null;
  hash: string | null;
  armedBy: ProcedureArmedBy | null;
  checkpoints: CheckpointState[];
  /**
   * How many checkpoints the platform can prove AT ALL — the honest denominator.
   * "3 of 8 done" over a rail where four can never be proved is the
   * half-adherence lie wearing a progress bar.
   */
  verifiableCount: number;
  /**
   * The runbook's `communication:` list. **Narrative-only, permanently** (§7,
   * shape 4): the platform cannot prove the model said something. Render as
   * "the procedure requires you to be told:" with the transcript as the
   * evidence. Never tick these programmatically — which is why they are strings
   * and not `CheckpointState`s.
   */
  communication: string[];
  /** Present when the capability is disarmed instead of governed. */
  unavailable?: {
    code: ProcedureRefusalCode;
    reason: string;
    expectedHash?: string;
    actualHash?: string;
  };
  /**
   * WP-32 · the scope the arming carried (XD-15). The cells a human selected,
   * split by authority; `procedureScope.ts` owns every derivation over it.
   *
   * Handed on UNCHANGED — this seam does not re-split, re-order, or re-filter
   * it. A second derivation of a carried artifact is the re-derivation the
   * packet exists to stop, and it would be no less wrong for happening here.
   *
   * **Absent on a REFUSAL, always.** A refused capability is not armed, so
   * there is no run for a scope to belong to; attaching one would render a plan
   * beside a procedure the platform just disarmed — the same defect as listing
   * checkpoints from a runbook not in force, which is why that branch returns
   * `checkpoints: []` two screens up.
   */
  scope?: ProcedureScope;
}

export interface CheckpointBadge {
  label: typeof BADGE_LABEL;
  reason: string | null;
}

export interface CanaryPolicyState {
  policy: CanaryPolicy;
  /** False ⇒ nobody chose this; it is the default. Rendering it as a choice would be a fabrication. */
  declared: boolean;
  source: 'approval' | 'default';
  /** The approval event that carried it, when one did. */
  eventId?: string;
}

/** One target site's fate, from the events the gateway actually recorded. */
export interface SiteOutcomeRow {
  /** The entity id the outcome was stamped with. Rendering a NAME is the caller's job. */
  entityId: string;
  result: 'updated' | 'failed' | 'untouched';
  outcomeEventId?: string;
  actionEventId?: string;
  observedAt?: string;
  /** The backup act that covers this site — what "restorable" is allowed to rest on. */
  backupEventId?: string;
}

export interface AbortGroups {
  /** Done, standing (Q6: completed sites stand; restore is separate and gated). */
  done: SiteOutcomeRow[];
  /** Where the halt happened, with its recorded failure. */
  failed: SiteOutcomeRow[];
  /** Skipped, with the recorded reason. See `unavailable`: nothing records one yet. */
  skipped: SiteOutcomeRow[];
  /** Everything the halt prevented. Aborting leaves these exactly as they were. */
  untouched: SiteOutcomeRow[];
  /**
   * Groups the ledger cannot populate, NAMED rather than silently empty. An
   * empty "skipped" reads as "nothing was skipped"; that is a claim, and this is
   * the difference between the two.
   */
  unavailable: Array<{ group: 'skipped' | 'untouched'; reason: string }>;
  /**
   * The copy rule (design inputs §2): "abort" stops FUTURE work; it does not
   * undo done work. Derived from the counts, never authored beside them.
   */
  headline: string;
}

export interface ProcedureAuditRow {
  checkpoint: string;
  attest: AttestClass;
  /** SPEC column — what the runbook says would prove this step. */
  expected: string;
  /** ACTUAL column. */
  status: CheckpointStatus;
  evidence: string;
  verified: boolean;
}

export interface ProcedureArmedEvent {
  type: 'procedure_armed';
  procedure: DeclaredProcedure;
}

export interface CheckpointChangedEvent {
  type: 'checkpoint_changed';
  changed: CheckpointState[];
}

export interface ProcedureAbortedEvent {
  type: 'procedure_aborted';
  abortId: string;
  checkpointId: string;
  reason: string;
  groups: AbortGroups;
  restore: {
    perSite: Array<{ entityId: string; backupEventId: string }>;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Checkpoint states
// ---------------------------------------------------------------------------

/** The tick predicate. The only correct one — see `CheckpointState.verified`. */
export function isVerified(state: CheckpointState): boolean {
  return state.status === 'attested' && state.attest !== 'narrative';
}

/**
 * The runbook's own authored reason for a step: the tail of its
 * `## cp.x — reason` body heading. All four shipped strict runbooks write their
 * checkpoint sections this way, so the badge's reason line is the author's
 * sentence rather than a generated one. A section without a tail gets `null`,
 * and the surface shows the badge without a reason — inventing one would put
 * words in an author's mouth on a document whose whole authority is that a human
 * reviewed it.
 */
export function checkpointReason(runbook: Pick<Runbook, 'body'>, checkpointId: string): string | null {
  const escaped = checkpointId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^#{1,6}\\s+${escaped}\\s*[—–-]\\s*(.+)$`, 'm').exec(runbook.body ?? '');
  const reason = match?.[1]?.trim();
  return reason ? reason : null;
}

/**
 * The badge for a step, or `null` when the document did not mark one.
 *
 * Null rather than a flag on a always-returned object, deliberately: a surface
 * that has to remember to check `badge.show` is a surface that will forget, and
 * the thing it would then render is the uniform badge this replaced.
 */
export function checkpointBadge(state: CheckpointState): CheckpointBadge | null {
  if (!state.unrequested) return null;
  return { label: BADGE_LABEL, reason: state.reason };
}

export interface CheckpointDerivationOptions {
  /** The checkpoint an abort halted at (`aborts:` in the runbook). */
  abortedAt?: string;
}

/**
 * The rail, derived.
 *
 * Order of decision matters and is stated rather than implied:
 *
 *  1. **A ledger fault shows NO progress**, not zero progress. WP-20d ruled that
 *     "nothing attested yet" and "the ledger is unreadable" are different
 *     sentences; a rail is where that difference would be lost first.
 *  2. **A denial is an abort**, not a pending step. The decision exists and it
 *     was no; a rail that showed cp.approval as still-to-do would invite exactly
 *     the re-proposal the runbook forbids.
 *  3. **A narrative checkpoint can never reach `attested`** — even if the cursor
 *     says so. The fold cannot produce that, and if something ever does, this is
 *     where the lie stops.
 *  4. After an abort, later unattested checkpoints are `skipped` — the run did
 *     not reach them, which is not the same as their being still ahead.
 *  5. The first unattested checkpoint the platform CAN prove is `active` — the
 *     same one `nextGatedCheckpoint` names in the model's own turn block.
 */
export function deriveCheckpointStates(
  runbook: Pick<Runbook, 'body' | 'checkpoints'>,
  cursor: Pick<ProcedureCursorState, 'attested' | 'narrative' | 'denied' | 'fault' | 'evidence'> | undefined,
  options: CheckpointDerivationOptions = {}
): CheckpointState[] {
  const checkpoints = runbook.checkpoints ?? [];
  const base = (checkpoint: RunbookCheckpoint) => ({
    id: checkpoint.id,
    attest: checkpoint.attest,
    reason: checkpointReason(runbook, checkpoint.id),
    source: 'runbook' as const,
    // Read off the DECLARATION, like `attest`: the badge is the document's
    // claim about the step, and nothing downstream may add one.
    unrequested: checkpoint.unrequested === true,
  });

  // Rule 1 — and the same shape when no cursor exists at all: WP-20c renders
  // "the platform is not attesting checkpoints" in exactly that case.
  if (!cursor || cursor.fault) {
    const summary = cursor?.fault
      ? 'the attestation ledger could not be read, so no progress can be shown'
      : 'the platform is not attesting checkpoints for this run, so no progress can be shown';
    return checkpoints.map((c) => ({
      ...base(c),
      status: 'pending' as const,
      verified: false,
      evidence: { summary },
    }));
  }

  const attested = new Set(cursor.attested ?? []);
  const denied = new Set(cursor.denied ?? []);
  const abortIndex = abortedIndex(checkpoints, denied, options.abortedAt);
  const next = abortIndex < 0
    ? nextGatedCheckpoint(checkpoints, (c) => attested.has(c.id))
    : undefined;

  return checkpoints.map((checkpoint, index) => {
    const state = base(checkpoint);

    if (denied.has(checkpoint.id)) {
      return {
        ...state,
        status: 'aborted' as const,
        verified: false,
        evidence: {
          ...(cursor.evidence?.[checkpoint.id] ?? {}),
          summary: 'the decision exists and it was DENIED; no later approval superseded it',
        },
      };
    }

    if (options.abortedAt === checkpoint.id) {
      return {
        ...state,
        status: 'aborted' as const,
        verified: false,
        evidence: { summary: 'the run aborted here' },
      };
    }

    // Rule 3. `attest !== 'narrative'` is checked against the DECLARATION, not
    // against the cursor's narrative list, so a cursor that disagrees with the
    // document cannot promote a checkpoint the document says is unprovable.
    if (checkpoint.attest !== 'narrative' && attested.has(checkpoint.id)) {
      const evidence = cursor.evidence?.[checkpoint.id];
      return {
        ...state,
        status: 'attested' as const,
        verified: true,
        evidence: {
          ...(evidence ?? {}),
          summary: evidence
            ? `attested by ${evidence.eventId} (${evidence.topic})`
            : 'attested from the ledger',
        },
      };
    }

    if (abortIndex >= 0 && index > abortIndex) {
      return {
        ...state,
        status: 'skipped' as const,
        verified: false,
        evidence: { summary: 'the run stopped before reaching this step' },
      };
    }

    return {
      ...state,
      status: next?.id === checkpoint.id ? ('active' as const) : ('pending' as const),
      verified: false,
      evidence: { summary: ATTEST_WORDS[checkpoint.attest] },
    };
  });
}

/** Where the run stopped: an explicit abort, or the earliest denial. -1 when it did not. */
function abortedIndex(
  checkpoints: RunbookCheckpoint[],
  denied: Set<string>,
  abortedAt: string | undefined
): number {
  const explicit = abortedAt ? checkpoints.findIndex((c) => c.id === abortedAt) : -1;
  const byDenial = checkpoints.findIndex((c) => denied.has(c.id));
  if (explicit < 0) return byDenial;
  if (byDenial < 0) return explicit;
  return Math.min(explicit, byDenial);
}

// ---------------------------------------------------------------------------
// The declared procedure
// ---------------------------------------------------------------------------

export function deriveDeclaredProcedure(args: {
  /** What the assembler's procedure plane did this turn (`ChatAssemblyResult.procedure`). */
  outcome: ProcedureOutcome | null;
  /** The document behind it, from the runbook registry. Absent on a refusal. */
  runbook?: Runbook;
  cursor?: ProcedureCursorState;
  abortedAt?: string;
  /** WP-32 · what the arming carried. Passed through, never recomputed. */
  scope?: ProcedureScope;
}): DeclaredProcedure | null {
  const { outcome } = args;
  if (!outcome) return null;

  if (outcome.status === 'refused') {
    return {
      capability: outcome.capability,
      runbookId: outcome.runbookId,
      version: null,
      strictness: null,
      hash: null,
      armedBy: null,
      // No reviewed document ⇒ no rail. Listing steps from a runbook that is not
      // in force would show ceremony for a procedure the platform just disarmed.
      checkpoints: [],
      verifiableCount: 0,
      communication: [],
      unavailable: {
        code: outcome.code,
        reason: outcome.reason,
        ...(outcome.expectedHash ? { expectedHash: outcome.expectedHash } : {}),
        ...(outcome.actualHash ? { actualHash: outcome.actualHash } : {}),
      },
    };
  }

  const checkpoints = args.runbook
    ? deriveCheckpointStates(
        args.runbook,
        args.cursor,
        args.abortedAt ? { abortedAt: args.abortedAt } : {}
      )
    : [];

  return {
    capability: outcome.capability,
    runbookId: outcome.runbookId,
    version: outcome.version,
    strictness: outcome.strictness,
    hash: outcome.hash,
    armedBy: outcome.armedBy,
    checkpoints,
    verifiableCount: checkpoints.filter((c) => c.attest !== 'narrative').length,
    communication: communicationOf(args.runbook),
    // Conditional spread, not `scope: args.scope`: the parity pin asserts the
    // KEY is absent when nothing was selected, and `toEqual` cannot tell the
    // two apart (WP-26's finding). The refusal branch above never reaches here.
    ...(args.scope ? { scope: args.scope } : {}),
  };
}

/** The `communication:` frontmatter, as authored. Strings only — nothing ticks these. */
function communicationOf(runbook: Runbook | undefined): string[] {
  const raw = (runbook?.frontmatter as { communication?: unknown } | undefined)?.communication;
  if (!Array.isArray(raw)) return [];
  return raw.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
}

// ---------------------------------------------------------------------------
// The audit view (RB-B)
// ---------------------------------------------------------------------------

/**
 * Spec column beside actual column, one row per checkpoint — the same
 * spec-vs-actual shape as the eval harness's judgment sheet and `detect_drift`'s
 * classification (design inputs §3). Its "no attestation" gaps ARE B-03's
 * half-adherence criterion, rendered.
 */
export function deriveProcedureAudit(
  runbook: Pick<Runbook, 'body' | 'checkpoints'>,
  cursor: ProcedureCursorState | undefined,
  options: CheckpointDerivationOptions = {}
): ProcedureAuditRow[] {
  const states = deriveCheckpointStates(runbook, cursor, options);
  const byId = new Map((runbook.checkpoints ?? []).map((c) => [c.id, c]));
  return states.map((state) => {
    const checkpoint = byId.get(state.id);
    return {
      checkpoint: state.id,
      attest: state.attest,
      expected:
        state.attest === 'narrative' || !checkpoint
          ? `nothing in the ledger can attest this — narrative by declaration (${ATTEST_WORDS.narrative})`
          : attestationRemedy(checkpoint),
      status: state.status,
      evidence: state.evidence?.summary ?? ATTEST_WORDS[state.attest],
      verified: state.verified,
    };
  });
}

// ---------------------------------------------------------------------------
// The approval-carried canary policy
// ---------------------------------------------------------------------------

const RATIONALE_TOPIC = 'task.rationale.recorded';

/**
 * §5b: the policy is decided once, in the approval, and cp.canary's attestation
 * references it.
 *
 * **Nothing writes it yet.** The approval card has no policy control, so
 * `task.rationale.recorded` carries no `canary_policy` today. That is why
 * `declared` exists: the default is returned, and it is returned labelled as a
 * default. Rendering "pause after canary" as though the human had chosen it
 * would be a fabricated consent — the same class of error as ticking a narrative
 * checkpoint, on the field where the user's own decision is the subject.
 */
export function deriveCanaryPolicy(events: readonly EventEnvelope[]): CanaryPolicyState {
  let latest: { policy: CanaryPolicy; eventId: string } | undefined;
  for (const event of events ?? []) {
    if (event?.topic !== RATIONALE_TOPIC) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const args = (payload.args ?? {}) as Record<string, unknown>;
    const raw = payload.canary_policy ?? args.canary_policy;
    if (typeof raw !== 'string') continue;
    const policy = CANARY_POLICIES.find((p) => p === raw);
    if (policy) latest = { policy, eventId: event.id };
  }
  if (latest) return { policy: latest.policy, declared: true, source: 'approval', eventId: latest.eventId };
  return { policy: DEFAULT_CANARY_POLICY, declared: false, source: 'default' };
}

// ---------------------------------------------------------------------------
// The four abort groups
// ---------------------------------------------------------------------------

const ACTION_TOPIC = 'task.action.executed';
const OUTCOME_TOPIC = 'task.outcome.recorded';

/** The default backup tool for the anchor capability. Overridable per runbook. */
export const DEFAULT_BACKUP_TOOL = 'wpe_backup_and_verify';

export interface AbortGroupOptions {
  /** The run's events, oldest first (WP-20d folds them by run, not by turn). */
  events: readonly EventEnvelope[];
  /** The tool whose outcomes mean "this site was updated". */
  updateTool: string;
  backupTool?: string;
  /** Raw target values from the approved plan — what the human said yes to. */
  scope?: readonly string[];
  /** Raw target → entity id. Absent ⇒ `untouched` cannot be computed, and says so. */
  resolveEntity?: (raw: string) => string | undefined;
}

/**
 * The abort affordance's four honest groups (design inputs §2), each from
 * `task.outcome.recorded` — one event per resolved target, `result_scope: 'call'`.
 *
 * THE FIDELITY BOUND, stated here because a surface must repeat it: WP-19 stamps
 * the CALL's result against each target, not an independently observed per-site
 * one. "Updated" means the call that covered this site succeeded. Nothing
 * re-checked the site, so nothing here claims to.
 *
 * Two of §7's fields are deliberately ABSENT rather than empty. `from_version` /
 * `to_version` (design inputs §2's shape) have no producer: neither the action
 * nor the outcome payload records a version, so a field for them would be a slot
 * a surface fills with a dash and a reader reads as "unchanged". And `skipped`
 * has no recorded reason anywhere — see `unavailable`.
 *
 * This supersedes §7's three-way `worldState` (completed / failed / notAttempted)
 * with the designer's later four-way split; where they differ, §2's four groups
 * are the ruled shape, and the fourth ("skipped, with the recorded reason") is
 * the one the substrate cannot yet fill.
 */
export function deriveAbortGroups(options: AbortGroupOptions): AbortGroups {
  const backupTool = options.backupTool ?? DEFAULT_BACKUP_TOOL;
  const actionTool = new Map<string, string>();
  for (const event of options.events ?? []) {
    if (event?.topic !== ACTION_TOPIC) continue;
    const tool = (event.payload as { tool?: unknown } | undefined)?.tool;
    if (typeof tool === 'string') actionTool.set(event.id, tool);
  }

  const updates = new Map<string, SiteOutcomeRow>();
  const backups = new Map<string, string>();

  for (const event of options.events ?? []) {
    if (event?.topic !== OUTCOME_TOPIC) continue;
    const payload = (event.payload ?? {}) as { tool?: unknown; result?: unknown };
    const tool =
      typeof payload.tool === 'string'
        ? payload.tool
        : event.causation
          ? actionTool.get(event.causation)
          : undefined;
    const entityId = event.entity?.environment ?? event.entity?.site;
    if (!tool || !entityId) continue;

    if (tool === backupTool && payload.result === 'success' && !backups.has(entityId)) {
      backups.set(entityId, event.id);
      continue;
    }
    if (tool !== options.updateTool) continue;

    // Latest outcome per site wins: a retry that succeeded is not still failed.
    updates.set(entityId, {
      entityId,
      result: payload.result === 'success' ? 'updated' : 'failed',
      outcomeEventId: event.id,
      ...(event.causation ? { actionEventId: event.causation } : {}),
      ...(event.observed_at ? { observedAt: event.observed_at } : {}),
    });
  }

  const withBackup = (row: SiteOutcomeRow): SiteOutcomeRow => {
    const backup = backups.get(row.entityId);
    return backup ? { ...row, backupEventId: backup } : row;
  };

  const done = [...updates.values()].filter((r) => r.result === 'updated').map(withBackup);
  const failed = [...updates.values()].filter((r) => r.result === 'failed').map(withBackup);

  const unavailable: AbortGroups['unavailable'] = [
    {
      group: 'skipped',
      reason:
        'no producer records a skip reason: `task.outcome.recorded` carries the call\'s result ' +
        '(success/failure) and no "skipped, and why" outcome exists, so a skipped-site group ' +
        'would be inferred rather than observed',
    },
  ];

  let untouched: SiteOutcomeRow[] = [];
  if (!options.scope?.length) {
    // Absent scope and absent resolver are two ways of not knowing, and both
    // must say so. An empty `untouched` with nothing naming it reads as
    // "nothing was left untouched" — the same claim the `skipped` note above
    // refuses to make. Reachable since WP-26: the stream derives an abort
    // notice from the run's events, and that seam holds no approved plan.
    unavailable.push({
      group: 'untouched',
      reason:
        'the approved plan\'s target list is not recorded at this seam, so the sites the halt ' +
        'prevented cannot be listed; the ledger shows only what was attempted',
    });
  } else {
    if (options.resolveEntity) {
      const attempted = new Set(updates.keys());
      const seen = new Set<string>();
      for (const raw of options.scope) {
        const entityId = options.resolveEntity(raw);
        if (!entityId || attempted.has(entityId) || seen.has(entityId)) continue;
        seen.add(entityId);
        untouched.push({ entityId, result: 'untouched' });
      }
    } else {
      untouched = [];
      unavailable.push({
        group: 'untouched',
        reason:
          'the approved plan names raw targets and the ledger stamps entity ids; with no resolver ' +
          'the two cannot be compared, and guessing the join would invent sites that were never in scope',
      });
    }
  }

  return {
    done,
    failed,
    skipped: [],
    untouched,
    unavailable,
    headline: abortHeadline(done.length, failed.length, untouched.length),
  };
}

/**
 * "Abort" stops FUTURE work; it does not undo done work — the affordance's first
 * line says exactly that, derived from the counts (design inputs §2's copy rule).
 */
function abortHeadline(done: number, failed: number, untouched: number): string {
  const parts = [`${done} ${done === 1 ? 'site' : 'sites'} already updated and standing`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (untouched > 0) parts.push(`${untouched} untouched`);
  return `${parts.join('; ')}. Stopping here changes none of them.`;
}

// ---------------------------------------------------------------------------
// Stream shapes (types + builders only — see the header)
// ---------------------------------------------------------------------------

export function procedureArmedEvent(procedure: DeclaredProcedure): ProcedureArmedEvent {
  return { type: 'procedure_armed', procedure };
}

/** Only what actually changed: a rail that re-announces every checkpoint every turn is noise. */
export function diffCheckpointStates(
  before: readonly CheckpointState[],
  after: readonly CheckpointState[]
): CheckpointState[] {
  const previous = new Map(before.map((s) => [s.id, s]));
  return after.filter((state) => {
    const was = previous.get(state.id);
    if (!was) return true;
    return (
      was.status !== state.status ||
      was.verified !== state.verified ||
      was.evidence?.summary !== state.evidence?.summary
    );
  });
}

export function checkpointChangedEvent(
  before: readonly CheckpointState[],
  after: readonly CheckpointState[]
): CheckpointChangedEvent {
  return { type: 'checkpoint_changed', changed: diffCheckpointStates(before, after) };
}

/**
 * The abort notice (§7, shape 3 + the owner's Q6 ruling: halt and report,
 * completed sites stand, the restore path is NAMED, never automatic).
 */
export function procedureAbortedEvent(args: {
  abortId: string;
  checkpointId: string;
  reason: string;
  groups: AbortGroups;
}): ProcedureAbortedEvent {
  const perSite = args.groups.done
    .filter((row): row is SiteOutcomeRow & { backupEventId: string } => !!row.backupEventId)
    .map((row) => ({ entityId: row.entityId, backupEventId: row.backupEventId }));
  return {
    type: 'procedure_aborted',
    abortId: args.abortId,
    checkpointId: args.checkpointId,
    reason: args.reason,
    groups: args.groups,
    restore: {
      perSite,
      note:
        'Restoring a completed site is a separate, gated action taken per site. Aborting does not ' +
        'perform it and never implies it: the sites above are updated and stay that way until ' +
        'someone chooses otherwise.',
    },
  };
}
