# Fleet Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "fleet" mean **local + WP Engine + SSH** everywhere it is claimed, instead of silently meaning "WP Engine only" in some views and "Local only" in others.

**Architecture:** The graph DB already holds all three sources — measured: `local 33 · wpe 346 · external 1`. Fleet queries that filter `source='wpe'` are widened to all sources; queries that key on a WP Engine concept (`remote_install_id`, `wpe_site_id`, CAPI) stay as they are. `nexusFleetHealth` is rebuilt on the graph DB rather than `siteData`.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), GraphQL, Jest.

**Evidence:** `docs/cli-mcp-equivalence-inventory.md` §3a records this gap. Plan B1 widened 6 MCP fleet modules and left the rest.

**Branch:** `feat/non-wpe-host-support`, already checked out. Do not create or switch branches. Do not merge.

## Global Constraints

- **Fleet = local + WPE + SSH.** Anything labelled "fleet" must count all three, or say which it excludes and why.
- **Widen only what is generic.** A query keying on `remote_install_id`, `wpe_site_id`, `account_id` or CAPI is WP Engine by nature and must be left alone. Widening one of those produces rows that cannot satisfy it.
- **`SiteSource` is `'local' | 'wpe' | 'external'`.** Never `=== 'wpe'` as a binary discriminator, never `source != 'local'` to mean "is WPE" — `tests/unit/fleet/source-semantics.test.ts` forbids both.
- Every widened query gets a test proving an external row appears. B1 widened six modules with no such test and the remaining eleven drifted; that is the failure this plan exists to correct.
- `npm test` baseline: **12 failing suites / 22–23 failures** (one flaky), names as recorded in `.superpowers/sdd/2026-08-04-wp-surface-unification/progress.md`. Compare failing suite **names**, not counts. If jest fails wholesale with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3` — never `npm run rebuild`, which builds for Electron.

## Known limitation this plan deliberately does not fix

External hosts have **zero plugin rows** (measured). Nothing populates them: `WpeRefreshScheduler` iterates installs with a `remote_install_id`, and there is no equivalent for external hosts. So after this plan an external host appears in every fleet view with empty plugin and theme data until someone runs a command against it.

That is the *external refresh schedule*, tracked separately as the next piece of work. **Do not build a scheduler in this plan.** Where a view would mislead by showing zeros, prefer showing the site with an explicit "never synced" signal over hiding it.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/main/graphql/resolvers.ts` | **Modify.** 6 widened queries; `nexusFleetHealth` and `nexusFleetSiteHealth` rebuilt. |
| `src/main/mcp/modules/wp-cli/core-version.ts` | **Modify.** Cached-version fallback covers all sources. |
| `src/main/mcp/modules/content/search-content.ts` | **Modify.** Site lookup by name covers all sources. |
| `src/main/mcp/modules/content/describe-site-fields.ts` | **Modify.** Same. |
| `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts` | **Modify.** `with_wp_version` counts all; `wpe_count` stays WPE. |
| `src/main/mcp/instructions/server-instructions.ts` | **Modify.** "fleet = local + WPE" prose. |
| `tests/unit/fleet/fleet-visibility.test.ts` | **New.** One case per widened surface. |

---

## Task 1: Widen the six generic resolver queries

**Files:**
- Modify: `src/main/graphql/resolvers.ts:80` (`resolveWpeGraphSite`), `:458` (`nexusSitesGet`), `:1334` (`nexusFleetSummary`), `:1456` (`nexusFleetPlugins`), `:1576` (`nexusFleetVersionSites`), `:2446` (`nexusFleetSearch`)
- Test: `tests/unit/fleet/fleet-visibility.test.ts` (new)

**Interfaces:**
- Produces: no signature change. Each query returns external rows alongside WPE rows.

**Leave alone** — these key on a WP Engine concept and must not be widened: `:1208` (`nexusWpeSiteDeepRefresh`, uses `remote_install_id`) and `:4737` (`nexusResolveTarget`, selects `remote_install_id, account_id`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/fleet-visibility.test.ts`. Use the in-memory graph fixture the existing fleet tests use — check `tests/unit/fleet/` for the established helper and follow it rather than inventing one. Seed one row per source and assert every widened surface returns all three:

```ts
// Seed: one local, one wpe, one external — all is_active=1
// For each widened resolver, assert the external site's name appears.
it.each([
  ['nexusFleetSummary'],
  ['nexusFleetPlugins'],
  ['nexusFleetVersionSites'],
  ['nexusFleetSearch'],
])('%s includes the external site', async (name) => {
  const r = await createResolvers(ctx()).Mutation[name](null, {});
  expect(JSON.stringify(r)).toContain('ext-host');
});
```

Adapt the call signature per resolver — some take arguments. If one cannot be driven from a unit test without excessive mocking, say so in your report and cover it at the SQL level instead (assert the prepared statement's predicate), rather than skipping it.

- [ ] **Step 2: Run and verify it fails**

```bash
npm rebuild better-sqlite3
npx jest tests/unit/fleet/fleet-visibility.test.ts
```
Expected: FAIL — the external row is absent from every widened surface.

- [ ] **Step 3: Implement**

Replace `source='wpe'` with `source IN ('local','wpe','external')` in the six sites listed above.

Use the explicit three-value list, **not** `source != 'local'` and **not** an unfiltered query. `source-semantics.test.ts` forbids the first; the second silently picks up any future source. Where a query already excludes local deliberately — check each — keep that exclusion and widen only to add `'external'`.

Rename `wpeRows` / `wpeTwins` locals where the name is now wrong. A variable called `wpeRows` holding external rows is exactly the drift this plan is undoing.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/fleet/ tests/unit/graphql/ && npx tsc --noEmit
```
Expected: PASS, including `source-semantics.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main/graphql/resolvers.ts tests/unit/fleet/fleet-visibility.test.ts
git commit -m "feat(fleet): include external sites in the six generic fleet queries"
```

---

## Task 2: Widen the four MCP module queries

**Files:**
- Modify: `src/main/mcp/modules/wp-cli/core-version.ts:46,79`; `src/main/mcp/modules/content/search-content.ts:107`; `src/main/mcp/modules/content/describe-site-fields.ts:46`; `src/main/mcp/modules/fleet-intelligence/fleet-overview.ts:50`
- Test: `tests/unit/fleet/fleet-visibility.test.ts` (extend)

**Interfaces:**
- Consumes: the graph DB fixture from Task 1.

**Leave alone:** `fleet-overview.ts:53`'s `COUNT(CASE WHEN source = 'wpe' …) as wpe_count` — that field is definitionally a WP Engine count. Only `:50`'s `with_wp_version` is wrong, because it counts versions for WPE only and therefore under-reports the fleet.

Also leave `wpe-link.ts:42,52`, `deep-refresh.ts:83`, `fleet-versions.ts:54`, `detect-drift.ts:119,129` — all WP Engine tools keyed on WPE concepts.

- [ ] **Step 1: Write the failing tests**

Extend the Task 1 file:

```ts
it('wp_core_version falls back to a cached version for an external site', async () => {
  // seed external row with wp_version '6.8.1', no live transport
  // assert the cached-version path returns it rather than "not found"
});

it('fleet_overview counts wp_version across all sources, and wpe_count stays WPE-only', async () => {
  // seed local+wpe+external all with wp_version
  // with_wp_version === 3, wpe_count === 1
});
```

Write the two content-module cases the same way — a site named only in the external row must resolve.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/fleet/fleet-visibility.test.ts
```

- [ ] **Step 3: Implement**

Same substitution: `source='wpe'` → `source IN ('local','wpe','external')` at the four sites. In `fleet-overview.ts`, change **only** the `with_wp_version` CASE; leave `wpe_count`.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/fleet/ tests/unit/mcp/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/ tests/unit/fleet/fleet-visibility.test.ts
git commit -m "feat(fleet): include external sites in the four MCP fleet queries"
```

---

## Task 3: Rebuild `nexusFleetHealth` on the graph DB

**Files:**
- Modify: `src/main/graphql/resolvers.ts:2286-2360`
- Test: `tests/unit/fleet/fleet-visibility.test.ts` (extend)

**This one is not a predicate widen.** `nexusFleetHealth` reads `services.siteData.getSites()` and never touches the graph DB, so it is **Local-only** — it excludes WP Engine installs as well as external hosts. `nexus fleet health` is the CLI command on top of it.

It also has a live bug: `totalPlugins`, `outdatedPlugins`, `totalThemes` and `outdatedThemes` are declared at `:2302-2305`, **never incremented**, and returned as `0`. Every fleet health report has always shown zero plugins.

**Semantics, decided:**

| Field | Source after this task |
|---|---|
| `totalSites` | all active rows in graph `sites`, all three sources |
| `runningSites` / `haltedSites` | **Local only** — `getSiteStatus` is a Local concept; a remote host is not something Nexus starts or stops |
| `totalPlugins` / `outdatedPlugins` | graph `plugins` joined to active sites, all sources |
| `totalThemes` / `outdatedThemes` | graph `themes`, same |
| `healthyCount` / `warningCount` / `criticalCount` | unchanged — `indexRegistry` entries scored by `healthCalculator` |

Because running/halted stays Local-only while `totalSites` becomes the union, the two no longer sum to `totalSites`. **That is correct and must be visible**, not left for a reader to trip over: add `localSites` to the summary so the relationship is legible, and say so in the GraphQL field description.

- [ ] **Step 1: Write the failing test**

```ts
it('counts all three sources, and plugin totals are no longer always zero', async () => {
  // seed: 1 local, 1 wpe, 1 external active; plugins on the wpe and local rows
  const r = await createResolvers(ctx()).Mutation.nexusFleetHealth();
  expect(r.summary.totalSites).toBe(3);
  expect(r.summary.localSites).toBe(1);
  expect(r.summary.totalPlugins).toBeGreaterThan(0);   // was hardcoded 0
});

it('running + halted counts only Local sites', async () => {
  const r = await createResolvers(ctx()).Mutation.nexusFleetHealth();
  expect(r.summary.runningSites + r.summary.haltedSites).toBe(r.summary.localSites);
});
```

- [ ] **Step 2: Run and verify it fails**

Expected: `totalSites` is 1 (Local only) and `totalPlugins` is 0.

- [ ] **Step 3: Implement**

Count sites and plugins/themes from the graph DB; keep the `getSiteStatus` loop over `siteData` for running/halted only. Add `localSites` to the returned summary, to `NexusFleetHealthSummary` in `src/main/graphql/schema.ts`, and to the CLI's query and output in `src/cli/commands/fleet.ts` — a field added to the resolver but not the query is invisible.

If `themes` has no rows for any source, still write the query; returning a real 0 differs from returning a hardcoded one.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/fleet/ tests/unit/graphql/ && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/main/graphql/resolvers.ts src/main/graphql/schema.ts src/cli/commands/fleet.ts tests/unit/fleet/fleet-visibility.test.ts
git commit -m "feat(fleet): fleet health counts local + WPE + SSH, and reports real plugin totals"
```

---

## Task 4: `nexusFleetSiteHealth` accepts all three target types

**Files:**
- Modify: `src/main/graphql/resolvers.ts:2364-2400`
- Test: `tests/unit/fleet/fleet-visibility.test.ts` (extend)

`nexusFleetSiteHealth` does `resolveSite(parsed.siteName!, services.siteData)`. For a `wpe:` or `ssh:` target `parsed.siteName` is `undefined`, so it returns `Site not found: undefined` — the same shape of bug `wp health` had before it was ported.

- [ ] **Step 1: Write the failing test**

```ts
it.each(['wpe:acct/inst@production', 'ssh:ext-host@production'])(
  'resolves %s instead of reporting "not found: undefined"', async (target) => {
    const r = await createResolvers(ctx()).Mutation.nexusFleetSiteHealth(null, { target });
    expect(r.error ?? '').not.toContain('undefined');
  });
```

- [ ] **Step 2: Run and verify it fails**

Expected: `Site not found: undefined`.

- [ ] **Step 3: Implement**

Resolve the target against the graph DB for non-local types rather than `siteData`. `resolveTargetArgs` (`src/main/transport/resolveTargetArgs.ts`) already maps a target string to `{site}` / `{install_name}` / `{ssh_target}` and owns the bare-name fallback — reuse it rather than re-parsing, and note that it **throws** on an ambiguous bare name, which this resolver's `catch` should surface as the error message rather than swallow.

`healthCalculator` needs `domain` and `phpVersion`; both columns exist on graph `sites`. Where a remote site has neither, keep the existing `'8.0'` default rather than inventing a new one.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/fleet/ tests/unit/graphql/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/graphql/resolvers.ts tests/unit/fleet/fleet-visibility.test.ts
git commit -m "feat(fleet): per-site health accepts wpe: and ssh: targets"
```

---

## Task 5: Correct the agent instructions, and document

**Files:**
- Modify: `src/main/mcp/instructions/server-instructions.ts:18-19`, `CLAUDE.md`, `docs/cli-mcp-equivalence-inventory.md`

`server-instructions.ts` tells the agent the fleet is local + WPE:

> **Local-only user:** No WP Engine installs in graph.db (`source='wpe'` count = 0). Local sites ARE the complete fleet.
> **WPE customer:** … Fleet = local sites + WPE installs. Always include both layers.

A user with a registered external host and no WP Engine account is told their Local sites are the complete fleet. That is now wrong, and it is instruction text an agent acts on.

- [ ] **Step 1: Rewrite the two bullets**

Three layers, not two. A user may have any combination. Keep the existing shape — the point of these bullets is to stop the agent implying a fleet is partial when it is not — and extend it to external hosts, which are addressed as `ssh:<alias>@<environment>` and registered with `nexus host add`.

- [ ] **Step 2: Update `CLAUDE.md`**

Add to the External SSH Hosts section:

```markdown
- **Fleet means local + WPE + SSH.** The graph `sites` table holds all three
  (`source` is `'local' | 'wpe' | 'external'`), so a fleet query filters
  `source IN ('local','wpe','external')` — never `source='wpe'`, and never
  `source != 'local'`. Queries keying on `remote_install_id`, `wpe_site_id`,
  `account_id` or CAPI are WP Engine by nature and stay as they are.
- **External hosts have no background refresh.** Nothing populates their plugin
  and theme rows, so they appear in fleet views with empty data until a command
  is run against them. That is the external refresh schedule, still an open
  product decision — do not add a scheduler without one.
```

- [ ] **Step 3: Update the inventory doc**

`docs/cli-mcp-equivalence-inventory.md` §3a says 6 MCP fleet modules were widened and 6 remain, with 11 resolver queries still filtering `source='wpe'`. Replace with what is now true, including which queries are deliberately still WPE-only and why.

- [ ] **Step 4: Full suite and live check**

```bash
npm rebuild better-sqlite3
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq
```
Expected: the same 12 failing suite names as baseline.

Then rebuild for Local and verify against the real fleet — the registered external host should now appear:

```bash
npm run rebuild && ./dev-reload.sh
node bin/nexus.js fleet health
node bin/nexus.js fleet list 2>/dev/null || node bin/nexus.js sites list
```

`fleet health` must show a `totalSites` consistent with `local 33 · wpe 331 active · external 1`, and a non-zero plugin total. Record the real output.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/instructions/server-instructions.ts CLAUDE.md docs/
git commit -m "docs(fleet): fleet is local + WPE + SSH"
```

---

## Self-Review

**Coverage:** every `source='wpe'` site enumerated in the investigation is either widened (Task 1: 6 resolver queries; Task 2: 4 MCP queries) or explicitly left with a reason (`nexusWpeSiteDeepRefresh`, `nexusResolveTarget`, `wpe-link`, `deep-refresh`, `fleet-versions`, `detect-drift`, `fleet-overview`'s `wpe_count`). `nexusFleetHealth` and `nexusFleetSiteHealth` get Tasks 3 and 4. The prose gets Task 5.

**Deliberately excluded:** `nexusContentSearchAll:3072`. External content indexing is opt-in per Spec 1 §9 and is not built, so widening it would search zero indexed documents. It becomes correct when indexing lands, not before — recorded in Task 5's inventory update rather than silently skipped.

**Placeholders:** none. Counts are measured from the live graph DB (`local 33 · wpe 346, 331 active · external 1`; plugins `local 30/342 · wpe 294/4523 · external 0`), not estimated. Two places tell the implementer to check reality rather than trust the plan — the fleet test fixture in Task 1 and whether each query already excludes local — because both are cheap to confirm and expensive to assume.

**Type consistency:** `localSites` is added to the summary in Task 3 and must appear in three places — the resolver, `NexusFleetHealthSummary` in `schema.ts`, and the CLI query in `fleet.ts`. Task 3 names all three.
