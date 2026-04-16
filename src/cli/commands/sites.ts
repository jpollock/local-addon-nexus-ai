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
              mysqlVersion
              siteUrl
              adminEmail
              activeTheme
              activePluginCount
              installedPluginCount
              postCount
              lastPostAt
              twinCompleteness
              twinAge
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
      if (site.siteUrl)    console.log(`Site URL:     ${site.siteUrl}`);
      if (site.adminEmail) console.log(`Admin email:  ${site.adminEmail}`);
      console.log(`Path:         ${site.path}`);

      // Versions
      if (site.wpVersion)    console.log(`WordPress:    ${site.wpVersion}`);
      if (site.phpVersion)   console.log(`PHP:          ${site.phpVersion}`);
      if (site.mysqlVersion) console.log(`MySQL:        ${site.mysqlVersion}`);

      // Theme & plugins
      if (site.activeTheme) console.log(`Theme:        ${site.activeTheme}`);
      if (site.installedPluginCount != null) {
        console.log(`Plugins:      ${site.activePluginCount} active / ${site.installedPluginCount} installed`);
      }

      // Content
      if (site.postCount != null) {
        const lastPost = site.lastPostAt
          ? ` · last post ${new Date(site.lastPostAt).toLocaleDateString()}`
          : '';
        console.log(`Posts:        ${site.postCount} published${lastPost}`);
      }

      // Index
      if (site.indexed) {
        console.log(`Indexed:      ✅ Yes (${site.documentCount} docs, ${site.chunkCount} chunks)`);
        if (site.indexedAt) {
          const date = new Date(parseInt(site.indexedAt, 10));
          console.log(`Last indexed: ${date.toLocaleString()}`);
        }
      } else {
        console.log(`Indexed:      ⚫ No`);
      }

      // WPE link
      if (site.linkedTo) {
        console.log(`WPE Link:     ${site.linkedTo.installId}@${site.linkedTo.environment}`);
      }

      // Twin data quality
      if (site.twinCompleteness && site.twinCompleteness !== 'none') {
        const icon = site.twinCompleteness === 'indexed' || site.twinCompleteness === 'metadata' ? '✅' : '🔶';
        console.log(`Twin data:    ${icon} ${site.twinCompleteness} · ${site.twinAge ?? 'unknown age'}`);
      } else {
        console.log(`Twin data:    ❌ None — run: nexus sites refresh ${target}`);
      }

      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites clone
 */
sitesCommand
  .command('clone <source> <newName>')
  .description('Clone an existing site')
  .action(async (source, newName, options) => {
    try {
      // Enforce @local syntax for source
      if (!source.endsWith('@local')) {
        console.error('\n❌ Source site must be local.');
        console.error(`   Use: nexus sites clone ${source}@local ${newName}`);
        process.exit(1);
      }

      const client = getClient({ timeout: 300000 }); // 5 min for clone

      console.log(`\nCloning ${source} → ${newName}...`);

      const result = await client.mutate<{ nexusSitesClone: any }>(`
        mutation($input: NexusCloneSiteInput!) {
          nexusSitesClone(input: $input) {
            success
            error
            siteName
            siteId
          }
        }
      `, {
        input: {
          source,
          newName,
        },
      });

      const { success, error, siteName, siteId } = result.nexusSitesClone;

      if (!success) {
        console.error(`\n❌ Failed to clone site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site cloned successfully`);
      console.log(`   Name: ${siteName}`);
      console.log(`   ID:   ${siteId}`);
      console.log(`\nStart the cloned site:`);
      console.log(`   nexus sites start ${siteName}@local`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites rename
 */
sitesCommand
  .command('rename <target> <newName>')
  .description('Rename a site')
  .action(async (target, newName, options) => {
    try {
      // Enforce @local syntax
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites rename ${target}@local ${newName}`);
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nRenaming ${target} → ${newName}...`);

      const result = await client.mutate<{ nexusSitesRename: any }>(`
        mutation($input: NexusRenameSiteInput!) {
          nexusSitesRename(input: $input) {
            success
            error
            oldName
            newName
          }
        }
      `, {
        input: {
          target: target.replace(/@local$/, ''),
          newName,
        },
      });

      const { success, error, oldName, newName: renamedName } = result.nexusSitesRename;

      if (!success) {
        console.error(`\n❌ Failed to rename site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site renamed successfully`);
      console.log(`   ${oldName} → ${renamedName}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites export
 */
sitesCommand
  .command('export <target> [outputPath]')
  .description('Export a site to archive')
  .action(async (target, outputPath, options) => {
    try {
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites export ${target}@local`);
        process.exit(1);
      }

      const client = getClient({ timeout: 600000 }); // 10 min for export
      // Strip @local suffix — the resolver expects just the site name
      const siteName = target.replace(/@local$/, '');

      console.log(`\nExporting ${siteName}...`);

      const result = await client.mutate<{ nexusSitesExport: any }>(`
        mutation($input: NexusExportSiteInput!) {
          nexusSitesExport(input: $input) {
            success
            error
            outputPath
          }
        }
      `, {
        input: {
          target: siteName,
          outputPath,
        },
      });

      const { success, error, outputPath: exportPath } = result.nexusSitesExport;

      if (!success) {
        console.error(`\n❌ Failed to export site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site exported successfully`);
      console.log(`   Archive: ${exportPath}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites import
 */
sitesCommand
  .command('import <archivePath>')
  .description('Import a site from archive')
  .option('--name <name>', 'Name for the imported site')
  .action(async (archivePath, options) => {
    try {
      const client = getClient({ timeout: 600000 }); // 10 min for import

      console.log(`\nImporting ${archivePath}...`);

      const result = await client.mutate<{ nexusSitesImport: any }>(`
        mutation($input: NexusImportSiteInput!) {
          nexusSitesImport(input: $input) {
            success
            error
            siteName
            siteId
          }
        }
      `, {
        input: {
          archivePath,
          name: options.name,
        },
      });

      const { success, error, siteName, siteId } = result.nexusSitesImport;

      if (!success) {
        console.error(`\n❌ Failed to import site: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Site imported successfully`);
      console.log(`   Name: ${siteName}`);
      console.log(`   ID:   ${siteId}`);
      console.log(`\nStart the site:`);
      console.log(`   nexus sites start ${siteName}@local`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites logs
 */
sitesCommand
  .command('logs <target>')
  .description('View site logs')
  .option('--tail <lines>', 'Number of lines to show', '100')
  .option('--follow', 'Follow log output')
  .action(async (target, options) => {
    try {
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites logs ${target}@local`);
        process.exit(1);
      }

      const client = getClient({ timeout: options.follow ? 0 : 30000 });

      const result = await client.mutate<{ nexusSitesLogs: any }>(`
        mutation($input: NexusGetLogsInput!) {
          nexusSitesLogs(input: $input) {
            success
            error
            logs
          }
        }
      `, {
        input: {
          target: target.replace(/@local$/, ''),
          tail: parseInt(options.tail, 10),
          follow: options.follow || false,
        },
      });

      const { success, error, logs } = result.nexusSitesLogs;

      if (!success) {
        console.error(`\n❌ Failed to get logs: ${error}`);
        process.exit(1);
      }

      console.log(logs);
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

/**
 * nexus sites config php
 */
sitesCommand
  .command('config-php <target> <version>')
  .description('Change PHP version')
  .action(async (target, version, options) => {
    try {
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites config-php ${target}@local ${version}`);
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nChanging PHP version for ${target}...`);

      const result = await client.mutate<{ nexusSitesConfigPhp: any }>(`
        mutation($input: NexusConfigPhpInput!) {
          nexusSitesConfigPhp(input: $input) {
            success
            error
            oldVersion
            newVersion
          }
        }
      `, {
        input: {
          target: target.replace(/@local$/, ''),
          version,
        },
      });

      const { success, error, oldVersion, newVersion } = result.nexusSitesConfigPhp;

      if (!success) {
        console.error(`\n❌ Failed to change PHP version: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ PHP version changed`);
      console.log(`   ${oldVersion} → ${newVersion}`);
      console.log(`\n⚠️  Site restart required for changes to take effect`);
      console.log(`   nexus sites restart ${target}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites config ssl
 */
sitesCommand
  .command('config-ssl <target>')
  .description('Trust SSL certificate')
  .action(async (target, options) => {
    try {
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites config-ssl ${target}@local`);
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nTrusting SSL certificate for ${target}...`);

      const result = await client.mutate<{ nexusSitesConfigSsl: any }>(`
        mutation($input: NexusConfigSslInput!) {
          nexusSitesConfigSsl(input: $input) {
            success
            error
          }
        }
      `, {
        input: {
          target: target.replace(/@local$/, ''),
        },
      });

      const { success, error } = result.nexusSitesConfigSsl;

      if (!success) {
        console.error(`\n❌ Failed to trust SSL: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ SSL certificate trusted`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites config xdebug
 */
sitesCommand
  .command('config-xdebug <target>')
  .description('Toggle Xdebug')
  .option('--enable', 'Enable Xdebug')
  .option('--disable', 'Disable Xdebug')
  .action(async (target, options) => {
    try {
      if (!target.endsWith('@local')) {
        console.error('\n❌ Target site must be local.');
        console.error(`   Use: nexus sites config-xdebug ${target}@local --enable|--disable`);
        process.exit(1);
      }

      if (!options.enable && !options.disable) {
        console.error('\n❌ Must specify --enable or --disable');
        process.exit(1);
      }

      const enable = !!options.enable;
      const client = getClient();

      console.log(`\n${enable ? 'Enabling' : 'Disabling'} Xdebug for ${target}...`);

      const result = await client.mutate<{ nexusSitesConfigXdebug: any }>(`
        mutation($input: NexusConfigXdebugInput!) {
          nexusSitesConfigXdebug(input: $input) {
            success
            error
            enabled
          }
        }
      `, {
        input: {
          target: target.replace(/@local$/, ''),
          enable,
        },
      });

      const { success, error, enabled } = result.nexusSitesConfigXdebug;

      if (!success) {
        console.error(`\n❌ Failed to toggle Xdebug: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Xdebug ${enabled ? 'enabled' : 'disabled'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Digital twin commands
// ============================================================================

/**
 * nexus sites status <site>
 */
sitesCommand
  .command('status <target>')
  .description('Show what cached data exists for a site and how fresh it is')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusSiteStatus: any }>(`
        mutation($target: String!) {
          nexusSiteStatus(target: $target) {
            success
            error
            report
          }
        }
      `, { target });

      const { success, error, report } = result.nexusSiteStatus;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }

      if (options.json) { console.log(report); return; }
      console.log('\n' + report + '\n');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sites refresh <site>
 */
sitesCommand
  .command('refresh <target>')
  .description('Refresh the cached data (digital twin) for a site')
  .option('--force', 'Force WP-CLI enrichment even if a recent scan exists')
  .action(async (target, options) => {
    try {
      const client = getClient();
      console.log(`\nRefreshing twin for ${target}...`);

      const result = await client.mutate<{ nexusSiteRefresh: any }>(`
        mutation($target: String!, $force: Boolean) {
          nexusSiteRefresh(target: $target, force: $force) {
            success
            error
            report
          }
        }
      `, { target, force: options.force ?? false });

      const { success, error, report } = result.nexusSiteRefresh;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }

      console.log('\n' + report + '\n');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { sitesCommand };
