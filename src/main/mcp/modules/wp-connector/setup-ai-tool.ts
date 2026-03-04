/**
 * wp_setup_ai MCP tool — thin wrapper around setupSiteForAI.
 *
 * Makes the full Setup for AI flow available to MCP clients (agents, E2E tests)
 * using the exact same production code path that the Local UI invokes via IPC.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';
import { setupSiteForAI, SetupAIResult } from './setup-ai';

function formatResult(result: SetupAIResult, siteName: string): string {
  const lines: string[] = [];

  lines.push(result.success
    ? `Setup for AI completed on "${siteName}":`
    : `Setup for AI partially failed on "${siteName}":`);
  lines.push('');

  lines.push(`  AI Plugin: ${result.aiPlugin}`);
  lines.push(`  Provider Plugins: ${result.providerPlugins}`);
  lines.push(`  Ollama Provider: ${result.ollamaProvider}`);
  lines.push(`  AI Experiments: ${result.aiFeatures}`);
  lines.push(`  Credentials: ${result.credentials}`);
  lines.push(`  ACF Abilities: ${result.acfAbilities}`);
  lines.push('');
  lines.push(result.message);

  return lines.join('\n');
}

export const setupAIToolHandler: McpToolHandler = {
  definition: {
    name: 'wp_setup_ai',
    description:
      'Set up a WordPress site for AI: installs the AI Experiments plugin, ' +
      'installs provider plugins (WP 7.0+), enables all experiments, syncs API keys, ' +
      'and optionally enables ACF abilities. Local-only.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        enable_ollama: {
          type: 'boolean',
          description: 'Install the Ollama provider plugin for local AI (requires Ollama running). Defaults to false.',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices && !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices, registryStorage, logger } = services;
    if (!localServices || !registryStorage) {
      return error('Local services or storage not available.');
    }

    // Resolve target site
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site not found: "${args.site}"`);
    }

    const check = requireRunning(site, services);
    if (check) return check;

    try {
      const result = await setupSiteForAI(site.id, localServices, registryStorage, logger, {
        enableOllama: args.enable_ollama === true,
      });
      const text = formatResult(result, site.name);
      return result.success ? ok(text) : error(text);
    } catch (err) {
      return error(`Setup for AI failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
