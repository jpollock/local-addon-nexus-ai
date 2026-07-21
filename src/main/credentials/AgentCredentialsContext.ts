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
   * Get the status of a connection for a provider (active, revoked, or error).
   */
  getStatus(provider: string): Promise<'active' | 'revoked' | 'error'>;

  /**
   * Request a new connection for a provider. Prompts the user to authorize.
   */
  requestConnection(provider: string): Promise<void>;
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
   */
  getTokenForGrant(provider: string, agentId: string, siteId: string): Promise<AccessToken>;

  /**
   * Get the status of a connection for a provider.
   */
  getStatusForAgent(provider: string, agentId: string, siteId: string): Promise<'active' | 'revoked' | 'error'>;

  /**
   * Request a new connection or expanded scopes for a provider.
   * Prompts the user to authorize.
   */
  requestConnectionForAgent(provider: string, agentId: string, siteId: string): Promise<void>;
}

/**
 * AgentCredentialsContext is a scope-filtering proxy that agents call.
 * It enforces that agents only receive tokens with scopes they declared in their manifest.
 *
 * Usage:
 *   const credentials = new AgentCredentialsContext(manager, agentManifest, agentId, siteId);
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

  constructor(
    private manager: ICredentialManager,
    credentials: CredentialDeclaration[],
    private agentId: string,
    private siteId: string,
  ) {
    this.declaredScopes = new Map();
    for (const decl of credentials) {
      this.declaredScopes.set(decl.provider, new Set(decl.scopes));
    }
  }

  async getToken(provider: string): Promise<AccessToken> {
    // Check that the provider is in the agent's manifest
    if (!this.declaredScopes.has(provider)) {
      throw new NotConnectedError(provider);
    }

    // Get the raw token from the manager
    const token = await this.manager.getTokenForGrant(provider, this.agentId, this.siteId);

    // Filter to only declared scopes
    const declared = this.declaredScopes.get(provider)!;
    const filteredScopes = token.scopes.filter(scope => declared.has(scope));

    return {
      token: token.token,
      expiresAt: token.expiresAt,
      scopes: filteredScopes,
    };
  }

  async getStatus(provider: string): Promise<'active' | 'revoked' | 'error'> {
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

    return this.manager.requestConnectionForAgent(provider, this.agentId, this.siteId);
  }
}
