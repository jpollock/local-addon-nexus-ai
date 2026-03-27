/**
 * AI & Connector Commands
 *
 * AI model management and WordPress AI Connector integration.
 */

import { Command } from 'commander';
import * as readline from 'readline';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const aiCommand = new Command('ai').description('AI and connector management');

// ============================================================================
// AI Provider Config
// ============================================================================

const PROVIDERS = [
  { id: 'anthropic',   label: 'Anthropic (Claude)',       requiresKey: true },
  { id: 'openai',      label: 'OpenAI (GPT)',             requiresKey: true },
  { id: 'google',      label: 'Google (Gemini)',          requiresKey: true },
  { id: 'ollama',      label: 'Ollama (local, no key)',   requiresKey: false },
  { id: 'local-gateway', label: 'Local AI Gateway',        requiresKey: false },
];

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');
    let value = '';
    const handler = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u007f') {
        if (value.length > 0) value = value.slice(0, -1);
      } else {
        value += ch;
        process.stdout.write('•');
      }
    };
    stdin.on('data', handler);
  });
}

aiCommand
  .command('config')
  .description('View or configure AI provider settings')
  .action(async () => {
    const client = getClient();

    // Show current config
    const configResult = await client.mutate<{ nexusAiGetConfig: any }>(`
      mutation { nexusAiGetConfig { success error config { provider model hasApiKey } } }
    `, {});

    const { success, error, config } = configResult.nexusAiGetConfig;
    if (!success) {
      console.error(`\n❌ ${error}`);
      process.exit(1);
    }

    console.log('\nCurrent AI Settings');
    console.log('─'.repeat(40));
    if (config.provider) {
      const p = PROVIDERS.find((x) => x.id === config.provider);
      console.log(`Provider:  ${p?.label ?? config.provider}`);
      console.log(`Model:     ${config.model ?? '(none)'}`);
      console.log(`API Key:   ${config.hasApiKey ? '••••••••' : '(not set)'}`);
    } else {
      console.log('  No provider configured.');
    }
    console.log('');

    // Interactive setup
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
      const reconfigure = await prompt(rl, 'Configure AI provider? [Y/n]: ');
      if (reconfigure.toLowerCase() === 'n') {
        rl.close();
        return;
      }

      // Pick provider
      console.log('\nAvailable providers:');
      PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));

      const currentIdx = config.provider ? PROVIDERS.findIndex((p) => p.id === config.provider) + 1 : 1;
      const providerInput = await prompt(rl, `\nChoice [${currentIdx}]: `);
      const providerIdx = (parseInt(providerInput, 10) || currentIdx) - 1;
      const selectedProvider = PROVIDERS[Math.min(Math.max(providerIdx, 0), PROVIDERS.length - 1)];

      // API key (if required)
      let apiKey: string | undefined;
      if (selectedProvider.requiresKey) {
        rl.close(); // close before raw mode
        apiKey = await promptHidden(`API Key${config.hasApiKey && config.provider === selectedProvider.id ? ' (leave blank to keep existing)' : ''}: `);
        if (!apiKey && config.hasApiKey && config.provider === selectedProvider.id) {
          apiKey = undefined; // keep existing
        }
      } else {
        rl.close();
      }

      // Fetch models
      console.log('\nFetching available models...');
      let models: string[] = [];
      try {
        const modelsResult = await client.mutate<{ nexusAiModels: any }>(`
          mutation { nexusAiModels { success models { name } } }
        `, {});
        models = (modelsResult.nexusAiModels?.models ?? []).map((m: any) => m.name);
      } catch {
        // Model list is best-effort
      }

      let selectedModel = config.model ?? '';
      if (models.length > 0) {
        console.log('\nAvailable models:');
        models.slice(0, 20).forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        const currentModelIdx = models.indexOf(selectedModel) + 1 || 1;
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        const modelInput = await prompt(rl2, `\nChoice [${currentModelIdx}]: `);
        rl2.close();
        const modelIdx = (parseInt(modelInput, 10) || currentModelIdx) - 1;
        selectedModel = models[Math.min(Math.max(modelIdx, 0), models.length - 1)];
      } else if (selectedProvider.id === 'ollama') {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        selectedModel = await prompt(rl2, 'Model name (e.g. llama3.2): ');
        rl2.close();
      } else {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        const defaultModel = config.model || '';
        selectedModel = await prompt(rl2, `Model name${defaultModel ? ` [${defaultModel}]` : ''}: `);
        rl2.close();
        if (!selectedModel) selectedModel = defaultModel;
      }

      // Save
      const saveResult = await client.mutate<{ nexusAiSetConfig: any }>(`
        mutation($provider: String!, $model: String!, $apiKey: String) {
          nexusAiSetConfig(provider: $provider, model: $model, apiKey: $apiKey) {
            success error
          }
        }
      `, { provider: selectedProvider.id, model: selectedModel, apiKey });

      if (!saveResult.nexusAiSetConfig.success) {
        console.error(`\n❌ ${saveResult.nexusAiSetConfig.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Saved: ${selectedProvider.label} / ${selectedModel}`);
      console.log('');
    } finally {
      // Ensure rl is closed if an error occurred mid-flow
      try { rl.close(); } catch { /* already closed */ }
    }
  });

// ============================================================================
// Ollama Model Commands
// ============================================================================

aiCommand
  .command('models')
  .description('List available Ollama models')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusAiModels: any }>(`
        mutation {
          nexusAiModels {
            success
            error
            models {
              name
              size
              modified
            }
          }
        }
      `, {});

      const { success, error, models } = result.nexusAiModels;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(models, null, 2));
        return;
      }

      console.log(`\nOllama Models (${models.length})`);
      console.log('─'.repeat(50));

      if (models.length === 0) {
        console.log('  No models installed');
        console.log('  Install models with: ollama pull <model-name>');
      } else {
        for (const model of models) {
          const sizeGB = (model.size / 1024 / 1024 / 1024).toFixed(2);
          const modified = new Date(model.modified).toLocaleDateString();
          console.log(`  ${model.name}`);
          console.log(`    Size: ${sizeGB} GB | Modified: ${modified}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('ask <query>')
  .description('Ask Ollama a question')
  .option('--model <model>', 'Model to use', 'llama3.2')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    try {
      const client = getClient({ timeout: 60000 }); // 1 min for AI response

      console.log(`\nAsking ${options.model}...\n`);

      const result = await client.mutate<{ nexusAiAsk: any }>(`
        mutation($query: String!, $model: String) {
          nexusAiAsk(query: $query, model: $model) {
            success
            error
            response
          }
        }
      `, { query, model: options.model });

      const { success, error, response } = result.nexusAiAsk;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({ response }, null, 2));
        return;
      }

      console.log(response);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// WordPress AI Connector Commands
// ============================================================================

aiCommand
  .command('setup <site>')
  .description('Setup AI on a WordPress site')
  .option('--provider <provider>', 'AI provider to use (skips interactive prompt)')
  .option('--force', 'Force setup even if already configured')
  .action(async (site, options) => {
    try {
      parseTarget(site);
      const client = getClient({ timeout: 300000 });

      // Fetch current global config for defaults
      const configResult = await client.mutate<{ nexusAiGetConfig: any }>(`
        mutation { nexusAiGetConfig { success config { provider } } }
      `, {});
      const globalProvider = configResult.nexusAiGetConfig?.config?.provider;

      // Fetch current site config
      const siteConfigResult = await client.mutate<{ nexusAiGetSiteConfig: any }>(`
        mutation($target: String!) {
          nexusAiGetSiteConfig(target: $target) {
            success config { provider configuredAt }
          }
        }
      `, { target: site });
      const siteConfig = siteConfigResult.nexusAiGetSiteConfig?.config;

      let selectedProvider: typeof PROVIDERS[0];

      if (options.provider) {
        // Non-interactive: --provider flag given
        const found = PROVIDERS.find((p) => p.id === options.provider);
        if (!found) {
          console.error(`\n❌ Unknown provider: ${options.provider}`);
          console.error(`   Valid options: ${PROVIDERS.map((p) => p.id).join(', ')}`);
          process.exit(1);
        }
        selectedProvider = found;
      } else {
        // Interactive: prompt for provider
        console.log(`\nSetup AI on ${site}`);
        console.log('─'.repeat(45));

        if (siteConfig) {
          const p = PROVIDERS.find((x) => x.id === siteConfig.provider);
          console.log(`  Currently: ${p?.label ?? siteConfig.provider}`);
        }

        const defaultProvider = siteConfig?.provider ?? globalProvider ?? 'ollama';
        const defaultIdx = PROVIDERS.findIndex((p) => p.id === defaultProvider) + 1 || 1;

        console.log('\nAvailable providers:');
        PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const providerInput = await prompt(rl, `\nProvider [${defaultIdx}]: `);
        rl.close();

        const providerIdx = (parseInt(providerInput, 10) || defaultIdx) - 1;
        selectedProvider = PROVIDERS[Math.min(Math.max(providerIdx, 0), PROVIDERS.length - 1)];
      }

      console.log(`\nSetting up ${site} with ${selectedProvider.label}...`);

      const result = await client.mutate<{ nexusAiSetup: any }>(`
        mutation($target: String!, $provider: String, $force: Boolean) {
          nexusAiSetup(target: $target, provider: $provider, force: $force) {
            success
            error
            installed { plugin version }
            configured { experiments providers credentials }
          }
        }
      `, { target: site, provider: selectedProvider.id, force: options.force || false });

      const { success, error, installed, configured } = result.nexusAiSetup;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ AI setup complete on ${site}`);
      console.log(`   Provider: ${selectedProvider.label}`);
      console.log('');
      if (installed?.length > 0) {
        console.log('Installed:');
        for (const item of installed) {
          console.log(`  - ${item.plugin} (${item.version})`);
        }
        console.log('');
      }
      console.log('Configured:');
      console.log(`  - Experiments: ${configured?.experiments?.join(', ') ?? 'none'}`);
      console.log(`  - Credentials synced: ${configured?.credentials ? 'Yes' : 'No'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('sync-credentials <target>')
  .description('Sync AI credentials to WordPress site')
  .action(async (target) => {
    try {
      parseTarget(target);
      const client = getClient();

      console.log(`\nSyncing credentials to ${target}...`);

      const result = await client.mutate<{ nexusAiSyncCredentials: any }>(`
        mutation($target: String!) {
          nexusAiSyncCredentials(target: $target) {
            success
            error
            synced {
              provider
              credentialCount
            }
          }
        }
      `, { target });

      const { success, error, synced } = result.nexusAiSyncCredentials;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Credentials synced`);
      console.log('');
      for (const item of synced) {
        console.log(`  ${item.provider}: ${item.credentialCount} credential${item.credentialCount !== 1 ? 's' : ''}`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('abilities <target>')
  .description('List AI abilities on WordPress site')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusAiAbilities: any }>(`
        mutation($target: String!) {
          nexusAiAbilities(target: $target) {
            success
            error
            abilities {
              name
              description
              parameters {
                name
                type
                required
                description
              }
            }
          }
        }
      `, { target });

      const { success, error, abilities } = result.nexusAiAbilities;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(abilities, null, 2));
        return;
      }

      console.log(`\nAI Abilities on ${target} (${abilities.length})`);
      console.log('─'.repeat(50));

      if (abilities.length === 0) {
        console.log('  No abilities available');
        console.log('  Install AI plugins or enable experiments');
      } else {
        for (const ability of abilities) {
          console.log(`  ${ability.name}`);
          console.log(`    ${ability.description}`);
          if (ability.parameters.length > 0) {
            console.log(`    Parameters:`);
            for (const param of ability.parameters) {
              const required = param.required ? '(required)' : '(optional)';
              console.log(`      - ${param.name} ${required}: ${param.description}`);
            }
          }
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('run <target> <ability>')
  .description('Run an AI ability')
  .option('--params <json>', 'Ability parameters as JSON')
  .option('--json', 'Output as JSON')
  .action(async (target, ability, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 120000 }); // 2 min for ability execution

      let params = {};
      if (options.params) {
        try {
          params = JSON.parse(options.params);
        } catch {
          console.error('\n❌ Invalid JSON in --params');
          process.exit(1);
        }
      }

      console.log(`\nRunning ability "${ability}" on ${target}...`);

      const result = await client.mutate<{ nexusAiRun: any }>(`
        mutation($target: String!, $ability: String!, $params: String) {
          nexusAiRun(target: $target, ability: $ability, params: $params) {
            success
            error
            result
          }
        }
      `, { target, ability, params: JSON.stringify(params) });

      const { success, error, result: abilityResult } = result.nexusAiRun;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(abilityResult, null, 2));
        return;
      }

      console.log(`\n✅ Ability executed`);
      console.log('');
      console.log('Result:');
      console.log(JSON.stringify(abilityResult, null, 2));
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('status <target>')
  .description('Get AI connector status')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusAiStatus: any }>(`
        mutation($target: String!) {
          nexusAiStatus(target: $target) {
            success
            error
            status {
              connectorInstalled
              connectorVersion
              experimentsEnabled
              providersConfigured
              credentialsSynced
              abilitiesAvailable
            }
          }
        }
      `, { target });

      const { success, error, status } = result.nexusAiStatus;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      const installedIcon = status.connectorInstalled ? '✅' : '⚫';
      const experimentsIcon = status.experimentsEnabled ? '✅' : '⚫';
      const providersIcon = status.providersConfigured > 0 ? '✅' : '⚫';
      const credentialsIcon = status.credentialsSynced ? '✅' : '⚫';

      console.log(`\nAI Connector Status: ${target}`);
      console.log('─'.repeat(50));
      console.log(`Connector:     ${installedIcon} ${status.connectorInstalled ? `Installed (${status.connectorVersion})` : 'Not installed'}`);
      console.log(`Experiments:   ${experimentsIcon} ${status.experimentsEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(`Providers:     ${providersIcon} ${status.providersConfigured} configured`);
      console.log(`Credentials:   ${credentialsIcon} ${status.credentialsSynced ? 'Synced' : 'Not synced'}`);
      console.log(`Abilities:     ${status.abilitiesAvailable} available`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Per-Site AI Provider Configuration Commands
// ============================================================================

aiCommand
  .command('site-config <site>')
  .description('Show AI provider configured for a site')
  .action(async (site) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusAiGetSiteConfig: any }>(`
        mutation($target: String!) {
          nexusAiGetSiteConfig(target: $target) {
            success
            error
            config { provider model configuredAt }
          }
        }
      `, { target: site });

      const { success, error, config } = result.nexusAiGetSiteConfig;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n${site} — AI Configuration`);
      console.log('─'.repeat(45));

      if (!config) {
        console.log('  Not configured. Run: nexus ai setup ' + site);
      } else {
        const p = PROVIDERS.find((x) => x.id === config.provider);
        const date = new Date(config.configuredAt).toLocaleDateString();
        console.log(`  Provider:  ${p?.label ?? config.provider}`);
        console.log(`  Model:     ${config.model ?? '(not set)'}`);
        console.log(`  Set up:    ${date}`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

aiCommand
  .command('switch-provider <site>')
  .description('Switch AI provider on an already-configured site')
  .action(async (site) => {
    try {
      const client = getClient({ timeout: 120000 });

      // Get current site config
      const siteConfigResult = await client.mutate<{ nexusAiGetSiteConfig: any }>(`
        mutation($target: String!) {
          nexusAiGetSiteConfig(target: $target) {
            success config { provider model }
          }
        }
      `, { target: site });

      const siteConfig = siteConfigResult.nexusAiGetSiteConfig?.config;

      console.log(`\nSwitch AI provider on ${site}`);
      console.log('─'.repeat(45));

      if (siteConfig) {
        const current = PROVIDERS.find((x) => x.id === siteConfig.provider);
        console.log(`  Current provider: ${current?.label ?? siteConfig.provider}`);
      } else {
        console.log('  Note: site not yet configured — consider running: nexus ai setup ' + site);
      }

      // Show provider options (excluding current)
      const currentId = siteConfig?.provider;
      const choices = PROVIDERS.filter((p) => p.id !== currentId);

      console.log('\nSwitch to:');
      choices.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const input = await prompt(rl, '\nChoice [1]: ');
      rl.close();

      const idx = (parseInt(input, 10) || 1) - 1;
      const selectedProvider = choices[Math.min(Math.max(idx, 0), choices.length - 1)];

      console.log(`\nSwitching ${site} → ${selectedProvider.label}...`);

      const result = await client.mutate<{ nexusAiSwitchProvider: any }>(`
        mutation($target: String!, $provider: String!) {
          nexusAiSwitchProvider(target: $target, provider: $provider) {
            success error previousProvider newProvider
          }
        }
      `, { target: site, provider: selectedProvider.id });

      const { success, error, previousProvider, newProvider } = result.nexusAiSwitchProvider;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      const prev = PROVIDERS.find((x) => x.id === previousProvider);
      const next = PROVIDERS.find((x) => x.id === newProvider);
      console.log(`\n✅ ${site} switched: ${prev?.label ?? previousProvider ?? 'unconfigured'} → ${next?.label ?? newProvider}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { aiCommand };
