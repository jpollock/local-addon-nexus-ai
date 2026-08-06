const probeMock = jest.fn();
jest.mock('../../../src/main/external/probeExternalHost', () => ({
  probeExternalHost: (...args: any[]) => probeMock(...args),
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

beforeEach(() => probeMock.mockReset());

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
});

describe('nexusHostRemove', () => {
  it('clears the profile and deactivates the site row', async () => {
    probeMock.mockResolvedValue(okReport());
    const c = ctx();
    const m = createResolvers(c.context).Mutation as any;
    await m.nexusHostAdd(null, { alias: 'h1' });
    const r = await m.nexusHostRemove(null, { alias: 'h1' });
    expect(r.removed).toBe(true);
    expect(profiles(c.store)).toEqual({});
    expect(c.upserted.at(-1).is_active).toBe(false);
  });

  it('reports removed:false for an unknown alias and writes no row', async () => {
    const c = ctx();
    const r = await (createResolvers(c.context).Mutation as any).nexusHostRemove(null, { alias: 'nope' });
    expect(r.removed).toBe(false);
    expect(c.upserted).toHaveLength(0);
  });
});

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
