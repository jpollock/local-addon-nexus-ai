import { McpToolHandler, McpToolResult } from '../../types';
import { IndexEntry } from '../../../../common/types';
import { groupByVersion, compareVersions } from './version-utils';

export const findOutdatedSitesHandler: McpToolHandler = {
  definition: {
    name: 'find_outdated_sites',
    description:
      'Identify sites running older versions of WordPress, PHP, or plugins compared to other sites ' +
      'in your fleet. Flags version mismatches across sites. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          enum: ['wordpress', 'php', 'plugins'],
          description: 'Which component to check (default: all)',
        },
      },
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const component = args.component as string | undefined;
    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e) => e.structure);

    if (indexed.length === 0) {
      return ok('No indexed sites with structure data available.');
    }

    if (indexed.length === 1) {
      return ok('Only one indexed site — need at least two sites to compare versions.');
    }

    const lines: string[] = ['## Outdated Sites Report', ''];
    const checkAll = !component;

    if (checkAll || component === 'wordpress') {
      lines.push(...formatVersionSection(
        'WordPress',
        indexed,
        (e) => e.structure!.wpVersion,
      ));
    }

    if (checkAll || component === 'php') {
      lines.push(...formatVersionSection(
        'PHP',
        indexed,
        (e) => e.structure!.phpVersion,
      ));
    }

    if (checkAll || component === 'plugins') {
      lines.push(...formatPluginMismatches(indexed));
    }

    return ok(lines.join('\n'));
  },
};

function formatVersionSection(
  label: string,
  entries: IndexEntry[],
  getVersion: (e: IndexEntry) => string,
): string[] {
  const lines: string[] = [`### ${label}`];
  const groups = groupByVersion(entries, getVersion);

  if (groups.size <= 1) {
    const [version] = groups.keys();
    lines.push(`- All sites on ${version} \u2713`);
    lines.push('');
    return lines;
  }

  const versions = Array.from(groups.keys()); // sorted newest-first
  const latest = versions[0];

  for (const [version, sites] of groups) {
    const names = sites.map((s) => s.siteName || s.siteId).join(', ');
    if (version === latest) {
      lines.push(`- Latest: ${version} (${sites.length} site${sites.length !== 1 ? 's' : ''})`);
    } else {
      lines.push(`- Outdated: ${version} (${sites.length} site${sites.length !== 1 ? 's' : ''}) — ${names}`);
    }
  }

  lines.push('');
  return lines;
}

function formatPluginMismatches(entries: IndexEntry[]): string[] {
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
      const siteName = entry.siteName || entry.siteId;
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
