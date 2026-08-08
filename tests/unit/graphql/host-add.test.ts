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

// nexusHostAdd's post-registration verification step reuses the same
// exec-based SSH primitive probeExternalHost itself uses (defaultSshExec),
// via buildExternalSshArgs/buildExternalWpCliCommand -- so it is mocked here
// the same way, independently of the probe mock above.
const verifyExecMock = jest.fn();
jest.mock('../../../src/main/external/sshExec', () => {
  const actual = jest.requireActual('../../../src/main/external/sshExec');
  return {
    ...actual,
    defaultSshExec: (...args: any[]) => verifyExecMock(...args),
  };
});

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

/**
 * `nexusHostAdd`'s C1 fix (per-site environment preservation) reads the
 * existing site row back via `findExternalSites(db, alias, site)`, which
 * issues real SQL against `graphService.getDb()`. A fixture that only logs
 * `upsertSite` calls (the pre-fix-round shape) can't answer that query, so
 * this fake `db` mirrors the two shapes `findExternalSites` actually prepares
 * — scoped-by-site and connection-wide — over the same `upserted` array,
 * and `upsertSite` itself now upserts by id (replace-in-place) rather than
 * just logging, so a second call against the same site sees the first's row.
 */
function ctx() {
  const store: Record<string, any> = {};
  const upserted: any[] = [];
  const db = {
    prepare: (sql: string) => ({
      all: (...args: any[]) => {
        if (sql.includes('account_id=? AND name=?')) {
          const [aliasArg, siteArg] = args;
          return upserted.filter((s) => s.is_active !== false && s.account_id === aliasArg && s.name === siteArg);
        }
        const [aliasArg] = args;
        return upserted.filter((s) => s.is_active !== false && s.account_id === aliasArg);
      },
    }),
  };
  return {
    upserted,
    store,
    context: {
      services: {
        registryStorage: {
          get: (k: string) => store[k],
          set: (k: string, v: unknown) => { store[k] = v; },
        },
        graphService: {
          upsertSite: async (s: any) => {
            const idx = upserted.findIndex((r) => r.id === s.id);
            if (idx >= 0) upserted[idx] = { ...upserted[idx], ...s };
            else upserted.push(s);
          },
          getDb: () => db,
        },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      },
      registry: {},
    } as any,
  };
}

const profiles = (store: Record<string, any>) => store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] ?? {};

beforeEach(() => {
  probeMock.mockReset();
  verifyExecMock.mockReset();
  // Default: verification succeeds, so existing tests that never set up
  // verifyExecMock explicitly still see a healthy `wp core version` echo.
  verifyExecMock.mockResolvedValue({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });
});

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

describe('nexusHostAdd — per-site environment fallback (C1)', () => {
  it('re-adding an existing site with --env omitted keeps its label, never downgrades to production', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValue(okReport({
      alias: 'prod-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    const first = await m.nexusHostAdd(
      null, { alias: 'prod-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );
    expect(first.registered).toBe(true);
    expect(first.environment).toBe('production');
    expect(c.upserted[0].environment).toBe('production');

    // Re-run against the SAME alias+site with --env omitted — e.g. refreshing
    // a discovered path. This must not silently relabel a production site.
    const second = await m.nexusHostAdd(
      null, { alias: 'prod-host', path: '/home/u1/site-a', environment: null, site: 'site-a' },
    );
    expect(second.registered).toBe(true);
    expect(second.environment).toBe('production');
    expect(c.upserted).toHaveLength(1); // same site row, upserted in place
    expect(c.upserted[0].environment).toBe('production');
  });

  it('a genuinely new site on the same connection can still get an explicit --env, without affecting its sibling', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'mixed-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    await m.nexusHostAdd(
      null, { alias: 'mixed-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );

    // A second, DIFFERENT site under the same connection, explicitly labelled
    // staging. It must get its own label, and must not touch site-a's.
    probeMock.mockResolvedValueOnce(okReport({
      alias: 'mixed-host', wpPath: '/home/u1/site-b', siteUrl: 'https://site-b.example.com',
    }));
    const second = await m.nexusHostAdd(
      null, { alias: 'mixed-host', path: '/home/u1/site-b', environment: 'staging', site: 'site-b' },
    );
    expect(second.registered).toBe(true);
    expect(second.environment).toBe('staging');

    const siteA = c.upserted.find((s) => s.id === 'ssh:mixed-host/site-a');
    const siteB = c.upserted.find((s) => s.id === 'ssh:mixed-host/site-b');
    expect(siteA.environment).toBe('production');
    expect(siteB.environment).toBe('staging');
  });

  it('omitting --env for a genuinely new site (no prior row) still defaults to production', async () => {
    probeMock.mockResolvedValue(okReport({
      alias: 'new-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostAdd(
      null, { alias: 'new-host', path: '/home/u1/site-a', environment: null, site: 'site-a' },
    );
    expect(result.registered).toBe(true);
    expect(result.environment).toBe('production');
    expect(c.upserted[0].environment).toBe('production');
  });
});

describe('nexusHostAdd — post-registration verification (Task 5)', () => {
  it('verifies each registered site after writing it, reporting per-site pass/fail', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'verify-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });
    const first = await m.nexusHostAdd(
      null, { alias: 'verify-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );

    expect(first.registered).toBe(true);
    expect(first.siteVerification).toEqual([
      { site: 'site-a', verified: true, error: null },
    ]);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'verify-host', wpPath: '/home/u1/site-b', siteUrl: 'https://site-b.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({
      code: 255, stdout: '', stderr: 'wp: command not found', spawnError: undefined,
    });
    const second = await m.nexusHostAdd(
      null, { alias: 'verify-host', path: '/home/u1/site-b', environment: 'production', site: 'site-b' },
    );

    expect(second.registered).toBe(true);
    expect(second.siteVerification).toEqual([
      { site: 'site-b', verified: false, error: expect.stringContaining('wp: command not found') },
    ]);
  });

  it('still registers a site that fails verification, but reports it as unusable rather than dropping it silently', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'flaky-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({
      code: 1, stdout: '', stderr: 'Error: This does not seem to be a WordPress installation.', spawnError: undefined,
    });

    const result = await m.nexusHostAdd(
      null, { alias: 'flaky-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );

    // The write is not rolled back -- the site row still exists.
    expect(result.registered).toBe(true);
    expect(c.upserted).toHaveLength(1);
    expect(c.upserted[0]).toEqual(expect.objectContaining({ id: 'ssh:flaky-host/site-a' }));

    // But it is reported as unusable, not silently counted as connected.
    expect(result.siteVerification).toEqual([
      { site: 'site-a', verified: false, error: expect.stringContaining('WordPress installation') },
    ]);
  });

  it('threads the connection profile\'s allowRoot into the verification WP-CLI command', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    // Pre-seed the connection profile as root-connecting, the way a prior
    // probeHostMultiIssue('rootUser') decision would have recorded it.
    c.store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = {
      'root-host': {
        alias: 'root-host', allowRoot: true, firstSeenAt: 1, lastSeenAt: 1,
      },
    };

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'root-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });

    const result = await m.nexusHostAdd(
      null, { alias: 'root-host', path: '/home/u1/site-a', environment: 'production', site: 'site-a' },
    );

    expect(result.registered).toBe(true);
    expect(result.siteVerification).toEqual([
      { site: 'site-a', verified: true, error: null },
    ]);
    // verifyExecMock is called with the built ssh argv; the WP-CLI command
    // string embedded in it must carry --allow-root.
    const sshArgs = verifyExecMock.mock.calls[0][0] as string[];
    expect(sshArgs.some((a) => a.includes('--allow-root'))).toBe(true);
  });
});

describe('nexusHostAddSites — batched registration for the onboarding wizard (Task 3)', () => {
  it('registers multiple sites in one call, each with its own environment, and returns one combined siteVerification array', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'batch-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'batch-host', wpPath: '/home/u1/site-b', siteUrl: 'https://site-b.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({
      code: 255, stdout: '', stderr: 'wp: command not found', spawnError: undefined,
    });

    const result = await m.nexusHostAddSites(
      null,
      {
        alias: 'batch-host',
        path: null,
        sites: [
          { site: 'site-a', environment: 'staging', path: '/home/u1/site-a' },
          { site: 'site-b', environment: 'production', path: '/home/u1/site-b' },
        ],
      },
    );

    expect(result.success).toBe(true);
    expect(c.upserted).toHaveLength(2);
    expect(c.upserted[0]).toEqual(expect.objectContaining({ id: 'ssh:batch-host/site-a', environment: 'staging' }));
    expect(c.upserted[1]).toEqual(expect.objectContaining({ id: 'ssh:batch-host/site-b', environment: 'production' }));
    expect(result.siteVerification).toEqual([
      { site: 'site-a', verified: true, error: null },
      { site: 'site-b', verified: false, error: expect.stringContaining('wp: command not found') },
    ]);

    // The staged multi-path mock behaviour above is only meaningful if each
    // call actually received its own site's path -- confirm the probe was
    // invoked with each site's distinct path, not the same value twice.
    expect(probeMock).toHaveBeenCalledTimes(2);
    expect(probeMock.mock.calls[0]).toEqual(['batch-host', { wpPath: '/home/u1/site-a' }]);
    expect(probeMock.mock.calls[1]).toEqual(['batch-host', { wpPath: '/home/u1/site-b' }]);
  });

  it('falls back to the batch-level path when no per-site path is given (single-install alias, unaffected by the per-site-path fix)', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'shared-path-host', wpPath: '/home/u1/shared', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'shared-path-host', wpPath: '/home/u1/shared', siteUrl: 'https://site-b.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });

    const result = await m.nexusHostAddSites(
      null,
      {
        alias: 'shared-path-host',
        path: '/home/u1/shared',
        sites: [
          { site: 'site-a', environment: 'staging' },
          { site: 'site-b', environment: 'production' },
        ],
      },
    );

    expect(result.success).toBe(true);
    expect(probeMock).toHaveBeenCalledTimes(2);
    expect(probeMock.mock.calls[0]).toEqual(['shared-path-host', { wpPath: '/home/u1/shared' }]);
    expect(probeMock.mock.calls[1]).toEqual(['shared-path-host', { wpPath: '/home/u1/shared' }]);
  });

  it('does not roll back a site whose verification failed', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    probeMock.mockResolvedValueOnce(okReport({
      alias: 'batch-flaky-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({
      code: 1, stdout: '', stderr: 'Error: This does not seem to be a WordPress installation.', spawnError: undefined,
    });

    const result = await m.nexusHostAddSites(
      null,
      {
        alias: 'batch-flaky-host',
        path: null,
        sites: [{ site: 'site-a', environment: 'production' }],
      },
    );

    expect(result.success).toBe(true);
    // The write is not rolled back -- the site row still exists.
    expect(c.upserted).toHaveLength(1);
    expect(c.upserted[0]).toEqual(expect.objectContaining({ id: 'ssh:batch-flaky-host/site-a' }));
    // But it is reported as unusable, not silently counted as connected.
    expect(result.siteVerification).toEqual([
      { site: 'site-a', verified: false, error: expect.stringContaining('WordPress installation') },
    ]);
  });

  it('does not drop a site that fails entirely at the probe stage -- returns one entry per input site, not a shrunk array', async () => {
    const c = ctx();
    const m = (createResolvers(c.context).Mutation as any);

    // site-a probes fine and registers.
    probeMock.mockResolvedValueOnce(okReport({
      alias: 'partial-fail-host', wpPath: '/home/u1/site-a', siteUrl: 'https://site-a.example.com',
    }));
    verifyExecMock.mockResolvedValueOnce({ code: 0, stdout: '6.8.1', stderr: '', spawnError: undefined });

    // site-b fails at the probe stage entirely (e.g. auth failure) -- before
    // this fix, registerExternalHostSite returned siteVerification: [] here,
    // which made this site vanish from the response instead of counting
    // against the total.
    probeMock.mockResolvedValueOnce({
      ok: false,
      alias: 'partial-fail-host',
      resolved: { hostname: '203.0.113.40', user: 'deploy', port: '22' },
      failure: { kind: 'auth-failed', detail: 'Permission denied (publickey).', remedy: 'ssh-copy-id ...' },
    });

    const result = await m.nexusHostAddSites(
      null,
      {
        alias: 'partial-fail-host',
        path: null,
        sites: [
          { site: 'site-a', environment: 'production', path: '/home/u1/site-a' },
          { site: 'site-b', environment: 'production', path: '/home/u1/site-b' },
        ],
      },
    );

    expect(result.success).toBe(true);
    expect(result.siteVerification).toHaveLength(2);
    expect(result.siteVerification[0]).toEqual({ site: 'site-a', verified: true, error: null });
    expect(result.siteVerification[1]).toEqual({
      site: 'site-b', verified: false, error: expect.stringContaining('Permission denied'),
    });
  });
});
