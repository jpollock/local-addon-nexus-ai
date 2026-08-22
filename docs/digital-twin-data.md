# Nexus AI — Data Reference

**What Nexus collects, when, how, why, and what it cannot see.**

One place for the whole collection surface. This document was scoped to the
digital twin until 2026-08-22 (WP-65); it now covers every store, because the
twin is one read model over six of them and describing it alone answered
roughly a fifth of the question.

**What this is not.** It is not the design of the intelligence layer — that is
`docs/intelligence/architecture.md`, and §4 there stays the authority on the
event envelope and the taxonomy's *intent*. It is not user-facing copy — that
is `docs/intelligence/user-docs/`. It is not a fix for anything it finds; §6
files limits, it does not close them.

---

## 0. Where else to look, and what those documents already cover

Four documents held pieces of this before WP-65. Two are **linked, not
absorbed**, because they answer WHEN and HOW for the L1/L2/L3 ladder in more
detail than belongs here — with the caveats below, which are the reason they
could not simply be pointed at and left alone.

| document | what it covers | still true? |
|---|---|---|
| `docs/architecture/data-levels.html` (2026-07-28) | The L1 Scanned / L2 Configured / L3 Searchable ladder, per level, for Local **and** WPE: source, what, when, controlled-by, stored-in, seen-in-UI, and a "should be" column. The best per-level WHEN/HOW material in the repo. | **Mostly. Three rows are stale:** it says WPE L3 is "manual only — no scheduler" (a WPE content-index timer now exists, `index.ts:600`), it predates external SSH hosts entirely (no L1/L2/L3 row for them), and its fleet figures ("284 installs") are a July snapshot. |
| `docs/architecture/data-gaps-design.html` (2026-07-28) | A 14-gap inventory (G1–G14) with design proposals, phases and effort. Explains *why* WPE defaults are off, and why `wp_version` for WPE comes from SSH rather than CAPI (G10). | **It is a proposal, not a description.** Every row carries a status; G1–G5 are fixed, G6–G14 were open at the time of writing and have not all been re-checked. Read it for rationale, never as a statement of what the system does. |
| `docs/intelligence/architecture.md` §3A | The stores as built, with every figure verified — cited throughout §1 below rather than re-derived. | Yes (2026-08-18, figures 2026-08-22). |
| `docs/intelligence/architecture.md` §4 | The event envelope, the topic taxonomy, retention and compaction — design level. | Yes as *design*. §5 below reconciles it against what the code emits. |

Also relevant, and deliberately not duplicated:
`docs/intelligence/user-docs/what-you-see-today.md` (why answers show data age,
what a live check is, where information is kept — written for the person using
the product) and `your-copy-and-the-live-site.md` (the working-copy model).
This document's audience is someone building on or auditing the collection
surface, not someone using it.

---

## 1. WHAT — the stores

### 1.1 The seven stores

Structure and figures from `architecture.md` §3A.1, which verified each against
source and measured the rest on one machine 2026-08-22 — **cited, not
re-derived**. Fleet counts describe that data, not the system.

| # | store | on disk | holds | why it exists (§4) |
|---|---|---|---|---|
| 1 | `SiteMetadataCache` | `nexus-ai_site_metadata.json` (Local userData) | Per **local** site: versions, plugin/theme lists, post counts, site URL — §1.2 | "What is on this machine, without starting it" |
| 2 | `graph.db` | `nexus-ai/graph.db` — SQLite, 22 tables | The fleet register: `sites`, `plugins`, `themes`, `content`, `site_usage`, `site_links`, `agent_runs`, `event_queue`, … — §1.3 | "Which sites exist, and what is installed on them" |
| 3 | `ledger.db` — events | `nexus-ai/ledger.db`, append-only `events` | Every provenance-stamped observation. 16 topics with rows — §5 | "How do we know that, and when was it true" |
| 4 | `ledger.db` — entity graph | same file: `entities`, `entity_aliases`, `entity_links` | 604 `site` + 421 `env` entities, 6 alias namespaces, 3 link kinds — §1.5 | "Which of these rows are the same thing" |
| 5 | `ledger.db` — `twin_facts` | same file | The folded current value of each fact. **A materialized view, rebuildable, never authoritative** | "What is true now, with a pointer to the event that says so" |
| 6 | `vectors.db` | `nexus-ai/vectors.db` — SqliteVecStore, 264 site corpora | 384-dim ONNX embeddings of post content, one table per site | "Which site says something about X" |
| 7 | index registry | `nexus-ai_index_registry.json` (+ a `_backup` twin) | Per-site index state, counts, timestamps, and `structure` — §1.7. **One JSON key in Local's userData, not a database** | "Has this site been indexed, how completely, and when" |

Two things that look like stores and are not: `nexus-ai/vectors/` (the dead
LanceDB directory) and a zero-byte `nexus-ai/registry.db`. One that is a store
but has no instance on this fleet: `agents/<name>/*.sqlite` (`AgentDbManager`).

Nexus also **reads and writes Local's own record**, `sites.json` — 45 entries,
20 with `hostConnections`. Seven call sites write it through
`siteData.updateSite`; three write `hostConnections` itself. It is Local's
store, but Nexus is a writer to it, not only a reader.

Durable log files (`operation-audit.log`, `audit.log`,
`nexus-YYYY-MM-DD.log`, `agents/*.log`) are a fifth family. They are the
compliance and diagnostic record, governed by `CLAUDE.md`'s "Logging & Audit"
section, and are out of scope here except as a limit (§6).

### 1.2 SiteMetadataCache

Per **local** site. Assembled by `StartupSiteScanner` and lifecycle hooks.

| Field | Type | Source | Requires running site? |
|---|---|---|---|
| `wpVersion` | string | Filesystem (`wp-includes/version.php`) | No |
| `phpVersion` | string | Local site object | No |
| `installedPlugins` | string[] | Filesystem (`wp-content/plugins/` dirs) | No |
| `installedThemes` | string[] | Filesystem (`wp-content/themes/` dirs) | No |
| `plugins` | Plugin[] (name, version, status, file) | WP-CLI `plugin list` | Yes |
| `themes` | Theme[] (name, version, status) | WP-CLI `theme list` | Yes |
| `activeTheme` | string | WP-CLI `option get stylesheet` | Yes |
| `siteUrl` | string | WP-CLI `option get siteurl` | Yes |
| `adminEmail` | string | WP-CLI `option get admin_email` | Yes |
| `postCount` | number | WP-CLI `post list --format=count` | Yes |
| `postCountByType` | Record\<string, number\> | WP-CLI `post list` per type | Yes |
| `lastPostAt` | timestamp | WP-CLI most recent post date | Yes |
| `mysqlVersion` | string | WP-CLI `eval echo $wpdb->db_version()` | Yes |
| `scanDepth` | `filesystem` \| `full` | Internal | — |
| `lastUpdated` | timestamp | Internal | — |

The `scanDepth` split is the L1/L2 boundary of `data-levels.html`:
`filesystem` is everything above marked "No", `full` adds the rest.

### 1.3 graph.db

**`sites`** — per local, WPE **and external SSH** site. (This table used to be
described as local+WPE only; `source` is `'local' | 'wpe' | 'external'`, and a
fleet query that omits the third is the bug `CLAUDE.md`'s "Fleet means local +
WPE + SSH" rule exists to prevent.)

| Column | Source |
|---|---|
| `id`, `name`, `domain` | Local site object / CAPI / `nexus host add` |
| `wp_version`, `php_version` | CAPI (WPE) or Local site object or SSH `wp --info` (external) |
| `source` | `local`, `wpe` or `external` |
| `remote_install_id` | CAPI install UUID |
| `remote_domain` | CAPI primary domain |
| `account_id` | CAPI account UUID — **also** the external connection→site grouping |
| `environment` | Registered label, external hosts (a write gate — see `CLAUDE.md`) |
| `is_active` | `0` after `nexus host remove`; **every external lookup must filter on it** |
| `last_sync_at` | Updated on any sync |
| `content_indexed_at` | Added at runtime by `ExternalContentIndexScheduler` |
| `site_url` | **SSH WP-CLI** `option get siteurl` |
| `admin_email` | **SSH WP-CLI** `option get admin_email` |
| `active_theme` | **SSH WP-CLI** `option get stylesheet` |
| `post_count` | **SSH WP-CLI** `post list --format=count` |

The four SSH-enriched columns are only populated after a deep refresh
(`nexus sites refresh <wpe-install>`, `nexus fleet refresh --deep`, or
`nexus host refresh <alias>` for external).

**`plugins` / `themes`** — per site. Columns: `site_id`, `slug`, `name`,
`version`, `is_active`, `author`.

- **Local sites**: WordPress event webhooks (plugin installed/activated events)
- **WPE sites**: SSH deep refresh (`wp plugin list`, `wp theme list`)
- **External hosts**: `ExternalRefreshScheduler` / `nexus host refresh`

**`site_usage`** — WPE bandwidth, visits, storage. One row per
`(site_id, period, source)`; `period` is a `YYYY-MM` string; values from CAPI;
`recorded_at` is when fetched.

**`content`** — per-post rows for indexed sites, keyed by the real site id
(including the full `ssh:<alias>/<site>` form). The vector table name is a
*sanitized* translation of that id (`vectorSiteId()`); the graph keeps the real
one.

### 1.4 ledger.db — events

An append-only `events` table of envelopes. The envelope shape is
`architecture.md` §4.1; the load-bearing part for this document is that every
row carries **`observed_at` (when the fact was true at its source)** separately
from **`recorded_at` (when we wrote it down)**, plus a `source.trust` enum and
an `actor`. Freshness is computed from `observed_at`. Nothing may stamp "now"
on old data.

Nothing writes `events` or `twin_facts` directly — events enter through
`Emitter.emit`, twin facts through fold workers only.

The topics actually emitted are enumerated and reconciled in **§5**.

### 1.5 ledger.db — the entity graph

`entities` (types `site` and `env`), `entity_aliases` (six namespaces:
`local.site_id`, `graph.site_row`, `wpe.install_id`, `wpe.install_name`,
`local.site_id.logical`, `wpe.site_id`) and `entity_links` (three kinds written:
`has_environment`, `has_working_copy`, `content_pulled_from`).

**Who gets a Site entity** (`architecture.md` §3A.3): every WPE install (365 of
365); **no** external host (0 of 3); and a local site **only if it has a host
connection** (20 of 42). A purely local site — the most common kind — has no
Site entity by construction. See §6.

### 1.6 vectors.db

384-dimension ONNX embeddings, one sqlite-vec table per site corpus, 264
corpora. Readers translate the site id through `vectorSiteId()`; writers do
not, so identity for already-legal ids is load-bearing.

### 1.7 The index registry

One JSON key in Local's userData plus a `_backup` twin. Per entry: index
`state`, document and chunk counts, timestamps, an `ExtractionCoverage` record
(WP-62), and `structure` (custom tables, REST namespaces, users/roles).

Measured 2026-08-22: **636 entries — 323 local-shaped, 307 `wpe-*`, 6 `ssh:`**.
All 313 remote entries carry `structure: null` and **no coverage record**; see
§6.

### 1.8 The Assembled Twin

`SiteDigitalTwinService` merges stores 1–2 and 7 into a single `SiteDigitalTwin`
on demand. Nothing writes to it — it is a pure read model, and it predates the
ledger. (`twin_facts`, store 5, is a *different* thing with a confusingly
similar name: it is folded from events and is the intelligence layer's view.)

Every field carries a **provenance record**:
```typescript
sources['plugins'] = { method: 'wp-cli', timestamp: 1713000000000, requiresRunning: true }
```

Two computed properties summarise overall data quality:

| Property | Values | Meaning |
|---|---|---|
| `completeness` | `none` / `filesystem` / `metadata` / `indexed` | How much we know |
| `asOf` | Unix ms | Age of the oldest populated field (weakest link) |

For WPE-only sites (not in Local), `getFromGraph()` assembles the twin entirely
from `graph.db` rows including the SSH-enriched columns.

---

## 2. WHEN — the three kinds of trigger

Every producer belongs to exactly one of these three. **If a site's data looks
old, the answer is in this section**: find the store, find its trigger, check
whether the trigger is on.

### 2.1 Scheduled

**Five of the eight collection schedules are OFF by default.** That is
deliberate (`data-gaps-design.html` §1: "CAPI calls are cheap and always-on;
SSH is expensive and opt-in"), and it is the single most common reason a
remote site's data is empty rather than stale.

| what runs | interval | setting | default | code |
|---|---|---|---|---|
| Startup filesystem scan of all local sites (+ WP-CLI for running ones, 3 concurrent) | once, +5s | — | **always** | `StartupSiteScanner` |
| CAPI sync — install list, domain, `php_version`, account; then usage data | startup +10s, then **hourly** | — | **always** (needs a WPE token) | `index.ts:1383` |
| Halted-site refresh — filesystem scan for halted local sites with stale twins | `haltedSiteRefreshIntervalHours` (24h) | — | **always** | `HaltedSiteRefreshScheduler` |
| Local content index (L3) — bulk reindex, auto-start/stop halted sites | `localContentIndexIntervalHours` (8h) | `localContentIndexAutoEnabled` | **off** | `OpportunisticScheduler` |
| WPE SSH metadata refresh (L2) | `wpeRefreshIntervalHours` (24h) | `wpeRefreshAutoEnabled` | **off** | `WpeRefreshScheduler` |
| WPE content index (L3, piggybacks L2) | `wpeContentIndexIntervalHours` (24h) | `wpeContentIndexAutoEnabled` | **off** | `index.ts:600` |
| External SSH host refresh (L1+L2) | `externalRefreshIntervalHours` (24h) | `externalRefreshAutoEnabled` | **off** | `ExternalRefreshScheduler` |
| External SSH content index (L3) | `externalContentIndexIntervalHours` (24h) | `externalContentIndexAutoEnabled` | **off** | `ExternalContentIndexScheduler` |

Housekeeping timers on the same clock, which move no data in but bound what is
kept: audit-log flush (5m, `index.ts:287`), `graph.db` WAL checkpoint (5m,
`:289`), log retention sweep (24h, `:874`), database retention sweep (24h,
`:894`, prunes terminal `event_queue` rows and hard-deletes sites inactive for
30 days), telemetry health check (1h, `:1406`).

Agent schedules are a separate mechanism entirely: cron expressions resolved by
`resolveAgentCron`, manifest by default, overridden by an explicitly-picked
cadence. See `CLAUDE.md`, "Agent schedules".

**A settings-driven scheduler is only reactive if it is wired into
`onSettingsUpdated`** (`index.ts`, grep for `const onSettingsUpdated =`). All
six restartable schedulers are. A new one that is not will silently require a
Local restart.

### 2.2 Event-driven

| trigger | what collects | into |
|---|---|---|
| `siteStarted` lifecycle hook | Full WP-CLI scan (L2) of that local site | `SiteMetadataCache`, and the L3 index if auto-index is on |
| WordPress MU-plugin webhook → `HttpEventInterface` | Plugin/theme/user/content change events | `graph.db.event_queue`, then `plugins`/`themes` rows and `semantic.content.changed` / `state.*.observed` ledger events (`wpEventProducer.ts`) |
| Any `GraphService` write | A mirrored observation | `ledger.db` via `graphServiceTap.ts` — **deduped through the change gate**, so repetition does not enter the ledger |
| A fold detecting a changed fact | `state.drift.detected` | `ledger.db` (`bootstrap.ts:229`) |
| A gated Tier 2/3 tool call completing | `task.action.executed` + `task.outcome.recorded` | `ledger.db` (`actionProducer.ts`) and `operation-audit.log` |

The MU-plugin webhook exists **only on Local sites**. Nothing equivalent runs
on a WPE install or an external host, which is why `event_queue` is empty of
remote rows and why `semantic.content.changed` is structurally local-only (§6).

### 2.3 User- or agent-initiated

| command / tool | what it collects |
|---|---|
| `nexus sites refresh <target>` | Local: WP-CLI scan. WPE: SSH WP-CLI calls in parallel |
| `nexus sites status <target>` | Nothing — reports per-field freshness |
| `nexus fleet refresh` | Filesystem scan + WP-CLI for running local sites |
| `nexus fleet refresh --deep [--local-only\|--wpe-only] [--concurrency N]` | Local: start→WP-CLI→stop. WPE: SSH WP-CLI. Worker pool, default concurrency 3 |
| `nexus content index <target>` / `reindex` | L3 content extraction + embeddings |
| `nexus host add <alias>` | Probe: discovers every WordPress root, `wp_path`, `wp_cli_path`; registers the picked sites |
| `nexus host refresh <alias>` | External L1+L2 in four batched SSH round trips, regardless of the setting |
| `nexus host index <alias>` | External L3, regardless of the setting |
| MCP `nexus_site_refresh`, `reindex_site`, `bulk_reindex`, `verify_site_live`, `wpe_site_deep_refresh` | The same collection paths, reachable by an agent |
| Operations tab → Refresh metadata / ⚡ Index | The renderer's equivalents |

`verify_site_live` is the only one that is *also* a producer of live
observations back into the ledger (`state.plugin.observed` /
`state.plugin.removed`).

### 2.4 "Why does this site's data look old?"

1. **Is it a remote site with no data at all?** Then it is not stale — nothing
   ever collected it. Five of eight schedules are off by default (§2.1). Check
   `wpeRefreshAutoEnabled` / `externalRefreshAutoEnabled`.
2. **Is it a halted local site?** L1 refreshes every 24h; **L2 does not refresh
   at all** for a halted site — though a bulk or scheduled run now starts it
   first (§2.5) — `plugins`, `activeTheme`, `postCount` and
   `mysqlVersion` are frozen at the last time it ran. This is `data-gaps-design.html`
   G12, still open.
3. **Is it a WPE install missing `wp_version`?** CAPI's `listInstalls` does not
   return it; only SSH L2 does (G10). Not a bug, and not fixable by waiting.
4. **Is background work paused?** `isBackgroundWorkPaused()` stops every
   scheduler at once.
5. **Did a batch time out?** External refresh batches log how many sections
   were lost; the missing fields are written NULL, never defaulted.
6. **Nothing reports coldness on its own.** See §6 — there is no "these facts
   have gone stale" surface, so age has to be asked for.

---

### 2.5 Halted local sites — bulk operations start them

**Ruled 2026-08-22 by the owner.** A bulk operation that reaches a halted
Local site **starts it, collects, and stops it again.** "Index content" on
45 stopped sites means 45 sites started, indexed and stopped — not 45 rows
saying *did not run*. The same holds for a scheduled run and for a
single-site action.

This is `autoStartStop`, and it is wired end to end in
`BulkOperationManager`: `executeSingle` starts a halted site,
`waitForDatabaseReady` gives MySQL 30 seconds, and the `finally` block
stops **only** the sites it started. A site the user already had running
is left running.

| caller | autoStartStop |
|---|---|
| `OpportunisticScheduler` — scheduled local index | **on** — always has been |
| Operations / Sites tab bulk bar | **on** (WP-68; previously sent `options: {}`) |
| single-site index from a site's own page | **on** |
| MCP `bulk_reindex` / `reindex_site` | **on** |

**Bounded, not free.** `MAX_CONCURRENCY = 5`, so at most five sites run at
once and each is stopped before the next takes its slot. A fleet-wide
index is slow by design: the cost of starting a site is the floor on how
fast this can go. That is a duration to state, never a reason to skip.

**A site that fails to start is `failed`, not `did not run`.** WP-67's
distinction survives — *did not run* means nobody attempted the work, and
with auto-start on, a halted site is always attempted.

---

## 3. HOW — five collection methods, and what each cannot do

| method | reaches | fills | cannot |
|---|---|---|---|
| **Filesystem scan** | Local sites only | `SiteMetadataCache` L1; index-registry `structure` | See anything in the database — no active-plugin status, no post counts |
| **WP-CLI (local)** | Local sites, **running only** | `SiteMetadataCache` L2; `graph.db` `plugins`/`themes` | Run against a halted site without starting it |
| **WP-CLI over SSH** | WPE installs, external hosts | `graph.db` SSH columns, `plugins`, `themes`, `php_version`; L3 post extraction | Escape `isOperationAllowed` (`wpcli_read` everywhere; `wpcli`/`push` refused on production; `delete` refused everywhere). External SSH has **no `ControlMaster`** deliberately, so commands are batched, and a batch's exit code is its last sub-command's — nothing may gate on it |
| **WP Engine CAPI** | WPE installs | `graph.db` install list, domain, `php_version`, account, `site_usage` | Return `wp_version` from `listInstalls`; reach a non-WPE host at all |
| **Direct MySQL** | Local sites, running | L3 content extraction: posts, ACF fields, media metadata, WooCommerce | Reach any remote site — remote L3 goes through `wp post list --format=json` over SSH instead, which is why the two paths have different coverage |
| **Local's own IPC / service bridge** | Local sites | Site list, status, PHP version, paths, `hostConnections` | Say anything about a site Local does not know about |

Which store each method fills:

- `SiteMetadataCache` ← filesystem, WP-CLI (local), Local IPC
- `graph.db` ← CAPI, SSH WP-CLI, WordPress webhooks, Local IPC
- `vectors.db` + index registry ← direct MySQL (local), SSH `wp post list` (remote)
- `ledger.db` ← **none directly.** Every event is derived from one of the above,
  through a producer. The ledger observes the collectors; it does not collect.

---

## 4. WHY — one sentence per store

| store | the question it exists to answer |
|---|---|
| `SiteMetadataCache` | "What is on this machine, and can I answer without starting the site?" |
| `graph.db` | "Which sites exist across all three sources, and what is installed on each?" |
| `ledger.db` events | "How do we know that, who observed it, and when was it true?" |
| entity graph | "Which of these rows — a Local site, a WPE install, an SSH host — are the same web property?" |
| `twin_facts` | "What is the current value of this fact, with a pointer to the event that established it?" |
| `vectors.db` | "Which site says something about X?" |
| index registry | "Has this site been indexed, how completely, and when?" |
| `sites.json` (Local's) | "What does Local itself believe about this site, including which remote it is connected to?" |

No store on this list lacks a question. The one field that does is
`sites.json`'s `remoteSiteEnv` — written by Local, written by Nexus, and read
by nothing (§6).

---

## 5. The event topics — the documented set, reconciled

`architecture.md` §4.2 describes the taxonomy the layer was **designed** with.
This table is what the code **does**, hand-maintained, and pinned to source by
`tests/unit/docs/documented-topics.test.ts` — which fails when the two
diverge in either direction. Measured 2026-08-22.

**18 topics are emitted. 9 more are named by §4.2 and have no producer.**

### 5.1 Topics the code emits

| topic | producer | what it records |
|---|---|---|
| `state.site.observed` | `src/main/intelligence-host/graphServiceTap.ts` | A site row was written or a site initialized |
| `state.plugin.observed` | `src/main/intelligence-host/graphServiceTap.ts` | A plugin's slug/version/active state, as seen |
| `state.plugin.removed` | `src/main/mcp/modules/fleet/verify-site-live.ts` | A cached plugin was absent on a live re-check |
| `state.theme.observed` | `src/main/intelligence-host/graphServiceTap.ts` | A theme's slug/version/active state |
| `state.user.observed` | `src/main/intelligence-host/wpEventProducer.ts` | A WordPress user/role change, via the MU-plugin webhook |
| `state.drift.detected` | `src/main/intelligence-host/bootstrap.ts` | A fold found an incoming observation disagreeing with the current fact |
| `semantic.content.changed` | `src/main/intelligence-host/wpEventProducer.ts` | Post content changed on a Local site |
| `episodic.sync.pulled` | `src/main/intelligence-host/syncProducer.ts` | A pull from a remote environment into a working copy |
| `episodic.sync.pushed` | `src/main/intelligence-host/syncProducer.ts` | A push from a working copy to a remote environment |
| `episodic.incident.recorded` | `src/main/intelligence-host/incidentProducer.ts` | A security-sentinel or outcome-derived incident |
| `episodic.agent_run.failed` | `src/main/intelligence-host/agentFailureProducer.ts` | An agent run that failed |
| `task.context.assembled` | `src/main/intelligence-host/chatAssembly.ts` | The assembly manifest for one task moment |
| `task.action.executed` | `src/main/intelligence-host/actionProducer.ts` | One gated Tier 2/3 tool call that ran |
| `task.outcome.recorded` | `src/main/intelligence-host/actionProducer.ts` | That call's result, one event per resolved target |
| `task.rationale.recorded` | `src/main/intelligence-host/actionProducer.ts` | The human's approval decision |
| `task.run.completed` | `src/main/intelligence-host/incidentProducer.ts` | A completed scan run |
| `control.grant.issued` | `src/main/intelligence-host/capabilityGrants.ts` | A capability grant was announced |
| `control.grant.revoked` | `src/main/intelligence-host/capabilityGrants.ts` | A capability grant was withdrawn |

### 5.2 Topics §4.2 names and nothing emits

Each is a real design commitment with no producer. **The check treats these as
declared allowances and fails the day one gains a producer**, so the list
cannot outlive its own reason.

| topic | why there is no producer |
|---|---|
| `state.instrument.summarized` | ADR-13 conductor rollups from GA4/GSC-class instruments — the instrument seam is not built |
| `semantic.content.indexed` | Indexing writes `vectors.db` and the index registry directly and emits nothing; only *changes* reach the ledger, via `semantic.content.changed` |
| `procedure.runbook.published` | Runbooks are loaded from `law/`, never announced into the ledger |
| `procedure.runbook.deprecated` | Same — no runbook lifecycle producer exists |
| `policy.constraint.published` | Policy lives in settings and `operation-permissions.ts`, not in events |
| `policy.constraint.retired` | Same |
| `task.run.assigned` | No agent-runtime producer. **Three rows exist in this machine's ledger from a WP-57 smoke run on 2026-08-21/22 — written by a script, not by the product** |
| `control.threshold.changed` | No threshold surface emits |
| `control.audit.finding` | Audit findings go to `operation-audit.log`, not to the ledger |

### 5.3 Two taxonomy questions, answered

**`site.status.observed` does not break the taxonomy's rule, because it is not
emitted.** WP-65's premise was that it is emitted from six sites and starts
with none of the seven legal first segments. It is not emitted at all. Its six
occurrences are: `src/renderer/components/DockedPanel/scopeModel.ts:157`, inside
`FIXTURE_SELECTION`, which says in its own docblock that it is a fixture;
`src/main/comparator/comparatorRead.ts:82`, a comment stating that it *"names a
producer that has never existed"*; and four test fixtures. **The rule stands and
the topic is not a topic** — it is a fixture string naming a producer nobody has
written. The real finding underneath it is worse than a taxonomy violation and
is filed in §6: nothing records a site as halted, so a world exclusion cannot
carry the record its own type demands.

**The `episodic.*` reservation is stale, and the namespace is correctly used.**
§4.2 reserves `episodic.*` for *"imported histories"*, while four live producers
emit into it. The reservation is what should change, not the producers:
`agentFailureProducer.ts:24` argues the case in its own header — the family is
"things that happened and are worth remembering", and a sync, an incident and a
failed run all belong to it. **Action: `architecture.md` §4.2's `episodic.*`
comment should be rewritten from "reserved for imported histories" to describe
the episodic namespace as it is used.** That is a change to §4.2, out of scope
for WP-65, and filed here so it is not lost.

---

## 6. LIMITS — what we do not collect, cannot collect, or collect incompletely

**A floor, not a list.** Each entry is what one measurement found; none is
fixed here.

### 6.1 Content and indexing

- **Remote content stops at a stated 5,000-post ceiling** (`REMOTE_MAX_POSTS`,
  `RemoteContentExtractor.ts:58`). A truncated extraction is marked
  `truncatedReason: 'max-posts'` and says so — but it is a ceiling, and a site
  above it is indexed partially by design.
- **All 313 remote index entries carry no coverage record** (307 `wpe-*`, 6
  `ssh:`, measured 2026-08-22). Every one is a **floor of unknown tightness**
  until re-indexed; `get-index-status.ts:39` says so to the user's face rather
  than implying a total.
- **Remote categories and tags are not indexed at all.** Only posts.
- **`structure` is written by the local filesystem walk only.** All 313 remote
  entries carry `structure: null` — no custom tables, no REST namespaces, no
  users/roles for any remote site.
- **277 of 636 index-registry entries are ids of Local sites that no longer
  exist**, all carrying a `structure`. Nothing prunes them.
- **`customFields: {}` is hard-coded in remote extraction** — ACF and other
  post meta are collected locally and not remotely.

### 6.2 Freshness and change

- **Freshness is not reported.** Nothing says which facts have gone cold. Ages
  are available per field on request (`nexus sites status`, the twin's `asOf`),
  but no surface volunteers "these 40 sites have not been observed in a month".
- **Update availability is not persisted anywhere.** Neither `plugins` nor
  `themes` has an `update_version` column. Fleet-wide outdated counts are
  reported as `null`, never `0`.
- **`semantic.content.changed` is structurally local-only** — 2,549 of 2,550
  rows on `source='local'`, zero for `wpe`, zero for `external`. Its producer is
  the MU-plugin webhook, which exists only on Local sites. Remote content can
  change without any event.
- **L2 never refreshes for a halted local site.** Active plugins, active theme,
  post counts and MySQL version are frozen at the last run
  (`data-gaps-design.html` G12).
- **`wp_version` for a WPE install comes only from SSH L2.** CAPI's
  `listInstalls` does not carry it, and calling the individual GET per install
  was rejected on API cost (G10). With SSH refresh off — the default — it is
  absent, not stale.

### 6.3 Identity and coverage

- **Local sites never linked to WP Engine, and all external SSH hosts, have no
  Site entity** — 22 of 42 local, 3 of 3 external. Anything that walks Sites
  cannot see them.
- **`tracks_content` and `tracks_code` appear nowhere outside `docs/`.** ADR-21
  names four link kinds; two are written. Upstream must therefore be *inferred*,
  and 6 of 20 working copies abstain because their candidate environments tie.
- **Nothing reads `remoteSiteEnv`.** The person's recorded choice of environment
  is written by Local, written by Nexus, and consulted by neither.
- **`wpe_site_id` is ambiguous for 46% of the fleet** — 71 Site UUIDs carry more
  than one active install, covering 168 of 365 rows. Resolving on it without an
  environment is a coin toss.
- **Names collide across sources**, and a bare-name lookup that cannot
  disambiguate declines rather than picks. See `CLAUDE.md`.

### 6.4 Working copies and version control

- **No branch or commit is recorded for any working copy.** Git is optional in
  Local, and the flow that *is* collected is files-versus-database, not
  branches. A divergence report cannot say "you are three commits behind".

### 6.5 Runs, agents and the ledger

- **There is no success-side agent-run producer.** `episodic.agent_run.failed`
  exists; its counterpart does not. `graph.db.agent_runs` holds 116 rows and the
  ledger holds **2** failure events — both from the WP-57 smoke run on
  2026-08-21/22, neither from an ordinary run. So the producer works and no real
  agent run has ever reached it.
- **`agent_runs.run_id` is written but never read back.** `getLastRun()` and
  `getRunHistory()` drop the column in their mapping.
- **Nothing records a site as halted.** `comparatorRead.ts:78-91` reads
  halted-ness *from nowhere* rather than from Local's live store, deliberately:
  a `WorldExclusionRecord` must carry the record that caused it, and no record
  exists. The comparator's exclusion list is therefore permanently empty.
- **The ledger holds rows for a topic no source file emits** — three
  `task.run.assigned` events written by a smoke script. A check anchored to the
  ledger rather than to source would report that topic as live; §5's check is
  anchored to source for exactly this reason.
- **Run id reaches `operation-audit.log` from one of three audit writers.**
  `ToolRegistry.call()` passes it; `AgentDispatcher.dispatch()` and
  `auditDirectOperation()` do not. The join between the compliance record and
  the diagnostic log is incomplete.

### 6.6 Health scoring

- **External hosts are not scored until refreshed**, and are scored on
  `security` + `performance` only thereafter. Local sites use all five factors;
  WPE installs use two. `factorsEvaluated` reports the basis.
- **`calculateMaintenance` and `calculateActivity` score 0 for every remote
  target** in three surfaces that have not been fixed
  (`nexusFleetHealth`, `fleet-health-summary.ts`, `DASHBOARD_V2_STATS`) — 35% of
  the weight, enough to render a healthy production install `critical`.
- **Never default an unknown input to a plausible value.** `php_version` must be
  `undefined`, never `'8.0'`; the calculator has the honest path.

### 6.7 Scope

- **No intelligence-layer store leaves the machine.** Telemetry does
  (`src/cli/utils/telemetry.ts:27`) — anonymous counters and a health check,
  opt-out via `NEXUS_TELEMETRY=0`. The claim is scoped to the stores, not the
  process.

---

## Freshness Model

Three thresholds govern how staleness is surfaced:

| Age | Confidence | User sees |
|---|---|---|
| < 1 hour | `high` | Nothing (silent) |
| 1–24 hours | `medium` | `(from Xh ago)` inline |
| > 24 hours | `stale` | `⚠️ stale — run nexus_site_refresh` |
| > 7 days | `stale` | `❌ very stale` |

`canAnswer(twin, field)` returns `{ can, confidence, reason }` so tools can
branch on data quality rather than guess.

Every MCP tool response that serves from twin data appends:
```
_Data: WP-CLI scan · 27m ago · nexus sites refresh mysite to update_
```

The intelligence layer has a **second, separate** freshness model: per-fact-class
SLOs (`wp.version: 24h`, `plugin.*: 8h`, `ssl.expiry: 24h`, `health: 1h`)
computed from `observed_at`, used by the assembler to decide pull-live versus
serve-cached (`architecture.md` §4.3, §6.3). The two are not connected.

---

## Consumers

### MCP Tools

| Tool | Twin data used |
|---|---|
| `nexus_get_site_twin` | Full twin — all fields + per-field provenance |
| `get_site_structure` | WP/PHP/MySQL versions, plugins, themes, post counts |
| `nexus_site_status` | Completeness report, field ages, staleness |
| `nexus_site_refresh` | Triggers rescan; returns updated report (SSH deep refresh for WPE) |
| `wp_plugin_list` | Falls back to `twin.plugins` when site is halted |
| `wp_theme_list` | Falls back to `twin.themes` when site is halted |
| `wp_core_version` | Falls back to `twin.wpVersion` when site is halted |
| `nexus_get_fleet_twins` | Fleet-wide completeness overview |
| `verify_site_live` | Compares cached facts against a live re-check — and emits the result |
| `get_index_status` | Index state **and coverage**, including "not recorded" |

### CLI Commands

| Command | What it shows |
|---|---|
| `nexus sites get <site>` | WP/PHP/MySQL, plugins, posts, indexed state, twin age |
| `nexus sites status <site>` | Full per-field freshness report |
| `nexus sites refresh <site>` | Triggers rescan (local WP-CLI or WPE SSH, auto-detected) |
| `nexus fleet refresh [--deep]` | Bulk rescan; `--deep` starts halted local sites and SSHes to WPE |
| `nexus content index-status <site>` | Index state and coverage |
| `nexus host list / refresh / index <alias>` | External SSH hosts |

---

## What's Not in the Twin

Distinct from §6, which covers the whole collection surface. These are things
that *are* collected but live somewhere other than the twin:

- **Per-post content** — the vector index and `graph.db.content`, not the twin
- **User/role data** — index-registry `structure`, not twin fields
- **Custom tables, REST API namespaces** — index-registry `structure` only
- **Every ledger fact** — the twin predates the ledger and does not read it;
  `twin_facts` is a separate view with a similar name (§1.8)
- **WPE `php_version` from SSH** — the twin takes CAPI's; the external path
  takes `wp --info`

Historically this section also listed "no background scheduler for WPE SSH
scans". That is no longer true — `WpeRefreshScheduler` exists (§2.1). It is
off by default, which is a different statement.
