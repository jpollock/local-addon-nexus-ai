import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';
import { STORAGE_KEYS } from '../../../../common/constants';

/**
 * Maps Local provider IDs to WordPress Connector Screen option names.
 * WordPress 7.0 stores AI credentials as wp_options:
 *   connectors_ai_{provider}_api_key
 */
const PROVIDER_TO_WP_OPTION: Record<string, string> = {
  openai: 'connectors_ai_openai_api_key',
  anthropic: 'connectors_ai_anthropic_api_key',
  google: 'connectors_ai_google_api_key',
};

const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_TO_WP_OPTION);

export const syncCredentialsHandler: McpToolHandler = {
  definition: {
    name: 'wp_sync_ai_credentials',
    description:
      'Sync AI provider API keys from Local\'s Nexus AI settings into a WordPress site\'s Connector Screen. ' +
      'Writes keys for configured providers (OpenAI, Anthropic, Google) so the WP AI Client and AI Experiments plugin work immediately. ' +
      'Only syncs providers that have a key configured in Local. Local-only (not remote).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        providers: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Which providers to sync (openai, anthropic, google). Defaults to all configured providers.',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, show what would be synced without writing. Defaults to false.',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices && !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices, registryStorage } = services;
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

    const dryRun = (args.dry_run as boolean) ?? false;

    // Read API keys from Local's storage
    const storedKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;

    // Filter to requested providers (or all configured)
    const requestedProviders = args.providers as string[] | undefined;
    const providersToSync = (requestedProviders ?? SUPPORTED_PROVIDERS).filter(
      (p) => SUPPORTED_PROVIDERS.includes(p) && storedKeys[p],
    );

    if (providersToSync.length === 0) {
      const configured = SUPPORTED_PROVIDERS.filter((p) => storedKeys[p]);
      if (configured.length === 0) {
        return error(
          'No AI provider API keys configured in Local. ' +
          'Go to Preferences > Nexus AI to add API keys for OpenAI, Anthropic, or Google.',
        );
      }
      return error(
        `Requested providers not configured. Available: ${configured.join(', ')}`,
      );
    }

    if (dryRun) {
      const lines = ['Dry run — would sync the following credentials:', ''];
      for (const provider of providersToSync) {
        const key = storedKeys[provider];
        const masked = maskKey(key);
        const optionName = PROVIDER_TO_WP_OPTION[provider];
        lines.push(`  ${provider}: ${masked} → wp_options.${optionName}`);
      }
      lines.push('', `Target: ${site.name}`);
      return ok(lines.join('\n'));
    }

    // Write each key to WordPress via WP-CLI.
    // WordPress 7.0's Connector Screen registers a sanitize callback that
    // validates keys against the provider API before saving. `wp option update`
    // triggers this callback via update_option() → sanitize_option(), which
    // rejects keys if the validation call fails (network, timeout, etc.).
    // We bypass this by using `wp eval` to remove the sanitize filter first.
    const results: Array<{ provider: string; success: boolean; message: string }> = [];

    for (const provider of providersToSync) {
      const key = storedKeys[provider];
      const optionName = PROVIDER_TO_WP_OPTION[provider];

      // Escape single quotes in the key for safe PHP embedding
      const escapedKey = key.replace(/'/g, "\\'");

      // Remove the sanitize filter, then update the option
      const phpCode = [
        `remove_all_filters('sanitize_option_${optionName}');`,
        `update_option('${optionName}', '${escapedKey}');`,
        `echo 'synced';`,
      ].join(' ');

      try {
        const result = await localServices.wpCliRun(site.id, [
          'eval', phpCode,
        ]);

        if (result.success && (result.stdout ?? '').includes('synced')) {
          results.push({
            provider,
            success: true,
            message: `${maskKey(key)} → ${optionName}`,
          });
        } else {
          results.push({
            provider,
            success: false,
            message: result.stdout ?? 'Unknown error',
          });
        }
      } catch (err) {
        results.push({
          provider,
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Format output
    const synced = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const lines: string[] = [];

    if (synced.length > 0) {
      lines.push(`Synced ${synced.length} provider(s) to "${site.name}":`);
      for (const r of synced) {
        lines.push(`  ${r.provider}: ${r.message}`);
      }
    }

    if (failed.length > 0) {
      lines.push('', `Failed (${failed.length}):`);
      for (const r of failed) {
        lines.push(`  ${r.provider}: ${r.message}`);
      }
    }

    lines.push('', 'The WordPress Connector Screen and AI Experiments plugin will use these keys automatically.');

    if (failed.length > 0 && synced.length === 0) {
      return error(lines.join('\n'));
    }

    return ok(lines.join('\n'));
  },
};

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}
