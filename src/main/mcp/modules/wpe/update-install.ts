import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const updateInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_install',
    description: 'Update a WP Engine install. Can change PHP version or environment type.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        php_version: { type: 'string', description: 'PHP version (e.g. "8.2", "8.3")' },
        environment: { type: 'string', description: 'Environment type: production, staging, or development' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const installId = args.install_id as string;
      const phpVersion = args.php_version as string | undefined;
      const environment = args.environment as string | undefined;

      if (!installId) return error('Install ID is required.');
      if (!phpVersion && !environment) {
        return error('At least one of php_version or environment must be provided.');
      }

      const body: Record<string, string> = {};
      if (phpVersion) body.php_version = phpVersion;
      if (environment) body.environment = environment;

      await services.localServices!.capiDirect(`/installs/${installId}`, 'PATCH', body);

      const changes: string[] = [];
      if (phpVersion) changes.push(`PHP version → **${phpVersion}**`);
      if (environment) changes.push(`environment → **${environment}**`);

      return ok(`Install \`${installId}\` updated: ${changes.join(', ')}.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
