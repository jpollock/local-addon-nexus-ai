import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error } from './preflight';
import { withSiteRunning } from '../with-site-running';

export const searchReplaceHandler: McpToolHandler = {
  definition: {
    name: 'wp_search_replace',
    description:
      'Run search-replace across the entire WordPress database — essential for domain migrations. LOCAL SITES ONLY. Defaults to dry_run=true (preview only, no changes made) — always run in dry-run first to confirm the replacement count. Set dry_run=false to apply changes. Handles serialized data correctly. Common use: after pulling a WPE site locally, replace the production domain with the local domain.' +
      'Set dry_run=false to apply changes.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        search: { type: 'string', description: 'String to search for' },
        replace: { type: 'string', description: 'String to replace with' },
        dry_run: {
          type: 'boolean',
          description: 'Preview changes without applying. Defaults to true.',
        },
      },
      required: ['site', 'search', 'replace'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const search = args.search as string;
    const replace = args.replace as string;
    const dryRun = args.dry_run !== false; // default true

    if (!search) return error('Search string is required.');

    return withSiteRunning(site.id, services, async () => {
      const cliArgs = ['search-replace', search, replace];
      if (dryRun) cliArgs.push('--dry-run');

      const result = await services.localServices!.wpCliRun(site.id, cliArgs);
      if (!result.success) {
        return error(`Search-replace failed: ${result.stdout}`);
      }

      const prefix = dryRun ? '**Dry run** (no changes applied):\n' : '';
      return ok(`${prefix}${result.stdout || 'Search-replace completed.'}`);
    });
  },
};
