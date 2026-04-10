import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const getSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_site',
    description: 'Get details for a single WP Engine site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'WP Engine site ID' },
      },
      required: ['site_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const siteId = args.site_id as string;
      if (!siteId) return error('Site ID is required.');

      const s = await services.localServices!.capiDirect(`/sites/${siteId}`) as any;
      if (!s) return error(`Site "${siteId}" not found.`);

      const account = s.account?.name ?? s.account_id ?? s.account ?? 'unknown';
      const created = s.created_at ? new Date(s.created_at).toLocaleDateString() : 'unknown';

      const lines = [
        `## Site: ${s.name}`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **ID** | \`${s.id}\` |`,
        `| **Name** | ${s.name} |`,
        `| **Account** | ${account} |`,
        `| **Created** | ${created} |`,
      ];
      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
