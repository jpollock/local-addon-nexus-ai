// ─── Data models ─────────────────────────────────────────────────────────────

export interface Connection {
  id: string;
  provider: 'google';
  accountLabel: string;        // Google email, for display only
  /** Google's stable account id (`sub` from userinfo). The dedupe key for same-account
   * reconnects; absent on connections made before it was captured. */
  accountSub?: string;
  grantedScopes: string[];
  status: 'active' | 'revoked' | 'error';
  createdAt: string;           // ISO timestamp
  lastRefreshedAt: string | null;
}

export interface Grant {
  connectionId: string;
  agentId: string;
  siteId: string;
  scopes: string[];            // ⊆ connection.grantedScopes
}

export interface ApiKeyConnection {
  id: string;
  provider: string;
  label: string;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface AccessToken {
  token: string;
  expiresAt: string;           // ISO timestamp
  scopes: string[];
}

// ─── Credential declaration (goes in AgentDefinition.credentials) ─────────────

/** OAuth credential declaration (e.g. Google) */
export interface OAuthCredentialDeclaration {
  provider: 'google';
  type?: 'oauth';
  scopes: string[];
  optional?: boolean;
  reason: string;              // shown verbatim in consent prompt
}

/** API-key credential declaration (e.g. AWS access key + secret) */
export interface ApiKeyCredentialDeclaration {
  provider: string;
  type: 'api_key';
  optional?: boolean;
  reason: string;
}

export type CredentialDeclaration = OAuthCredentialDeclaration | ApiKeyCredentialDeclaration;

// ─── OAuth flow result ────────────────────────────────────────────────────────

export type FlowResult =
  | { outcome: 'success'; accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; accountLabel: string; accountSub?: string }
  | { outcome: 'cancelled' }
  | { outcome: 'state_mismatch' }
  /** The user consented but the flow could not be completed — token exchange rejected, network
   * failure, or a malformed response. Distinct from 'cancelled' because the user did their part:
   * reporting it as a cancellation makes a real fault look like a choice, and the flow ends with
   * nothing on screen. */
  | { outcome: 'error'; message: string };

// ─── IPC events ───────────────────────────────────────────────────────────────

export type CredentialEventType = 'credential:connected' | 'credential:revoked' | 'credential:scope_added';

export interface CredentialEvent {
  type: CredentialEventType;
  provider: string;
  scopes?: string[];
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class NotConnectedError extends Error {
  constructor(provider: string) {
    super(`No valid grant for provider "${provider}"`);
    this.name = 'NotConnectedError';
  }
}

export class RevokedError extends Error {
  constructor(provider: string) {
    super(`Connection for provider "${provider}" was revoked`);
    this.name = 'RevokedError';
  }
}

export class ScopeInsufficientError extends Error {
  constructor(provider: string) {
    super(`Grant for provider "${provider}" does not cover the requested scopes`);
    this.name = 'ScopeInsufficientError';
  }
}

export class SafeStorageUnavailableError extends Error {
  constructor() {
    super('Electron safeStorage is not available on this system — cannot store OAuth tokens');
    this.name = 'SafeStorageUnavailableError';
  }
}

export class TemporarilyUnavailableError extends Error {
  /** `reason` is the last real failure from the refresh attempts. Without it the message
   * described the retry loop rather than the fault, which pointed users at reconnecting an
   * account that was never the problem. */
  constructor(provider: string, reason?: string) {
    super(
      `Token refresh for provider "${provider}" failed after retries`
      + (reason ? ` — last error: ${reason}` : ''),
    );
    this.name = 'TemporarilyUnavailableError';
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" is not configured (missing client ID)`);
    this.name = 'ProviderNotConfiguredError';
  }
}
