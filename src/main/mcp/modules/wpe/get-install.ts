import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const getInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_install',
    description: 'Get full details about a specific WP Engine install — name, environment type, primary domain, PHP version, and site association. Use wpe_get_installs to find the install_id. For a quick combined view including local links, use nexus_list_sites.',
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
      const installId = args.install_id as string;
      if (!installId) return error('Install ID is required.');

      const install = await services.localServices!.capiGetInstall(installId) as any;
      if (!install) return error(`Install "${installId}" not found.`);

      return ok(JSON.stringify(install, null, 2));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
