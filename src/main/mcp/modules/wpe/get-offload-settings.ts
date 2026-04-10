import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getOffloadSettingsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_offload_settings',
    description: 'Get LargeFS/offload storage settings for a WP Engine install.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const settings = await services.localServices!.capiDirect(`/installs/${args.install_id}/offload`) as any;

      const lines = [
        `## Offload Settings for Install \`${args.install_id}\``,
        '',
      ];

      if (!settings || Object.keys(settings).length === 0) {
        lines.push('No offload settings configured.');
      } else {
        for (const [key, value] of Object.entries(settings)) {
          if (value === null || value === undefined) continue;
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          lines.push(`- **${label}:** ${typeof value === 'object' ? JSON.stringify(value) : value}`);
        }
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
