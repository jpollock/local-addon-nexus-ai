/**
 * Audit Commands
 *
 * Composite multi-step audit workflows.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const auditCommand = new Command('audit').description('Site and plugin audits');

// ============================================================================
// Site Audit Command
// ============================================================================

auditCommand
  .command('site <target>')
  .description('Comprehensive audit of a WordPress site')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 120000 }); // 2 min for audit

      console.log(`\nAuditing ${target}...`);

      const result = await client.mutate<{ nexusAuditSite: any }>(`
        mutation($target: String!) {
          nexusAuditSite(target: $target) {
            success
            error
            audit {
              siteName
              wpVersion
              phpVersion
              plugins {
                name
                version
                status
                updateAvailable
                updateVersion
              }
              themes {
                name
                version
                status
                updateAvailable
              }
              health {
                status
                score
                issues {
                  severity
                  message
                }
              }
              security {
                outdatedPlugins
                outdatedThemes
                coreUpToDate
                phpUpToDate
              }
            }
          }
        }
      `, { target });

      const { success, error, audit } = result.nexusAuditSite;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(audit, null, 2));
        return;
      }

      console.log(`\n## Site Audit: ${audit.siteName}`);
      console.log('─'.repeat(50));
      console.log(`WordPress:     ${audit.wpVersion}`);
      console.log(`PHP:           ${audit.phpVersion}`);
      console.log('');

      // Plugins
      console.log(`### Plugins (${audit.plugins.length})`);
      const activePlugins = audit.plugins.filter((p: any) => p.status === 'active');
      const outdatedPlugins = audit.plugins.filter((p: any) => p.updateAvailable);
      console.log(`Active: ${activePlugins.length} | Outdated: ${outdatedPlugins.length}`);
      console.log('');

      if (outdatedPlugins.length > 0) {
        console.log('Updates Available:');
        for (const plugin of outdatedPlugins) {
          console.log(`  ${plugin.name}: ${plugin.version} → ${plugin.updateVersion}`);
        }
        console.log('');
      }

      // Themes
      console.log(`### Themes (${audit.themes.length})`);
      const outdatedThemes = audit.themes.filter((t: any) => t.updateAvailable);
      if (outdatedThemes.length > 0) {
        console.log(`${outdatedThemes.length} update${outdatedThemes.length !== 1 ? 's' : ''} available`);
      } else {
        console.log('All themes up to date');
      }
      console.log('');

      // Health
      const healthIcon = audit.health.status === 'good' ? '✅' : audit.health.status === 'recommended' ? '⚠️' : '❌';
      console.log(`### Site Health: ${healthIcon} ${audit.health.status}`);
      console.log(`Score: ${audit.health.score}/100`);

      if (audit.health.issues && audit.health.issues.length > 0) {
        console.log(`\nIssues (${audit.health.issues.length}):`);
        for (const issue of audit.health.issues) {
          const icon = issue.severity === 'critical' ? '❌' : '⚠️';
          console.log(`  ${icon} ${issue.message}`);
        }
      }
      console.log('');

      // Security Summary
      console.log('### Security Summary');
      const securityIcon = audit.security.outdatedPlugins === 0 &&
                          audit.security.outdatedThemes === 0 &&
                          audit.security.coreUpToDate &&
                          audit.security.phpUpToDate ? '✅' : '⚠️';
      console.log(`Status: ${securityIcon}`);
      console.log(`Outdated Plugins: ${audit.security.outdatedPlugins}`);
      console.log(`Outdated Themes: ${audit.security.outdatedThemes}`);
      console.log(`Core Up-to-date: ${audit.security.coreUpToDate ? 'Yes' : 'No'}`);
      console.log(`PHP Up-to-date: ${audit.security.phpUpToDate ? 'Yes' : 'No'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Plugin Audit Command
// ============================================================================

auditCommand
  .command('plugins')
  .description('Fleet-wide plugin audit across all running sites')
  .option('--json', 'Output as JSON')
  .option('--filter-outdated', 'Show only sites with outdated plugins')
  .action(async (options) => {
    try {
      const client = getClient({ timeout: 300000 }); // 5 min for fleet audit

      console.log('\nAuditing plugins across all running sites...\n');

      const result = await client.mutate<{ nexusAuditPlugins: any }>(`
        mutation {
          nexusAuditPlugins {
            success
            error
            report {
              totalSites
              sitesAudited
              totalPlugins
              outdatedPlugins
              sites {
                siteName
                pluginCount
                activePlugins
                outdatedCount
                plugins {
                  name
                  version
                  status
                  updateAvailable
                  updateVersion
                }
              }
            }
          }
        }
      `, {});

      const { success, error, report } = result.nexusAuditPlugins;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log('## Fleet Plugin Audit');
      console.log('─'.repeat(50));
      console.log(`Sites Audited:     ${report.sitesAudited}/${report.totalSites}`);
      console.log(`Total Plugins:     ${report.totalPlugins}`);
      console.log(`Outdated Plugins:  ${report.outdatedPlugins}`);
      console.log('');

      // Filter sites if requested
      let sites = report.sites;
      if (options.filterOutdated) {
        sites = sites.filter((s: any) => s.outdatedCount > 0);
      }

      if (sites.length === 0) {
        if (options.filterOutdated) {
          console.log('✅ All sites have up-to-date plugins!');
        } else {
          console.log('No sites to display');
        }
        console.log('');
        return;
      }

      // Per-site breakdown
      console.log('### Per-Site Breakdown');
      console.log('');

      for (const site of sites) {
        const icon = site.outdatedCount === 0 ? '✅' : '⚠️';
        console.log(`${icon} **${site.siteName}**`);
        console.log(`   Plugins: ${site.pluginCount} (${site.activePlugins} active, ${site.outdatedCount} outdated)`);

        if (site.outdatedCount > 0) {
          console.log('   Updates Available:');
          const outdated = site.plugins.filter((p: any) => p.updateAvailable);
          for (const plugin of outdated) {
            console.log(`     - ${plugin.name}: ${plugin.version} → ${plugin.updateVersion}`);
          }
        }
        console.log('');
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { auditCommand };
