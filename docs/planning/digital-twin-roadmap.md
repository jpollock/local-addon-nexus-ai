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

## Status (as of April 2026)

### ✅ Done — Infrastructure

- **StartupSiteScanner** — fires 5s after Local loads; filesystem scan all
  sites, WP-CLI enrichment for running sites (3 concurrent). Staleness guard:
  skips full scan if twin is < 4h old.
- **HaltedSiteRefreshScheduler** — 24h cron; filesystem scan for halted local
  sites whose twin is stale. Idempotent start, per-site error isolation.
- **SiteMetadataCache extended** — `scanDepth`, `installedPlugins/Themes`,
  `plugins/themes` (with status), `postCount`, `postCountByType`, `lastPostAt`,
  `mysqlVersion`, `siteUrl`, `adminEmail`, `activeTheme`.
- **GraphService `sites` table extended** — `source`, `remote_install_id`,
  `remote_domain`, `account_id`, `site_url`, `admin_email`, `active_theme`,
  `post_count` columns via ALTER TABLE migrations.
- **`site_usage` table** — WPE bandwidth/visits/storage per install per month;
  synced on startup and hourly cron.
- **`SiteDigitalTwin` + `SiteDigitalTwinService`** — pure read model assembled
  from SiteMetadataCache + IndexRegistry + GraphService; per-field provenance
  (`method`, `timestamp`, `requiresRunning`); computed `completeness` and `asOf`.
- **`getFromGraph()`** — assembles WPE-only twins from GraphService rows
  including SSH-enriched columns and plugins/themes from graph tables.

### ✅ Done — CLI / MCP Commands

- `nexus sites status <site>` — twin completeness + freshness report
- `nexus sites refresh <site>` — on-demand rescan (local WP-CLI or WPE SSH,
  auto-detected by checking sites list)
- `nexus fleet refresh` — filesystem + WP-CLI rescan for all local sites
- `nexus fleet refresh --deep [--local-only|--wpe-only] [--concurrency N]` —
  full WP-CLI for all sites; local: start/scan/stop; WPE: 7 SSH calls parallel
  per site, bounded concurrency across sites
- MCP tools: `nexus_site_status`, `nexus_site_refresh`, `nexus_fleet_refresh`,
  `nexus_get_site_twin`, `nexus_get_fleet_twins`
- `nexusWpeSiteDeepRefresh` resolver — SSH WP-CLI for plugins, themes, WP
  version, site URL, admin email, active theme, post count; persists to graph

### ✅ Done — Sprints A–D + Phases 2.1–2.2 + Phase 3.2

- **Sprint A** — stale data warnings on fleet/content tools
- **Sprint B** — halted site fallbacks in `wp_plugin_list`, `wp_theme_list`,
  `wp_core_version` (serve from twin when site is halted)
- **Sprint C** — CAPI backup routes for WPE usage tools
- **Sprint D** — unified site resolution: `nexus sites get mysite` works without
  `@local`; plain names resolve local-first then WPE graph; `siteKind` field
  added to `SiteDetails` GraphQL type
- **Phase 2.1** — `freshnessFooter(twin)` shared helper; adopted in
  `get_site_structure`, `nexus_get_site_twin`, `wp_plugin_list`,
  `wp_theme_list`, `wp_core_version`
- **Phase 2.2** — `canAnswer(twin, field)` on `SiteDigitalTwinService`;
  returns `{ can, confidence, reason }` based on field age and provenance;
  19 unit tests covering all branches
- **Phase 3.2** — `HaltedSiteRefreshScheduler` background cron

---

## What's Next

### Phase 2.3 — `canAnswer()` adoption in tools _(not started)_

Tools that read twin data should call `canAnswer()` before answering, and
surface `confidence: 'stale'` reason to the user rather than presenting old
data as current. Target tools: `get_site_structure`, `nexus_site_audit`,
fleet tools.

### Phase 3.3 — Incremental lifecycle enrichment _(not started)_

The `siteStarted` lifecycle hook runs a full WP-CLI enrichment on every start,
even if the twin is fresh from 2 minutes ago. Add a staleness check: skip full
WP-CLI if twin is < N minutes old. Speeds up site start for active sites.

### Phase 3.4 — WPE usage in `nexus sites get` _(not started)_

Surface `site_usage` data (bandwidth/visits/storage) in `nexus sites get` for
WPE-linked local sites, and in `nexus wpe installs` as a standard column.

### Phase 4 — Twin-Driven Fleet Intelligence _(not started)_

```bash
nexus fleet summary          # WP version dist, PHP dist, stale twins, post activity
nexus fleet plugins          # all plugins across fleet
nexus fleet plugins --search woocommerce
nexus fleet plugins --active-on 3+
```
All answered from cached twin data — no live WP-CLI, no CAPI calls.

### Phase 5 — WPE ↔ Local Twin Parity _(partially started)_

**Done:** WPE twins assembled from graph; SSH deep refresh populates full
plugin/theme/content data parity with local twins.

**Not done:**
- `nexus sites list` unified — show local + WPE in one list with twin completeness
- `nexus sites compare mysite@local mysite@production` — diff two twins
- Scheduled SSH refresh for WPE sites (currently manual only)
- WPE PHP version from SSH (currently CAPI only)
- Post counts and MySQL version for WPE via SSH (partially done — post_count
  yes, mysqlVersion not yet)

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

6. **No @local required.** The target syntax is a power-user override, not the
   default. Plain site names just work.
