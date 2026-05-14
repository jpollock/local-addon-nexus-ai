# WPE Environment Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `wpeAllowedEnvironments` setting that controls which WPE environment types (production / staging / development) Nexus can access, defaulting to staging + development only (production excluded).

**Architecture:** A single `isWpeEnvironmentAllowed()` helper reads `NexusSettings.wpeAllowedEnvironments` (default `['staging', 'development']`) and is applied at two enforcement points: `WPESyncService` (content indexing / twin sync) and `resolveTarget` in remote-exec (WP-CLI over SSH). The Preferences UI exposes three checkboxes with a production warning. Production access is opt-in.

**Tech Stack:** TypeScript, React (class-based, no JSX), better-sqlite3, existing IPC/settings pattern

**Branch:** `feature/wpe-environment-filter`

---

## File Map

**New:**
- `src/main/mcp/utils/environment-filter.ts` — `isWpeEnvironmentAllowed()` helper + `DEFAULT_WPE_ALLOWED_ENVIRONMENTS`
- `tests/unit/mcp/environment-filter.test.ts` — unit tests for the helper

**Modified:**
- `src/common/types.ts` — add `wpeAllowedEnvironments` field to `NexusSettings`
- `src/main/events/WPESyncService.ts` — filter installs by environment after account filter
- `src/main/mcp/modules/wp-cli/remote-exec.ts` — block remote WP-CLI on disallowed environments
- `src/renderer/components/NexusPreferences.tsx` — add environment filter section UI
- `docs-site/docs/features/smart-search/getting-started.md` — note that production is excluded by default (minor — environment filter isn't Smart Search specific but is relevant context)

---

## Task 1: Setting Type + Helper + Unit Tests

**Files:**
- Modify: `src/common/types.ts`
- Create: `src/main/mcp/utils/environment-filter.ts`
- Create: `tests/unit/mcp/environment-filter.test.ts`

- [ ] **Step 1: Add `wpeAllowedEnvironments` to `NexusSettings` in `src/common/types.ts`**

Find the `NexusSettings` interface (around line 250) and add after `wpeAccountFilter`:

```typescript
/** WPE environment types Nexus is allowed to access. Default: staging + development only.
 *  Set to include 'production' to enable production access. */
wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[];
```

- [ ] **Step 2: Write the failing tests** (`tests/unit/mcp/environment-filter.test.ts`)

```typescript
import { isWpeEnvironmentAllowed, DEFAULT_WPE_ALLOWED_ENVIRONMENTS } from '../../../src/main/mcp/utils/environment-filter';

describe('DEFAULT_WPE_ALLOWED_ENVIRONMENTS', () => {
  it('excludes production', () => {
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).not.toContain('production');
  });

  it('includes staging and development', () => {
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).toContain('staging');
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).toContain('development');
  });
});

describe('isWpeEnvironmentAllowed', () => {
  it('allows staging when using default (no setting)', () => {
    expect(isWpeEnvironmentAllowed('staging', {})).toBe(true);
  });

  it('allows development when using default', () => {
    expect(isWpeEnvironmentAllowed('development', {})).toBe(true);
  });

  it('blocks production when using default', () => {
    expect(isWpeEnvironmentAllowed('production', {})).toBe(false);
  });

  it('blocks undefined environment (defaults to production)', () => {
    expect(isWpeEnvironmentAllowed(undefined, {})).toBe(false);
  });

  it('allows production when explicitly enabled', () => {
    expect(isWpeEnvironmentAllowed('production', {
      wpeAllowedEnvironments: ['production', 'staging', 'development'],
    })).toBe(true);
  });

  it('blocks staging when only production is allowed', () => {
    expect(isWpeEnvironmentAllowed('staging', {
      wpeAllowedEnvironments: ['production'],
    })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isWpeEnvironmentAllowed('Production', {})).toBe(false);
    expect(isWpeEnvironmentAllowed('Staging', {})).toBe(true);
  });

  it('blocks when wpeAllowedEnvironments is empty array', () => {
    expect(isWpeEnvironmentAllowed('staging', { wpeAllowedEnvironments: [] })).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern="environment-filter" --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../../../src/main/mcp/utils/environment-filter'`

- [ ] **Step 4: Implement the helper** (`src/main/mcp/utils/environment-filter.ts`)

```typescript
import type { NexusSettings } from '../../../common/types';

export const DEFAULT_WPE_ALLOWED_ENVIRONMENTS: ReadonlyArray<'staging' | 'development'> = [
  'staging',
  'development',
];

/**
 * Returns true if the WPE install environment is permitted by the user's settings.
 *
 * Default (no setting): staging + development only. Production is opt-in.
 * Treats undefined/unknown environments as 'production' (safe default).
 */
export function isWpeEnvironmentAllowed(
  environment: string | undefined,
  settings: Pick<NexusSettings, 'wpeAllowedEnvironments'>,
): boolean {
  const allowed: readonly string[] =
    settings.wpeAllowedEnvironments ?? DEFAULT_WPE_ALLOWED_ENVIRONMENTS;
  const env = (environment ?? 'production').toLowerCase();
  return allowed.map((e) => e.toLowerCase()).includes(env);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest --testPathPattern="environment-filter" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 8 passed`

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts src/main/mcp/utils/environment-filter.ts tests/unit/mcp/environment-filter.test.ts
git commit -m "feat(wpe-env-filter): setting type + isWpeEnvironmentAllowed helper

Adds wpeAllowedEnvironments to NexusSettings. Default: ['staging', 'development'].
Production is excluded by default — opt-in by adding 'production' to the list.
Undefined/unknown environments treated as 'production' (safe default)."
```

---

## Task 2: Apply Filter in WPESyncService

`WPESyncService` is where WPE installs are synced — content indexed, twin metadata refreshed. Filtering here prevents production content from entering the local vector store or graph DB.

**File:** `src/main/events/WPESyncService.ts`

- [ ] **Step 1: Add the import at the top of WPESyncService.ts**

```typescript
import { isWpeEnvironmentAllowed } from '../mcp/utils/environment-filter';
import type { NexusSettings } from '../../common/types';
```

(Check if `NexusSettings` is already imported; if so, skip that import.)

- [ ] **Step 2: Apply environment filter after account filter**

Find the section in the `sync()` method (around line 141–155) where `wpeInstalls` is built from raw `installs`. It currently looks like:

```typescript
// Map to WPEInstallData
const wpeInstalls: WPEInstallData[] = installs.map((i: any) => ({
  install_id: i.id,
  install_name: i.name,
  environment: i.environment ?? 'production',
  ...
}));
```

After this block, add the environment filter (insert BEFORE the staleness filter):

```typescript
// Apply environment filter — block production by default
const nexusSettings = (this.registryStorage.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
const beforeEnvFilter = wpeInstalls.length;
const envFilteredInstalls = wpeInstalls.filter((i) =>
  isWpeEnvironmentAllowed(i.environment, nexusSettings)
);
if (envFilteredInstalls.length < beforeEnvFilter) {
  this.logger.info(
    `[WPESyncService] Environment filter: ${envFilteredInstalls.length} of ${beforeEnvFilter} installs in scope ` +
    `(allowed: ${(nexusSettings.wpeAllowedEnvironments ?? ['staging', 'development']).join(', ')})`
  );
}
const wpeInstallsFiltered = envFilteredInstalls;
```

Then replace the next reference to `wpeInstalls` in the staleness filter with `wpeInstallsFiltered`:

```typescript
// Filter to stale installs only
const staleInstalls = wpeInstallsFiltered.filter((i) => {
  const last = lastSyncMap.get(i.install_id);
  return !last || (now - last) > thresholdMs;
});
result.skipped = wpeInstallsFiltered.length - staleInstalls.length;

this.logger.info(
  `[WPESyncService] ${staleInstalls.length} stale, ${result.skipped} fresh (skipping) out of ${wpeInstallsFiltered.length} total`
);
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/events/WPESyncService.ts
git commit -m "feat(wpe-env-filter): skip disallowed environments in WPESyncService

Production installs are filtered out before staleness check. The filter
uses wpeAllowedEnvironments from settings (default: staging + development).
Logs how many installs were excluded and which environments are in scope."
```

---

## Task 3: Apply Filter in Remote WP-CLI Execution

`resolveTarget` in `remote-exec.ts` is the single gateway for all remote WP-CLI commands over SSH. Blocking here prevents any WP-CLI command from running against production installs, regardless of the MCP tool used.

**File:** `src/main/mcp/modules/wp-cli/remote-exec.ts`

- [ ] **Step 1: Add imports at top of remote-exec.ts**

```typescript
import { isWpeEnvironmentAllowed } from '../../utils/environment-filter';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';
```

- [ ] **Step 2: Add environment check in `resolveTarget` after the remote target is resolved**

The function `resolveTarget` returns a `RemoteTarget` when an install_name is resolved. The `installInfo` object has `environment?: string`. Add a check just before the `return { type: 'remote', ... }` statements.

Find the section that builds the remote target for a linked local site (around line 100–115):

```typescript
const installInfo = await services.localServices.resolveWpeInstall(site.id);
if (installInfo) {
  return { type: 'remote', installName: installInfo.installName, installInfo };
}
```

Replace with:

```typescript
const installInfo = await services.localServices.resolveWpeInstall(site.id);
if (installInfo) {
  const settings = (services.settingsStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
  if (!isWpeEnvironmentAllowed(installInfo.environment, settings)) {
    return error(
      `Remote WP-CLI is not allowed on "${installInfo.environment ?? 'production'}" environments. ` +
      `Enable production access in Nexus Preferences → WP Engine Environment Access, ` +
      `or target a staging/development install instead.`
    );
  }
  return { type: 'remote', installName: installInfo.installName, installInfo };
}
```

Also find the direct install_name path (around line 120–130):

```typescript
// Not a local site — treat install_name as a direct WPE install name
return {
  type: 'remote',
  installName,
  installInfo: {
    installName,
    installId: '',
    remoteSiteId: '',
    primaryDomain: `${installName}.wpengine.com`,
  },
};
```

Replace with (look up environment from WPE install cache, default to 'production' if unknown):

```typescript
// Not a local site — treat install_name as a direct WPE install name.
// Look up environment from cache; default to 'production' if not found (safe default).
let knownEnvironment: string | undefined;
try {
  const cache = services.settingsStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as
    { installs?: Array<{ install_name: string; environment?: string }> } | null;
  const cached = cache?.installs?.find((i) => i.install_name === installName);
  knownEnvironment = cached?.environment;
} catch { /* cache unavailable */ }

const settings = (services.settingsStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
if (!isWpeEnvironmentAllowed(knownEnvironment, settings)) {
  return error(
    `Remote WP-CLI is not allowed on "${knownEnvironment ?? 'production'}" environments. ` +
    `Enable production access in Nexus Preferences → WP Engine Environment Access, ` +
    `or target a staging/development install instead.`
  );
}

return {
  type: 'remote',
  installName,
  installInfo: {
    installName,
    installId: '',
    remoteSiteId: '',
    primaryDomain: `${installName}.wpengine.com`,
    environment: knownEnvironment,
  },
};
```

- [ ] **Step 3: Check that `NexusServices` has `settingsStorage`**

```bash
grep -n "settingsStorage" /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/src/main/mcp/types.ts | head -5
```

If `NexusServices` doesn't have `settingsStorage`, find where services are constructed and check how to access settings from within a tool. The `resolvers.ts` file has access to `settingsStorage` — check the pattern there and adapt accordingly.

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors. If `settingsStorage` isn't on `NexusServices`, the build will fail — see the note in Step 3 above and adapt.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wp-cli/remote-exec.ts
git commit -m "feat(wpe-env-filter): block remote WP-CLI on disallowed environments

resolveTarget now checks the install's environment against wpeAllowedEnvironments.
Production installs are blocked by default with a clear error message pointing
users to Preferences. Cache lookup provides environment for direct install names;
defaults to 'production' when unknown (safe default)."
```

---

## Task 4: Add UI in NexusPreferences

**File:** `src/renderer/components/NexusPreferences.tsx`

The UI pattern follows `renderWpeAccountFilterSection()` — three labelled checkboxes for development, staging, production. Production has a warning label and is unchecked by default.

- [ ] **Step 1: Add handler methods**

Find the `handleWpeAccountFilterToggle` and `handleWpeAccountFilterSelectAll` methods. Add these methods after them:

```typescript
handleWpeEnvironmentToggle = (env: 'production' | 'staging' | 'development', checked: boolean): void => {
  this.setState((prev) => {
    const current: Array<'production' | 'staging' | 'development'> =
      prev.settings.wpeAllowedEnvironments
        ? [...prev.settings.wpeAllowedEnvironments]
        : ['staging', 'development'];
    const updated = checked
      ? [...new Set([...current, env])]
      : current.filter((e) => e !== env);
    const next = { ...prev.settings, wpeAllowedEnvironments: updated };
    this.notifyChange(next);
    return { settings: next };
  });
};
```

- [ ] **Step 2: Add `renderWpeEnvironmentFilterSection` method**

Add this method after `renderWpeAccountFilterSection`:

```typescript
renderWpeEnvironmentFilterSection(): React.ReactNode {
  const { settings } = this.state;
  const allowed: Array<'production' | 'staging' | 'development'> =
    settings.wpeAllowedEnvironments ?? ['staging', 'development'];

  const environments: Array<{
    id: 'production' | 'staging' | 'development';
    label: string;
    warning?: string;
  }> = [
    { id: 'development', label: 'Development' },
    { id: 'staging', label: 'Staging' },
    {
      id: 'production',
      label: 'Production',
      warning: 'Enables WP-CLI commands and content indexing on production sites',
    },
  ];

  return React.createElement('div', { style: sectionStyle },
    React.createElement('div', { style: labelStyle }, 'WP Engine Environment Access'),
    React.createElement('div', { style: descStyle },
      'Choose which WP Engine environment types Nexus can access for WP-CLI commands and content indexing. ' +
      'Production is excluded by default to prevent accidental changes.',
    ),
    React.createElement('div', { style: { marginTop: '8px' } },
      ...environments.map(({ id, label, warning }) => {
        const isChecked = allowed.includes(id);
        return React.createElement('div', { key: id, style: { marginBottom: '6px' } },
          React.createElement('label', { style: checkboxRowStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: isChecked,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                this.handleWpeEnvironmentToggle(id, e.target.checked),
              style: { width: '16px', height: '16px', cursor: 'pointer' },
            }),
            React.createElement('span', { style: { fontSize: '13px', fontWeight: id === 'production' ? 600 : 400 } }, label),
          ),
          warning && isChecked
            ? React.createElement('div', {
                style: {
                  marginLeft: '28px',
                  marginTop: '2px',
                  fontSize: '11px',
                  color: '#f59e0b',
                },
              }, `⚠ ${warning}`)
            : null,
        );
      }),
    ),
  );
}
```

- [ ] **Step 3: Call `renderWpeEnvironmentFilterSection` in the `render` method**

Find where `renderWpeAccountFilterSection()` is called in the `render()` method. Add `renderWpeEnvironmentFilterSection()` immediately after it:

```typescript
this.renderWpeAccountFilterSection(),
this.renderWpeEnvironmentFilterSection(),
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 5: Verify in Local**

After `npm run rebuild` and Local restart, open Nexus Preferences. You should see a "WP Engine Environment Access" section with:
- ☑ Development
- ☑ Staging
- ☐ Production (unchecked, with no warning shown)

Toggle Production on — the amber warning text should appear below it.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "feat(wpe-env-filter): add environment access section to Preferences UI

Three checkboxes: Development (✓), Staging (✓), Production (✗ default).
Production shows an amber warning when enabled explaining what it unlocks.
Follows the existing account filter UI pattern in NexusPreferences."
```

---

## Task 5: Tests for WPESyncService + remote-exec Filter

Add unit tests to verify the filter is applied correctly at both enforcement points.

**Files:**
- Modify: `tests/unit/mcp/environment-filter.test.ts` (already created in Task 1)
- Create: `tests/unit/wpe-sync/environment-filter-integration.test.ts`

- [ ] **Step 1: Write WPESyncService environment filter test**

Create `tests/unit/wpe-sync/environment-filter-integration.test.ts`:

```typescript
import { isWpeEnvironmentAllowed } from '../../../src/main/mcp/utils/environment-filter';

/**
 * Verifies the environment filter logic that WPESyncService applies.
 * The actual WPESyncService is integration-tested elsewhere; this tests
 * the filter helper with realistic install data shapes.
 */
describe('WPESyncService environment filter (via isWpeEnvironmentAllowed)', () => {
  const makeInstall = (env: string) => ({ install_name: `test-${env}`, environment: env });

  describe('default settings (production excluded)', () => {
    const settings = {};

    it('includes staging installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('staging').environment, settings)).toBe(true);
    });

    it('includes development installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('development').environment, settings)).toBe(true);
    });

    it('excludes production installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('production').environment, settings)).toBe(false);
    });

    it('simulates filtering an install list', () => {
      const installs = [
        makeInstall('production'),
        makeInstall('staging'),
        makeInstall('development'),
        makeInstall('production'),
      ];
      const filtered = installs.filter((i) => isWpeEnvironmentAllowed(i.environment, settings));
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i) => i.environment !== 'production')).toBe(true);
    });
  });

  describe('production enabled', () => {
    const settings = { wpeAllowedEnvironments: ['production', 'staging', 'development'] as const };

    it('includes all environment types', () => {
      const installs = [
        makeInstall('production'),
        makeInstall('staging'),
        makeInstall('development'),
      ];
      const filtered = installs.filter((i) => isWpeEnvironmentAllowed(i.environment, settings));
      expect(filtered).toHaveLength(3);
    });
  });

  describe('staging only', () => {
    const settings = { wpeAllowedEnvironments: ['staging'] as const };

    it('includes only staging', () => {
      expect(isWpeEnvironmentAllowed('staging', settings)).toBe(true);
      expect(isWpeEnvironmentAllowed('development', settings)).toBe(false);
      expect(isWpeEnvironmentAllowed('production', settings)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run all environment-related tests**

```bash
npx jest --testPathPattern="environment-filter" --no-coverage 2>&1 | tail -15
```

Expected: all tests pass (8 from Task 1 + new integration-style tests).

- [ ] **Step 3: Run full test suite for regressions**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL " | head -10
```

Expected: same pre-existing failures as before (`wpe-tier3`, `resolvers-search`), all new tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/wpe-sync/environment-filter-integration.test.ts
git commit -m "test(wpe-env-filter): WPESyncService filter scenarios + edge cases

Tests realistic install list filtering: default excludes production,
all-enabled includes everything, single-environment allowlist. Verifies
that undefined environments are treated as production (safe default)."
```

---

## Task 6: Docs Update

- [ ] **Step 1: Add a note to the docs site getting-started guide**

In `docs-site/docs/getting-started/index.md` or whichever file covers initial setup, add a note about the production default. Check what file covers this:

```bash
head -5 /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/docs-site/docs/getting-started/index.md
```

- [ ] **Step 2: Update `docs-site/docs/features/smart-search/getting-started.md`**

The WPE push section is already there. Add a note about environment access above the sync step:

Find the "Step 2: Start the Site" section and add before it:

```markdown
!!! info "Production Access"
    By default, Nexus only accesses **staging and development** WP Engine environments.
    Production is excluded to prevent accidental indexing or commands on live sites.
    To enable production access, go to **Nexus Preferences → WP Engine Environment Access**.
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | grep "error TS" | head -5
npm test 2>&1 | grep -E "^Tests:|FAIL " | head -5
```

- [ ] **Step 4: Final commit**

```bash
git add docs-site/
git commit -m "docs(wpe-env-filter): note production exclusion default in getting started

Adds admonition to Smart Search getting started and docs site noting that
production WPE environments are excluded by default, with pointer to
Preferences to opt in."
```

---

## Self-Review

**Spec coverage:**
- ✅ `wpeAllowedEnvironments` setting in `NexusSettings` — Task 1
- ✅ Default excludes production — Task 1 (helper + constant)
- ✅ WPESyncService filters by environment — Task 2
- ✅ Remote WP-CLI blocked on disallowed environments — Task 3
- ✅ Preferences UI with three checkboxes — Task 4
- ✅ Production shows warning when enabled — Task 4
- ✅ Unit tests for helper — Task 1
- ✅ Filter scenario tests — Task 5
- ✅ Docs — Task 6

**Placeholder scan:** No TBDs. Task 3 Step 3 has a conditional note about `settingsStorage` availability — the implementer must verify this at build time, not defer it.

**Type consistency:**
- `isWpeEnvironmentAllowed(environment: string | undefined, settings: Pick<NexusSettings, 'wpeAllowedEnvironments'>): boolean` — used consistently in Tasks 2, 3, 5
- `wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[]` — defined in Task 1, consumed in Tasks 2, 3, 4
- `DEFAULT_WPE_ALLOWED_ENVIRONMENTS` — defined in Task 1 `environment-filter.ts`, referenced in Task 4 UI default

**One implementation note for Task 3:** `NexusServices` may not expose `settingsStorage` directly. If the build fails, check `src/main/mcp/types.ts` for the `NexusServices` interface. The `registryStorage` or `settingsStorage` field name may differ — search for how other tools access settings from within the `services` object and use the same pattern.
