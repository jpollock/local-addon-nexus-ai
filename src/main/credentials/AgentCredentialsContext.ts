import type { CredentialDeclaration, AccessToken } from './types';
import { NotConnectedError } from './types';

/**
 * Public surface agents call to get OAuth tokens or manage connections.
 * Agents do not call ICredentialManager directly — they call AgentCredentialsContext,
 * which delegates to the manager and filters token scopes to only those in the agent's manifest.
 */
export interface AgentCredentials {
  /**
   * Get an access token for a provider, filtered to only the scopes the agent declared.
   * Throws NotConnectedError if no valid grant exists.
   */
  getToken(provider: string): Promise<AccessToken>;

  /**
   * Get the agent-facing status of a connection for a provider.
   * Returns 'connected', 'not_connected', or 'revoked'.
   */
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;

  /**
   * Request a new connection for a provider. Prompts the user to authorize.
   */
  requestConnection(provider: string): Promise<void>;

  /**
   * Get raw key/value fields for an api_key credential declared in the manifest.
   * Throws NotConnectedError if the provider was not declared as api_key type.
   */
  getSecret?(provider: string): Promise<Record<string, string>>;

  /**
   * Signal to the platform that stored credentials for this provider are invalid.
   * Marks the connection revoked in the credential store. Best-effort; never throws.
   */
  revokeCredential?(provider: string): Promise<void>;
}

/**
 * Interface for the credential manager that AgentCredentialsContext delegates to.
 * Implemented by CredentialManager (Task 7).
 */
export interface ICredentialManager {
  /**
   * Get an access token for a provider, applying any automatic token refresh.
   * Does NOT filter scopes — raw token from vault.
   * Throws NotConnectedError if no grant exists for the agent on this site.
   * @param manifestScopes - Optional scopes from the agent manifest; used to validate
   *                         the connection covers the required scopes.
   */
  getTokenForGrant(provider: string, agentId: string, siteId: string, manifestScopes?: string[]): Promise<AccessToken>;

  /**
   * Get the agent-facing status of a connection for a provider.
   * Returns the agent-facing enum: 'connected', 'not_connected', or 'revoked'.
   */
  getStatusForAgent(provider: string, agentId: string, siteId: string): Promise<'connected' | 'not_connected' | 'revoked'>;

  /**
   * Request a new connection or expanded scopes for a provider.
   * Prompts the user to authorize.
   */
  requestConnectionForAgent(
    provider: string,
    agentId: string,
    siteId: string,
    meta?: {
      scopes?: string[];
      agentName?: string;
      reason?: string;
      scopeLabels?: Record<string, string>;
    },
  ): Promise<void>;

  /**
   * Get raw key/value fields for an api_key credential.
   * Returns all stored fields (e.g. accessKeyId + secretAccessKey for AWS).
   */
  getSecretForAgent(provider: string, agentId: string): Promise<Record<string, string>>;
  /**
   * Multiple connected accounts (2026-08-26): the connections this agent+site
   * was granted, and a token pinned to a NAMED one. Optional on the interface
   * so partial test doubles and the no-manager fallback keep compiling; the
   * context degrades to empty/refused when absent.
   */
  listGrantedConnections?(provider: string, agentId: string, siteId: string): Array<{
    id: string; provider: string; accountLabel: string; status: string;
  }>;
  getTokenForConnection?(
    provider: string, agentId: string, siteId: string, connectionId: string, manifestScopes?: string[],
  ): Promise<AccessToken>;

  /**
   * Mark an api_key connection as revoked in the credential store.
   * Used when the agent detects that its credentials are invalid.
   */
  markApiKeyRevoked(provider: string): void;
}

export interface AgentCredentialsContextOpts {
  agentId: string;
  siteId: string;
  manifestCredentials: CredentialDeclaration[];
  manager: ICredentialManager;
}

/**
 * AgentCredentialsContext is a scope-filtering proxy that agents call.
 * It enforces that agents only receive tokens with scopes they declared in their manifest.
 *
 * Usage:
 *   const credentials = new AgentCredentialsContext({ manager, manifestCredentials, agentId, siteId });
 *   const token = await credentials.getToken('google'); // throws if not in manifest
 *   const status = await credentials.getStatus('google');
 *   await credentials.requestConnection('google');
 */
export class AgentCredentialsContext implements AgentCredentials {
  /**
   * Map of provider → scopes from the agent's credential declarations.
   * If a provider is not in this map, the agent did not declare it.
   */
  private declaredScopes: Map<string, Set<string>>;
  /** Full declarations keyed by provider — used to pass metadata to the consent UI. */
  private declarations: Map<string, CredentialDeclaration>;
  /** Set of providers declared as api_key type — gates getSecret() access. */
  private declaredApiKeyProviders: Set<string>;
  private manager: ICredentialManager;
  private agentId: string;
  private siteId: string;

  constructor(opts: AgentCredentialsContextOpts) {
    this.agentId = opts.agentId;
    this.siteId = opts.siteId;
    this.manager = opts.manager;
    this.declaredScopes = new Map();
    this.declarations = new Map();
    this.declaredApiKeyProviders = new Set();
    for (const decl of opts.manifestCredentials) {
      this.declaredScopes.set(decl.provider, new Set('scopes' in decl ? decl.scopes : []));
      this.declarations.set(decl.provider, decl);
      if ('type' in decl && decl.type === 'api_key') {
        this.declaredApiKeyProviders.add(decl.provider);
      }
    }
  }

  async getToken(provider: string): Promise<AccessToken> {
    // Check that the provider is in the agent's manifest
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }

    // Get the raw token from the manager, passing manifest scopes for validation
    const declared = this.declaredScopes.get(provider)!;
    const manifestScopes = Array.from(declared);
    const token = await this.manager.getTokenForGrant(provider, this.agentId, this.siteId, manifestScopes);

    // Filter to only declared scopes
    const filteredScopes = token.scopes.filter(scope => declared.has(scope));

    return {
      token: token.token,
      expiresAt: token.expiresAt,
      scopes: filteredScopes,
    };
  }

  /**
   * The Google accounts this agent may use — id + label per connection, so an
   * agent can enumerate accounts and label what came from where. Empty when
   * none are granted (or the manager predates multi-account). Manifest-gated
   * like every other method here.
   */
  async listConnections(
    provider: string
  ): Promise<Array<{ connectionId: string; accountLabel: string; status: string }>> {
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }
    const list = this.manager.listGrantedConnections?.(provider, this.agentId, this.siteId) ?? [];
    return list.map((c) => ({ connectionId: c.id, accountLabel: c.accountLabel, status: c.status }));
  }

  /**
   * The NAMED account's token — `getToken` pinned to one connection, with the
   * identical manifest-scope validation and declared-scope filtering.
   */
  async getTokenFor(provider: string, connectionId: string): Promise<AccessToken> {
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }
    if (!this.manager.getTokenForConnection) {
      throw new NotConnectedError(provider);
    }
    const declared = this.declaredScopes.get(provider)!;
    const manifestScopes = Array.from(declared);
    const token = await this.manager.getTokenForConnection(
      provider, this.agentId, this.siteId, connectionId, manifestScopes,
    );
    return {
      token: token.token,
      expiresAt: token.expiresAt,
      scopes: token.scopes.filter((scope) => declared.has(scope)),
    };
  }

  async getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'> {
    // Check that the provider is in the agent's manifest
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }

    return this.manager.getStatusForAgent(provider, this.agentId, this.siteId);
  }

  async requestConnection(provider: string): Promise<void> {
    // Check that the provider is in the agent's manifest
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }

    // Find the matching declaration so the consent UI can show scopes and reason
    const decl = this.declarations.get(provider);
    return this.manager.requestConnectionForAgent(provider, this.agentId, this.siteId, {
      scopes: (decl && 'scopes' in decl) ? decl.scopes : [],
      agentName: this.agentId,
      reason: decl?.reason,
    });
  }

  async getSecret(provider: string): Promise<Record<string, string>> {
    // Access gate: only callable by agents that declared this provider as api_key
    if (!this.declaredApiKeyProviders.has(provider)) {
      throw new NotConnectedError(provider);
    }
    return this.manager.getSecretForAgent(provider, this.agentId);
  }

  async revokeCredential(provider: string): Promise<void> {
    // Best-effort: never throws
    try {
      if (this.declaredApiKeyProviders.has(provider)) {
        this.manager.markApiKeyRevoked(provider);
      }
    } catch { /* best-effort */ }
  }
}
