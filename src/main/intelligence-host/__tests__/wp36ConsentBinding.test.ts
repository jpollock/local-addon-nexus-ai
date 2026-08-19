/**
 * WP-36 · the consent-binding investigation, reproduced from the ledger.
 *
 * THE LIVE EVIDENCE this file reconstructs (owner's session, 2026-08-19,
 * `~/Library/Application Support/Local/nexus-ai/ledger.db` + `operation-audit.log`):
 *
 *   evt_01M0BQ8B5Z…  00:38:04.735Z  task.context.assembled  corr=task_01M0BQ8A…
 *                    procedure: rb.bulk-plugin-update v1.2.0, delivered, strict,
 *                    retrieval[] carries a `store: "ledger"` query
 *   evt_01M0BQA25N…  00:39:01.045Z  task.rationale.recorded corr=task_01M0BQ8A…
 *                    {"tool":"verify_site_live","decision":"approved",
 *                     "prompt":"Runbook rb.bulk-plugin-update v1.2.0, marked strict —
 *                      checkpoint cp.approval. Approve this step to let the runbook
 *                      continue.","args":{"site":"Local Labs"},
 *                     "source":"approval-card","canary_policy":"pause-after-canary"}
 *   operation-audit  00:39:01.047Z  verify_site_live  outcome=failure
 *                    "REFUSED … cp.backup is not attested … Attested so far:
 *                     cp.consult-history, cp.approval."
 *
 * NO `task.action.executed` exists for that verify, and the two tests below say
 * why in opposite directions — one confirms the guard REFUSED it (so there was
 * no act to record), the other confirms the fold attested `cp.approval` off an
 * approval whose subject was a live re-verify.
 *
 * INVESTIGATION HALF (Q2, Q3) — these pin behaviour that was already correct
 * and stays correct: the guard refused, and a refusal is not an act. They are
 * reproductions of the live artifacts and must never go green for a new reason.
 *
 * FIX HALF (Q1) — the tool-blind join is GONE. `task.rationale.recorded` now
 * carries `checkpoint`, always written, and the fold attests and denies only
 * from consents that name the checkpoint being folded. The live event is
 * replayed here in BOTH shapes: as it was actually written (no `checkpoint`
 * key at all — the legacy lane, grandfathered so history renders unchanged),
 * and as the producer would write it today.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
  ACTION_EXECUTED_TOPIC,
  ACTION_EXECUTED_SCHEMA,
  OUTCOME_RECORDED_TOPIC,
  OUTCOME_RECORDED_SCHEMA,
} from '../actionProducer';
import type { ApprovalRationaleRecord } from '../actionProducer';
import { CONTEXT_ASSEMBLED_TOPIC, CONTEXT_ASSEMBLED_SCHEMA } from '../chatAssembly';
import {
  armProcedureRun,
  forgetProcedureRun,
  registerProcedureTurn,
  foldProcedureCursor,
  runForTask,
} from '../procedureCursor';
import { checkCheckpointSequence } from '../sequenceGuard';
import { taskId as mintTaskId } from '../../../intelligence';

const CAPABILITY = 'cap.bulk_plugin_update';

/** The card text the human was actually shown, verbatim from the ledger. */
const LIVE_PROMPT =
  'Runbook rb.bulk-plugin-update v1.2.0, marked strict — checkpoint cp.approval. ' +
  'Approve this step to let the runbook continue.';

let core: IntelligenceCore;
let dir: string;
let task: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp36-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  task = mintTaskId();
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function arm(): void {
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  armProcedureRun({
    sessionId: 's1',
    capability: CAPABILITY,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
  });
  registerProcedureTurn({ sessionId: 's1', taskId: task });
}

/** evt_01M0BQ8B5Z… — the turn's own assembly manifest, with its ledger retrieval. */
function emitLiveManifest(): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: task,
    payload: {
      task,
      retrieval: [
        {
          store: 'ledger',
          query: 'entity=ent_site_GQVN4FEYFAC65T4N8153J9FRRG topic=state.* order=desc limit=8',
          returned: 8,
        },
      ],
    },
  });
}

/**
 * evt_01M0BQA25N… — the approval, byte-for-byte in the fields the fold reads.
 *
 * NO `checkpoint` key, because the live event has none: it predates the field.
 * That absence is what puts it in the legacy lane, and the legacy lane is why
 * this function still reproduces the 2026-08-19 refusal exactly.
 */
function emitLiveRationale(): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_jeremy_pollock', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: task,
    payload: {
      tool: 'verify_site_live',
      decision: 'approved',
      prompt: LIVE_PROMPT,
      args: { site: 'Local Labs' },
      source: 'approval-card',
      canary_policy: 'pause-after-canary',
    },
  });
}

// ---------------------------------------------------------------------------
// Q2 — did rule 1 admit a declared tool with an unattested gated predecessor?
// ---------------------------------------------------------------------------

describe('WP-36 Q2 · the guard’s decision on the live call', () => {
  test('verify_site_live is REFUSED after the approval, naming cp.backup', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    const refusal = checkCheckpointSequence('verify_site_live', task);

    // The whole held question. Rule 1 did NOT admit it: the approval cleared
    // cp.approval and the guard immediately refused again on the NEXT unmet
    // attestable predecessor. There is no reachable condition here in which a
    // declared tool passes with a gated predecessor unattested.
    expect(refusal).not.toBeNull();
    expect(refusal!.reason).toBe('sequence');
    expect(refusal!.checkpoint).toBe('cp.backup');
    expect(refusal!.claimedBy).toBe('cp.verify-canary');
  });

  test('the refusal message is the one operation-audit.log recorded at 00:39:01.047Z', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    const message = checkCheckpointSequence('verify_site_live', task)!.message;

    // Reproduced against the live line, clause by clause — including the
    // "Attested so far" list, which is the evidence for Q1 as well as Q2.
    expect(message).toContain(
      'REFUSED by procedure rb.bulk-plugin-update (cap.bulk_plugin_update): ' +
        'verify_site_live belongs to checkpoint cp.verify-canary, and cp.backup is not attested.',
    );
    expect(message).toContain(
      'What would attest it: a task.action.executed event for wpe_backup_and_verify, ' +
        'completing successfully.',
    );
    expect(message).toContain('Attested so far: cp.consult-history, cp.approval.');
  });

  test('WP-19’s contract, from the guard’s side: a refusal is not an act', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    expect(checkCheckpointSequence('verify_site_live', task)).not.toBeNull();

    // The absence of `task.action.executed` in the live window is this, and
    // nothing else: the chokepoint returns the refusal BEFORE `recordGatedAction`
    // is reached. Not tier scoping — verify_site_live is Tier 2, above
    // GATED_TIER_FLOOR, and the same tool DID emit an action event on
    // 2026-08-17 (evt_01M08SR1JH…, evt_01M08SWA0S…) when it actually ran.
    const actions = core.ledger.query({ correlation: task })
      .filter((e) => e.topic === 'task.action.executed');
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Q1 — what did the approval attest, and to what act is that consent bound?
// ---------------------------------------------------------------------------

/** The same consent, as the producer writes it today: bound to a checkpoint. */
function emitBoundRationale(
  checkpoint: string | null,
  decision: 'approved' | 'denied' = 'approved',
  tool = 'verify_site_live',
): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_jeremy_pollock', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: task,
    payload: {
      tool,
      decision,
      prompt: LIVE_PROMPT,
      args: { site: 'Local Labs' },
      source: 'approval-card',
      checkpoint,
    },
  });
}

function cursorNow(): ReturnType<typeof foldProcedureCursor> {
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  return foldProcedureCursor(runForTask(task)!, runbook.checkpoints, core.ledger);
}

describe('WP-36 Q1 · LEGACY — the pre-field event folds exactly as it did', () => {
  test('cp.approval is still attested by the 2026-08-19 rationale', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    // Grandfathered, deliberately. The hole closes FORWARD: rewriting how an
    // event already on disk is read would change what the ledger says about a
    // decision a human already made, which is the one thing an append-only
    // record must never do. History renders unchanged; the refusal message
    // reproduced above still names cp.consult-history and cp.approval.
    expect(cursorNow().attested).toContain('cp.approval');
  });

  test('the legacy lane is still subject-blind, and that is the point of closing it forward', () => {
    arm();
    emitLiveManifest();
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_jeremy_pollock', kind: 'human' },
      source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
      correlation: task,
      payload: { tool: 'wp_eval', decision: 'approved', prompt: 'card', source: 'approval-card' },
    });

    expect(cursorNow().attested).toContain('cp.approval');
  });
});

describe('WP-36 Q1 · BOUND — a consent attests the checkpoint it names, and no other', () => {
  test('a consent bound to cp.approval attests cp.approval', () => {
    arm();
    emitLiveManifest();
    emitBoundRationale('cp.approval');

    const cursor = cursorNow();
    expect(cursor.attested).toContain('cp.approval');
    expect(cursor.denied).not.toContain('cp.approval');
  });

  test('THE FIX: a plain tool confirm (checkpoint null) attests NOTHING', () => {
    arm();
    emitLiveManifest();
    // The 2026-08-19 shape, written by today's producer. A human approved a
    // live re-verify; nothing about the runbook's plan was put to them, and the
    // ledger no longer says otherwise.
    emitBoundRationale(null);

    const cursor = cursorNow();
    expect(cursor.attested).not.toContain('cp.approval');
    // And it is not a DENIAL either — a plain confirm is not evidence about
    // this checkpoint in either direction. Reading it as one would recreate the
    // same bug with the sign flipped and end the run.
    expect(cursor.denied).not.toContain('cp.approval');
  });

  test('a consent naming ANOTHER checkpoint attests nothing here', () => {
    arm();
    emitLiveManifest();
    emitBoundRationale('cp.some-other-step');

    const cursor = cursorNow();
    expect(cursor.attested).not.toContain('cp.approval');
    expect(cursor.denied).not.toContain('cp.approval');
  });

  test('a bound DENIAL of this checkpoint denies it — the honest half of the same rule', () => {
    arm();
    emitLiveManifest();
    emitBoundRationale('cp.approval', 'denied');

    const cursor = cursorNow();
    expect(cursor.denied).toContain('cp.approval');
    expect(cursor.attested).not.toContain('cp.approval');
  });

  test('a bound denial of SOMETHING ELSE no longer ends the run', () => {
    arm();
    emitLiveManifest();
    // Pre-fix, `else if (decisions.length > 0)` marked cp.approval DENIED off
    // any denied rationale at all — so declining an unrelated confirmation
    // ended the runbook. Both signs were blind; both are bound now.
    emitBoundRationale(null, 'denied', 'wp_eval');
    emitBoundRationale('cp.some-other-step', 'denied', 'wp_eval');

    const cursor = cursorNow();
    expect(cursor.denied).not.toContain('cp.approval');
    expect(cursor.attested).not.toContain('cp.approval');
  });

  test('the LATEST bound decision governs — a denial after an approval ends it', () => {
    arm();
    emitLiveManifest();
    emitBoundRationale('cp.approval', 'approved');
    emitBoundRationale('cp.approval', 'denied');

    const cursor = cursorNow();
    expect(cursor.denied).toContain('cp.approval');
    expect(cursor.attested).not.toContain('cp.approval');
  });

  test('a bound consent OVERRULES a subject-blind legacy one for the same checkpoint', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale(); // legacy, would attest
    emitBoundRationale('cp.approval', 'denied'); // named it, and said no

    expect(cursorNow().denied).toContain('cp.approval');
  });

  test('the evidence id is the event that GOVERNED, not the last with that decision', () => {
    arm();
    emitLiveManifest();
    emitBoundRationale('cp.approval', 'approved');
    // A later approval of something else. The old `decisionEvent` map was keyed
    // by DECISION, so this event would have become cp.approval's proof.
    emitBoundRationale('cp.some-other-step', 'approved');

    const cursor = cursorNow();
    const proof = core.ledger
      .query({ correlation: task })
      .find((e) => e.id === cursor.evidence!['cp.approval'].eventId)!;
    expect((proof.payload as { checkpoint: string }).checkpoint).toBe('cp.approval');
  });
});

// ---------------------------------------------------------------------------
// Q1, continued — HOW FAR that consent reaches
// ---------------------------------------------------------------------------

describe('WP-36 Q1 · the reach of the mis-bound attestation, and its closure', () => {
  test('THE SEVERITY STATEMENT: the legacy shape unlocks the fleet write', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    // cp.approval is attested off the verify approval, so the backup — a
    // declared tool whose only unmet prerequisite WAS cp.approval — is admitted.
    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();

    // Run it. Nothing here is a second human decision; it is a tool call.
    const action = core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: ACTION_EXECUTED_TOPIC,
      schema: ACTION_EXECUTED_SCHEMA,
      entity: {},
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: task,
      payload: {
        tool: 'wpe_backup_and_verify',
        tier: 2,
        dispatch: 'registry',
        targets: 1,
        targets_resolved: 1,
      },
    });
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: OUTCOME_RECORDED_TOPIC,
      schema: OUTCOME_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: task,
      causation: action.id,
      payload: { tool: 'wpe_backup_and_verify', result: 'success', result_scope: 'call' },
    });

    // THE CONSEQUENCE, stated as plainly as it deserves. `bulk_plugin_update`
    // is claimed at cp.canary; its attestable predecessors are cp.consult-history,
    // cp.approval and cp.backup, and all three now read attested. The guard
    // passes it. The card does not fire again — WP-26 raises it only when the
    // guard is refusing ON the approval checkpoint, and the guard is no longer
    // refusing at all.
    //
    // So the one human decision in this chain — "approve a live re-verify of
    // Local Labs" — is, in the ledger, the consent that let the fleet-wide
    // plugin update proceed. The sequencer is not what failed. What the consent
    // record says the human agreed to is.
    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });

  test('and today’s producer closes it: the same consent unlocks nothing', () => {
    arm();
    emitLiveManifest();
    // The identical human act — approve a live re-verify of Local Labs —
    // recorded by the producer as it writes today.
    emitBoundRationale(null);

    // The chain stops at its first link. cp.approval is unattested, so the
    // backup is refused, so nothing downstream of it can be reached at all.
    const refusal = checkCheckpointSequence('wpe_backup_and_verify', task);
    expect(refusal).not.toBeNull();
    expect(refusal!.checkpoint).toBe('cp.approval');
    expect(checkCheckpointSequence('bulk_plugin_update', task)!.checkpoint).toBe('cp.approval');
  });
});

// ---------------------------------------------------------------------------
// The field is REQUIRED, and that is enforced at compile time
// ---------------------------------------------------------------------------

describe('WP-36 · `checkpoint` cannot be forgotten by a new call site', () => {
  test('omitting it does not compile', () => {
    // A TYPE-LEVEL pin, and it is the only kind that can hold this property:
    // "always written" is a promise about call sites that do not exist yet, and
    // no runtime test can observe a surface nobody has written. If the field is
    // ever made optional, this `@ts-expect-error` becomes unused and ts-jest
    // fails the suite with TS2578 — the mutation battery's M18 witness.
    //
    // Why it matters enough to pin: an optional field lets a future approval
    // surface omit it, and an omitted key is the LEGACY discriminator. The
    // event would land in the grandfathered, subject-blind lane and attest a
    // checkpoint nobody consented to — the 2026-08-19 defect, reintroduced by
    // a surface that simply forgot.
    // @ts-expect-error `checkpoint` is required
    const record: ApprovalRationaleRecord = {
      toolName: 'wp_eval',
      args: {},
      cardText: 'card',
      decision: 'approved',
    };
    expect(record.toolName).toBe('wp_eval');
  });
});
