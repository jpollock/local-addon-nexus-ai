/**
 * WP-20d · the checkpoint cursor — folded from `task.*`, never stored.
 *
 * Every fixture here is a REAL event through the real emitter into a real
 * ledger, shaped exactly as WP-19's producers shape them, because the fold's
 * whole job is to read what those producers actually write. A hand-built row
 * would let the fold and the producer drift apart silently, which is the one
 * failure this file exists to catch.
 *
 * The load-bearing case is `spans the turns of one run`: `correlation` is the
 * per-TURN TaskId, a procedure spans many turns, and a fold keyed on one turn
 * would report an approval given on turn 3 as never having happened.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  ACTION_EXECUTED_SCHEMA,
  OUTCOME_RECORDED_TOPIC,
  OUTCOME_RECORDED_SCHEMA,
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
} from '../actionProducer';
import {
  CONTEXT_ASSEMBLED_TOPIC,
  CONTEXT_ASSEMBLED_SCHEMA,
} from '../chatAssembly';
import {
  armProcedureRun,
  foldProcedureCursor,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from '../procedureCursor';
import { taskId as mintTaskId } from '../../../intelligence';
import type { RunbookCheckpoint } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;

/**
 * Real `task_<ULID>` ids, minted per test. The envelope validator REFUSES a
 * correlation that is not one, so a readable literal like 't1' would have made
 * every fixture unemittable — and a fold tested against events the producers
 * could never write proves nothing about the producers.
 */
let t1: string;
let t2: string;

/** The anchor runbook's checkpoints, as WP-20d authors them. */
const CHECKPOINTS: RunbookCheckpoint[] = [
  { id: 'cp.consult-history', attest: 'manifest', evidence: { topic: 'task.context.assembled' }, tools: [] },
  { id: 'cp.dry-run', attest: 'narrative', tools: [] },
  {
    id: 'cp.approval',
    attest: 'event',
    evidence: { topic: 'task.rationale.recorded', decision: 'approved' },
    tools: [],
  },
  {
    id: 'cp.backup',
    attest: 'event',
    evidence: { topic: 'task.action.executed', tool: 'wpe_backup_and_verify', perTarget: true },
    tools: [{ name: 'wpe_backup_and_verify' }],
  },
  { id: 'cp.canary', attest: 'narrative', tools: [{ name: 'bulk_plugin_update' }] },
  { id: 'cp.verify-canary', attest: 'narrative', tools: [] },
  {
    id: 'cp.roll-fleet',
    attest: 'event',
    evidence: { topic: 'task.action.executed', tool: 'bulk_plugin_update' },
    tools: [{ name: 'bulk_plugin_update' }],
  },
  { id: 'cp.report', attest: 'narrative', tools: [] },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-cursor-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  forgetProcedureRun('s2');
  t1 = mintTaskId();
  t2 = mintTaskId();
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- emitters, shaped exactly as WP-19 shapes them -------------------------

function emitManifest(taskId: string, retrieval: unknown[]): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: taskId,
    payload: { task: taskId, retrieval },
  });
}

function emitRationale(taskId: string, decision: 'approved' | 'denied', tool = 'bulk_plugin_update'): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_local_operator', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: taskId,
    payload: { tool, decision, prompt: 'card text', source: 'approval-card' },
  });
}

function emitAction(
  taskId: string,
  tool: string,
  outcome: 'success' | 'failure' = 'success'
): void {
  const action = core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: taskId,
    payload: { tool, tier: 2, dispatch: 'registry', targets: 1, targets_resolved: 1 },
  });
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: OUTCOME_RECORDED_TOPIC,
    schema: OUTCOME_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: taskId,
    causation: action.id,
    payload: { tool, result: outcome, result_scope: 'call' },
  });
}

/** Arm a run and register N turns, returning their task ids. */
function armedRun(taskIds: string[]): void {
  armProcedureRun({
    sessionId: 's1',
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    runbookHash: 'sha256:abc',
  });
  for (const taskId of taskIds) registerProcedureTurn({ sessionId: 's1', taskId });
}

const fold = () => foldProcedureCursor(runForTask(t2)!, CHECKPOINTS, core.ledger);

// ---------------------------------------------------------------------------

describe('the run, not the turn', () => {
  test('spans the turns of one run — an approval given on an earlier turn still counts', () => {
    armedRun([t1, t2]);
    emitRationale(t1, 'approved'); // turn 1
    emitManifest(t2, [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }]);

    const cursor = fold();

    // The whole finding in one assertion: correlation is per-TURN, the run is
    // not, and a fold keyed on `t2` alone would report no approval at all.
    expect(cursor.attested).toContain('cp.approval');
    expect(cursor.attested).toContain('cp.consult-history');
  });

  test('does not see another session‘s run', () => {
    armedRun([t1, t2]);
    armProcedureRun({
      sessionId: 's2',
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      runbookHash: 'sha256:abc',
    });
    const other = mintTaskId();
    registerProcedureTurn({ sessionId: 's2', taskId: other });
    emitRationale(other, 'approved');

    expect(fold().attested).not.toContain('cp.approval');
  });

  test('a turn registered before arming is not in the run — the cursor starts when the capability does', () => {
    const t0 = mintTaskId();
    registerProcedureTurn({ sessionId: 's1', taskId: t0 });
    armedRun([t1, t2]);
    emitRationale(t0, 'approved');

    expect(fold().attested).not.toContain('cp.approval');
  });

  test('re-arming a different capability starts a new run', () => {
    armedRun([t1, t2]);
    emitRationale(t1, 'approved');
    armProcedureRun({
      sessionId: 's1',
      capability: 'cap.other',
      runbookId: 'rb.other',
      runbookHash: 'sha256:zzz',
    });
    const t3 = mintTaskId();
    registerProcedureTurn({ sessionId: 's1', taskId: t3 });

    const run = runForTask(t3)!;
    expect(run.capability).toBe('cap.other');
    expect(foldProcedureCursor(run, CHECKPOINTS, core.ledger).attested).toEqual([]);
  });
});

describe('what attests what', () => {
  beforeEach(() => armedRun([t1, t2]));

  test('cp.consult-history is attested by the assembler‘s own retrieval — the SUPPLY side', () => {
    emitManifest(t2, [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 0 }]);

    // returned: 0 still attests. The assembler ran the query; an empty history
    // is a finding, not a failure to consult, and requiring results would make
    // the checkpoint unattestable on a site with no incidents.
    expect(fold().attested).toContain('cp.consult-history');
  });

  test('a manifest with no ledger retrieval attests nothing', () => {
    emitManifest(t2, [{ store: 'semantic', query: 'plugins', returned: 3 }]);

    expect(fold().attested).not.toContain('cp.consult-history');
  });

  test('cp.backup needs the action AND a successful outcome', () => {
    emitAction(t2, 'wpe_backup_and_verify', 'failure');

    // ab.backup-failed is "not waivable — not by user insistence, urgency, or
    // claimed authority". A failed backup that attested cp.backup would waive
    // it silently, which is the worst available failure of this whole packet.
    expect(fold().attested).not.toContain('cp.backup');

    emitAction(t2, 'wpe_backup_and_verify', 'success');
    expect(fold().attested).toContain('cp.backup');
  });

  test('an action for a DIFFERENT tool does not attest the checkpoint', () => {
    emitAction(t2, 'wpe_create_backup', 'success');

    // The runbook names wpe_backup_and_verify specifically: "use
    // wpe_backup_and_verify, not wpe_create_backup" is instruction, and a fold
    // that accepted either would erase the distinction.
    expect(fold().attested).not.toContain('cp.backup');
  });

  test('every narrative checkpoint stays unattested no matter what is emitted', () => {
    emitManifest(t2, [{ store: 'ledger', query: 'q', returned: 1 }]);
    emitRationale(t2, 'approved');
    emitAction(t2, 'wpe_backup_and_verify', 'success');
    emitAction(t2, 'bulk_plugin_update', 'success');

    const cursor = fold();
    for (const id of ['cp.dry-run', 'cp.canary', 'cp.verify-canary', 'cp.report']) {
      expect(cursor.attested).not.toContain(id);
    }
    // …and they are reported as narrative rather than merely missing, because
    // "cannot be verified" and "not yet done" are different facts (P7).
    expect(cursor.narrative).toEqual([
      'cp.dry-run',
      'cp.canary',
      'cp.verify-canary',
      'cp.report',
    ]);
  });

  test('attested ids come back in runbook order, not emission order', () => {
    emitAction(t2, 'bulk_plugin_update', 'success');
    emitRationale(t2, 'approved');
    emitManifest(t2, [{ store: 'ledger', query: 'q', returned: 1 }]);

    expect(fold().attested).toEqual([
      'cp.consult-history',
      'cp.approval',
      'cp.roll-fleet',
    ]);
  });
});

describe('the denied approval — M4, programmatic at last', () => {
  beforeEach(() => armedRun([t1, t2]));

  test('a denial does not attest, and is reported as a denial rather than an absence', () => {
    emitRationale(t1, 'denied');

    const cursor = fold();
    expect(cursor.attested).not.toContain('cp.approval');
    expect(cursor.denied).toContain('cp.approval');
  });

  test('a denial followed by an approval attests — the human changed their mind', () => {
    emitRationale(t1, 'denied');
    emitRationale(t2, 'approved');

    const cursor = fold();
    expect(cursor.attested).toContain('cp.approval');
    expect(cursor.denied).not.toContain('cp.approval');
  });

  test('an approval followed by a DENIAL does not attest — the latest decision governs', () => {
    emitRationale(t1, 'approved');
    emitRationale(t2, 'denied');

    // The inverse of the case above, and the one a naive `.some(approved)`
    // implementation gets wrong: re-proposing after a denial is exactly what
    // the runbook's ab.approval-denied forbids.
    const cursor = fold();
    expect(cursor.attested).not.toContain('cp.approval');
    expect(cursor.denied).toContain('cp.approval');
  });
});

describe('non-fatal by construction', () => {
  test('an unreadable ledger surfaces as a fault, not an exception, and attests nothing', () => {
    armedRun([t1, t2]);
    const exploding = {
      query: () => {
        throw new Error('ledger is on fire');
      },
    };

    const cursor = foldProcedureCursor(runForTask(t2)!, CHECKPOINTS, exploding as never);

    expect(cursor.fault).toBe(true);
    expect(cursor.attested).toEqual([]);
  });

  test('an unregistered task has no run — the cursor is not consulted at all', () => {
    expect(runForTask(mintTaskId())).toBeUndefined();
  });

  test('forgetting the run drops it', () => {
    armedRun([t1, t2]);
    forgetProcedureRun('s1');

    expect(runForTask(t2)).toBeUndefined();
  });
});
