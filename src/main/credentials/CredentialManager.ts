import * as crypto from 'crypto';
import { ProviderRegistry } from './ProviderRegistry';
import { CredentialTokenVault } from './CredentialTokenVault';
import { ConnectionStore } from './ConnectionStore';
import { ApiKeyConnectionStore } from './ApiKeyConnectionStore';
import { OAuthFlowRunner } from './OAuthFlowRunner';
import type { ICredentialManager } from './AgentCredentialsContext';
import type { Connection, Grant, AccessToken, CredentialEvent, ApiKeyConnection } from './types';
import {
  NotConnectedError,
  RevokedError,
  ScopeInsufficientError,
  TemporarilyUnavailableError,
  ProviderNotConfiguredError,
} from './types';
import type { RegistryStorage } from '../content/IndexRegistry';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if <5 min remaining
const MAX_REFRESH_RETRIES = 3;

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms
  scopes: string[];
}

export interface CredentialManagerDeps {
  storage: RegistryStorage;
  emitNexusState: (patch: Record<string, unknown>) => void;
  emitCredentialEvent: (event: CredentialEvent) => void;
  flowRunnerFactory?: () => OAuthFlowRunner;
  fetchFn?: typeof fetch;
}

export class CredentialManager implements ICredentialManager {
  private providerRegistry: ProviderRegistry;
  private vault: CredentialTokenVault;
  private store: ConnectionStore;
  private apiKeyStore: ApiKeyConnectionStore;
  private emitNexusState: (patch: Record<string, unknown>) => void;
  private emitCredentialEvent: (event: CredentialEvent) => void;
  private flowRunnerFactory: () => OAuthFlowRunner;
  private fetchFn: typeof fetch;

  // In-memory token cache: connectionId → CachedToken
  private tokenCache = new Map<string, CachedToken>();

  // Per-connection refresh mutex: connectionId → Promise<void>
  private mutexes = new Map<string, Promise<void>>();

  constructor(deps: CredentialManagerDeps) {
    this.providerRegistry = new ProviderRegistry();
    this.vault = new CredentialTokenVault(deps.storage);
    this.store = new ConnectionStore(deps.storage);
    this.apiKeyStore = new ApiKeyConnectionStore(deps.storage);
    this.emitNexusState = deps.emitNexusState;
    this.emitCredentialEvent = deps.emitCredentialEvent;
    this.flowRunnerFactory = deps.flowRunnerFactory ?? (() => new OAuthFlowRunner());
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  // ── ICredentialManager ─────────────────────────────────────────────────────

  async getTokenForGrant(
    provider: string,
    agentId: string,
    siteId: string,
    manifestScopes?: string[],
  ): Promise<AccessToken> {
    const grant = this.findGrant(provider, agentId, siteId);
    if (!grant) throw new NotConnectedError(provider);

    const conn = this.store.getConnection(grant.connectionId);
    if (!conn) throw new NotConnectedError(provider);
    if (conn.status === 'revoked') throw new RevokedError(provider);

    if (manifestScopes && manifestScopes.length > 0) {
      const scopesMissing = manifestScopes.some(s => !conn.grantedScopes.includes(s));
      if (scopesMissing) throw new ScopeInsufficientError(provider);
    }

    return this.withMutex(grant.connectionId, async () => {
      const cached = this.tokenCache.get(grant.connectionId);
      if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        return { token: cached.token, expiresAt: new Date(cached.expiresAt).toISOString(), scopes: cached.scopes };
      }
      return this.refreshToken(conn, provider);
    });
  }

  async getStatusForAgent(
    provider: string,
    agentId: string,
    siteId: string,
  ): Promise<'connected' | 'not_connected' | 'revoked'> {
    // OAuth path
    const grant = this.findGrant(provider, agentId, siteId);
    if (grant) {
      const conn = this.store.getConnection(grant.connectionId);
      if (!conn) return 'not_connected';
      if (conn.status === 'revoked') return 'revoked';
      return 'connected';
    }
    // api_key fallthrough — no OAuth grant, check ApiKeyConnectionStore
    const apiKeyConns = this.apiKeyStore.list(provider);
    if (apiKeyConns.some(c => c.status === 'active')) return 'connected';
    if (apiKeyConns.some(c => c.status === 'revoked')) return 'revoked';
    return 'not_connected';
  }

  async requestConnectionForAgent(
    provider: string,
    agentId: string,
    siteId: string,
    meta?: {
      scopes?: string[];
      agentName?: string;
      reason?: string;
      scopeLabels?: Record<string, string>;
    },
  ): Promise<void> {
    this.emitNexusState({ credentialConnectRequest: { provider, agentId, siteId, ...meta } });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async connect(provider: string, agentId: string, siteId: string, scopes: string[]): Promise<void> {
    const cfg = this.providerRegistry.get(provider);
    if (!cfg) throw new ProviderNotConfiguredError(provider);

    const runner = this.flowRunnerFactory();
    const result = await runner.run(cfg, scopes, this.emitNexusState);

    if (result.outcome !== 'success') return;

    const connectionId = crypto.randomUUID();
    const conn: Connection = {
      id: connectionId,
      provider: provider as 'google',
      accountLabel: result.accountLabel,
      grantedScopes: result.scopes,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastRefreshedAt: null,
    };

    this.vault.store(connectionId, provider, result.refreshToken);
    this.tokenCache.set(connectionId, {
      token: result.accessToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
      scopes: result.scopes,
    });
    this.store.saveConnection(conn);
    this.store.saveGrant({ connectionId, agentId, siteId, scopes });

    this.emitCredentialEvent({ type: 'credential:connected', provider, scopes: result.scopes });
  }

  async disconnect(connectionId: string): Promise<void> {
    const conn = this.store.getConnection(connectionId);
    if (!conn) return;

    // Best-effort revocation (do not use injected fetchFn — this is fire-and-forget)
    const cfg = this.providerRegistry.get(conn.provider);
    if (cfg) {
      const rt = this.vault.retrieve(connectionId, conn.provider);
      if (rt) {
        fetch(cfg.revocationEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(rt)}`,
        }).catch(() => {});
      }
    }

    this.vault.delete(connectionId, conn.provider);
    this.tokenCache.delete(connectionId);
    this.store.deleteGrantsForConnection(connectionId);
    this.store.deleteConnection(connectionId);
    this.emitCredentialEvent({ type: 'credential:revoked', provider: conn.provider });
  }

  // ── API Key Credentials ────────────────────────────────────────────────────

  async setApiKey(
    provider: string,
    fields: { accessKeyId: string; secretAccessKey: string },
    label: string,
  ): Promise<string> {
    const connectionId = crypto.randomUUID();
    this.vault.storeApiKey(connectionId, provider, fields);
    this.apiKeyStore.save({
      id: connectionId,
      provider,
      label,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    this.emitCredentialEvent({ type: 'credential:connected', provider });
    return connectionId;
  }

  listApiKeyConnections(provider?: string): ApiKeyConnection[] {
    return this.apiKeyStore.list(provider);
  }

  async getSecretForAgent(provider: string, _agentId: string): Promise<Record<string, string>> {
    const active = this.apiKeyStore.list(provider).find(c => c.status === 'active');
    if (!active) throw new NotConnectedError(provider);
    const fields = this.vault.retrieveApiKey(active.id, provider);
    if (!fields) throw new NotConnectedError(provider);
    return fields;
  }

  markApiKeyRevoked(provider: string): void {
    const active = this.apiKeyStore.list(provider).find(c => c.status === 'active');
    if (!active) return;
    this.apiKeyStore.markRevoked(active.id);
    this.emitCredentialEvent({ type: 'credential:revoked', provider });
  }

  clearApiKey(connectionId: string): void {
    const conn = this.apiKeyStore.get(connectionId);
    if (!conn) return;
    this.vault.deleteApiKey(connectionId, conn.provider);
    this.apiKeyStore.markRevoked(connectionId);
    this.emitCredentialEvent({ type: 'credential:revoked', provider: conn.provider });
  }

  async handleRefreshFailure(connectionId: string, reason: string): Promise<void> {
    if (reason !== 'invalid_grant') return;
    const conn = this.store.getConnection(connectionId);
    if (!conn) return;

    this.vault.delete(connectionId, conn.provider);
    this.tokenCache.delete(connectionId);
    this.store.saveConnection({ ...conn, status: 'revoked' });
    this.emitCredentialEvent({ type: 'credential:revoked', provider: conn.provider });
  }

  listConnections(): Connection[] {
    return this.store.listConnections();
  }

  /**
   * Multiple connected accounts (2026-08-26, the web-analytics ask): the
   * ACTIVE connections this agent+site holds a grant on — the store was
   * always multi-connection; this is the reach path catching up. The grant
   * is the boundary: a connection that exists but was never granted to this
   * agent is not in this list.
   */
  listGrantedConnections(provider: string, agentId: string, siteId: string): Connection[] {
    return this.store
      .listConnections()
      .filter((c) => c.provider === provider && c.status === 'active')
      .filter((c) => !!this.store.getGrant(c.id, agentId, siteId));
  }

  /**
   * The NAMED account's token — `getTokenForGrant` pinned to one connection.
   * Grant-gated exactly like the unpinned form: naming a connection an agent
   * was never granted refuses, because reach comes from the grant, not from
   * the connection's existence.
   */
  async getTokenForConnection(
    provider: string,
    agentId: string,
    siteId: string,
    connectionId: string,
    manifestScopes?: string[],
  ): Promise<AccessToken> {
    const grant = this.store.getGrant(connectionId, agentId, siteId);
    if (!grant) throw new NotConnectedError(provider);

    const conn = this.store.getConnection(connectionId);
    if (!conn || conn.provider !== provider) throw new NotConnectedError(provider);
    if (conn.status === 'revoked') throw new RevokedError(provider);

    if (manifestScopes && manifestScopes.length > 0) {
      const scopesMissing = manifestScopes.some(s => !conn.grantedScopes.includes(s));
      if (scopesMissing) throw new ScopeInsufficientError(provider);
    }

    return this.withMutex(connectionId, async () => {
      const cached = this.tokenCache.get(connectionId);
      if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        return { token: cached.token, expiresAt: new Date(cached.expiresAt).toISOString(), scopes: cached.scopes };
      }
      return this.refreshToken(conn, provider);
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private findGrant(provider: string, agentId: string, siteId: string): Grant | null {
    // Find any active connection for this provider that has a grant for this agent+site
    const connections = this.store.listConnections().filter(
      c => c.provider === provider && c.status === 'active',
    );
    for (const conn of connections) {
      const grant = this.store.getGrant(conn.id, agentId, siteId);
      if (grant) return grant;
    }
    return null;
  }

  private async refreshToken(conn: Connection, provider: string): Promise<AccessToken> {
    const rt = this.vault.retrieve(conn.id, provider);
    if (!rt) throw new RevokedError(provider);

    const cfg = this.providerRegistry.get(provider);
    if (!cfg) throw new ProviderNotConfiguredError(provider);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      try {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: rt,
          client_id: cfg.clientId,
          // Google requires client_secret on the refresh grant exactly as it does on the initial
          // code exchange. Omitting it here — while exchangeCode sent it — meant every connection
          // worked until its first access token expired (~1 hour) and then failed forever, which
          // reads as "it broke on its own" rather than as a missing credential.
          ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
        });

        const res = await this.fetchFn(cfg.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string; error_description?: string };
          if (errBody.error === 'invalid_grant') {
            await this.handleRefreshFailure(conn.id, 'invalid_grant');
            throw new RevokedError(provider);
          }
          // Every Google OAuth failure is a 400; the body is the only thing that distinguishes
          // `invalid_client` (missing/wrong secret) from the rest, so it has to survive.
          const detail = errBody.error
            ? ` — ${errBody.error}${errBody.error_description ? `: ${errBody.error_description}` : ''}`
            : '';
          throw new Error(`Refresh failed: ${res.status}${detail}`);
        }

        const data = await res.json() as { access_token: string; expires_in: number; scope?: string };
        const expiresAt = Date.now() + data.expires_in * 1000;
        const scopes = data.scope ? data.scope.split(' ') : conn.grantedScopes;

        this.tokenCache.set(conn.id, { token: data.access_token, expiresAt, scopes });
        this.store.saveConnection({ ...conn, lastRefreshedAt: new Date().toISOString() });

        return { token: data.access_token, expiresAt: new Date(expiresAt).toISOString(), scopes };
      } catch (err) {
        if (err instanceof RevokedError) throw err;
        lastErr = err;
        if (attempt < MAX_REFRESH_RETRIES) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }
    // Carry the last real reason. `TemporarilyUnavailableError` alone said "failed after retries",
    // which describes the loop rather than the fault and sent the user to reconnect an account
    // that was never the problem.
    throw new TemporarilyUnavailableError(
      provider,
      lastErr instanceof Error ? lastErr.message : undefined,
    );
  }

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.mutexes.has(key)) {
      await this.mutexes.get(key);
    }
    let release!: () => void;
    const lock = new Promise<void>(r => { release = r; });
    this.mutexes.set(key, lock);
    try {
      return await fn();
    } finally {
      this.mutexes.delete(key);
      release();
    }
  }

  // ── Test helpers (only called in tests via _test prefix) ──────────────────

  async _testInjectConnectionAndGrant(
    connectionId: string,
    agentId: string,
    siteId: string,
    scopes: string[],
    accessToken: string,
    refreshToken: string,
    accessTokenOffsetMs = 3_600_000,
  ): Promise<void> {
    const conn: Connection = {
      id: connectionId,
      provider: 'google',
      accountLabel: 'test@example.com',
      grantedScopes: scopes,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastRefreshedAt: null,
    };
    this.store.saveConnection(conn);
    this.store.saveGrant({ connectionId, agentId, siteId, scopes });
    this.vault.store(connectionId, 'google', refreshToken);
    this.tokenCache.set(connectionId, {
      token: accessToken,
      expiresAt: Date.now() + accessTokenOffsetMs,
      scopes,
    });
  }
}
