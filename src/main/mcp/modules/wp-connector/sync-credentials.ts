import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';
import { STORAGE_KEYS } from '../../../../common/constants';
import {
  PROVIDER_TO_WP_OPTION,
  SUPPORTED_PROVIDERS,
  buildCredentialSyncPhp,
  maskKey,
  CredentialEntry,
} from './credential-helpers';
import { redactCredentials } from '../../security/credential-redaction';

export const syncCredentialsHandler: McpToolHandler = {
  definition: {
    name: 'wp_sync_ai_credentials',
    description:
      'Sync AI provider API keys from Local secure storage to a WordPress site database. ' +
      'Run after adding or changing an API key in Nexus AI Preferences to push the new key to the WordPress Connector Screen. ' +
      'The site must be running. ' +
      'Not needed for Local Gateway sites — gateway credentials are managed by Local, not stored in WordPress.',
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
      lines.push(`  + wp_ai_client_provider_credentials (AI Experiments plugin)`);
      lines.push('', `Target: ${site.name}`);
      return ok(lines.join('\n'));
    }

    // Build credential entries for the shared PHP builder
    const entries: CredentialEntry[] = providersToSync.map((provider) => ({
      provider,
      key: storedKeys[provider],
      optionName: PROVIDER_TO_WP_OPTION[provider],
    }));

    const phpCode = buildCredentialSyncPhp(entries);

    try {
      // skipPlugins defaults to true — safe because we remove all filters and verify via $wpdb
      const result = await localServices.wpCliRun(
        site.id,
        ['eval', phpCode],
      );

      if (!result.success) {
        return error(`WP-CLI error: ${redactCredentials(result.stdout ?? 'Unknown error')}`);
      }

      // Parse JSON result: { connectors: N, ai_client: true/false }
      let parsed: { connectors: number; ai_client: boolean };
      try {
        parsed = JSON.parse((result.stdout ?? '').trim());
      } catch {
        // Fallback: if we got stdout but couldn't parse, treat as success
        // if it contains our expected data
        return error(`Unexpected response: ${redactCredentials(result.stdout ?? '')}`);
      }

      const lines: string[] = [];
      lines.push(`Synced ${providersToSync.length} provider(s) to "${site.name}":`);
      for (const provider of providersToSync) {
        const key = storedKeys[provider];
        const optionName = PROVIDER_TO_WP_OPTION[provider];
        lines.push(`  ${provider}: ${maskKey(key)} → ${optionName}`);
      }
      lines.push(`  Connector Screen options: ${parsed.connectors} written`);
      lines.push(`  AI Experiments plugin store: ${parsed.ai_client ? 'updated' : 'failed'}`);
      lines.push('', 'The WordPress Connector Screen and AI Experiments plugin will use these keys automatically.');

      return ok(lines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error(`Credential sync failed: ${redactCredentials(msg)}`);
    }
  },
};
