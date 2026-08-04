import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const searchReplaceHandler: McpToolHandler = {
  definition: {
    name: 'wp_search_replace',
    description:
      'Run search-replace across the entire WordPress database — essential for domain migrations. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Defaults to dry_run=true (preview only, no changes made) — always run in dry-run first to confirm the replacement count. ' +
      'Set dry_run=false to apply changes. Handles serialized data correctly. ' +
      'Common use: after pulling a WPE site locally, replace the production domain with the local domain.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
        search: { type: 'string', description: 'String to search for' },
        replace: { type: 'string', description: 'String to replace with' },
        dry_run: {
          type: 'boolean',
          description: 'Preview changes without applying. Defaults to true.',
        },
      },
      required: ['search', 'replace'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli');
    if ('content' in transport) return transport;

    const search = args.search as string;
    const replace = args.replace as string;
    const dryRun = args.dry_run !== false; // default true

    if (!search) return error('Search string is required.');

    // Helper to run the search-replace command via the transport
    const runSearchReplace = async () => {
      const cliArgs = ['search-replace', search, replace];
      if (dryRun) cliArgs.push('--dry-run');

      const result = await transport.runWpCli(cliArgs);
      if (!result.success) {
        return error(`Search-replace failed: ${result.stdout}`);
      }

      const prefix = dryRun ? '**Dry run** (no changes applied):\n' : '';
      return ok(`${prefix}${result.stdout || 'Search-replace completed.'}`);
    };

    // For local sites only: use withSiteRunning to auto-start halted sites.
    // This is specific to local sites — remote targets have no site to start and no id to pass.
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, runSearchReplace);
    }

    // For remote and external SSH: run directly without withSiteRunning
    return runSearchReplace();
  },
};
