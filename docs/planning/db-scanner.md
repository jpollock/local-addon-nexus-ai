# AI Database Scanner and Optimizer — Implementation Plan

**Project:** local-addon-nexus-ai
**Status:** Implemented — awaiting merge to main (`feature/db-scanner`)
**Customer insight:** Users struggle with database bloat over time; want an automated tool to scan and suggest cleanup.

---

## What Was Built (v2 vs original spec)

The implementation delivered everything in the original spec plus several additions discovered during development:

- **Autoload audit** — scans total autoloaded option size and identifies large entries by option name (was missing from v1 spec)
- **Meta key attribution** — orphaned postmeta rows broken down by `meta_key` and attributed to known plugins (Yoast, ACF, WooCommerce, etc.)
- **Advisor voice** — recommendations written in plain language with prevention tips and plugin attribution, not just raw numbers
- **Lowered thresholds** — score penalties trigger earlier than originally planned (e.g., revisions > 500 instead of > 1,000)
- **Implementation detail**: uses `wp eval` + `$wpdb->get_results()` — `wp db query --format=json` proved unreliable in practice
- **Table prefix**: read via `wp config get table_prefix` since sites may not use the default `wp_` prefix
- **New exported functions**: `guessPluginFromOptionName()`, `attributePluginTable()`, `detectLeftoverTables()`
- **47 unit tests** in `tests/unit/mcp/db-scanner.test.ts`

---

## 1. Architecture

```
WP-CLI (db query, eval)
  ↕ LocalServicesBridge.wpCliRun()
src/main/mcp/modules/db-scanner/db-scanner.ts   ← core logic
  ├── scan-handler.ts        → MCP: scan_database_health (Tier 1)
  ├── recommendations-handler.ts → MCP: get_database_recommendations (Tier 1)
  └── clean-handler.ts       → MCP: clean_database_items (Tier 3)
src/main/mcp/modules/composite/db-audit.ts     → MCP: fleet_database_health (Tier 1)
src/main/graphql/ (schema + resolvers)         → CLI path (nexusDbScan, nexusDbClean, nexusDbReport)
src/cli/commands/wp.ts                         → nexus wp db scan/clean/report
src/main/ipc-handlers.ts                       → DB_SCAN_SITE, DB_GET_LAST_SCAN
src/renderer/components/SiteNexusSection.tsx   → "Database Health" row
```

---

## 2. What gets scanned

| Category | Data collected | WP-CLI method |
|---|---|---|
| Post revisions | count, size estimate, top posts by count | SQL via `wp db query` |
| Expired transients | expired count, total count, size estimate | SQL |
| Orphaned post meta | count (postmeta rows with no matching post) | SQL LEFT JOIN |
| Orphaned comment meta | count | SQL LEFT JOIN |
| Auto-drafts & trash | count per status | SQL GROUP BY |
| Table sizes | all wp_* tables ranked by size | information_schema |
| Plugin leftover tables | tables not matching any active plugin slug | table list + plugin list |
| WooCommerce (if active) | session count/size, old log count | SQL (conditional) |

---

## 3. Data model — add to `src/common/types.ts`

```typescript
export interface DbTableInfo {
  name: string;
  rows: number;
  dataSizeBytes: number;
  indexSizeBytes: number;
  totalSizeBytes: number;
}

export interface DbRevisionInfo {
  totalCount: number;
  estimatedSizeBytes: number;
  topPosts: Array<{ postId: number; postTitle: string; revisionCount: number }>;
}

export interface DbTransientInfo {
  expiredCount: number;
  totalCount: number;
  estimatedSizeBytes: number;
}

export interface DbOrphanInfo {
  orphanedPostMeta: number;
  orphanedCommentMeta: number;
  orphanedUserMeta: number;
}

export interface DbDraftTrashInfo {
  autoDraftCount: number;
  trashedPostCount: number;
  estimatedSizeBytes: number;
}

export interface DbPluginTableInfo {
  leftoverTables: string[];
  customTables: DbTableInfo[];
}

export interface DbWooCommerceInfo {
  sessionCount: number;
  estimatedSessionSizeBytes: number;
  oldLogCount: number;
}

export interface DbScanResult {
  siteId: string;
  siteName: string;
  scannedAt: number;
  wpVersion: string;
  isWooCommerceActive: boolean;
  tables: DbTableInfo[];
  revisions: DbRevisionInfo;
  transients: DbTransientInfo;
  orphans: DbOrphanInfo;
  draftsAndTrash: DbDraftTrashInfo;
  pluginTables: DbPluginTableInfo;
  wooCommerce: DbWooCommerceInfo | null;
  healthScore: number;    // 0–100
  summary: string[];      // bullet points Claude can quote verbatim
  durationMs: number;
}

export interface DbCleanResult {
  siteId: string;
  siteName: string;
  dryRun: boolean;
  cleanedAt: number;
  items: Array<{
    type: string;
    label: string;
    rowsAffected: number;
    success: boolean;
    error?: string;
  }>;
  totalRowsAffected: number;
  estimatedSpaceFreedBytes: number;
}
```

---

## 4. Health score algorithm

```
healthScore = 100 minus penalties (floor 0):

post revisions > 500:       -10
post revisions > 2000:      -20 (replaces -10)
expired transients > 100:   -10
expired transients > 500:   -20 (replaces -10)
orphaned post meta > 500:   -5
orphaned comment meta > 500: -5
auto-drafts > 50:           -5
trashed posts > 50:         -5
leftover plugin tables:     -5 per table, max -15
WC sessions > 1000:         -10
total DB size > 500MB:      -5
total DB size > 1000MB:     -15 (replaces -5)
```

---

## 5. Constants — add to `src/common/constants.ts`

```typescript
// IPC_CHANNELS:
DB_SCAN_SITE: `${ADDON_PREFIX}:db:scan`,
DB_GET_LAST_SCAN: `${ADDON_PREFIX}:db:get-last-scan`,

// STORAGE_KEYS:
DB_SCAN_CACHE: `${ADDON_PREFIX}_db_scan_cache`,
```

---

## 6. MCP tools

| Tool | Tier | Description |
|---|---|---|
| `scan_database_health` | 1 | Scan DB, return structured JSON + summary bullets |
| `get_database_recommendations` | 1 | Return markdown recommendations with WP-CLI fix commands |
| `clean_database_items` | 3 | Delete items (dry_run defaults true; real run needs confirmation token) |
| `fleet_database_health` | 1 | Scan all running sites, return ranked list |

**Safety config to add to `src/main/mcp/safety.ts`:**
```typescript
// TIER_OVERRIDES:
scan_database_health: 1,
get_database_recommendations: 1,
clean_database_items: 3,
fleet_database_health: 1,

// CONFIRMATION_MESSAGES:
clean_database_items: 'This will permanently delete database rows. Always run with dry_run=true first.',

// PRE_CHECKS:
clean_database_items: [
  'Run scan_database_health first',
  'Run clean_database_items with dry_run=true to preview',
  'Ensure a database backup exists',
],
```

---

## 7. Clean item types

```typescript
type DbCleanItemType =
  | 'post_revisions'       // wp post delete ... --post_type=revision --force
  | 'expired_transients'   // wp transient delete --expired
  | 'orphaned_post_meta'   // DELETE pm FROM wp_postmeta LEFT JOIN wp_posts ...
  | 'orphaned_comment_meta' // DELETE cm FROM wp_commentmeta LEFT JOIN wp_comments ...
  | 'auto_drafts'          // wp post delete ... --post_status=auto-draft --force
  | 'trashed_posts'        // wp post delete ... --post_status=trash --force
  | 'wc_sessions'          // DELETE FROM wp_woocommerce_sessions WHERE session_expiry < UNIX_TIMESTAMP()
  | 'wc_old_logs';         // DELETE FROM wp_wc_log WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)
```

Default clean (when no items specified): all except `wc_*` unless WooCommerce active.

---

## 8. GraphQL mutations to add to `src/main/graphql/schema.ts`

```graphql
nexusDbScan(target: String!): NexusDbScanResult!
nexusDbClean(input: NexusDbCleanInput!): NexusDbCleanResult!
nexusDbReport: NexusDbReportResult!
```

Full type definitions (DbTableInfo, DbRevisionInfo, DbScanResult, NexusDbScanResult, NexusDbCleanInput, NexusDbCleanResult, DbFleetEntry, NexusDbReportResult) — see plan section 4.

---

## 9. CLI commands — add to `src/cli/commands/wp.ts`

```bash
nexus wp db scan <site>           # scan DB, display health report
nexus wp db clean <site>          # dry-run by default, shows what would be deleted
nexus wp db clean <site> --no-dry-run  # prompts for y/N then deletes
nexus wp db clean <site> --items post_revisions,expired_transients  # targeted
nexus wp db report                # fleet health report, all running sites
```

All support `--json` flag for machine-readable output.

---

## 10. UI changes — `src/renderer/components/SiteNexusSection.tsx`

**New state fields:**
```typescript
dbScan: DbScanResult | null;
dbScanning: boolean;
```

**New IPC fetch in `fetchData()`:**
```typescript
// After aiContextStatus fetch
const lastScanResult = await ipc.invoke(IPC_CHANNELS.DB_GET_LAST_SCAN, this.props.site.id);
if (lastScanResult?.success) this.setState({ dbScan: lastScanResult.scan ?? null });
```

**New row in `render()`:**
```
Database Health  ● 85/100    [Re-scan]
Top DB issue     2,400 post revisions (40% of DB size)
```

Score color: green ≥80, yellow 50–79, red <50, gray = not scanned.

---

## 11. Implementation order

1. `src/common/types.ts` — add DB types
2. `src/common/constants.ts` — add IPC channels + storage key
3. `src/main/mcp/modules/db-scanner/db-scanner.ts` — core scan + clean logic
4. `src/main/mcp/modules/db-scanner/scan-handler.ts`
5. `src/main/mcp/modules/db-scanner/recommendations-handler.ts`
6. `src/main/mcp/modules/db-scanner/clean-handler.ts`
7. `src/main/mcp/modules/db-scanner/index.ts` — register all three
8. `src/main/mcp/safety.ts` — tier assignments
9. `src/main/index.ts` — call registerDbScannerTools
10. `src/main/mcp/modules/composite/db-audit.ts` — fleet_database_health
11. `src/main/mcp/modules/composite/index.ts` — register fleet tool
12. `src/main/graphql/schema.ts` — add types + mutations
13. `src/main/graphql/resolvers.ts` — add nexusDbScan, nexusDbClean, nexusDbReport
14. `src/main/ipc-handlers.ts` — add DB_SCAN_SITE, DB_GET_LAST_SCAN
15. `src/cli/commands/wp.ts` — add scan/clean/report subcommands
16. `src/renderer/components/SiteNexusSection.tsx` — Database Health row
17. `tests/unit/mcp/db-scanner.test.ts` — unit tests
18. `docs/` — update user-guide, docs-site

---

## 12. Tests — `tests/unit/mcp/db-scanner.test.ts`

Key test cases:
- `computeHealthScore` — 100 for clean, correct penalties per threshold
- `scan_database_health` — returns structured scan for running site
- `scan_database_health` — error if site halted or not found
- `scan_database_health` — graceful defaults when WP-CLI queries fail
- `clean_database_items` — dry_run=true returns estimates, no deletions
- `clean_database_items` — defaults dry_run=true when not specified
- `detectLeftoverTables` — correctly identifies non-core, non-plugin tables
- `fleet_database_health` — skips non-running sites, sorts by score

---

## 13. Docs to update

- `docs/planning/db-scanner.md` — this file (already done)
- `docs/user-guide.md` — add "Database Health" section
- `docs-site/docs/cli/commands.md` — add `nexus wp db` subcommands
- `docs-site/docs/mcp-tools/wordpress.md` — add 3 new tools + fleet tool
- `docs-site/docs/ui-addon/` — add Database Health row documentation
- `docs-site/docs/reference/cli-command-reference.md` — add `nexus wp db` section

---

## 14. Key design decisions

- **Raw SQL over WP-CLI PHP commands**: much faster for bulk counts/deletes on large databases
- **`dry_run` defaults to `true`**: prevents accidental data loss; user must explicitly opt into deletion
- **`clean_database_items` is Tier 3**: deletes are irreversible even if "orphaned"; requires confirmation token (MCP) or y/N prompt (CLI)
- **Return JSON from scan tool**: Claude reasons better over structured numbers than markdown tables; `summary` array provides pre-computed natural language
- **Cache scan results in `registryStorage`**: scan takes 2-5 seconds; cache lets UI show last result instantly and `get_database_recommendations` reuse without re-scanning
- **Local-only**: scanner uses raw SQL which can't run on remote WPE sites via the allowed remote commands list; clearly documented as local-only
- **`cleanDatabase` exported from db-scanner.ts directly**: GraphQL resolvers call business logic directly (same pattern as `setupSiteForAI`), not via MCP dispatch
