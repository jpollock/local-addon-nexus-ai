# Credential Manager — Design Spec

**Date:** 2026-07-21  
**Status:** Approved  
**First consumer:** SEO Insights agent, Google Search Console `webmasters.readonly`

---

## 1. Goal

One credential manager inside the Nexus addon that owns all OAuth machinery. Agent developers declare what they need in the manifest and call one method to get a token. They never see OAuth, refresh tokens, PKCE, or storage. This contract is designed to be portable: a future hosted/WPE-production backend will implement the same `AgentCredentials` interface so agents port without change.

---

## 2. Constraints (non-negotiable)

- **PKCE + loopback redirect** (`http://127.0.0.1:{ephemeral_port}/callback`). No hosted redirect endpoint.
- Authorization in **system browser** via `shell.openExternal`. Never a webview.
- Google OAuth client type: **Desktop app**. Client ID is not a secret; bundled via `NEXUS_GOOGLE_CLIENT_ID` env var. Feature is disabled when unset.
- Tokens stored **only** via `safeStorage`. When `safeStorage.isEncryptionAvailable()` is false, throw — never fall back to plaintext.
- Agents receive **short-lived access tokens only**. Refresh tokens never leave the vault.
- Log auth *events*, never auth *material* (tokens, codes, secrets).
- **Incremental authorization** (`include_granted_scopes=true`) from day one.
- Revocation (`invalid_grant`) is a normal state: mark `revoked`, emit event, no retry loop.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│ Agent (SEO Insights, ...)                           │
│   manifest: credentials declaration                 │
│   runtime:  ctx.credentials.getToken() + events     │
├─────────────────────────────────────────────────────┤
│ Credential Manager (src/main/credentials/)          │
│   ProviderRegistry · OAuthFlowRunner                │
│   CredentialTokenVault · ConnectionStore            │
│   CredentialManager (orchestrator)                  │
├─────────────────────────────────────────────────────┤
│ Local app                                           │
│   safeStorage · shell.openExternal · IPC · UI       │
└─────────────────────────────────────────────────────┘
```

---

## 4. Components

### 4.1 `ProviderRegistry`

Holds a registry of `ProviderConfig` entries. Ships with one entry: Google.

```typescript
interface ProviderConfig {
  id: 'google';
  displayName: string;
  authorizationEndpoint: string;   // https://accounts.google.com/o/oauth2/v2/auth
  tokenEndpoint: string;           // https://oauth2.googleapis.com/token
  revocationEndpoint: string;      // https://oauth2.googleapis.com/revoke
  clientId: string;                // process.env.NEXUS_GOOGLE_CLIENT_ID
  supportsIncrementalAuth: boolean; // true
  scopeMetadata: Record<string, { label: string; description: string }>;
}
```

`ProviderRegistry.isEnabled('google')` returns false when `NEXUS_GOOGLE_CLIENT_ID` is unset.

Adding a second provider = one registry entry + scope metadata. Zero changes to agent contract or flow runner.

### 4.2 `OAuthFlowRunner`

Orchestrates one authorization flow:

1. Generate PKCE (`code_verifier`, `code_challenge`) and random `state`.
2. Bind an `http.createServer` to a random available port on `127.0.0.1`.
3. Build the authorization URL and call `shell.openExternal(url)`.
4. Show "waiting for browser…" state (cancellable) via `emitNexusState`.
5. On callback: validate `state` (reject + log security event on mismatch), exchange `code` for tokens.
6. Tear down the listener immediately after (success, cancel, or 5-min timeout).
7. Return `{ accessToken, refreshToken, expiresIn, scopes }` or a `FlowResult` discriminated union.

Flow results: `'success'`, `'cancelled'` (user denied or timeout), `'state_mismatch'` (security event).

### 4.3 `CredentialTokenVault`

Thin wrapper around the existing `KeyVault`. Key difference: throws `SafeStorageUnavailableError` when `safeStorage.isEncryptionAvailable()` is false — never falls back to plaintext.

Key pattern: `google-connection:{connectionId}:refresh_token`  
One encrypted blob per connection. Revocation = `vault.deleteKey(key)`. Connection IDs are stable UUIDs.

```typescript
class CredentialTokenVault {
  store(connectionId: string, provider: string, refreshToken: string): void;
  retrieve(connectionId: string, provider: string): string | null;
  delete(connectionId: string, provider: string): void;
}
```

### 4.4 `ConnectionStore`

RegistryStorage-backed metadata for non-secret state.

```typescript
interface Connection {
  id: string;            // stable UUID
  provider: 'google';
  accountLabel: string;  // Google email, for display
  grantedScopes: string[];
  status: 'active' | 'revoked' | 'error';
  createdAt: string;
  lastRefreshedAt: string | null;
}

interface Grant {
  connectionId: string;
  agentId: string;
  siteId: string;
  scopes: string[];      // ⊆ connection.grantedScopes
}
```

Stored under `STORAGE_KEYS.OAUTH_CONNECTIONS` and `STORAGE_KEYS.OAUTH_GRANTS`. Grant approval is **per-site confirm** — when a second site requests a grant on an existing connection, a confirmation modal is shown even if scopes are already consented.

### 4.5 `CredentialManager`

Orchestrates all of the above. Owns:

- **In-memory access token cache** (`Map<connectionId, { token, expiresAt }>`)
- **Per-connection mutex** (prevents concurrent refresh races)
- **`getToken(connectionId, agentScopes)`**: cache hit if >5 min remaining; otherwise acquire mutex → refresh → cache → release
- **`connect(provider, agentId, siteId, scopes)`**: runs flow, stores tokens, creates Connection + Grant, emits event
- **`disconnect(connectionId)`**: calls revocation endpoint (best-effort), shreds vault entry, removes Grant records, emits event
- **`handleInvalidGrant(connectionId)`**: marks `revoked`, purges access token cache, shreds refresh token, emits `credential:revoked`

On `invalid_grant`: no retry. On 5xx/network: bounded exponential backoff (3 attempts); callers get `TemporarilyUnavailableError`.

---

## 5. SDK Contract

### 5.1 Manifest declaration (added to `AgentDefinition`)

```typescript
credentials?: Array<{
  provider: 'google';
  scopes: string[];
  optional?: boolean;   // agent degrades gracefully without it
  reason: string;       // shown verbatim in consent prompt
}>
```

### 5.2 Runtime API (added to `AgentContext` as `ctx.credentials`)

```typescript
interface AgentCredentials {
  getToken(provider: string): Promise<AccessToken>;    // never opens UI; rejects with typed error
  getStatus(provider: string): Promise<'connected' | 'not_connected' | 'revoked'>;
  requestConnection(provider: string): Promise<void>;  // asks SDK to surface connect flow
}

interface AccessToken {
  token: string;
  expiresAt: string;
  scopes: string[];    // filtered to agent's manifest scopes, not full connection scopes
}
```

### 5.3 Typed errors (exported from agent-sdk)

```typescript
class NotConnectedError extends Error {}    // no valid grant exists
class RevokedError extends Error {}         // connection was revoked
class ScopeInsufficientError extends Error {} // grant scopes don't satisfy request
class SafeStorageUnavailableError extends Error {} // encryption not available on this platform
class TemporarilyUnavailableError extends Error {} // refresh failed after retries
```

### 5.4 Events (via existing IPC push channel)

```
'credential:connected'    { provider, scopes }
'credential:revoked'      { provider }
'credential:scope_added'  { provider, scopes }
```

Delivered via `webContents.send(IPC_CHANNELS.CREDENTIAL_EVENT, { type, provider, ... })`. Events reach active agents only — no dormant-agent wake-up in v1.

---

## 6. IPC Handlers (4 new)

| Channel | Direction | Purpose |
|---|---|---|
| `CREDENTIAL_CONNECT` | renderer → main | Trigger connect flow for agent+site+provider |
| `CREDENTIAL_DISCONNECT` | renderer → main | Disconnect a connection |
| `CREDENTIAL_STATUS` | renderer → main | Get all connections + grants (for connections panel) |
| `CREDENTIAL_EVENT` | main → renderer (push) | Broadcast connected/revoked/scope_added events |

All wrapped via `safeHandle`.

---

## 7. UI

**Consent prompt** (`CredentialConsentModal.tsx`): triggered by `requestConnection` or enabling a non-optional credential. Shows agent name, provider, human-readable scope labels, and the agent's `reason` string verbatim. Buttons: "Connect" (→ system browser) and "Not now". No OAuth vocabulary.

**Connections panel** (`ConnectionsPanel.tsx`): in Local preferences via existing `preferencesMenuItems` hook. Lists connections with account label, human-readable scopes, which agents/sites hold grants, status, and per-connection Disconnect button.

**Revoked state**: shown plainly in panel. Agent surfaces can call `requestConnection` to render a reconnect affordance.

**Flow feedback**: "Waiting for browser…" state with Cancel while loopback listener is open.

---

## 8. Failure modes

| Situation | Behavior |
|---|---|
| User denies consent | Flow = `cancelled`; agent sees `not_connected`; no error state |
| Browser callback never arrives | 5-min timeout; listener torn down; flow = `cancelled` |
| `state` mismatch on callback | Reject flow; log security event; tear down listener |
| Refresh returns `invalid_grant` | Connection → `revoked`; event emitted; no retry |
| Refresh returns 5xx/network | 3-attempt backoff; callers get `TemporarilyUnavailableError` |
| Two agents need overlapping scopes | One connection; incremental consent for union; each agent gets scope-filtered token |
| safeStorage unavailable | Throw `SafeStorageUnavailableError`; surface in connections panel; never fall back to plaintext |
| Concurrent `getToken()` calls | Per-connection mutex ensures exactly one refresh request |

---

## 9. File layout

```
src/main/credentials/
  types.ts
  ProviderRegistry.ts
  OAuthFlowRunner.ts
  CredentialTokenVault.ts
  ConnectionStore.ts
  CredentialManager.ts
  AgentCredentialsContext.ts  (proxy: enforces scope-filtering between CredentialManager and agent)
  index.ts               (re-exports)

src/main/agent-sdk/
  types.ts               (AgentCredentials + AccessToken added; credentials field on AgentDefinition)

src/renderer/components/
  CredentialConsentModal.tsx
  ConnectionsPanel.tsx

src/main/ipc-handlers.ts (4 new handlers)
src/main/index.ts        (wire CredentialManager into NexusServices + onSettingsUpdated if needed)
```

---

## 10. Out of scope (v1)

- Any provider beyond Google
- Restricted-scope providers (Gmail, Drive) and CASA
- Hosted/WPE-production backend
- Service-account or API-key credential types
- Scope removal/downgrade flows
- Multi-user Local profiles

---

## 11. Acceptance criteria

1. SEO Insights agent reaches T1 with zero OAuth-aware code: manifest declaration + `getToken()` + two event handlers only.
2. Fresh machine → connected in <60s via system browser; token survives Local restart; access token refreshes transparently.
3. Revoking from Google account page results, within one refresh cycle, in: `revoked` status, `credential:revoked` delivered, agent degrading gracefully, one-click reconnect working.
4. Second agent declaring `analytics.readonly` on same Google account = one incremental consent + two correctly scope-filtered token streams.
5. No token material in logs, config files, site databases, or telemetry.
6. 10 concurrent `getToken()` calls = exactly one refresh request.
