import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const updateOffloadSettingsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_offload_settings',
    description: 'Update LargeFS/offload storage settings for a WP Engine install.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        settings: {
          type: 'object',
          description: 'Offload settings to update as key/value pairs',
        },
      },
      required: ['install_id', 'settings'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/offload`,
        'PATCH',
        args.settings as Record<string, unknown>,
      ) as any;

      return ok(`Offload settings updated successfully for install \`${args.install_id}\`.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
