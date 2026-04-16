# Digital Twin Roadmap

## Vision

Every site Nexus knows about — local or WPE — has a "digital twin": a cached,
freshness-aware snapshot of everything we know about it. Nexus answers questions
from the twin wherever possible, tells the user when data is stale or missing,
and offers clear paths to refresh it. The twin is the single unified data source
for all CLI commands, MCP tools, and UI panels.

No more `@local` vs `@production` confusion. No more "site not found" on halted
sites. No more "I don't know" when the answer is already cached from the last
time the site was running.

---

## What's Done (sync-cache-data branch, ~Apr 2026)

### Infrastructure
- **StartupSiteScanner** — fires 5s after Local loads; populates `SiteMetadataCache`
  for every site (halted or running) via filesystem reads, then enriches running
  sites with WP-CLI (plugins, themes, post counts, MySQL, site URL, admin email)
- **`SiteMetadataCache` extended** — `scanDepth`, `installedPlugins`,
  `installedThemes`, `postCount`, `postCountByType`, `lastPostAt`, `mysqlVersion`,
  `siteUrl`, `adminEmail` fields added; all writes preserve filesystem-sourced
  fields so phpVersion is never dropped by a lifecycle overwrite
- **`site_usage` table** — SQLite migration; WPE bandwidth/visits/storage
  persisted per install per month; synced on startup and hourly cron
- **`SiteDigitalTwin` + `SiteDigitalTwinService`** — pure read model assembled
  from SiteMetadataCache + IndexRegistry + GraphService; per-field provenance
  (`method`, `timestamp`, `requiresRunning`); computed `completeness` and `asOf`

### CLI / MCP commands added
- `nexus sites status <site>` — twin completeness + freshness report
- `nexus sites refresh <site>` — on-demand twin rescan (filesystem + WP-CLI)
- `nexus fleet refresh` — rescan all sites
- MCP tools: `nexus_site_status`, `nexus_site_refresh`, `nexus_fleet_refresh`,
  `nexus_get_site_twin`, `nexus_get_fleet_twins`

### Tool migrations (Step 5, partial)
- `get_site_structure` — now reads twin first; adds MySQL, site URL, post counts,
  freshness banner; falls back gracefully for halted/unindexed sites
- `nexus sites get` — enriched with twin data (MySQL, site URL, admin email,
  plugin counts, post counts, twin age)

---

## What's Immediately Ahead

### 1. Merge sync-cache-data to main
All work above is on the `sync-cache-data` branch. PR, review, merge.

### 2. Complete Step 5 — migrate remaining high-value tools to twin

The tools below still read raw stores directly. Migrating them means consistent
freshness handling and access to fields they currently miss.

| Tool / Command | Currently reads | Twin benefit |
|---|---|---|
| `nexus_site_audit` (composite) | 5 parallel MCP calls assembled ad-hoc | Twin pre-assembles; adds MySQL, post counts, freshness |
| `list_indexed_sites` | IndexRegistry only | Add completeness + metadata alongside index state |
| `find_outdated_sites` | GraphService SQL + IndexRegistry | Use twin WP/PHP version fields directly |
| `fleet_health` | GraphService + HealthCalculator | Twin provides richer per-site context |
| `nexus fleet health` CLI | Same as above | Consistent with twin completeness |
| `nexusSitesList` resolver | siteData only | Add twin fields to fleet list |

---

## Phase 1 — Unified Site Resolution (No More @local)

**Goal:** `nexus sites get mysite` works for any site — local or WPE —  
without the user needing to know where it lives.

### 1.1 Unified target resolver

Today `parseTarget()` enforces `@local` / `@environment` syntax and
`nexus sites get` rejects non-local targets. Replace this with a unified
resolver that:

1. Tries to match against local sites by name/domain/ID
2. If no local match, tries WPE graph (`sites` table, `source='wpe'`)
3. Disambiguates only when truly ambiguous (same name in both)

The `@local` and `@production` suffixes remain valid as explicit overrides,
but should never be *required*.

### 1.2 WPE twin population

WPE sites already have entries in the `sites` graph table from CAPI sync.
The twin service currently returns `null` for WPE sites because
`siteData.getSite()` only knows about local sites.

Extend `SiteDigitalTwinService.get()` to also assemble WPE twins from:
- `GraphService.getSite()` — name, domain, WP/PHP version, account
- `GraphService.getPlugins()` / `getThemes()` — from SSH sync
- `GraphService.getSiteUsage()` — bandwidth/visits/storage

This makes `nexus sites get mysite@production` work and return real data.

### 1.3 `nexus sites get` handles both

Once 1.1 and 1.2 are in place, `nexus sites get` resolves against the unified
target resolver and returns a twin-backed response for both local and WPE.

---

## Phase 2 — Twin Completeness as a First-Class Signal

**Goal:** Every MCP tool and CLI response tells the user how confident
it is in its answer.

### 2.1 Standard freshness footer in all tool responses

Every MCP tool that reads site data should append a one-line freshness note:

```
_Data: WP-CLI scan · 27m ago · nexus sites refresh cli-target to update_
```

Define a shared `freshnessFooter(twin)` helper in the twin service and
adopt it across all migrated tools.

### 2.2 `canAnswer(twin, question)` helper

Tools often need to decide whether they can answer a question or should
prompt for a refresh first. Add a method to `SiteDigitalTwinService`:

```typescript
canAnswer(twin: SiteDigitalTwin, field: keyof SiteDigitalTwin): {
  can: boolean;
  reason?: string;   // "site is halted — start it and refresh"
  confidence: 'high' | 'medium' | 'stale';
}
```

Use it in `get_site_structure`, `nexus_site_audit`, and fleet tools.

### 2.3 `nexus_get_fleet_twins` completeness filter in CLI

```bash
nexus fleet twins                  # all sites, sorted by completeness
nexus fleet twins --stale          # sites with data older than 24h
nexus fleet twins --incomplete     # sites missing full WP-CLI scan
```

---

## Phase 3 — Automatic Twin Maintenance

**Goal:** The twin stays fresh without the user thinking about it.

### 3.1 Refresh on demand from CLI / MCP

Already built. `nexus sites refresh` and `nexus fleet refresh` exist.

### 3.2 Scheduled refresh for halted sites

Currently the startup scanner fires once. Add a scheduled re-scan that runs:
- At Local startup (done ✅)
- Every N hours (configurable, default 24h) for sites that haven't been
  started and thus missed the lifecycle hook enrichment
- When the user explicitly calls `nexus fleet refresh`

Halted sites can always get at least a filesystem scan (WP version, installed
plugins/themes) without starting. This keeps the twin from going completely stale.

### 3.3 Incremental site-start enrichment

The `siteStarted` lifecycle hook runs a full WP-CLI enrichment. Currently this
runs every time a site starts, even if the twin is fresh from 2 minutes ago.

Add a staleness check: skip the full WP-CLI enrichment if the twin is less than
N minutes old. This speeds up site start for heavily-used sites.

### 3.4 Usage data refresh

WPE usage (bandwidth/visits/storage) is already synced hourly from CAPI.
Surface this in `nexus sites get` for WPE-linked local sites and in
`nexus wpe installs` as a standard column.

---

## Phase 4 — Twin-Driven Fleet Intelligence

**Goal:** Answer fleet-wide questions from the twin without live calls.

### 4.1 Fleet summary from twins

```bash
nexus fleet summary
```

Reports across all sites:
- WordPress version distribution (how many on 7.0, 6.x, etc.)
- PHP version distribution
- Sites with stale twins (need refresh)
- Sites never indexed
- Sites with post activity in last 30 days

All answered from cached twin data — no live WP-CLI, no CAPI calls.

### 4.2 Cross-site plugin analysis

```bash
nexus fleet plugins                        # all plugins across all sites
nexus fleet plugins --active-on 3+         # plugins active on 3+ sites
nexus fleet plugins --outdated             # plugins with available updates (when twin has version data)
nexus fleet plugins --search woocommerce   # find woocommerce across fleet
```

Currently possible via graph, but not surfaced as a CLI command. Twin makes
this more accessible because plugin data is always fresh from last site start.

### 4.3 Bulk refresh for fleet maintenance

```bash
nexus fleet refresh --stale        # refresh only sites with data > 24h old
nexus fleet refresh --halted       # filesystem scan for halted sites only
nexus fleet refresh --running      # full WP-CLI scan for running sites
```

---

## Phase 5 — WPE ↔ Local Twin Parity

**Goal:** WPE sites and local sites are equally first-class in every command.

### 5.1 WPE site twin fully populated

Today WPE sites get limited twin data (CAPI fields only). After SSH sync they
get plugins/themes. Extend to also capture:
- Post counts (from SSH WP-CLI during sync)
- MySQL version (from SSH WP-CLI during sync)
- Site URL (already in CAPI data)

### 5.2 `nexus sites list` unified

```bash
nexus sites list                   # all local + WPE sites
nexus sites list --local           # local only
nexus sites list --wpe             # WPE only
nexus sites list --running         # local running sites
```

Returns twin completeness alongside each site. Today `nexus sites list`
only shows local sites; WPE sites require `nexus wpe installs`.

### 5.3 Cross-environment commands

```bash
nexus sites compare mysite@local mysite@production
```

Diff two twins: same plugin versions? Same WP version? Post count drift?

---

## Guiding Principles

1. **Twin is the read interface.** MCP tools and CLI commands read from the twin,
   not from raw stores. If a store changes underneath, only the twin assembly
   changes.

2. **Completeness transparency.** Every response that uses twin data includes a
   freshness signal. Never present stale data as current without saying so.

3. **Graceful degradation over silence.** A halted site with a 2-day-old twin
   is better than "no data". Surface what we have, label it clearly.

4. **Seeding is idempotent.** Any refresh operation is safe to run multiple times.
   Fails on individual sites don't abort the fleet.

5. **Bulk and individual parity.** Anything doable for one site is doable for all.
   No fleet-only or single-site-only capabilities.

6. **No @local required.** The target syntax is a power-user override, not the
   default. Plain site names should just work.

---

## Open Questions

- **Twin TTL policy:** How long before a twin is considered "too stale to use"
  vs "usable but flagged"? Current threshold is 24h for stale flag. Should this
  be configurable per-site or per-field?

- **WPE twin write path:** WPE twins are currently populated only during SSH sync
  (slow, infrequent). Should CAPI-only sync (fast, hourly) produce a partial twin
  that's clearly marked as `completeness: 'capi'`?

- **IndexRegistry vs twin overlap:** `SiteStructure` in IndexRegistry has richer
  structural fields (REST API, custom tables, user roles, health) that the twin
  doesn't collect. Should these be migrated into the twin, or should the twin
  always supplement from IndexRegistry for these fields?

- **Conflict resolution:** When twin data and IndexRegistry structure disagree
  on WP version (e.g., twin is fresher), the twin wins. Is this always right?
  Should there be a merge strategy?
