/**
 * Sites Commands
 *
 * Manage local and WPE sites.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const sitesCommand = new Command('sites').description('Manage Local and WPE sites');

/**
 * nexus sites get
 */
sitesCommand
  .command('get <target>')
  .description('Get detailed information about a site')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusSitesGet: any }>(`
        mutation($target: String!) {
          nexusSitesGet(target: $target) {
            success
            error
            site {
              id
              name
              domain
              path
              status
              wpVersion
              phpVersion
              indexed
              indexedAt
              documentCount
              chunkCount
              linkedTo {
                installId
                environment
              }
            }
          }
        }
      `, { target });

      const { success, error, site } = result.nexusSitesGet;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(site, null, 2));
        return;
      }

      // Human-readable output
      console.log(`\n${site.name}`);
      console.log('─'.repeat(Math.max(site.name.length, 40)));
      console.log(`Status:       ${site.status === 'running' ? '🟢 Running' : '⚫ Halted'}`);
      console.log(`Domain:       ${site.domain || 'N/A'}`);
      console.log(`Path:         ${site.path}`);

      if (site.wpVersion) {
        console.log(`WordPress:    ${site.wpVersion}`);
      }

      if (site.phpVersion) {
        console.log(`PHP:          ${site.phpVersion}`);
      }

      if (site.indexed) {
        console.log(`Indexed:      ✅ Yes (${site.documentCount} docs, ${site.chunkCount} chunks)`);
        if (site.indexedAt) {
          const date = new Date(parseInt(site.indexedAt, 10));
          console.log(`Last indexed: ${date.toLocaleString()}`);
        }
      } else {
        console.log(`Indexed:      ⚫ No`);
      }

      if (site.linkedTo) {
        console.log(`WPE Link:     ${site.linkedTo.installId}@${site.linkedTo.environment}`);
      }

      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites list
 */
sitesCommand
  .command('list')
  .description('List all sites (local + WPE)')
  .option('--local-only', 'Show only local sites')
  .option('--wpe-only', 'Show only WPE sites')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.query<{ nexusSitesList: any }>(`
        mutation {
          nexusSitesList {
            local {
              name
              status
              wpVersion
              domain
              phpVersion
              linkedTo {
                account
                accountName
                installId
                installName
                environment
                createdAt
                lastSyncedAt
              }
            }
            wpe {
              account
              accountName
              installId
              environment
              name
              domain
              wpVersion
              phpVersion
              linkedTo
            }
          }
        }
      `);

      const { local, wpe } = result.nexusSitesList;

      if (options.json) {
        console.log(JSON.stringify({ local, wpe }, null, 2));
        return;
      }

      // Display local sites
      if (!options.wpeOnly) {
        console.log('\nLocal Sites:');
        if (local.length === 0) {
          console.log('  (none)');
        } else {
          for (const site of local) {
            const statusIcon = site.status === 'running' ? '🟢' : '⚫';

            let linkInfo = ' → not linked';
            if (site.linkedTo) {
              // Use names if available, otherwise fall back to IDs
              const accountDisplay = site.linkedTo.accountName || site.linkedTo.account;
              const installDisplay = site.linkedTo.installName || site.linkedTo.installId;
              linkInfo = ` → wpe:${accountDisplay}/${installDisplay}@${site.linkedTo.environment}`;
            }

            console.log(
              `  ${statusIcon} ${site.name} (${site.status})${linkInfo}`
            );
          }
        }
      }

      // Display WPE sites
      if (!options.localOnly) {
        console.log('\nWPE Sites:');
        if (wpe.length === 0) {
          console.log('  (none - not authenticated or no installs)');
        } else {
          for (const site of wpe) {
            const linkInfo = site.linkedTo ? ` → ${site.linkedTo}@local` : '';
            const displayName = site.name || site.installId;
            const accountDisplay = site.accountName || site.account;

            console.log(
              `  ${displayName} (${site.environment})${linkInfo}`
            );
            console.log(`    Target: wpe:${accountDisplay}/${site.name}@${site.environment}`);
            if (site.domain) {
              console.log(`    Domain: ${site.domain}`);
            }
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
 * nexus sites create
 */
sitesCommand
  .command('create <target>')
  .description('Create a new local site')
  .option('--blueprint <name>', 'Create from Local blueprint')
  .option('--php <version>', 'PHP version (e.g., 8.2, 8.1, 7.4)')
  .option('--wp <version>', 'WordPress version (e.g., 6.4, 6.3)')
  .action(async (target, options) => {
    try {
      // Enforce @local syntax
      if (!target.endsWith('@local')) {
        console.error('\n❌ Sites can only be created locally.');
        console.error(`   Use: nexus sites create ${target}@local`);
        process.exit(1);
      }

      const name = target.replace('@local', '');
      const client = getClient({ timeout: 120000 }); // 2 min for site creation

      console.log(`Creating site: ${name}...`);

      const result = await client.mutate<{ nexusSitesCreate: any }>(`
        mutation($input: NexusCreateSiteInput!) {
          nexusSitesCreate(input: $input) {
            success
            error
            siteName
            siteId
            siteDomain
          }
        }
      `, {
        input: {
          name,
          blueprint: options.blueprint,
          phpVersion: options.php,
          wpVersion: options.wp,
        },
      });

      const { success, error, siteName, siteDomain } = result.nexusSitesCreate;

      if (!success) {
        console.error(`\n❌ Failed to create site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site created: ${siteName}`);
      if (siteDomain) {
        console.log(`   Domain: ${siteDomain}`);
      }
      console.log('\nStart the site: nexus sites start ' + siteName + '@local');
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites start
 */
sitesCommand
  .command('start <target>')
  .description('Start a local site')
  .action(async (target) => {
    try {
      const client = getClient({ timeout: 120000 }); // 2 min for start

      console.log(`Starting site: ${target}...`);

      const result = await client.mutate<{ nexusSitesStart: any }>(`
        mutation($target: String!) {
          nexusSitesStart(target: $target) {
            success
            error
            siteName
            status
          }
        }
      `, { target });

      const { success, error, siteName, status } = result.nexusSitesStart;

      if (!success) {
        console.error(`\n❌ Failed to start site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site started: ${siteName}`);
      console.log(`   Status: ${status}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites stop
 */
sitesCommand
  .command('stop <target>')
  .description('Stop a local site')
  .action(async (target) => {
    try {
      const client = getClient({ timeout: 120000 }); // 2 min for stop

      console.log(`Stopping site: ${target}...`);

      const result = await client.mutate<{ nexusSitesStop: any }>(`
        mutation($target: String!) {
          nexusSitesStop(target: $target) {
            success
            error
            siteName
            status
          }
        }
      `, { target });

      const { success, error, siteName, status } = result.nexusSitesStop;

      if (!success) {
        console.error(`\n❌ Failed to stop site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site stopped: ${siteName}`);
      console.log(`   Status: ${status}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites restart
 */
sitesCommand
  .command('restart <target>')
  .description('Restart a local site')
  .action(async (target) => {
    try {
      const client = getClient({ timeout: 120000 }); // 2 min for restart

      console.log(`Restarting site: ${target}...`);

      const result = await client.mutate<{ nexusSitesRestart: any }>(`
        mutation($target: String!) {
          nexusSitesRestart(target: $target) {
            success
            error
            siteName
            status
          }
        }
      `, { target });

      const { success, error, siteName, status } = result.nexusSitesRestart;

      if (!success) {
        console.error(`\n❌ Failed to restart site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site restarted: ${siteName}`);
      console.log(`   Status: ${status}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites delete
 */
sitesCommand
  .command('delete <target>')
  .description('Delete a local site')
  .option('--force', 'Skip confirmation prompt')
  .action(async (target, options) => {
    try {
      const client = getClient();

      // Confirmation prompt (unless --force)
      if (!options.force) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n⚠️  Delete site ${target}? This cannot be undone. (y/N): `, resolve);
        });

        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log('\nCancelled.');
          process.exit(0);
        }
      }

      console.log(`\nDeleting site: ${target}...`);

      const result = await client.mutate<{ nexusSitesDelete: any }>(`
        mutation($target: String!) {
          nexusSitesDelete(target: $target) {
            success
            error
            siteName
            status
          }
        }
      `, { target });

      const { success, error, siteName } = result.nexusSitesDelete;

      if (!success) {
        console.error(`\n❌ Failed to delete site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site deleted: ${siteName}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { sitesCommand };
