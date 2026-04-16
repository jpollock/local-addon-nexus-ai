/**
 * Fleet Intelligence Commands
 *
 * Cross-account analytics, search, groups, and bulk operations.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const fleetCommand = new Command('fleet').description('Fleet intelligence and analytics');

// ============================================================================
// Health Commands
// ============================================================================

fleetCommand
  .command('health')
  .description('Overall fleet health summary')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetHealth: any }>(`
        mutation {
          nexusFleetHealth {
            success
            error
            summary {
              totalSites
              runningSites
              haltedSites
              healthyCount
              warningCount
              criticalCount
              totalPlugins
              outdatedPlugins
              totalThemes
              outdatedThemes
            }
          }
        }
      `, {});

      const { success, error, summary } = result.nexusFleetHealth;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log('\nFleet Health Summary');
      console.log('─'.repeat(50));
      console.log(`Sites:         ${summary.totalSites} total (${summary.runningSites} running, ${summary.haltedSites} halted)`);
      console.log(`Health:        ${summary.healthyCount} healthy, ${summary.warningCount} warnings, ${summary.criticalCount} critical`);
      console.log(`Plugins:       ${summary.totalPlugins} total (${summary.outdatedPlugins} outdated)`);
      console.log(`Themes:        ${summary.totalThemes} total (${summary.outdatedThemes} outdated)`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

fleetCommand
  .command('site-health <target>')
  .description('Individual site health details')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusFleetSiteHealth: any }>(`
        mutation($target: String!) {
          nexusFleetSiteHealth(target: $target) {
            success
            error
            health {
              status
              score
              issues {
                severity
                message
                category
              }
              plugins {
                total
                active
                outdated
              }
              themes {
                total
                active
                outdated
              }
              wordpress {
                version
                updateAvailable
              }
            }
          }
        }
      `, { target });

      const { success, error, health } = result.nexusFleetSiteHealth;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }

      const statusIcon = health.status === 'healthy' ? '✅' : health.status === 'warning' ? '⚠️' : '❌';

      console.log(`\nSite Health: ${target}`);
      console.log('─'.repeat(50));
      console.log(`Status:        ${statusIcon} ${health.status} (score: ${health.score}/100)`);
      console.log(`WordPress:     ${health.wordpress.version}${health.wordpress.updateAvailable ? ' → update available' : ''}`);
      console.log(`Plugins:       ${health.plugins.active}/${health.plugins.total} active (${health.plugins.outdated} outdated)`);
      console.log(`Themes:        ${health.themes.active}/${health.themes.total} active (${health.themes.outdated} outdated)`);

      if (health.issues.length > 0) {
        console.log(`\nIssues (${health.issues.length}):`);
        for (const issue of health.issues) {
          const icon = issue.severity === 'critical' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`  ${icon} [${issue.category}] ${issue.message}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Search & Filter Commands
// ============================================================================

fleetCommand
  .command('search <query>')
  .description('Search across all sites')
  .option('--json', 'Output as JSON')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetSearch: any }>(`
        mutation($query: String!, $limit: Int) {
          nexusFleetSearch(query: $query, limit: $limit) {
            success
            error
            results {
              target
              siteName
              type
              score
              snippet
            }
          }
        }
      `, { query, limit: parseInt(options.limit, 10) });

      const { success, error, results } = result.nexusFleetSearch;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(`\nSearch Results: "${query}"`);
      console.log('─'.repeat(50));

      if (results.length === 0) {
        console.log('  No results found');
      } else {
        for (const result of results) {
          console.log(`  ${result.siteName} (${result.target})`);
          console.log(`    Type: ${result.type} | Score: ${result.score.toFixed(2)}`);
          console.log(`    ${result.snippet}`);
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

fleetCommand
  .command('filter')
  .description('Filter sites by criteria')
  .option('--status <status>', 'Filter by status (running, halted)')
  .option('--plugin <plugin>', 'Sites with this plugin')
  .option('--wp-version <version>', 'WordPress version')
  .option('--linked', 'Only linked to WPE', false)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetFilter: any }>(`
        mutation($filter: NexusFleetFilterInput!) {
          nexusFleetFilter(filter: $filter) {
            success
            error
            sites {
              target
              name
              status
              wpVersion
              linkedTo
            }
          }
        }
      `, {
        filter: {
          status: options.status || null,
          plugin: options.plugin || null,
          wpVersion: options.wpVersion || null,
          linkedOnly: options.linked,
        },
      });

      const { success, error, sites } = result.nexusFleetFilter;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(sites, null, 2));
        return;
      }

      console.log(`\nFiltered Sites (${sites.length})`);
      console.log('─'.repeat(50));

      if (sites.length === 0) {
        console.log('  No sites match filters');
      } else {
        for (const site of sites) {
          const icon = site.status === 'running' ? '🟢' : '⚫';
          const linked = site.linkedTo ? ` → ${site.linkedTo}` : '';
          console.log(`  ${icon} ${site.name} (${site.target}) - WP ${site.wpVersion}${linked}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Site Groups Commands
// ============================================================================

const groupsCommand = new Command('groups').description('Manage site groups');

groupsCommand
  .command('list')
  .description('List all site groups')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetGroupsList: any }>(`
        mutation {
          nexusFleetGroupsList {
            success
            error
            groups {
              id
              name
              description
              siteCount
              createdAt
            }
          }
        }
      `, {});

      const { success, error, groups } = result.nexusFleetGroupsList;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(groups, null, 2));
        return;
      }

      console.log(`\nSite Groups (${groups.length})`);
      console.log('─'.repeat(50));

      if (groups.length === 0) {
        console.log('  No groups created yet');
      } else {
        for (const group of groups) {
          console.log(`  ${group.name} (${group.siteCount} sites)`);
          if (group.description) {
            console.log(`    ${group.description}`);
          }
          console.log(`    Created: ${new Date(group.createdAt).toLocaleDateString()}`);
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('create <name>')
  .description('Create a site group')
  .option('--description <desc>', 'Group description')
  .action(async (name, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetGroupsCreate: any }>(`
        mutation($name: String!, $description: String) {
          nexusFleetGroupsCreate(name: $name, description: $description) {
            success
            error
            groupId
          }
        }
      `, { name, description: options.description || null });

      const { success, error, groupId } = result.nexusFleetGroupsCreate;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Created group: ${name}`);
      console.log(`   ID: ${groupId}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('add <group> <sites...>')
  .description('Add sites to a group')
  .action(async (group, sites) => {
    try {
      // Validate all targets
      for (const site of sites) {
        parseTarget(site);
      }

      const client = getClient();

      const result = await client.mutate<{ nexusFleetGroupsAdd: any }>(`
        mutation($group: String!, $sites: [String!]!) {
          nexusFleetGroupsAdd(group: $group, sites: $sites) {
            success
            error
            addedCount
          }
        }
      `, { group, sites });

      const { success, error, addedCount } = result.nexusFleetGroupsAdd;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Added ${addedCount} site${addedCount !== 1 ? 's' : ''} to group "${group}"`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('remove <group> <sites...>')
  .description('Remove sites from a group')
  .action(async (group, sites) => {
    try {
      // Validate all targets
      for (const site of sites) {
        parseTarget(site);
      }

      const client = getClient();

      const result = await client.mutate<{ nexusFleetGroupsRemove: any }>(`
        mutation($group: String!, $sites: [String!]!) {
          nexusFleetGroupsRemove(group: $group, sites: $sites) {
            success
            error
            removedCount
          }
        }
      `, { group, sites });

      const { success, error, removedCount } = result.nexusFleetGroupsRemove;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Removed ${removedCount} site${removedCount !== 1 ? 's' : ''} from group "${group}"`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('delete <group>')
  .description('Delete a site group')
  .action(async (group) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusFleetGroupsDelete: any }>(`
        mutation($group: String!) {
          nexusFleetGroupsDelete(group: $group) {
            success
            error
          }
        }
      `, { group });

      const { success, error } = result.nexusFleetGroupsDelete;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Deleted group: ${group}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

fleetCommand.addCommand(groupsCommand);

// ============================================================================
// Bulk Operations Commands
// ============================================================================

const bulkCommand = new Command('bulk').description('Bulk operations');

bulkCommand
  .command('reindex <targets...>')
  .description('Bulk reindex sites')
  .action(async (targets) => {
    try {
      // Validate all targets
      for (const target of targets) {
        parseTarget(target);
      }

      const client = getClient({ timeout: 600000 }); // 10 min for bulk ops

      console.log(`\nStarting bulk reindex of ${targets.length} site${targets.length !== 1 ? 's' : ''}...`);

      const result = await client.mutate<{ nexusFleetBulkReindex: any }>(`
        mutation($targets: [String!]!) {
          nexusFleetBulkReindex(targets: $targets) {
            success
            error
            results {
              target
              success
              error
              documentCount
            }
          }
        }
      `, { targets });

      const { success, error, results } = result.nexusFleetBulkReindex;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log('\nReindex Results:');
      console.log('─'.repeat(50));

      let successCount = 0;
      let failCount = 0;

      for (const r of results) {
        if (r.success) {
          successCount++;
          console.log(`  ✅ ${r.target} - ${r.documentCount} documents indexed`);
        } else {
          failCount++;
          console.log(`  ❌ ${r.target} - ${r.error}`);
        }
      }

      console.log('');
      console.log(`Summary: ${successCount} succeeded, ${failCount} failed`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

bulkCommand
  .command('plugin-update <targets...>')
  .description('Bulk plugin updates')
  .option('--plugin <slug>', 'Specific plugin to update')
  .option('--all', 'Update all plugins')
  .option('--dry-run', 'Show what would be updated')
  .action(async (targets, options) => {
    try {
      // Validate all targets
      for (const target of targets) {
        parseTarget(target);
      }

      if (!options.plugin && !options.all) {
        console.error('\n❌ Must specify --plugin=<slug> or --all');
        process.exit(1);
      }

      const client = getClient({ timeout: 600000 }); // 10 min for bulk ops

      console.log(`\nStarting bulk plugin update for ${targets.length} site${targets.length !== 1 ? 's' : ''}...`);
      if (options.dryRun) {
        console.log('  (dry run mode - no changes will be made)');
      }

      const result = await client.mutate<{ nexusFleetBulkPluginUpdate: any }>(`
        mutation($input: NexusFleetBulkPluginUpdateInput!) {
          nexusFleetBulkPluginUpdate(input: $input) {
            success
            error
            results {
              target
              success
              error
              updatedPlugins {
                slug
                oldVersion
                newVersion
              }
            }
          }
        }
      `, {
        input: {
          targets,
          plugin: options.plugin || null,
          all: options.all || false,
          dryRun: options.dryRun || false,
        },
      });

      const { success, error, results } = result.nexusFleetBulkPluginUpdate;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      console.log('\nPlugin Update Results:');
      console.log('─'.repeat(50));

      let successCount = 0;
      let failCount = 0;

      for (const r of results) {
        if (r.success) {
          successCount++;
          console.log(`  ✅ ${r.target}`);
          if (r.updatedPlugins.length > 0) {
            for (const plugin of r.updatedPlugins) {
              console.log(`     ${plugin.slug}: ${plugin.oldVersion} → ${plugin.newVersion}`);
            }
          }
        } else {
          failCount++;
          console.log(`  ❌ ${r.target} - ${r.error}`);
        }
      }

      console.log('');
      console.log(`Summary: ${successCount} succeeded, ${failCount} failed`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

bulkCommand
  .command('health-check <targets...>')
  .description('Bulk health check')
  .option('--json', 'Output as JSON')
  .action(async (targets, options) => {
    try {
      // Validate all targets
      for (const target of targets) {
        parseTarget(target);
      }

      const client = getClient({ timeout: 300000 }); // 5 min for bulk health

      console.log(`\nRunning health check on ${targets.length} site${targets.length !== 1 ? 's' : ''}...`);

      const result = await client.mutate<{ nexusFleetBulkHealthCheck: any }>(`
        mutation($targets: [String!]!) {
          nexusFleetBulkHealthCheck(targets: $targets) {
            success
            error
            results {
              target
              status
              score
              issueCount
            }
          }
        }
      `, { targets });

      const { success, error, results } = result.nexusFleetBulkHealthCheck;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log('\nHealth Check Results:');
      console.log('─'.repeat(50));

      for (const r of results) {
        const icon = r.status === 'healthy' ? '✅' : r.status === 'warning' ? '⚠️' : '❌';
        console.log(`  ${icon} ${r.target} - ${r.status} (score: ${r.score}/100, ${r.issueCount} issues)`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

fleetCommand.addCommand(bulkCommand);

// ============================================================================
// Comparison Command
// ============================================================================

fleetCommand
  .command('compare <target1> <target2>')
  .description('Compare two sites')
  .option('--json', 'Output as JSON')
  .action(async (target1, target2, options) => {
    try {
      parseTarget(target1);
      parseTarget(target2);

      const client = getClient();

      const result = await client.mutate<{ nexusFleetCompare: any }>(`
        mutation($target1: String!, $target2: String!) {
          nexusFleetCompare(target1: $target1, target2: $target2) {
            success
            error
            comparison {
              site1 {
                target
                wpVersion
                pluginCount
                themeCount
              }
              site2 {
                target
                wpVersion
                pluginCount
                themeCount
              }
              differences {
                category
                item
                site1Value
                site2Value
              }
            }
          }
        }
      `, { target1, target2 });

      const { success, error, comparison } = result.nexusFleetCompare;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(comparison, null, 2));
        return;
      }

      console.log(`\nSite Comparison`);
      console.log('─'.repeat(50));
      console.log(`Site 1: ${comparison.site1.target}`);
      console.log(`  WordPress: ${comparison.site1.wpVersion}`);
      console.log(`  Plugins: ${comparison.site1.pluginCount}, Themes: ${comparison.site1.themeCount}`);
      console.log('');
      console.log(`Site 2: ${comparison.site2.target}`);
      console.log(`  WordPress: ${comparison.site2.wpVersion}`);
      console.log(`  Plugins: ${comparison.site2.pluginCount}, Themes: ${comparison.site2.themeCount}`);
      console.log('');

      if (comparison.differences.length > 0) {
        console.log(`Differences (${comparison.differences.length}):`);
        for (const diff of comparison.differences) {
          console.log(`  [${diff.category}] ${diff.item}`);
          console.log(`    Site 1: ${diff.site1Value}`);
          console.log(`    Site 2: ${diff.site2Value}`);
          console.log('');
        }
      } else {
        console.log('  Sites are identical');
      }
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
 * nexus fleet refresh [--deep]
 */
fleetCommand
  .command('refresh')
  .description('Refresh the cached data (digital twin) for all local sites')
  .option('--deep', 'Start halted sites, do a full WP-CLI scan, then stop them again')
  .action(async (options) => {
    try {
      const client = getClient({ timeout: 600000 }); // 10 min for deep mode

      if (!options.deep) {
        // Standard: filesystem scan for halted, WP-CLI for running
        console.log('\nRefreshing twin for all sites...\n');

        const result = await client.mutate<{ nexusFleetRefresh: any }>(`
          mutation {
            nexusFleetRefresh {
              success
              error
              report
            }
          }
        `);

        const { success, error, report } = result.nexusFleetRefresh;
        if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
        console.log('\n' + report + '\n');
        return;
      }

      // Deep mode: start halted sites → full WP-CLI scan → stop them
      console.log('\n🔄 Deep refresh — halted sites will be briefly started for a full scan.\n');

      // Get all local sites
      const listResult = await client.mutate<{ nexusSitesList: any }>(`
        mutation {
          nexusSitesList {
            local { name status }
          }
        }
      `);

      const sites: Array<{ name: string; status: string }> = listResult.nexusSitesList.local;
      if (sites.length === 0) {
        console.log('No local sites found.');
        return;
      }

      const results: Array<{ name: string; outcome: string }> = [];

      for (const site of sites) {
        const wasHalted = site.status !== 'running';

        if (wasHalted) {
          process.stdout.write(`  ${site.name}  starting... `);
          const startResult = await client.mutate<{ nexusSitesStart: any }>(`
            mutation($target: String!) {
              nexusSitesStart(target: $target) { success error }
            }
          `, { target: site.name });

          if (!startResult.nexusSitesStart.success) {
            const msg = startResult.nexusSitesStart.error ?? 'failed to start';
            console.log(`❌ ${msg}`);
            results.push({ name: site.name, outcome: `❌ start failed: ${msg}` });
            continue;
          }
          process.stdout.write('started  ');
        } else {
          process.stdout.write(`  ${site.name}  already running  `);
        }

        // Refresh (full WP-CLI scan)
        process.stdout.write('scanning... ');
        const refreshResult = await client.mutate<{ nexusSiteRefresh: any }>(`
          mutation($target: String!, $force: Boolean) {
            nexusSiteRefresh(target: $target, force: $force) { success error }
          }
        `, { target: site.name, force: true });

        if (!refreshResult.nexusSiteRefresh.success) {
          const msg = refreshResult.nexusSiteRefresh.error ?? 'scan failed';
          process.stdout.write(`❌ ${msg}`);
        } else {
          process.stdout.write('scanned  ');
        }

        // Stop only if we started it
        if (wasHalted) {
          process.stdout.write('stopping... ');
          const stopResult = await client.mutate<{ nexusSitesStop: any }>(`
            mutation($target: String!) {
              nexusSitesStop(target: $target) { success error }
            }
          `, { target: site.name });

          if (!stopResult.nexusSitesStop.success) {
            const msg = stopResult.nexusSitesStop.error ?? 'failed to stop';
            console.log(`⚠️  ${msg}`);
            results.push({ name: site.name, outcome: `⚠️ scanned but stop failed: ${msg}` });
          } else {
            console.log('✅');
            results.push({ name: site.name, outcome: '✅ scanned' });
          }
        } else {
          console.log('✅');
          results.push({ name: site.name, outcome: '✅ scanned (was running, left running)' });
        }
      }

      console.log('\nSummary:');
      for (const r of results) {
        console.log(`  ${r.name}: ${r.outcome}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { fleetCommand };
