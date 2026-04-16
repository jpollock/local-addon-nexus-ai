# MCP Tool & CLI Command — Digital Twin Audit

Review of every tool and command against four questions:
1. Does it benefit from twin data?
2. Does it warn when data is stale?
3. Does it have a backup route (live API/SSH if cache is missing)?
4. Could it silently return outdated data without telling the user?

---

## Audit Results

### Tier 1 — Already Twin-Aware (3 tools)

These are the gold standard. Every other tool should converge toward this pattern.

| Tool | Notes |
|---|---|
| `nexus_get_site_twin` | Reads twin directly, surfaces completeness + per-field age |
| `nexus_site_refresh` | Triggers twin rescan, reports what changed |
| `get_site_structure` | Twin first, IndexRegistry supplement, graceful fallback |

---

### Tier 2 — Read Cached Data, No Staleness Warning (HIGH PRIORITY)

These tools read IndexRegistry or SiteMetadataCache and return data without
telling the user how old it is. If a site hasn't been indexed or started in
weeks, they silently return stale results.

| Tool / Command | Source | Staleness Risk | Backup Route? |
|---|---|---|---|
| `compare_sites` | IndexRegistry | HIGH — silent | No |
| `detect_drift` | IndexRegistry | HIGH — silent | No |
| `find_outdated_sites` | GraphService + IndexRegistry | MEDIUM — dual-source | Partial |
| `find_sites_with_plugin` | IndexRegistry | HIGH — silent | No |
| `find_sites_with_theme` | IndexRegistry | HIGH — silent | No |
| `fleet_health_summary` | IndexRegistry + HealthCalculator | HIGH — silent | No |
| `get_site_health` | IndexRegistry | HIGH — silent | No |
| `fleet_filter` | IndexRegistry | HIGH — silent | No |
| `fleet_search` | IndexRegistry | HIGH — silent | No |
| `nexus_plugin_audit` | IndexRegistry | HIGH — silent | No |
| `search_site_content` | VectorStore + IndexRegistry | MEDIUM — checks error, not stale | No |
| `search_across_sites` | VectorStore + IndexRegistry | MEDIUM — same | No |
| `local_get_site` | siteData + status | LOW — runtime only | No |
| `nexus_list_sites` | siteData + IndexRegistry + CAPI | MEDIUM — no freshness shown | Partial |

**Fix pattern for all of these:**
```typescript
const indexEntry = services.indexRegistry.get(siteId);
const isStale = indexEntry
  && (indexEntry.state === 'stale' || Date.now() - indexEntry.lastIndexed > 24 * 60 * 60 * 1000);
if (isStale) {
  lines.push('> ⚠️ Index data is stale — results may not reflect recent changes. Run `reindex_site` to refresh.');
}
```

---

### Tier 3 — Live Tools That Need a Twin Fallback (MEDIUM PRIORITY)

These tools go live to WP-CLI or CAPI. If the site is halted or network is
unavailable, they fail. They could instead check the twin for a cached answer
and return it with a freshness caveat — better than nothing.

| Tool / Command | Requires Live? | Could Use Twin? | Notes |
|---|---|---|---|
| `wp_core_version` | Running site | Yes | Twin has `wpVersion` |
| `wp_plugin_list` | Running site | Yes | Twin has `plugins` with status |
| `wp_theme_list` | Running site | Yes | Twin has `themes` with status |
| `nexus_site_audit` | Running site (5 calls) | Partially | Twin covers WP/PHP/plugins; DB audit still needs live |
| `local_get_site` | Runtime status | Partially | Twin adds MySQL, post counts, site URL |

**Backup route pattern:**
```typescript
// Try live first
if (isRunning) {
  const liveResult = await localServices.getPlugins(siteId);
  // update twin cache with fresh data
  return formatResult(liveResult, 'live');
}
// Fall back to twin if halted
const twin = services.twinService?.get(siteId);
if (twin?.plugins?.length) {
  return formatResult(twin.plugins, 'cached', twin.asOf);
}
return error('Site is halted and no cached data available. Start the site or run nexus_site_refresh.');
```

---

### Tier 4 — WPE Tools: Cache-and-Fallback Opportunity (MEDIUM PRIORITY)

WPE tools hit CAPI live on every call. The `site_usage` table now persists
usage data. Several other WPE responses could be cached similarly.

| Tool | Currently Cached? | Twin/Graph Has Data? | Opportunity |
|---|---|---|---|
| `wpe_get_install_usage` | Yes — 1h in-memory | Yes — `site_usage` SQLite | Upgrade in-memory to persistent; return cached on network failure |
| `wpe_get_account_usage` | Yes — 1h in-memory | Partial | Same as above |
| `wpe_get_installs` | No | Yes — `sites` graph table | Return graph data on CAPI failure with age warning |
| `wpe_get_install` | No | Partial — graph row exists | Return partial graph data on failure |
| `wpe_fleet_health` | No | No | Complex — needs caching strategy |
| `wpe_fleet_versions` | No | Yes — `sites.php_version`, `wp_version` | Could serve from graph with staleness note |

**Pattern for CAPI backup route:**
```typescript
try {
  const live = await services.localServices.capiDirect(`/installs/${id}/usage?...`);
  graphService.upsertSiteUsage(siteId, period, live); // update cache
  return formatResult(live, 'live');
} catch (err) {
  // Network failure — serve from SQLite cache
  const cached = graphService.getSiteUsage(siteId, period);
  if (cached.length) {
    const ageMs = Date.now() - cached[0].recordedAt;
    return formatResult(cached[0], 'cached', ageMs);
  }
  return error(`CAPI unavailable and no cached data for ${period}.`);
}
```

---

### Tier 5 — No Twin Benefit (Leave Alone)

These tools are either write operations (no read benefit), pure live operations
where caching would be misleading, or infrastructure tools unrelated to site data.

**Write operations (all N/A):** all `create`, `update`, `delete`, `install`,
`activate`, `deactivate`, `push`, `pull`, `export`, `import`, `clone`, `rename`,
`sync`, `backup`, `promote` tools.

**Correctly live by design:**
- All WP-CLI tools (wp_eval, wp_search_replace, etc.) — must be live
- `wpe_diagnose_site`, `wpe_go_live_checklist` — real-time checks
- `ask_ollama`, `list_models` — live inference
- `setup_ai`, `sync_credentials` — configuration operations
- `get_site_logs` — live log tailing

**Infrastructure (no site context):**
- All `telemetry_*` tools
- All `wpe_get_account_*`, `wpe_get_domain_*`, `wpe_get_ssl_*` (account-level, not site-level)
- `wpe_status`, `wpe_login`, `wpe_logout`
- `doctor`, `mcp status`, `skills`

---

## Cross-Cutting Design Questions

As each tool is reviewed, these questions should guide decisions:

### 1. What should happen when a site is halted?

Three possible responses — tools should pick one consistently:
- **Hard fail:** "Site is halted. Start it with `nexus sites start <site>`."
- **Cached fallback:** Return twin data with age caveat.
- **Partial answer:** Return what's available, label what's missing.

**Current problem:** Most tools hard fail with a generic "site not available"
error rather than a helpful message. Tools that could serve cached data don't.

**Proposed rule:** Any read tool that touches per-site data should:
1. Try live if site is running
2. Fall back to twin if halted and twin is fresh (< 24h)
3. Fall back to twin with stale warning if > 24h
4. Hard fail only if twin has no data at all

---

### 2. What should happen when CAPI/network is unavailable?

**Current problem:** WPE tools fail immediately on network error with no
indication of whether cached data exists.

**Proposed rule:** WPE read tools should:
1. Try CAPI live
2. On network failure: check GraphService for cached data
3. Return cached data with `⚠️ Network unavailable — showing data from X ago`
4. Hard fail only if no cached data exists

---

### 3. When should stale data be a warning vs. an error?

**Proposed thresholds:**
- **< 1 hour old** — serve without comment
- **1–24 hours old** — serve with `(from Xh ago)` inline note
- **> 24 hours old** — serve with prominent `⚠️ stale data` warning + refresh suggestion
- **> 7 days old** — serve with `❌ very stale` warning, strongly suggest refresh
- **No data at all** — explain what's needed to populate it

These thresholds should be constants in a shared location, not scattered
per-tool.

---

### 4. How do WPE-linked local sites fit?

Some local sites are linked to a WPE environment. For these sites:
- The local twin has live WP-CLI data (when running)
- The WPE graph has CAPI data (PHP, domain, backups)
- The `site_usage` table has bandwidth/visits from CAPI

**Current problem:** No tool currently merges these for a linked site.
`nexus sites get mysite@local` doesn't show WPE usage. `nexus wpe install
get mysite` doesn't show local runtime state.

**Proposed:** When a site has a WPE link (`twin.wpeInstallId` is set), all
site tools should optionally include WPE data in their response — usage,
backup status, domain, environment type.

---

### 5. How should twin data be surfaced for WPE-only sites (not local)?

WPE sites in the graph have limited twin data:
- CAPI fields: name, domain, PHP version, account
- SSH sync fields: WP version, plugins, themes (when synced)
- Usage: bandwidth/visits/storage (hourly from CAPI)

**Current problem:** None of the `nexus sites *` commands work for WPE-only
sites. `wpe_get_install` is the only way to get info, and it doesn't use twin.

**Proposed:** Phase 1.2 of the roadmap — WPE twin population — should make
`nexus sites get mysite@production` return a twin-backed response exactly as
`nexus sites get mysite@local` does.

---

### 6. Should search results warn about stale indexes?

`search_site_content` and `search_across_sites` currently warn on `error`
state but not `stale` state. A user searching a site indexed 2 weeks ago gets
no indication that new posts might be missing.

**Proposed:** If `indexEntry.state === 'stale'` or index is > 7 days old,
prepend:
```
⚠️ Index last updated 14 days ago — new content may not appear in results.
Run reindex_site to update.
```

---

### 7. How do fleet operations handle mixed freshness?

`fleet_health_summary`, `compare_sites`, `find_outdated_sites` operate across
multiple sites, each with different freshness levels. The current output doesn't
indicate per-site data age.

**Proposed:** Fleet tools should show per-site freshness inline:
```
cli-target      WP 7.0-RC2   PHP 8.2  (twin: 27m ago ✅)
another-site    WP 6.4.2     PHP 8.1  (twin: 3d ago ⚠️)
halted-site     WP unknown   PHP ?    (no twin data ❌)
```

---

## Implementation Priority

### Immediate (before next PR)
None — current branch is clean. These are follow-on work.

### Sprint A — Stale Data Warnings (addresses Tier 2)
1. Create `freshnessWarning(indexEntry)` shared helper
2. Add it to: `compare_sites`, `detect_drift`, `fleet_health_summary`,
   `search_site_content`, `search_across_sites`, `nexus_plugin_audit`
3. Add twin completeness + age to `nexus_list_sites` output

### Sprint B — Halted Site Fallbacks (addresses Tier 3)
1. Update `wp_plugin_list`, `wp_theme_list`, `wp_core_version` to check twin
   when site is halted
2. Update `nexus_site_audit` to use twin for the version/plugin sections,
   skip only the DB audit when halted
3. Standardise the "site halted" error message with a start hint

### Sprint C — CAPI Backup Routes (addresses Tier 4)
1. Upgrade `wpe_get_install_usage` + `wpe_get_account_usage` from in-memory
   to SQLite-backed cache (already done for installs — do same for accounts)
2. Add CAPI failure fallback to `wpe_get_installs` (serve from graph)
3. Add CAPI failure fallback to `wpe_fleet_versions` (serve from graph)

### Sprint D — Unified Site Resolution (Phase 1 of roadmap)
See `digital-twin-roadmap.md` Phase 1.

---

## Shared Code Needed

Three shared helpers would eliminate the per-tool ad-hoc patterns:

```typescript
// 1. Standard freshness warning line for any tool response
function freshnessLine(twin: SiteDigitalTwin | null, indexEntry?: IndexEntry): string | null

// 2. Decide whether twin data is fresh enough to use
function twinIsUsable(twin: SiteDigitalTwin, field: keyof SiteDigitalTwin): boolean

// 3. Build a "here's what I know, here's how old it is" header
function dataSourceHeader(twin: SiteDigitalTwin, source: 'twin' | 'index' | 'live'): string
```

These belong in `src/main/twin/SiteDigitalTwinService.ts` or a new
`src/main/twin/twin-helpers.ts`.
