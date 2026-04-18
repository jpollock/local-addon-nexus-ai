# src/main/types — Root Type Definitions

Three interfaces that are the source of most downstream `: any` usage.
Adding imports from these files (rather than `any`) is the correct fix
when the compiler complains about untyped service objects or IPC parameters.

---

## nexus-services.ts — `NexusServices`

**What:** The complete typed interface for the service container object passed
to MCP tool handlers and GraphQL resolvers.

**Use when:** You receive a `services` parameter in an MCP tool's `execute()`
function or in a GraphQL resolver, and need types beyond `any`.

```typescript
import type { NexusServices } from '../types/nexus-services';

execute(args: Record<string, unknown>, services: NexusServices) { ... }
```

**Key properties:**
- Core (always present): `vectorStore`, `embeddingService`, `contentPipeline`,
  `indexRegistry`, `fileScanner`, `siteData`, `logger`
- Optional: `localServices`, `auditLogger`, `registryStorage`, `graphService`,
  `eventProcessor`, `searchService`, `healthCalculator`, `filterEngine`,
  `bulkOpManager`, `twinService`, `metadataCache`, `operationTracker`, `registry`

Optional fields are either added after initialization (Sprint 2/3 services)
or depend on features being enabled. Always guard with `?.` or `if (!...)`.

---

## site-data.ts — `LocalSite` and `LocalSiteDataAccessor`

**What:** Typed interfaces for Local's internal site objects and the accessor
used to retrieve them from `IpcHandlerDeps.siteData`.

**Use when:** You iterate over sites from `siteData.getSites()` or access
properties on a single site from `siteData.getSite(id)`.

```typescript
import type { LocalSite, LocalSiteDataAccessor } from '../types/site-data';

function resolveSite(name: string, siteData: LocalSiteDataAccessor): LocalSite | undefined {
  return Object.values(siteData.getSites()).find((s) => s.name === name);
}
```

**Key `LocalSite` properties:** `id`, `name`, `path`, `domain?`, `url?`,
`status?`, `phpVersion?`, `wpVersion?`, `ports?`, `services?`, `paths?`,
`mysqlPort?`, `hostConnections?`

These are derived from actual usage — not from Local's internal source.
Add new properties when you observe new access patterns.

---

## ipc-handler-deps.ts — `IpcHandlerDeps` and `LocalServiceContainer`

**What:** All dependencies injected into `registerIpcHandlers()`. Replaces
the previous inline interface that left `siteData`, `localLogger`,
`serviceContainer`, and `nexusServices` untyped.

**Use when:** You are implementing a new IPC handler module (e.g., extracting
handlers from ipc-handlers.ts into a modular file) and need to receive the
same dependencies.

```typescript
import type { IpcHandlerDeps } from '../types/ipc-handler-deps';

export function registerCredentialHandlers(deps: IpcHandlerDeps): void {
  const { siteData, registryStorage, localLogger } = deps;
  // ...
}
```

**Also exported:** `LocalServiceContainer` — the minimal typed surface for
Local's raw service container. Use only for operations not yet wrapped by
`LocalServicesBridge` (navigation, group refresh, WPE OAuth).

---

## When to add new properties

- Add to `NexusServices` when a new service is injectable into MCP tools.
- Add to `LocalSite` when new site object properties are accessed in code.
- Add to `IpcHandlerDeps` when new dependencies are passed to `registerIpcHandlers`.
- Add to `LocalServiceContainer` when new Local container services are accessed directly.

Do not add speculative properties. Only add what is actually accessed.
