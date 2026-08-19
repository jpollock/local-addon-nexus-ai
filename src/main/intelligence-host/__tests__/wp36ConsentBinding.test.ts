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
 * These are CHARACTERIZATION tests. They pin what shipped, including the part
 * this packet proposes to change: the second test asserts the tool-blind join
 * that a fix would break on purpose. It is written so that a fix turns it RED
 * at the assertion that names the defect, not somewhere incidental.
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

/** evt_01M0BQA25N… — the approval, byte-for-byte in the fields the fold reads. */
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

describe('WP-36 Q1 · what the fold derived from that rationale', () => {
  test('cp.approval is attested by an approval whose subject was verify_site_live', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    const cursor = foldProcedureCursor(runForTask(task)!, runbook.checkpoints, core.ledger);

    // THE DEFECT, characterized. cp.approval's evidence clause is
    // `{ topic: task.rationale.recorded, decision: approved }` — it names a
    // topic and a decision and NOTHING about the subject. `foldProcedureCursor`
    // reads `[...latestDecision.values()]`, discarding the map's tool key, so
    // ANY approved rationale in the run attests the plan-approval checkpoint.
    // The consent recorded here was for a live re-verify of one site; what the
    // ledger now says is that cp.approval — "explicit, informed consent" to the
    // presented update plan — has been given.
    expect(cursor.attested).toContain('cp.approval');

    const evidence = cursor.evidence!['cp.approval'];
    expect(evidence.topic).toBe('task.rationale.recorded');

    // And the event the audit view will offer as proof is the verify approval.
    const proof = core.ledger.query({ correlation: task })
      .find((e) => e.id === evidence.eventId)!;
    expect((proof.payload as { tool: string }).tool).toBe('verify_site_live');
    expect((proof.payload as { prompt: string }).prompt).toBe(LIVE_PROMPT);
  });

  test('the tool-blindness is general: an approval of ANY tool attests cp.approval', () => {
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
      // A tool with no relationship to this runbook at all.
      payload: { tool: 'wp_eval', decision: 'approved', prompt: 'card', source: 'approval-card' },
    });

    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    const cursor = foldProcedureCursor(runForTask(task)!, runbook.checkpoints, core.ledger);

    // Not a quirk of verify_site_live being declared on a later checkpoint of
    // the same runbook: the join has no subject term at all. This is the
    // assertion a fix must break.
    expect(cursor.attested).toContain('cp.approval');
  });

  test('the same blindness inverts on a DENIAL — any denied tool denies cp.approval', () => {
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
      payload: { tool: 'wp_eval', decision: 'denied', prompt: 'card', source: 'approval-card' },
    });

    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    const cursor = foldProcedureCursor(runForTask(task)!, runbook.checkpoints, core.ledger);

    // `else if (decisions.length > 0) denied.push(...)` — and `denied` is what
    // the refusal turns into "a denial ends the run: record it and stop." So
    // declining an unrelated confirmation ends the runbook run. Recorded here
    // because a fix to the approving half must fix this half in the same edit;
    // repairing one sign and leaving the other is how a half-fix ships.
    expect(cursor.denied).toContain('cp.approval');
    expect(cursor.attested).not.toContain('cp.approval');
  });
});

// ---------------------------------------------------------------------------
// Q1, continued — HOW FAR that consent reaches
// ---------------------------------------------------------------------------

describe('WP-36 Q1 · the reach of the mis-bound attestation', () => {
  test('the verify approval unlocks bulk_plugin_update with no second card', () => {
    arm();
    emitLiveManifest();
    emitLiveRationale();

    // cp.approval is now attested off the verify approval, so the backup — a
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
});
