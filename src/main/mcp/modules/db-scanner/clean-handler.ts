import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, error } from '../wp-cli/preflight';
import { cleanDatabase, scanDatabase } from './db-scanner';

const DEFAULT_ITEMS = [
  'post_revisions',
  'expired_transients',
  'orphaned_post_meta',
  'orphaned_comment_meta',
  'auto_drafts',
  'trashed_posts',
];

const WC_ITEMS = ['wc_sessions', 'wc_old_logs'];

export const cleanDatabaseItemsHandler: McpToolHandler = {
  definition: {
    name: 'clean_database_items',
    description:
      'Delete database bloat items from a local WordPress site — post revisions, auto-drafts, trashed posts, expired transients, orphaned postmeta, and plugin leftover tables. Defaults to dry_run=true (preview only, no changes made) — always run in dry-run first to confirm counts. Set dry_run=false to apply cleanup. LOCAL SITES ONLY — site must be running. Run scan_database_health first to identify what needs cleaning.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Item types to clean. Defaults to all non-WC items. Options: post_revisions, expired_transients, orphaned_post_meta, orphaned_comment_meta, auto_drafts, trashed_posts, wc_sessions, wc_old_logs',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true (default), only count what would be deleted without deleting. Set to false to actually delete.',
          default: true,
        },
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

    // Default dry_run to true
    const dryRun = args.dry_run === undefined ? true : Boolean(args.dry_run);

    // Determine which items to clean
    let items: string[];
    if (Array.isArray(args.items) && args.items.length > 0) {
      items = args.items as string[];
    } else {
      // Default: all non-WC items, plus WC items if WooCommerce is active
      items = [...DEFAULT_ITEMS];
      try {
        // Quick check for WooCommerce
        const scan = await scanDatabase(site.id, services);
        if (scan.isWooCommerceActive) {
          items = [...items, ...WC_ITEMS];
        }
      } catch {
        // If scan fails, just use default items
      }
    }

    try {
      const result = await cleanDatabase(site.id, items, dryRun, services);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Database clean failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
};
