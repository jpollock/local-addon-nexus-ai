import Database from 'better-sqlite3';
import { InboxStore } from '../../../src/main/inbox/InboxStore';
import type { InboxItemInput } from '../../../src/main/inbox/types';

let db: InstanceType<typeof Database>;
let store: InboxStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new InboxStore(db);
});
afterEach(() => db.close());

describe('External host disconnect — Inbox aggregation', () => {
  test('recording a changed host key twice for the same alias produces ONE open item with seenCount 2', () => {
    const input: InboxItemInput = {
      source: 'nexus',
      code: 'EXT-HOSTKEY-CHANGED',
      scope: 'name:ssh:boxa',
      scopeLabel: 'boxa',
      kind: 'problem',
      title: "This server's identity changed",
      detail: 'Host key changed',
      severity: 'high',
    };

    store.record(input, 1000);
    store.record(input, 2000);

    const rows = store.listOpen();
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0].seenCount).toBe(2);
    expect(rows.items[0].firstSeenAt).toBe(1000);
    expect(rows.items[0].lastSeenAt).toBe(2000);
    expect(rows.items[0].code).toBe('EXT-HOSTKEY-CHANGED');
    expect(rows.items[0].scope).toBe('name:ssh:boxa');
  });

  test('two different aliases produce two items', () => {
    store.record({
      source: 'nexus',
      code: 'EXT-HOSTKEY-CHANGED',
      scope: 'name:ssh:boxa',
      scopeLabel: 'boxa',
      kind: 'problem',
      title: "This server's identity changed",
      detail: 'Host key changed',
      severity: 'high',
    }, 1000);

    store.record({
      source: 'nexus',
      code: 'EXT-HOSTKEY-CHANGED',
      scope: 'name:ssh:boxb',
      scopeLabel: 'boxb',
      kind: 'problem',
      title: "This server's identity changed",
      detail: 'Host key changed',
      severity: 'high',
    }, 1000);

    expect(store.listOpen().items).toHaveLength(2);
    expect(store.listOpen().items.map(i => i.scope).sort()).toEqual(['name:ssh:boxa', 'name:ssh:boxb']);
  });
});
