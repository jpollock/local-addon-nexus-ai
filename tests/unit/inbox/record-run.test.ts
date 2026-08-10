import Database from 'better-sqlite3';
import { InboxStore } from '../../../src/main/inbox/InboxStore';
import { recordRunToInbox } from '../../../src/main/inbox/recordRun';

let db: InstanceType<typeof Database>;
let store: InboxStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new InboxStore(db);
});
afterEach(() => db.close());

const finding = (id: string, title = `Finding ${id}`) =>
  ({ id, sev: 'high' as const, title, plain: 'Because reasons.' });

describe('recordRunToInbox', () => {
  test('per-site findings become one item per (code, site)', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: {
        'Site A': { status: 'findings', findings: [finding('FS-01'), finding('FS-02')] },
        'Site B': { status: 'findings', findings: [finding('FS-01')] },
      },
    }, 1000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(3);
    // The same code on two sites is two items, each scoped to its own site.
    const fs01 = items.filter(i => i.code === 'FS-01');
    expect(fs01).toHaveLength(2);
    expect(fs01.map(i => i.scopeLabel).sort()).toEqual(['Site A', 'Site B']);
  });

  test('re-running the same sweep does not grow the inbox', () => {
    const run = {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [finding('FS-01')] } },
    };
    recordRunToInbox(store, run, 1000);
    recordRunToInbox(store, run, 2000);
    recordRunToInbox(store, run, 3000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(1);
    expect(items[0].seenCount).toBe(3);
  });

  test('a site with no findings writes nothing', () => {
    const written = recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'clean', findings: [] } },
    }, 1000);

    expect(written).toBe(0);
    expect(store.listOpen().items).toHaveLength(0);
  });

  test('without per-site data, a single-site run still attributes to that site', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      findings: [finding('FS-01')],
      findingsSites: ['Site A'],
    }, 1000);

    expect(store.listOpen().items[0].scopeLabel).toBe('Site A');
  });

  test('without per-site data, a multi-site run is fleet-scoped and says so', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      findings: [finding('FS-01')],
      findingsSites: ['Site A', 'Site B'],
    }, 1000);

    const row = store.listOpen().items[0];
    expect(row.scope).toBe('*');
    expect(row.scopeLabel).toBe('2 sites');
  });

  test('findings with no site attribution say so, rather than "0 sites"', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      findings: [finding('FS-01')],
      findingsSites: [],
    }, 1000);

    const row = store.listOpen().items[0];
    expect(row.scope).toBe('*');
    expect(row.scopeLabel).toBe('Site not identified');
    // "0 sites" would assert the finding affects nothing, which is false.
    expect(row.scopeLabel).not.toContain('0');
  });

  test('scope is namespaced, never a bare site name', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [finding('FS-01')] } },
    }, 1000);

    // Bare names collide across local/WPE sources; the namespace prevents a merge.
    expect(store.listOpen().items[0].scope).toBe('name:Site A');
  });

  test('a failed run becomes one problem item, deduplicated by message', () => {
    const run = {
      agentId: 'security-sentinel',
      status: 'error' as const,
      error: '(s.evidence || []).map is not a function',
    };
    recordRunToInbox(store, run, 1000);
    recordRunToInbox(store, run, 2000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('problem');
    expect(items[0].seenCount).toBe(2);
    expect(items[0].scope).toBe('*');
  });
});
