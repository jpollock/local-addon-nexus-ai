import { McpToolHandler, McpToolResult } from '../../types';
import { IndexEntry, PluginInfo } from '../../../../common/types';
import { groupByVersion } from './version-utils';

export const fleetSummaryHandler: McpToolHandler = {
  definition: {
    name: 'fleet_summary',
    description:
      'Aggregate overview across all indexed WordPress sites. Shows WordPress/PHP version distribution, ' +
      'most common plugins, content totals, and key integrations. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const entries = services.indexRegistry.listAll();
    const totalSites = Object.keys(services.siteData.getSites()).length;

    if (entries.length === 0) {
      return ok(
        `## Fleet Summary\n\n**Sites:** 0 indexed / ${totalSites} in Local\n\n` +
        'No sites have been indexed yet. Start a site in Local to trigger indexing.',
      );
    }

    const indexed = entries.filter((e) => e.structure);
    const lines: string[] = ['## Fleet Summary', ''];
    lines.push(`**Sites:** ${entries.length} indexed / ${totalSites} in Local`);

    // WordPress version distribution
    const wpEntries = indexed.filter((e) => e.structure!.wpVersion);
    if (wpEntries.length > 0) {
      lines.push('', '### WordPress Versions');
      const wpGroups = groupByVersion(wpEntries, (e) => e.structure!.wpVersion);
      for (const [version, sites] of wpGroups) {
        lines.push(`- ${version}: ${sites.length} site${sites.length !== 1 ? 's' : ''}`);
      }
    }

    // PHP version distribution
    const phpEntries = indexed.filter((e) => e.structure!.phpVersion);
    if (phpEntries.length > 0) {
      lines.push('', '### PHP Versions');
      const phpGroups = groupByVersion(phpEntries, (e) => e.structure!.phpVersion);
      for (const [version, sites] of phpGroups) {
        lines.push(`- ${version}: ${sites.length} site${sites.length !== 1 ? 's' : ''}`);
      }
    }

    // Most common plugins (top 10)
    const pluginMap = new Map<string, { info: PluginInfo; siteCount: number; activeCount: number }>();
    for (const entry of indexed) {
      for (const plugin of entry.structure!.plugins) {
        const key = plugin.slug;
        const existing = pluginMap.get(key);
        if (existing) {
          existing.siteCount++;
          if (plugin.isActive) existing.activeCount++;
          // Keep the latest version info
          if (plugin.version > existing.info.version) {
            existing.info = plugin;
          }
        } else {
          pluginMap.set(key, {
            info: plugin,
            siteCount: 1,
            activeCount: plugin.isActive ? 1 : 0,
          });
        }
      }
    }

    if (pluginMap.size > 0) {
      const sorted = Array.from(pluginMap.values())
        .sort((a, b) => b.siteCount - a.siteCount)
        .slice(0, 10);

      lines.push('', '### Most Common Plugins');
      sorted.forEach((p, i) => {
        lines.push(
          `${i + 1}. ${p.info.name} v${p.info.version} — ` +
          `${p.siteCount} site${p.siteCount !== 1 ? 's' : ''} (${p.activeCount} active)`,
        );
      });
    }

    // Content totals
    const totalDocs = entries.reduce((sum, e) => sum + e.documentCount, 0);
    const totalChunks = entries.reduce((sum, e) => sum + e.chunkCount, 0);
    lines.push('', '### Content');
    lines.push(`- Total documents: ${totalDocs}`);
    lines.push(`- Total chunks: ${totalChunks}`);

    // Key integrations
    const wooCount = indexed.filter((e) => e.structure!.hasWooCommerce).length;
    const acfCount = indexed.filter((e) => e.structure!.hasACF).length;
    if (wooCount > 0 || acfCount > 0) {
      lines.push('', '### Key Integrations');
      if (wooCount > 0) lines.push(`- WooCommerce: ${wooCount} site${wooCount !== 1 ? 's' : ''}`);
      if (acfCount > 0) lines.push(`- ACF: ${acfCount} site${acfCount !== 1 ? 's' : ''}`);
    }

    // Stale/error entries
    const staleCount = entries.filter((e) => e.state === 'stale').length;
    const errorCount = entries.filter((e) => e.state === 'error').length;
    if (staleCount > 0 || errorCount > 0) {
      lines.push('', '### Warnings');
      if (staleCount > 0) lines.push(`- ${staleCount} site${staleCount !== 1 ? 's' : ''} with stale indexes`);
      if (errorCount > 0) lines.push(`- ${errorCount} site${errorCount !== 1 ? 's' : ''} with index errors`);
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
