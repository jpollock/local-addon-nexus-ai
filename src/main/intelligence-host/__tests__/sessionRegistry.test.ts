/**
 * WP-30 · the session registry — derived from the ledger, re-derived on boot.
 *
 * Every fixture below is a REAL event through the real emitter into a real
 * ledger, shaped as the producers shape them, for `procedureCursor.test.ts`'s
 * reason: a fold tested against events its producers could never write proves
 * nothing about the producers.
 *
 * Three things this file is FOR, in order of weight:
 *
 *  1. **Re-fold on boot** (`promotion identity across re-entry`). The registry
 *     holds no state, so the test kills `procedureCursor`'s in-memory run map —
 *     the only place a session's turns have ever lived — and asks again. Session
 *     id, gate id and pending-approval state come back identical because none of
 *     them was ever in memory. This is J-Return's promotion-identity criterion
 *     and its "an approval that must be given a second time" must-not, driven.
 *
 *  2. **The golden fixture** — the designer's "one morning, both ways" (§2 of
 *     `from-designer-02-consequence-order.md`), adopted at the v1.3 ruling as the
 *     consequence order's regression pin. Eight live things in; two waiting
 *     situations, one reserved row and one changed row out. Future tears
 *     re-render the same morning.
 *
 *  3. The tier rules themselves, each pinned against the world state that earns
 *     it rather than against the item's kind (§4a tear 4).
 *
 * SHAPE #15 DISCIPLINE (PARALLEL_PROTOCOL): every case that depends on a
 * producer-written event asserts the EVENT EXISTS — a ledger count or an id
 * read-back — before asserting anything about what the fold made of it. A fold
 * over an empty ledger returns an empty snapshot quite happily, and every
 * `toEqual([])` in this file would pass against it.
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
import { INCIDENT_TOPIC, INCIDENT_SCHEMA, recordAbortIncidents } from '../incidentProducer';
import {
  armProcedureRun,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from '../procedureCursor';
import { provisionalEnvironmentId } from '../provisionalEntity';
import {
  createSessionRegistry,
  foldSessionRegistry,
  rankSituations,
  type RunbookLookup,
  type SessionRegistryDeps,
  type Situation,
} from '../sessionRegistry';
import type { IntelligenceHealthReport } from '../health';
import type { ScopePlace } from '../procedureScope';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook, RunbookCheckpoint } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;

/** A fixed clock, so every age in the golden fixture is arithmetic, not a race. */
const NOW = new Date('2026-08-19T08:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const MANIFEST_TOPIC = 'task.context.assembled';
const MANIFEST_SCHEMA = 'context.assembled/1';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-sessreg-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Runbooks — hand-built, shaped as the loader builds them
// ---------------------------------------------------------------------------

function runbook(overrides: Partial<Runbook> & Pick<Runbook, 'id' | 'capability' | 'hash' | 'checkpoints'>): Runbook {
  return {
    version: '1.0.0',
    strictness: 'strict',
    path: `runbooks/${overrides.id}.md`,
    canonicalBytes: 1024,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: '',
    canonicalText: '',
    frontmatter: {},
    ...overrides,
  };
}

const rationaleGate = (id: string): RunbookCheckpoint => ({
  id,
  attest: 'event',
  evidence: { topic: RATIONALE_RECORDED_TOPIC, decision: 'approved' },
  tools: [],
});
const actionGate = (id: string, tool: string): RunbookCheckpoint => ({
  id,
  attest: 'event',
  evidence: { topic: ACTION_EXECUTED_TOPIC, tool },
  tools: [{ name: tool }],
});
const manifestGate = (id: string): RunbookCheckpoint => ({
  id,
  attest: 'manifest',
  evidence: { topic: MANIFEST_TOPIC },
  tools: [],
});
const narrative = (id: string): RunbookCheckpoint => ({ id, attest: 'narrative', tools: [] });

/** The anchor's shape, with a gated VERIFY after the roll so a halt is expressible. */
const RB_BULK = runbook({
  id: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
  hash: 'sha256:bulk-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    narrative('cp.dry-run'),
    rationaleGate('cp.approval'),
    actionGate('cp.backup', 'wpe_backup_and_verify'),
    narrative('cp.canary'),
    actionGate('cp.roll-fleet', 'bulk_plugin_update'),
    actionGate('cp.verify', 'verify_site_live'),
    narrative('cp.report'),
  ],
});

/** The designer's morning names "approval gate 3 of 8 in remediate" — so it is 3 of 8. */
const RB_REMEDIATE = runbook({
  id: 'rb.remediate',
  capability: 'cap.incident_remediation',
  hash: 'sha256:remediate-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    actionGate('cp.canary', 'contain_site'),
    rationaleGate('cp.approval'),
    actionGate('cp.roll-fleet', 'remediate_site'),
    narrative('cp.verify'),
    narrative('cp.restore-check'),
    actionGate('cp.close-incident', 'close_incident'),
    narrative('cp.report'),
  ],
});

const RB_PURGE = runbook({
  id: 'rb.cache-purge',
  capability: 'cap.cache_purge',
  hash: 'sha256:purge-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    rationaleGate('cp.approval'),
    actionGate('cp.purge', 'wpe_purge_cache'),
  ],
});

function lookup(...books: Runbook[]): RunbookLookup {
  const byCapability = new Map(books.map((b) => [b.capability, b]));
  return { byCapability: (capability: string) => byCapability.get(capability) };
}

// ---------------------------------------------------------------------------
// Emitters — producer-shaped
// ---------------------------------------------------------------------------

interface ManifestProcedure {
  capability: string;
  runbook: string | null;
  hash: string | null;
  status: 'delivered' | 'refused';
}

function emitManifest(args: {
  taskId: string;
  observedAt: string;
  procedure: ManifestProcedure | null;
  /** A ledger retrieval row is what attests `cp.consult-history`. */
  consulted?: boolean;
}): string {
  return core.emitter.emit({
    observed_at: args.observedAt,
    topic: MANIFEST_TOPIC,
    schema: MANIFEST_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      task: args.taskId,
      procedure: args.procedure,
      retrieval: args.consulted
        ? [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }]
        : [],
    },
  }).id;
}

function emitRationale(args: {
  taskId: string;
  observedAt: string;
  decision: 'approved' | 'denied';
  checkpoint: string | null;
  tool?: string;
}): string {
  return core.emitter.emit({
    observed_at: args.observedAt,
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_local_operator', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: args.taskId,
    payload: {
      tool: args.tool ?? 'bulk_plugin_update',
      decision: args.decision,
      prompt: 'card text',
      source: 'approval-card',
      checkpoint: args.checkpoint,
    },
  }).id;
}

/** One gated act and its per-target outcomes, exactly as `recordGatedAction` writes them. */
function emitAct(args: {
  taskId: string;
  observedAt: string;
  tool: string;
  targets?: string[];
  result?: 'success' | 'failure';
}): { actionId: string; outcomeIds: string[] } {
  const targets = args.targets ?? [];
  const action = core.emitter.emit({
    observed_at: args.observedAt,
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: targets.length === 1 ? { environment: targets[0] } : {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      tool: args.tool,
      tier: 2,
      dispatch: 'registry',
      targets: targets.length,
      targets_resolved: targets.length,
    },
  });
  const outcomeIds = (targets.length ? targets : [undefined]).map((target) =>
    core.emitter.emit({
      observed_at: args.observedAt,
      topic: OUTCOME_RECORDED_TOPIC,
      schema: OUTCOME_RECORDED_SCHEMA,
      entity: target ? { environment: target } : {},
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: args.taskId,
      causation: action.id,
      payload: { tool: args.tool, result: args.result ?? 'success', result_scope: 'call' },
    }).id
  );
  return { actionId: action.id, outcomeIds };
}

/** An abort incident, shaped as `recordAbortIncidents` writes it (P2's `source`). */
function emitAbortIncident(args: {
  taskId: string;
  observedAt: string;
  target: string;
  abortId: string;
  symptom: string;
  causedBy: string;
  resolved?: boolean;
}): string {
  return core.emitter.emit({
    observed_at: args.observedAt,
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    entity: { environment: args.target },
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'procedure:abort', trust: 'emitted' },
    correlation: args.taskId,
    causation: args.causedBy,
    payload: {
      fact: args.abortId,
      symptom: args.symptom,
      resolved: args.resolved ?? false,
      source: `abort:${args.taskId}/${args.abortId}`,
    },
  }).id;
}

// ---------------------------------------------------------------------------
// Places and health
// ---------------------------------------------------------------------------

const CHARLIE_1 = provisionalEnvironmentId('charlie-1');
const CHARLIE_2 = provisionalEnvironmentId('charlie-2');
const BRAVO = provisionalEnvironmentId('bravo');
const LOCAL_COPY = provisionalEnvironmentId('local-copy');

const PLACES: Record<string, ScopePlace> = {
  [CHARLIE_1]: { host: 'wpe', kind: 'production' },
  [CHARLIE_2]: { host: 'wpe', kind: 'production' },
  [BRAVO]: { host: 'wpe', kind: 'production' },
  [LOCAL_COPY]: { host: 'local' },
};
const describePlace = (id: string): ScopePlace | undefined => PLACES[id];

function healthReport(args: {
  dark?: string[];
  stale?: number;
  errors?: string[];
}): IntelligenceHealthReport {
  const lines = [
    ...(args.dark ?? []).map((system) => ({
      key: `producer:${system}`,
      label: system,
      value: 'no events',
      threshold: '6h',
      verdict: 'DARK' as const,
    })),
    ...Array.from({ length: args.stale ?? 0 }, (_, i) => ({
      key: `producer:stale-${i}`,
      label: `stale-${i}`,
      value: 'late',
      threshold: '6h',
      verdict: 'STALE' as const,
    })),
    // A source that was never in use here — health's own `countsTowardWorst`
    // carve-out. It must never reach the reserved row.
    {
      key: 'producer:capi',
      label: 'WP Engine CAPI',
      value: 'no events',
      threshold: '24h',
      verdict: 'DARK' as const,
      countsTowardWorst: false,
    },
  ];
  return {
    checkedAt: NOW.toISOString(),
    coreUp: true,
    worst: (args.dark ?? []).length > 0 ? 'DARK' : (args.stale ?? 0) > 0 ? 'STALE' : 'OK',
    lines,
    errors: args.errors ?? [],
  };
}

/** Standard deps: the fixed clock, the real describer, a quiet health report. */
function deps(overrides: SessionRegistryDeps = {}): SessionRegistryDeps {
  return {
    core,
    now: NOW,
    describePlace,
    health: healthReport({}),
    ...overrides,
  };
}

/** Shape #15: prove the events exist before believing anything folded from them. */
function ledgerCount(topicPrefix: string): number {
  return core.ledger.query({ topicPrefix, limit: 1000 }).length;
}

// ===========================================================================

describe('sessions, derived from the ledger alone', () => {
  test('a delivered, hash-pinned manifest opens a session whose id is derived from its first turn', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].id).toBe(`sess_${t1}`);
    // The whole "correlation is per-TURN, the run is not" finding, one level up.
    expect(snapshot.sessions[0].taskIds).toEqual([t1, t2]);
  });

  test('a different document hash is a different session — an edited runbook is not the same run', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: 'sha256:bulk-1', status: 'delivered' },
    });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: 'sha256:bulk-EDITED', status: 'delivered' },
    });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions.map((s) => s.runbookHash).sort()).toEqual([
      'sha256:bulk-1',
      'sha256:bulk-EDITED',
    ]);
  });

  test('a REFUSED delivery is not a turn of the run — the document did not ride', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: null, status: 'refused' },
    });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].taskIds).toEqual([t1]);
  });

  /**
   * BATTERY SURVIVOR M03, and the gap it exposed was in the PIN, not the code.
   *
   * The case above emits a refusal the way the assembler emits one today —
   * `status: 'refused'` AND `hash: null`, because nothing rode. So it was
   * caught by the hash guard, and mutating the STATUS guard away changed
   * nothing that any test could see. Two independent guards on two independent
   * fields, and only one of them was pinned.
   *
   * The status guard is what holds if `BundleManifest.procedure`'s "null when
   * none did" convention ever drifts — a refusal that still names the document
   * it refused would otherwise be recorded as a turn the actor followed.
   */
  test('a refusal that still names its document is STILL not a turn — the status guard, alone', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(1),
      // The drift case: refused, and carrying a hash anyway. The hash guard
      // cannot see this one; only `status !== 'delivered'` can.
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'refused' },
    });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].taskIds).toEqual([t1]);
  });

  /**
   * FOUND BY THE EVAL, not by this file — and it lost a waiting row.
   *
   * The eval report's own ledger holds a denied run and a freshly-armed run at
   * the same capability and the same document hash. Without a cut at the
   * denial the two folded into ONE session: the fresh run inherited the
   * denial, reported `halted`, and its pending consent gate disappeared out of
   * the waiting column. A triage that loses a row that needs you is the worst
   * failure this fold has, and two chats doing ordinary things reach it.
   */
  test('a DENIED run is terminal — a later turn at the same key is a NEW session, not a continuation', () => {
    const denied = mintTaskId();
    const fresh = mintTaskId();
    const book = RB_REMEDIATE;
    const procedure = { capability: book.capability, runbook: book.id, hash: book.hash, status: 'delivered' as const };

    emitManifest({ taskId: denied, observedAt: hoursAgo(8), procedure, consulted: true });
    emitAct({ taskId: denied, observedAt: hoursAgo(8), tool: 'contain_site', targets: [BRAVO] });
    emitRationale({ taskId: denied, observedAt: hoursAgo(8), decision: 'denied', checkpoint: 'cp.approval' });

    emitManifest({ taskId: fresh, observedAt: hoursAgo(2), procedure, consulted: true });
    emitAct({ taskId: fresh, observedAt: hoursAgo(2), tool: 'contain_site', targets: [CHARLIE_1] });

    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(1); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(book) }));

    expect(snapshot.sessions).toHaveLength(2);
    const [first, second] = snapshot.sessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    expect(first.taskIds).toEqual([denied]);
    expect(first.status).toBe('halted');
    // The row that would have vanished: a fresh run, standing at its own gate,
    // carrying no decision from a run it has nothing to do with.
    expect(second.taskIds).toEqual([fresh]);
    expect(second.status).toBe('waiting');
    expect(second.gate?.checkpointId).toBe('cp.approval');
    expect(second.approvals).toEqual([{ checkpointId: 'cp.approval', state: 'pending' }]);
  });

  test('a COMPLETE run is terminal too — the next turn at the same key starts fresh', () => {
    const done = mintTaskId();
    const next = mintTaskId();
    const procedure = { capability: RB_PURGE.capability, runbook: RB_PURGE.id, hash: RB_PURGE.hash, status: 'delivered' as const };

    emitManifest({ taskId: done, observedAt: hoursAgo(9), procedure, consulted: true });
    emitRationale({ taskId: done, observedAt: hoursAgo(9), decision: 'approved', checkpoint: 'cp.approval', tool: 'wpe_purge_cache' });
    emitAct({ taskId: done, observedAt: hoursAgo(9), tool: 'wpe_purge_cache', targets: [CHARLIE_1] });

    emitManifest({ taskId: next, observedAt: hoursAgo(1), procedure, consulted: true });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_PURGE) }));
    expect(snapshot.sessions).toHaveLength(2);
    const statuses = snapshot.sessions.map((s) => s.status).sort();
    expect(statuses).toEqual(['complete', 'waiting']);
  });

  test('an ABORT is NOT terminal — a retry belongs to the run it is retrying', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    const procedure = { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' as const };

    emitManifest({ taskId: t1, observedAt: hoursAgo(6), procedure, consulted: true });
    const failed = emitAct({
      taskId: t1,
      observedAt: hoursAgo(6),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });
    emitAbortIncident({
      taskId: t1,
      observedAt: hoursAgo(6),
      target: CHARLIE_1,
      abortId: 'ab.verify-failed',
      symptom: 'checkout returned 500',
      causedBy: failed.outcomeIds[0],
    });
    emitManifest({ taskId: t2, observedAt: hoursAgo(5), procedure });

    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1);

    // One session, two turns. `recordAbortIncidents` closes its own incident
    // when a retry succeeds, and that only means anything if the retry is the
    // same run — so a halt must not cut where a denial does.
    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].taskIds).toEqual([t1, t2]);
  });

  test('a turn with no procedure opens no session at all', () => {
    const t1 = mintTaskId();
    emitManifest({ taskId: t1, observedAt: hoursAgo(1), procedure: null });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(1);
    expect(foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions).toEqual([]);
  });

  test('a run pinned to a document the registry does not hold is reported, not folded against the wrong text', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: 'sha256:gone', status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: t1, observedAt: hoursAgo(1), decision: 'approved', checkpoint: 'cp.approval' });

    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(1); // shape #15

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions;
    expect(session.documentUnavailable).toBe(true);
    // No gate and no approvals invented from a document that is not this run's.
    expect(session.gate).toBeUndefined();
    expect(session.approvals).toEqual([]);
  });
});

// ===========================================================================

describe('the gate — WHERE you are needed, by id (J-Return key step)', () => {
  /** Charlie's run, up to the point the verify fails. Returns its turn ids. */
  function armBulkRun(): { t1: string; t2: string } {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(14),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: t1, observedAt: hoursAgo(14), decision: 'approved', checkpoint: 'cp.approval' });
    emitAct({ taskId: t1, observedAt: hoursAgo(14), tool: 'wpe_backup_and_verify', targets: [CHARLIE_1] });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(13),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    });
    return { t1, t2 };
  }

  test('names the pending checkpoint by id, with its position in the declared list', () => {
    const { t2 } = armBulkRun();
    emitAct({
      taskId: t2,
      observedAt: hoursAgo(13),
      tool: 'bulk_plugin_update',
      targets: [CHARLIE_1, CHARLIE_2],
    });

    expect(ledgerCount(ACTION_EXECUTED_TOPIC)).toBe(2); // shape #15

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions;
    expect(session.gate).toEqual({
      checkpointId: 'cp.verify',
      index: 7,
      of: 8,
      awaits: 'evidence',
      runbookId: 'rb.bulk-plugin-update',
      capability: 'cap.bulk_plugin_update',
    });
  });

  test('a consent gate reports `awaits: approval` — the row knows WHAT it needs, not just where', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(3),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: hoursAgo(3), tool: 'contain_site', targets: [BRAVO] });

    expect(ledgerCount(ACTION_EXECUTED_TOPIC)).toBe(1);

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).sessions;
    expect(session.gate).toMatchObject({ checkpointId: 'cp.approval', index: 3, of: 8, awaits: 'approval' });
    expect(session.status).toBe('waiting');
  });

  test('the situation carries the gate, and the gate is NOT one of its parts', () => {
    armBulkRun();
    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    const [situation] = snapshot.situations;
    // `armBulkRun` attests the backup, so the run's next gate is the roll.
    expect(situation.gate?.checkpointId).toBe('cp.roll-fleet');
    expect(situation.parts.map((p) => p.kind)).not.toContain('gate');
  });
});

// ===========================================================================

describe('promotion identity across re-entry — the re-fold, WP-30\'s acceptance criterion', () => {
  /**
   * The excursion, simulated the only way that means anything: the in-memory run
   * map is the ONE place a session's turns have ever lived, so emptying it is
   * exactly what a process restart does. If the registry consulted it, the
   * second read would come back empty; it comes back identical.
   */
  test('session id, gate id and the given approval all survive the in-memory state being killed', () => {
    const t1 = mintTaskId();
    const t2 = mintTaskId();
    const sessionId = 'chat-session-1';

    // Warm host memory exactly as `chatAssembly.withCursor` does.
    armProcedureRun({
      sessionId,
      capability: RB_REMEDIATE.capability,
      runbookId: RB_REMEDIATE.id,
      runbookHash: RB_REMEDIATE.hash,
    });
    registerProcedureTurn({ sessionId, taskId: t1 });
    registerProcedureTurn({ sessionId, taskId: t2 });
    expect(runForTask(t2)).toBeDefined(); // the premise: memory IS warm

    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(5),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: hoursAgo(5), tool: 'contain_site', targets: [BRAVO] });
    const approvalId = emitRationale({
      taskId: t1,
      observedAt: hoursAgo(5),
      decision: 'approved',
      checkpoint: 'cp.approval',
    });
    emitManifest({
      taskId: t2,
      observedAt: hoursAgo(4),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
    });

    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(1); // shape #15
    expect(core.ledger.get(approvalId)).toBeDefined();

    const registry = createSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) }));
    const before = registry.snapshot();
    expect(before.sessions).toHaveLength(1);
    expect(before.sessions[0].approvals).toEqual([
      { checkpointId: 'cp.approval', state: 'approved', eventId: approvalId, decidedAt: hoursAgo(5) },
    ]);

    // --- the excursion: everything host memory knew is gone -----------------
    forgetProcedureRun(sessionId);
    expect(runForTask(t2)).toBeUndefined();

    const after = registry.snapshot();

    // The three pins the §1 adjudication routed to this packet, in one place.
    expect(after.sessions[0].id).toBe(before.sessions[0].id);
    expect(after.sessions[0].gate).toEqual(before.sessions[0].gate);
    expect(after.sessions[0].approvals).toEqual(before.sessions[0].approvals);
    // And nothing else moved either — a whole-row equality, so a field added
    // later cannot quietly become the one that fails to re-derive.
    expect(after.sessions).toEqual(before.sessions);
  });

  test('an approval given before the excursion is never re-asked after it (J-Return must-not)', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(6),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: hoursAgo(6), tool: 'contain_site', targets: [BRAVO] });
    emitRationale({ taskId: t1, observedAt: hoursAgo(6), decision: 'approved', checkpoint: 'cp.approval' });

    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(1);

    const registry = createSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) }));
    const [session] = registry.sessions();

    // The gate moved PAST the approval: it is not what the run is waiting on.
    expect(session.approvals).toEqual([
      {
        checkpointId: 'cp.approval',
        state: 'approved',
        eventId: expect.any(String),
        decidedAt: hoursAgo(6),
      },
    ]);
    expect(session.gate?.checkpointId).not.toBe('cp.approval');
    expect(session.gate?.awaits).toBe('evidence');
  });

  /**
   * The designer's THREE query-contract requirements (from-designer-09,
   * "What I need from WP-30's query contract"), adopted into this gate-held
   * contract at the cycle-five adjudication and pinned here one by one.
   *
   * Requirement 3 — rank per SITUATION with coalesced parts and the placing
   * rule — is pinned by the golden fixture and by the coalescing describe, so
   * it is not repeated here.
   */
  test('contract requirement 1 — the gate resolves to a CHECKPOINT ID, and the attested set rides with it', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(5),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: hoursAgo(5), tool: 'contain_site', targets: [BRAVO] });

    expect(ledgerCount(ACTION_EXECUTED_TOPIC)).toBe(1); // shape #15

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).sessions;

    // "not to a run and an offset" — a checkpoint id the document declares.
    expect(session.gate?.checkpointId).toBe('cp.approval');
    expect(RB_REMEDIATE.checkpoints.map((c) => c.id)).toContain(session.gate?.checkpointId);

    // The stronger half: which checkpoints the record attested BEFORE the
    // excursion, so a resumed declaration renders marks from the record rather
    // than from the cursor's position. XD-26's marks discipline needs the
    // difference — the tick belongs to an attested PROVABLE checkpoint, and a
    // reached narrative one takes the neutral dot, which a position cannot tell
    // apart.
    expect(session.checkpoints).toHaveLength(RB_REMEDIATE.checkpoints.length);
    const byId = Object.fromEntries((session.checkpoints ?? []).map((c) => [c.id, c]));
    expect(byId['cp.consult-history']).toMatchObject({ status: 'attested', verified: true });
    expect(byId['cp.canary']).toMatchObject({ status: 'attested', verified: true });
    expect(byId['cp.approval']).toMatchObject({ status: 'active', verified: false });
    // A narrative step is never `verified`, whatever else it is.
    expect(byId['cp.verify']).toMatchObject({ attest: 'narrative', verified: false });
  });

  test('contract requirement 2 — approvals are a SET of {checkpoint, decision, moment}, not a count', () => {
    const t1 = mintTaskId();
    const approvedAt = hoursAgo(5);
    emitManifest({
      taskId: t1,
      observedAt: approvedAt,
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: approvedAt, tool: 'contain_site', targets: [BRAVO] });
    const eventId = emitRationale({
      taskId: t1,
      observedAt: approvedAt,
      decision: 'approved',
      checkpoint: 'cp.approval',
    });

    expect(core.ledger.get(eventId)).toBeDefined(); // shape #15

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).sessions;

    // The three fields XD-26's standing-approval block is written from:
    // "You approved this plan yesterday at 12:11. That approval still stands."
    expect(session.approvals).toEqual([
      { checkpointId: 'cp.approval', state: 'approved', eventId, decidedAt: approvedAt },
    ]);
    // And the moment is the RECORD's, not this fold's clock.
    expect(session.approvals[0].decidedAt).toBe(core.ledger.get(eventId)!.observed_at);
  });

  test('a documentUnavailable session reports no declared list rather than an empty one', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: 'sha256:gone', status: 'delivered' },
      consulted: true,
    });

    expect(ledgerCount(MANIFEST_TOPIC)).toBe(1);

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions;
    // An empty array claims a document with no checkpoints; absence says the
    // document is not here. XD-26's 6c is written on that distinction.
    expect(session.documentUnavailable).toBe(true);
    expect(session.checkpoints).toBeUndefined();
  });

  test('a DENIED approval is not a pending one — the decision exists and it was no', () => {
    const t1 = mintTaskId();
    emitManifest({
      taskId: t1,
      observedAt: hoursAgo(6),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: t1, observedAt: hoursAgo(6), tool: 'contain_site', targets: [BRAVO] });
    emitRationale({ taskId: t1, observedAt: hoursAgo(6), decision: 'denied', checkpoint: 'cp.approval' });

    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(1);

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).sessions;
    expect(session.approvals[0].state).toBe('denied');
    expect(session.status).toBe('halted');
  });
});

// ===========================================================================

describe('the consequence order (moments-model 1.3 §4a)', () => {
  /** A waiting run at `capability`, with or without a landed write. */
  function waitingRun(book: Runbook, opts: { write?: boolean; at: number; target: string }): string {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(opts.at),
      procedure: { capability: book.capability, runbook: book.id, hash: book.hash, status: 'delivered' },
      consulted: true,
    });
    if (opts.write) {
      emitAct({
        taskId: t,
        observedAt: hoursAgo(opts.at),
        tool: book === RB_REMEDIATE ? 'contain_site' : 'wpe_backup_and_verify',
        targets: [opts.target],
      });
    }
    return t;
  }

  test('a gate with a landed write is T1 — classified by the world behind it, not by its kind', () => {
    waitingRun(RB_REMEDIATE, { write: true, at: 3, target: BRAVO });
    expect(ledgerCount(OUTCOME_RECORDED_TOPIC)).toBe(1);

    const [situation] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).situations;
    expect(situation.tier).toBe(1);
    expect(situation.tierReason).toContain('a write has landed in scope');
  });

  test('the same gate with NOTHING written is T2 — the untouched world keeps', () => {
    waitingRun(RB_REMEDIATE, { write: false, at: 3, target: BRAVO });
    expect(ledgerCount(MANIFEST_TOPIC)).toBe(1);

    const [situation] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).situations;
    expect(situation.tier).toBe(2);
    expect(situation.tierReason).toContain('nothing has been written in scope');
  });

  test('a HALT with nothing written is T2 too — tear 4\'s rule generalised past gates', () => {
    const t = waitingRun(RB_BULK, { write: false, at: 9, target: CHARLIE_1 });
    const { outcomeIds } = emitAct({
      taskId: t,
      observedAt: hoursAgo(9),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });
    emitAbortIncident({
      taskId: t,
      observedAt: hoursAgo(9),
      target: CHARLIE_1,
      abortId: 'ab.verify-failed',
      symptom: 'checkout returned 500',
      causedBy: outcomeIds[0],
    });

    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions[0].status).toBe('halted');
    // The halt is real and it is still T2: nothing succeeded, so nothing is
    // half-done. Calling it T1 because "halt" sounds urgent is the exact error
    // tear 4 names, with a different noun.
    expect(snapshot.situations[0].tier).toBe(2);
  });

  test('a derivable deadline reaches T1 with no write at all — §4a\'s second arm', () => {
    waitingRun(RB_REMEDIATE, { write: false, at: 1, target: BRAVO });

    const withDeadline = foldSessionRegistry(
      deps({
        runbooks: lookup(RB_REMEDIATE),
        deadlineFor: () => ({ at: hoursAgo(-1), from: 'dry-run staleness clock' }),
      })
    );
    expect(withDeadline.situations[0].tier).toBe(1);
    expect(withDeadline.situations[0].tierReason).toContain('derivable deadline');

    // And the absence is stated rather than implied: no producer supplies one.
    expect(withDeadline.deadlineSource).toContain('no producer records a dry-run staleness clock');
  });

  test('a complete run is T4 and lands in the CHANGED column, never in waiting', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(5),
      procedure: { capability: RB_PURGE.capability, runbook: RB_PURGE.id, hash: RB_PURGE.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: t, observedAt: hoursAgo(5), decision: 'approved', checkpoint: 'cp.approval', tool: 'wpe_purge_cache' });
    emitAct({ taskId: t, observedAt: hoursAgo(5), tool: 'wpe_purge_cache', targets: [CHARLIE_1] });

    expect(ledgerCount(ACTION_EXECUTED_TOPIC)).toBe(1);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_PURGE) }));
    expect(snapshot.sessions[0].status).toBe('complete');
    expect(snapshot.situations[0].column).toBe('changed');
    expect(snapshot.situations[0].tier).toBe(4);
  });

  test('within a tier, the place SET orders before age, and both are derived', () => {
    // Two T1 situations: one on production and younger, one local and older.
    // Place must win, which is the half of the rule age alone would get wrong.
    const local = waitingRun(RB_BULK, { write: true, at: 20, target: LOCAL_COPY });
    void local;
    waitingRun(RB_REMEDIATE, { write: true, at: 2, target: BRAVO });

    const situations = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK, RB_REMEDIATE) })).situations;
    expect(situations.map((s) => s.tier)).toEqual([1, 1]);
    expect(situations[0].places.highest).toBe('wpe_production');
    expect(situations[1].places.highest).toBe('local');
  });

  test('place is a SET, and the rendered fact comes from the numbers the sort used', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitAct({
      taskId: t,
      observedAt: hoursAgo(2),
      tool: 'wpe_backup_and_verify',
      targets: [CHARLIE_1, CHARLIE_2, LOCAL_COPY],
    });

    expect(ledgerCount(OUTCOME_RECORDED_TOPIC)).toBe(3);

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions;
    expect(session.places).toMatchObject({
      tokens: ['wpe_production', 'local'],
      highest: 'wpe_production',
      atHighest: 2,
      total: 3,
      unresolved: 0,
      summary: 'touches production on 2 of 3',
    });
  });

  test('a place nothing on record names is UNRESOLVED, never guessed', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitAct({
      taskId: t,
      observedAt: hoursAgo(2),
      tool: 'wpe_backup_and_verify',
      targets: [provisionalEnvironmentId('unknown-site')],
    });

    const [session] = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) })).sessions;
    expect(session.places.highest).toBeNull();
    expect(session.places.unresolved).toBe(1);
    expect(session.places.summary).toContain('nothing on record names where');
  });

  test('T5 has no channel into the fold: there is no tier 3 and no drift row anywhere', () => {
    waitingRun(RB_REMEDIATE, { write: true, at: 3, target: BRAVO });
    const snapshot = foldSessionRegistry(
      // 41 facts past their SLO would arrive, if anywhere, as staleness. The
      // reserved row COUNTS them; nothing turns one into a row.
      deps({ runbooks: lookup(RB_REMEDIATE), health: healthReport({ stale: 41 }) })
    );
    expect(snapshot.situations.map((s) => s.tier)).not.toContain(3);
    expect(snapshot.reserved.staleCount).toBe(41);
    expect(snapshot.situations).toHaveLength(1); // still one row, not forty-two
  });

  test('rankSituations is one comparator, and the columns are a filter over it', () => {
    const base: Omit<Situation, 'id' | 'tier' | 'since' | 'places'> = {
      kind: 'session',
      column: 'waiting',
      tierReason: 'x',
      lastEventId: 'evt_0',
      parts: [],
      // WP-48's composed fields. The comparator reads none of them — tier,
      // place and age are its whole key — so they are present here only to
      // satisfy the shape, and their values are deliberately inert.
      headline: 'h',
      ask: '',
      chip: '',
      state: '',
      meta: '',
      headlineTemplate: null,
      written: { done: 0, failed: 0, total: 1 },
    };
    const place = (highest: string | null) => ({
      tokens: highest ? [highest] : [],
      highest,
      atHighest: highest ? 1 : 0,
      total: 1,
      unresolved: highest ? 0 : 1,
      summary: 's',
    });
    const ordered = rankSituations([
      { ...base, id: 'd', tier: 2, since: '2026-01-01T00:00:00.000Z', places: place('wpe_production') },
      { ...base, id: 'c', tier: 1, since: '2026-01-02T00:00:00.000Z', places: place('local') },
      { ...base, id: 'b', tier: 1, since: '2026-01-03T00:00:00.000Z', places: place('wpe_production') },
      { ...base, id: 'a', tier: 1, since: '2026-01-01T00:00:00.000Z', places: place('wpe_production') },
    ]);
    // tier, then place, then age oldest-first.
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ===========================================================================

describe('situations — causal coalescing from the record\'s own links (tear 2)', () => {
  test('a halt, its failing outcome and the incident it opened are ONE row with three parts', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(14),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: t, observedAt: hoursAgo(14), decision: 'approved', checkpoint: 'cp.approval' });
    emitAct({ taskId: t, observedAt: hoursAgo(14), tool: 'wpe_backup_and_verify', targets: [CHARLIE_1] });
    emitAct({ taskId: t, observedAt: hoursAgo(14), tool: 'bulk_plugin_update', targets: [CHARLIE_1, CHARLIE_2] });
    const { outcomeIds } = emitAct({
      taskId: t,
      observedAt: hoursAgo(14),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });
    const incidentId = emitAbortIncident({
      taskId: t,
      observedAt: hoursAgo(13),
      target: CHARLIE_1,
      abortId: 'ab.verify-failed',
      symptom: 'checkout returned 500',
      causedBy: outcomeIds[0],
    });

    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.situations).toHaveLength(1);
    const [situation] = snapshot.situations;
    expect(situation.kind).toBe('session');
    expect(situation.parts.map((p) => p.kind)).toEqual(['run', 'outcome', 'incident']);
    expect(situation.parts[2].eventId).toBe(incidentId);
    // The verdict about the WHOLE, which none of the three parts states alone.
    expect(situation.tier).toBe(1);
    expect(situation.parts[0].summary).toContain('halted');
  });

  test('an incident linked to no run is its own situation of one', () => {
    core.emitter.emit({
      observed_at: hoursAgo(7),
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { environment: CHARLIE_1 },
      actor: { id: 'act_agent_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
      payload: { fact: 'vulnerable-plugin', symptom: 'known CVE', resolved: false, source: 'sentinel:r1' },
    });

    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.situations).toHaveLength(1);
    expect(snapshot.situations[0].kind).toBe('incident');
    expect(snapshot.situations[0].column).toBe('waiting');
  });

  test('an incident the record CLOSED does not hold the run halted', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(4),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    const { outcomeIds } = emitAct({
      taskId: t,
      observedAt: hoursAgo(4),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });
    emitAbortIncident({
      taskId: t,
      observedAt: hoursAgo(4),
      target: CHARLIE_1,
      abortId: 'ab.verify-failed',
      symptom: 'checkout returned 500',
      causedBy: outcomeIds[0],
      resolved: true,
    });

    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_BULK) }));
    expect(snapshot.sessions[0].status).not.toBe('halted');
  });

  test('the REAL abort producer\'s incident is the one the registry reads', () => {
    // The fixtures above hand-shape an incident payload. This case drives
    // `recordAbortIncidents` itself, so the registry is pinned against the
    // producer rather than against this file's copy of its shape.
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(4),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitAct({
      taskId: t,
      observedAt: hoursAgo(4),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });

    const withAborts = runbook({
      ...RB_BULK,
      // `abortForTool` resolves tool → the checkpoints declaring it → the abort
      // whose `on:` NAMES one of them, so the clause must mention `cp.verify`.
      frontmatter: { aborts: [{ id: 'ab.verify-failed', on: 'cp.verify failure' }] },
    });
    const written = recordAbortIncidents({
      run: {
        sessionId: 's',
        capability: withAborts.capability,
        runbookId: withAborts.id,
        runbookHash: withAborts.hash,
        taskIds: [t],
      },
      runbook: withAborts,
      ledger: core.ledger,
      core,
    });

    // Shape #15, exactly: the producer is non-fatal, so prove it WROTE before
    // believing anything the registry says about what it wrote.
    expect(written).toBe(1);
    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1);

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(withAborts) }));
    expect(snapshot.sessions[0].status).toBe('halted');
    expect(snapshot.situations[0].parts.some((p) => p.kind === 'incident')).toBe(true);
  });
});

// ===========================================================================

describe('the reserved slot — one folded row, and it cannot grow (tear 3)', () => {
  test('twelve dark producers are ONE row saying twelve', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `producer-${i}`);
    const snapshot = foldSessionRegistry(deps({ health: healthReport({ dark: twelve }) }));

    expect(snapshot.reserved.dark).toHaveLength(12);
    expect(snapshot.reserved.headline).toBe('the record is going blind — 12 producers dark');
    // The enforcement: `reserved` is one object, and no situation was created
    // for any of them. Twelve dark producers evicting twelve operational rows
    // is the exact failure tear 3 describes.
    expect(snapshot.situations).toEqual([]);
  });

  test('a source that was never in use here is not "going blind"', () => {
    // `healthReport` always plants one `countsTowardWorst: false` CAPI line.
    const snapshot = foldSessionRegistry(deps({ health: healthReport({}) }));
    expect(snapshot.reserved.dark).toEqual([]);
    expect(snapshot.reserved.headline).toBe('the record is reporting — nothing dark, nothing late');
  });

  test('the reserved row is rendered even when nothing is wrong — it is structure, not rank', () => {
    const snapshot = foldSessionRegistry(deps({}));
    expect(snapshot.reserved).toBeDefined();
    expect(snapshot.reserved.headline).toEqual(expect.any(String));
    expect(createSessionRegistry(deps({})).triage().reserved).toEqual(snapshot.reserved);
  });

  /**
   * BATTERY SURVIVOR M20 — again a gap in the pin rather than in the code.
   *
   * Every reserved-slot case above supplied DARK producers or none, so
   * widening the dark filter to "anything not OK" changed no assertion. DARK
   * and STALE are different sentences: one says a source stopped, the other
   * says it is behind. Promoting the second into the first overstates the one
   * line a user is guaranteed to see, which is the line that has to be worth
   * reading or the reserved slot is furniture.
   */
  test('reporting LATE is not going BLIND — a stale producer never enters the dark set', () => {
    const snapshot = foldSessionRegistry(deps({ health: healthReport({ stale: 3 }) }));

    expect(snapshot.reserved.dark).toEqual([]);
    expect(snapshot.reserved.staleCount).toBe(3);
    expect(snapshot.reserved.headline).toBe('the record is reporting late — 3 source(s) behind their SLO');
    expect(snapshot.reserved.headline).not.toContain('blind');
  });

  test('dark and late are counted separately when both are true', () => {
    const snapshot = foldSessionRegistry(
      deps({ health: healthReport({ dark: ['plugin-inventory'], stale: 2 }) })
    );
    expect(snapshot.reserved.dark).toHaveLength(1);
    expect(snapshot.reserved.staleCount).toBe(2);
    expect(snapshot.reserved.headline).toBe(
      'the record is going blind — 1 producer dark, 2 more reporting late'
    );
  });

  test('a health check that could not measure says so rather than reporting all-clear', () => {
    const snapshot = foldSessionRegistry(deps({ health: healthReport({ errors: ['ledger unreadable'] }) }));
    expect(snapshot.reserved.degraded).toBe(true);
  });
});

// ===========================================================================

describe('the query surface', () => {
  function seedTwo(): void {
    const halted = mintTaskId();
    emitManifest({
      taskId: halted,
      observedAt: hoursAgo(14),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitAct({ taskId: halted, observedAt: hoursAgo(14), tool: 'bulk_plugin_update', targets: [CHARLIE_1] });

    const done = mintTaskId();
    emitManifest({
      taskId: done,
      observedAt: hoursAgo(5),
      procedure: { capability: RB_PURGE.capability, runbook: RB_PURGE.id, hash: RB_PURGE.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: done, observedAt: hoursAgo(5), decision: 'approved', checkpoint: 'cp.approval', tool: 'wpe_purge_cache' });
    emitAct({ taskId: done, observedAt: hoursAgo(5), tool: 'wpe_purge_cache', targets: [CHARLIE_2] });
  }

  test('triage splits the one ranked list into two columns and the reserved slot', () => {
    seedTwo();
    expect(ledgerCount(MANIFEST_TOPIC)).toBe(2);

    const triage = createSessionRegistry(deps({ runbooks: lookup(RB_BULK, RB_PURGE) })).triage();
    expect(triage.waiting).toHaveLength(1);
    expect(triage.changed).toHaveLength(1);
    expect(triage.reserved).toBeDefined();
    expect(triage.cursor).toMatch(/^evt_/);
  });

  test('session(id) resolves the same row sessions() lists', () => {
    seedTwo();
    const registry = createSessionRegistry(deps({ runbooks: lookup(RB_BULK, RB_PURGE) }));
    const [first] = registry.sessions();
    expect(registry.session(first.id)).toEqual(first);
    expect(registry.session('sess_nobody')).toBeUndefined();
  });

  test('changedSince returns only what moved, and everything when given no cursor', () => {
    seedTwo();
    const registry = createSessionRegistry(deps({ runbooks: lookup(RB_BULK, RB_PURGE) }));

    const all = registry.changedSince();
    expect(all.sessions).toHaveLength(2);
    expect(all.cursorUnknown).toBe(false);

    const nothingNew = registry.changedSince(all.cursor);
    expect(nothingNew.sessions).toEqual([]);
    expect(nothingNew.situations).toEqual([]);

    // A new turn on the halted run moves exactly one row past the cursor.
    const [waiting] = registry.sessions().filter((s) => s.capability === RB_BULK.capability);
    const next = mintTaskId();
    emitManifest({
      taskId: next,
      observedAt: hoursAgo(1),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    });
    emitAct({ taskId: next, observedAt: hoursAgo(1), tool: 'verify_site_live', targets: [CHARLIE_1] });

    const delta = registry.changedSince(all.cursor);
    expect(delta.sessions.map((s) => s.id)).toEqual([waiting.id]);
  });

  test('a cursor older than the retained ledger says so rather than posing as a delta', () => {
    seedTwo();
    // A horizon of one manifest guarantees truncation, which is the condition
    // under which a caller's old cursor can no longer be trusted as a delta.
    const registry = createSessionRegistry(
      deps({ runbooks: lookup(RB_BULK, RB_PURGE), manifestLimit: 1 })
    );
    expect(registry.snapshot().horizon.truncated).toBe(true);
    expect(registry.changedSince('evt_00000000000000000000000000').cursorUnknown).toBe(true);
  });

  test('a truncated read flags the ONE session whose start may lie beyond the horizon', () => {
    seedTwo();
    const snapshot = foldSessionRegistry(
      deps({ runbooks: lookup(RB_BULK, RB_PURGE), manifestLimit: 1 })
    );
    expect(snapshot.horizon.truncated).toBe(true);
    expect(snapshot.sessions.filter((s) => s.idProvisional).length).toBe(1);
  });

  test('the substrate limit rides on every snapshot, so no consumer has to know to ask', () => {
    const snapshot = foldSessionRegistry(deps({}));
    expect(snapshot.concurrencyLimit).toContain('the ledger records no chat-session id');
  });
});

// ===========================================================================

describe('non-fatal by construction', () => {
  test('no core at all yields an empty snapshot with a reserved row, never a throw', () => {
    setIntelligenceCore(undefined as never);
    const snapshot = foldSessionRegistry({ now: NOW });
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.situations).toEqual([]);
    expect(snapshot.reserved).toBeDefined();
    setIntelligenceCore(core);
  });

  test('an unreadable ledger yields an empty snapshot, never a throw', () => {
    const broken = {
      ...core,
      ledger: {
        query: () => {
          throw new Error('ledger is gone');
        },
      },
    } as unknown as IntelligenceCore;
    const snapshot = foldSessionRegistry({ core: broken, now: NOW, health: healthReport({}) });
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.horizon.manifestsRead).toBe(0);
  });

  test('a faulty place describer costs the place, not the row', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(2),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitAct({ taskId: t, observedAt: hoursAgo(2), tool: 'wpe_backup_and_verify', targets: [CHARLIE_1] });

    const snapshot = foldSessionRegistry(
      deps({
        runbooks: lookup(RB_BULK),
        describePlace: () => {
          throw new Error('graph is down');
        },
      })
    );
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].places.unresolved).toBe(1);
  });
});

// ===========================================================================
// THE GOLDEN FIXTURE
// ===========================================================================

/**
 * The designer's "one morning, both ways" (§2), adopted at the v1.3 ruling as
 * the consequence order's own regression pin.
 *
 * EIGHT LIVE THINGS IN — the rows of the designer's "as written" table:
 *
 *   1. the halt at Charlie                  T1  prod · 14h
 *   2. the verify that failed on Charlie    T1  prod · 14h
 *   3. the incident it opened               T1  prod · 13h
 *   4. the approval waiting at Bravo        T2  prod · 3h   (a canary already wrote)
 *   5. producer dark: plugin-inventory      T3  — · 9h
 *   6. producers dark: health, content-age  T3  — · 6h
 *   7. finished: cache purge across 12      T4  mixed · 5h
 *   8. 41 facts past their freshness SLO    T5  mixed · 2d
 *
 * TWO WAITING SITUATIONS, ONE RESERVED ROW AND ONE CHANGED ROW OUT.
 *
 * The 41 facts are the one input with no channel into this fold, and that is
 * tear 1's fix rather than an omission: T5 "leaves the list entirely" and there
 * is no field on any type in `sessionRegistry.ts` that could carry one. The
 * nearest representable neighbour — staleness — is asserted below to produce a
 * COUNT and no row.
 *
 * When a future tear re-rules the order, this morning is what it re-renders.
 */
describe('WP-48 · the ratified verdicts, driven through real emitters', () => {
  /**
   * The class-selection pins in `situationHeadlines.test.ts` drive the selector
   * directly, across its whole input domain. THESE prove the other half: that
   * the FOLD, over events the producers actually write, produces the inputs
   * those classes are for. A selector that is right about inputs the fold can
   * never hand it composes nothing.
   */

  /** A run under a document it can be folded against, with nothing written. */
  function unwrittenRunUnderDocument(): string {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(3),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    return t;
  }

  /** The same run, with its canary landed — one target done, gate still open. */
  function partChangedRun(): string {
    const t = unwrittenRunUnderDocument();
    emitAct({ taskId: t, observedAt: hoursAgo(3), tool: 'contain_site', targets: [BRAVO] });
    return t;
  }

  test('a run with no document and nothing written is the nothing-written class, in the ratified words', () => {
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(9),
      // A runbook the lookup does not hold: no document, so no checkpoints and
      // no gate. This is the shape THREE rows on the developer's live ledger
      // have (measured 2026-08-20) — the class the designer counted two of.
      procedure: { capability: RB_REMEDIATE.capability, runbook: 'rb.remediate', hash: 'sha256:gone', status: 'delivered' },
      consulted: true,
    });
    expect(ledgerCount(MANIFEST_TOPIC)).toBe(1); // shape #15

    const [situation] = foldSessionRegistry(deps({ runbooks: lookup() })).situations;
    expect(situation.headlineTemplate).toBe('run.waiting.nothing-written');
    expect(situation.headline).toBe('A remediation run has waited 9h and changed nothing');
    expect(situation.ask).toBe('It never received a target list, so it cannot start. Give it one, or close it.');
    expect(situation.chip).toBe('Waiting');
    expect(situation.state).toBe('nothing written yet');
    // The runbook id LEFT the headline and is on the meta line — the route's
    // own instruction, and the assertion that would fail if it drifted back.
    expect(situation.headline).not.toContain('rb.remediate');
    expect(situation.meta).toBe('rb.remediate');
  });

  test('the run noun is the capability\'s, and a capability outside the vocabulary declines the class', () => {
    // `cap.cache_purge` has no ratified run noun. Rather than composing
    // "undefined has waited 5h", the class is declined and the derived sentence
    // stands — with `headlineTemplate: null` saying so.
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(5),
      procedure: { capability: RB_PURGE.capability, runbook: 'rb.cache-purge', hash: 'sha256:gone', status: 'delivered' },
      consulted: true,
    });
    const [situation] = foldSessionRegistry(deps({ runbooks: lookup() })).situations;
    expect(situation.headlineTemplate).toBeNull();
    expect(situation.headline).not.toContain('undefined');
    expect(situation.headline).toContain('rb.cache-purge');
  });

  test('a GATED run with nothing written is declined, because the class\'s ask contradicts the record', () => {
    // The measured live-fleet defect, pinned. This row is at a checkpoint with
    // approvals outstanding; guard 1 selects it and guard 1 says it "never
    // received a target list, so it cannot start". It received one and it is
    // partway through. See `contradictedByTheRecord` for the ruling this wants.
    unwrittenRunUnderDocument();
    expect(ledgerCount(MANIFEST_TOPIC)).toBe(1); // shape #15
    const [situation] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).situations;
    expect(situation.gate).toBeDefined();
    expect(situation.written).toEqual({ done: 0, failed: 0, total: 0 });
    expect(situation.headlineTemplate).toBeNull();
    expect(situation.ask).toBe('');
    expect(situation.headline).not.toContain('never received a target list');
  });

  test('the mid-procedure class cannot fire, and this pins WHY rather than asserting it does', () => {
    // `{total}` is `places.total`, derived from outcomes alone, so nothing
    // written forces total 0 and guard 2 (`total > 0` with nothing written) has
    // no reachable input. Pinned as a MEASURED LIMIT so the day a target-set
    // field lands, this test fails and says what changed.
    unwrittenRunUnderDocument();
    const [row] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).sessions;
    expect(row.outcomes.succeeded.length + row.outcomes.failed.length).toBe(0);
    expect(row.places.total).toBe(0);
  });

  test('a part-changed run at a gate is the tier-1 class, counting done against the target set', () => {
    partChangedRun();
    expect(ledgerCount(OUTCOME_RECORDED_TOPIC)).toBe(1); // shape #15

    const [situation] = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) })).situations;
    expect(situation.headlineTemplate).toBe('run.waiting.part-changed');
    expect(situation.headline).toBe('1 of 1 are changed and the rest are waiting on you');
    expect(situation.chip).toBe('Mid-change');
    expect(situation.ask).toContain('Continue, or stop and keep what is standing.');
    expect(situation.written).toEqual({ done: 1, failed: 0, total: 1 });
  });

  test('an orphan incident states the FINDING, not that an incident exists', () => {
    const id = core.emitter.emit({
      observed_at: hoursAgo(7),
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { environment: CHARLIE_1 },
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: 'agent:security-sentinel', trust: 'emitted' },
      payload: { fact: 'ABS-05', symptom: 'Known backdoor plugin detected: wp-compat', severity: 'critical', resolved: false },
    }).id;
    expect(core.ledger.get(id)).toBeDefined(); // shape #15

    const [situation] = foldSessionRegistry(deps()).situations;
    expect(situation.headlineTemplate).toBe('incident.no-run');
    expect(situation.headline).toBe(
      `Known backdoor plugin detected: wp-compat on ${CHARLIE_1}, and nothing is fixing it`,
    );
    expect(situation.state).toBe('No run attached');
    expect(situation.meta).toBe('act_security_sentinel');
    // The badge stays empty on this class, so nothing renders an empty pill.
    expect(situation.chip).toBe('');
  });

  test('an incident with neither symptom nor fact declines the class rather than naming nothing', () => {
    core.emitter.emit({
      observed_at: hoursAgo(7),
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { environment: CHARLIE_1 },
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: 'agent:security-sentinel', trust: 'emitted' },
      payload: { severity: 'high', resolved: false },
    });
    const [situation] = foldSessionRegistry(deps()).situations;
    expect(situation.headlineTemplate).toBeNull();
    expect(situation.headline).toContain('no symptom recorded');
    // …and the status phrase still comes from the ratified set, not from here.
    expect(situation.state).toBe('No run attached');
  });

  test('FOUR uncorrelated incidents on one site are FOUR rows — measured, not assumed', () => {
    // The route's §2 open question, driven with the shape the developer's real
    // ledger holds: four `episodic.incident.recorded` events, same actor, same
    // entity, same millisecond, `correlation` and `causation` BOTH null.
    // Coalescing keys off `correlation` into a session's task set, so with no
    // link there is no session to fold them into and each states its own limit
    // exactly as the designer drew it.
    const findings = ['fileorganizer', 'wp-compat', 'noted, index', 'index.php'];
    for (const finding of findings) {
      core.emitter.emit({
        observed_at: hoursAgo(7),
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: { environment: CHARLIE_1, site: CHARLIE_2 },
        actor: { id: 'act_security_sentinel', kind: 'agent' },
        source: { class: 'work', system: 'agent:security-sentinel', trust: 'emitted' },
        payload: { fact: 'ABS-0x', symptom: finding, severity: 'high', resolved: false },
      });
    }
    expect(ledgerCount(INCIDENT_TOPIC)).toBe(4); // shape #15

    const snapshot = foldSessionRegistry(deps());
    expect(snapshot.situations).toHaveLength(4);
    expect(snapshot.situations.every((s) => s.headlineTemplate === 'incident.no-run')).toBe(true);
    // Each names its OWN finding — four rows saying four things, not four
    // saying the same thing.
    expect(new Set(snapshot.situations.map((s) => s.headline)).size).toBe(4);
  });

  test('the same four WITH a causal link into a run coalesce to ONE row, so the fold is the reason', () => {
    // The other half of the measurement: the rows are four because the RECORD
    // carries no link, not because the fold cannot coalesce. Correlate them into
    // a session and the same four events become three parts of one situation.
    const t = mintTaskId();
    emitManifest({
      taskId: t,
      observedAt: hoursAgo(8),
      procedure: { capability: RB_REMEDIATE.capability, runbook: RB_REMEDIATE.id, hash: RB_REMEDIATE.hash, status: 'delivered' },
      consulted: true,
    });
    for (const finding of ['a', 'b', 'c', 'd']) {
      core.emitter.emit({
        observed_at: hoursAgo(7),
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: { environment: CHARLIE_1 },
        actor: { id: 'act_security_sentinel', kind: 'agent' },
        source: { class: 'work', system: 'agent:security-sentinel', trust: 'emitted' },
        correlation: t,
        payload: { fact: 'ABS-0x', symptom: finding, severity: 'high', resolved: false },
      });
    }
    expect(ledgerCount(INCIDENT_TOPIC)).toBe(4); // shape #15

    const snapshot = foldSessionRegistry(deps({ runbooks: lookup(RB_REMEDIATE) }));
    expect(snapshot.situations).toHaveLength(1);
    expect(snapshot.situations[0].parts.filter((p) => p.kind === 'incident')).toHaveLength(4);
  });

  test('the list verdict is generated from the very rows the columns render', () => {
    // Two unwritten rows and nothing else: the allUnwritten arm, with the count
    // the waiting column is about to draw.
    for (const capability of [RB_REMEDIATE.capability, 'cap.incident_containment']) {
      emitManifest({
        taskId: mintTaskId(),
        observedAt: hoursAgo(4),
        procedure: { capability, runbook: 'rb.x', hash: 'sha256:gone', status: 'delivered' },
        consulted: true,
      });
    }
    const triage = createSessionRegistry(deps({ runbooks: lookup() })).triage();
    expect(triage.waiting).toHaveLength(2);
    expect(triage.verdict).toBe('2 things need you, and none of them has changed anything yet');
  });
});

// ===========================================================================

describe('the golden fixture — the designer\'s "one morning, both ways" (§2)', () => {
  interface Morning {
    charlieTask: string;
    bravoTask: string;
    purgeTask: string;
    incidentId: string;
  }

  function overnight(): Morning {
    // --- Charlie: the halt, the failing verify, the incident ---------------
    const charlieTask = mintTaskId();
    emitManifest({
      taskId: charlieTask,
      observedAt: hoursAgo(14),
      procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({ taskId: charlieTask, observedAt: hoursAgo(14), decision: 'approved', checkpoint: 'cp.approval' });
    emitAct({ taskId: charlieTask, observedAt: hoursAgo(14), tool: 'wpe_backup_and_verify', targets: [CHARLIE_1] });
    // Two done and standing.
    emitAct({
      taskId: charlieTask,
      observedAt: hoursAgo(14),
      tool: 'bulk_plugin_update',
      targets: [CHARLIE_1, CHARLIE_2],
    });
    // The verify that failed on checkout.
    const verify = emitAct({
      taskId: charlieTask,
      observedAt: hoursAgo(14),
      tool: 'verify_site_live',
      targets: [CHARLIE_1],
      result: 'failure',
    });
    const incidentId = emitAbortIncident({
      taskId: charlieTask,
      observedAt: hoursAgo(13),
      target: CHARLIE_1,
      abortId: 'ab.verify-failed',
      symptom: 'checkout returned 500',
      causedBy: verify.outcomeIds[0],
    });

    // --- Bravo: an approval waiting inside a canary that already wrote ------
    const bravoTask = mintTaskId();
    emitManifest({
      taskId: bravoTask,
      observedAt: hoursAgo(3),
      procedure: {
        capability: RB_REMEDIATE.capability,
        runbook: RB_REMEDIATE.id,
        hash: RB_REMEDIATE.hash,
        status: 'delivered',
      },
      consulted: true,
    });
    emitAct({ taskId: bravoTask, observedAt: hoursAgo(3), tool: 'contain_site', targets: [BRAVO] });

    // --- the finished cache purge across twelve sites ----------------------
    const purgeTask = mintTaskId();
    const twelve = Array.from({ length: 12 }, (_, i) => provisionalEnvironmentId(`purge-${i}`));
    emitManifest({
      taskId: purgeTask,
      observedAt: hoursAgo(5),
      procedure: { capability: RB_PURGE.capability, runbook: RB_PURGE.id, hash: RB_PURGE.hash, status: 'delivered' },
      consulted: true,
    });
    emitRationale({
      taskId: purgeTask,
      observedAt: hoursAgo(5),
      decision: 'approved',
      checkpoint: 'cp.approval',
      tool: 'wpe_purge_cache',
    });
    emitAct({ taskId: purgeTask, observedAt: hoursAgo(5), tool: 'wpe_purge_cache', targets: twelve });

    return { charlieTask, bravoTask, purgeTask, incidentId };
  }

  /**
   * Three producers gone dark: plugin-inventory 9h, health 6h, content-age 6h.
   *
   * The 41 facts past their SLO are deliberately NOT planted here. An earlier
   * draft of this fixture put them in as a STALE health line and the reserved
   * row grew a clause about them — which is T5 smuggled into the one slot §4a
   * reserves for the record's own liveness, by the hand of the test that was
   * supposed to prove it stays out. Facts-past-SLO is twin freshness, not
   * producer liveness; it reaches this fold through no channel at all, and the
   * case below asserts exactly that.
   */
  const MORNING_HEALTH = (): IntelligenceHealthReport => ({
    checkedAt: NOW.toISOString(),
    coreUp: true,
    worst: 'DARK',
    lines: [
      { key: 'producer:plugin-inventory', label: 'plugin inventory', value: '9h ago', threshold: '6h', verdict: 'DARK' },
      { key: 'producer:health', label: 'health', value: '6h ago', threshold: '4h', verdict: 'DARK' },
      { key: 'producer:content-age', label: 'content age', value: '6h ago', threshold: '4h', verdict: 'DARK' },
    ],
    errors: [],
  });

  const morningDeps = () =>
    deps({ runbooks: lookup(RB_BULK, RB_REMEDIATE, RB_PURGE), health: MORNING_HEALTH() });

  test('the premise: every one of the overnight events is really in the ledger', () => {
    const world = overnight();
    // Shape #15, applied to a whole fixture. Every assertion in the cases below
    // would pass over an empty ledger, so the fixture proves itself first.
    expect(ledgerCount(MANIFEST_TOPIC)).toBe(3);
    expect(ledgerCount(ACTION_EXECUTED_TOPIC)).toBe(5);
    expect(ledgerCount(RATIONALE_RECORDED_TOPIC)).toBe(2);
    expect(ledgerCount(INCIDENT_TOPIC)).toBe(1);
    expect(core.ledger.get(world.incidentId)).toBeDefined();
  });

  test('eight live things in; two waiting situations, one reserved, one changed out', () => {
    overnight();
    const triage = createSessionRegistry(morningDeps()).triage();

    expect(triage.waiting).toHaveLength(2);
    expect(triage.changed).toHaveLength(1);
    expect(triage.reserved.dark).toHaveLength(3);
    // The reserved slot is ONE row however many producers are dark, which is
    // the difference between the two renderings' T3 handling.
    expect(triage.reserved.headline).toBe('the record is going blind — 3 producers dark');
  });

  test('Charlie is ONE row that names what is true, not three that describe it from three angles', () => {
    overnight();
    const [charlie] = createSessionRegistry(morningDeps()).triage().waiting;

    expect(charlie.tier).toBe(1);
    // The halt, the failing verify, the incident — one situation, three parts.
    expect(charlie.parts.map((p) => p.kind)).toEqual(['run', 'outcome', 'incident']);
    expect(charlie.parts[1].summary).toContain('verify_site_live failed');
    expect(charlie.parts[2].summary).toContain('checkout returned 500');
    expect(charlie.places.summary).toBe('touches production on 2 of 2');
    expect(charlie.since).toBe(hoursAgo(14));
  });

  test('Bravo\'s gate is T1 by tier 1\'s own definition, and it names where she is needed', () => {
    overnight();
    const [, bravo] = createSessionRegistry(morningDeps()).triage().waiting;

    // Tear 4, in one assertion: the canary already wrote, so the gate after it
    // sits on a part-changed fleet. The order as written had this at T2.
    expect(bravo.tier).toBe(1);
    expect(bravo.tierReason).toContain('a write has landed in scope');
    expect(bravo.gate).toMatchObject({
      checkpointId: 'cp.approval',
      index: 3,
      of: 8,
      awaits: 'approval',
      runbookId: 'rb.remediate',
    });
  });

  test('the finished run is in the OTHER column, filed against its runbook', () => {
    overnight();
    const [changed] = createSessionRegistry(morningDeps()).triage().changed;

    expect(changed.tier).toBe(4);
    expect(changed.column).toBe('changed');
    expect(changed.tierReason).toContain('rb.cache-purge');
    expect(changed.parts[0].summary).toContain('complete under rb.cache-purge');
  });

  test('drift leaves the list entirely — the eighth row has no channel into this fold', () => {
    overnight();
    const triage = createSessionRegistry(morningDeps()).triage();

    // Tear 1's fix, enforced by the shape rather than by a rule: three rows out
    // of the columns, one reserved row beside them, and no `tier: 3` anywhere.
    // The 41 facts are not represented because they CANNOT be — nothing on
    // `Situation`, `SessionRow` or `ReservedRow` could carry a fact's freshness,
    // which is what "drift is a rendering rule on the fact's own chip" means
    // once it is built rather than written down.
    expect([...triage.waiting, ...triage.changed]).toHaveLength(3);
    expect([...triage.waiting, ...triage.changed].map((s) => s.tier)).not.toContain(3);
    expect(triage.reserved.staleCount).toBe(0);
    expect(triage.reserved.headline).not.toContain('late');
  });

  /**
   * WP-48 · THE PINS, RE-RULED WITH THE PACKET.
   *
   * This fixture pinned the composer's old strings, and the copy those strings
   * came from was re-ratified on 2026-08-20. A fixture pinning superseded copy
   * is not a safety net, it is a veto on a ruling — so the pins move WITH the
   * ruling, and what they pin is unchanged: this same morning, rendered by the
   * sentence set of the day.
   *
   * WHAT THE RE-RULE REVEALED, worth stating because it is a fact about the
   * morning rather than about the sentences: BOTH waiting rows are the
   * `run.waiting.part-changed` class — the class the designer specified because
   * "no shipped row can produce it today". The golden morning produces two of
   * them, through real emitters, which is why the fifth class ships pinned
   * rather than merely written down.
   */
  test('both waiting rows are the part-changed class, in the ratified words', () => {
    overnight();
    const [charlie, bravo] = createSessionRegistry(morningDeps()).triage().waiting;

    expect(charlie.headlineTemplate).toBe('run.waiting.part-changed');
    expect(charlie.headline).toBe('1 of 2 are changed and the rest are waiting on you');
    expect(charlie.ask).toBe(
      'Waiting at cp.verify, 7 of 8. 1 failed. Continue, or stop and keep what is standing.',
    );
    expect(charlie.chip).toBe('Mid-change');
    expect(charlie.meta).toBe('rb.bulk-plugin-update');

    expect(bravo.headlineTemplate).toBe('run.waiting.part-changed');
    expect(bravo.headline).toBe('1 of 1 are changed and the rest are waiting on you');
    expect(bravo.ask).toBe(
      'Waiting at cp.approval, 3 of 8. 0 failed. Continue, or stop and keep what is standing.',
    );
    expect(bravo.chip).toBe('Mid-change');
    expect(bravo.meta).toBe('rb.remediate');
  });

  test('Charlie\'s two numbers are the record\'s, not the fixture prose\'s', () => {
    // The fixture's own comment says "Two done and standing"; the RECORD says
    // one. `bulk_plugin_update` succeeded on both Charlie targets and the later
    // `verify_site_live` FAILED on the first, and latest-outcome-per-target is
    // the rule — a retry that succeeded is not still failed, and a verify that
    // failed is not still standing. The headline counts what the record counts.
    overnight();
    const [charlie] = createSessionRegistry(morningDeps()).triage().waiting;
    expect(charlie.written).toEqual({ done: 1, failed: 1, total: 2 });
    expect(charlie.headline).toContain('1 of 2');
  });

  test('the changed column keeps the DERIVED sentence — the ratified set is the Now list\'s', () => {
    // No ratified class covers a finished run, and none is authored for one.
    // `headlineTemplate: null` says the sentence is derived, so the fallback is
    // visible rather than passing as ratified copy.
    overnight();
    const [changed] = createSessionRegistry(morningDeps()).triage().changed;
    expect(changed.headlineTemplate).toBeNull();
    expect(changed.headline).toBe('complete under rb.cache-purge — 12 done and standing, 0 failed');
    expect(changed.chip).toBe('');
    expect(changed.ask).toBe('');
  });

  test('the morning\'s list verdict is the someChanged arm, counting both written rows', () => {
    overnight();
    const triage = createSessionRegistry(morningDeps()).triage();
    expect(triage.verdict).toBe('2 things need you, and 2 of them have already written somewhere');
    // It cannot disagree with the column: the count IS the rows' own `written`.
    expect(triage.waiting.filter((s) => s.written.done > 0 || s.written.failed > 0)).toHaveLength(2);
  });

  test('the whole morning re-derives after the in-memory state is killed', () => {
    const world = overnight();
    // Warm memory for all three runs, then throw it away — the boot case.
    for (const [i, taskId] of [world.charlieTask, world.bravoTask, world.purgeTask].entries()) {
      armProcedureRun({
        sessionId: `s${i}`,
        capability: RB_BULK.capability,
        runbookId: RB_BULK.id,
        runbookHash: RB_BULK.hash,
      });
      registerProcedureTurn({ sessionId: `s${i}`, taskId });
    }

    const registry = createSessionRegistry(morningDeps());
    const before = registry.triage();

    for (const i of [0, 1, 2]) forgetProcedureRun(`s${i}`);

    expect(registry.triage()).toEqual(before);
  });
});
