import { McpToolHandler, McpToolResult } from '../../types';
import { SiteDataResolver } from '../../../resolver/SiteDataResolver';

/**
 * Fleet-wide plugin audit — works for ALL sites regardless of running status.
 *
 * Data sources by site state:
 *   Running:           WP-CLI (fresh, authoritative)
 *   Halted+Configured: cached plugin list + WordPress.org update check
 *   Halted+Searchable: index snapshot (no update check possible)
 *   No data:           prompts to start site once
 */
export const pluginAuditHandler: McpToolHandler = {
  definition: {
    name: 'nexus_plugin_audit',
    description:
      'Fleet-wide plugin audit across all local sites — lists installed plugins with current and latest versions, available updates. ' +
      'Works even when sites are halted by using cached data (SiteMetadataCache) + WordPress.org API for update checks. ' +
      'Data freshness is reported per site. Running sites get real-time WP-CLI data.',
    inputSchema: { type: 'object', properties: {} },
    isAvailable: (services) => !!services.siteData,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const resolver = SiteDataResolver.fromServices(services);
    const sites = Object.values(services.siteData.getSites()) as any[];

    if (sites.length === 0) {
      return ok('No local sites found.');
    }

    const reports = await Promise.all(
      sites.map(async (site) => {
        const result = await resolver.getPluginsWithUpdateCheck(site.id);
        return { site, result };
      }),
    );

    const lines: string[] = ['## Fleet Plugin Audit', ''];
    let totalUpdates = 0;
    let sitesWithData = 0;

    for (const { site, result } of reports) {
      const { data: plugins, provenance } = result;
      const updates = plugins.filter(p => p.updateAvailable);
      totalUpdates += updates.length;
      if (plugins.length > 0) sitesWithData++;

      const emoji = SiteDataResolver.levelEmoji(provenance.level);
      const age = resolver.formatAge(provenance.ageSeconds);
      const sourceLabel = provenance.ageSeconds === 0 ? provenance.source : `${provenance.source}, ${age}`;

      lines.push(`### ${site.name} ${emoji}`);
      lines.push(`*${sourceLabel}*`);
      lines.push('');

      if (plugins.length === 0) {
        lines.push('No plugin data available — start site to populate cache.');
      } else {
        lines.push(`${plugins.length} plugins installed, ${updates.length} update${updates.length !== 1 ? 's' : ''} available`);
        if (updates.length > 0) {
          lines.push('');
          lines.push('**Updates available:**');
          for (const u of updates) {
            lines.push(`- ${u.name}: v${u.version} → v${u.updateAvailable}`);
          }
        }
      }

      if (provenance.caveat) {
        lines.push('');
        lines.push(`⚠️ ${provenance.caveat}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`**${totalUpdates} updates available across ${sitesWithData}/${sites.length} sites with data**`);
    lines.push('');
    lines.push('Legend: 🟢 live · 🟡 configured cache · 🔵 searchable index · ⚪ no data');

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
