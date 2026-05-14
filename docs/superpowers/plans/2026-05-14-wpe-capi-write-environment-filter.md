# WPE CAPI Write Environment Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the `wpeAllowedEnvironments` setting to CAPI write operations on production WPE installs — blocking destructive tools (delete-install, delete-site, promote-environment) and action tools (update-install, purge-cache) when production is excluded.

**Architecture:** A new `checkKnownEnvironmentAccess(environment, settings)` helper is added to the existing `environment-filter.ts` utility. Each write tool calls it immediately after learning the install's environment (either from a CAPI fetch already in the tool, or from a cache lookup by install_id). Read-only CAPI operations are intentionally not affected. The existing `wpeAllowedEnvironments` setting and Preferences UI require no changes.

**Tech Stack:** TypeScript, existing `isWpeEnvironmentAllowed()` helper, STORAGE_KEYS.WPE_INSTALL_CACHE

**Branch:** `feature/wpe-environment-filter` (already exists — continue on this branch)

---

## Scope

**Tools covered (write operations that affect live installs):**

| Tool | Risk | Environment source |
|------|------|--------------------|
| `wpe_promote_environment` | Critical — overwrites destination | CAPI fetch of destination install |
| `wpe_delete_install` | Critical — permanent deletion | CAPI fetch already in tool |
| `wpe_delete_site` | Critical — permanent deletion | Cache lookup by site's installs |
| `wpe_update_install` | High — modifies live config | Cache lookup by install_id |
| `wpe_purge_cache` | Medium — affects live site | Cache lookup by install_id |

**Tools intentionally NOT covered:**
- All `wpe_get_*` tools (read-only CAPI — always allowed)
- `wpe_create_backup` (protective operation — always allowed)
- `wpe_create_install`, `wpe_create_domain`, `wpe_create_site` (creates new resources — environment unknown at creation time)

---

## File Map

**Modified:**
- `src/main/mcp/utils/environment-filter.ts` — add `checkKnownEnvironmentAccess()`
- `src/main/mcp/modules/wpe/promote-environment.ts` — check destination install environment
- `src/main/mcp/modules/wpe/delete-install.ts` — check install environment after CAPI fetch
- `src/main/mcp/modules/wpe/delete-site.ts` — check if site has production installs
- `src/main/mcp/modules/wpe/update-install.ts` — cache lookup + environment check
- `src/main/mcp/modules/wpe/purge-cache.ts` — cache lookup + environment check
- `tests/unit/mcp/environment-filter.test.ts` — add tests for new helper
- `docs-site/docs/reference/wpe-access-control.md` — update "What the filter controls" table

---

## Task 1: Add `checkKnownEnvironmentAccess` Helper + Tests

This helper is used by tools that already have the install's environment as a string (e.g. from a CAPI response). It's the typed, direct-environment version of the existing `checkWpeInstallIdEnvironmentAccess` (which does a cache lookup first).

**File:** `src/main/mcp/utils/environment-filter.ts`

- [ ] **Step 1: Write failing tests** (append to `tests/unit/mcp/environment-filter.test.ts`)

```typescript
describe('checkKnownEnvironmentAccess', () => {
  const makeStorage = (settings: object) => ({
    get: (key: string) => key === 'nexus-ai:settings' ? settings : null,
  });

  it('returns null for staging with default settings', () => {
    expect(checkKnownEnvironmentAccess('staging', makeStorage({}))).toBeNull();
  });

  it('returns null for development with default settings', () => {
    expect(checkKnownEnvironmentAccess('development', makeStorage({}))).toBeNull();
  });

  it('returns error string for production with default settings', () => {
    const result = checkKnownEnvironmentAccess('production', makeStorage({}));
    expect(result).not.toBeNull();
    expect(result).toContain('production');
    expect(result).toContain('Nexus Preferences');
  });

  it('returns null for production when production is explicitly allowed', () => {
    const result = checkKnownEnvironmentAccess(
      'production',
      makeStorage({ wpeAllowedEnvironments: ['production', 'staging', 'development'] }),
    );
    expect(result).toBeNull();
  });

  it('returns error for undefined environment (defaults to production)', () => {
    const result = checkKnownEnvironmentAccess(undefined, makeStorage({}));
    expect(result).not.toBeNull();
    expect(result).toContain('production');
  });

  it('accepts null registryStorage and blocks production', () => {
    const result = checkKnownEnvironmentAccess('production', null);
    expect(result).not.toBeNull();
  });
});
```

Also add the import at the top of the test file:
```typescript
import { isWpeEnvironmentAllowed, DEFAULT_WPE_ALLOWED_ENVIRONMENTS, checkWpeInstallEnvironmentAccess, checkWpeInstallIdEnvironmentAccess, checkKnownEnvironmentAccess } from '../../../src/main/mcp/utils/environment-filter';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern="environment-filter" --no-coverage 2>&1 | tail -5
```

Expected: `checkKnownEnvironmentAccess is not a function`

- [ ] **Step 3: Implement `checkKnownEnvironmentAccess` in environment-filter.ts**

Append to `src/main/mcp/utils/environment-filter.ts`:

```typescript
/**
 * Check if an operation on a WPE install with a KNOWN environment string is allowed.
 * Use this when you already have the environment from a CAPI response or install data.
 * Returns null if allowed, or an error message string if blocked.
 */
export function checkKnownEnvironmentAccess(
  environment: string | undefined,
  registryStorage: { get(key: string): unknown } | null | undefined,
): string | null {
  const settings = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as { wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[] };
  if (!isWpeEnvironmentAllowed(environment, settings)) {
    const env = environment ?? 'production';
    return (
      `Operation blocked: "${env}" environments are not enabled in Nexus. ` +
      `Enable production access in Nexus Preferences → WP Engine Environment Access, ` +
      `or target a staging/development install instead.`
    );
  }
  return null;
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npx jest --testPathPattern="environment-filter" --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (previously passing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/utils/environment-filter.ts tests/unit/mcp/environment-filter.test.ts
git commit -m "feat(wpe-capi-filter): add checkKnownEnvironmentAccess helper + 6 tests

Used by CAPI write tools that already have the environment from a CAPI
fetch. Complements the existing checkWpeInstallIdEnvironmentAccess
(which does a cache lookup) for tools that don't have environment data."
```

---

## Task 2: Block `wpe_promote_environment` on Production Destination

`wpe_promote_environment` copies one install to another — typically staging → production. The risk is the DESTINATION being production (the one being overwritten). The source can be any environment.

The tool already fetches both installs from CAPI before the copy. Add the environment check immediately after `dstInstall` is fetched.

**File:** `src/main/mcp/modules/wpe/promote-environment.ts`

- [ ] **Step 1: Add the import at the top of the file**

```typescript
import { checkKnownEnvironmentAccess } from '../../utils/environment-filter';
```

- [ ] **Step 2: Add environment check after dstInstall is fetched**

Find the section in `execute()` that fetches both installs:

```typescript
const [srcInstall, dstInstall] = await Promise.all([
  services.localServices!.capiDirect(`/installs/${sourceId}`) as Promise<any>,
  services.localServices!.capiDirect(`/installs/${destId}`) as Promise<any>,
]);
```

Add the environment check IMMEDIATELY AFTER this block:

```typescript
// Block promotion to a production environment if production is excluded
const destEnvironment = (dstInstall as any)?.environment ?? 'production';
const envError = checkKnownEnvironmentAccess(
  destEnvironment,
  (services as any).registryStorage,
);
if (envError) {
  return {
    content: [{ type: 'text' as const, text: `Cannot promote to destination install: ${envError}` }],
    isError: true,
  };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/modules/wpe/promote-environment.ts
git commit -m "feat(wpe-capi-filter): block wpe_promote_environment to production destination

When wpeAllowedEnvironments excludes production (default), promoting
staging to production is blocked. The destination environment is checked
after fetching the destination install from CAPI. The source environment
is not restricted — you can always promote from production to staging."
```

---

## Task 3: Block `wpe_delete_install` on Production Installs

`wpe_delete_install` already fetches the install from CAPI to build the Tier 3 confirmation warning. The environment is available at line ~32 as `const environment: string = install?.environment ?? 'unknown'`. Add the check immediately after.

**File:** `src/main/mcp/modules/wpe/delete-install.ts`

- [ ] **Step 1: Add the import**

```typescript
import { checkKnownEnvironmentAccess } from '../../utils/environment-filter';
```

- [ ] **Step 2: Add environment check after install is fetched**

Find the section in the `if (!confirmationToken)` block where `install.environment` is extracted:

```typescript
const install = await services.localServices!.capiDirect(`/installs/${installId}`) as any;
const installName: string = install?.name ?? installId;
const environment: string = install?.environment ?? 'unknown';
```

Add the check IMMEDIATELY AFTER these three lines:

```typescript
// Block deletion of production installs if production is excluded
const envError = checkKnownEnvironmentAccess(
  environment === 'unknown' ? 'production' : environment,
  (services as any).registryStorage,
);
if (envError) {
  return {
    content: [{ type: 'text' as const, text: `Cannot delete install: ${envError}` }],
    isError: true,
  };
}
```

Also add the check on the CONFIRMATION path (when `confirmationToken` is provided) — before the actual DELETE call:

Find the section after `if (confirmationToken)` that performs the deletion. Add the same check before the delete call:

```typescript
// Re-check environment on confirmation path
const confirmInstall = await services.localServices!.capiDirect(`/installs/${installId}`) as any;
const confirmEnvError = checkKnownEnvironmentAccess(
  confirmInstall?.environment ?? 'production',
  (services as any).registryStorage,
);
if (confirmEnvError) {
  return {
    content: [{ type: 'text' as const, text: `Cannot delete install: ${confirmEnvError}` }],
    isError: true,
  };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/modules/wpe/delete-install.ts
git commit -m "feat(wpe-capi-filter): block wpe_delete_install on production installs

Environment check added on both the warning path (first call) and the
confirmation path (second call with token) to prevent environment changes
between the two calls from bypassing the filter."
```

---

## Task 4: Block `wpe_delete_site` When Site Has Production Installs

`wpe_delete_site` deletes ALL installs on a site. If any install on the site is production and production is excluded, block the operation. The site's installs can be resolved from the WPE install cache by matching `account_id` + site relationship, or by fetching from CAPI.

The simplest approach: fetch the site's installs from CAPI using `/installs?site_id={siteId}` and check each one.

**File:** `src/main/mcp/modules/wpe/delete-site.ts`

- [ ] **Step 1: Add the import**

```typescript
import { checkKnownEnvironmentAccess } from '../../utils/environment-filter';
```

- [ ] **Step 2: Add environment check in the `if (!confirmationToken)` block**

In the first-call (no token) path, after fetching the site, fetch its installs and check:

Find where the site is fetched:
```typescript
const site = await services.localServices!.capiDirect(`/sites/${siteId}`) as any;
```

Add after it:

```typescript
// Check if any installs on this site have a blocked environment
const installsData = await services.localServices!.capiDirect(
  `/installs?site_id=${siteId}&limit=100`,
).catch(() => null) as any;
const siteInstalls: any[] = installsData?.results ?? installsData ?? [];
for (const inst of siteInstalls) {
  const envErr = checkKnownEnvironmentAccess(
    inst?.environment ?? 'production',
    (services as any).registryStorage,
  );
  if (envErr) {
    return {
      content: [{
        type: 'text' as const,
        text: `Cannot delete site: install "${inst?.name ?? inst?.id}" is in a blocked environment. ${envErr}`,
      }],
      isError: true,
    };
  }
}
```

Also add a simpler check on the CONFIRMATION path (before the DELETE):

```typescript
// Re-check environments on confirmation to prevent race conditions
const confirmedInstalls = await services.localServices!.capiDirect(
  `/installs?site_id=${siteId}&limit=100`,
).catch(() => null) as any;
for (const inst of (confirmedInstalls?.results ?? confirmedInstalls ?? [])) {
  const envErr = checkKnownEnvironmentAccess(
    inst?.environment ?? 'production',
    (services as any).registryStorage,
  );
  if (envErr) {
    return {
      content: [{ type: 'text' as const, text: `Cannot delete site: ${envErr}` }],
      isError: true,
    };
  }
}
```

Note: If `/installs?site_id=` is not a valid CAPI filter, use the WPE install cache instead:

```typescript
const cache = (services as any).registryStorage?.get('nexus-ai:wpe-install-cache') as
  { installs?: any[] } | null;
const siteInstalls = (cache?.installs ?? []).filter(
  (i: any) => i.siteId === siteId || i.site_id === siteId
);
```

Read the existing `wpe_get_installs` tool to confirm the CAPI filter syntax first.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/modules/wpe/delete-site.ts
git commit -m "feat(wpe-capi-filter): block wpe_delete_site when site has production installs

Fetches all installs for the site and checks each one against
wpeAllowedEnvironments. If any install is in a blocked environment
the operation is rejected on both the warning and confirmation paths."
```

---

## Task 5: Block `wpe_update_install` on Production Installs

`wpe_update_install` takes `install_id` and patches the install (PHP version, environment type). It does NOT fetch the install from CAPI first. Use the WPE install cache to look up the environment by install_id.

**File:** `src/main/mcp/modules/wpe/update-install.ts`

- [ ] **Step 1: Add imports**

```typescript
import { checkWpeInstallIdEnvironmentAccess } from '../../utils/environment-filter';
import { STORAGE_KEYS } from '../../../../common/constants';
```

(Check if STORAGE_KEYS is already imported — if not, add it.)

- [ ] **Step 2: Add environment check at the start of `execute()`**

Find the start of the `execute()` method after `const installId = args.install_id as string;`. Add immediately after:

```typescript
// Check environment before modifying install
const envError = checkWpeInstallIdEnvironmentAccess(
  installId,
  (services as any).registryStorage,
);
if (envError) {
  return {
    content: [{ type: 'text' as const, text: `Cannot update install: ${envError}` }],
    isError: true,
  };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/modules/wpe/update-install.ts
git commit -m "feat(wpe-capi-filter): block wpe_update_install on production installs

Uses install cache lookup (checkWpeInstallIdEnvironmentAccess) to avoid
an extra CAPI round-trip. Defaults to 'production' if install not in
cache (safe default — production is blocked by default)."
```

---

## Task 6: Block `wpe_purge_cache` on Production Installs

`wpe_purge_cache` takes `install_id` and calls CAPI to purge the cache. It doesn't fetch the install. Use the cache lookup.

**File:** `src/main/mcp/modules/wpe/purge-cache.ts`

- [ ] **Step 1: Add imports**

```typescript
import { checkWpeInstallIdEnvironmentAccess } from '../../utils/environment-filter';
```

- [ ] **Step 2: Add check at the start of `execute()`**

After `const installId = args.install_id as string;`:

```typescript
// Check environment — production cache purges are blocked by default
const envError = checkWpeInstallIdEnvironmentAccess(
  installId,
  (services as any).registryStorage,
);
if (envError) {
  return {
    content: [{ type: 'text' as const, text: `Cannot purge cache: ${envError}` }],
    isError: true,
  };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

- [ ] **Step 4: Full test suite**

```bash
npm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL " | head -5
```

Expected: same pre-existing 2 failures, all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wpe/purge-cache.ts
git commit -m "feat(wpe-capi-filter): block wpe_purge_cache on production installs

Even cache purges can briefly impact a live site. Applied the same
cache-lookup guard as update-install for consistency."
```

---

## Task 7: Update Reference Docs

**File:** `docs-site/docs/reference/wpe-access-control.md`

- [ ] **Step 1: Update the "What the Filter Controls" section**

Find the "Blocked on excluded environments:" list and expand it:

```markdown
**Blocked on excluded environments:**
- All `wp_*` MCP tools targeting a WPE install (WP-CLI over SSH)
- Content indexing and twin sync via `WPESyncService`
- `wpe_site_deep_refresh` SSH commands
- `wpe_promote_environment` — when the **destination** install is production
- `wpe_delete_install` — when the install being deleted is production
- `wpe_delete_site` — when any install on the site is production
- `wpe_update_install` — when the install being modified is production
- `wpe_purge_cache` — when the install being purged is production

**Not affected by this filter:**
- WPE CAPI read operations — `wpe_get_installs`, `wpe_get_install`, `wpe_get_sites`, etc.
- `wpe_create_backup` — protective operation, always allowed
- `wpe_create_install`, `wpe_create_site` — creates new resources
- `local_wpe_push` / `local_wpe_pull` — Local's file sync, not WP-CLI
- Cached twin data — existing data is not cleared when environments are excluded
```

- [ ] **Step 2: Commit**

```bash
git add docs-site/docs/reference/wpe-access-control.md
git commit -m "docs(wpe-capi-filter): update access control reference with CAPI write coverage

Lists all 5 new CAPI write operations now blocked on excluded environments,
alongside the existing SSH/sync operations. Clarifies what is and isn't
covered by the filter."
```

---

## Self-Review

**Spec coverage:**
- ✅ `checkKnownEnvironmentAccess` helper — Task 1
- ✅ `wpe_promote_environment` (destination) — Task 2
- ✅ `wpe_delete_install` (both paths) — Task 3
- ✅ `wpe_delete_site` (all installs on site) — Task 4
- ✅ `wpe_update_install` (cache lookup) — Task 5
- ✅ `wpe_purge_cache` (cache lookup) — Task 6
- ✅ Docs updated — Task 7

**Placeholder scan:** Task 4 has one conditional note about CAPI filter syntax — the implementer must verify `/installs?site_id=` before using it, or fall back to cache. This is explicit, not vague.

**Type consistency:** `checkKnownEnvironmentAccess(environment, registryStorage)` used in Tasks 2, 3, 4. `checkWpeInstallIdEnvironmentAccess(installId, registryStorage)` used in Tasks 5, 6. Both are already defined in `environment-filter.ts` (Task 1 adds the first, the second already exists from the previous feature branch).

**One implementer note for Task 3:** The confirmation path (when `_confirmationToken` is provided) executes the actual DELETE. Find this by searching for `await services.localServices!.capiDirect(\`/installs/${installId}\`, 'DELETE')` in `delete-install.ts` — the check goes BEFORE that line.
