/**
 * WP-48b · THE ARMING RECORDS ITS SCOPE ON EVERY MANIFEST — the producer's debt,
 * paid, and driven end to end through the real emitter into a real ledger.
 *
 * WP-48 built the READER (`{total}` bound to the arming's own `scope.runnable`)
 * and then measured that nothing anywhere writes the key: **0 of 36 manifests on
 * the owner's real ledger carry a `scope`, and no event of any topic carries a
 * `runnable`**. Both waiting classes therefore withheld their sentences on the
 * real fleet, and the owner's first live look photographed exactly that — three
 * run rows all rendering the derived fallback.
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT LIGHTS THE SCREEN:
 *
 *  1. the honoured arming's selection reaches the manifest (WP-37's carrier
 *     finally landing on the record rather than only on the IPC stream);
 *  2. **an arming that selected nothing records the EMPTY SET** — because "a
 *     predicate armed this and nobody chose targets" is a FACT the armer knows,
 *     not an absence. Every run on the real fleet is that case.
 *
 * The three states are distinct and each is pinned below:
 *
 *   no `scope` key      → `targetSet: null`  → UNKNOWN, both guards decline
 *   `from: no-selection`→ `targetSet: 0`     → KNOWN EMPTY, guard 1 fires
 *   `from: selection`   → `targetSet: n`     → the selection's own size
 *
 * SHAPE #15 (PARALLEL_PROTOCOL): every case reads the emitted event back out of
 * the ledger and asserts it exists before asserting anything about the fold. A
 * fold over an empty ledger returns an empty snapshot quite happily.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { manifestScopeFor, CONTEXT_ASSEMBLED_TOPIC } from '../chatAssembly';
import { createSessionRegistry, type RunbookLookup } from '../sessionRegistry';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook } from '../../../intelligence';
import type { ProcedureScope } from '../procedureScope';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-20T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp48b-'));
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

/** A comparator selection over `n` sites — WP-37's carrier, shaped as it arrives. */
function selectionOf(n: number): ProcedureScope {
  return {
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    runnable: Array.from({ length: n }, (_, i) => ({
      siteId: `site-${i}`,
      siteName: `Site ${i}`,
      place: { host: 'local' },
    })),
    barred: [],
    excluded: [],
    places: ['local'],
    from: { surface: 'comparator', comparatorId: 'cmp-1', filter: 'all' },
    opensRun: n > 0,
  } as ProcedureScope;
}

const RB: Runbook = {
  id: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
  hash: 'sha256:bulk-1',
  version: '1.0.0',
  strictness: 'strict',
  path: 'runbooks/rb.bulk-plugin-update.md',
  canonicalBytes: 1024,
  steps: [],
  tools: [],
  toolScope: 'advisory',
  body: '',
  canonicalText: '',
  frontmatter: {},
  checkpoints: [
    { id: 'cp.consult-history', attest: 'manifest', evidence: { topic: CONTEXT_ASSEMBLED_TOPIC }, tools: [] },
    { id: 'cp.dry-run', attest: 'narrative', tools: [] },
    { id: 'cp.roll-fleet', attest: 'event', evidence: { topic: 'task.action.executed', tool: 'bulk_plugin_update' }, tools: [{ name: 'bulk_plugin_update' }] },
  ],
} as unknown as Runbook;

const lookup: RunbookLookup = { byCapability: (c: string) => (c === RB.capability ? RB : undefined) };

/**
 * The registry holding NO document for the run — XD-26's 6c, and the shape every
 * gateless run on the owner's real ledger actually has.
 *
 * It matters for class 1 specifically. WP-48's ruling added `&& gate === null`
 * to guard 1 ("a row standing at a gate can never be 'cannot start'"), and a
 * session the registry CAN place always stands at a gate until it is complete
 * (WP-49's rider-1 finding 1). So the class-1 sentence is reachable only for a
 * run with no gate, which is exactly the two real runs this packet lights up.
 */
const noDocument: RunbookLookup = { byCapability: () => undefined };

/**
 * One manifest, emitted the way `chatAssembly.emitManifest` emits it — including
 * the CONDITIONAL spread, which is the parity floor and is what the
 * `scope: undefined` case below drives.
 */
function emitManifest(args: { taskId: string; observedAt: string; scope?: ReturnType<typeof manifestScopeFor> }): string {
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
      procedure: { capability: RB.capability, runbook: RB.id, hash: RB.hash, status: 'delivered' },
      retrieval: [],
      ...(args.scope ? { scope: args.scope } : {}),
    },
  }).id;
}

function readBack(id: string): Record<string, unknown> {
  const events = core.ledger.query({ topicPrefix: CONTEXT_ASSEMBLED_TOPIC, limit: 50, order: 'desc' });
  const found = events.find((e) => e.id === id);
  expect(found).toBeDefined();                       // shape #15 — the event landed
  return (found!.payload ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1 · the derivation itself
// ---------------------------------------------------------------------------

describe('manifestScopeFor — one derivation, both armings', () => {
  test('an arming with NO SELECTION records the EMPTY SET, and says so', () => {
    // The whole of WP-48b's second half. It would be easy to return `undefined`
    // here — "no selection, nothing to record" — and that reading is what leaves
    // `targetSet` null on every run on the real fleet.
    expect(manifestScopeFor(undefined)).toEqual({ runnable: [], from: 'no-selection' });
  });

  test('an arming WITH a selection records that selection\'s site ids, in its own order', () => {
    expect(manifestScopeFor(selectionOf(3))).toEqual({
      runnable: ['site-0', 'site-1', 'site-2'],
      from: 'selection',
    });
  });

  test('a selection that chose NOTHING is `from: selection` with an empty set — not `no-selection`', () => {
    // Two different facts that both count zero: "a human selected nothing" and
    // "nobody was asked to select". The count is the same; the provenance is not,
    // and a reader must never have to infer one from a length.
    expect(manifestScopeFor(selectionOf(0))).toEqual({ runnable: [], from: 'selection' });
  });
});

// ---------------------------------------------------------------------------
// 2 · the three states, through the real ledger into the real fold
// ---------------------------------------------------------------------------

describe('the fold reads what the producer writes — three states, three answers', () => {
  test('NO SCOPE KEY · targetSet is null, and a GATELESS run falls to the derived sentence', () => {
    const task = mintTaskId();
    const id = emitManifest({ taskId: task, observedAt: hoursAgo(60) });

    // The event exists AND carries no `scope` key at all — a present-`undefined`
    // would read as a value the producer chose to send.
    const payload = readBack(id);
    expect(Object.prototype.hasOwnProperty.call(payload, 'scope')).toBe(false);

    // Gateless, so the ONE remaining `total`-reading guard is the one that
    // decides. (WP-50's ruling dropped `total > 0` from class 2, because
    // neither of its sentences reads it; class 1 still requires `total === 0`
    // and this is `null`.)
    const registry = createSessionRegistry({ core, now: NOW, runbooks: noDocument });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.targetSet).toBeNull();

    const [situation] = registry.triage().waiting;
    expect(situation.written.total).toBeNull();
    // The honest gap: the record does not say what this run was armed with, so
    // neither ratified sentence is available to say anything about it.
    expect(situation.headlineTemplate).toBeNull();
  });

  test('NO SCOPE KEY, GATED · class 2 composes anyway — the amendment, at the fold', () => {
    // The other side of the same absence, and the one WP-50's ruling changed.
    // A run standing at a gate with nothing written IS the designer's class 2,
    // and neither of that class's sentences claims anything about a target set,
    // so an unknown one does not withhold them.
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(6) });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.targetSet).toBeNull();
    expect(row.gate).toBeDefined();

    const [situation] = registry.triage().waiting;
    expect(situation.written.total).toBeNull();       // still unknown, still said so
    expect(situation.headlineTemplate).toBe('run.waiting.mid-procedure');
    expect(situation.ask).toContain('Nothing has been written yet, so stopping here costs nothing.');
  });

  test('EMPTY SET · targetSet is 0, and the DESIGNER\'S CLASS 1 fires — the fleet\'s real case', () => {
    const task = mintTaskId();
    const id = emitManifest({ taskId: task, observedAt: hoursAgo(60), scope: manifestScopeFor(undefined) });

    const payload = readBack(id);
    expect(payload.scope).toEqual({ runnable: [], from: 'no-selection' });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: noDocument });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.targetSet).toBe(0);                   // KNOWN empty, not unknown
    expect(row.gate).toBeUndefined();
    expect(row.documentUnavailable).toBe(true);      // the real fleet's own shape

    const [situation] = registry.triage().waiting;
    expect(situation.headlineTemplate).toBe('run.waiting.nothing-written');
    // The designer's own sentences, filled from the record. This is the
    // before-picture of the owner's screenshots turning into the after.
    expect(situation.headline).toBe('A plugin update run has waited 60h and changed nothing');
    expect(situation.ask).toBe('It never received a target list, so it cannot start. Give it one, or close it.');
  });

  test('A SELECTION · targetSet is the selection\'s size, and it is NOT the places count', () => {
    const task = mintTaskId();
    const id = emitManifest({ taskId: task, observedAt: hoursAgo(6), scope: manifestScopeFor(selectionOf(5)) });

    expect(readBack(id).scope).toEqual({
      runnable: ['site-0', 'site-1', 'site-2', 'site-3', 'site-4'],
      from: 'selection',
    });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.targetSet).toBe(5);
    // WP-48's collision, still removed: nothing has an outcome, so `places`
    // counts zero while the armed set counts five. Two real facts, one slot.
    expect(row.places.total).toBe(0);

    // AND CLASS 2 FIRES — the sentence WP-48's ruling made reachable and had no
    // producer to feed. A gated run with a target set and nothing written.
    const [situation] = registry.triage().waiting;
    expect(situation.headlineTemplate).toBe('run.waiting.mid-procedure');
    expect(situation.ask).toContain('Nothing has been written yet, so stopping here costs nothing.');
  });

  test('the NEWEST manifest carrying a scope wins, and a later scopeless turn does not erase it', () => {
    // The re-arm case. Ordered so the scopeless turn is LAST: in the middle,
    // "leaves it alone" and "erases it" give the same answer, which is the
    // vacuous shape WP-48's own battery caught in this exact rule.
    const task = mintTaskId();
    emitManifest({ taskId: task, observedAt: hoursAgo(9), scope: manifestScopeFor(selectionOf(9)) });
    emitManifest({ taskId: task, observedAt: hoursAgo(8), scope: manifestScopeFor(selectionOf(2)) });
    emitManifest({ taskId: task, observedAt: hoursAgo(7) });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup });
    const [row] = registry.sessions();
    expect(row).toBeDefined();
    expect(row.taskIds.length).toBeGreaterThan(0);
    expect(row.targetSet).toBe(2);
  });
});
