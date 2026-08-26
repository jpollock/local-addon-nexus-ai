import { CredentialManager } from '../../../src/main/credentials/CredentialManager';
import { NotConnectedError, RevokedError, TemporarilyUnavailableError } from '../../../src/main/credentials/types';
import type { Connection } from '../../../src/main/credentials/types';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

function makeManager(overrides: Record<string, any> = {}) {
  const { safeStorage } = require('electron');
  safeStorage.isEncryptionAvailable.mockReturnValue(true);
  safeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  safeStorage.decryptString.mockImplementation((b: Buffer) => b.toString().slice(4));

  const storage = makeStorage();
  const mockFlow = overrides.flow ?? {
    run: jest.fn(async () => ({
      outcome: 'success',
      accessToken: 'at_fresh',
      refreshToken: 'rt_fresh',
      expiresIn: 3600,
      scopes: [GSC_SCOPE],
      accountLabel: 'user@example.com',
    })),
    cancel: jest.fn(),
  };

  const mockFetch = overrides.mockFetch ?? jest.fn(async () => ({
    ok: true,
    json: async () => ({
      access_token: 'at_refreshed',
      expires_in: 3600,
      scope: GSC_SCOPE,
    }),
  }));

  return new CredentialManager({
    storage,
    emitNexusState: jest.fn(),
    emitCredentialEvent: jest.fn(),
    flowRunnerFactory: () => mockFlow,
    fetchFn: mockFetch,
    ...overrides,
  });
}

describe('CredentialManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ProviderRegistry.get('google') requires this env var to return a non-null config.
    process.env.NEXUS_GOOGLE_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    delete process.env.NEXUS_GOOGLE_CLIENT_ID;
  });

  it('getStatusForAgent returns not_connected when no grant exists', async () => {
    const mgr = makeManager();
    const status = await mgr.getStatusForAgent('google', 'seo-insights', 'site-1');
    expect(status).toBe('not_connected');
  });

  it('getTokenForGrant throws NotConnectedError when no grant exists', async () => {
    const mgr = makeManager();
    await expect(mgr.getTokenForGrant('google', 'seo-insights', 'site-1', [GSC_SCOPE]))
      .rejects.toThrow(NotConnectedError);
  });

  it('getTokenForGrant returns cached access token when still valid', async () => {
    const mgr = makeManager();
    // Manually inject a connection + grant + cached token
    await mgr._testInjectConnectionAndGrant('conn-1', 'seo-insights', 'site-1', [GSC_SCOPE], 'at_valid', 'rt_valid');

    const token = await mgr.getTokenForGrant('google', 'seo-insights', 'site-1', [GSC_SCOPE]);
    expect(token.token).toBe('at_valid');
  });

  it('concurrent getTokenForGrant calls produce exactly one refresh request', async () => {
    let refreshCount = 0;
    const mgr = makeManager({
      mockFetch: jest.fn(async () => {
        refreshCount++;
        await new Promise(r => setTimeout(r, 20)); // simulate latency
        return {
          ok: true,
          json: async () => ({ access_token: 'at_new', expires_in: 3600, scope: GSC_SCOPE }),
        };
      }),
    });

    // Inject an expired token (in the past)
    await mgr._testInjectConnectionAndGrant('conn-1', 'seo-insights', 'site-1', [GSC_SCOPE], 'at_expired', 'rt_valid', -1000);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => mgr.getTokenForGrant('google', 'seo-insights', 'site-1', [GSC_SCOPE])),
    );

    expect(refreshCount).toBe(1);
    expect(results.every(r => r.token === 'at_new')).toBe(true);
  });

  it('handleRefreshFailure marks connection revoked and emits event', async () => {
    const emitCredentialEvent = jest.fn();
    const mgr = makeManager({ emitCredentialEvent });
    await mgr._testInjectConnectionAndGrant('conn-1', 'seo-insights', 'site-1', [GSC_SCOPE], 'at_old', 'rt_bad', -1000);

    await mgr.handleRefreshFailure('conn-1', 'invalid_grant');

    const conn = mgr.listConnections().find(c => c.id === 'conn-1');
    expect(conn?.status).toBe('revoked');
    expect(emitCredentialEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'credential:revoked' }));
  });
});

describe('the refresh grant', () => {
  // Snapshot a COPY and restore into a fresh object. Assigning the captured reference back leaves
  // whatever this suite added visible to later files in the same jest worker.
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  /** Drive one refresh and hand back the form body Google was sent. */
  async function captureRefreshBody(): Promise<URLSearchParams> {
    const bodies: string[] = [];
    const mockFetch = jest.fn(async (_url: string, init: any) => {
      bodies.push(String(init.body));
      return { ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, scope: GSC_SCOPE }) };
    });
    const mgr = makeManager({ mockFetch });
    await mgr.connect('google', 'agent-a', '', [GSC_SCOPE]);
    // Expire the cached token so the next read has to refresh.
    (mgr as any).tokenCache.set(
      (mgr as any).store.listConnections()[0].id,
      { token: 'stale', expiresAt: Date.now() - 1, scopes: [GSC_SCOPE] },
    );
    await mgr.getTokenForGrant('google', 'agent-a', '');
    return new URLSearchParams(bodies[bodies.length - 1]);
  }

  it('sends client_secret, exactly as the initial code exchange does', async () => {
    // Omitting it meant every connection worked until its first access token expired (~1 hour)
    // and then failed permanently — which reads as the app breaking on its own rather than as a
    // missing credential. exchangeCode always sent it; this path never did.
    process.env = {
      ...OLD_ENV,
      NEXUS_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      NEXUS_GOOGLE_CLIENT_SECRET: 'a-secret',
    };
    const body = await captureRefreshBody();
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(body.get('client_secret')).toBe('a-secret');
  });

  it('omits client_secret rather than sending an empty one when none is configured', async () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com' };
    delete process.env.NEXUS_GOOGLE_CLIENT_SECRET;
    const body = await captureRefreshBody();
    expect(body.has('client_secret')).toBe(false);
  });

  it('carries Google’s reason instead of only describing the retry loop', async () => {
    // "failed after retries" describes the loop, not the fault, and sent users to reconnect an
    // account that was never the problem.
    const mockFetch = jest.fn(async (_url: string, init: any) => {
      if (String(init.body).includes('grant_type=refresh_token')) {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid_client', error_description: 'Unauthorized' }) };
      }
      return { ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, scope: GSC_SCOPE }) };
    });
    const mgr = makeManager({ mockFetch });
    await mgr.connect('google', 'agent-a', '', [GSC_SCOPE]);
    (mgr as any).tokenCache.set(
      (mgr as any).store.listConnections()[0].id,
      { token: 'stale', expiresAt: Date.now() - 1, scopes: [GSC_SCOPE] },
    );

    await expect(mgr.getTokenForGrant('google', 'agent-a', '')).rejects.toThrow(/invalid_client/);
    await expect(mgr.getTokenForGrant('google', 'agent-a', '')).rejects.toThrow(TemporarilyUnavailableError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple connected accounts (fixes-082526 follow-on, web-analytics ask)
// ─────────────────────────────────────────────────────────────────────────────

describe('multiple connections per provider', () => {
  /** Connect twice with two different Google accounts; both grants for one agent+site. */
  async function twoAccounts() {
    const flow = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: 'success', accessToken: 'at_A', refreshToken: 'rt_A',
          expiresIn: 3600, scopes: [GSC_SCOPE], accountLabel: 'alpha@example.com',
        })
        .mockResolvedValueOnce({
          outcome: 'success', accessToken: 'at_B', refreshToken: 'rt_B',
          expiresIn: 3600, scopes: [GSC_SCOPE], accountLabel: 'beta@example.com',
        }),
      cancel: jest.fn(),
    };
    const manager = makeManager({ flow });
    await manager.connect('google', 'web-analytics', '', [GSC_SCOPE]);
    await manager.connect('google', 'web-analytics', '', [GSC_SCOPE]);
    return manager;
  }

  it('a second connect creates a SECOND connection — never an overwrite', async () => {
    const manager = await twoAccounts();
    const conns = manager.listConnections();
    expect(conns).toHaveLength(2);
    expect(conns.map((c: any) => c.accountLabel).sort()).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('listGrantedConnections returns exactly the connections THIS agent+site was granted', async () => {
    const manager = await twoAccounts();
    const granted = manager.listGrantedConnections('google', 'web-analytics', '');
    expect(granted.map((c: any) => c.accountLabel).sort()).toEqual(['alpha@example.com', 'beta@example.com']);
    // Another agent holds no grant on either — the connection list is not the grant list.
    expect(manager.listGrantedConnections('google', 'seo-insights', '')).toEqual([]);
  });

  it('getTokenForConnection returns the NAMED account\'s token, not the first grant\'s', async () => {
    const manager = await twoAccounts();
    const conns = manager.listConnections();
    const beta = conns.find((c: any) => c.accountLabel === 'beta@example.com')!;
    const token = await manager.getTokenForConnection('google', 'web-analytics', '', beta.id, [GSC_SCOPE]);
    expect(token.token).toBe('at_B');
  });

  it('an agent cannot reach a connection it was never granted — fail closed by grant, not by existence', async () => {
    const manager = await twoAccounts();
    const conns = manager.listConnections();
    await expect(
      manager.getTokenForConnection('google', 'seo-insights', '', conns[0].id, [GSC_SCOPE]),
    ).rejects.toThrow();
  });

  it('disconnecting one account leaves the other standing', async () => {
    const manager = await twoAccounts();
    const conns = manager.listConnections();
    const alpha = conns.find((c: any) => c.accountLabel === 'alpha@example.com')!;
    await manager.disconnect(alpha.id);
    const granted = manager.listGrantedConnections('google', 'web-analytics', '');
    expect(granted.map((c: any) => c.accountLabel)).toEqual(['beta@example.com']);
  });
});
