/**
 * WP-26 · the procedure stream — emission, and the coalescing that makes it
 * readable.
 *
 * WP-20e shipped the three event SHAPES with deliberate non-emission. This
 * file pins what emits them, and the one property the designer's rail depends
 * on: **the renderer must never need to know the ledger exists.** A burst of
 * ledger events that folds to one checkpoint-state change is ONE emission, not
 * one per event — so the coalescing pin below drives the seam once per ledger
 * event and counts emissions, which is the only shape of test that can fail
 * against a per-event emitter.
 *
 * Every fixture is a real event through the real emitter into a real ledger,
 * for the reason `procedureCursor.test.ts` states: a hand-built row lets the
 * fold and the producers drift apart silently.
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
import { CONTEXT_ASSEMBLED_TOPIC, CONTEXT_ASSEMBLED_SCHEMA } from '../chatAssembly';
import {
  armProcedureRun,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from '../procedureCursor';
import {
  forgetProcedureStream,
  notifyProcedureState,
  procedureApprovalContext,
  setProcedureStreamSink,
  ProcedureStreamEvent,
} from '../procedureStream';
import { taskId as mintTaskId } from '../../../intelligence';
import type { ProcedureOutcome, Runbook, RunbookCheckpoint } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;
let emitted: Array<{ sessionId: string; event: ProcedureStreamEvent }>;
let t1: string;
let t2: string;
let t3: string;

/** The anchor runbook's checkpoints, as the registry loads them. */
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

const BODY = [
  '# Bulk plugin update',
  '',
  '## cp.approval — explicit, informed consent',
  '',
  'Proceed only on explicit approval of the presented plan.',
].join('\n');

function runbookFixture(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: 'rb.bulk-plugin-update',
    version: '1.0.0',
    capability: 'cap.bulk_plugin_update',
    strictness: 'strict',
    path: 'runbooks/bulk-plugin-update.md',
    hash: 'sha256:abc',
    canonicalBytes: 4096,
    checkpoints: CHECKPOINTS,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: BODY,
    canonicalText: `---\nid: rb.bulk-plugin-update\n---\n${BODY}`,
    frontmatter: { communication: ['the backup id(s) and verification status'] },
    ...overrides,
  };
}

function delivery(overrides: Partial<Extract<ProcedureOutcome, { status: 'delivered' }>> = {}) {
  const outcome: ProcedureOutcome = {
    status: 'delivered',
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    version: '1.0.0',
    hash: 'sha256:abc',
    strictness: 'strict',
    armedBy: 'predicate',
    assertFull: true,
    bodyDelivered: true,
    checkpoints: CHECKPOINTS.map((c) => ({ id: c.id, attest: c.attest, attested: false })),
    steps: [],
    tokens: 900,
    ...overrides,
  };
  return outcome;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-stream-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  forgetProcedureStream('s1');
  emitted = [];
  setProcedureStreamSink((sessionId, event) => emitted.push({ sessionId, event }));
  t1 = mintTaskId();
  t2 = mintTaskId();
  t3 = mintTaskId();
});

afterEach(() => {
  setProcedureStreamSink(null);
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- ledger fixtures, shaped exactly as WP-19's producers shape them --------

function emitManifest(taskId: string): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: taskId,
    payload: {
      task: taskId,
      retrieval: [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }],
    },
  });
}

function emitRationale(taskId: string, decision: 'approved' | 'denied'): string {
  return core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_local_operator', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: taskId,
    payload: { tool: 'bulk_plugin_update', decision, prompt: 'card text', source: 'approval-card' },
  }).id;
}

/** One irrelevant-but-real pair of ledger events: a read tool that attests nothing. */
function emitNoiseAction(taskId: string, tool: string): void {
  const action = core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: taskId,
    payload: { tool, tier: 1, dispatch: 'registry', targets: 1, targets_resolved: 1 },
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
    payload: { tool, result: 'success', result_scope: 'call' },
  });
}

function armRun(taskIds: string[]): void {
  armProcedureRun({
    sessionId: 's1',
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    runbookHash: 'sha256:abc',
  });
  for (const taskId of taskIds) registerProcedureTurn({ sessionId: 's1', taskId });
}

/** One assembled turn, as `assembleForChatTurn` calls the seam. */
function turn(taskId: string, runbook: Runbook = runbookFixture(), outcome = delivery()): void {
  notifyProcedureState({
    sessionId: 's1',
    outcome,
    runbook,
    run: runForTask(taskId),
    ledger: core.ledger,
  });
}

const types = () => emitted.map((e) => e.event.type);

// ---------------------------------------------------------------------------

describe('parity — nothing armed', () => {
  test('a turn with no procedure emits nothing at all', () => {
    notifyProcedureState({ sessionId: 's1', outcome: null });
    expect(emitted).toEqual([]);
  });

  test('a REFUSED capability emits nothing — a refusal is not a state transition of a running procedure', () => {
    notifyProcedureState({
      sessionId: 's1',
      outcome: {
        status: 'refused',
        capability: 'cap.bulk_plugin_update',
        code: 'hash-mismatch',
        runbookId: 'rb.bulk-plugin-update',
        reason: 'the document on disk is not the reviewed one',
        tokens: 40,
      },
    });
    expect(emitted).toEqual([]);
  });
});

describe('the armed event', () => {
  test('arming emits exactly one procedure_armed carrying the WHOLE declaration', () => {
    armRun([t1]);
    turn(t1);

    expect(types()).toEqual(['procedure_armed']);
    const event = emitted[0].event;
    if (event.type !== 'procedure_armed') throw new Error('wrong event');
    expect(emitted[0].sessionId).toBe('s1');
    expect(event.procedure.runbookId).toBe('rb.bulk-plugin-update');
    expect(event.procedure.version).toBe('1.0.0');
    expect(event.procedure.strictness).toBe('strict');
    // The whole rail, and the honest denominator with it: this is what makes a
    // historical run's verifiableCount self-contained in its own stream (v6 Q3).
    expect(event.procedure.checkpoints.map((c) => c.id)).toEqual(CHECKPOINTS.map((c) => c.id));
    expect(event.procedure.verifiableCount).toBe(4);
    expect(event.procedure.communication).toEqual(['the backup id(s) and verification status']);
  });

  test('a second turn of the SAME run does not re-announce the declaration', () => {
    armRun([t1]);
    turn(t1);
    emitted = [];
    armRun([t1, t2]);
    turn(t2);
    expect(types()).not.toContain('procedure_armed');
  });

  test('a DIFFERENT document is a different run and re-announces in full', () => {
    armRun([t1]);
    turn(t1);
    emitted = [];

    const edited = runbookFixture({ hash: 'sha256:def', version: '1.1.0' });
    armProcedureRun({
      sessionId: 's1',
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      runbookHash: 'sha256:def',
    });
    registerProcedureTurn({ sessionId: 's1', taskId: t2 });
    turn(t2, edited, delivery({ hash: 'sha256:def', version: '1.1.0' }));

    expect(types()).toEqual(['procedure_armed']);
  });
});

describe('coalescing — one event per checkpoint-state transition, never per ledger event', () => {
  test('six ledger events folding to ONE transition produce exactly ONE emission', () => {
    armRun([t1]);
    turn(t1); // the armed event
    emitted = [];

    // Six real ledger events. Exactly one of them moves a checkpoint state:
    // the manifest attests cp.consult-history (which also moves cp.approval
    // pending -> active, one transition of the same fold). The other five are
    // read tools that attest nothing. The seam is driven after EVERY one of
    // them, which is what a per-ledger-event emitter would fail against.
    const ledgerEvents = [
      () => emitNoiseAction(t1, 'nexus_list_sites'),
      () => emitNoiseAction(t1, 'get_site_health'),
      () => emitManifest(t1),
      () => emitNoiseAction(t1, 'search_site_content'),
      () => emitNoiseAction(t1, 'compare_sites'),
      () => emitNoiseAction(t1, 'detect_drift'),
    ];
    for (const write of ledgerEvents) {
      write();
      turn(t1);
    }

    expect(types()).toEqual(['checkpoint_changed']);
  });

  test('a turn with no new ledger events emits nothing', () => {
    armRun([t1]);
    turn(t1);
    emitted = [];
    turn(t1);
    turn(t1);
    expect(emitted).toEqual([]);
  });
});

describe('the changed event carries the diff, never the document', () => {
  test('only what changed rides, and no procedure body rides with it', () => {
    armRun([t1]);
    turn(t1);
    emitted = [];

    emitManifest(t1);
    turn(t1);

    const event = emitted[0].event;
    if (event.type !== 'checkpoint_changed') throw new Error('wrong event');
    expect(event.changed.length).toBeLessThan(CHECKPOINTS.length);
    expect(event.changed.map((c) => c.id).sort()).toEqual(['cp.approval', 'cp.consult-history']);
    // The declaration rides ONCE, at arm. A changed event that carried the
    // runbook would put the document on every turn — ADR-20's cadence inverted.
    expect(JSON.stringify(event)).not.toContain('Bulk plugin update');
    expect(JSON.stringify(event)).not.toContain('verifiableCount');
  });

  test('an attested checkpoint is attested, and the platform proved it', () => {
    armRun([t1]);
    turn(t1);
    emitted = [];
    emitManifest(t1);
    turn(t1);

    const event = emitted[0].event;
    if (event.type !== 'checkpoint_changed') throw new Error('wrong event');
    const consult = event.changed.find((c) => c.id === 'cp.consult-history')!;
    expect(consult.status).toBe('attested');
    expect(consult.verified).toBe(true);
  });
});

describe('the abort event', () => {
  test('a denial emits exactly one procedure_aborted, and repeats emit none', () => {
    armRun([t1]);
    emitManifest(t1);
    turn(t1);
    emitted = [];

    emitRationale(t1, 'denied');
    turn(t1);
    expect(types()).toEqual(['checkpoint_changed', 'procedure_aborted']);

    emitted = [];
    turn(t1);
    turn(t1);
    expect(emitted).toEqual([]);
  });

  test('the abort names the checkpoint it halted at and the ledger event that records it', () => {
    armRun([t1]);
    emitManifest(t1);
    turn(t1);
    emitted = [];

    const denialId = emitRationale(t1, 'denied');
    turn(t1);

    const event = emitted.find((e) => e.event.type === 'procedure_aborted')!.event;
    if (event.type !== 'procedure_aborted') throw new Error('wrong event');
    expect(event.checkpointId).toBe('cp.approval');
    // Openable, not invented: the abort id IS the record of the abort.
    expect(event.abortId).toBe(denialId);
    expect(event.reason).toContain('DENIED');
    expect(event.groups.headline).toContain('Stopping here changes none of them');
  });

  test('a healthy run emits no abort', () => {
    armRun([t1]);
    emitManifest(t1);
    turn(t1);
    emitRationale(t1, 'approved');
    turn(t1);
    expect(types()).not.toContain('procedure_aborted');
  });
});

describe('the approval context — what the card is allowed to render', () => {
  test('a strict run standing at the approval checkpoint offers the canary policy', () => {
    armRun([t1]);
    emitManifest(t1);
    turn(t1);

    const context = procedureApprovalContext('s1');
    expect(context).toEqual({
      runbookId: 'rb.bulk-plugin-update',
      version: '1.0.0',
      strictness: 'strict',
      checkpointId: 'cp.approval',
      offersCanaryPolicy: true,
    });
  });

  test('there is no context before the run reaches the approval checkpoint', () => {
    armRun([t1]);
    turn(t1); // no manifest yet: cp.consult-history is the active checkpoint
    expect(procedureApprovalContext('s1')).toBeNull();
  });

  test('there is no context once the approval is attested', () => {
    armRun([t1]);
    emitManifest(t1);
    emitRationale(t1, 'approved');
    turn(t1);
    expect(procedureApprovalContext('s1')).toBeNull();
  });

  test('a runbook that declares no canary offers no canary policy — nothing to pause after', () => {
    const noCanary = runbookFixture({
      checkpoints: CHECKPOINTS.filter((c) => c.id !== 'cp.canary'),
    });
    armRun([t1]);
    emitManifest(t1);
    turn(t1, noCanary, delivery({
      checkpoints: noCanary.checkpoints.map((c) => ({ id: c.id, attest: c.attest, attested: false })),
    }));

    expect(procedureApprovalContext('s1')?.offersCanaryPolicy).toBe(false);
  });

  test('a GUIDED runbook is never given a strict approval card', () => {
    // The card's whole frame is "this is a checkpoint of a strict runbook".
    // A guided runbook has steps, not checkpoints (ADR-17 am. 2), and nothing
    // sequences them — a card claiming otherwise would be describing a
    // ceremony the platform is not performing.
    armRun([t1]);
    emitManifest(t1);
    turn(t1, runbookFixture({ strictness: 'guided' }), delivery({ strictness: 'guided' }));

    expect(procedureApprovalContext('s1')).toBeNull();
  });

  test('nothing armed means no context', () => {
    expect(procedureApprovalContext('s1')).toBeNull();
  });
});

describe('non-fatal by construction', () => {
  test('a sink that throws never reaches the caller', () => {
    setProcedureStreamSink(() => {
      throw new Error('renderer gone');
    });
    armRun([t1]);
    expect(() => turn(t1)).not.toThrow();
  });

  test('a turn whose ledger cannot be read emits nothing rather than an empty rail', () => {
    armRun([t1, t3]);
    const exploding = {
      query: () => {
        throw new Error('ledger unreadable');
      },
    };
    notifyProcedureState({
      sessionId: 's1',
      outcome: delivery(),
      runbook: runbookFixture(),
      run: runForTask(t3)!,
      ledger: exploding as never,
    });
    expect(emitted).toEqual([]);
  });
});
