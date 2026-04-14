/**
 * nexus_get_site_ai_config MCP tool
 *
 * Returns the per-site AI configuration stored by Setup AI.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from '../wp-cli/preflight';
import { STORAGE_KEYS } from '../../../../common/constants';

export const getSiteAiConfigToolHandler: McpToolHandler = {
  definition: {
    name: 'nexus_get_site_ai_config',
    description:
      'Get the AI configuration stored for a specific site — provider (anthropic/openai/google/ollama/local-gateway), configured model, whether the Local Gateway is enabled, and when it was last configured. Use to confirm a site is set up correctly before running AI abilities, or to check which provider a site uses before switching.' +
      'Returns null if the site has not been configured with Setup AI.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'string',
          description: 'Local site ID',
        },
      },
      required: ['site_id'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { registryStorage } = services;
    if (!registryStorage) {
      return error('Storage not available.');
    }

    const siteId = args.site_id as string;
    const siteConfigs = (registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
    const siteConfig = siteConfigs[siteId] ?? null;

    if (!siteConfig) {
      return ok(`No AI configuration found for site "${siteId}". Run Setup AI first.`);
    }

    const lines: string[] = [
      `AI Configuration for site "${siteId}":`,
      '',
      `  Provider:          ${siteConfig.provider ?? 'unknown'}`,
      `  Model:             ${siteConfig.model ?? '(not set)'}`,
      `  Configured at:     ${siteConfig.configuredAt ? new Date(siteConfig.configuredAt).toISOString() : 'unknown'}`,
      `  Use Local Gateway: ${siteConfig.useLocalGateway ? 'yes' : 'no'}`,
    ];

    return ok(lines.join('\n'));
  },
};
