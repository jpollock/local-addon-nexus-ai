/**
 * nexus_sync_credentials MCP tool
 *
 * Syncs AI credentials to a WordPress site using the auto-sync mechanism.
 * Uses per-site AI config to determine which provider to sync.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';
import { autoSyncCredentials } from './auto-sync';
import { STORAGE_KEYS } from '../../../../common/constants';

export const syncCredentialsMcpToolHandler: McpToolHandler = {
  definition: {
    name: 'nexus_sync_credentials',
    description:
      'Sync AI credentials from Local to a specific WordPress site — pushes the configured provider API key to the site WordPress database. ' +
      'Use after wp_setup_ai or when API credentials change. ' +
      'Equivalent to clicking Sync Credentials in the site info panel. ' +
      'Not needed for Local Gateway sites — gateway auth is handled by Local.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'string',
          description: 'Local site ID or name',
        },
      },
      required: ['site_id'],
    },
    isAvailable: (services) => !!services.localServices && !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices, registryStorage, logger } = services;
    if (!localServices || !registryStorage) {
      return error('Local services or storage not available.');
    }

    const site = resolveSite(args.site_id as string, services.siteData);
    if (!site) {
      return error(`Site not found: "${args.site_id}"`);
    }

    const check = requireRunning(site, services);
    if (check) return check;

    const siteConfigs = (registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
    const siteConfig = siteConfigs[site.id];

    if (!siteConfig) {
      return error(`Site "${site.name}" has not been configured with Setup AI yet.`);
    }

    try {
      await autoSyncCredentials(site.id, site.name, localServices, registryStorage, logger);
      return ok(`Credentials synced to "${site.name}" (provider: ${siteConfig.provider})`);
    } catch (err) {
      return error(`Credential sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
