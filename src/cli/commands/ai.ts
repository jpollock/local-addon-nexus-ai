/**
 * AI & Connector Commands
 *
 * AI model management and WordPress AI Connector integration.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const aiCommand = new Command('ai').description('AI and connector management');

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
  .command('setup <target>')
  .description('Setup AI on a WordPress site')
  .option('--force', 'Force setup even if already configured')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 300000 }); // 5 min for setup

      console.log(`\nSetting up AI on ${target}...`);

      const result = await client.mutate<{ nexusAiSetup: any }>(`
        mutation($target: String!, $force: Boolean) {
          nexusAiSetup(target: $target, force: $force) {
            success
            error
            installed {
              plugin
              version
            }
            configured {
              experiments
              providers
              credentials
            }
          }
        }
      `, { target, force: options.force || false });

      const { success, error, installed, configured } = result.nexusAiSetup;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ AI setup complete`);
      console.log('');
      console.log('Installed:');
      for (const item of installed) {
        console.log(`  - ${item.plugin} (${item.version})`);
      }
      console.log('');
      console.log('Configured:');
      console.log(`  - Experiments: ${configured.experiments.join(', ')}`);
      console.log(`  - Providers: ${configured.providers.join(', ')}`);
      console.log(`  - Credentials synced: ${configured.credentials ? 'Yes' : 'No'}`);
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

export { aiCommand };
