const probeMock = jest.fn();
jest.mock('../../../src/main/external/probeExternalHost', () => ({
  probeExternalHost: (...args: any[]) => probeMock(...args),
}));

// Task 2: nexusHostProbe now also runs the multi-issue probe (Step 2 of the
// External Host Onboarding wizard) in parallel with the existing
// single-failure probeExternalHost above -- mocked independently here, the
// same convention host-add.test.ts uses for its own second exec mock.
const multiIssueMock = jest.fn();
jest.mock('../../../src/main/external/probeHostMultiIssue', () => ({
  probeHostMultiIssue: (...args: any[]) => multiIssueMock(...args),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';
import { STORAGE_KEYS } from '../../../src/common/constants';

function okReport(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    alias: 'h1',
    resolved: { hostname: '203.0.113.10', user: 'deploy', port: '2222' },
    wpPath: '/home/u/public_html',
    wpVersion: '6.8.1',
    wpCliVersion: '2.12.0',
    siteUrl: 'https://example.com',
    ...over,
  };
}

function failReport(kind = 'auth-failed') {
  return {
    ok: false,
    alias: 'h1',
    resolved: { hostname: '203.0.113.10', user: 'deploy', port: '2222' },
    failure: { kind, detail: 'Permission denied (publickey,password).', remedy: 'ssh-copy-id ...' },
  };
}

function ctx() {
  const store: Record<string, any> = {};
  const upserted: any[] = [];
  return {
    upserted,
    store,
    context: {
      services: {
        registryStorage: {
          get: (k: string) => store[k],
          set: (k: string, v: unknown) => { store[k] = v; },
        },
        graphService: { upsertSite: async (s: any) => { upserted.push(s); } },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      },
      registry: {},
    } as any,
  };
}

const profiles = (store: Record<string, any>) => store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] ?? {};

function okMultiIssue(over: Partial<{
  checks: Record<string, { status: string; detail: string }>;
  issues: any[];
  wpCli: { path?: string; version: string };
  installs: string[];
}> = {}) {
  return {
    checks: {
      connection: { status: 'ok', detail: 'deploy@203.0.113.10' },
      hostKey: { status: 'ok', detail: 'trusted' },
      wpCli: { status: 'ok', detail: 'WP-CLI 2.12.0' },
      installs: { status: 'ok', detail: '1 found' },
    },
    issues: [],
    wpCli: { path: undefined, version: '2.12.0' },
    installs: ['/home/u/public_html'],
    ...over,
  };
}

beforeEach(() => {
  probeMock.mockReset();
  multiIssueMock.mockReset();
  multiIssueMock.mockResolvedValue(okMultiIssue());
});

// `nexusHostAdd` coverage lives in tests/unit/graphql/host-add.test.ts (Task 8:
// the multi-site picker rewrote it — id is now `ssh:<alias>/<site>`, the
// connection profile no longer carries wpPath/environment, and there is no
// "leave an already-registered host's label alone" default any more, since
// environment is resolved per-site by the CLI before nexusHostAdd is ever
// called). The describe blocks that used to live here tested the old
// connection-scoped shape and no longer apply.

describe('nexusHostProbe', () => {
  it('never persists, even on success', async () => {
    probeMock.mockResolvedValue(okReport());
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });
    expect(r.report.ok).toBe(true);
    expect(profiles(c.store)).toEqual({});
    expect(c.upserted).toHaveLength(0);
  });

  it('flattens resolved into hostname/user/port', async () => {
    probeMock.mockResolvedValue(okReport());
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });
    expect(r.report.hostname).toBe('203.0.113.10');
    expect(r.report.user).toBe('deploy');
    expect(r.report.port).toBe('2222');
  });

  it('passes fingerprint and keyType through from probeExternalHost, unmodified', async () => {
    probeMock.mockResolvedValueOnce({
      ok: false,
      alias: 'h1',
      resolved: { hostname: '203.0.113.10', user: 'deploy', port: '2222', userKnownHostsFile: '/x' },
      failure: {
        kind: 'host-key-unknown',
        detail: 'Host key verification failed.',
        remedy: 'New host key ...',
        fingerprint: 'SHA256:abc123',
        keyType: 'ED25519',
      },
    });
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });
    expect(r.report.failure.fingerprint).toBe('SHA256:abc123');
    expect(r.report.failure.keyType).toBe('ED25519');
  });

  it('response includes a multiIssue field built from probeHostMultiIssue, alongside the unchanged legacy report', async () => {
    probeMock.mockResolvedValueOnce(failReport('auth-failed'));
    multiIssueMock.mockResolvedValueOnce(okMultiIssue({
      checks: {
        connection: { status: 'ok', detail: 'deploy@203.0.113.10' },
        hostKey: { status: 'ok', detail: 'trusted' },
        wpCli: { status: 'warn', detail: 'not found' },
        installs: { status: 'idle', detail: 'needs WP-CLI' },
      },
      issues: [{
        kind: 'wpCliMissing',
        title: 'WP-CLI not found',
        detail: 'wp: command not found',
        remedy: 'Install WP-CLI on the host, then re-run the probe.',
      }],
      wpCli: undefined,
      installs: undefined,
    }));
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });

    // The legacy single-failure report reflects probeExternalHost's result,
    // exactly as before this task -- untouched by the new parallel call.
    expect(r.report.failure.kind).toBe('auth-failed');

    expect(r.multiIssue.issues).toEqual([
      expect.objectContaining({ kind: 'wpCliMissing' }),
    ]);
    expect(r.multiIssue.checks.connection.status).toBe('ok');
  });

  it('still succeeds and returns an empty multiIssue.issues array when the host is fully healthy', async () => {
    probeMock.mockResolvedValueOnce(okReport());
    multiIssueMock.mockResolvedValueOnce(okMultiIssue());
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });

    expect(r.success).toBe(true);
    expect(r.multiIssue.issues).toEqual([]);
    expect(r.multiIssue.checks.connection.status).toBe('ok');
    expect(r.multiIssue.checks.hostKey.status).toBe('ok');
    expect(r.multiIssue.checks.wpCli.status).toBe('ok');
    expect(r.multiIssue.checks.installs.status).toBe('ok');
  });
});

// `nexusHostRemove`/`nexusHostRemoveSite` coverage lives in
// tests/unit/graphql/host-remove.test.ts (Task 9: removal now cascades to
// every site under a connection, and needs a `graphService.getDb()` fixture
// to exercise `findExternalSites` — this file's `ctx()` doesn't provide one).

describe('nexusHostList', () => {
  it('returns the registered hosts', async () => {
    probeMock.mockResolvedValue(okReport());
    const c = ctx();
    const m = createResolvers(c.context).Mutation as any;
    await m.nexusHostAdd(null, { alias: 'h1' });
    const r = await m.nexusHostList();
    expect(r.hosts.map((h: any) => h.alias)).toEqual(['h1']);
  });
});
