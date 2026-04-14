import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getSitesHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_sites',
    description: 'List all WP Engine sites across all accounts — a site is a container that holds one or more installs (production/staging/development). Returns site name, ID, and account association. Use wpe_get_installs to list the individual environments within a site. For a combined local+WPE view, use nexus_list_sites.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const data = await services.localServices!.capiDirect('/sites') as any;
      const sites: any[] = data?.results ?? data ?? [];

      if (!sites || sites.length === 0) {
        return ok('No WP Engine sites found.');
      }

      const lines = [`## WP Engine Sites (${sites.length})`];
      for (const s of sites) {
        const account = s.account?.name ?? s.account_id ?? s.account ?? 'unknown account';
        lines.push(`- **${s.name}** (ID: \`${s.id}\`, Account: ${account})`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
