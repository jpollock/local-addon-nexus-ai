import type { McpToolHandler, McpToolResult } from '../../types';
import { DAY_MS } from '../../../twin/twin-helpers';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetSummaryHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_summary',
    description:
      'Get a summary of LOCAL sites from cached twin data: WordPress and PHP version distribution, ' +
      'twin completeness breakdown (none/filesystem/metadata/indexed), recent post activity, and stale site count. ' +
      'LOCAL SITES ONLY — does not include WP Engine installs. ' +
      'For WPE installs, use wpe_fleet_versions or fleet_sql. ' +
      'No live calls — instant response from cache.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'Fleet Summary', readOnlyHint: true },
  },

  async execute(_args, services): Promise<McpToolResult> {
    if (!services.twinService) {
      return ok('Twin service is not available. Ensure Local is running with the Nexus AI addon active.');
    }

    const MONTH_MS = 30 * DAY_MS;
    const now = Date.now();
    const twins = services.twinService.getAll() ?? [];

    if (twins.length === 0) {
      return ok('No sites found. Are any sites loaded in Local?');
    }

    const completeness = { none: 0, filesystem: 0, metadata: 0, indexed: 0 };
    let staleCount = 0;
    let neverScannedCount = 0;
    let recentActivityCount = 0;

    const wpVersionMap = new Map<string, number>();
    const phpVersionMap = new Map<string, number>();

    for (const twin of twins) {
      completeness[twin.completeness]++;

      if (twin.asOf && now - twin.asOf > DAY_MS) staleCount++;
      if (twin.completeness === 'none') neverScannedCount++;
      if (twin.lastPostAt && now - twin.lastPostAt < MONTH_MS) recentActivityCount++;

      const wpV = twin.wpVersion ?? 'unknown';
      wpVersionMap.set(wpV, (wpVersionMap.get(wpV) ?? 0) + 1);

      const phpV = twin.phpVersion ?? 'unknown';
      phpVersionMap.set(phpV, (phpVersionMap.get(phpV) ?? 0) + 1);
    }

    const sitesWithFullData = twins.filter(
      t => t.completeness === 'metadata' || t.completeness === 'indexed'
    ).length;

    const sortVersions = (map: Map<string, number>) => {
      const entries = Array.from(map.entries()).map(([version, count]) => ({ version, count }));
      entries.sort((a, b) => {
        if (a.version === 'unknown') return 1;
        if (b.version === 'unknown') return -1;
        return b.count - a.count;
      });
      return entries;
    };

    const wpVersions = sortVersions(wpVersionMap);
    const phpVersions = sortVersions(phpVersionMap);

    const lines: string[] = [
      '## Fleet Summary',
      '',
      `**Total sites:** ${twins.length} (${sitesWithFullData} with full WP-CLI data)`,
      '',
    ];

    // WordPress versions
    if (wpVersions.length > 0) {
      lines.push('### WordPress Versions');
      lines.push('');
      for (const { version, count } of wpVersions) {
        lines.push(`- **${version}**: ${count} site${count !== 1 ? 's' : ''}`);
      }
      lines.push('');
    }

    // PHP versions
    if (phpVersions.length > 0) {
      lines.push('### PHP Versions');
      lines.push('');
      for (const { version, count } of phpVersions) {
        lines.push(`- **${version}**: ${count} site${count !== 1 ? 's' : ''}`);
      }
      lines.push('');
    }

    // Completeness
    lines.push('### Twin Completeness');
    lines.push('');
    if (completeness.indexed > 0)    lines.push(`- ✅ **indexed**: ${completeness.indexed} site${completeness.indexed !== 1 ? 's' : ''}`);
    if (completeness.metadata > 0)   lines.push(`- ✅ **metadata**: ${completeness.metadata} site${completeness.metadata !== 1 ? 's' : ''}`);
    if (completeness.filesystem > 0) lines.push(`- 🔶 **filesystem**: ${completeness.filesystem} site${completeness.filesystem !== 1 ? 's' : ''}`);
    if (completeness.none > 0)       lines.push(`- ❌ **none**: ${completeness.none} site${completeness.none !== 1 ? 's' : ''}`);
    lines.push('');

    // Activity & freshness
    lines.push('### Activity & Freshness');
    lines.push('');
    lines.push(`- **Recent activity (last 30d):** ${recentActivityCount} site${recentActivityCount !== 1 ? 's' : ''}`);
    lines.push(`- **Stale twins (> 24h):** ${staleCount} site${staleCount !== 1 ? 's' : ''}`);
    lines.push(`- **Never scanned:** ${neverScannedCount} site${neverScannedCount !== 1 ? 's' : ''}`);

    if (staleCount > 0) {
      lines.push('');
      lines.push('> Run `nexus fleet refresh` to update stale twins.');
    }
    if (neverScannedCount > 0) {
      lines.push('> Run `nexus fleet refresh --deep` to populate never-scanned sites.');
    }

    return ok(lines.join('\n'));
  },
};
