import { McpToolHandler, McpToolResult } from '../../types';
import { IndexEntry } from '../../../../common/types';
import { groupByVersion, compareVersions } from './version-utils';

export const findOutdatedSitesHandler: McpToolHandler = {
  definition: {
    name: 'find_outdated_sites',
    description:
      'Identify sites running older versions of WordPress, PHP, or plugins compared to other sites ' +
      'in your fleet. Each site is labeled [local] or [wpe] so you can see which are live WP Engine ' +
      'environments vs local development copies. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          enum: ['wordpress', 'php', 'plugins'],
          description: 'Which component to check (default: all)',
        },
        source: {
          type: 'string',
          enum: ['local', 'wpe', 'all'],
          description: 'Filter to local sites, WP Engine installs, or all (default: all)',
        },
      },
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const component = args.component as string | undefined;
    const sourceFilter = (args.source as string | undefined) ?? 'all';

    const entries = services.indexRegistry.listAll();
    let indexed = entries.filter((e) => e.structure);

    if (indexed.length === 0) {
      return ok('No indexed sites with structure data available.');
    }

    // Enrich entries with source info from the graph DB
    const graphService = (services as any).graphService;
    const sourceMap = new Map<string, 'local' | 'wpe'>();
    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          const rows = db.prepare('SELECT id, source FROM sites').all() as Array<{ id: string; source: string }>;
          for (const row of rows) {
            sourceMap.set(row.id, (row.source ?? 'local') as 'local' | 'wpe');
          }
        }
      } catch { /* graph not available — continue without source info */ }
    }

    // Apply source filter
    if (sourceFilter !== 'all') {
      indexed = indexed.filter((e) => (sourceMap.get(e.siteId) ?? 'local') === sourceFilter);
      if (indexed.length === 0) {
        return ok(`No indexed ${sourceFilter === 'wpe' ? 'WP Engine' : 'local'} sites with version data available.`);
      }
    }

    if (indexed.length === 1) {
      return ok('Only one indexed site matches — need at least two to compare versions.');
    }

    // Attach source label to each entry for display
    const withSource = indexed.map((e) => ({
      ...e,
      _source: sourceMap.get(e.siteId) ?? 'local' as 'local' | 'wpe',
    }));

    const sourceLabel = sourceFilter === 'wpe' ? ' (WP Engine installs only)'
      : sourceFilter === 'local' ? ' (local sites only)' : '';
    const lines: string[] = [`## Outdated Sites Report${sourceLabel}`, ''];
    const checkAll = !component;

    if (checkAll || component === 'wordpress') {
      lines.push(...formatVersionSection('WordPress', withSource, (e) => e.structure!.wpVersion));
    }
    if (checkAll || component === 'php') {
      lines.push(...formatVersionSection('PHP', withSource, (e) => e.structure!.phpVersion));
    }
    if (checkAll || component === 'plugins') {
      lines.push(...formatPluginMismatches(withSource));
    }

    return ok(lines.join('\n'));
  },
};

type EnrichedEntry = IndexEntry & { _source: 'local' | 'wpe' };

function siteLabel(e: EnrichedEntry): string {
  return `${e.siteName || e.siteId} [${e._source}]`;
}

function formatVersionSection(
  label: string,
  entries: EnrichedEntry[],
  getVersion: (e: EnrichedEntry) => string,
): string[] {
  const lines: string[] = [`### ${label}`];
  const groups = groupByVersion(entries as any, getVersion as any) as Map<string, EnrichedEntry[]>;

  if (groups.size <= 1) {
    const [version] = groups.keys();
    lines.push(`- All sites on ${version} \u2713`);
    lines.push('');
    return lines;
  }

  const versions = Array.from(groups.keys()); // sorted newest-first
  const latest = versions[0];

  for (const [version, sites] of groups) {
    const names = sites.map((s) => siteLabel(s)).join(', ');
    if (version === latest) {
      lines.push(`- Latest: ${version} (${sites.length} site${sites.length !== 1 ? 's' : ''})`);
    } else {
      lines.push(`- Outdated: ${version} (${sites.length} site${sites.length !== 1 ? 's' : ''}) — ${names}`);
    }
  }

  lines.push('');
  return lines;
}

function formatPluginMismatches(entries: EnrichedEntry[]): string[] {
  const lines: string[] = ['### Plugin Version Mismatches'];

  // Collect all plugin versions across sites
  const pluginVersions = new Map<string, Map<string, string[]>>();
  for (const entry of entries) {
    for (const plugin of entry.structure!.plugins) {
      let versions = pluginVersions.get(plugin.slug);
      if (!versions) {
        versions = new Map<string, string[]>();
        pluginVersions.set(plugin.slug, versions);
      }
      const siteName = siteLabel(entry as EnrichedEntry);
      const siteList = versions.get(plugin.version);
      if (siteList) {
        siteList.push(siteName);
      } else {
        versions.set(plugin.version, [siteName]);
      }
    }
  }

  // Filter to plugins on multiple sites with version differences
  let mismatches = 0;
  for (const [slug, versions] of pluginVersions) {
    if (versions.size <= 1) continue;

    const sorted = Array.from(versions.entries())
      .sort(([a], [b]) => compareVersions(b, a));

    const parts = sorted.map(([v, sites]) => {
      const siteCount = sites.length;
      if (siteCount <= 2) {
        return `${v} (${siteCount} site${siteCount !== 1 ? 's' : ''}: ${sites.join(', ')})`;
      }
      return `${v} (${siteCount} sites)`;
    });

    lines.push(`- ${slug}: ${parts.join(' vs ')}`);
    mismatches++;
  }

  if (mismatches === 0) {
    lines.push('- No plugin version mismatches detected \u2713');
  }

  lines.push('');
  return lines;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
