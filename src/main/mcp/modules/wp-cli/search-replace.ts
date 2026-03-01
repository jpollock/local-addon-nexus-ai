import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const searchReplaceHandler: McpToolHandler = {
  definition: {
    name: 'wp_search_replace',
    description:
      'Run search-replace on the WordPress database. Defaults to dry-run mode for safety. ' +
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

    const check = requireRunning(site, services);
    if (check) return check;

    const search = args.search as string;
    const replace = args.replace as string;
    const dryRun = args.dry_run !== false; // default true

    if (!search) return error('Search string is required.');

    const cliArgs = ['search-replace', search, replace];
    if (dryRun) cliArgs.push('--dry-run');

    const result = await services.localServices!.wpCliRun(site.id, cliArgs);
    if (!result.success) {
      return error(`Search-replace failed: ${result.stdout}`);
    }

    const prefix = dryRun ? '**Dry run** (no changes applied):\n' : '';
    return ok(`${prefix}${result.stdout || 'Search-replace completed.'}`);
  },
};
