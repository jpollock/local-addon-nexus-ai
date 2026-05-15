/**
 * nexus settings — Read and update Nexus AI settings
 *
 * Commands:
 *   nexus settings get [key]        Read all settings or a specific dotted-path key
 *   nexus settings set <key> <val>  Set a single dotted-path key to a value
 *   nexus settings patch <json>     Merge a JSON object into current settings
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';

const settingsCommand = new Command('settings').description('Read and update Nexus AI settings');

// ---------------------------------------------------------------------------
// nexus settings get [key]
// ---------------------------------------------------------------------------

settingsCommand
  .command('get [key]')
  .description('Read settings. Pass a dotted path to read a specific field (e.g. wpeOperationPermissions.wpcli.production).')
  .option('--json', 'Output raw JSON')
  .action(async (key: string | undefined, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusGetSettings: { success: boolean; error?: string; settings?: string } }>(`
        mutation($key: String) {
          nexusGetSettings(key: $key) {
            success
            error
            settings
          }
        }
      `, { key: key ?? null });

      const { success, error, settings } = result.nexusGetSettings;

      if (!success || !settings) {
        console.error(`Error: ${error ?? 'No settings returned'}`);
        process.exit(1);
      }

      const parsed = JSON.parse(settings);

      if (options.json || key) {
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        // Pretty table for full settings dump
        console.log('\nNexus AI Settings\n' + '─'.repeat(40));
        printSettings(parsed, '');
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

function printSettings(obj: any, prefix: string): void {
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      printSettings(v, fullKey);
    } else {
      console.log(`  ${fullKey.padEnd(48)} ${JSON.stringify(v)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// nexus settings set <key> <value>
// ---------------------------------------------------------------------------

settingsCommand
  .command('set <key> <value>')
  .description([
    'Set a single setting by dotted path.',
    '',
    'Examples:',
    '  nexus settings set wpeOperationPermissions.wpcli.production true',
    '  nexus settings set wpeOperationPermissions.push.production false',
    '  nexus settings set autoIndex true',
    '  nexus settings set wpeSyncIntervalHours 4',
  ].join('\n'))
  .action(async (key: string, value: string) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusUpdateSettings: { success: boolean; error?: string; settings?: string } }>(`
        mutation($key: String, $value: String) {
          nexusUpdateSettings(key: $key, value: $value) {
            success
            error
            settings
          }
        }
      `, { key, value });

      const { success, error, settings } = result.nexusUpdateSettings;

      if (!success) {
        console.error(`Error: ${error ?? 'Update failed'}`);
        process.exit(1);
      }

      const parsed = JSON.parse(settings!);
      // Show just the updated field
      const current = key.split('.').reduce((acc: any, k) => acc?.[k], parsed);
      console.log(`✓ ${key} = ${JSON.stringify(current)}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus settings patch <json>
// ---------------------------------------------------------------------------

settingsCommand
  .command('patch <json>')
  .description([
    'Merge a JSON object into current settings.',
    '',
    'Examples:',
    '  nexus settings patch \'{"wpeOperationPermissions":{"wpcli":{"production":true}}}\'',
    '  nexus settings patch \'{"autoIndex":false,"wpeSyncIntervalHours":12}\'',
  ].join('\n'))
  .action(async (jsonStr: string) => {
    try {
      // Validate JSON before sending
      JSON.parse(jsonStr);

      const client = getClient();
      const result = await client.mutate<{ nexusUpdateSettings: { success: boolean; error?: string; settings?: string } }>(`
        mutation($patch: String) {
          nexusUpdateSettings(patch: $patch) {
            success
            error
            settings
          }
        }
      `, { patch: jsonStr });

      const { success, error } = result.nexusUpdateSettings;

      if (!success) {
        console.error(`Error: ${error ?? 'Patch failed'}`);
        process.exit(1);
      }

      console.log('✓ Settings updated');
    } catch (err: any) {
      if (err.message?.includes('JSON')) {
        console.error(`Invalid JSON: ${err.message}`);
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus settings reset
// ---------------------------------------------------------------------------

settingsCommand
  .command('reset')
  .description('Clear all Nexus AI settings and revert to defaults. Requires confirmation.')
  .option('--confirm', 'Confirm that you want to reset all settings')
  .action(async (options) => {
    if (!options.confirm) {
      console.error('Add --confirm to reset all Nexus AI settings to defaults.');
      process.exit(1);
    }

    try {
      const client = getClient();
      const result = await client.mutate<{ nexusUpdateSettings: { success: boolean; error?: string } }>(`
        mutation {
          nexusUpdateSettings(patch: "{}") {
            success
            error
          }
        }
      `, {});

      // Patch with empty object doesn't reset; we need to set to empty
      const resetResult = await client.mutate<{ nexusUpdateSettings: { success: boolean; error?: string } }>(`
        mutation($patch: String) {
          nexusUpdateSettings(patch: $patch) {
            success
            error
          }
        }
      `, { patch: JSON.stringify({ autoIndex: true, excludedSiteIds: [], wpeOperationPermissions: null, wpeSiteExceptions: null }) });

      if (!resetResult.nexusUpdateSettings.success) {
        console.error(`Error: ${resetResult.nexusUpdateSettings.error ?? 'Reset failed'}`);
        process.exit(1);
      }

      console.log('✓ Settings reset to defaults');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { settingsCommand };
