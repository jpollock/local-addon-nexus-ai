/**
 * Database Scanner — Core Logic
 *
 * Scans a WordPress site's database for bloat and issues.
 * All queries use raw SQL via `wp db query` for speed on large databases.
 */

import { DbScanResult, DbCleanResult, DbTableInfo } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusServices } from '../../types';

// ---------------------------------------------------------------------------
// Core WP table names (used to distinguish custom/plugin tables)
// ---------------------------------------------------------------------------

const CORE_WP_TABLES = new Set([
  'wp_posts',
  'wp_postmeta',
  'wp_users',
  'wp_usermeta',
  'wp_comments',
  'wp_commentmeta',
  'wp_options',
  'wp_links',
  'wp_term_relationships',
  'wp_term_taxonomy',
  'wp_termmeta',
  'wp_terms',
]);

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

/**
 * Compute a 0–100 health score from a partial scan result.
 * Exported for unit testing.
 */
export function computeHealthScore(result: {
  revisions: { totalCount: number };
  transients: { expiredCount: number };
  orphans: { orphanedPostMeta: number; orphanedCommentMeta: number };
  draftsAndTrash: { autoDraftCount: number; trashedPostCount: number };
  pluginTables: { leftoverTables: string[] };
  wooCommerce: { sessionCount: number } | null;
  tables: DbTableInfo[];
}): number {
  let penalty = 0;

  // Post revisions
  if (result.revisions.totalCount > 2000) {
    penalty += 20;
  } else if (result.revisions.totalCount > 500) {
    penalty += 10;
  }

  // Expired transients
  if (result.transients.expiredCount > 500) {
    penalty += 20;
  } else if (result.transients.expiredCount > 100) {
    penalty += 10;
  }

  // Orphaned post meta
  if (result.orphans.orphanedPostMeta > 500) {
    penalty += 5;
  }

  // Orphaned comment meta
  if (result.orphans.orphanedCommentMeta > 500) {
    penalty += 5;
  }

  // Auto-drafts
  if (result.draftsAndTrash.autoDraftCount > 50) {
    penalty += 5;
  }

  // Trashed posts
  if (result.draftsAndTrash.trashedPostCount > 50) {
    penalty += 5;
  }

  // Leftover plugin tables (max -15)
  const leftoverPenalty = Math.min(result.pluginTables.leftoverTables.length * 5, 15);
  penalty += leftoverPenalty;

  // WooCommerce stale sessions
  if (result.wooCommerce && result.wooCommerce.sessionCount > 1000) {
    penalty += 10;
  }

  // Total DB size
  const totalBytes = result.tables.reduce((sum, t) => sum + t.totalSizeBytes, 0);
  const totalMb = totalBytes / (1024 * 1024);
  if (totalMb > 1000) {
    penalty += 15;
  } else if (totalMb > 500) {
    penalty += 5;
  }

  return Math.max(0, 100 - penalty);
}

// ---------------------------------------------------------------------------
// Leftover Table Detection
// ---------------------------------------------------------------------------

/**
 * Detect tables that are not core WP tables AND have no matching active plugin slug.
 * Exported for unit testing.
 */
export function detectLeftoverTables(tableNames: string[], activeSlugs: string[], tablePrefix = 'wp_'): string[] {
  const leftover: string[] = [];
  const coreWithPrefix = new Set([...CORE_WP_TABLES].map((t) => t.replace('wp_', tablePrefix)));

  for (const table of tableNames) {
    // Skip core WP tables (prefix-aware)
    if (coreWithPrefix.has(table)) continue;

    // Strip actual prefix for matching
    const withoutPrefix = table.startsWith(tablePrefix) ? table.slice(tablePrefix.length) : table;

    // Check if any active plugin slug appears in the table name
    const hasMatch = activeSlugs.some((slug) => {
      // Normalize slug: replace hyphens with underscores for comparison
      const normalizedSlug = slug.replace(/-/g, '_');
      return withoutPrefix.includes(normalizedSlug) || withoutPrefix.includes(slug.replace(/-/g, '_'));
    });

    if (!hasMatch) {
      leftover.push(table);
    }
  }

  return leftover;
}

// ---------------------------------------------------------------------------
// Summary Builder
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildSummary(result: Partial<DbScanResult> & {
  revisions: DbScanResult['revisions'];
  transients: DbScanResult['transients'];
  orphans: DbScanResult['orphans'];
  draftsAndTrash: DbScanResult['draftsAndTrash'];
  pluginTables: DbScanResult['pluginTables'];
  wooCommerce: DbScanResult['wooCommerce'];
}): string[] {
  const bullets: string[] = [];

  if (result.revisions.totalCount > 0) {
    bullets.push(
      `${result.revisions.totalCount.toLocaleString()} post revisions using ~${formatBytes(result.revisions.estimatedSizeBytes)} (consider limiting to 5 revisions per post)`,
    );
  }

  if (result.transients.expiredCount > 0) {
    bullets.push(
      `${result.transients.expiredCount.toLocaleString()} expired transients (~${formatBytes(result.transients.estimatedSizeBytes)}) — safe to delete`,
    );
  }

  if (result.orphans.orphanedPostMeta > 0) {
    bullets.push(`${result.orphans.orphanedPostMeta.toLocaleString()} orphaned post meta rows`);
  }

  if (result.orphans.orphanedCommentMeta > 0) {
    bullets.push(`${result.orphans.orphanedCommentMeta.toLocaleString()} orphaned comment meta rows`);
  }

  if (result.draftsAndTrash.autoDraftCount > 0) {
    bullets.push(`${result.draftsAndTrash.autoDraftCount.toLocaleString()} auto-draft posts`);
  }

  if (result.draftsAndTrash.trashedPostCount > 0) {
    bullets.push(`${result.draftsAndTrash.trashedPostCount.toLocaleString()} trashed posts — safe to empty`);
  }

  for (const table of result.pluginTables.leftoverTables) {
    bullets.push(`Plugin table ${table} found with no matching active plugin`);
  }

  if (result.wooCommerce) {
    if (result.wooCommerce.sessionCount > 0) {
      bullets.push(`WooCommerce: ${result.wooCommerce.sessionCount.toLocaleString()} stale sessions`);
    }
    if (result.wooCommerce.oldLogCount > 0) {
      bullets.push(`WooCommerce: ${result.wooCommerce.oldLogCount.toLocaleString()} old log entries (>30 days)`);
    }
  }

  return bullets;
}

// ---------------------------------------------------------------------------
// Helper: run a SQL query and parse JSON result
// ---------------------------------------------------------------------------

async function runSql(siteId: string, sql: string, services: NexusServices): Promise<any[]> {
  const result = await services.localServices!.wpCliRun(siteId, ['db', 'query', sql, '--format=json']);
  if (!result.success) return [];
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main: scanDatabase
// ---------------------------------------------------------------------------

export async function scanDatabase(siteId: string, services: NexusServices): Promise<DbScanResult> {
  const startTime = Date.now();
  const ls = services.localServices!;

  // Get site info
  const site = services.siteData.getSite(siteId);
  if (!site) throw new Error(`Site "${siteId}" not found`);

  // Get WP version
  let wpVersion = 'unknown';
  try {
    const versionResult = await ls.wpCliRun(siteId, ['core', 'version']);
    if (versionResult.success) {
      wpVersion = (versionResult.stdout ?? '').trim();
    }
  } catch {
    // Non-fatal
  }

  // Get actual table prefix (sites may use non-default prefix)
  let tablePrefix = 'wp_';
  try {
    const prefixResult = await ls.wpCliRun(siteId, ['config', 'get', 'table_prefix']);
    if (prefixResult.success && prefixResult.stdout?.trim()) {
      tablePrefix = prefixResult.stdout.trim();
    }
  } catch {
    // Fall back to wp_
  }
  const p = tablePrefix; // shorthand

  // SQL queries (using actual table prefix)
  const tableSql = `SELECT TABLE_NAME as name, TABLE_ROWS as rows, DATA_LENGTH as data_length, INDEX_LENGTH as index_length FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${p}%' ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`;
  const revCountSql = `SELECT COUNT(*) as cnt FROM ${p}posts WHERE post_type = 'revision'`;
  const revSizeSql = `SELECT COALESCE(SUM(LENGTH(post_content)), 0) as total_bytes FROM ${p}posts WHERE post_type = 'revision'`;
  const revTopSql = `SELECT p.post_parent as postId, SUBSTRING(parent.post_title, 1, 60) as postTitle, COUNT(*) as revisionCount FROM ${p}posts p LEFT JOIN ${p}posts parent ON p.post_parent = parent.ID WHERE p.post_type = 'revision' GROUP BY p.post_parent ORDER BY revisionCount DESC LIMIT 5`;
  const transExpiredSql = `SELECT COUNT(*) as cnt FROM ${p}options WHERE option_name LIKE '_transient_timeout_%' AND CAST(option_value AS UNSIGNED) < UNIX_TIMESTAMP()`;
  const transTotalSql = `SELECT COUNT(*) as cnt FROM ${p}options WHERE option_name LIKE '_transient_%' AND option_name NOT LIKE '_transient_timeout_%'`;
  const transSizeSql = `SELECT COALESCE(SUM(LENGTH(option_value)), 0) as total_bytes FROM ${p}options WHERE option_name LIKE '_transient_%'`;
  const orphanPostMetaSql = `SELECT COUNT(*) as cnt FROM ${p}postmeta pm LEFT JOIN ${p}posts po ON pm.post_id = po.ID WHERE po.ID IS NULL`;
  const orphanCommentMetaSql = `SELECT COUNT(*) as cnt FROM ${p}commentmeta cm LEFT JOIN ${p}comments c ON cm.comment_id = c.comment_ID WHERE c.comment_ID IS NULL`;
  const draftTrashSql = `SELECT post_status, COUNT(*) as cnt FROM ${p}posts WHERE post_status IN ('auto-draft', 'trash') GROUP BY post_status`;

  // Run all in parallel
  const [
    tableRows,
    revCountRows,
    revSizeRows,
    revTopRows,
    transExpiredRows,
    transTotalRows,
    transSizeRows,
    orphanPostMetaRows,
    orphanCommentMetaRows,
    draftTrashRows,
    pluginListResult,
  ] = await Promise.allSettled([
    runSql(siteId, tableSql, services),
    runSql(siteId, revCountSql, services),
    runSql(siteId, revSizeSql, services),
    runSql(siteId, revTopSql, services),
    runSql(siteId, transExpiredSql, services),
    runSql(siteId, transTotalSql, services),
    runSql(siteId, transSizeSql, services),
    runSql(siteId, orphanPostMetaSql, services),
    runSql(siteId, orphanCommentMetaSql, services),
    runSql(siteId, draftTrashSql, services),
    ls.wpCliRun(siteId, ['plugin', 'list', '--status=active', '--fields=name', '--format=json']),
  ]);

  // Parse table info
  const tables: DbTableInfo[] = tableRows.status === 'fulfilled'
    ? tableRows.value.map((r: any) => ({
        name: String(r.name ?? ''),
        rows: Number(r.rows ?? 0),
        dataSizeBytes: Number(r.data_length ?? 0),
        indexSizeBytes: Number(r.index_length ?? 0),
        totalSizeBytes: Number(r.data_length ?? 0) + Number(r.index_length ?? 0),
      }))
    : [];

  // Parse revisions
  const revCount = revCountRows.status === 'fulfilled'
    ? Number(revCountRows.value[0]?.cnt ?? 0)
    : 0;
  const revSize = revSizeRows.status === 'fulfilled'
    ? Number(revSizeRows.value[0]?.total_bytes ?? 0)
    : 0;
  const revTop = revTopRows.status === 'fulfilled'
    ? revTopRows.value.map((r: any) => ({
        postId: Number(r.postId ?? 0),
        postTitle: String(r.postTitle ?? ''),
        revisionCount: Number(r.revisionCount ?? 0),
      }))
    : [];

  // Parse transients
  const transExpired = transExpiredRows.status === 'fulfilled'
    ? Number(transExpiredRows.value[0]?.cnt ?? 0)
    : 0;
  const transTotal = transTotalRows.status === 'fulfilled'
    ? Number(transTotalRows.value[0]?.cnt ?? 0)
    : 0;
  const transSize = transSizeRows.status === 'fulfilled'
    ? Number(transSizeRows.value[0]?.total_bytes ?? 0)
    : 0;

  // Parse orphans
  const orphanPostMeta = orphanPostMetaRows.status === 'fulfilled'
    ? Number(orphanPostMetaRows.value[0]?.cnt ?? 0)
    : 0;
  const orphanCommentMeta = orphanCommentMetaRows.status === 'fulfilled'
    ? Number(orphanCommentMetaRows.value[0]?.cnt ?? 0)
    : 0;

  // Parse drafts/trash
  let autoDraftCount = 0;
  let trashedPostCount = 0;
  if (draftTrashRows.status === 'fulfilled') {
    for (const row of draftTrashRows.value) {
      if (row.post_status === 'auto-draft') autoDraftCount = Number(row.cnt ?? 0);
      if (row.post_status === 'trash') trashedPostCount = Number(row.cnt ?? 0);
    }
  }
  // Estimate draft+trash size (rough: average post ~2KB)
  const draftTrashSize = (autoDraftCount + trashedPostCount) * 2048;

  // Parse plugin list
  let activeSlugs: string[] = [];
  let isWooCommerceActive = false;
  if (pluginListResult.status === 'fulfilled' && pluginListResult.value.success) {
    try {
      const pluginData = JSON.parse(pluginListResult.value.stdout || '[]');
      activeSlugs = Array.isArray(pluginData)
        ? pluginData.map((p: any) => String(p.name ?? p))
        : [];
      isWooCommerceActive = activeSlugs.some((s) =>
        s === 'woocommerce' || s.includes('woocommerce'),
      );
    } catch {
      // Non-fatal
    }
  }

  // Detect leftover tables (compare against prefix-aware core table names)
  const coreTablesWithPrefix = new Set(
    [...CORE_WP_TABLES].map((t) => t.replace('wp_', p))
  );
  const tableNames = tables.map((t) => t.name);
  const leftoverTables = detectLeftoverTables(tableNames, activeSlugs, p);
  const customTables = tables.filter((t) => !coreTablesWithPrefix.has(t.name));

  // WooCommerce queries (if active)
  let wooCommerce = null;
  if (isWooCommerceActive) {
    try {
      const [wcSessionsResult, wcLogsResult] = await Promise.allSettled([
        runSql(siteId, `SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(session_value)), 0) as total_bytes FROM ${p}woocommerce_sessions`, services),
        runSql(siteId, `SELECT COUNT(*) as cnt FROM ${p}wc_log WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)`, services),
      ]);

      const sessionCount = wcSessionsResult.status === 'fulfilled'
        ? Number(wcSessionsResult.value[0]?.cnt ?? 0)
        : 0;
      const sessionBytes = wcSessionsResult.status === 'fulfilled'
        ? Number(wcSessionsResult.value[0]?.total_bytes ?? 0)
        : 0;
      const oldLogCount = wcLogsResult.status === 'fulfilled'
        ? Number(wcLogsResult.value[0]?.cnt ?? 0)
        : 0;

      wooCommerce = { sessionCount, estimatedSessionSizeBytes: sessionBytes, oldLogCount };
    } catch {
      // WC tables may not exist
    }
  }

  const partialResult = {
    revisions: { totalCount: revCount, estimatedSizeBytes: revSize, topPosts: revTop },
    transients: { expiredCount: transExpired, totalCount: transTotal, estimatedSizeBytes: transSize },
    orphans: { orphanedPostMeta: orphanPostMeta, orphanedCommentMeta: orphanCommentMeta, orphanedUserMeta: 0 },
    draftsAndTrash: { autoDraftCount, trashedPostCount, estimatedSizeBytes: draftTrashSize },
    pluginTables: { leftoverTables, customTables },
    wooCommerce,
    tables,
  };

  const healthScore = computeHealthScore(partialResult);
  const summary = buildSummary(partialResult);

  const result: DbScanResult = {
    siteId,
    siteName: site.name,
    scannedAt: Date.now(),
    wpVersion,
    isWooCommerceActive,
    ...partialResult,
    healthScore,
    summary,
    durationMs: Date.now() - startTime,
  };

  // Cache result
  try {
    if (services.registryStorage) {
      const existing: Record<string, DbScanResult> = services.registryStorage.get(STORAGE_KEYS.DB_SCAN_CACHE) ?? {};
      existing[siteId] = result;
      services.registryStorage.set(STORAGE_KEYS.DB_SCAN_CACHE, existing);
    }
  } catch {
    // Non-fatal
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main: cleanDatabase
// ---------------------------------------------------------------------------

type DbCleanItemType =
  | 'post_revisions'
  | 'expired_transients'
  | 'orphaned_post_meta'
  | 'orphaned_comment_meta'
  | 'auto_drafts'
  | 'trashed_posts'
  | 'wc_sessions'
  | 'wc_old_logs';

const CLEAN_LABELS: Record<DbCleanItemType, string> = {
  post_revisions: 'Post Revisions',
  expired_transients: 'Expired Transients',
  orphaned_post_meta: 'Orphaned Post Meta',
  orphaned_comment_meta: 'Orphaned Comment Meta',
  auto_drafts: 'Auto-Drafts',
  trashed_posts: 'Trashed Posts',
  wc_sessions: 'WooCommerce Stale Sessions',
  wc_old_logs: 'WooCommerce Old Logs (>30 days)',
};

async function cleanItem(
  type: DbCleanItemType,
  dryRun: boolean,
  siteId: string,
  services: NexusServices,
  p: string, // table prefix e.g. 'wp_'
): Promise<{ rowsAffected: number; success: boolean; error?: string }> {
  const ls = services.localServices!;

  const querySql = async (sql: string) => {
    const rows = await runSql(siteId, sql, services);
    return Number(rows[0]?.cnt ?? rows[0]?.rowsAffected ?? 0);
  };

  const execSql = async (sql: string) => {
    const result = await ls.wpCliRun(siteId, ['db', 'query', sql]);
    return result.success;
  };

  try {
    if (dryRun) {
      // Dry-run: count what would be affected
      const countSqls: Record<DbCleanItemType, string> = {
        post_revisions: `SELECT COUNT(*) as cnt FROM ${p}posts WHERE post_type = 'revision'`,
        expired_transients: `SELECT COUNT(*) as cnt FROM ${p}options WHERE option_name LIKE '_transient_timeout_%' AND CAST(option_value AS UNSIGNED) < UNIX_TIMESTAMP()`,
        orphaned_post_meta: `SELECT COUNT(*) as cnt FROM ${p}postmeta pm LEFT JOIN ${p}posts po ON pm.post_id = po.ID WHERE po.ID IS NULL`,
        orphaned_comment_meta: `SELECT COUNT(*) as cnt FROM ${p}commentmeta cm LEFT JOIN ${p}comments c ON cm.comment_id = c.comment_ID WHERE c.comment_ID IS NULL`,
        auto_drafts: `SELECT COUNT(*) as cnt FROM ${p}posts WHERE post_status = 'auto-draft'`,
        trashed_posts: `SELECT COUNT(*) as cnt FROM ${p}posts WHERE post_status = 'trash'`,
        wc_sessions: `SELECT COUNT(*) as cnt FROM ${p}woocommerce_sessions WHERE session_expiry < UNIX_TIMESTAMP()`,
        wc_old_logs: `SELECT COUNT(*) as cnt FROM ${p}wc_log WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      };
      const cnt = await querySql(countSqls[type]);
      return { rowsAffected: cnt, success: true };
    } else {
      // Real delete
      switch (type) {
        case 'post_revisions': {
          await execSql(`DELETE FROM ${p}posts WHERE post_type = 'revision'`);
          await execSql(`DELETE pm FROM ${p}postmeta pm LEFT JOIN ${p}posts po ON pm.post_id = po.ID WHERE po.ID IS NULL`).catch(() => {});
          return { rowsAffected: -1, success: true };
        }
        case 'expired_transients': {
          const rows = await runSql(siteId, `SELECT option_name FROM ${p}options WHERE option_name LIKE '_transient_timeout_%' AND CAST(option_value AS UNSIGNED) < UNIX_TIMESTAMP() LIMIT 5000`, services);
          let count = 0;
          for (const row of rows) {
            const timeoutKey = row.option_name;
            const valueKey = timeoutKey.replace('_transient_timeout_', '_transient_');
            await execSql(`DELETE FROM ${p}options WHERE option_name IN ('${timeoutKey}', '${valueKey}')`);
            count++;
          }
          return { rowsAffected: count, success: true };
        }
        case 'orphaned_post_meta': {
          await execSql(`DELETE pm FROM ${p}postmeta pm LEFT JOIN ${p}posts po ON pm.post_id = po.ID WHERE po.ID IS NULL`);
          return { rowsAffected: -1, success: true };
        }
        case 'orphaned_comment_meta': {
          await execSql(`DELETE cm FROM ${p}commentmeta cm LEFT JOIN ${p}comments c ON cm.comment_id = c.comment_ID WHERE c.comment_ID IS NULL`);
          return { rowsAffected: -1, success: true };
        }
        case 'auto_drafts': {
          await execSql(`DELETE FROM ${p}posts WHERE post_status = 'auto-draft'`);
          return { rowsAffected: -1, success: true };
        }
        case 'trashed_posts': {
          await execSql(`DELETE FROM ${p}posts WHERE post_status = 'trash'`);
          return { rowsAffected: -1, success: true };
        }
        case 'wc_sessions': {
          await execSql(`DELETE FROM ${p}woocommerce_sessions WHERE session_expiry < UNIX_TIMESTAMP()`);
          return { rowsAffected: -1, success: true };
        }
        case 'wc_old_logs': {
          await execSql(`DELETE FROM ${p}wc_log WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)`);
          return { rowsAffected: -1, success: true };
        }
        default:
          return { rowsAffected: 0, success: false, error: `Unknown item type: ${type}` };
      }
    }
  } catch (err) {
    return {
      rowsAffected: 0,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function cleanDatabase(
  siteId: string,
  items: string[],
  dryRun: boolean,
  services: NexusServices,
): Promise<DbCleanResult> {
  const site = services.siteData.getSite(siteId);
  if (!site) throw new Error(`Site "${siteId}" not found`);

  // Get table prefix
  let tablePrefix = 'wp_';
  try {
    const prefixResult = await services.localServices!.wpCliRun(siteId, ['config', 'get', 'table_prefix']);
    if (prefixResult.success && prefixResult.stdout?.trim()) {
      tablePrefix = prefixResult.stdout.trim();
    }
  } catch { /* fall back to wp_ */ }

  const results = await Promise.allSettled(
    items.map(async (type) => {
      const itemResult = await cleanItem(type as DbCleanItemType, dryRun, siteId, services, tablePrefix);
      return {
        type,
        label: CLEAN_LABELS[type as DbCleanItemType] ?? type,
        rowsAffected: itemResult.rowsAffected,
        success: itemResult.success,
        error: itemResult.error,
      };
    }),
  );

  const itemResults = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          type: items[i],
          label: CLEAN_LABELS[items[i] as DbCleanItemType] ?? items[i],
          rowsAffected: 0,
          success: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );

  const totalRowsAffected = itemResults
    .filter((r) => r.rowsAffected > 0)
    .reduce((sum, r) => sum + r.rowsAffected, 0);

  // Rough estimate: average 200 bytes per row cleaned
  const estimatedSpaceFreedBytes = totalRowsAffected * 200;

  return {
    siteId,
    siteName: site.name,
    dryRun,
    cleanedAt: Date.now(),
    items: itemResults,
    totalRowsAffected,
    estimatedSpaceFreedBytes,
  };
}
