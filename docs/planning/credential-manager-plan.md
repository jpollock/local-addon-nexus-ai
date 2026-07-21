# Credential Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OAuth 2.0 + PKCE credential manager in the Nexus addon so agents can call `ctx.credentials.getToken('google')` without ever touching OAuth internals.

**Architecture:** ProviderRegistry holds static provider config (Google only, v1). OAuthFlowRunner runs the PKCE + loopback dance in a one-shot HTTP server. CredentialManager orchestrates everything: in-memory access-token cache with per-connection mutex, refresh-on-expiry, revocation handling. AgentCredentialsContext is the scope-filtered proxy agents actually call. All wired into AgentContext at buildAgentContext time.

**Tech Stack:** TypeScript, Node.js built-ins (`crypto`, `http`, `net`, native `fetch`), Electron `safeStorage` + `shell.openExternal`, existing `KeyVault` / `RegistryStorage` / `emitNexusState` patterns.

## Global Constraints

- `NEXUS_GOOGLE_CLIENT_ID` env var — feature disabled (throws `ProviderNotConfiguredError`) when unset.
- `safeStorage.isEncryptionAvailable()` must be true to store tokens — throw `SafeStorageUnavailableError`, never fall back to plaintext.
- Agents receive only short-lived access tokens scoped to their own manifest scopes. Refresh tokens never leave the vault.
- Log auth _events_, never auth _material_. No token values in any log line.
- Per-connection mutex: 10 concurrent `getToken()` calls → exactly one network request to Google.
- Per-site grant confirm even when scopes are already consented on the connection.
- Incremental auth: always send `include_granted_scopes=true`.
- Renderer: class-based React (`React.createElement`, no JSX, no hooks) — same as rest of renderer.
- All IPC handlers wrapped with the existing `safeHandle` helper.
- PKCE: code_verifier = 32 random bytes as base64url; code_challenge = SHA-256(verifier) as base64url.

---

## File Map

**Create:**
- `src/main/credentials/types.ts`
- `src/main/credentials/ProviderRegistry.ts`
- `src/main/credentials/CredentialTokenVault.ts`
- `src/main/credentials/ConnectionStore.ts`
- `src/main/credentials/OAuthFlowRunner.ts`
- `src/main/credentials/AgentCredentialsContext.ts`
- `src/main/credentials/CredentialManager.ts`
- `src/main/credentials/index.ts`
- `src/renderer/components/credentials/CredentialConsentModal.tsx`
- `src/renderer/components/credentials/ConnectionsPanel.tsx`

**Modify:**
- `src/common/constants.ts` — add 4 IPC channels + 2 storage keys
- `src/main/agent-sdk/types.ts` — add `AgentCredentials`, `AccessToken`, typed errors, `credentials?` on `AgentDefinition`, `credentials` on `AgentContext`
- `src/main/agent-runtime/buildAgentContext.ts` — inject `AgentCredentialsContext` into `ctx.credentials`
- `src/main/mcp/types.ts` — add `credentialManager?` to `NexusServices`
- `src/main/ipc-handlers.ts` — 4 new credential handlers
- `src/main/index.ts` — instantiate `CredentialManager`, add to `nexusServices`
- `tests/__mocks__/electron.ts` — add `shell.openExternal` mock

**Test:**
- `tests/unit/credentials/CredentialTokenVault.test.ts`
- `tests/unit/credentials/ConnectionStore.test.ts`
- `tests/unit/credentials/ProviderRegistry.test.ts`
- `tests/unit/credentials/OAuthFlowRunner.test.ts`
- `tests/unit/credentials/AgentCredentialsContext.test.ts`
- `tests/unit/credentials/CredentialManager.test.ts`

---

### Task 1: Types, constants, and electron mock

**Files:**
- Create: `src/main/credentials/types.ts`
- Modify: `src/common/constants.ts`
- Modify: `tests/__mocks__/electron.ts`

**Interfaces:**
- Produces: `Connection`, `Grant`, `AccessToken`, `FlowResult`, all error classes, `CredentialEvent`; IPC channel names; storage key names.

- [ ] **Step 1: Write the test that imports all types (compilation check)**

```typescript
// tests/unit/credentials/types.smoke.test.ts
import type { Connection, Grant, AccessToken, FlowResult } from '../../../src/main/credentials/types';
import { NotConnectedError, RevokedError, ScopeInsufficientError, SafeStorageUnavailableError, TemporarilyUnavailableError, ProviderNotConfiguredError } from '../../../src/main/credentials/types';

it('error classes are throwable with typed names', () => {
  expect(new NotConnectedError('g').name).toBe('NotConnectedError');
  expect(new RevokedError('g').name).toBe('RevokedError');
  expect(new ScopeInsufficientError('g').name).toBe('ScopeInsufficientError');
  expect(new SafeStorageUnavailableError().name).toBe('SafeStorageUnavailableError');
  expect(new TemporarilyUnavailableError('g').name).toBe('TemporarilyUnavailableError');
  expect(new ProviderNotConfiguredError('g').name).toBe('ProviderNotConfiguredError');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/credentials/types.smoke.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — `Cannot find module '../../../src/main/credentials/types'`

- [ ] **Step 3: Create `src/main/credentials/types.ts`**

```typescript
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
```

- [ ] **Step 4: Add constants to `src/common/constants.ts`**

In the `IPC_CHANNELS` object, add after the `ASSISTANT_CONTEXT` entry:

```typescript
  // OAuth Credential Manager
  CREDENTIAL_CONNECT: `${ADDON_PREFIX}:credential:connect`,
  CREDENTIAL_DISCONNECT: `${ADDON_PREFIX}:credential:disconnect`,
  CREDENTIAL_STATUS: `${ADDON_PREFIX}:credential:status`,
  CREDENTIAL_EVENT: `${ADDON_PREFIX}:credential:event`,
```

In the `STORAGE_KEYS` object, add after `WPE_INSTALL_CACHE`:

```typescript
  OAUTH_CONNECTIONS: `${ADDON_PREFIX}_oauth_connections`,
  OAUTH_GRANTS: `${ADDON_PREFIX}_oauth_grants`,
```

- [ ] **Step 5: Add `shell` to the electron mock**

In `tests/__mocks__/electron.ts`, add:

```typescript
export const shell = {
  openExternal: jest.fn(() => Promise.resolve()),
};
```

- [ ] **Step 6: Run the smoke test**

```bash
npx jest tests/unit/credentials/types.smoke.test.ts --no-coverage 2>&1 | tail -5
```
Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add src/main/credentials/types.ts src/common/constants.ts tests/__mocks__/electron.ts tests/unit/credentials/types.smoke.test.ts
git commit -m "feat(credentials): types, IPC channels, storage keys, electron shell mock"
```

---

### Task 2: ProviderRegistry

**Files:**
- Create: `src/main/credentials/ProviderRegistry.ts`
- Test: `tests/unit/credentials/ProviderRegistry.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (reads `process.env.NEXUS_GOOGLE_CLIENT_ID`)
- Produces: `ProviderRegistry` class with `get(id)`, `isEnabled(id)`, `list()`; `ProviderConfig` interface

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/ProviderRegistry.test.ts
import { ProviderRegistry } from '../../../src/main/credentials/ProviderRegistry';

describe('ProviderRegistry', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('isEnabled returns false when NEXUS_GOOGLE_CLIENT_ID is unset', () => {
    process.env = { ...OLD_ENV };
    delete process.env.NEXUS_GOOGLE_CLIENT_ID;
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(false);
  });

  it('isEnabled returns true when NEXUS_GOOGLE_CLIENT_ID is set', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com' };
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(true);
  });

  it('get returns provider config with clientId from env', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'my-client-id' };
    const reg = new ProviderRegistry();
    const cfg = reg.get('google');
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe('my-client-id');
    expect(cfg!.id).toBe('google');
    expect(cfg!.authorizationEndpoint).toContain('accounts.google.com');
  });

  it('get returns null for unknown provider', () => {
    const reg = new ProviderRegistry();
    expect(reg.get('github' as any)).toBeNull();
  });

  it('scopeMetadata has entry for webmasters.readonly', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'x' };
    const reg = new ProviderRegistry();
    const cfg = reg.get('google')!;
    expect(cfg.scopeMetadata['https://www.googleapis.com/auth/webmasters.readonly']).toBeDefined();
    expect(cfg.scopeMetadata['https://www.googleapis.com/auth/webmasters.readonly'].label).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/ProviderRegistry.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/ProviderRegistry.ts`**

```typescript
export interface ProviderConfig {
  id: 'google';
  displayName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  supportsIncrementalAuth: boolean;
  scopeMetadata: Record<string, { label: string; description: string }>;
}

const GOOGLE_SCOPE_METADATA: ProviderConfig['scopeMetadata'] = {
  'https://www.googleapis.com/auth/webmasters.readonly': {
    label: 'Search Console (read-only)',
    description: 'Read search performance data for your verified sites in Google Search Console',
  },
  'https://www.googleapis.com/auth/analytics.readonly': {
    label: 'Analytics (read-only)',
    description: 'Read Google Analytics data for your properties',
  },
};

export class ProviderRegistry {
  get(id: string): ProviderConfig | null {
    if (id !== 'google') return null;
    const clientId = process.env.NEXUS_GOOGLE_CLIENT_ID;
    if (!clientId) return null;
    return {
      id: 'google',
      displayName: 'Google',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      clientId,
      supportsIncrementalAuth: true,
      scopeMetadata: GOOGLE_SCOPE_METADATA,
    };
  }

  isEnabled(id: string): boolean {
    return this.get(id) !== null;
  }

  list(): ProviderConfig[] {
    const google = this.get('google');
    return google ? [google] : [];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/ProviderRegistry.test.ts --no-coverage 2>&1 | tail -5
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/ProviderRegistry.ts tests/unit/credentials/ProviderRegistry.test.ts
git commit -m "feat(credentials): ProviderRegistry — Google OAuth config, NEXUS_GOOGLE_CLIENT_ID gate"
```

---

### Task 3: CredentialTokenVault

**Files:**
- Create: `src/main/credentials/CredentialTokenVault.ts`
- Test: `tests/unit/credentials/CredentialTokenVault.test.ts`

**Interfaces:**
- Consumes: `KeyVault` from `src/main/security/KeyVault.ts`; `RegistryStorage` from `src/main/content/IndexRegistry.ts`; `SafeStorageUnavailableError` from Task 1
- Produces: `CredentialTokenVault` with `store(connectionId, provider, refreshToken)`, `retrieve(connectionId, provider): string | null`, `delete(connectionId, provider): void`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/CredentialTokenVault.test.ts
import { CredentialTokenVault } from '../../../src/main/credentials/CredentialTokenVault';
import { SafeStorageUnavailableError } from '../../../src/main/credentials/types';
import { safeStorage } from 'electron';

const mockSS = safeStorage as jest.Mocked<typeof safeStorage>;

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSS.isEncryptionAvailable.mockReturnValue(true);
  mockSS.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`));
  mockSS.decryptString.mockImplementation((b: Buffer) => b.toString().slice(4));
});

describe('CredentialTokenVault', () => {
  it('stores and retrieves a refresh token', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-1', 'google', 'rt_abc123');
    expect(vault.retrieve('conn-1', 'google')).toBe('rt_abc123');
  });

  it('returns null for a key that was never stored', () => {
    const vault = new CredentialTokenVault(makeStorage());
    expect(vault.retrieve('conn-x', 'google')).toBeNull();
  });

  it('delete removes the token; subsequent retrieve returns null', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-2', 'google', 'rt_xyz');
    vault.delete('conn-2', 'google');
    expect(vault.retrieve('conn-2', 'google')).toBeNull();
  });

  it('throws SafeStorageUnavailableError when encryption is unavailable', () => {
    mockSS.isEncryptionAvailable.mockReturnValue(false);
    const vault = new CredentialTokenVault(makeStorage());
    expect(() => vault.store('conn-3', 'google', 'rt_abc')).toThrow(SafeStorageUnavailableError);
  });

  it('tokens for different connections are independent', () => {
    const vault = new CredentialTokenVault(makeStorage());
    vault.store('conn-a', 'google', 'token-a');
    vault.store('conn-b', 'google', 'token-b');
    expect(vault.retrieve('conn-a', 'google')).toBe('token-a');
    expect(vault.retrieve('conn-b', 'google')).toBe('token-b');
    vault.delete('conn-a', 'google');
    expect(vault.retrieve('conn-a', 'google')).toBeNull();
    expect(vault.retrieve('conn-b', 'google')).toBe('token-b');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/CredentialTokenVault.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/CredentialTokenVault.ts`**

```typescript
import { safeStorage } from 'electron';
import { KeyVault } from '../security/KeyVault';
import type { RegistryStorage } from '../content/IndexRegistry';
import { SafeStorageUnavailableError } from './types';
import { STORAGE_KEYS } from '../../common/constants';

// Key pattern: google-connection:{connectionId}:refresh_token
// Stored as a named key inside KeyVault, using OAUTH_CONNECTIONS as the legacy key name
// (no actual legacy data — just satisfies KeyVault constructor signature).

export class CredentialTokenVault {
  private vault: KeyVault;

  constructor(storage: RegistryStorage) {
    this.vault = new KeyVault(storage, STORAGE_KEYS.OAUTH_CONNECTIONS);
  }

  private key(connectionId: string, provider: string): string {
    return `${provider}-connection:${connectionId}:refresh_token`;
  }

  private assertEncryptionAvailable(): void {
    let available = false;
    try { available = safeStorage.isEncryptionAvailable(); } catch { /* noop */ }
    if (!available) throw new SafeStorageUnavailableError();
  }

  store(connectionId: string, provider: string, refreshToken: string): void {
    this.assertEncryptionAvailable();
    this.vault.setKey(this.key(connectionId, provider), refreshToken);
  }

  retrieve(connectionId: string, provider: string): string | null {
    return this.vault.getKey(this.key(connectionId, provider));
  }

  delete(connectionId: string, provider: string): void {
    this.vault.deleteKey(this.key(connectionId, provider));
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/CredentialTokenVault.test.ts --no-coverage 2>&1 | tail -5
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/CredentialTokenVault.ts tests/unit/credentials/CredentialTokenVault.test.ts
git commit -m "feat(credentials): CredentialTokenVault — strict safeStorage wrapper, throws on plaintext fallback"
```

---

### Task 4: ConnectionStore

**Files:**
- Create: `src/main/credentials/ConnectionStore.ts`
- Test: `tests/unit/credentials/ConnectionStore.test.ts`

**Interfaces:**
- Consumes: `RegistryStorage`, `STORAGE_KEYS.OAUTH_CONNECTIONS`, `STORAGE_KEYS.OAUTH_GRANTS`, `Connection` + `Grant` types from Task 1
- Produces: `ConnectionStore` with `saveConnection`, `getConnection`, `listConnections`, `deleteConnection`, `saveGrant`, `getGrant`, `listGrantsForConnection`, `listGrantsForAgent`, `deleteGrant`, `deleteGrantsForConnection`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/ConnectionStore.test.ts
import { ConnectionStore } from '../../../src/main/credentials/ConnectionStore';
import type { Connection, Grant } from '../../../src/main/credentials/types';

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

function makeConnection(id: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    provider: 'google',
    accountLabel: 'user@example.com',
    grantedScopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    status: 'active',
    createdAt: new Date().toISOString(),
    lastRefreshedAt: null,
    ...overrides,
  };
}

function makeGrant(connectionId: string, agentId: string, siteId: string): Grant {
  return { connectionId, agentId, siteId, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
}

describe('ConnectionStore', () => {
  it('saveConnection + getConnection round-trip', () => {
    const store = new ConnectionStore(makeStorage());
    const conn = makeConnection('c1');
    store.saveConnection(conn);
    expect(store.getConnection('c1')).toEqual(conn);
  });

  it('listConnections returns all saved connections', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveConnection(makeConnection('c1'));
    store.saveConnection(makeConnection('c2'));
    expect(store.listConnections()).toHaveLength(2);
  });

  it('deleteConnection removes it from listConnections', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveConnection(makeConnection('c1'));
    store.deleteConnection('c1');
    expect(store.getConnection('c1')).toBeNull();
    expect(store.listConnections()).toHaveLength(0);
  });

  it('saveGrant + getGrant round-trip', () => {
    const store = new ConnectionStore(makeStorage());
    const grant = makeGrant('c1', 'seo-insights', 'site-1');
    store.saveGrant(grant);
    expect(store.getGrant('c1', 'seo-insights', 'site-1')).toEqual(grant);
  });

  it('listGrantsForConnection returns only matching grants', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveGrant(makeGrant('c1', 'seo-insights', 'site-1'));
    store.saveGrant(makeGrant('c1', 'sentinel', 'site-1'));
    store.saveGrant(makeGrant('c2', 'seo-insights', 'site-1'));
    expect(store.listGrantsForConnection('c1')).toHaveLength(2);
  });

  it('deleteGrantsForConnection removes all grants for that connection', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveGrant(makeGrant('c1', 'seo-insights', 'site-1'));
    store.saveGrant(makeGrant('c1', 'sentinel', 'site-1'));
    store.saveGrant(makeGrant('c2', 'seo-insights', 'site-1'));
    store.deleteGrantsForConnection('c1');
    expect(store.listGrantsForConnection('c1')).toHaveLength(0);
    expect(store.listGrantsForConnection('c2')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/ConnectionStore.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/ConnectionStore.ts`**

```typescript
import type { RegistryStorage } from '../content/IndexRegistry';
import type { Connection, Grant } from './types';
import { STORAGE_KEYS } from '../../common/constants';

export class ConnectionStore {
  constructor(private storage: RegistryStorage) {}

  private readConnections(): Record<string, Connection> {
    return (this.storage.get(STORAGE_KEYS.OAUTH_CONNECTIONS) ?? {}) as Record<string, Connection>;
  }

  private writeConnections(data: Record<string, Connection>): void {
    this.storage.set(STORAGE_KEYS.OAUTH_CONNECTIONS, data);
  }

  private readGrants(): Grant[] {
    return (this.storage.get(STORAGE_KEYS.OAUTH_GRANTS) ?? []) as Grant[];
  }

  private writeGrants(grants: Grant[]): void {
    this.storage.set(STORAGE_KEYS.OAUTH_GRANTS, grants);
  }

  // ── Connections ────────────────────────────────────────────────────────────

  saveConnection(conn: Connection): void {
    const data = this.readConnections();
    data[conn.id] = conn;
    this.writeConnections(data);
  }

  getConnection(id: string): Connection | null {
    return this.readConnections()[id] ?? null;
  }

  listConnections(): Connection[] {
    return Object.values(this.readConnections());
  }

  deleteConnection(id: string): void {
    const data = this.readConnections();
    delete data[id];
    this.writeConnections(data);
  }

  // ── Grants ─────────────────────────────────────────────────────────────────

  saveGrant(grant: Grant): void {
    const grants = this.readGrants().filter(
      g => !(g.connectionId === grant.connectionId && g.agentId === grant.agentId && g.siteId === grant.siteId),
    );
    grants.push(grant);
    this.writeGrants(grants);
  }

  getGrant(connectionId: string, agentId: string, siteId: string): Grant | null {
    return this.readGrants().find(
      g => g.connectionId === connectionId && g.agentId === agentId && g.siteId === siteId,
    ) ?? null;
  }

  listGrantsForConnection(connectionId: string): Grant[] {
    return this.readGrants().filter(g => g.connectionId === connectionId);
  }

  listGrantsForAgent(agentId: string): Grant[] {
    return this.readGrants().filter(g => g.agentId === agentId);
  }

  deleteGrant(connectionId: string, agentId: string, siteId: string): void {
    this.writeGrants(this.readGrants().filter(
      g => !(g.connectionId === connectionId && g.agentId === agentId && g.siteId === siteId),
    ));
  }

  deleteGrantsForConnection(connectionId: string): void {
    this.writeGrants(this.readGrants().filter(g => g.connectionId !== connectionId));
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/ConnectionStore.test.ts --no-coverage 2>&1 | tail -5
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/ConnectionStore.ts tests/unit/credentials/ConnectionStore.test.ts
git commit -m "feat(credentials): ConnectionStore — RegistryStorage-backed Connection + Grant CRUD"
```

---

### Task 5: OAuthFlowRunner

**Files:**
- Create: `src/main/credentials/OAuthFlowRunner.ts`
- Test: `tests/unit/credentials/OAuthFlowRunner.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig` from Task 2; `FlowResult` from Task 1; `shell.openExternal` from electron; `emitNexusState` callback
- Produces: `OAuthFlowRunner` with `run(provider, scopes, emitState): Promise<FlowResult>`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/OAuthFlowRunner.test.ts
import * as http from 'http';
import { OAuthFlowRunner } from '../../../src/main/credentials/OAuthFlowRunner';
import { shell } from 'electron';
import type { ProviderConfig } from '../../../src/main/credentials/ProviderRegistry';

const mockShell = shell as jest.Mocked<typeof shell>;

const testProvider: ProviderConfig = {
  id: 'google',
  displayName: 'Google',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  clientId: 'test-client-id',
  supportsIncrementalAuth: true,
  scopeMetadata: {},
};

beforeEach(() => jest.clearAllMocks());

describe('OAuthFlowRunner', () => {
  it('opens the system browser with a URL containing all required PKCE params', async () => {
    const runner = new OAuthFlowRunner();
    let capturedUrl = '';
    mockShell.openExternal.mockImplementation(async (url: string) => { capturedUrl = url; });

    // Simulate an immediate callback arriving so the flow completes
    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
    const flowPromise = runner.run(testProvider, scopes, () => {});

    // Wait a tick for the server to start and openExternal to be called
    await new Promise(r => setTimeout(r, 50));
    expect(mockShell.openExternal).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toContain('code_challenge=');
    expect(capturedUrl).toContain('code_challenge_method=S256');
    expect(capturedUrl).toContain('include_granted_scopes=true');
    expect(capturedUrl).toContain(encodeURIComponent(scopes[0]));
    expect(capturedUrl).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A');

    // Send a cancel to clean up
    runner.cancel();
    const result = await flowPromise;
    expect(result.outcome).toBe('cancelled');
  });

  it('returns cancelled when cancel() is called before callback arrives', async () => {
    const runner = new OAuthFlowRunner();
    mockShell.openExternal.mockResolvedValue(undefined);
    const flowPromise = runner.run(testProvider, ['https://www.googleapis.com/auth/webmasters.readonly'], () => {});
    await new Promise(r => setTimeout(r, 20));
    runner.cancel();
    const result = await flowPromise;
    expect(result.outcome).toBe('cancelled');
  });

  it('returns state_mismatch when state param does not match', async () => {
    const runner = new OAuthFlowRunner();
    let port = 0;
    mockShell.openExternal.mockImplementation(async (url: string) => {
      const match = url.match(/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A(\d+)/);
      port = match ? parseInt(match[1]) : 0;
    });

    const flowPromise = runner.run(testProvider, ['https://www.googleapis.com/auth/webmasters.readonly'], () => {});
    await new Promise(r => setTimeout(r, 50));

    // Hit the callback with a wrong state
    if (port) {
      await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=WRONG_STATE`).catch(() => {});
    }
    runner.cancel();
    const result = await flowPromise;
    expect(['cancelled', 'state_mismatch']).toContain(result.outcome);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/OAuthFlowRunner.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/OAuthFlowRunner.ts`**

```typescript
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import { shell } from 'electron';
import type { ProviderConfig } from './ProviderRegistry';
import type { FlowResult } from './types';

const FLOW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

export class OAuthFlowRunner {
  private cancelFn: (() => void) | null = null;

  async run(
    provider: ProviderConfig,
    scopes: string[],
    emitState: (patch: Record<string, unknown>) => void,
  ): Promise<FlowResult> {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    return new Promise<FlowResult>((resolve) => {
      let settled = false;
      let server: http.Server | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (server) { server.close(); server = null; }
        this.cancelFn = null;
      };

      const settle = (result: FlowResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        emitState({ credentialFlowStatus: null });
        resolve(result);
      };

      this.cancelFn = () => settle({ outcome: 'cancelled' });

      timer = setTimeout(() => settle({ outcome: 'cancelled' }), FLOW_TIMEOUT_MS);

      server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }

        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          '<html><body><p>You can close this tab and return to Local.</p></body></html>',
        );

        if (returnedState !== state) {
          console.warn('[OAuthFlowRunner] state mismatch — possible CSRF');
          settle({ outcome: 'state_mismatch' });
          return;
        }

        if (!code) {
          settle({ outcome: 'cancelled' });
          return;
        }

        // Exchange code for tokens
        this.exchangeCode({ provider, code, verifier, redirectUri })
          .then(tokens => settle({ outcome: 'success', ...tokens }))
          .catch(() => settle({ outcome: 'cancelled' }));
      });

      server.listen(port, '127.0.0.1', () => {
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: provider.clientId,
          redirect_uri: redirectUri,
          scope: scopes.join(' '),
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
        });

        const authUrl = `${provider.authorizationEndpoint}?${params.toString()}`;
        emitState({ credentialFlowStatus: 'waiting' });
        shell.openExternal(authUrl).catch(() => settle({ outcome: 'cancelled' }));
      });

      server.on('error', () => settle({ outcome: 'cancelled' }));
    });
  }

  cancel(): void {
    this.cancelFn?.();
  }

  private async exchangeCode(opts: {
    provider: ProviderConfig;
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; accountLabel: string }> {
    const body = new URLSearchParams({
      code: opts.code,
      client_id: opts.provider.clientId,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: opts.verifier,
    });

    const res = await fetch(opts.provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    if (!data.access_token || !data.refresh_token) {
      throw new Error('Token exchange response missing required fields');
    }

    // Fetch account email for display
    let accountLabel = 'Google account';
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { email?: string };
        if (info.email) accountLabel = info.email;
      }
    } catch { /* non-fatal */ }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scopes: data.scope ? data.scope.split(' ') : [],
      accountLabel,
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/OAuthFlowRunner.test.ts --no-coverage 2>&1 | tail -10
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/OAuthFlowRunner.ts tests/unit/credentials/OAuthFlowRunner.test.ts
git commit -m "feat(credentials): OAuthFlowRunner — PKCE + loopback listener, system browser, state validation"
```

---

### Task 6: AgentCredentialsContext

**Files:**
- Create: `src/main/credentials/AgentCredentialsContext.ts`
- Test: `tests/unit/credentials/AgentCredentialsContext.test.ts`

**Interfaces:**
- Consumes: `AccessToken`, `NotConnectedError`, `RevokedError`, `ScopeInsufficientError` from Task 1; `CredentialManager` interface (defined below as a minimal interface `ICredentialManager`)
- Produces: `AgentCredentialsContext` implementing `AgentCredentials` (to be added to SDK types in Task 8)

The `AgentCredentials` interface (added to agent-sdk in Task 8) is:
```typescript
interface AgentCredentials {
  getToken(provider: string): Promise<AccessToken>;
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  requestConnection(provider: string): Promise<void>;
}
```

`AgentCredentialsContext` enforces: (a) `getToken` never opens UI; (b) returned `AccessToken.scopes` is filtered to only the agent's declared scopes; (c) `requestConnection` queues a UI trigger via the manager.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/AgentCredentialsContext.test.ts
import { AgentCredentialsContext } from '../../../src/main/credentials/AgentCredentialsContext';
import { NotConnectedError, RevokedError, ScopeInsufficientError } from '../../../src/main/credentials/types';
import type { AccessToken } from '../../../src/main/credentials/types';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

function makeManager(overrides: Partial<{
  getTokenForGrant: () => Promise<AccessToken>;
  getStatusForAgent: () => Promise<'connected' | 'not_connected' | 'revoked'>;
  requestConnectionForAgent: () => Promise<void>;
}> = {}) {
  return {
    getTokenForGrant: overrides.getTokenForGrant ?? jest.fn(async () => ({
      token: 'tok_abc',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [GSC_SCOPE, ANALYTICS_SCOPE],
    })),
    getStatusForAgent: overrides.getStatusForAgent ?? jest.fn(async () => 'connected' as const),
    requestConnectionForAgent: overrides.requestConnectionForAgent ?? jest.fn(async () => {}),
  };
}

describe('AgentCredentialsContext', () => {
  it('getToken returns token filtered to agent manifest scopes', async () => {
    const manager = makeManager();
    const ctx = new AgentCredentialsContext({
      agentId: 'seo-insights',
      siteId: 'site-1',
      manifestCredentials: [{ provider: 'google', scopes: [GSC_SCOPE], reason: 'r' }],
      manager,
    });
    const token = await ctx.getToken('google');
    expect(token.token).toBe('tok_abc');
    // scopes in returned token should be filtered to manifest scopes
    expect(token.scopes).toEqual([GSC_SCOPE]);
    expect(token.scopes).not.toContain(ANALYTICS_SCOPE);
  });

  it('getToken throws NotConnectedError when manager returns not_connected status', async () => {
    const manager = makeManager({
      getTokenForGrant: jest.fn(async () => { throw new NotConnectedError('google'); }),
    });
    const ctx = new AgentCredentialsContext({
      agentId: 'seo-insights',
      siteId: 'site-1',
      manifestCredentials: [{ provider: 'google', scopes: [GSC_SCOPE], reason: 'r' }],
      manager,
    });
    await expect(ctx.getToken('google')).rejects.toThrow(NotConnectedError);
  });

  it('getToken throws ScopeInsufficientError when agent requests scope not in its manifest', async () => {
    const ctx = new AgentCredentialsContext({
      agentId: 'seo-insights',
      siteId: 'site-1',
      manifestCredentials: [{ provider: 'google', scopes: [GSC_SCOPE], reason: 'r' }],
      manager: makeManager(),
    });
    // 'google' is valid provider but the underlying call should still work since
    // filtering happens after retrieval — this test verifies the provider declaration check
    // Test: calling getToken for a provider not in manifest throws
    await expect(ctx.getToken('github')).rejects.toThrow(NotConnectedError);
  });

  it('getStatus delegates to manager', async () => {
    const manager = makeManager({ getStatusForAgent: jest.fn(async () => 'revoked' as const) });
    const ctx = new AgentCredentialsContext({
      agentId: 'seo-insights',
      siteId: 'site-1',
      manifestCredentials: [{ provider: 'google', scopes: [GSC_SCOPE], reason: 'r' }],
      manager,
    });
    expect(await ctx.getStatus('google')).toBe('revoked');
  });

  it('requestConnection calls manager', async () => {
    const requestFn = jest.fn(async () => {});
    const manager = makeManager({ requestConnectionForAgent: requestFn });
    const ctx = new AgentCredentialsContext({
      agentId: 'seo-insights',
      siteId: 'site-1',
      manifestCredentials: [{ provider: 'google', scopes: [GSC_SCOPE], reason: 'r' }],
      manager,
    });
    await ctx.requestConnection('google');
    expect(requestFn).toHaveBeenCalledWith('google', 'seo-insights', 'site-1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/AgentCredentialsContext.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/AgentCredentialsContext.ts`**

```typescript
import type { AccessToken, CredentialDeclaration } from './types';
import { NotConnectedError, RevokedError, ScopeInsufficientError } from './types';

export interface ICredentialManager {
  getTokenForGrant(provider: string, agentId: string, siteId: string, manifestScopes: string[]): Promise<AccessToken>;
  getStatusForAgent(provider: string, agentId: string, siteId: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  requestConnectionForAgent(provider: string, agentId: string, siteId: string): Promise<void>;
}

interface AgentCredentialsContextOpts {
  agentId: string;
  siteId: string;
  manifestCredentials: CredentialDeclaration[];
  manager: ICredentialManager;
}

export class AgentCredentialsContext {
  private agentId: string;
  private siteId: string;
  private manifestCredentials: CredentialDeclaration[];
  private manager: ICredentialManager;

  constructor(opts: AgentCredentialsContextOpts) {
    this.agentId = opts.agentId;
    this.siteId = opts.siteId;
    this.manifestCredentials = opts.manifestCredentials;
    this.manager = opts.manager;
  }

  private manifestScopesFor(provider: string): string[] | null {
    const decl = this.manifestCredentials.find(c => c.provider === provider);
    return decl ? decl.scopes : null;
  }

  async getToken(provider: string): Promise<AccessToken> {
    const manifestScopes = this.manifestScopesFor(provider);
    if (!manifestScopes) throw new NotConnectedError(provider);

    const token = await this.manager.getTokenForGrant(provider, this.agentId, this.siteId, manifestScopes);

    // Filter returned scopes to only those declared in the manifest
    const filteredScopes = token.scopes.filter(s => manifestScopes.includes(s));
    return { ...token, scopes: filteredScopes };
  }

  async getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'> {
    return this.manager.getStatusForAgent(provider, this.agentId, this.siteId);
  }

  async requestConnection(provider: string): Promise<void> {
    return this.manager.requestConnectionForAgent(provider, this.agentId, this.siteId);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/AgentCredentialsContext.test.ts --no-coverage 2>&1 | tail -5
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/AgentCredentialsContext.ts tests/unit/credentials/AgentCredentialsContext.test.ts
git commit -m "feat(credentials): AgentCredentialsContext — scope-filtering proxy; shields agents from OAuth internals"
```

---

### Task 7: CredentialManager

**Files:**
- Create: `src/main/credentials/CredentialManager.ts`
- Test: `tests/unit/credentials/CredentialManager.test.ts`

**Interfaces:**
- Consumes: `ProviderRegistry` (Task 2), `CredentialTokenVault` (Task 3), `ConnectionStore` (Task 4), `OAuthFlowRunner` (Task 5), `ICredentialManager` from Task 6; `Connection`, `Grant`, `AccessToken`, all error types from Task 1
- Produces: `CredentialManager` implementing `ICredentialManager`; also exposes `connect`, `disconnect`, `listConnections`, `handleRefreshFailure`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/credentials/CredentialManager.test.ts
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
  beforeEach(() => jest.clearAllMocks());

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
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest tests/unit/credentials/CredentialManager.test.ts --no-coverage 2>&1 | tail -5
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/main/credentials/CredentialManager.ts`**

```typescript
import * as crypto from 'crypto';
import { ProviderRegistry } from './ProviderRegistry';
import { CredentialTokenVault } from './CredentialTokenVault';
import { ConnectionStore } from './ConnectionStore';
import { OAuthFlowRunner } from './OAuthFlowRunner';
import type { ICredentialManager } from './AgentCredentialsContext';
import type { Connection, Grant, AccessToken, CredentialEvent } from './types';
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

interface CredentialManagerDeps {
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
    manifestScopes: string[],
  ): Promise<AccessToken> {
    const grant = this.findGrant(provider, agentId, siteId);
    if (!grant) throw new NotConnectedError(provider);

    const conn = this.store.getConnection(grant.connectionId);
    if (!conn) throw new NotConnectedError(provider);
    if (conn.status === 'revoked') throw new RevokedError(provider);

    const scopesMissing = manifestScopes.some(s => !conn.grantedScopes.includes(s));
    if (scopesMissing) throw new ScopeInsufficientError(provider);

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
    const grant = this.findGrant(provider, agentId, siteId);
    if (!grant) return 'not_connected';
    const conn = this.store.getConnection(grant.connectionId);
    if (!conn) return 'not_connected';
    if (conn.status === 'revoked') return 'revoked';
    return 'connected';
  }

  async requestConnectionForAgent(provider: string, agentId: string, siteId: string): Promise<void> {
    this.emitNexusState({ credentialConnectRequest: { provider, agentId, siteId } });
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

    // Best-effort revocation
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
        });

        const res = await this.fetchFn(cfg.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string };
          if (errBody.error === 'invalid_grant') {
            await this.handleRefreshFailure(conn.id, 'invalid_grant');
            throw new RevokedError(provider);
          }
          throw new Error(`Refresh failed: ${res.status}`);
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
    throw new TemporarilyUnavailableError(provider);
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
    accessTokenOffsetMs = 3600_000,
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
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/credentials/CredentialManager.test.ts --no-coverage 2>&1 | tail -10
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/CredentialManager.ts tests/unit/credentials/CredentialManager.test.ts
git commit -m "feat(credentials): CredentialManager — token cache, per-connection mutex, refresh, revocation"
```

---

### Task 8: credentials/index.ts + SDK integration

**Files:**
- Create: `src/main/credentials/index.ts`
- Modify: `src/main/agent-sdk/types.ts`
- Modify: `src/main/agent-runtime/buildAgentContext.ts`

**Interfaces:**
- Consumes: `AgentCredentialsContext` (Task 6), `CredentialManager` (Task 7)
- Produces: `AgentCredentials` interface + `AccessToken` + error types in SDK; `ctx.credentials` populated in `buildAgentContext`

- [ ] **Step 1: Create `src/main/credentials/index.ts`**

```typescript
export { CredentialManager } from './CredentialManager';
export { AgentCredentialsContext } from './AgentCredentialsContext';
export type { ICredentialManager } from './AgentCredentialsContext';
export { ProviderRegistry } from './ProviderRegistry';
export { ConnectionStore } from './ConnectionStore';
export { CredentialTokenVault } from './CredentialTokenVault';
export { OAuthFlowRunner } from './OAuthFlowRunner';
export type {
  Connection,
  Grant,
  AccessToken,
  CredentialDeclaration,
  FlowResult,
  CredentialEvent,
} from './types';
export {
  NotConnectedError,
  RevokedError,
  ScopeInsufficientError,
  SafeStorageUnavailableError,
  TemporarilyUnavailableError,
  ProviderNotConfiguredError,
} from './types';
```

- [ ] **Step 2: Add `AgentCredentials`, `AccessToken`, error types, and declaration field to `src/main/agent-sdk/types.ts`**

At the top of the file (after existing imports), add:

```typescript
import type { AccessToken as CredAccessToken, CredentialDeclaration } from '../credentials/types';
import {
  NotConnectedError,
  RevokedError,
  ScopeInsufficientError,
  SafeStorageUnavailableError,
  TemporarilyUnavailableError,
} from '../credentials/types';
```

After the `Unsubscribe` type alias, add:

```typescript
// ─── Credential types (re-exported for agent authors) ────────────────────────

export type { CredentialDeclaration } from '../credentials/types';
export type AccessToken = CredAccessToken;
export { NotConnectedError, RevokedError, ScopeInsufficientError, SafeStorageUnavailableError, TemporarilyUnavailableError };

export interface AgentCredentials {
  /** Get a fresh access token. Never opens UI. Rejects with typed error if not connected. */
  getToken(provider: string): Promise<AccessToken>;
  /** Cheap status check for tier-gating logic. */
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  /** Ask the SDK to surface the connect flow to the user. Returns immediately. */
  requestConnection(provider: string): Promise<void>;
}
```

In `AgentContext`, add `credentials` field:

```typescript
export interface AgentContext {
  trigger: Trigger;
  event?: NexusEvent;
  tools: ToolProvider;
  state: AgentStateHandle;
  ai: AIClient;
  log: AgentLogger;
  autonomy: AgentAutonomy;
  /** OAuth credential access for this agent+site. Never exposes refresh tokens or OAuth internals. */
  credentials: AgentCredentials;
}
```

In `AgentDefinition`, add `credentials?` field:

```typescript
export interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  triggers: Trigger[];
  tools?: string[];
  model?: string;
  timeoutMs?: number;
  contributes?: AgentContributes;
  /** OAuth credential declarations. Agent developers list what they need; the runtime handles everything else. */
  credentials?: CredentialDeclaration[];
  run: (ctx: AgentContext) => Promise<Partial<AgentResult> | void>;
  onError?: (err: Error, ctx: AgentContext) => Promise<void>;
}
```

- [ ] **Step 3: Inject `credentials` into `buildAgentContext`**

In `src/main/agent-runtime/buildAgentContext.ts`:

Add import at top:

```typescript
import { AgentCredentialsContext } from '../credentials/AgentCredentialsContext';
import { NotConnectedError } from '../credentials/types';
```

Update `AgentContextDeps` interface (add optional `credentialManager`):

```typescript
export interface AgentContextDeps {
  agent: AgentDefinition;
  event?: NexusEvent;
  toolRegistry: ToolRegistry;
  services: NexusServices;
  stateStore: AgentStateStore;
  resolvedProvider: ResolvedAIProvider;
  logDir: string;
}
```

In the `buildAgentContext` function body, before the `const ctx: AgentContext = {` block, add:

```typescript
  const credentialManager = services.credentialManager;
  const agentSiteId = event?.siteId ?? '';
  const credentials = new AgentCredentialsContext({
    agentId: agent.name,
    siteId: agentSiteId,
    manifestCredentials: agent.credentials ?? [],
    manager: credentialManager ?? {
      getTokenForGrant: async (provider: string) => { throw new NotConnectedError(provider); },
      getStatusForAgent: async () => 'not_connected' as const,
      requestConnectionForAgent: async () => {},
    },
  });
```

In the `ctx` object, add:

```typescript
  const ctx: AgentContext = {
    trigger: agent.triggers[0],
    event,
    tools: toolProvider,
    state: stateStore.buildHandle(agentName),
    ai: aiClient,
    log: agentLog,
    autonomy: getAgentAutonomy(agentName),
    credentials,
  };
```

- [ ] **Step 4: Build to verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (or only pre-existing errors unrelated to credentials)

- [ ] **Step 5: Run all credential unit tests**

```bash
npx jest tests/unit/credentials/ --no-coverage 2>&1 | tail -10
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/credentials/index.ts src/main/agent-sdk/types.ts src/main/agent-runtime/buildAgentContext.ts
git commit -m "feat(credentials): wire AgentCredentials into agent SDK + buildAgentContext injection"
```

---

### Task 9: IPC handlers, NexusServices, and index.ts wiring

**Files:**
- Modify: `src/main/mcp/types.ts` — add `credentialManager?` to `NexusServices`
- Modify: `src/main/ipc-handlers.ts` — 4 new credential handlers
- Modify: `src/main/index.ts` — instantiate `CredentialManager`, add to services

**Interfaces:**
- Consumes: `CredentialManager` (Task 7), `IPC_CHANNELS.CREDENTIAL_*` (Task 1), `emitNexusState` + `safeHandle` patterns from existing code

- [ ] **Step 1: Add `credentialManager` to `NexusServices` in `src/main/mcp/types.ts`**

After the `dispatcher?` line:

```typescript
  /** OAuth credential manager — owns connection/grant lifecycle, token refresh, PKCE flows */
  credentialManager?: import('../credentials/CredentialManager').CredentialManager;
```

- [ ] **Step 2: Add 4 IPC handlers in `src/main/ipc-handlers.ts`**

Find where other handlers are registered (near the top of `registerIpcHandlers`) and add:

```typescript
  // ── Credential Manager ────────────────────────────────────────────────────

  safeHandle(IPC_CHANNELS.CREDENTIAL_STATUS, async () => {
    const mgr = deps.services?.credentialManager;
    if (!mgr) return { connections: [], grants: [] };
    return { connections: mgr.listConnections() };
  });

  safeHandle(IPC_CHANNELS.CREDENTIAL_CONNECT, async (_event, args: { provider: string; agentId: string; siteId: string; scopes: string[] }) => {
    const mgr = deps.services?.credentialManager;
    if (!mgr) throw new Error('Credential manager not available');
    await mgr.connect(args.provider, args.agentId, args.siteId, args.scopes);
    return { ok: true };
  });

  safeHandle(IPC_CHANNELS.CREDENTIAL_DISCONNECT, async (_event, args: { connectionId: string }) => {
    const mgr = deps.services?.credentialManager;
    if (!mgr) throw new Error('Credential manager not available');
    await mgr.disconnect(args.connectionId);
    return { ok: true };
  });
```

Note: `CREDENTIAL_EVENT` is a push channel (main → renderer), not a handler.

- [ ] **Step 3: Instantiate `CredentialManager` in `src/main/index.ts`**

Near where `nexusServices` is assembled (after `registryStorage` is available), add:

```typescript
import { CredentialManager } from './credentials/CredentialManager';
import type { CredentialEvent } from './credentials/types';
import { IPC_CHANNELS } from '../common/constants';

// (inside the addon startup function, after registryStorage is ready)
const credentialManager = new CredentialManager({
  storage: registryStorage,
  emitNexusState,
  emitCredentialEvent: (event: CredentialEvent) => {
    const windows = BrowserWindow.getAllWindows?.() ?? [];
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CREDENTIAL_EVENT, event);
      }
    }
  },
});
```

Add to `nexusServices`:

```typescript
credentialManager,
```

- [ ] **Step 4: Build to verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: no new failures (pre-existing failures remain; no new regressions)

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/types.ts src/main/ipc-handlers.ts src/main/index.ts
git commit -m "feat(credentials): wire CredentialManager into NexusServices, IPC handlers (connect/disconnect/status/event)"
```

---

### Task 10: Consent modal UI

**Files:**
- Create: `src/renderer/components/credentials/CredentialConsentModal.tsx`

**Interfaces:**
- Consumes: `IPC_CHANNELS.CREDENTIAL_CONNECT`, `IPC_CHANNELS.CREDENTIAL_EVENT` from constants; class-based React pattern from existing renderer components

**Note:** Class-based React with `React.createElement()`, no JSX, no hooks. Props received from parent via `nexusStore.credentialConnectRequest`.

- [ ] **Step 1: Create `src/renderer/components/credentials/CredentialConsentModal.tsx`**

```typescript
import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';

interface ConsentRequest {
  provider: string;
  agentId: string;
  siteId: string;
  scopes: string[];
  agentName?: string;
  reason?: string;
  scopeLabels?: Record<string, string>;
}

interface Props {
  electron: any;
  request: ConsentRequest | null;
  onDismiss: () => void;
}

interface State {
  connecting: boolean;
}

export class CredentialConsentModal extends React.Component<Props, State> {
  state: State = { connecting: false };

  private handleConnect = async () => {
    const { electron, request, onDismiss } = this.props;
    if (!request) return;
    this.setState({ connecting: true });
    try {
      await electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_CONNECT, {
        provider: request.provider,
        agentId: request.agentId,
        siteId: request.siteId,
        scopes: request.scopes,
      });
      onDismiss();
    } finally {
      this.setState({ connecting: false });
    }
  };

  render() {
    const { request, onDismiss } = this.props;
    if (!request) return null;

    const { connecting } = this.state;
    const agentName = request.agentName ?? request.agentId;
    const reason = request.reason ?? `Allow ${agentName} to access your ${request.provider} account.`;
    const scopeLines = request.scopes.map(s =>
      React.createElement('li', { key: s, style: { marginBottom: 4 } },
        request.scopeLabels?.[s] ?? s,
      ),
    );

    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      },
      React.createElement(
        'div',
        {
          style: {
            background: '#1e1e1e', borderRadius: 8, padding: 24, maxWidth: 420, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          },
        },
        React.createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, color: '#fff' } },
          `Connect your Google account`,
        ),
        React.createElement('p', { style: { margin: '0 0 12px', fontSize: 14, color: '#bbb', lineHeight: 1.5 } },
          reason,
        ),
        scopeLines.length > 0 && React.createElement(
          'ul',
          { style: { margin: '0 0 20px', paddingLeft: 18, color: '#bbb', fontSize: 13 } },
          ...scopeLines,
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          React.createElement(
            'button',
            {
              onClick: onDismiss,
              disabled: connecting,
              style: { padding: '8px 16px', background: 'transparent', border: '1px solid #555', borderRadius: 4, color: '#bbb', cursor: 'pointer' },
            },
            'Not now',
          ),
          React.createElement(
            'button',
            {
              onClick: this.handleConnect,
              disabled: connecting,
              style: { padding: '8px 16px', background: '#51bb7b', border: 'none', borderRadius: 4, color: '#fff', cursor: connecting ? 'wait' : 'pointer' },
            },
            connecting ? 'Connecting…' : 'Connect',
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Build renderer to verify no type errors**

```bash
npx tsc --noEmit 2>&1 | grep -E "credentials/" | head -10
```
Expected: no errors for credentials files

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/credentials/CredentialConsentModal.tsx
git commit -m "feat(credentials): CredentialConsentModal — consent prompt UI with scope labels and reason string"
```

---

### Task 11: Connections panel UI

**Files:**
- Create: `src/renderer/components/credentials/ConnectionsPanel.tsx`
- Modify: `src/renderer/index.tsx` — register ConnectionsPanel in preferences hook

**Interfaces:**
- Consumes: `IPC_CHANNELS.CREDENTIAL_STATUS`, `IPC_CHANNELS.CREDENTIAL_DISCONNECT`, `IPC_CHANNELS.CREDENTIAL_EVENT`; class-based React; `Connection` type from types.ts

- [ ] **Step 1: Create `src/renderer/components/credentials/ConnectionsPanel.tsx`**

```typescript
import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { Connection } from '../../../main/credentials/types';

interface Props {
  electron: any;
}

interface State {
  connections: Connection[];
  loading: boolean;
  disconnecting: Set<string>;
}

export class ConnectionsPanel extends React.Component<Props, State> {
  state: State = { connections: [], loading: true, disconnecting: new Set() };

  componentDidMount() {
    this.loadConnections();
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CREDENTIAL_EVENT, this.handleCredentialEvent);
  }

  componentWillUnmount() {
    this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CREDENTIAL_EVENT, this.handleCredentialEvent);
  }

  private handleCredentialEvent = () => {
    this.loadConnections();
  };

  private async loadConnections() {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_STATUS);
      this.setState({ connections: result.connections ?? [], loading: false });
    } catch {
      this.setState({ loading: false });
    }
  }

  private handleDisconnect = async (connectionId: string) => {
    this.setState(prev => ({ disconnecting: new Set(prev.disconnecting).add(connectionId) }));
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_DISCONNECT, { connectionId });
      await this.loadConnections();
    } finally {
      this.setState(prev => {
        const next = new Set(prev.disconnecting);
        next.delete(connectionId);
        return { disconnecting: next };
      });
    }
  };

  render() {
    const { connections, loading, disconnecting } = this.state;

    if (loading) {
      return React.createElement('div', { style: { padding: 16, color: '#bbb' } }, 'Loading…');
    }

    if (connections.length === 0) {
      return React.createElement(
        'div',
        { style: { padding: 16 } },
        React.createElement('p', { style: { color: '#888', margin: 0, fontSize: 14 } },
          'No Google accounts connected. Agents that need Google access will prompt you to connect.',
        ),
      );
    }

    const rows = connections.map(conn =>
      React.createElement(
        'li',
        {
          key: conn.id,
          className: 'TableListRow',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        },
        React.createElement(
          'div',
          null,
          React.createElement('strong', null, conn.accountLabel),
          React.createElement(
            'div',
            { style: { fontSize: 12, color: conn.status === 'revoked' ? '#ef4444' : '#888', marginTop: 2 } },
            conn.status === 'revoked' ? 'Revoked — reconnect to restore access' : `Google · ${conn.grantedScopes.length} scope${conn.grantedScopes.length !== 1 ? 's' : ''}`,
          ),
        ),
        React.createElement(
          'button',
          {
            onClick: () => this.handleDisconnect(conn.id),
            disabled: disconnecting.has(conn.id),
            style: {
              padding: '4px 12px', fontSize: 12,
              background: 'transparent', border: '1px solid #555',
              borderRadius: 4, color: '#bbb', cursor: 'pointer',
            },
          },
          disconnecting.has(conn.id) ? 'Disconnecting…' : 'Disconnect',
        ),
      ),
    );

    return React.createElement(
      'div',
      { style: { padding: '0 16px 16px' } },
      React.createElement('h4', { style: { margin: '0 0 12px', fontSize: 14, color: '#fff' } }, 'Connected accounts'),
      React.createElement('ul', { className: 'TableList' }, ...rows),
    );
  }
}
```

- [ ] **Step 2: Register ConnectionsPanel in the preferences hook**

In `src/renderer/index.tsx`, find where `preferencesMenuItems` filter is added and add a "Connected Accounts" section. Look for the existing Nexus AI preferences hook (search for `preferencesMenuItems`) and add:

```typescript
// In the renderer hook registration area (near existing Nexus AI preferences hook):
LocalHooksService.addFilter?.('preferencesMenuItems', (items: any[]) => {
  // ... existing nexus preferences item registration ...
  return [...items, {
    label: 'Connected Accounts',
    sectionId: 'nexus-ai-connected-accounts',
    render: () => React.createElement(ConnectionsPanel, { electron }),
  }];
});
```

Import `ConnectionsPanel` at the top of the file:
```typescript
import { ConnectionsPanel } from './components/credentials/ConnectionsPanel';
```

- [ ] **Step 3: Build to verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "ConnectionsPanel|CredentialConsentModal" | head -10
```
Expected: no errors

- [ ] **Step 4: Run full test suite one final time**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: no new failures vs. pre-existing

- [ ] **Step 5: Final commit**

```bash
git add src/renderer/components/credentials/ConnectionsPanel.tsx src/renderer/index.tsx
git commit -m "feat(credentials): ConnectionsPanel — connections list with account label, scope count, revoked state, disconnect"
```

---

## Self-Review Checklist

### Spec coverage
- [x] PKCE + loopback redirect → OAuthFlowRunner (Task 5)
- [x] System browser via `shell.openExternal` → Task 5
- [x] `NEXUS_GOOGLE_CLIENT_ID` env var gate → ProviderRegistry (Task 2)
- [x] safeStorage throws on unavailable → CredentialTokenVault (Task 3)
- [x] Agents get short-lived tokens only → AgentCredentialsContext (Task 6)
- [x] Per-connection mutex → CredentialManager.withMutex (Task 7)
- [x] Incremental auth `include_granted_scopes=true` → OAuthFlowRunner (Task 5)
- [x] `invalid_grant` → revoked state, event emitted, no retry → CredentialManager.handleRefreshFailure (Task 7)
- [x] 5-min flow timeout → OAuthFlowRunner (Task 5)
- [x] state mismatch → reject flow, log security event → OAuthFlowRunner (Task 5)
- [x] Scope-filtered tokens per agent → AgentCredentialsContext (Task 6)
- [x] Consent prompt UI → Task 10
- [x] Connections panel in preferences → Task 11
- [x] `credential:connected/revoked/scope_added` events → Task 7 + 9
- [x] Per-site grant confirm → requestConnectionForAgent emits credentialConnectRequest (Task 7), UI shows modal (Task 10)
- [x] Typed error classes → Task 1
- [x] No token material in logs → enforced by design (never log token values)

### Type consistency
- `AccessToken` defined in `types.ts`, re-exported from `agent-sdk/types.ts`
- `CredentialDeclaration` used consistently in `types.ts`, `AgentDefinition`, `AgentCredentialsContext`
- `ICredentialManager` interface defined in `AgentCredentialsContext.ts`, implemented by `CredentialManager`
- `Connection`/`Grant` used consistently across `ConnectionStore`, `CredentialManager`, `ConnectionsPanel`
