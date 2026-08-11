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

describe('inbox writes are independent of the renderer', () => {
  test('a run whose payload cannot be serialized is still recorded', () => {
    // A payload with a cycle is exactly what breaks structured clone over IPC.
    const cyclic: any = { id: 'FS-01', sev: 'high', title: 'Cyclic finding' };
    cyclic.self = cyclic;

    const written = recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [cyclic] } },
    }, 1000);

    expect(written).toBe(1);
    expect(store.listOpen().items[0].code).toBe('FS-01');
  });

  test('a normal payload survives the round trip', () => {
    // The cyclic-payload guard must drop ONLY what it cannot serialize.
    // Without this, an encodePayload that returned null unconditionally
    // would pass the cyclic test and silently discard every payload.
    const normal = { id: 'FS-02', sev: 'high', title: 'Normal finding', plain: 'Why.' };

    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [normal] } },
    }, 1000);

    expect(store.listOpen().items[0].payload).toEqual(normal);
  });
});

describe('SDK Finding shape mapping', () => {
  test('SDK-shaped findings map severity, description, and evidence correctly', () => {
    // Build a realistic SDK-shaped AgentResult with severity, description, and evidence.
    const sdkFinding = {
      id: 'CVE-2024-1234',
      severity: 'high' as const,
      category: 'active-compromise' as const,
      title: 'Malicious plugin detected',
      description: 'Plugin contains obfuscated code making external requests',
      site: 'production-site',
      evidence: {
        pluginSlug: 'suspicious-plugin',
        codeSnippet: 'eval(base64_decode($data))',
        requestsTo: ['malicious-domain.com'],
      },
      remediated: false,
    };

    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      status: 'success',
      sites: {
        'production-site': {
          status: 'findings',
          findings: [sdkFinding],
        },
      },
    }, 1000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(1);
    const item = items[0];

    // SDK shape: severity (not sev), description (not plain), evidence as JSON string
    expect(item.severity).toBe('high');
    expect(item.detail).toBe('Plugin contains obfuscated code making external requests');
    expect(item.evidence).toBeDefined();

    // Evidence is serialized as JSON
    const parsedEvidence = JSON.parse(item.evidence!);
    expect(parsedEvidence.pluginSlug).toBe('suspicious-plugin');
    expect(parsedEvidence.requestsTo).toEqual(['malicious-domain.com']);
  });

  test('renderer-shaped findings still work (backwards compatibility)', () => {
    const rendererFinding = {
      id: 'FS-99',
      sev: 'medium',
      title: 'Renderer-style finding',
      plain: 'Old-style detail text',
    };

    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [rendererFinding] } },
    }, 1000);

    const item = store.listOpen().items[0];
    expect(item.severity).toBe('medium');
    expect(item.detail).toBe('Old-style detail text');
  });

  test('severity "info" or category "informational" maps to kind "know"', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: {
        'Site A': { status: 'findings', findings: [
          { id: 'INFO-1', severity: 'info' as const, title: 'Info severity' },
          { id: 'INFO-2', category: 'informational' as const, title: 'Info category' },
        ]},
      },
    }, 1000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('know');
    expect(items[1].kind).toBe('know');
  });

  test('other severities map to kind "decide"', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: {
        'Site A': { status: 'findings', findings: [
          { id: 'D-1', severity: 'critical' as const, title: 'Critical' },
          { id: 'D-2', severity: 'high' as const, title: 'High' },
          { id: 'D-3', severity: 'medium' as const, title: 'Medium' },
          { id: 'D-4', severity: 'low' as const, title: 'Low' },
        ]},
      },
    }, 1000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(4);
    items.forEach(item => expect(item.kind).toBe('decide'));
  });

  test('evidence that cannot be serialized becomes undefined', () => {
    const cyclicEvidence: any = { loop: {} };
    cyclicEvidence.loop = cyclicEvidence;

    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: {
        'Site A': { status: 'findings', findings: [{
          id: 'BAD-EV',
          severity: 'high' as const,
          title: 'Cyclic evidence',
          evidence: cyclicEvidence,
        }]},
      },
    }, 1000);

    const item = store.listOpen().items[0];
    // Evidence is undefined, not a stringified cyclic object — the item is still recorded.
    expect(item.evidence).toBeUndefined();
    expect(item.code).toBe('BAD-EV');
  });
});
