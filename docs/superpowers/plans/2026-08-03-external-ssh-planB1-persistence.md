# Plan B1 — External Sites as Fleet Members

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an external SSH host a persisted, first-class member of the fleet, appearing in fleet tools alongside Local sites and WP Engine installs.

**Architecture:** Widen the closed `'local' | 'wpe'` union into a shared `SiteSource` type; replace the nine ternaries that collapse any non-local source to `'wpe'`; upsert a site row the first time an `ssh:` target succeeds, storing its connection details in RegistryStorage; and broaden the eleven generic fleet queries so external sites appear in them.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite 3.53.2), Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-08-02-external-ssh-hosts-design.md` — see §9a (the landmine class) and §9b (amendments from the Hostinger run).
**Branch from:** `feat/external-ssh-skeleton`, which stacks on `feat/site-taxonomy-foundation` (Plan A) and `feat/site-transport-abstraction` (Spec 0). All three are unmerged.
**Followed by:** Plan B2 — registration UX (`nexus host add`, probe, discovery, WP-CLI detect-then-offer, key-auth guidance).

## Global Constraints

Every task's requirements implicitly include this section.

- **No behaviour change for Local sites or WP Engine installs.** Every task here adds a third case; the existing two must behave identically. Any observable difference is a defect.
- **Never `git push`, `npm version`, or `git tag`.** Commit locally only.
- **Baseline: 12 failed suites / 22 failed tests** pre-exist from native modules. Add none. **Verify by comparing failing-suite NAMES, not counts** — a count match can hide a swap.
- **If a run shows `NODE_MODULE_VERSION 146 ... requires 141`**, or a wave of database-suite failures: run `npm rebuild better-sqlite3`. Not `npm install` — it will not rebuild an already-installed package. Never `npm run rebuild` — that builds for Electron and breaks testing.
- **`source = 'wpe'` filters are correct where they mean "is a WP Engine install".** Plan A made them explicit on purpose. Only the eleven generic fleet queries named in Task 4 should broaden. Do not touch the six in `mcp/modules/wpe/`.
- **`environment` for external sites comes from the target string** (`ssh:alias@production`), and the permission gate already applies via `isGatedHost` and the `ssh:<alias>` target ref. Do not add a second gate.
- **Out of scope, deferred to B2:** `nexus host add`, connect probing, `wp-config.php` discovery, WP-CLI detect-then-offer, key-auth guidance. Also out of scope: content indexing for external sites (opt-in per spec), and the 42 `source = 'wpe'` filters outside the generic fleet directories.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/main/external/externalSiteStore.ts` | Connection profiles for external hosts (alias, wpPath, environment) in RegistryStorage |
| `tests/unit/external/external-site-store.test.ts` | Profile round-trip and upsert-idempotency |
| `tests/unit/external/lazy-upsert.test.ts` | The site row appears after a successful external command |

**Modified:**

| Path | Change |
|---|---|
| `src/common/types.ts` | add `SiteSource`; widen `:432`, `:497` |
| `src/main/events/types.ts` | widen `Site.source` at `:114` |
| `src/main/events/GraphService.ts` | widen `listSites` filter at `:465` |
| `src/main/twin/SiteDigitalTwin.ts` | widen `:93` |
| `src/main/mcp/modules/fleet/find-sites-with-plugin.ts` | widen `:8`; broaden query |
| `src/main/mcp/modules/fleet/find-sites-with-theme.ts` | widen `:11`; broaden query |
| `src/main/mcp/modules/fleet/find-outdated-sites.ts` | widen `:18`, `:73`; broaden query |
| `src/main/mcp/modules/fleet/fleet-summary.ts` | broaden query |
| `src/main/mcp/modules/fleet-intelligence/fleet-plugins.ts` | broaden query |
| `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts` | broaden query |
| `src/renderer/components/NexusOverview.tsx` | widen `:86` |
| `src/renderer/components/DockedPanel/ContextSelector.tsx` | widen `:7` |
| `src/main/assistant/AssistantService.ts` | replace 4 ternaries |
| `src/main/search/metadataSearch.ts` | replace 5 ternaries |
| `src/main/mcp/tool-registry.ts` | lazy upsert hook |

---

### Task 1: Introduce `SiteSource` and widen the eleven unions

Eleven inline `'local' | 'wpe'` unions exist across the codebase. Replacing them with one shared type means the next site kind is a one-line change rather than another eleven-site hunt.

**Files:**
- Modify: `src/common/types.ts:432,497`
- Modify: `src/main/events/types.ts:114`
- Modify: `src/main/events/GraphService.ts:465`
- Modify: `src/main/twin/SiteDigitalTwin.ts:93`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-plugin.ts:8`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-theme.ts:11`
- Modify: `src/main/mcp/modules/fleet/find-outdated-sites.ts:18,73`
- Modify: `src/renderer/components/NexusOverview.tsx:86`
- Modify: `src/renderer/components/DockedPanel/ContextSelector.tsx:7`
- Test: `tests/unit/common/site-source.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `export type SiteSource = 'local' | 'wpe' | 'external'` and `export function toSiteSource(raw: string | null | undefined): SiteSource`, both from `src/common/types.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/common/site-source.test.ts`:

```ts
import { toSiteSource } from '../../../src/common/types';

describe('toSiteSource', () => {
  it.each(['local', 'wpe', 'external'] as const)('passes %s through', (v) => {
    expect(toSiteSource(v)).toBe(v);
  });

  it("defaults null and undefined to 'local' — matching the column default", () => {
    // sites.source is `TEXT DEFAULT "local"` (GraphService.ts:191), so a row
    // written before that migration reads as local, not as an unknown kind.
    expect(toSiteSource(null)).toBe('local');
    expect(toSiteSource(undefined)).toBe('local');
  });

  it("maps an unrecognised value to 'local' rather than silently to 'wpe'", () => {
    // The bug this type exists to prevent: `x === 'local' ? 'local' : 'wpe'`
    // relabelled every unknown source as a WP Engine install.
    expect(toSiteSource('laravel')).toBe('local');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/common/site-source.test.ts
```

Expected: FAIL — `toSiteSource` is not exported.

- [ ] **Step 3: Add the type and helper**

In `src/common/types.ts`:

```ts
/**
 * Where a site lives. Widened from a closed 'local' | 'wpe' union, which was
 * duplicated inline in eleven places and caused a whole bug class: code wrote
 * `x === 'local' ? 'local' : 'wpe'`, so any third value silently became a WP
 * Engine install. Add new kinds here, not inline.
 */
export type SiteSource = 'local' | 'wpe' | 'external';

const SITE_SOURCES: readonly string[] = ['local', 'wpe', 'external'];

/**
 * Narrow a raw database value to a SiteSource.
 *
 * Unrecognised values become 'local', matching the `TEXT DEFAULT "local"`
 * column default. Deliberately NOT 'wpe': defaulting an unknown kind to WP
 * Engine is exactly the failure this replaces, and it would put a site into
 * WPE-specific code paths that cannot serve it.
 */
export function toSiteSource(raw: string | null | undefined): SiteSource {
  return SITE_SOURCES.includes(raw as string) ? (raw as SiteSource) : 'local';
}
```

- [ ] **Step 4: Replace the eleven inline unions**

Substitute `SiteSource` for `'local' | 'wpe'` at each site listed under **Files**, importing it from `../../common/types` (adjust the relative depth per file). Two need slightly more than a swap:

- `find-outdated-sites.ts:73` currently reads
  `{ ...r, source: (r.source ?? 'local') as 'local' | 'wpe' }` — replace the cast with `toSiteSource(r.source)`.
- `GraphService.ts:465` is a function parameter: `source?: SiteSource`. The SQL below it needs no change; it already binds whatever value is passed.

The two `.tsx` files are renderer prop types — swap the union, import from `../../common/types` or `../../../common/types` as the path requires.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/common/site-source.test.ts -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: new tests pass; `tsc` clean; suite at 12/22 with failing-suite **names** matching baseline.

If `tsc` reports errors at sites that narrow on the old union, **report them** — Task 2 handles the known ones in `AssistantService.ts` and `metadataSearch.ts`, and anything else is a finding.

- [ ] **Step 6: Commit**

```bash
git add src tests/unit/common/site-source.test.ts
git commit -m "feat(types): introduce SiteSource, widen eleven inline unions

One shared type replaces eleven copies of 'local' | 'wpe'. toSiteSource
narrows raw DB values, defaulting unknowns to 'local' rather than 'wpe' —
defaulting to WPE is the failure this whole change removes."
```

---

### Task 2: Replace the nine collapsing ternaries

Nine expressions read `row.source === 'local' ? 'local' : 'wpe'`. Each relabels an external site as a WP Engine install. They are the TypeScript half of the landmine class Plan A removed from SQL, and the source-scanning test added there does not look for them.

**Files:**
- Modify: `src/main/assistant/AssistantService.ts:180,227,250,292`
- Modify: `src/main/search/metadataSearch.ts:169,192,222,270,291`
- Modify: `tests/unit/graph/source-semantics.test.ts`

**Interfaces:**
- Consumes: `toSiteSource` from Task 1
- Produces: nothing new

- [ ] **Step 1: Extend the source-scanning test**

`tests/unit/graph/source-semantics.test.ts` already walks `src/` for the SQL form. Add a second scan for the TypeScript form, in the same file:

```ts
  it("no code collapses a non-local source to 'wpe'", () => {
    // The TypeScript half of the same bug the SQL scan above guards. Nine of
    // these existed; each turned an external site into a WP Engine install.
    // Use toSiteSource(row.source) instead.
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Skip comments. The docblock on SiteSource in common/types.ts quotes
        // this exact pattern to explain why it is forbidden, and flagging the
        // explanation as a violation would make the test unpassable.
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
        if (/===\s*'local'\s*\?\s*'local'\s*:\s*'wpe'/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/graph/source-semantics.test.ts
```

Expected: FAIL listing exactly 9 offenders across 2 files — `AssistantService.ts` (4) and `metadataSearch.ts` (5).

If it lists a line in `common/types.ts`, the comment-skipping guard is not working: that file's `SiteSource` docblock quotes the forbidden pattern deliberately, to explain why it is forbidden. Fix the guard, not the docblock. If the count differs for any other reason, record the actual list in your report and fix all of them.

- [ ] **Step 3: Replace all nine**

In `AssistantService.ts`, the four occurrences read `source: row.source === 'local' ? 'local' : 'wpe',` → `source: toSiteSource(row.source),`.

In `metadataSearch.ts`, the five read `siteSource: row.source === 'local' ? 'local' : 'wpe',` → `siteSource: toSiteSource(row.source),`.

Add `import { toSiteSource } from '../../common/types';` to each file, adjusting relative depth.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx jest tests/unit/graph/source-semantics.test.ts -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: the scan passes; suite at 12/22 by failing-suite name.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/graph/source-semantics.test.ts
git commit -m "fix: stop collapsing non-local sources to 'wpe'

Nine expressions read `row.source === 'local' ? 'local' : 'wpe'`, so any
external site was relabelled a WP Engine install. Replaced with
toSiteSource(). Extends the source-scanning test to the TypeScript form —
the SQL scan added in Plan A never looked for it."
```

---

### Task 3: Store external connection profiles

An external site needs its alias and WordPress path remembered, or every later fleet operation would need them re-typed. The site row lives in graph.db; the connection details live in RegistryStorage, following the `IW_SITE_BINDINGS` precedent (`src/common/constants.ts:306`).

**Files:**
- Create: `src/main/external/externalSiteStore.ts`
- Modify: `src/common/constants.ts`
- Test: `tests/unit/external/external-site-store.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface ExternalSiteProfile { alias: string; wpPath?: string; environment: 'production' | 'staging' | 'development'; firstSeenAt: number; lastSeenAt: number }`
  - `externalSiteId(alias: string): string` — returns `` `ssh:${alias}` ``
  - `getExternalProfile(registryStorage, alias): ExternalSiteProfile | null`
  - `upsertExternalProfile(registryStorage, profile): void`
  - `listExternalProfiles(registryStorage): ExternalSiteProfile[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/external/external-site-store.test.ts`:

```ts
import {
  externalSiteId, getExternalProfile, upsertExternalProfile, listExternalProfiles,
} from '../../../src/main/external/externalSiteStore';

function fakeStorage() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); },
  };
}

describe('externalSiteId', () => {
  it('derives a stable id from the alias', () => {
    expect(externalSiteId('acme-box')).toBe('ssh:acme-box');
  });
});

describe('external site profiles', () => {
  it('returns null for an unknown alias', () => {
    expect(getExternalProfile(fakeStorage() as any, 'nope')).toBeNull();
  });

  it('round-trips a profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
    expect(getExternalProfile(s, 'acme-box')).toEqual({
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
  });

  it('preserves firstSeenAt across an update but advances lastSeenAt', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/a', environment: 'staging',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/b', environment: 'production',
      firstSeenAt: 9999, lastSeenAt: 2000,
    });
    const p = getExternalProfile(s, 'acme-box')!;
    expect(p.firstSeenAt).toBe(1000);   // original wins
    expect(p.lastSeenAt).toBe(2000);
    expect(p.wpPath).toBe('/b');        // latest wins
    expect(p.environment).toBe('production');
  });

  it('does not lose an existing wpPath when a later call omits it', () => {
    // A command run without --path must not erase a path we already know.
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, {
      alias: 'acme-box', environment: 'production', firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'acme-box')!.wpPath).toBe('/var/www/html');
  });

  it('lists every stored profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'a', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'b', environment: 'staging', firstSeenAt: 1, lastSeenAt: 1 });
    expect(listExternalProfiles(s).map(p => p.alias).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/external/external-site-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add the storage key**

In `src/common/constants.ts`, beside `IW_SITE_BINDINGS`:

```ts
  EXTERNAL_SITE_PROFILES: `${ADDON_PREFIX}_external_site_profiles`,
```

- [ ] **Step 4: Write the store**

Create `src/main/external/externalSiteStore.ts`:

```ts
import { STORAGE_KEYS } from '../../common/constants';

/** Minimal surface of Local's RegistryStorage that this module needs. */
interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface ExternalSiteProfile {
  /** ~/.ssh/config Host alias. The credential path — no key material is stored. */
  alias: string;
  /** WordPress root, passed as --path. Absent means WP-CLI searches from the login dir. */
  wpPath?: string;
  environment: 'production' | 'staging' | 'development';
  firstSeenAt: number;
  lastSeenAt: number;
}

/** Stable site id for an external host. Distinct from any Local site id or WPE install name. */
export function externalSiteId(alias: string): string {
  return `ssh:${alias}`;
}

function readAll(storage: Storage): Record<string, ExternalSiteProfile> {
  return (storage.get(STORAGE_KEYS.EXTERNAL_SITE_PROFILES) as Record<string, ExternalSiteProfile>) ?? {};
}

export function getExternalProfile(storage: Storage, alias: string): ExternalSiteProfile | null {
  return readAll(storage)[alias] ?? null;
}

export function listExternalProfiles(storage: Storage): ExternalSiteProfile[] {
  return Object.values(readAll(storage));
}

/**
 * Merge a profile in.
 *
 * `firstSeenAt` is preserved from any existing record — it answers "when did
 * this host enter the fleet", which a later sighting must not overwrite.
 * `wpPath` is only replaced when the incoming profile supplies one: a command
 * run without --path must not erase a path already discovered.
 */
export function upsertExternalProfile(storage: Storage, profile: ExternalSiteProfile): void {
  const all = readAll(storage);
  const existing = all[profile.alias];
  all[profile.alias] = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpPath: profile.wpPath ?? existing?.wpPath,
  };
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/external/external-site-store.test.ts -v
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add src tests/unit/external/external-site-store.test.ts
git commit -m "feat(external): store external host connection profiles

RegistryStorage-backed, following the IW_SITE_BINDINGS precedent. Holds
alias, wpPath and environment — never key material; the ~/.ssh/config
alias is the credential path.

firstSeenAt survives updates and wpPath is not erased by a later call that
omits it, so running a command without --path cannot lose a known path."
```

---

### Task 4: Lazy-upsert the site row on first successful use

With registration deferred to B2, this is what makes an external host appear in the fleet: run a command against it successfully and it joins.

`ToolRegistry.call()` is the right hook — it is the chokepoint every MCP tool passes through and already writes the audit entry there, so it sees both the args and the outcome.

**Files:**
- Modify: `src/main/mcp/tool-registry.ts`
- Test: `tests/unit/external/lazy-upsert.test.ts` (create)

**Interfaces:**
- Consumes: `externalSiteId`, `upsertExternalProfile` from Task 3; `toSiteSource` from Task 1
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Create `tests/unit/external/lazy-upsert.test.ts`:

```ts
import { maybeUpsertExternalSite } from '../../../src/main/mcp/tool-registry';

function fakeStorage() {
  const data = new Map<string, unknown>();
  return { get: (k: string) => data.get(k) ?? null, set: (k: string, v: unknown) => { data.set(k, v); } };
}

function fakeGraph() {
  const rows: any[] = [];
  return { rows, upsertSite: jest.fn(async (s: any) => { rows.push(s); }) };
}

describe('maybeUpsertExternalSite', () => {
  it('does nothing when there is no ssh_target', async () => {
    const g = fakeGraph();
    await maybeUpsertExternalSite({ site: 'mysite' }, true, fakeStorage() as any, g as any);
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('does nothing when the call failed', async () => {
    // Only a working host earns a fleet entry — a typo'd alias must not
    // litter the fleet with hosts that were never reachable.
    const g = fakeGraph();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@production' }, false, fakeStorage() as any, g as any);
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('upserts a site row with source and host set to external', async () => {
    const g = fakeGraph();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@production', wp_path: '/var/www/html' },
      true, fakeStorage() as any, g as any);
    expect(g.upsertSite).toHaveBeenCalledTimes(1);
    const row = g.rows[0];
    expect(row.id).toBe('ssh:acme');
    expect(row.name).toBe('acme');
    expect(row.source).toBe('external');
    expect(row.host).toBe('external');
    expect(row.environment).toBe('production');
    expect(row.is_active).toBe(true);
  });

  it('stores the connection profile alongside the row', async () => {
    const s = fakeStorage() as any;
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@staging', wp_path: '/srv/wp' }, true, s, fakeGraph() as any);
    const { getExternalProfile } = require('../../../src/main/external/externalSiteStore');
    const p = getExternalProfile(s, 'acme');
    expect(p.wpPath).toBe('/srv/wp');
    expect(p.environment).toBe('staging');
  });

  it('never throws on a malformed target — persistence must not break a working command', async () => {
    const g = fakeGraph();
    await expect(
      maybeUpsertExternalSite({ ssh_target: 'not-a-valid-target' }, true, fakeStorage() as any, g as any),
    ).resolves.toBeUndefined();
    expect(g.upsertSite).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/external/lazy-upsert.test.ts
```

Expected: FAIL — `maybeUpsertExternalSite` is not exported.

- [ ] **Step 3: Implement and export the helper**

Add to `src/main/mcp/tool-registry.ts`, as a module-level exported function so it is testable without constructing the registry:

```ts
/**
 * Record an external host in the fleet after a successful command against it.
 *
 * With registration deferred to Plan B2, this is how an external site first
 * appears: use it once and it joins. Only successful calls qualify, so a
 * typo'd alias does not litter the fleet with unreachable hosts.
 *
 * Never throws. Persistence is a side benefit of a command the user already
 * got the answer to; a storage fault must not turn a successful call into a
 * failed one. Same discipline as the audit write beside it.
 */
export async function maybeUpsertExternalSite(
  args: Record<string, unknown>,
  succeeded: boolean,
  registryStorage: { get(k: string): unknown; set(k: string, v: unknown): void } | null | undefined,
  graphService: { upsertSite(site: any): Promise<void> } | null | undefined,
): Promise<void> {
  try {
    if (!succeeded) return;
    const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
    if (!sshTarget || !registryStorage || !graphService) return;

    const { parseTarget } = require('../../common/target');
    const parsed = parseTarget(sshTarget);
    if (parsed.type !== 'external' || !parsed.alias) return;

    const { externalSiteId, upsertExternalProfile } = require('../external/externalSiteStore');
    const now = Date.now();
    const wpPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;

    upsertExternalProfile(registryStorage, {
      alias: parsed.alias,
      wpPath,
      environment: parsed.environment,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    await graphService.upsertSite({
      id: externalSiteId(parsed.alias),
      name: parsed.alias,
      // No domain is known without querying the site; the alias is the stable
      // human-facing identifier until B2's registration probe can fill it in.
      domain: parsed.alias,
      source: 'external',
      host: 'external',
      environment: parsed.environment,
      is_active: true,
      created_at: now,
      updated_at: now,
      last_sync_at: now,
    });
  } catch {
    // Deliberately swallowed — see the docblock.
  }
}
```

- [ ] **Step 4: Call it from the success path**

In `ToolRegistry.call()`, immediately after the existing audit write on the success path (near `tool-registry.ts:110`), add:

```ts
      await maybeUpsertExternalSite(
        args as Record<string, unknown>,
        true,
        (services as any).registryStorage,
        (services as any).graphService,
      );
```

Do **not** add it to the failure branch — the helper already refuses when `succeeded` is false, but calling it there would be misleading.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/external/ -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: new tests pass; suite at 12/22 by failing-suite name. In particular `tests/main/wp-cli-tools.test.ts` must still pass — it exercises `ToolRegistry.call()` and would catch an exception escaping the new hook.

- [ ] **Step 6: Commit**

```bash
git add src tests/unit/external/lazy-upsert.test.ts
git commit -m "feat(external): join the fleet on first successful command

With registration deferred to B2, an external host appears in the fleet by
being used successfully once. Hooked at ToolRegistry.call()'s success path,
the same chokepoint that writes the audit entry.

Only successful calls qualify, so a typo'd alias cannot litter the fleet.
Never throws: persistence is a side benefit of a command the user already
got an answer to."
```

---

### Task 5: Broaden the eleven generic fleet queries

Plan A made every `source != 'local'` explicit as `source = 'wpe'`, which was correct then. Now external sites exist, and the *generic* fleet tools should include them while the WP-Engine-specific ones must not.

**Files:**
- Modify: `src/main/mcp/modules/fleet/fleet-summary.ts`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-plugin.ts`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-theme.ts`
- Modify: `src/main/mcp/modules/fleet/find-outdated-sites.ts`
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-plugins.ts`
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts`
- Test: `tests/unit/fleet/external-visibility.test.ts` (create)

**Interfaces:**
- Consumes: `SiteSource` from Task 1
- Produces: nothing new

- [ ] **Step 1: Enumerate the exact filters**

The eleven live in the six files above. Produce the list before editing:

```bash
grep -rn "source = 'wpe'\|source='wpe'" \
  src/main/mcp/modules/fleet src/main/mcp/modules/fleet-intelligence
```

Record each in your report. If the count is not eleven, say so.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/fleet/external-visibility.test.ts`. It scans source rather than running the tools, because these are SQL string literals and the tools need a populated graph to run:

```ts
import * as fs from 'fs';
import * as path from 'path';

const FLEET_DIRS = [
  path.join(__dirname, '..', '..', '..', 'src', 'main', 'mcp', 'modules', 'fleet'),
  path.join(__dirname, '..', '..', '..', 'src', 'main', 'mcp', 'modules', 'fleet-intelligence'),
];

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
}

describe('generic fleet queries include external sites', () => {
  it("no generic fleet query filters on source = 'wpe' alone", () => {
    // These tools answer "what is in my fleet". Restricting them to WP Engine
    // makes an external site invisible in exactly the views that exist to give
    // a complete picture. WPE-specific tools live in modules/wpe/ and are
    // deliberately not covered by this scan.
    const offenders: string[] = [];
    for (const dir of FLEET_DIRS) {
      for (const file of tsFiles(dir)) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (/source\s*=\s*'wpe'/.test(line)) {
            offenders.push(`${path.basename(dir)}/${path.basename(file)}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx jest tests/unit/fleet/external-visibility.test.ts
```

Expected: FAIL listing eleven offenders.

- [ ] **Step 4: Broaden each filter**

Replace `source = 'wpe'` with `source IN ('wpe', 'external')` **in these six files only**.

**Do NOT use `source != 'local'`.** It reads as the natural predicate here, and it is what an earlier draft of this plan specified — but `tests/unit/graph/source-semantics.test.ts:33` asserts that pattern appears **zero** times in `src/`, so it would fail the suite. That scanner exists because the same syntax previously meant "is a WP Engine install", and no scanner can distinguish the two intents. Keeping it absolute is worth more than the shorter predicate.

The explicit list also has a defensible failure mode: a fourth site kind will not silently appear in fleet views. Given this entire effort began with a third value being silently mishandled, forcing a deliberate decision per query is the safer direction.

For SQL with a table alias, preserve it: `s.source = 'wpe'` → `s.source IN ('wpe', 'external')`.

Add a short comment above each so the intent survives:

```sql
-- Remote sites of every kind: WPE installs and external SSH hosts.
-- Add new remote kinds here; `!= 'local'` is forbidden (see source-semantics.test.ts).
```

- [ ] **Step 5: Confirm the WPE-specific filters were not touched**

```bash
grep -rn "source = 'wpe'\|source='wpe'" src/main/mcp/modules/wpe | wc -l
```

Expected: **6**, unchanged. Those tools are WP-Engine-specific — `wpe_fleet_health` reporting an SSH box would be wrong.

- [ ] **Step 6: Run tests and typecheck**

```bash
npx jest tests/unit/fleet/ -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: suite at 12/22 by failing-suite name.

- [ ] **Step 7: Commit**

```bash
git add src tests/unit/fleet/external-visibility.test.ts
git commit -m "feat(fleet): include external sites in generic fleet queries

Eleven queries in modules/fleet and modules/fleet-intelligence answer
'what is in my fleet' and were restricted to WP Engine, making external
sites invisible in the views that exist to give a complete picture.

They now use source != 'local' — correct here, where the intent really is
'every non-local kind'. That is the opposite of the case Plan A fixed,
where code meaning 'is a WPE install' used the same predicate as a proxy.
The six WPE-specific filters in modules/wpe are deliberately unchanged."
```

---

## Self-Review

**Spec coverage.** §9a union widening → Tasks 1–2 (11 unions, 9 ternaries). §9b B1 row = "widen, persist, fleet integration" → Tasks 1–2 (widen), 3–4 (persist), 5 (fleet). §5 connection profile in RegistryStorage → Task 3. Environment from the target and the existing gate → Task 4, no new gate.

**Deliberately deferred to B2**, matching §9b: `nexus host add`, connect probe, `wp-config.php` discovery, WP-CLI detect-then-offer, key-auth guidance. Also deferred: content indexing for external sites (opt-in per §"Fleet depth"), and the 42 `source = 'wpe'` filters outside the two generic fleet directories.

**Placeholder scan:** none. Every code step carries code; every command is exact.

**Type consistency.** `SiteSource` and `toSiteSource` defined in Task 1, consumed in Tasks 2 and 4. `ExternalSiteProfile`, `externalSiteId`, `upsertExternalProfile`, `getExternalProfile`, `listExternalProfiles` defined in Task 3, consumed in Task 4. `maybeUpsertExternalSite(args, succeeded, registryStorage, graphService)` defined in Task 4.

**Three things to expect at execution time.** Task 1's `tsc` run is the one most likely to surface unexpected narrowing sites — the plan says report rather than fix, and Task 2 covers the two known files. Task 4 hooks the chokepoint every MCP tool uses, so it is the highest-blast-radius change here; the swallow-everything discipline and `wp-cli-tools.test.ts` are the guards. And Task 5 originally specified `source != 'local'`, which would have failed Plan A's source scanner outright — caught in pre-flight and changed to `source IN ('wpe', 'external')`. The lesson generalises: a predicate that reads naturally may still be forbidden by a test written for a different intent.
