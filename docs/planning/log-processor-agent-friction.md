# Log Processor Agent — SDK & Platform Friction Log

**Filed:** 2026-07-22  
**Context:** First agent to be database-backed, streaming-S3-credentialed, and long-running. Exposed assumptions in the SDK/runtime that were invisible when the only agents were OAuth-gated, short-lived, or cron-only.

---

## F-LP1: `executionMode: 'run'` calls `agent.run()`, not the handler (repeat of F16)

**File:** `src/main/agent-runtime/AgentDispatcher.ts` — `dispatchRun()`

**Rediscovered from F16** in the SEO friction log, now with higher impact. `sync_access_logs` and `fetch_log_window` both used `executionMode: 'run'`. Every invocation called the agent's cron function (`def.run(ctx)`) and completely ignored the tool handler and the caller's `siteId`/`from`/`to`/`budgetMB` args. The cron function ran a 28-day default sync for all enabled sites — the wrong operation, with the wrong scope, every time.

**What happened in production:** User called `sync_access_logs siteId="jeremypollock2" from="2026-07-18" to="2026-07-21" budgetMB=30`. The cron function ignored all four args and started syncing every site for the last 28 days at 512MB, triggering both the 30-second timeout and (later) the database close race.

**Fix applied:** Changed both tools to `executionMode: 'function'`. This is always correct for contributed tools — the handler must be called with the caller's args, not replaced by the scheduled run.

**SDK gap:** `executionMode: 'run'` in contributed tools is either undocumented or documented incorrectly. The only semantically valid use of `'run'` for a contributed tool would be "trigger the full scheduled run as if the cron fired" — a niche that should be an explicit opt-in, not a trap named 'run'. Should be removed from `ContributedToolDefinition` or renamed to `'trigger-scheduled-run'` with documentation that makes the behavior impossible to misread. `'function'` is the correct mode for all handler-dispatched tools regardless of expected duration.

---

## F-LP2: `AgentRegistry.watch()` fires on log file writes and SQLite WAL commits

**File:** `src/main/agent-runtime/AgentRegistry.ts` — `watch()`

**What happened:** `fs.watch(agentsDir, { recursive: true })` watches everything under `~/nexus-ai/agents/` — including `log-processor/logs/agent.log` (written on every `ctx.log.info()` call) and `log-processor/logs.sqlite-wal` (written on every SQLite transaction). Every "Streaming X.gz" log line written during `sync_access_logs` triggered the watcher, which called `dbManager.closeAgent('log-processor')`, which closed the SQLite connection the streaming fold was actively using. Result: every file stream threw "The database connection is not open" immediately after the first line was processed.

**Failure mode:** The error message pointed to a database problem, obscuring the real cause (file watcher → `closeAgent` race). The connection was opened successfully and the schema initialized, then closed by a side-channel before the first `getAggregate()` call inside the stream loop.

**Fix applied:** Added a filename filter in the watch handler:

```typescript
const changedFile = segments[segments.length - 1] ?? '';
if (changedFile && !/\.(ts|js|yaml|yml)$/.test(changedFile)) return;
```

**SDK gap:** Hot-reload should watch only source files (`.ts`, `.js`, `.yaml`). Watching everything recursive and calling `closeAgent` on any change is unsafe for any agent with durable open resources (database, network connection, file handle). The watcher should explicitly exclude `logs/`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, and any other runtime-written directories. A source-only filter should be the default.

---

## F-LP3: 30-second handler timeout too short for streaming tools

**File:** `src/main/agent-runtime/AgentDispatcher.ts` — `HANDLER_TIMEOUT_MS = 30_000`

**What happened:** After fixing F-LP1 (executionMode) and F-LP2 (file watcher), `sync_access_logs` dispatched correctly but hit `Agent run() timed out after 30000ms`. Streaming 30MB of gzipped Apache logs through gunzip → readline → classify → fold takes 45–90 seconds on a typical developer machine. The 30s timeout killed the tool before any files finished.

**Fix applied:** Raised `HANDLER_TIMEOUT_MS` to `300_000` (5 minutes).

**SDK gap:** A single timeout constant for all tool handlers is wrong. A `get_log_aggregates` (offline SQLite read, < 100ms) and a `sync_access_logs` (S3 streaming, potentially minutes) should not share the same timeout. Options:
- Per-tool timeout declaration in `ContributedToolDefinition`: `timeoutMs?: number`
- Separate timeout tiers: `executionMode: 'function'` → 30s, `executionMode: 'streaming'` (new) → configurable
- At minimum, a much higher default (5 minutes) for the framework and let short tools rely on their own early returns

---

## F-LP4: `getStatusForAgent` returns `not_connected` for api_key providers

**File:** `src/main/credentials/CredentialManager.ts` — `getStatusForAgent()`

**What happened:** After credentials were entered in Preferences and validated (STS GetCallerIdentity returned the IAM ARN), `connect_log_source` still returned "AWS not connected. Please add the AWS connection in the Nexus UI." The credentials were stored correctly in the vault. `getStatusForAgent('aws', ...)` returned `not_connected` because the method only checked `this.findGrant()` — the OAuth grant mechanism — and had no knowledge of `ApiKeyConnectionStore`.

**Fix applied:** Added api_key fallthrough in `getStatusForAgent`:

```typescript
// api_key fallthrough — no OAuth grant, check ApiKeyConnectionStore
const apiKeyConns = this.apiKeyStore.list(provider);
if (apiKeyConns.some(c => c.status === 'active')) return 'connected';
if (apiKeyConns.some(c => c.status === 'revoked')) return 'revoked';
return 'not_connected';
```

**SDK gap:** The credential system was designed OAuth-first. `getStatusForAgent`, `getTokenForGrant`, and `requestConnectionForAgent` all assume OAuth semantics (grants, scopes, refresh tokens). When `type: 'api_key'` was added to `CredentialDeclaration`, the agent-facing status path was not updated to match. Any agent using an api_key credential will hit this: `ctx.credentials.getStatus(provider)` returns `not_connected` until the runtime is updated per-provider. This should be caught at the platform level when a new credential type is added, not by the agent author at runtime.

---

## F-LP5: `getSecret` not declared on `AgentCredentials` interface

**File:** `src/main/agent-sdk/types.ts` — `AgentCredentials`

**What happened:** `access-logs.ts` had always feature-detected `ctx.credentials.getSecret` via `typeof ctx.credentials.getSecret !== 'function'`. This pattern was carried into the new agent, but when it compiled the cast was `as unknown as { getSecret?: ... }` — hiding the missing method from the type system. A code reviewer caught it: the cast masked a gap where `getSecret` would never exist on `AgentCredentials` at runtime, making the fallback error path ("api_key credential provider extension required") the only reachable path regardless of vault state.

**Fix applied:** Added `getSecret?(provider: string): Promise<Record<string, string>>` as an optional method on `AgentCredentials`. Added implementation in `AgentCredentialsContext` with manifest gate (only callable by agents declaring `type: 'api_key'`). Also added `revokeCredential?(provider)` for the revoked-state propagation path.

**SDK gap:** Any credential method planned but not yet implemented should be declared as optional (`method?`) in the interface immediately when the concept appears in the roadmap — not after the first agent needs it. An undeclared method is either a runtime error (if cast away) or a silent dead path (if feature-detected incorrectly). The credential-manager brief v1.1 described `getSecret` as an extension but it was never added to the interface.

---

## F-LP6: No `ctx.db` on `AgentContext` — no persistent storage primitive for agents

**File:** `src/main/agent-sdk/types.ts` — `AgentContext`; `src/main/agent-runtime/AgentDbManager.ts` (new)

**What happened:** The brief required `logs.sqlite` for durable aggregate storage. `ctx.state` was explicitly ruled out (too many keys at fleet scale). There was no SDK-level mechanism for an agent to open a named database file. The agent would have needed to import `better-sqlite3` directly, which is not resolvable from the agents directory at runtime (no `node_modules` in the installed agent path).

**Work required:** Built `AgentDbManager` (platform-cached connections per `(agentName, dbName)`, WAL mode, closes on hot-reload), added `AgentDatabase`/`AgentStatement`/`AgentDbHandle` interfaces to `types.ts`, wired `ctx.db.open(name)` into `buildAgentContext`, updated `mockContext()` to return an in-memory db.

**SDK gap:** Durable, agent-scoped persistent storage is a first-class need for any stateful agent. `ctx.state` is a flat key-value store backed by a shared database — unsuitable for agents that need structured queries, schema migrations, or large datasets. `ctx.db.open(name)` fills the gap, but it had to be built from scratch. Should be part of the SDK surface from the start for any agent that needs more than `ctx.state` can provide.

---

## F-LP7: `AgentDatabase.prepare().get()` and `.all()` return `unknown` — all results require casts

**File:** `src/main/agent-sdk/types.ts` — `AgentStatement`

**What happened:** Every `db.prepare(...).get(...)` and `db.prepare(...).all(...)` call in `db.ts` requires an explicit cast: `as LogSource | undefined`, `as LedgerEntry[]`, `as { n: number; b: number | null }`, etc. The `AgentDatabase` interface exposes `get(...args): unknown` and `all(...args): unknown[]`. With 12 DAL functions, this produces ~20 casts throughout the file.

**Not a blocker**, but adds noise and surface area for mistakes. A generic overload would eliminate it:

```typescript
interface AgentStatement<T = unknown> {
  run(...args: unknown[]): { changes: number };
  get<T = unknown>(...args: unknown[]): T | undefined;
  all<T = unknown>(...args: unknown[]): T[];
}
// Usage: db.prepare('SELECT * FROM sources WHERE site = ?').get<LogSource>(site)
```

**SDK gap:** Better-sqlite3's Statement is already generic in community type definitions. Exposing the generics through `AgentDatabase` costs nothing and eliminates all casts in DAL code, making mistakes like forgetting a field or misspelling a type name detectable at compile time instead of runtime.

---

## F-LP8: `@nexus-ai/agent-sdk` not resolvable in Jest — requires separate tsconfig and moduleNameMapper

**Files:** `tsconfig.test.json` (new), `jest.config.js`

**What happened:** `db.ts` imports `import type { AgentDatabase } from '@nexus-ai/agent-sdk'`. When `db.test.ts` ran under ts-jest, it failed with TS2307 ("Cannot find module '@nexus-ai/agent-sdk'") because:
1. The main `tsconfig.json` has `rootDir: './src'`, rejecting files outside `src/`
2. ts-jest's `compilerOptions.paths` only affects type-checking, not runtime resolution
3. No `moduleNameMapper` entry existed for `@nexus-ai/agent-sdk`

**Fix applied:** Added `tsconfig.test.json` (extends main, relaxes `rootDir`, adds `paths` alias) and wired it into `jest.config.js` via `transform` + `moduleNameMapper`.

**SDK gap:** The `@nexus-ai/agent-sdk` alias is patched at runtime for agents (via `Module._resolveFilename`) but not for tests. Any agent code that imports from the SDK cannot be tested without this boilerplate. A one-time addition to `jest.config.js` is cheap, but it's undiscoverable — an agent author will hit this immediately on their first test run with no clear fix. The SDK should document this requirement, or the test config should include it by default when `@nexus-ai/agent-sdk` imports are present.

---

## F-LP9: No credential UI for api_key providers — entire stack had to be built

**Files:** `ApiKeyConnectionStore.ts`, `CredentialTokenVault` extension, `CredentialManager` extensions, IPC handlers, `NexusPreferences.tsx` section

**What happened:** The credential system had full infrastructure for OAuth (browser redirect, refresh token storage, consent modal, connected-accounts UI) but nothing for api_key credentials. The log-processor needed AWS access key + secret stored encrypted in the vault, retrievable by agents at runtime, with a UI for entry, status display, and revoked-state recovery.

**Work required:** `ApiKeyConnection` type, `ApiKeyConnectionStore`, vault extension (`storeApiKey`/`retrieveApiKey`/`deleteApiKey`), six new `CredentialManager` methods, `getStatusForAgent` extension, `AgentCredentials.getSecret` + `revokeCredential`, IPC handlers for set/status/clear, SigV4 generalization for STS `GetCallerIdentity` validation, three-state Preferences UI section.

**SDK gap:** The credential system should ship with both credential types as first-class citizens. OAuth and api_key are the two dominant patterns; any cloud service (AWS, GCS, Cloudflare) uses api_key. The foundation for api_key was present in the brief (v1.1 amendment) and the type system (`ApiKeyCredentialDeclaration`) but none of the runtime plumbing existed. The SDK's credential documentation should specify exactly what platform infrastructure exists for each declared credential type before an agent author commits to using it.

---

## Summary table

| ID | Where | Severity | Fixed? |
|----|-------|----------|--------|
| F-LP1 | `AgentDispatcher.dispatchRun()` | Critical | ✅ `executionMode: 'function'` |
| F-LP2 | `AgentRegistry.watch()` | Critical | ✅ Source-file filter added |
| F-LP3 | `HANDLER_TIMEOUT_MS` | Critical | ✅ Raised to 5 min |
| F-LP4 | `CredentialManager.getStatusForAgent` | Important | ✅ api_key fallthrough added |
| F-LP5 | `AgentCredentials` interface | Important | ✅ `getSecret?` + `revokeCredential?` added |
| F-LP6 | No `ctx.db` surface | Important | ✅ `AgentDbManager` + `ctx.db.open()` built |
| F-LP7 | `AgentStatement` return types | Minor | ⚠️ Casts in place; generics not added |
| F-LP8 | `@nexus-ai/agent-sdk` in Jest | Minor | ✅ `tsconfig.test.json` + `moduleNameMapper` |
| F-LP9 | No api_key credential infrastructure | Important | ✅ Full stack built |

**Pattern:** The SDK was designed for OAuth-gated, short-lived, read-only agents (the Sentinel model). The log-processor is the first agent that is long-running, streaming, write-to-its-own-database, and api_key-credentialed. Every F-LP maps to an assumption baked into the original design that only became visible when a different agent shape arrived.
