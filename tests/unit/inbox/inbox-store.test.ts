import Database from 'better-sqlite3';
import { InboxStore, failureCode } from '../../../src/main/inbox/InboxStore';
import type { InboxItemInput } from '../../../src/main/inbox/types';

let db: InstanceType<typeof Database>;
let store: InboxStore;

const item = (over: Partial<InboxItemInput> = {}): InboxItemInput => ({
  source: 'security-sentinel',
  code: 'FS-01',
  scope: 'local:abc123',
  scopeLabel: 'Good Aesthetic Club',
  kind: 'decide',
  title: 'File permissions are too open',
  detail: 'wp-config.php is world-readable.',
  ...over,
});

beforeEach(() => {
  db = new Database(':memory:');
  store = new InboxStore(db);
});
afterEach(() => db.close());

describe('InboxStore identity', () => {
  test('a re-report updates the existing row instead of inserting', () => {
    store.record(item(), 1000);
    store.record(item(), 2000);

    const rows = store.listOpen();
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0].seenCount).toBe(2);
    expect(rows.items[0].firstSeenAt).toBe(1000);
    expect(rows.items[0].lastSeenAt).toBe(2000);
  });

  test('the same check code on two different scopes is two items', () => {
    store.record(item({ scope: 'local:aaa', scopeLabel: 'Site A' }), 1000);
    store.record(item({ scope: 'local:bbb', scopeLabel: 'Site B' }), 1000);

    expect(store.listOpen().items).toHaveLength(2);
  });

  test('different check codes on one scope are two items', () => {
    store.record(item({ code: 'FS-01' }), 1000);
    store.record(item({ code: 'ABS-05' }), 1000);

    expect(store.listOpen().items).toHaveLength(2);
  });

  test('a re-report refreshes mutable display fields', () => {
    store.record(item({ title: 'Old title' }), 1000);
    store.record(item({ title: 'New title', detail: 'Now worse.' }), 2000);

    const row = store.listOpen().items[0];
    expect(row.title).toBe('New title');
    expect(row.detail).toBe('Now worse.');
  });
});

describe('InboxStore decisions', () => {
  test('a dismissed item stays dismissed when re-reported', () => {
    store.record(item(), 1000);
    const id = store.listOpen().items[0].id;
    store.decide(id, 'Not now', 'dismissed', 1500);

    store.record(item(), 2000);   // the next sweep finds it again

    expect(store.listOpen().items).toHaveLength(0);
    const all = store.listAll();
    expect(all[0].status).toBe('dismissed');
    expect(all[0].decision).toBe('Not now');
    expect(all[0].decidedAt).toBe(1500);
    // still counted and still time-stamped — the problem has not gone away
    expect(all[0].seenCount).toBe(2);
    expect(all[0].lastSeenAt).toBe(2000);
  });

  test('reopen returns a decided item to the queue and clears the decision', () => {
    store.record(item(), 1000);
    const id = store.listOpen().items[0].id;
    store.decide(id, 'Approve', 'done', 1500);
    expect(store.listOpen().items).toHaveLength(0);

    store.reopen(id, 2000);

    const open = store.listOpen().items;
    expect(open).toHaveLength(1);
    expect(open[0].decision).toBeUndefined();
    expect(open[0].decidedAt).toBeUndefined();
  });

  test('countsByKind counts only open items', () => {
    store.record(item({ code: 'A', kind: 'decide' }), 1000);
    store.record(item({ code: 'B', kind: 'decide' }), 1000);
    store.record(item({ code: 'C', kind: 'problem' }), 1000);
    const doneId = store.listOpen().items.find(i => i.code === 'B')!.id;
    store.decide(doneId, 'Approve', 'done', 1500);

    expect(store.countsByKind()).toEqual({ decide: 1, problem: 1, know: 0 });
  });

  test('pendingBySource counts open items per agent', () => {
    store.record(item({ source: 'security-sentinel', code: 'A' }), 1000);
    store.record(item({ source: 'security-sentinel', code: 'B' }), 1000);
    store.record(item({ source: 'seo-insights', code: 'C' }), 1000);

    // A decided item must not keep inflating its agent's badge, or the badge
    // would never clear.
    store.record(item({ source: 'security-sentinel', code: 'D' }), 1000);
    const decided = store.listOpen().items.find(i => i.code === 'D')!.id;
    store.decide(decided, 'Ignore', 'dismissed', 1500);

    expect(store.pendingBySource()).toEqual({ 'security-sentinel': 2, 'seo-insights': 1 });
  });

  test('listOpen is bounded and reports the true total', () => {
    for (let i = 0; i < 250; i++) store.record(item({ code: `C-${i}` }), 1000 + i);
    const page = store.listOpen(100);
    expect(page.items).toHaveLength(100);
    expect(page.total).toBe(250);
  });
});

describe('failure code normalisation', () => {
  test('the same fault with varying detail hashes to ONE code', () => {
    // The whole point: this is one recurring fault, not three.
    const codes = new Set([
      'connect ECONNREFUSED 127.0.0.1:13000',
      'connect ECONNREFUSED 127.0.0.1:13471',
      'connect ECONNREFUSED 127.0.0.1:9021',
    ].map(failureCode));
    expect(codes.size).toBe(1);
  });

  test('paths, uuids and timestamps do not fork the code', () => {
    expect(failureCode("ENOENT: no such file '/var/folders/t7/x9/run-a1b2.log' at 2026-08-10T14:02:11Z"))
      .toBe(failureCode("ENOENT: no such file '/var/folders/qq/z1/run-ffff.log' at 2026-08-11T09:44:02Z"));
  });

  test('genuinely different faults keep different codes', () => {
    // The opposite failure: over-normalising merges unrelated bugs into one
    // row and hides the second one completely.
    expect(failureCode('connect ECONNREFUSED 127.0.0.1:13000'))
      .not.toBe(failureCode('(s.evidence || []).map is not a function'));
    expect(failureCode('Permission denied reading wp-config.php'))
      .not.toBe(failureCode('Permission denied writing wp-config.php'));
  });

  test('a recurring fault stays ONE row across fifty runs', () => {
    // The end-to-end statement of the design's volume-agnosticism claim.
    for (let i = 0; i < 50; i++) {
      store.record(item({
        kind: 'problem',
        code: failureCode(`connect ECONNREFUSED 127.0.0.1:${13000 + i}`),
        scope: '*',
      }), 1000 + i);
    }
    const open = store.listOpen();
    expect(open.total).toBe(1);
    expect(open.items[0].seenCount).toBe(50);
  });
});

describe('InboxStore.prune', () => {
  const DAY = 24 * 60 * 60 * 1000;

  test('forgets a decided item that stopped recurring', () => {
    store.record(item(), 1000);
    store.decide(store.listOpen().items[0].id, 'Not now', 'dismissed', 1000);

    store.prune(90, 500, 1000 + 91 * DAY);
    expect(store.listAll()).toHaveLength(0);
  });

  test('a dismissed item that is STILL recurring is never pruned', () => {
    // Pruning it would let the next sweep resurrect it as open, silently
    // undoing the dismissal — the one property this store guarantees.
    store.record(item(), 1000);
    store.decide(store.listOpen().items[0].id, 'Not now', 'dismissed', 1000);
    const now = 1000 + 91 * DAY;
    store.record(item(), now);                    // still happening

    store.prune(90, 500, now);
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('dismissed');
  });

  test('open items are never aged out, however old', () => {
    store.record(item(), 1000);
    store.prune(90, 500, 1000 + 365 * DAY);
    expect(store.listOpen().total).toBe(1);
  });

  test('caps runaway open items per source, keeping the newest', () => {
    for (let i = 0; i < 20; i++) store.record(item({ code: `C-${i}` }), 1000 + i);
    store.prune(90, 5, 2000);

    const open = store.listOpen();
    expect(open.total).toBe(5);
    expect(open.items.map(i => i.code).sort())
      .toEqual(['C-15', 'C-16', 'C-17', 'C-18', 'C-19']);
  });

  test('the cap is per source, not global', () => {
    for (let i = 0; i < 6; i++) store.record(item({ source: 'a', code: `A-${i}` }), 1000 + i);
    for (let i = 0; i < 6; i++) store.record(item({ source: 'b', code: `B-${i}` }), 1000 + i);

    store.prune(90, 5, 2000);
    expect(store.pendingBySource()).toEqual({ a: 5, b: 5 });
  });
});
