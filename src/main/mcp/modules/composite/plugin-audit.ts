import { McpToolHandler, McpToolResult } from '../../types';
import { WpPlugin } from '../../local-services-bridge';
import { ok, error } from '../wp-cli/preflight';

interface UpdateInfo {
  name: string;
  version: string;
  update_version?: string;
}

interface SitePluginReport {
  siteName: string;
  plugins: WpPlugin[];
  updatesAvailable: UpdateInfo[];
  error?: string;
}

/**
 * Composite tool: audits plugins across all running local sites.
 * For each running site, fetches the plugin list and checks for updates.
 * Returns a fleet-wide report.
 */
export const pluginAuditHandler: McpToolHandler = {
  definition: {
    name: 'nexus_plugin_audit',
    description:
      'Fleet-wide plugin audit across all running local sites — lists installed plugins with current and latest versions, available updates, and update availability counts per site. Runs in a single call, more efficient than calling wp_plugin_list on each site individually. LOCAL SITES ONLY — runs on currently running sites. For WPE remote installs, use wp_plugin_list with install_name= for each install.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const ls = services.localServices!;
    const sites = Object.values(services.siteData.getSites());
    const statuses = ls.getAllSiteStatuses();

    const runningSites = sites.filter((s) => statuses[s.id] === 'running');

    if (runningSites.length === 0) {
      return error('No running sites found. Start at least one site first.');
    }

    // Audit each running site in parallel
    const reports = await Promise.all(
      runningSites.map(async (site): Promise<SitePluginReport> => {
        try {
          const [plugins, updateResult] = await Promise.allSettled([
            ls.getPlugins(site.id),
            ls.wpCliRun(site.id, ['plugin', 'update', '--all', '--dry-run', '--format=json']),
          ]);

          if (plugins.status === 'rejected') {
            return {
              siteName: site.name,
              plugins: [],
              updatesAvailable: [],
              error: plugins.reason instanceof Error ? plugins.reason.message : String(plugins.reason),
            };
          }

          const pluginList = plugins.value;

          let updatesAvailable: UpdateInfo[] = [];
          if (updateResult.status === 'fulfilled' && updateResult.value.success) {
            try {
              updatesAvailable = JSON.parse(updateResult.value.stdout || '[]');
            } catch {
              // parse failed — skip updates
            }
          }

          return { siteName: site.name, plugins: pluginList, updatesAvailable };
        } catch (err) {
          return {
            siteName: site.name,
            plugins: [],
            updatesAvailable: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    // Build report
    const lines: string[] = [
      `## Fleet Plugin Audit (${runningSites.length} sites)`,
      '',
    ];

    let totalPlugins = 0;
    let totalUpdates = 0;

    for (const report of reports) {
      lines.push(`### ${report.siteName}`);

      if (report.error) {
        lines.push(`Error: ${report.error}`);
        lines.push('');
        continue;
      }

      totalPlugins += report.plugins.length;
      totalUpdates += report.updatesAvailable.length;

      if (report.plugins.length === 0) {
        lines.push('No plugins installed.');
        lines.push('');
        continue;
      }

      lines.push(`${report.plugins.length} plugins, ${report.updatesAvailable.length} updates available`);
      lines.push('');

      if (report.updatesAvailable.length > 0) {
        lines.push('| Plugin | Current | Available |');
        lines.push('|--------|---------|-----------|');
        for (const u of report.updatesAvailable) {
          lines.push(`| ${u.name} | v${u.version} | v${u.update_version ?? 'unknown'} |`);
        }
        lines.push('');
      }
    }

    // Summary
    lines.push('---');
    lines.push(`**Total:** ${totalPlugins} plugins across ${runningSites.length} sites, ${totalUpdates} updates available`);

    return ok(lines.join('\n'));
  },
};
