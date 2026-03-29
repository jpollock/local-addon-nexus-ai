import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, error } from '../wp-cli/preflight';
import { scanDatabase } from './db-scanner';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { DbScanResult } from '../../../../common/types';

function buildMarkdown(scan: DbScanResult): string {
  const lines: string[] = [];

  lines.push(`## Database Health Recommendations for "${scan.siteName}"`);
  lines.push(`Health Score: ${scan.healthScore}/100`);
  lines.push('');

  if (scan.revisions.totalCount > 0) {
    const mb = (scan.revisions.estimatedSizeBytes / (1024 * 1024)).toFixed(1);
    lines.push(`### ⚠️ Post Revisions (${scan.revisions.totalCount.toLocaleString()} revisions, ~${mb} MB)`);
    lines.push('**Risk:** Low — safe to delete older revisions');
    lines.push('**Fix:** `wp post delete $(wp post list --post_type=revision --format=ids) --force`');
    lines.push('**Prevention:** Add to wp-config.php: `define(\'WP_POST_REVISIONS\', 5);`');
    lines.push('');
  }

  if (scan.transients.expiredCount > 0) {
    lines.push(`### ⚠️ Expired Transients (${scan.transients.expiredCount.toLocaleString()} expired)`);
    lines.push('**Risk:** Low — expired transients are unused');
    lines.push('**Fix:** `wp transient delete --expired`');
    lines.push('');
  }

  if (scan.orphans.orphanedPostMeta > 0) {
    lines.push(`### ⚠️ Orphaned Post Meta (${scan.orphans.orphanedPostMeta.toLocaleString()} rows)`);
    lines.push('**Risk:** Low — these rows have no parent post');
    lines.push('**Fix:** Run `clean_database_items` with `orphaned_post_meta`');
    lines.push('');
  }

  if (scan.orphans.orphanedCommentMeta > 0) {
    lines.push(`### ⚠️ Orphaned Comment Meta (${scan.orphans.orphanedCommentMeta.toLocaleString()} rows)`);
    lines.push('**Risk:** Low — these rows have no parent comment');
    lines.push('**Fix:** Run `clean_database_items` with `orphaned_comment_meta`');
    lines.push('');
  }

  if (scan.draftsAndTrash.autoDraftCount > 50) {
    lines.push(`### ⚠️ Auto-Drafts (${scan.draftsAndTrash.autoDraftCount.toLocaleString()} auto-draft posts)`);
    lines.push('**Risk:** Low — WordPress creates these automatically and they accumulate');
    lines.push('**Fix:** Run `clean_database_items` with `auto_drafts`');
    lines.push('');
  }

  if (scan.draftsAndTrash.trashedPostCount > 50) {
    lines.push(`### ⚠️ Trashed Posts (${scan.draftsAndTrash.trashedPostCount.toLocaleString()} in trash)`);
    lines.push('**Risk:** Low — safe to permanently delete');
    lines.push('**Fix:** `wp post delete $(wp post list --post_status=trash --format=ids) --force`');
    lines.push('');
  }

  if (scan.pluginTables.leftoverTables.length > 0) {
    lines.push(`### ⚠️ Plugin Leftover Tables (${scan.pluginTables.leftoverTables.length} table(s))`);
    lines.push('**Risk:** Medium — these tables may belong to deactivated/deleted plugins');
    for (const table of scan.pluginTables.leftoverTables) {
      lines.push(`- \`${table}\``);
    }
    lines.push('**Fix:** Verify each table is safe to drop, then: `wp db query "DROP TABLE <table>"`');
    lines.push('');
  }

  if (scan.wooCommerce) {
    if (scan.wooCommerce.sessionCount > 0) {
      lines.push(`### ⚠️ WooCommerce Stale Sessions (${scan.wooCommerce.sessionCount.toLocaleString()} sessions)`);
      lines.push('**Risk:** Low — expired user sessions accumulate over time');
      lines.push('**Fix:** Run `clean_database_items` with `wc_sessions`');
      lines.push('');
    }
    if (scan.wooCommerce.oldLogCount > 0) {
      lines.push(`### ⚠️ WooCommerce Old Logs (${scan.wooCommerce.oldLogCount.toLocaleString()} entries > 30 days)`);
      lines.push('**Risk:** Low — old log entries are no longer needed');
      lines.push('**Fix:** Run `clean_database_items` with `wc_old_logs`');
      lines.push('');
    }
  }

  if (lines.length === 3) {
    lines.push('✅ No significant database issues found.');
    lines.push('');
  }

  // Always show scanned at
  lines.push(`_Scanned: ${new Date(scan.scannedAt).toLocaleString()}_`);

  return lines.join('\n');
}

export const getDatabaseRecommendationsHandler: McpToolHandler = {
  definition: {
    name: 'get_database_recommendations',
    description:
      'Return markdown recommendations with WP-CLI fix commands for database issues on a local WordPress site. Uses cached scan if available, or runs a fresh scan.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const check = requireRunning(site, services);
    if (check) return check;

    try {
      // Try cached scan first
      let scan: DbScanResult | null = null;
      try {
        if (services.registryStorage) {
          const cache: Record<string, DbScanResult> = services.registryStorage.get(STORAGE_KEYS.DB_SCAN_CACHE) ?? {};
          scan = cache[site.id] ?? null;
        }
      } catch {
        // Non-fatal
      }

      // If no cache, run a fresh scan
      if (!scan) {
        scan = await scanDatabase(site.id, services);
      }

      const markdown = buildMarkdown(scan);
      return {
        content: [{ type: 'text', text: markdown }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to get recommendations: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
};
