# WPE Access Control v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse `wpeAllowedEnvironments` flag with a unified "three-gate" access control system: (1) account scope, (2) per-operation × per-environment defaults, (3) per-site exceptions — all in a single Preferences section.

**Architecture:** New `WpeOperationPermissions` and `WpeSiteException` types replace `wpeAllowedEnvironments` in `NexusSettings`. A new `isOperationAllowed()` helper replaces the old `isWpeEnvironmentAllowed()` family. The Preferences UI merges `renderWpeAccountFilterSection()` and `renderWpeEnvironmentFilterSection()` into a single `renderWpeAccessControlSection()` using the "rule-centric card" pattern from the approved mockup. All existing enforcement points are updated to use the new helper. A migration path converts old settings on first load.

**Tech Stack:** TypeScript, React (class-based, no JSX, `React.createElement`), existing `NexusSettings` storage pattern

**Branch:** `feat/wpe-access-control-v2`

---

## Mockup Reference

The approved UI has three gates in a single Preferences section:

```
Gate 1 — Account Scope (compact collapsible)
  Chip row: [btwpe ✓] [devrel ✓] [qawpe ✗] ...
  Expanded: full account grid

Gate 2+3 — Operation Cards (replace env checkboxes)
  [Pull to local    ▶]  Dev✓ Stg✓ Prd✓
  [WP-CLI over SSH  ▶]  Dev✓ Stg✓ Prd✗  [2 exceptions]
  [Push to WPE      ▶]  Dev✓ Stg✓ Prd✗
  [Delete/Promote   ▶]  Dev✗ Stg✗ Prd✗

Footer: "Read metadata is always permitted."
```

Each operation card expands to show:
- **Left**: toggles per environment (Dev/Staging/Production)
- **Right**: site exceptions list + "＋ Add site exception"

---

## Data Model

### New types (added to `src/common/types.ts`)

```typescript
/** Per-environment on/off flags for one operation */
export interface WpeEnvFlags {
  development?: boolean;
  staging?: boolean;
  production?: boolean;
}

/**
 * Granular operation permissions replacing wpeAllowedEnvironments.
 * Each key is an operation type; each value is per-environment flags.
 * Missing keys fall back to DEFAULT_OPERATION_PERMISSIONS.
 */
export interface WpeOperationPermissions {
  pull?:   WpeEnvFlags;  // local_wpe_pull
  wpcli?:  WpeEnvFlags;  // WP-CLI over SSH (includes deep-refresh, wait-for-ssh)
  push?:   WpeEnvFlags;  // local_wpe_push
  delete?: WpeEnvFlags;  // delete-install, delete-site, promote-environment, update-install, purge-cache
}

/** A site-level override for one or more operations */
export interface WpeSiteException {
  installName: string;   // WPE install name (e.g. "mystore")
  environment: string;   // 'production' | 'staging' | 'development'
  overrides: {
    pull?:   boolean;
    wpcli?:  boolean;
    push?:   boolean;
    delete?: boolean;
  };
}
```

### Updated `NexusSettings` fields

```typescript
// Keep wpeAccountFilter unchanged (same semantic, same storage key)
wpeAccountFilter?: string[] | null;

// NEW — replaces wpeAllowedEnvironments
wpeOperationPermissions?: WpeOperationPermissions;

// NEW — per-site exceptions
wpeSiteExceptions?: WpeSiteException[];

// DEPRECATED — kept for migration only, do not use in new code
/** @deprecated Use wpeOperationPermissions instead */
wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[];
```

### Default permissions

```typescript
export const DEFAULT_OPERATION_PERMISSIONS: Required<WpeOperationPermissions> = {
  pull:   { development: true,  staging: true,  production: true  },
  wpcli:  { development: true,  staging: true,  production: false },
  push:   { development: true,  staging: true,  production: false },
  delete: { development: false, staging: false, production: false },
};
```

---

## File Map

**New:**
- `src/main/mcp/utils/operation-permissions.ts` — `isOperationAllowed()`, `DEFAULT_OPERATION_PERMISSIONS`, migration helper
- `tests/unit/mcp/operation-permissions.test.ts` — unit tests

**Modified:**
- `src/common/types.ts` — add `WpeEnvFlags`, `WpeOperationPermissions`, `WpeSiteException`; update `NexusSettings`
- `src/main/mcp/utils/environment-filter.ts` — deprecate old helpers (keep for compat shim), import new helper
- `src/main/events/WPESyncService.ts` — use `isOperationAllowed('wpcli', ...)`
- `src/main/graphql/resolvers.ts` — use `isOperationAllowed`
- `src/main/mcp/modules/wp-cli/remote-exec.ts` — use `isOperationAllowed`
- `src/main/mcp/modules/wpe/deep-refresh.ts` — use `isOperationAllowed`
- `src/main/mcp/modules/wpe/wait-for-ssh.ts` — use `isOperationAllowed`
- `src/main/mcp/modules/wpe/wpe-push.ts` — **NEW enforcement**: check `isOperationAllowed('push', ...)`
- `src/main/mcp/modules/wpe/delete-install.ts`, `delete-site.ts`, `promote-environment.ts`, `update-install.ts`, `purge-cache.ts` — use `isOperationAllowed('delete', ...)`
- `src/renderer/components/NexusPreferences.tsx` — replace two sections with unified card UI

---

## Task 1: New Types + Operation Permissions Utility

**Files:**
- Modify: `src/common/types.ts`
- Create: `src/main/mcp/utils/operation-permissions.ts`
- Create: `tests/unit/mcp/operation-permissions.test.ts`

- [ ] **Step 1: Add new types to `src/common/types.ts`**

Find the `NexusSettings` interface (around line 250) and the existing `wpeAccountFilter` and `wpeAllowedEnvironments` fields. Add the new types BEFORE the interface, and add new fields inside it:

```typescript
// Add before NexusSettings interface:
export interface WpeEnvFlags {
  development?: boolean;
  staging?: boolean;
  production?: boolean;
}

export interface WpeOperationPermissions {
  pull?:   WpeEnvFlags;
  wpcli?:  WpeEnvFlags;
  push?:   WpeEnvFlags;
  delete?: WpeEnvFlags;
}

export interface WpeSiteException {
  installName: string;
  environment: string;
  overrides: {
    pull?:   boolean;
    wpcli?:  boolean;
    push?:   boolean;
    delete?: boolean;
  };
}
```

Inside `NexusSettings`, add after `wpeAllowedEnvironments`:
```typescript
  wpeOperationPermissions?: WpeOperationPermissions;
  wpeSiteExceptions?: WpeSiteException[];
```

- [ ] **Step 2: Write failing tests** (`tests/unit/mcp/operation-permissions.test.ts`)

```typescript
import {
  isOperationAllowed,
  DEFAULT_OPERATION_PERMISSIONS,
  migrateFromLegacyEnvFilter,
} from '../../../src/main/mcp/utils/operation-permissions';
import type { NexusSettings } from '../../../src/common/types';

describe('DEFAULT_OPERATION_PERMISSIONS', () => {
  it('allows pull on all environments', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.production).toBe(true);
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.staging).toBe(true);
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.development).toBe(true);
  });

  it('blocks wpcli on production by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.wpcli.production).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.wpcli.staging).toBe(true);
  });

  it('blocks push on production by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.push.production).toBe(false);
  });

  it('blocks delete on all environments by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.development).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.staging).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.production).toBe(false);
  });
});

describe('isOperationAllowed', () => {
  const baseSettings: NexusSettings = { autoIndex: true, excludedSiteIds: [] };

  it('uses defaults when wpeOperationPermissions not set', () => {
    expect(isOperationAllowed('wpcli', 'staging', baseSettings)).toBe(true);
    expect(isOperationAllowed('wpcli', 'production', baseSettings)).toBe(false);
    expect(isOperationAllowed('pull', 'production', baseSettings)).toBe(true);
  });

  it('respects custom permissions', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeOperationPermissions: { wpcli: { production: true, staging: true, development: true } },
    };
    expect(isOperationAllowed('wpcli', 'production', s)).toBe(true);
  });

  it('defaults unknown environment to production (blocked for wpcli)', () => {
    expect(isOperationAllowed('wpcli', undefined, baseSettings)).toBe(false);
    expect(isOperationAllowed('wpcli', 'unknown', baseSettings)).toBe(false);
  });

  it('applies site exception — allow overrides global block', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s, 'mystore')).toBe(true);
  });

  it('applies site exception — block overrides global allow', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'client-site', environment: 'staging', overrides: { push: false } },
      ],
    };
    expect(isOperationAllowed('push', 'staging', s, 'client-site')).toBe(false);
  });

  it('site exception for different install does not affect other installs', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s, 'other-install')).toBe(false);
  });

  it('no installName provided — site exceptions are ignored', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    // Without installName context, falls back to global — production blocked
    expect(isOperationAllowed('wpcli', 'production', s)).toBe(false);
  });
});

describe('migrateFromLegacyEnvFilter', () => {
  it('returns undefined when no legacy setting exists', () => {
    expect(migrateFromLegacyEnvFilter({})).toBeUndefined();
  });

  it('returns undefined when wpeOperationPermissions already set', () => {
    const s = { wpeAllowedEnvironments: ['staging'], wpeOperationPermissions: {} };
    expect(migrateFromLegacyEnvFilter(s as any)).toBeUndefined();
  });

  it('migrates production-included to all-allowed for wpcli/push', () => {
    const s = { wpeAllowedEnvironments: ['production', 'staging', 'development'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.production).toBe(true);
    expect(result.push?.production).toBe(true);
  });

  it('migrates production-excluded to wpcli/push blocked on production', () => {
    const s = { wpeAllowedEnvironments: ['staging', 'development'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.production).toBe(false);
    expect(result.push?.production).toBe(false);
    expect(result.wpcli?.staging).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern="operation-permissions" --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../../../src/main/mcp/utils/operation-permissions'`

- [ ] **Step 4: Implement `src/main/mcp/utils/operation-permissions.ts`**

```typescript
import type { NexusSettings, WpeOperationPermissions } from '../../../common/types';

export const DEFAULT_OPERATION_PERMISSIONS: Required<{
  [K in keyof Required<WpeOperationPermissions>]: Required<NonNullable<WpeOperationPermissions[K]>>;
}> = {
  pull:   { development: true,  staging: true,  production: true  },
  wpcli:  { development: true,  staging: true,  production: false },
  push:   { development: true,  staging: true,  production: false },
  delete: { development: false, staging: false, production: false },
};

type Operation = keyof typeof DEFAULT_OPERATION_PERMISSIONS;

/**
 * Check if an operation is permitted on a given WPE install environment.
 *
 * Resolution order:
 *   1. Site exception for (installName, environment) — if present, wins
 *   2. wpeOperationPermissions[operation][environment] — if set
 *   3. DEFAULT_OPERATION_PERMISSIONS[operation][environment]
 *
 * Undefined or unrecognised environments are treated as 'production' (safe default).
 *
 * @param operation  - The operation type to check
 * @param environment - The install environment string (e.g. 'production')
 * @param settings   - Current NexusSettings
 * @param installName - WPE install name; required to apply site exceptions
 */
export function isOperationAllowed(
  operation: Operation,
  environment: string | undefined,
  settings: Pick<NexusSettings, 'wpeOperationPermissions' | 'wpeSiteExceptions'>,
  installName?: string,
): boolean {
  const env = normaliseEnv(environment);

  // 1. Site exception wins if installName provided and exception exists
  if (installName && settings.wpeSiteExceptions?.length) {
    const exc = settings.wpeSiteExceptions.find(
      (e) => e.installName === installName && e.environment === env,
    );
    if (exc && operation in exc.overrides) {
      return exc.overrides[operation] ?? DEFAULT_OPERATION_PERMISSIONS[operation][env];
    }
  }

  // 2. Per-operation setting
  const perOp = settings.wpeOperationPermissions?.[operation];
  if (perOp && env in perOp) {
    return perOp[env as keyof typeof perOp] ?? DEFAULT_OPERATION_PERMISSIONS[operation][env];
  }

  // 3. Defaults
  return DEFAULT_OPERATION_PERMISSIONS[operation][env];
}

/** Normalise environment string to one of the three known values. Unknown → 'production'. */
function normaliseEnv(env: string | undefined): 'development' | 'staging' | 'production' {
  if (env === 'development' || env === 'staging') return env;
  return 'production'; // safe default — production is most restrictive
}

/**
 * Convert legacy wpeAllowedEnvironments to WpeOperationPermissions.
 * Returns undefined if no migration is needed (either no legacy setting, or
 * wpeOperationPermissions already exists).
 */
export function migrateFromLegacyEnvFilter(
  settings: Pick<NexusSettings, 'wpeAllowedEnvironments' | 'wpeOperationPermissions'>,
): WpeOperationPermissions | undefined {
  if (!settings.wpeAllowedEnvironments) return undefined;
  if (settings.wpeOperationPermissions) return undefined; // already migrated

  const allowedEnvs = settings.wpeAllowedEnvironments;
  const productionAllowed = allowedEnvs.includes('production');
  const stagingAllowed = allowedEnvs.includes('staging');
  const devAllowed = allowedEnvs.includes('development');

  return {
    pull:   { development: devAllowed,     staging: stagingAllowed,  production: true }, // pull was never blocked
    wpcli:  { development: devAllowed,     staging: stagingAllowed,  production: productionAllowed },
    push:   { development: devAllowed,     staging: stagingAllowed,  production: productionAllowed },
    delete: { development: false,          staging: false,           production: false }, // delete always off
  };
}
```

- [ ] **Step 5: Run tests — expect all to pass**

```bash
npx jest --testPathPattern="operation-permissions" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 13 passed`

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 7: Commit**

```bash
git add src/common/types.ts src/main/mcp/utils/operation-permissions.ts tests/unit/mcp/operation-permissions.test.ts
git commit -m "feat(wpe-v2): WpeOperationPermissions types + isOperationAllowed helper

Replaces coarse wpeAllowedEnvironments with per-operation, per-environment
flags plus site-level exceptions. Includes migration helper to convert
legacy settings on first load. 13 unit tests."
```

---

## Task 2: Update All Enforcement Points

Replace all `isWpeEnvironmentAllowed` / `checkKnownEnvironmentAccess` / `checkWpeInstallIdEnvironmentAccess` calls with `isOperationAllowed`. Also add **new enforcement** for `push` (previously unguarded) and ensure `pull` is guarded (currently always allowed, now configurable).

**Files:** `src/main/events/WPESyncService.ts`, `src/main/mcp/modules/wp-cli/remote-exec.ts`, `src/main/mcp/modules/wpe/deep-refresh.ts`, `src/main/mcp/modules/wpe/wait-for-ssh.ts`, `src/main/mcp/modules/wpe/wpe-push.ts`, `src/main/mcp/modules/wpe/delete-install.ts`, `src/main/mcp/modules/wpe/delete-site.ts`, `src/main/mcp/modules/wpe/promote-environment.ts`, `src/main/mcp/modules/wpe/update-install.ts`, `src/main/mcp/modules/wpe/purge-cache.ts`, `src/main/graphql/resolvers.ts`

### Pattern to apply in every file

**Old pattern (various forms):**
```typescript
import { checkKnownEnvironmentAccess } from '../../utils/environment-filter';
// ...
const envError = checkKnownEnvironmentAccess(environment, registryStorage);
if (envError) { return { content: [{ type: 'text', text: envError }], isError: true }; }
```

**New pattern:**
```typescript
import { isOperationAllowed } from '../../utils/operation-permissions';
// ...
const settings = (services.registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
if (!isOperationAllowed('wpcli', environment, settings, installName)) {
  return {
    content: [{ type: 'text' as const, text:
      `Operation blocked: WP-CLI is not permitted on "${environment ?? 'production'}" ` +
      `environments. Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
    }],
    isError: true,
  };
}
```

**Operation mapping:**
| File | Operation |
|------|-----------|
| `WPESyncService.ts` | `'wpcli'` (twin sync uses SSH) |
| `remote-exec.ts` | `'wpcli'` |
| `deep-refresh.ts` | `'wpcli'` |
| `wait-for-ssh.ts` | `'wpcli'` |
| `wpe-push.ts` | `'push'` (NEW enforcement) |
| `delete-install.ts` | `'delete'` |
| `delete-site.ts` | `'delete'` |
| `promote-environment.ts` | `'delete'` (promoting overwrites destination) |
| `update-install.ts` | `'delete'` (modifies live config) |
| `purge-cache.ts` | `'delete'` (affects live site) |
| `resolvers.ts` (nexusWpCommand) | `'wpcli'` |

**Note for `wpe-push.ts`:** Read the file first. Find where `capiDirect` is called to trigger the push. Add the environment check before this call. The install's environment is fetched from CAPI earlier in the function — use that value. For the install name, use the same value passed to the push operation.

**Note for `WPESyncService.ts`:** The filter currently uses `isWpeEnvironmentAllowed`. Replace the entire environment filter block with the new pattern:
```typescript
const nexusSettings = (this.registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
// Apply migration if needed
const migratedPerms = migrateFromLegacyEnvFilter(nexusSettings);
const effectiveSettings = migratedPerms
  ? { ...nexusSettings, wpeOperationPermissions: migratedPerms }
  : nexusSettings;

const filteredInstalls = wpeInstalls.filter((i) =>
  isOperationAllowed('wpcli', i.environment, effectiveSettings, i.install_name)
);
```

- [ ] **Step 1: Update WPESyncService.ts**

Add imports at top:
```typescript
import { isOperationAllowed, migrateFromLegacyEnvFilter } from '../mcp/utils/operation-permissions';
```

Remove the `isWpeEnvironmentAllowed` import. Replace the environment filter block (find `nexusSettings.wpeAllowedEnvironments`) with the migration-aware pattern above.

- [ ] **Step 2: Update remote-exec.ts**

Replace the two `checkKnownEnvironmentAccess` calls (linked-site path and direct install-name path) with `isOperationAllowed('wpcli', environment, settings, installName)`. The `settings` is already read earlier in the function.

- [ ] **Step 3: Update deep-refresh.ts, wait-for-ssh.ts**

Same pattern — replace `checkWpeInstallEnvironmentAccess` with `isOperationAllowed('wpcli', environment, services.registryStorage, installName)`. Note: environment comes from the WPE install cache lookup already in these files.

- [ ] **Step 4: Add enforcement to wpe-push.ts (NEW)**

Read the file. Find where it resolves the install and environment. Add before the actual push IPC call:
```typescript
const settings = (services.registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
if (!isOperationAllowed('push', environment, settings, installName)) {
  return {
    content: [{ type: 'text' as const, text:
      `Push blocked: pushing to "${environment ?? 'production'}" environments is not permitted. ` +
      `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
    }],
    isError: true,
  };
}
```

- [ ] **Step 5: Update all CAPI delete/write tools**

For `delete-install.ts`, `delete-site.ts`, `promote-environment.ts`, `update-install.ts`, `purge-cache.ts`: replace `checkKnownEnvironmentAccess` with `isOperationAllowed('delete', environment, settings, installName)`.

- [ ] **Step 6: Update GraphQL resolvers.ts**

Find the `nexusWpCommand` resolver environment check. Replace with `isOperationAllowed('wpcli', environment, services.registryStorage, installName)`.

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Fix any TypeScript errors. Common issue: import path differences between files at different directory depths.

- [ ] **Step 8: Run tests**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL " | head -5
```

Expected: same pre-existing failures only.

- [ ] **Step 9: Commit**

```bash
git add src/main/events/WPESyncService.ts \
  src/main/mcp/modules/wp-cli/remote-exec.ts \
  src/main/mcp/modules/wpe/deep-refresh.ts \
  src/main/mcp/modules/wpe/wait-for-ssh.ts \
  src/main/mcp/modules/wpe/wpe-push.ts \
  src/main/mcp/modules/wpe/delete-install.ts \
  src/main/mcp/modules/wpe/delete-site.ts \
  src/main/mcp/modules/wpe/promote-environment.ts \
  src/main/mcp/modules/wpe/update-install.ts \
  src/main/mcp/modules/wpe/purge-cache.ts \
  src/main/graphql/resolvers.ts
git commit -m "feat(wpe-v2): update all enforcement points to isOperationAllowed

Replaces old environment-filter helpers with isOperationAllowed() across
11 files. Adds new enforcement for local_wpe_push (previously unguarded).
Migration applied in WPESyncService for legacy wpeAllowedEnvironments."
```

---

## Task 3: Preferences UI — Handler Methods

Add the new handler methods and remove the old ones from `NexusPreferences.tsx`. No render changes yet — this task is state management only.

**File:** `src/renderer/components/NexusPreferences.tsx`

- [ ] **Step 1: Remove old handlers**

Delete these methods entirely:
- `handleWpeEnvironmentToggle`
- `handleWpeAccountFilterToggle`
- `handleWpeAccountFilterSelectAll`

- [ ] **Step 2: Add new handler methods**

Add after the `handleWpeRefreshAutoEnabledToggle` method:

```typescript
// ── WPE Access Control v2 handlers ──────────────────────────────────────

handleOperationToggle = (
  operation: 'pull' | 'wpcli' | 'push' | 'delete',
  env: 'development' | 'staging' | 'production',
  value: boolean,
): void => {
  this.setState((prev) => {
    const perms = { ...(prev.settings.wpeOperationPermissions ?? {}) };
    perms[operation] = { ...DEFAULT_OPERATION_PERMISSIONS[operation], ...(perms[operation] ?? {}), [env]: value };
    const next = { ...prev.settings, wpeOperationPermissions: perms };
    this.notifyChange(next);
    return { settings: next };
  });
};

handleSiteExceptionToggle = (
  installName: string,
  environment: string,
  operation: 'pull' | 'wpcli' | 'push' | 'delete',
  value: boolean,
): void => {
  this.setState((prev) => {
    const exceptions = [...(prev.settings.wpeSiteExceptions ?? [])];
    const idx = exceptions.findIndex((e) => e.installName === installName && e.environment === environment);
    if (idx >= 0) {
      exceptions[idx] = { ...exceptions[idx], overrides: { ...exceptions[idx].overrides, [operation]: value } };
    } else {
      exceptions.push({ installName, environment, overrides: { [operation]: value } });
    }
    const next = { ...prev.settings, wpeSiteExceptions: exceptions };
    this.notifyChange(next);
    return { settings: next };
  });
};

handleSiteExceptionRemove = (installName: string, environment: string): void => {
  this.setState((prev) => {
    const exceptions = (prev.settings.wpeSiteExceptions ?? []).filter(
      (e) => !(e.installName === installName && e.environment === environment),
    );
    const next = { ...prev.settings, wpeSiteExceptions: exceptions };
    this.notifyChange(next);
    return { settings: next };
  });
};

handleAccountScopeToggle = (accountId: string, included: boolean): void => {
  this.setState((prev) => {
    const allIds = this.state.wpeAccounts.map((a) => a.id);
    const current: string[] = prev.settings.wpeAccountFilter ?? allIds;
    const updated = included
      ? [...new Set([...current, accountId])]
      : current.filter((id) => id !== accountId);
    const next = { ...prev.settings, wpeAccountFilter: updated };
    this.notifyChange(next);
    return { settings: next };
  });
};

handleAccountScopeSelectAll = (includeAll: boolean): void => {
  this.setState((prev) => {
    const next = { ...prev.settings, wpeAccountFilter: includeAll ? null : [] };
    this.notifyChange(next);
    return { settings: next };
  });
};
```

Note: `DEFAULT_OPERATION_PERMISSIONS` must be imported at the top of the file:
```typescript
import { DEFAULT_OPERATION_PERMISSIONS } from '../utils/operation-permissions';
```

Wait — `DEFAULT_OPERATION_PERMISSIONS` is in `src/main/mcp/utils/operation-permissions.ts` which is a main-process file. The renderer cannot import from `main/`. Move the constant and types to a shared location or duplicate the constant in the renderer.

**Solution:** Copy the constant inline in Preferences (YAGNI — don't over-engineer cross-process sharing):

```typescript
const WPE_OPERATION_DEFAULTS = {
  pull:   { development: true,  staging: true,  production: true  },
  wpcli:  { development: true,  staging: true,  production: false },
  push:   { development: true,  staging: true,  production: false },
  delete: { development: false, staging: false, production: false },
} as const;
```

Add this near the top of the file (after imports, before the class). Use `WPE_OPERATION_DEFAULTS` instead of `DEFAULT_OPERATION_PERMISSIONS` in the handler.

- [ ] **Step 3: Add `expandedOps` to component state**

Find the `NexusPreferencesState` interface. Add:
```typescript
expandedOps: Set<string>;
acctScopeExpanded: boolean;
```

Find the initial state in the constructor or state initializer. Add:
```typescript
expandedOps: new Set<string>(),
acctScopeExpanded: false,
```

Add a handler for expanding/collapsing operation cards:
```typescript
handleOpCardToggle = (op: string): void => {
  this.setState((prev) => {
    const expandedOps = new Set(prev.expandedOps);
    if (expandedOps.has(op)) { expandedOps.delete(op); } else { expandedOps.add(op); }
    return { expandedOps };
  });
};
```

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "feat(wpe-v2): Preferences handler methods for unified access control

Adds handleOperationToggle, handleSiteExceptionToggle/Remove, and
handleAccountScope* handlers. Removes old handleWpeAccountFilterToggle,
handleWpeAccountFilterSelectAll, handleWpeEnvironmentToggle. Adds
expandedOps and acctScopeExpanded to component state."
```

---

## Task 4: Preferences UI — Render Methods

Replace `renderWpeEnvironmentFilterSection` and `renderWpeAccountFilterSection` with a single `renderWpeAccessControlSection` that implements the approved three-gate mockup.

**File:** `src/renderer/components/NexusPreferences.tsx`

The UI uses `React.createElement()` throughout — no JSX. Follow existing patterns exactly.

- [ ] **Step 1: Remove old render methods**

Delete `renderWpeAccountFilterSection()` and `renderWpeEnvironmentFilterSection()` entirely.

- [ ] **Step 2: Add `renderWpeAccessControlSection()`**

Add the new method. This is the largest code block — implement it completely:

```typescript
renderWpeAccessControlSection(): React.ReactNode {
  const { settings, wpeAccounts, expandedOps, acctScopeExpanded } = this.state;
  const perms = settings.wpeOperationPermissions ?? {};
  const exceptions = settings.wpeSiteExceptions ?? [];
  const accountFilter = settings.wpeAccountFilter;
  const allAccountIds = wpeAccounts.map((a) => a.id);
  const includedIds: string[] = accountFilter ?? allAccountIds;
  const allIncluded = !accountFilter || includedIds.length === allAccountIds.length;

  // Helper: effective value for an operation+env (user setting or default)
  const getPermVal = (op: keyof typeof WPE_OPERATION_DEFAULTS, env: 'development' | 'staging' | 'production'): boolean => {
    const custom = (perms as any)[op]?.[env];
    return custom !== undefined ? custom : WPE_OPERATION_DEFAULTS[op][env];
  };

  // Helper: env badge element
  const envBadge = (label: string, on: boolean, color: string): React.ReactNode =>
    React.createElement('span', {
      style: {
        fontSize: '10px', fontFamily: 'monospace',
        padding: '2px 7px', borderRadius: '10px', fontWeight: 500,
        background: on ? `rgba(${color},0.12)` : 'rgba(139,148,158,0.08)',
        color: on ? `rgb(${color})` : 'var(--nxai-status-neutral, #9ca3af)',
      },
    }, `${label} ${on ? '✓' : '✗'}`);

  // Operation definitions
  const OPERATIONS = [
    { id: 'pull',   label: 'Pull to local',    sub: 'Download files + database from WPE',      icon: '⬇', color: '59,130,246' },
    { id: 'wpcli',  label: 'WP-CLI over SSH',  sub: 'Run commands on remote WPE installs',      icon: '⌘', color: '167,139,250' },
    { id: 'push',   label: 'Push to WPE',      sub: 'Overwrite remote with local files and DB', icon: '⬆', color: '251,191,36' },
    { id: 'delete', label: 'Delete / Promote', sub: 'Irreversible CAPI operations',              icon: '🗑', color: '248,113,113' },
  ] as const;

  // Render one operation card
  const renderOpCard = (op: typeof OPERATIONS[number]): React.ReactNode => {
    const expanded = expandedOps.has(op.id);
    const devOn = getPermVal(op.id, 'development');
    const stgOn = getPermVal(op.id, 'staging');
    const prdOn = getPermVal(op.id, 'production');
    const opExceptions = exceptions.filter((e) => op.id in e.overrides);
    const excCount = opExceptions.length;

    return React.createElement('div', {
      key: op.id,
      style: {
        background: 'var(--nxai-card-bg, #21262d)',
        border: `1px solid ${expanded ? 'rgba(59,130,246,0.45)' : 'var(--nxai-card-border, #30363d)'}`,
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '8px',
        cursor: 'pointer',
      },
      onClick: () => this.handleOpCardToggle(op.id),
    },
      // Header
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '14px', padding: '13px 16px' },
      },
        React.createElement('div', {
          style: {
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
            background: `rgba(${op.color},0.12)`, color: `rgb(${op.color})`,
          },
        }, op.icon),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, op.label),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, op.sub),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
          envBadge('Dev', devOn, '81,187,123'),
          envBadge('Stg', stgOn, '251,191,36'),
          envBadge('Prd', prdOn, prdOn ? '81,187,123' : '248,113,113'),
          excCount > 0 ? React.createElement('span', {
            style: {
              fontSize: 10, fontFamily: 'monospace', padding: '2px 8px',
              background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
              color: '#3b82f6', borderRadius: 3,
            },
          }, `${excCount} exception${excCount !== 1 ? 's' : ''}`) : null,
          React.createElement('span', {
            style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none' },
          }, '▶'),
        ),
      ),
      // Expanded body
      expanded ? React.createElement('div', {
        style: {
          borderTop: '1px solid var(--nxai-card-border, #30363d)',
          padding: '16px',
          background: 'rgba(255,255,255,0.01)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        // Left: env toggles
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 } }, 'Default by environment'),
          ...(['development', 'staging', 'production'] as const).map((env) => {
            const envColor = env === 'development' ? '#51BB7B' : env === 'staging' ? '#fbbf24' : '#f87171';
            const val = getPermVal(op.id, env);
            return React.createElement('div', {
              key: env,
              style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, marginBottom: 6 },
            },
              React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: envColor, flexShrink: 0 } }),
              React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' as const } }, env),
              React.createElement('label', { style: { position: 'relative' as const, width: 34, height: 19, flexShrink: 0, cursor: 'pointer' }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
                React.createElement('input', {
                  type: 'checkbox', checked: val, style: { display: 'none' },
                  onChange: (e: any) => this.handleOperationToggle(op.id, env, e.target.checked),
                }),
                React.createElement('div', { style: { position: 'absolute' as const, inset: 0, background: val ? '#51BB7B' : 'var(--nxai-card-border, #30363d)', borderRadius: 10, transition: 'background 0.2s' } }),
                React.createElement('div', { style: { position: 'absolute' as const, top: 2, left: val ? 17 : 2, width: 15, height: 15, background: val ? '#fff' : 'var(--nxai-status-neutral, #9ca3af)', borderRadius: '50%', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' } }),
              ),
            );
          }),
        ),
        // Right: site exceptions
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 10 } }, 'Site exceptions'),
          opExceptions.length === 0
            ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-status-neutral, #9ca3af)', fontStyle: 'italic' as const, marginBottom: 8 } }, 'No exceptions — all sites follow global')
            : opExceptions.map((exc) =>
                React.createElement('div', {
                  key: `${exc.installName}-${exc.environment}`,
                  style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, marginBottom: 6, fontSize: 12 },
                },
                  React.createElement('span', { style: { flex: 1, fontWeight: 500 } }, exc.installName),
                  React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, exc.environment),
                  React.createElement('span', {
                    style: { fontSize: 10, fontFamily: 'monospace', color: exc.overrides[op.id] ? '#51BB7B' : '#f87171' },
                  }, exc.overrides[op.id] ? 'allow ↑' : 'block ↓'),
                  React.createElement('span', {
                    style: { color: 'var(--nxai-status-neutral, #9ca3af)', cursor: 'pointer', marginLeft: 4, fontSize: 12 },
                    onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleSiteExceptionRemove(exc.installName, exc.environment); },
                  }, '✕'),
                ),
              ),
          React.createElement('button', {
            style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'none', border: '1px dashed var(--nxai-card-border, #30363d)', borderRadius: 6, fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', cursor: 'pointer', width: '100%', fontFamily: 'inherit' },
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
            title: 'Site exception editor coming in a future release',
          }, '＋ Add site exception'),
        ),
      ) : null,
    );
  };

  // Gate 1: Account scope card
  const acctCard = wpeAccounts.length > 0 ? React.createElement('div', {
    style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
  },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' },
      onClick: () => this.setState((prev) => ({ acctScopeExpanded: !prev.acctScopeExpanded })),
    },
      React.createElement('div', { style: { width: 32, height: 32, borderRadius: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 } }, '🏢'),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Included Accounts'),
        React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, 'These accounts are visible in Nexus and included in all operations'),
      ),
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 260 } },
        ...wpeAccounts.slice(0, 5).map((a) => {
          const on = allIncluded || includedIds.includes(a.id);
          return React.createElement('span', {
            key: a.id,
            style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500, background: on ? 'rgba(81,187,123,0.12)' : 'rgba(139,148,158,0.08)', color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', border: on ? '1px solid rgba(81,187,123,0.3)' : '1px solid var(--nxai-card-border, #30363d)', cursor: 'pointer' },
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleAccountScopeToggle(a.id, !on); },
          }, a.name ?? a.id);
        }),
        wpeAccounts.length > 5 ? React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', padding: '2px 4px' } }, `+${wpeAccounts.length - 5}`) : null,
      ),
      React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, marginLeft: 8, flexShrink: 0 } }, acctScopeExpanded ? '▼' : '▶'),
    ),
    acctScopeExpanded ? React.createElement('div', {
      style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', padding: '14px 16px', background: 'rgba(255,255,255,0.01)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
    },
      ...wpeAccounts.map((a) => {
        const on = allIncluded || includedIds.includes(a.id);
        return React.createElement('div', {
          key: a.id,
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: on ? 'var(--nxai-code-bg, #1f1f1f)' : 'rgba(255,255,255,0.01)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, cursor: 'pointer', opacity: on ? 1 : 0.45, fontSize: 12 },
          onClick: () => this.handleAccountScopeToggle(a.id, !on),
        },
          React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', flexShrink: 0 } }),
          React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, a.name ?? a.id),
          React.createElement('span', { style: { color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', fontSize: 11, flexShrink: 0 } }, on ? '✓' : '✗'),
        );
      }),
    ) : null,
  ) : null;

  // Full section
  return React.createElement('div', { style: sectionStyle },
    React.createElement('div', { style: labelStyle }, 'WP Engine Access'),
    React.createElement('div', { style: descStyle }, 'Control which accounts and operations Nexus can use across your WP Engine environments.'),
    React.createElement('div', { style: { marginTop: 12 } },
      // Gate 1
      acctCard,
      // Gate 1→2 connector
      wpeAccounts.length > 0 ? React.createElement('div', { style: { height: 14, borderLeft: '1px solid var(--nxai-card-border, #30363d)', marginLeft: 10, marginBottom: 2 } }) : null,
      // Gate label
      React.createElement('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('span', null, 'Operation Permissions'),
        React.createElement('span', { style: { flex: 1, height: 1, background: 'var(--nxai-card-border, #30363d)' } }),
      ),
      // Operation cards
      ...OPERATIONS.map(renderOpCard),
      // Footer
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'rgba(81,187,123,0.05)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 6, fontSize: 12, color: 'rgba(81,187,123,0.8)', marginTop: 8, lineHeight: '1.5' },
      },
        React.createElement('span', null, '📖'),
        React.createElement('span', null, React.createElement('strong', null, 'Read metadata'), ' (installs, domains, SSL, usage) is always permitted and cannot be disabled.'),
      ),
    ),
  );
}
```

- [ ] **Step 3: Wire up in `render()`**

Find where the old sections are called in `render()` (around lines 976 and 1082). Replace both:
```typescript
// Remove these two lines:
this.renderWpeEnvironmentFilterSection(),
// ...
this.renderWpeAccountFilterSection(),

// Replace with one call (in the position where renderWpeEnvironmentFilterSection was):
this.renderWpeAccessControlSection(),
```

The `divider` between where the two old calls were should also be removed.

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Fix TypeScript errors. Common ones:
- `acctScopeExpanded` missing from state type — add to interface
- `WPE_OPERATION_DEFAULTS` not found — ensure the `const` is defined at file scope

- [ ] **Step 5: Verify in Local**

After `npm run rebuild` and Local restart:
1. Open Preferences → WP Engine
2. Should see: account chip row (Gate 1) + four operation cards (Gate 2+3)
3. Expand WP-CLI card — env toggles on left, empty exceptions on right
4. Toggle production off/on — verify setting persists after closing Preferences

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "feat(wpe-v2): unified WPE access control UI in Preferences

Replaces renderWpeEnvironmentFilterSection + renderWpeAccountFilterSection
with single renderWpeAccessControlSection implementing the approved
three-gate mockup: account scope (Gate 1) + operation cards (Gate 2+3).
Read metadata footer. Site exceptions removable, add placeholder for
future editor flow."
```

---

## Task 5: Tests + Docs

- [ ] **Step 1: Run full test suite**

```bash
npm install && npm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL " | head -8
```

Expected: 2001+ passing, same pre-existing failures.

- [ ] **Step 2: Update `docs-site/docs/reference/wpe-access-control.md`**

Replace the current content with a revised version that reflects the new three-gate model. Key changes:
- Gate 1: Account scope section
- Gate 2: Per-operation defaults table  
- Gate 3: Site exceptions
- Remove the old "environment checkboxes" framing
- Update the "Blocked on excluded environments" list to reflect new operation categories

The new "What the filter controls" table:

```markdown
## Operation Defaults (Gate 2)

| Operation | Dev default | Staging default | Production default |
|-----------|-------------|-----------------|-------------------|
| Read metadata | ✅ Always | ✅ Always | ✅ Always |
| Pull to local | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| WP-CLI over SSH | ✅ Allowed | ✅ Allowed | ❌ Blocked |
| Push to WPE | ✅ Allowed | ✅ Allowed | ❌ Blocked |
| Delete / Promote | ❌ Blocked | ❌ Blocked | ❌ Blocked |

All defaults are configurable per-environment in Preferences → WP Engine → WP Engine Access.
```

- [ ] **Step 3: Final commit**

```bash
git add docs-site/docs/reference/wpe-access-control.md
git commit -m "docs(wpe-v2): update access control reference for three-gate model"
```

---

## Self-Review

**Spec coverage:**
- ✅ `WpeOperationPermissions` + `WpeSiteException` types — Task 1
- ✅ `isOperationAllowed()` with site exception resolution — Task 1
- ✅ Migration from `wpeAllowedEnvironments` — Task 1
- ✅ 13 unit tests — Task 1
- ✅ All existing enforcement points updated — Task 2
- ✅ `local_wpe_push` enforcement added (new) — Task 2
- ✅ Handler methods — Task 3
- ✅ Unified UI replaces both old sections — Task 4
- ✅ Account scope (Gate 1) with chip row + expanded grid — Task 4
- ✅ Operation cards (Gate 2+3) with env toggles + exceptions — Task 4
- ✅ Read metadata footer — Task 4
- ✅ Docs updated — Task 5

**Placeholder scan:** Task 4 "Add site exception" button has `title: 'Site exception editor coming in a future release'` — this is intentional scope reduction, not a placeholder. The button exists (matching the mockup) but the add-exception flow is deferred. Noted explicitly.

**Type consistency:** `isOperationAllowed(operation: Operation, ...)` where `Operation = keyof typeof DEFAULT_OPERATION_PERMISSIONS` — used consistently in Tasks 1, 2, and 3's `handleOperationToggle`. `WpeSiteException.installName` matches the lookup in `isOperationAllowed`. `WpeEnvFlags` is `development | staging | production` everywhere.

**One implementation note for Task 4:** The `acctScopeExpanded` field must be added to `NexusPreferencesState`. Search the state interface (around line 40 of the file) and add it alongside `expandedOps: Set<string>`.
