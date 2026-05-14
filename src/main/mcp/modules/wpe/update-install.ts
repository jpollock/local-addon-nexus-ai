import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

export const updateInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_install',
    description: 'Update a WP Engine install — can change PHP version or environment type. PHP version changes take effect immediately after a server restart. Match PHP version to your local site (local_change_php_version) to avoid environment drift. Use wpe_get_install to confirm current settings before updating.',
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

      // Check operation permissions before modifying install (cache lookup by install_id)
      const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
      const cache = (services as any).registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installId?: string; environment?: string; installName?: string; install_name?: string }> } | null;
      const cachedInstall = cache?.installs?.find((i: any) => i.installId === installId);
      const installEnvironment = cachedInstall?.environment ?? 'production';
      const installNameForCheck = cachedInstall?.installName ?? cachedInstall?.install_name ?? installId;
      if (!isOperationAllowed('delete', installEnvironment, settings, installNameForCheck)) {
        return {
          content: [{ type: 'text' as const, text:
            `Operation blocked: this operation is not permitted on "${installEnvironment}" environments. ` +
            `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
          }],
          isError: true,
        };
      }

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
