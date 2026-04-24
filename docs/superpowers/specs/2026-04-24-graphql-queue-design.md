# GraphQL Resolver Queue — Design Spec

**Date:** 2026-04-24  
**Branch:** `feat-graphql-queue`  
**Status:** Approved

## Problem

When an AI agent fires 30+ concurrent GraphQL mutations, every call lands on Local's event loop simultaneously. Resolvers that spawn WP-CLI subprocesses, SSH sessions, file transfers, or LanceDB operations all compete for the same resources. This degrades Local's responsiveness and can cause cascading failures.

## Goal

Cap concurrent execution of expensive GraphQL resolvers at 3 at any moment, and cap the internal fan-out of the three bulk resolvers at 3 items in parallel — without changing the resolver API surface or error handling.

## Non-Goals

- No changes to GraphQL schema, MCP tools, or return shapes
- No per-category queues (premature)
- No queue depth UI (future work via `nexus doctor`)
- No rate-limiting of light reads

## Dependencies

Both packages are already installed and used in the codebase:

| Package | Version | Module format | Already used in |
|---|---|---|---|
| `p-queue` | 6.6.2 | CJS (`dist/index.js`, no `"type":"module"`) | — |
| `p-limit` | 7.3.0 | ESM (`"type":"module"`) | `WPESyncService.ts` |

No `npm install` required.

## Architecture

### Change 1 — `src/main/graphql/resolver-utils.ts`

Add at the bottom of the file (after existing exports):

```ts
import PQueue from 'p-queue';

/** Global concurrency limiter for expensive GraphQL resolver handlers. */
export const resolverQueue = new PQueue({ concurrency: 3 });

/**
 * Wrap an expensive resolver body so it runs inside the global queue.
 * Propagates errors normally; does not change resolver return shapes.
 */
export function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  return resolverQueue.add(fn) as Promise<T>;
}
```

`resolverQueue` is exported for future observability (e.g. `nexus doctor` could surface queue depth) but nothing consumes it initially.

### Change 2 — `src/main/graphql/resolvers.ts`

**2a. New import at top of file:**

```ts
import pLimit from 'p-limit';
import { withQueue } from './resolver-utils';
```

Note: `resolvers.ts` does not currently import from `resolver-utils.ts` — the helpers (`parseTarget`, `resolveSite`, etc.) are re-defined locally in that file. Both imports above are new additions to the top of `resolvers.ts`.

**2b. Top-level gating — 21 resolvers**

Each expensive resolver body is wrapped in `withQueue`. Pattern:

```ts
// Before
nexusWpCommand: async (_parent, { target, command }) => {
  try {
    // ...body...
  } catch (error: any) { ... }
},

// After
nexusWpCommand: async (_parent, { target, command }) => {
  return withQueue(async () => {
    try {
      // ...body unchanged...
    } catch (error: any) { ... }
  });
},
```

**Full list of gated resolvers:**

| Resolver | Line (approx) | Why |
|---|---|---|
| `nexusSitesCreate` | 889 | Site creation |
| `nexusSitesStart` | 920 | Site start |
| `nexusSitesStop` | 961 | Site stop |
| `nexusSiteRefresh` | 1101 | Site refresh |
| `nexusFleetRefresh` | 1114 | Fleet-wide MCP call |
| `nexusWpeSiteDeepRefresh` | 1128 | 7 parallel SSH WP-CLI calls |
| `nexusWpCommand` | 1555 | WP-CLI subprocess |
| `nexusWpPluginList` | 1653 | WP-CLI subprocess |
| `nexusSyncPull` | 1769 | File + DB transfer |
| `nexusSyncPush` | 1872 | File + DB transfer |
| `nexusFleetHealth` | 2390 | Fleet health scan |
| `nexusFleetBulkReindex` | 2827 | Bulk reindex *(+ internal pLimit)* |
| `nexusFleetBulkPluginUpdate` | 2885 | Bulk WP-CLI *(+ internal pLimit)* |
| `nexusFleetBulkHealthCheck` | 2975 | Bulk health *(+ internal pLimit)* |
| `nexusContentReindex` | 3366 | LanceDB reindex |
| `nexusAiSetup` | 3451 | Plugin install + WP-CLI |
| `nexusAiRun` | 3639 | AI inference |
| `nexusAuditSite` | 3839 | Site audit |
| `nexusAuditPlugins` | 3931 | Fleet plugin audit |
| `nexusDbScan` | 4000 | DB scan via WP-CLI |
| `nexusDbClean` | 4052 | DB clean via WP-CLI |

**2c. Bulk-op internal fan-out — 3 resolvers**

These three additionally replace their unbounded `Promise.all(items.map(...))` with a `pLimit(3)` fan-out. Each creates a local `limit` instance scoped to the resolver invocation (so concurrent bulk calls each get their own limit, not a shared one):

```ts
nexusFleetBulkReindex: async (_parent, { targets }) => {
  return withQueue(async () => {
    const limit = pLimit(3);
    const results = await Promise.all(
      targets.map((target) => limit(async () => {
        // ...per-item body unchanged...
      }))
    );
    // ...
  });
},
```

Same pattern for `nexusFleetBulkPluginUpdate` and `nexusFleetBulkHealthCheck`.

## Data Flow

```
Agent fires 30 concurrent GraphQL mutations
        │
        ▼
resolverQueue (PQueue, concurrency=3)
        │
   3 run now; 27 wait in queue
        │
  nexusFleetBulkReindex  ←── one of the 3
        │
        ▼
  pLimit(3) internal fan-out
  max 3 sites reindexed concurrently
```

## Resolvers Intentionally Left Ungated

Light reads and state queries that do no shell/SSH/file/AI work:

`nexusSitesList`, `nexusSitesGet`, `nexusSiteStatus`, `nexusBlueprintsList`, `nexusBlueprintsSave`, `nexusFleetGroupsList/Create/Add/Remove/Delete`, `nexusFleetSearch`, `nexusFleetFilter`, `nexusFleetCompare`, `nexusContentSearch`, `nexusContentSearchAll`, `nexusContentStructure`, `nexusContentIndexStatus`, `nexusContentListIndexed`, `nexusAiModels`, `nexusAiAsk`, `nexusAiAbilities`, `nexusAiStatus`, `nexusAiSwitchProvider`, `nexusAiSyncCredentials`, `nexusWpeStatus`, `nexusWpeLogin`, `nexusWpeLogout`, `nexusClearApiCredentials`, `nexusWpeApiCredentialsStatus`, `nexusWpeAccounts`, `nexusWpeInstalls`, `nexusWpeInstall`, `nexusWpeBackup`, `nexusWpeCache`, `nexusWpeLink`, `nexusWpeChanges`, `nexusSyncHistory`, `nexusFleetSiteHealth`, `nexusDbReport`, `nexusSyncHistory`, `nexusWpeAccount`, and related WPE account/user queries.

## Error Handling

No change. `withQueue` propagates exceptions normally. The `try/catch` inside each resolver still handles them and returns the existing `{ success: false, error: string }` shape. The queue itself cannot throw in this usage pattern.

## Testing

No new test files required. Existing resolver tests exercise the resolver logic; queue behavior is transparent to callers. If we add queue-depth observability later, a unit test for `withQueue` concurrency behavior can be added then.

## Implementation Order

1. Add `withQueue` to `resolver-utils.ts`
2. Add `pLimit` import + `withQueue` import to `resolvers.ts`  
3. Apply `withQueue` to each of the 21 gated resolvers in line-number order
4. Replace `Promise.all` fan-out in the 3 bulk resolvers with `pLimit(3)` (inside their `withQueue` wrapper)
5. Build (`npm run build`) and verify TypeScript compiles clean
