/**
 * WP-49a · THE TWO CONTRACT ADDITIONS — `TriageView.working` and
 * `Situation.capability`. Two escalations, one missing field family.
 *
 * WP-49's gate registered both together because they are the same gap seen from
 * two surfaces:
 *
 *  - **rider 1** (XD-27) asks for an in-flight run needing nothing to sit in
 *    Nothing-needed-of-you as one line with its door. WP-49 built the predicate,
 *    MEASURED that every reachable session shape belonged in the list where the
 *    fold already put it, and REMOVED it — because the one gateless waiting
 *    session is `documentUnavailable` (XD-26's 6c) and filing that under
 *    "nothing needed of you" is the platform deciding a run it cannot place
 *    needs no one. That measurement is this fold's third guard.
 *  - **the two interim asks** wanted `RUN_NOUN[capability]` and `Situation`
 *    carried no capability, so the panel shipped `{runbookId}` — a PROCEDURE
 *    identifier standing in for a run noun.
 *
 * EVERY CASE BELOW IS A REAL EVENT THROUGH THE REAL EMITTER INTO A REAL LEDGER,
 * and asserts the session exists before asserting what the fold made of it
 * (shape #15) — a fold over an empty ledger satisfies every "working is empty"
 * assertion in this file vacuously.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { manifestScopeFor, CONTEXT_ASSEMBLED_TOPIC } from '../chatAssembly';
import {
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
} from '../actionProducer';
import { createSessionRegistry, type RunbookLookup } from '../sessionRegistry';
import { RUN_NOUN } from '../situationCopy.generated';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-20T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp49a-'));
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

/**
 * WP-50 · WHERE THE RIDER'S POPULATION ACTUALLY LIVES, and WP-49's finding 1
 * narrowed by measurement.
 *
 * WP-49 measured that "every placed session is either complete or standing at a
 * gate" and concluded the rider's starting state has no shape. That measurement
 * was taken over the golden morning, and **every runbook in the golden morning
 * declares checkpoints**. Two of the seven SHIPPED runbooks declare NONE —
 * `law/runbooks/diagnose-site.md` and `law/runbooks/wpe-pull.md`, measured
 * 2026-08-20 — and a run armed under either is placed, gateless and `running`
 * forever: `deriveStatus` calls a checkpoint list `complete` only when it is
 * non-empty, and `deriveGate` finds no active checkpoint to name.
 *
 * That is the rider's state exactly: nothing on the document asks the user for
 * anything, so the run is in flight and needs nobody. Controlled Vocabulary
 * v1.4 names both of them — "A diagnosis" and "A site pull" — which is how a
 * ratified line is composable for the row at all.
 *
 * So finding 1 stands where it was measured (a CHECKPOINTED document always
 * gates) and does not generalise to the document set the product ships.
 */
function runbook(over: Partial<Runbook> & Pick<Runbook, 'id' | 'capability' | 'hash' | 'checkpoints'>): Runbook {
  return {
    version: '1.0.0',
    strictness: 'strict',
    path: `runbooks/${over.id}.md`,
    canonicalBytes: 1024,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: '',
    canonicalText: '',
    frontmatter: {},
    ...over,
  } as unknown as Runbook;
}

const manifestGate = (id: string) => ({ id, attest: 'manifest' as const, evidence: { topic: CONTEXT_ASSEMBLED_TOPIC }, tools: [] });
const narrative = (id: string) => ({ id, attest: 'narrative' as const, tools: [] });
const rationaleGate = (id: string) => ({
  id,
  attest: 'event' as const,
  evidence: { topic: RATIONALE_RECORDED_TOPIC, decision: 'approved' as const },
  tools: [],
});

/**
 * In flight and needing nobody — shaped like the two runbooks that ship with no
 * checkpoints at all. Hand-built rather than loaded so the pin does not move the
 * day someone adds a checkpoint to `diagnose-site.md`; the SHAPE is the subject.
 */
const RB_IN_FLIGHT = runbook({
  id: 'rb.diagnose-site',
  capability: 'cap.diagnose_site',
  hash: 'sha256:diagnose-1',
  checkpoints: [],
});

/** The same run, with a consent gate in it — the promotion the rider names. */
const RB_GATED = runbook({
  id: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
  hash: 'sha256:bulk-1',
  checkpoints: [manifestGate('cp.consult-history'), rationaleGate('cp.approval'), narrative('cp.report')],
});

function lookup(...books: Runbook[]): RunbookLookup {
  const map = new Map(books.map((b) => [b.capability, b]));
  return { byCapability: (c: string) => map.get(c) };
}

function emitManifest(args: { taskId: string; observedAt: string; rb: Runbook | null; capability?: string; consulted?: boolean }): string {
  return core.emitter.emit({
    observed_at: args.observedAt,
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: 'context.assembled/1',
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      task: args.taskId,
      procedure: {
        capability: args.capability ?? args.rb!.capability,
        runbook: args.rb?.id ?? 'rb.unknown',
        hash: args.rb?.hash ?? 'sha256:a-document-this-registry-does-not-hold',
        status: 'delivered',
      },
      retrieval: args.consulted ? [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }] : [],
      scope: manifestScopeFor(undefined),
    },
  }).id;
}

// ---------------------------------------------------------------------------
// 1 · Situation.capability
// ---------------------------------------------------------------------------

describe('Situation.capability — the join the asks needed', () => {
  test('a session situation carries the run\'s capability, off the row', () => {
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(4), rb: RB_GATED, consulted: true });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_GATED) });
    const [row] = registry.sessions();
    expect(row).toBeDefined();                       // shape #15

    const situation = registry.triage().waiting.find((s) => s.kind === 'session');
    expect(situation).toBeDefined();
    expect(situation!.capability).toBe('cap.bulk_plugin_update');
    // It is the ROW'S value, not a second derivation that could disagree.
    expect(situation!.capability).toBe(row.capability);
    // And the ratified vocabulary can name it, which is the whole point.
    expect(RUN_NOUN[situation!.capability!]).toBe('A plugin update run');
  });

  test('an ORPHAN INCIDENT carries no capability — absent, never empty', () => {
    core.emitter.emit({
      observed_at: hoursAgo(43),
      topic: 'episodic.incident.recorded',
      schema: 'incident.recorded/1',
      entity: { site: 'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA' },
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
      payload: { fact: 'ABS-05', symptom: 'Known backdoor plugin detected', severity: 'critical', resolved: false },
    });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup() });
    const situation = registry.triage().waiting.find((s) => s.kind === 'incident');
    expect(situation).toBeDefined();                 // shape #15
    // It was never armed under a capability, so there is nothing to name. `''`
    // would read as a capability the fold could not spell.
    expect(situation!.capability).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2 · TriageView.working — rider 1's rows
// ---------------------------------------------------------------------------

describe('TriageView.working — an in-flight run that needs nothing of you', () => {
  test('a PLACED, GATELESS, RUNNING session becomes a working row and LEAVES the waiting column', () => {
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(3), rb: RB_IN_FLIGHT, consulted: true });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_IN_FLIGHT) });
    const [row] = registry.sessions();
    expect(row).toBeDefined();                       // shape #15
    expect(row.status).toBe('running');
    expect(row.gate).toBeUndefined();
    expect(row.documentUnavailable).toBeFalsy();

    const triage = registry.triage();
    expect(triage.working).toHaveLength(1);
    expect(triage.working[0].sessionId).toBe(row.id);
    // THE RIDER'S CONTENT: it is not among the things needing you. The badge,
    // the verdict and the rows all count one set.
    expect(triage.waiting.map((s) => s.sessionId)).not.toContain(row.id);
    expect(triage.verdict).toBe('');
  });

  test('the line is the RATIFIED RUN NOUN and the fold\'s own status — no authored sentence', () => {
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(3), rb: RB_IN_FLIGHT, consulted: true });

    const [w] = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_IN_FLIGHT) }).triage().working;
    expect(w).toBeDefined();
    expect(w.line).toBe('A diagnosis is running');
    // Composed from the vocabulary, not typed beside it.
    expect(w.line.startsWith(RUN_NOUN['cap.diagnose_site'])).toBe(true);
  });

  test('a capability the VOCABULARY DOES NOT NAME falls back to the id, cited in full', () => {
    const RB_UNNAMED = runbook({
      id: 'rb.unnamed',
      capability: 'cap.not_in_the_vocabulary',
      hash: 'sha256:unnamed-1',
      checkpoints: [],
    });
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(2), rb: RB_UNNAMED, consulted: true });

    const [w] = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_UNNAMED) }).triage().working;
    expect(w).toBeDefined();
    expect(RUN_NOUN['cap.not_in_the_vocabulary']).toBeUndefined();
    // An id is honest. A guessed noun is not.
    expect(w.line).toBe('cap.not_in_the_vocabulary is running');
  });

  test('A GATED RUN IS NOT WORKING — it promotes itself, which is the rider\'s own second half', () => {
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(4), rb: RB_GATED, consulted: true });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_GATED) });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.gate).toBeDefined();                  // it reached a gate

    const triage = registry.triage();
    expect(triage.working).toEqual([]);
    expect(triage.waiting.map((s) => s.sessionId)).toContain(row.id);
  });

  test('A HALTED RUN IS NOT WORKING — even with no gate, and the battery is why this test exists', () => {
    // FOUND BY THE MUTATION BATTERY (M07): `status !== 'running'` → `status ===
    // 'complete'` SURVIVED the first drive, because nothing drove a halted run
    // with no gate. It is reachable and it is the worst thing this section can
    // say: a run that STOPPED, filed under "nothing needed of you".
    //
    // The shape: a zero-checkpoint document (so there is no gate to exclude it
    // on) plus an open abort incident correlated into the run, which is how the
    // fold learns a run halted.
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(5), rb: RB_IN_FLIGHT, consulted: true });
    core.emitter.emit({
      observed_at: hoursAgo(4),
      topic: 'episodic.incident.recorded',
      schema: 'incident.recorded/1',
      entity: { site: 'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA' },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'procedure:abort', trust: 'emitted' },
      correlation: task,
      payload: { fact: 'ab.verify-failed', symptom: 'checkout returned 500', resolved: false, source: `abort:${task}/ab.verify-failed` },
    });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_IN_FLIGHT) });
    const [row] = registry.sessions();
    expect(row).toBeDefined();                       // shape #15
    expect(row.status).toBe('halted');
    expect(row.gate).toBeUndefined();                // no gate — the guard that could have caught it is not the one that does
    expect(row.documentUnavailable).toBeFalsy();     // …nor is the 6c guard

    const triage = registry.triage();
    expect(triage.working).toEqual([]);
    // It belongs in the list. A halt is the fleet asking.
    expect(triage.waiting.map((s) => s.sessionId)).toContain(row.id);
  });

  test('A 6c ROW IS NOT WORKING — WP-49\'s finding 3, kept as a guard rather than a paragraph', () => {
    // A run armed under a document this registry does not hold: gateless,
    // running, and NOT in flight — the platform cannot place it. Filing it under
    // "nothing needed of you" is the exact regression WP-49 measured before
    // building anything, and it is the two real gateless runs on the owner's
    // own ledger.
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(60), rb: null, capability: 'cap.bulk_plugin_update' });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup() });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.status).toBe('running');
    expect(row.gate).toBeUndefined();
    expect(row.documentUnavailable).toBe(true);

    const triage = registry.triage();
    expect(triage.working).toEqual([]);
    // It stays in the list, where XD-26's 6c says it belongs.
    expect(triage.waiting.map((s) => s.sessionId)).toContain(row.id);
  });

  test('the VERDICT counts the filtered column — a working run is never in a sentence about rows nobody sees', () => {
    // One in-flight run needing nobody, one gated run needing you.
    const inFlight = mintTaskId();
    const gated = mintTaskId();
    emitManifest({ taskId: inFlight, observedAt: hoursAgo(3), rb: RB_IN_FLIGHT, consulted: true });
    emitManifest({ taskId: gated, observedAt: hoursAgo(4), rb: RB_GATED, consulted: true });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup(RB_IN_FLIGHT, RB_GATED) });
    expect(registry.sessions()).toHaveLength(2);     // shape #15 — both landed

    const triage = registry.triage();
    expect(triage.working).toHaveLength(1);
    expect(triage.waiting).toHaveLength(1);
    // ONE, not two. The sentence and the rows have one source.
    expect(triage.verdict).toContain('1 thing');
  });
});
