# GraphQL Resolver Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global PQueue(concurrency=3) to 21 expensive GraphQL resolver handlers and replace unbounded `Promise.all` fan-out in 3 bulk resolvers with `pLimit(3)`.

**Architecture:** A shared `resolverQueue` (PQueue, concurrency=3) and `withQueue<T>` wrapper are added to `resolver-utils.ts`. Each expensive resolver body in `resolvers.ts` is wrapped in `return withQueue(async () => { ...existing body... })`. The three bulk resolvers additionally replace `Promise.all(targets.map(...))` with `Promise.all(targets.map(t => limit(() => work(t))))` using a per-call `pLimit(3)` instance. No schema or return shapes change.

**Tech Stack:** p-queue@6.6.2 (already installed, CJS — no install needed), p-limit@7.3.0 (already installed, already used in `WPESyncService.ts`)

---

## File Map

| File | Change |
|---|---|
| `src/main/graphql/resolver-utils.ts` | Add `resolverQueue` + `withQueue` exports |
| `src/main/graphql/resolvers.ts` | Add 2 imports; wrap 21 resolver bodies; replace 3x `Promise.all` with `pLimit` |
| `tests/unit/graphql/resolver-utils.test.ts` | New — unit tests for `withQueue` |

**Note:** The branch also has domain-split modules in `src/main/graphql/resolvers/` (sites.ts, twin.ts, wp-cli.ts, wpe.ts). These are tested but NOT wired into the app — `src/main/index.ts` still imports `createResolvers` from `resolvers.ts`. This plan targets `resolvers.ts` only.

---

## Wrap Pattern Reference

Every resolver edit follows one of two patterns. Refer here for each task below.

**Pattern A — Simple wrap** (resolvers with outer `try/catch`):

```ts
// BEFORE:
nexusFoo: async (_parent: ResolverParent, args) => {
  try {
    // body
  } catch (error: any) {
    return { success: false, error: error.message, ... };
  }
},

// AFTER — add return withQueue(...) + closing });
nexusFoo: async (_parent: ResolverParent, args) => {
  return withQueue(async () => {
  try {
    // body — UNCHANGED
  } catch (error: any) {
    return { success: false, error: error.message, ... };
  }
  });
},
```

**Pattern B — Pre-try variable + wrap** (`nexusWpeSiteDeepRefresh`):

```ts
// BEFORE:
nexusWpeSiteDeepRefresh: async (...) => {
  const empty = { ... };
  try { ... } catch (error: any) { return { ...empty }; }
},

// AFTER — const empty stays outside the queue wrapper:
nexusWpeSiteDeepRefresh: async (...) => {
  const empty = { ... };
  return withQueue(async () => {
  try { ... } catch (error: any) { return { ...empty }; }
  });
},
```

**Pattern C — Bulk resolver** (replace `Promise.all` fan-out + wrap):

```ts
// BEFORE:
nexusFleetBulkFoo: async (_parent, { targets }) => {
  try {
    const fooPromises = targets.map(async (target) => { /* per-item */ });
    const fooResults = await Promise.all(fooPromises);
    return { success: true, results: fooResults };
  } catch (error: any) { return { success: false, error: error.message, results: [] }; }
},

// AFTER — withQueue wrapper + inline pLimit(3) fan-out:
nexusFleetBulkFoo: async (_parent, { targets }) => {
  return withQueue(async () => {
  try {
    const limit = pLimit(3);
    const fooResults = await Promise.all(targets.map((target) => limit(async () => {
      /* per-item body UNCHANGED */
    })));
    return { success: true, results: fooResults };
  } catch (error: any) { return { success: false, error: error.message, results: [] }; }
  });
},
```

---

## Task 1: Add `withQueue` to `resolver-utils.ts` + unit test

**Files:**
- Modify: `src/main/graphql/resolver-utils.ts`
- Create: `tests/unit/graphql/resolver-utils.test.ts`

- [ ] **Step 1: Add PQueue import and exports to resolver-utils.ts**

Append at the very end of `src/main/graphql/resolver-utils.ts` (after `buildWpeSiteDetails`):

```ts
// ---------------------------------------------------------------------------
// Resolver concurrency queue
// ---------------------------------------------------------------------------

import PQueue from 'p-queue';

/** Global concurrency limiter — caps expensive resolver handlers at 3 concurrent. */
export const resolverQueue = new PQueue({ concurrency: 3 });

/**
 * Run an expensive resolver body inside the global concurrency queue.
 * Does not change resolver return shapes or error behavior.
 */
export function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  return resolverQueue.add(fn) as Promise<T>;
}
```

- [ ] **Step 2: Write the unit tests for withQueue**

Create `tests/unit/graphql/resolver-utils.test.ts`:

```ts
import { withQueue } from '../../../src/main/graphql/resolver-utils';

describe('withQueue', () => {
  test('executes the wrapped function and returns its result', async () => {
    const result = await withQueue(async () => 42);
    expect(result).toBe(42);
  });

  test('returns object results unchanged', async () => {
    const result = await withQueue(async () => ({ success: true, data: 'hello' }));
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  test('propagates rejection from wrapped function', async () => {
    await expect(
      withQueue(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
npx jest tests/unit/graphql/resolver-utils.test.ts --no-coverage
```

Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add src/main/graphql/resolver-utils.ts tests/unit/graphql/resolver-utils.test.ts
git commit -m "feat(graphql-queue): add resolverQueue + withQueue to resolver-utils"
```

---

## Task 2: Wire imports + wrap site lifecycle resolvers (6 resolvers)

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (lines ~1–35 for imports; lines ~889–1234 for resolvers)

**Resolvers:** `nexusSitesCreate`, `nexusSitesStart`, `nexusSitesStop`, `nexusSiteRefresh`, `nexusFleetRefresh`, `nexusWpeSiteDeepRefresh`

- [ ] **Step 1: Add imports at top of resolvers.ts**

In `src/main/graphql/resolvers.ts`, the file currently starts with this import block:

```ts
import type { ToolRegistry } from '../mcp/tool-registry';
import * as ollamaClient from '../helpers/ollama-client';
```

Add two new imports immediately after the existing import block (before the `/** The root value... */` comment at line ~28):

```ts
import pLimit from 'p-limit';
import { withQueue } from './resolver-utils';
```

The full top of the file should then look like:

```ts
import type { ToolRegistry } from '../mcp/tool-registry';
import * as ollamaClient from '../helpers/ollama-client';
import {
  buildDateRange,
  // ... existing imports ...
} from '../mcp/modules/wpe/usage-cache';
// ... all existing imports ...
import { getApiKey, KeyVault } from '../security/KeyVault';
import type { NexusServices } from '../types/nexus-services';
import type { LocalSite, LocalSiteDataAccessor } from '../types/site-data';
import pLimit from 'p-limit';
import { withQueue } from './resolver-utils';
```

- [ ] **Step 2: Wrap nexusSitesCreate (line ~889)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSitesCreate: async (_parent: ResolverParent, { input }: { input: any }) => {
        try {
```

Replace with:

```ts
      nexusSitesCreate: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
        try {
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Start a local site
       */
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
        });
      },

      /**
       * Start a local site
       */
```

- [ ] **Step 3: Wrap nexusSitesStart (line ~920)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSitesStart: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
```

Replace with:

```ts
      nexusSitesStart: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
```

Edit 2 — close wrap. Find and replace:

```ts
          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Stop a local site
       */
```

Replace with:

```ts
          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
        });
      },

      /**
       * Stop a local site
       */
```

- [ ] **Step 4: Wrap nexusSitesStop (line ~961)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSitesStop: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be stopped. WPE sites are always running.',
            };
```

Replace with:

```ts
      nexusSitesStop: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be stopped. WPE sites are always running.',
            };
```

Edit 2 — close wrap. Find and replace:

```ts
          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Restart a local site
       */
```

Replace with:

```ts
          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
        });
      },

      /**
       * Restart a local site
       */
```

- [ ] **Step 5: Wrap nexusSiteRefresh (line ~1101)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSiteRefresh: async (_parent: ResolverParent, { target, force }: { target: string; force?: boolean }) => {
        try {
```

Replace with:

```ts
      nexusSiteRefresh: async (_parent: ResolverParent, { target, force }: { target: string; force?: boolean }) => {
        return withQueue(async () => {
        try {
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      /**
       * Digital twin: refresh all sites
       */
```

Replace with:

```ts
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
        });
      },

      /**
       * Digital twin: refresh all sites
       */
```

- [ ] **Step 6: Wrap nexusFleetRefresh (line ~1114)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusFleetRefresh: async () => {
        try {
```

Replace with:

```ts
      nexusFleetRefresh: async () => {
        return withQueue(async () => {
        try {
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      /**
       * Deep-refresh a WPE site via SSH WP-CLI:
```

Replace with:

```ts
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
        });
      },

      /**
       * Deep-refresh a WPE site via SSH WP-CLI:
```

- [ ] **Step 7: Wrap nexusWpeSiteDeepRefresh (line ~1128) — Pattern B**

Edit 1 — open wrap (insert after `const empty = ...`). Find and replace:

```ts
        const empty = { installName, pluginCount: 0, themeCount: 0, wpVersion: null };
        try {
```

Replace with:

```ts
        const empty = { installName, pluginCount: 0, themeCount: 0, wpVersion: null };
        return withQueue(async () => {
        try {
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return { success: false, error: error.message, ...empty };
        }
      },

      /**
       * Fleet-wide summary from twin cache
```

Replace with:

```ts
        } catch (error: any) {
          return { success: false, error: error.message, ...empty };
        }
        });
      },

      /**
       * Fleet-wide summary from twin cache
```

- [ ] **Step 8: Build to check for TypeScript errors**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
npm run build 2>&1 | grep -E "error TS|warning|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/main/graphql/resolvers.ts
git commit -m "feat(graphql-queue): queue site lifecycle resolvers (create/start/stop/refresh/fleet-refresh/deep-refresh)"
```

---

## Task 3: Wrap WP-CLI + sync resolvers (4 resolvers)

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (lines ~1555–1990)

**Resolvers:** `nexusWpCommand`, `nexusWpPluginList`, `nexusSyncPull`, `nexusSyncPush`

- [ ] **Step 1: Wrap nexusWpCommand (line ~1555)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusWpCommand: async (_parent: ResolverParent, { target, command }: { target: string; command: string[] }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              stdout: '',
              stderr: '',
              exitCode: 1,
            };
          }
```

Replace with:

```ts
      nexusWpCommand: async (_parent: ResolverParent, { target, command }: { target: string; command: string[] }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              stdout: '',
              stderr: '',
              exitCode: 1,
            };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            stdout: '',
            stderr: '',
            exitCode: 1,
          };
        }
      },

      /**
       * List plugins on a site (local or WPE)
       */
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            stdout: '',
            stderr: '',
            exitCode: 1,
          };
        }
        });
      },

      /**
       * List plugins on a site (local or WPE)
       */
```

- [ ] **Step 2: Wrap nexusWpPluginList (line ~1653)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusWpPluginList: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              plugins: [],
            };
          }
```

Replace with:

```ts
      nexusWpPluginList: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              plugins: [],
            };
          }
```

Edit 2 — close wrap. Find and replace (the catch at the end of nexusWpPluginList):

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            plugins: [],
          };
        }
      },

      nexusSyncPull:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            plugins: [],
          };
        }
        });
      },

      nexusSyncPull:
```

- [ ] **Step 3: Wrap nexusSyncPull (line ~1769)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSyncPull: async (_parent: ResolverParent, { input }: { input: any }) => {
        try {
          const localParsed = parseTarget(input.localSite);
```

Replace with:

```ts
      nexusSyncPull: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
        try {
          const localParsed = parseTarget(input.localSite);
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
          };
        }
      },

      /**
       * Push from local to WPE
       */
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
          };
        }
        });
      },

      /**
       * Push from local to WPE
       */
```

- [ ] **Step 4: Wrap nexusSyncPush (line ~1872)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusSyncPush: async (_parent: ResolverParent, { input }: { input: any }) => {
        try {
          const localParsed = parseTarget(input.localSite);
          const wpeParsed = parseTarget(input.wpeTarget);

          if (localParsed.type !== 'local') {
            throw new Error('Local target must use @local syntax (e.g., mysite@local)');
          }

          if (wpeParsed.type !== 'wpe') {
            throw new Error('WPE target must use wpe:account/install@env syntax');
          }

          const site = resolveSite(localParsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
```

Replace with:

```ts
      nexusSyncPush: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
        try {
          const localParsed = parseTarget(input.localSite);
          const wpeParsed = parseTarget(input.wpeTarget);

          if (localParsed.type !== 'local') {
            throw new Error('Local target must use @local syntax (e.g., mysite@local)');
          }

          if (wpeParsed.type !== 'wpe') {
            throw new Error('WPE target must use wpe:account/install@env syntax');
          }

          const site = resolveSite(localParsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
```

Edit 2 — close wrap. Find the end of nexusSyncPush. The catch block ends with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
          };
        }
      },

      nexusWpeAccounts:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
          };
        }
        });
      },

      nexusWpeAccounts:
```

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/graphql/resolvers.ts
git commit -m "feat(graphql-queue): queue WP-CLI + sync resolvers (wp-command/plugin-list/sync-pull/sync-push)"
```

---

## Task 4: Wrap fleet health + bulk resolvers (4 resolvers, 3 with pLimit fan-out)

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (lines ~2390–3041)

**Resolvers:** `nexusFleetHealth`, `nexusFleetBulkReindex` (Pattern C), `nexusFleetBulkPluginUpdate` (Pattern C), `nexusFleetBulkHealthCheck` (Pattern C)

- [ ] **Step 1: Wrap nexusFleetHealth (line ~2390)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusFleetHealth: async () => {
        try {
          if (!services.healthCalculator) {
```

Replace with:

```ts
      nexusFleetHealth: async () => {
        return withQueue(async () => {
        try {
          if (!services.healthCalculator) {
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            summary: null,
          };
        }
      },

      nexusFleetSiteHealth:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            summary: null,
          };
        }
        });
      },

      nexusFleetSiteHealth:
```

- [ ] **Step 2: Wrap nexusFleetBulkReindex + replace Promise.all (line ~2827) — Pattern C**

This is a two-part change: add `withQueue` wrapper AND replace the fan-out.

Edit 1 — open wrap. Find and replace:

```ts
      nexusFleetBulkReindex: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        try {
          const results = [];

          // Reindex each target in parallel
          const reindexPromises = targets.map(async (target) => {
```

Replace with:

```ts
      nexusFleetBulkReindex: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        return withQueue(async () => {
        try {
          const limit = pLimit(3);

          // Reindex each target with bounded concurrency
          const reindexPromises = targets.map((target) => limit(async () => {
```

Edit 2 — close the arrow function that was opened with `targets.map(async (target) => {`. The map body ends with `};` and the array closes. Find and replace:

```ts
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                documentCount: 0,
              };
            }
          });

          const reindexResults = await Promise.all(reindexPromises);

          return {
            success: true,
            results: reindexResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetBulkPluginUpdate:
```

Replace with:

```ts
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                documentCount: 0,
              };
            }
          }));

          const reindexResults = await Promise.all(reindexPromises);

          return {
            success: true,
            results: reindexResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
        });
      },

      nexusFleetBulkPluginUpdate:
```

- [ ] **Step 3: Wrap nexusFleetBulkPluginUpdate + replace Promise.all (line ~2885) — Pattern C**

Edit 1 — open wrap + replace fan-out start. Find and replace:

```ts
      nexusFleetBulkPluginUpdate: async (_parent: ResolverParent, { input }: { input: any }) => {
        try {
          const { targets, plugin, all, dryRun } = input;
          const results = [];

          // Update plugins on each target in parallel
          const updatePromises = targets.map(async (target: string) => {
```

Replace with:

```ts
      nexusFleetBulkPluginUpdate: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
        try {
          const { targets, plugin, all, dryRun } = input;
          const limit = pLimit(3);

          // Update plugins on each target with bounded concurrency
          const updatePromises = targets.map((target: string) => limit(async () => {
```

Edit 2 — close fan-out arrow + add withQueue close. Find and replace:

```ts
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                updatedPlugins: [],
              };
            }
          });

          const updateResults = await Promise.all(updatePromises);

          return {
            success: true,
            results: updateResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetBulkHealthCheck:
```

Replace with:

```ts
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                updatedPlugins: [],
              };
            }
          }));

          const updateResults = await Promise.all(updatePromises);

          return {
            success: true,
            results: updateResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
        });
      },

      nexusFleetBulkHealthCheck:
```

- [ ] **Step 4: Wrap nexusFleetBulkHealthCheck + replace Promise.all (line ~2975) — Pattern C**

Edit 1 — open wrap + replace fan-out start. Find and replace:

```ts
      nexusFleetBulkHealthCheck: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health calculator not available',
              results: [],
            };
          }

          const results = [];
          const allSites = services.siteData.getSites();

          // Check health for each target in parallel
          const healthPromises = targets.map(async (target) => {
```

Replace with:

```ts
      nexusFleetBulkHealthCheck: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        return withQueue(async () => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health calculator not available',
              results: [],
            };
          }

          const allSites = services.siteData.getSites();
          const limit = pLimit(3);

          // Check health for each target with bounded concurrency
          const healthPromises = targets.map((target) => limit(async () => {
```

Edit 2 — close fan-out arrow + add withQueue close. Find and replace:

```ts
            } catch (error: any) {
              return {
                target,
                status: 'error',
                score: 0,
                issueCount: 0,
              };
            }
          });

          const healthResults = await Promise.all(healthPromises);

          return {
            success: true,
            results: healthResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetCompare:
```

Replace with:

```ts
            } catch (error: any) {
              return {
                target,
                status: 'error',
                score: 0,
                issueCount: 0,
              };
            }
          }));

          const healthResults = await Promise.all(healthPromises);

          return {
            success: true,
            results: healthResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
        });
      },

      nexusFleetCompare:
```

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/graphql/resolvers.ts
git commit -m "feat(graphql-queue): queue fleet health + bulk ops; replace Promise.all with pLimit(3)"
```

---

## Task 5: Wrap content + AI + audit + DB resolvers (7 resolvers)

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (lines ~3366–4089)

**Resolvers:** `nexusContentReindex`, `nexusAiSetup`, `nexusAiRun`, `nexusAuditSite`, `nexusAuditPlugins`, `nexusDbScan`, `nexusDbClean`

- [ ] **Step 1: Wrap nexusContentReindex (line ~3366)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusContentReindex: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);
```

Replace with:

```ts
      nexusContentReindex: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            documentCount: 0,
            chunkCount: 0,
          };
        }
      },

      // ========================================================================
      // AI & Connector Resolvers
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            documentCount: 0,
            chunkCount: 0,
          };
        }
        });
      },

      // ========================================================================
      // AI & Connector Resolvers
```

- [ ] **Step 2: Wrap nexusAiSetup (line ~3451)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusAiSetup: async (_parent: ResolverParent, { target, provider, force }: { target: string; provider?: string; force?: boolean }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              installed: [],
              configured: null,
            };
          }
```

Replace with:

```ts
      nexusAiSetup: async (_parent: ResolverParent, { target, provider, force }: { target: string; provider?: string; force?: boolean }) => {
        return withQueue(async () => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              installed: [],
              configured: null,
            };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            installed: [],
            configured: null,
          };
        }
      },

      nexusAiSyncCredentials:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            installed: [],
            configured: null,
          };
        }
        });
      },

      nexusAiSyncCredentials:
```

- [ ] **Step 3: Wrap nexusAiRun (line ~3639)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusAiRun: async (_parent: ResolverParent, { target, ability, params }: { target: string; ability: string; params?: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              result: null,
            };
          }
```

Replace with:

```ts
      nexusAiRun: async (_parent: ResolverParent, { target, ability, params }: { target: string; ability: string; params?: string }) => {
        return withQueue(async () => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              result: null,
            };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            result: null,
          };
        }
      },

      nexusAiStatus:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            result: null,
          };
        }
        });
      },

      nexusAiStatus:
```

- [ ] **Step 4: Wrap nexusAuditSite (line ~3839)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusAuditSite: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              audit: null,
            };
          }
```

Replace with:

```ts
      nexusAuditSite: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              audit: null,
            };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            audit: null,
          };
        }
      },

      nexusAuditPlugins:
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            audit: null,
          };
        }
        });
      },

      nexusAuditPlugins:
```

- [ ] **Step 5: Wrap nexusAuditPlugins (line ~3931)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusAuditPlugins: async () => {
        try {
          // Get all sites
          const allSites = services.siteData.getSites();
```

Replace with:

```ts
      nexusAuditPlugins: async () => {
        return withQueue(async () => {
        try {
          // Get all sites
          const allSites = services.siteData.getSites();
```

Edit 2 — close wrap. Find and replace:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            report: null,
          };
        }
      },

      /**
       * Scan database health for a local WordPress site
       */
```

Replace with:

```ts
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            report: null,
          };
        }
        });
      },

      /**
       * Scan database health for a local WordPress site
       */
```

- [ ] **Step 6: Wrap nexusDbScan (line ~4000)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusDbScan: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', scan: null };
          }
```

Replace with:

```ts
      nexusDbScan: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', scan: null };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
          return { success: true, scan: scanGql };
        } catch (error: any) {
          return { success: false, error: error.message, scan: null };
        }
      },

      /**
       * Clean database items (dry_run defaults to true)
       */
```

Replace with:

```ts
          return { success: true, scan: scanGql };
        } catch (error: any) {
          return { success: false, error: error.message, scan: null };
        }
        });
      },

      /**
       * Clean database items (dry_run defaults to true)
       */
```

- [ ] **Step 7: Wrap nexusDbClean (line ~4052)**

Edit 1 — open wrap. Find and replace:

```ts
      nexusDbClean: async (_parent: ResolverParent, { input }: { input: { target: string; items?: string[]; dryRun?: boolean } }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', result: null };
          }
```

Replace with:

```ts
      nexusDbClean: async (_parent: ResolverParent, { input }: { input: { target: string; items?: string[]; dryRun?: boolean } }) => {
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', result: null };
          }
```

Edit 2 — close wrap. Find and replace:

```ts
          return { success: true, result: cleanResult };
        } catch (error: any) {
          return { success: false, error: error.message, result: null };
        }
      },

      /**
       * Fleet database health report — scans all running sites
       */
```

Replace with:

```ts
          return { success: true, result: cleanResult };
        } catch (error: any) {
          return { success: false, error: error.message, result: null };
        }
        });
      },

      /**
       * Fleet database health report — scans all running sites
       */
```

- [ ] **Step 8: Build check**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/main/graphql/resolvers.ts
git commit -m "feat(graphql-queue): queue content/AI/audit/DB resolvers (reindex/ai-setup/ai-run/audit/db-scan/db-clean)"
```

---

## Task 6: Full build + test suite verification

**Files:** none changed

- [ ] **Step 1: Full build**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
npm run build
```

Expected: exits 0, no `error TS` lines.

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all existing tests pass (pre-existing LanceDB open-handle warning is normal — see CLAUDE.md). The resolver-utils tests added in Task 1 pass.

- [ ] **Step 3: Verify resolver count**

Confirm all 21 resolvers are wrapped by checking that `withQueue` appears in the right quantity:

```bash
grep -c "return withQueue" src/main/graphql/resolvers.ts
```

Expected: `21`

- [ ] **Step 4: Verify pLimit fan-out in bulk resolvers**

```bash
grep -n "pLimit(3)" src/main/graphql/resolvers.ts
```

Expected: 3 lines — one inside each bulk resolver.

- [ ] **Step 5: Final commit**

```bash
git add -p  # verify nothing unexpected is staged
git commit -m "test(graphql-queue): verify build + full suite pass"
```

Only commit if there are unstaged changes; skip if clean.
