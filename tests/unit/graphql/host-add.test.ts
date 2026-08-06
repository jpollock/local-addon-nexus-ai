/**
 * `nexusHostAdd` — the multi-site picker (Task 8).
 *
 * A connection can have zero, one, or many WordPress sites. Registration must
 * persist the connection profile even when the probe finds more than one root
 * (so `host list` shows a zero-site connection), and must accept a `site` name
 * to disambiguate which discovered root to register.
 *
 * Follows the fixture/mocking conventions of host-resolvers.test.ts: a fake
 * probeExternalHost, and a ctx() harness exposing the raw registryStorage
 * object and the graphService.upsertSite call log, so assertions read real
 * persisted state rather than a mocked spy's call shape.
 */

const probeMock = jest.fn();
jest.mock('../../../src/main/external/probeExternalHost', () => ({
  probeExternalHost: (...args: any[]) => probeMock(...args),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';
import { STORAGE_KEYS } from '../../../src/common/constants';

function okReport(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    alias: 'solo-host',
    resolved: { hostname: '203.0.113.10', user: 'deploy', port: '2222' },
    wpPath: '/home/u/public_html',
    wpVersion: '6.8.1',
    wpCliVersion: '2.12.0',
    siteUrl: 'https://example.com',
    ...over,
  };
}

function multipleWordpressReport(over: Record<string, unknown> = {}) {
  return {
    ok: false,
    alias: 'multi-host',
    resolved: { hostname: '203.0.113.20', user: 'deploy', port: '22' },
    wpCliPath: '/usr/local/bin/wp',
    failure: {
      kind: 'multiple-wordpress',
      detail: 'Found 2 WordPress installations.',
      remedy: 'Pass --path to pick one.',
    },
    candidates: ['/home/u1/site-a', '/home/u1/site-b'],
    ...over,
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

describe('nexusHostAdd — connection persists even when multiple sites are found', () => {
  it('a single discovered root registers one site with a domain-derived slug', async () => {
    probeMock.mockResolvedValue(okReport({ alias: 'solo-host', siteUrl: 'https://example.com' }));
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'solo-host', path: null, environment: null },
    );

    expect(result.registered).toBe(true);
    expect(c.upserted).toHaveLength(1);
    // The graph write's id must be ssh:solo-host/<slug>, not ssh:solo-host.
    expect(c.upserted[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^ssh:solo-host\//),
      account_id: 'solo-host',
      name: 'example',
      domain: 'example.com',
    }));
    expect(profiles(c.store)['solo-host']).toBeDefined();
  });

  it('multiple discovered roots persist the connection profile without registering any site', async () => {
    probeMock.mockResolvedValue(multipleWordpressReport());
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'multi-host', path: null, environment: null },
    );

    expect(result.registered).toBe(false);
    expect(result.report.candidates).toHaveLength(2);
    // No site row was written.
    expect(c.upserted).toHaveLength(0);
    // The connection profile write still happened.
    expect(profiles(c.store)['multi-host']).toEqual(expect.objectContaining({ alias: 'multi-host' }));
  });

  it('rejects an invalid environment without probing', async () => {
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'h1', path: null, environment: 'prod' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('prod');
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('falls back to the alias for domain when siteUrl is absent', async () => {
    probeMock.mockResolvedValue(okReport({ alias: 'h1', siteUrl: undefined }));
    const c = ctx();
    await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'h1', path: null, environment: null },
    );
    expect(c.upserted[0].domain).toBe('h1');
    // No domain to derive a slug from either — falls back to the alias too.
    expect(c.upserted[0].id).toBe('ssh:h1/h1');
  });

  it('a probe failure that is NOT multiple-wordpress persists nothing at all', async () => {
    probeMock.mockResolvedValue({
      ok: false,
      alias: 'dead-host',
      resolved: { hostname: '203.0.113.30', user: 'deploy', port: '22' },
      failure: { kind: 'auth-failed', detail: 'Permission denied', remedy: 'ssh-copy-id ...' },
    });
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'dead-host', path: null, environment: null },
    );

    expect(result.registered).toBe(false);
    expect(c.upserted).toHaveLength(0);
    expect(profiles(c.store)).toEqual({});
  });

  it('an explicit site name is used verbatim rather than derived', async () => {
    probeMock.mockResolvedValue(okReport({
      alias: 'multi-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'multi-host', path: '/home/u1/site-a', environment: 'production', site: 'my-custom-name' },
    );

    expect(result.registered).toBe(true);
    expect(c.upserted).toHaveLength(1);
    expect(c.upserted[0]).toEqual(expect.objectContaining({ id: 'ssh:multi-host/my-custom-name' }));
  });

  it('registering a second site under an already-registered connection does not disturb the first', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'multi-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    const first = await m.nexusHostAdd(
      null, { alias: 'multi-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );
    expect(first.registered).toBe(true);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'multi-host', wpPath: '/home/u1/site-b', siteUrl: 'https://site-b.example.com',
    }));
    const second = await m.nexusHostAdd(
      null, { alias: 'multi-host', path: '/home/u1/site-b', environment: 'production', site: 'site-b' },
    );
    expect(second.registered).toBe(true);

    // Both sites' upsertSite calls are independent — assert on call args, not
    // on a shared mutable object, to catch accidental cross-contamination.
    expect(c.upserted).toHaveLength(2);
    expect(c.upserted[0]).toEqual(expect.objectContaining({ id: 'ssh:multi-host/site-a', domain: 'site-a.example.com' }));
    expect(c.upserted[1]).toEqual(expect.objectContaining({ id: 'ssh:multi-host/site-b', domain: 'site-b.example.com' }));
    // Only one connection profile — both sites share it.
    expect(Object.keys(profiles(c.store))).toEqual(['multi-host']);
  });
});
