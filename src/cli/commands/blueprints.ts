/**
 * Blueprints Commands
 *
 * Manage Local blueprints.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';

const blueprintsCommand = new Command('blueprints').description('Manage Local blueprints');

/**
 * nexus blueprints list
 */
blueprintsCommand
  .command('list')
  .description('List available blueprints')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusBlueprintsList: any }>(`
        mutation {
          nexusBlueprintsList {
            success
            error
            blueprints {
              name
              description
            }
          }
        }
      `);

      const { success, error, blueprints } = result.nexusBlueprintsList;

      if (!success) {
        console.error(`\n❌ Failed to list blueprints: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(blueprints, null, 2));
        return;
      }

      console.log('\nAvailable Blueprints:');
      if (blueprints.length === 0) {
        console.log('  (none)');
      } else {
        for (const bp of blueprints) {
          console.log(`  ${bp.name}`);
          if (bp.description) {
            console.log(`    ${bp.description}`);
          }
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus blueprints save
 */
blueprintsCommand
  .command('save <target> <blueprintName>')
  .description('Save a site as a blueprint')
  .action(async (target, blueprintName, options) => {
    try {
      // Enforce @local syntax
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus blueprints save ${target}@local ${blueprintName}`);
        process.exit(1);
      }

      const client = getClient({ timeout: 300000 }); // 5 min for blueprint

      console.log(`\nSaving ${target} as blueprint "${blueprintName}"...`);

      const result = await client.mutate<{ nexusBlueprintsSave: any }>(`
        mutation($input: NexusBlueprintsSaveInput!) {
          nexusBlueprintsSave(input: $input) {
            success
            error
            blueprintName
          }
        }
      `, {
        input: {
          target,
          blueprintName,
        },
      });

      const { success, error, blueprintName: savedName } = result.nexusBlueprintsSave;

      if (!success) {
        console.error(`\n❌ Failed to save blueprint: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Blueprint saved: ${savedName}`);
      console.log(`\nCreate a new site from this blueprint:`);
      console.log(`   nexus sites create mysite@local --blueprint=${savedName}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { blueprintsCommand };
