/**
 * nexus_switch_provider MCP tool
 *
 * Switches the AI provider for an already-configured site.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';
import { switchProviderForSite } from './switch-provider';
import type { AIProvider } from '../../../../common/types';

export const switchProviderToolHandler: McpToolHandler = {
  definition: {
    name: 'nexus_switch_provider',
    description:
      'Switch the AI provider for an already-configured WordPress site. ' +
      'Deactivates the old provider plugin, installs/activates the new one, ' +
      'and syncs the new provider\'s credentials. Local-only.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'string',
          description: 'Local site ID or name',
        },
        provider: {
          type: 'string',
          enum: ['anthropic', 'openai', 'google', 'ollama', 'local-gateway'],
          description: 'AI provider to switch to',
        },
      },
      required: ['site_id', 'provider'],
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

    const newProvider = args.provider as AIProvider;

    try {
      const result = await switchProviderForSite(
        site.id,
        newProvider,
        localServices,
        registryStorage,
        logger,
      );

      if (!result.success) {
        return error(`Failed to switch provider: ${result.error}`);
      }

      const lines = [
        `Provider switched on "${site.name}":`,
        `  Previous: ${result.previousProvider ?? 'unconfigured'}`,
        `  New:      ${result.newProvider}`,
      ];

      return ok(lines.join('\n'));
    } catch (err) {
      return error(`Switch provider failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
