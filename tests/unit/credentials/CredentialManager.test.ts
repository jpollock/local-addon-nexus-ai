import { CredentialManager } from '../../../src/main/credentials/CredentialManager';
import { NotConnectedError, RevokedError, TemporarilyUnavailableError } from '../../../src/main/credentials/types';
import type { Connection } from '../../../src/main/credentials/types';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

function makeConnection(id: string, status: Connection['status'] = 'active'): Connection {
  return {
    id,
    provider: 'google',
    accountLabel: 'user@example.com',
    grantedScopes: [GSC_SCOPE],
    status,
    createdAt: new Date().toISOString(),
    lastRefreshedAt: null,
  };
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
