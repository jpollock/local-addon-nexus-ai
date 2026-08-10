import Database from 'better-sqlite3';
import { InboxStore } from '../../../src/main/inbox/InboxStore';
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
