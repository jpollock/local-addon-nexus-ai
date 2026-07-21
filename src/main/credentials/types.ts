// ─── Data models ─────────────────────────────────────────────────────────────

export interface Connection {
  id: string;
  provider: 'google';
  accountLabel: string;        // Google email, for display only
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

export interface AccessToken {
  token: string;
  expiresAt: string;           // ISO timestamp
  scopes: string[];
}

// ─── Credential declaration (goes in AgentDefinition.credentials) ─────────────

export interface CredentialDeclaration {
  provider: 'google';
  scopes: string[];
  optional?: boolean;
  reason: string;              // shown verbatim in consent prompt
}

// ─── OAuth flow result ────────────────────────────────────────────────────────

export type FlowResult =
  | { outcome: 'success'; accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; accountLabel: string }
  | { outcome: 'cancelled' }
  | { outcome: 'state_mismatch' };

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
  constructor(provider: string) {
    super(`Token refresh for provider "${provider}" failed after retries`);
    this.name = 'TemporarilyUnavailableError';
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" is not configured (missing client ID)`);
    this.name = 'ProviderNotConfiguredError';
  }
}
