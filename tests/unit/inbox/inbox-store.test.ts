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
