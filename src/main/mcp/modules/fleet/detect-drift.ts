import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { IndexEntry } from '../../../../common/types';

interface DriftItem {
  type: 'version_mismatch' | 'missing_plugin' | 'extra_plugin' | 'wp_version' | 'php_version' | 'theme_diff';
  description: string;
}

export const detectDriftHandler: McpToolHandler = {
  definition: {
    name: 'detect_drift',
    description:
      'Compare a baseline site against other indexed sites to detect configuration drift — plugin version differences, missing or extra plugins, WordPress/PHP version mismatches. Use to ensure multiple sites (e.g. a network of similar sites) stay in sync. For local-vs-WPE drift detection, use wpe_detect_drift instead.' +
      'Reports plugin version mismatches, missing/extra plugins, and WordPress/PHP version differences. ' +
      'Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        baseline_site: {
          type: 'string',
          description: 'The reference site to compare against — name, ID, or domain',
        },
        compare_sites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific sites to compare (default: all other indexed sites)',
        },
      },
      required: ['baseline_site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const baselineSite = resolveSite(args.baseline_site as string, services.siteData);
    if (!baselineSite) return error(`Baseline site "${args.baseline_site}" not found.`);

    const baselineEntry = services.indexRegistry.get(baselineSite.id);
    if (!baselineEntry?.structure) {
      return error(`Baseline site "${baselineSite.name}" has no index data.`);
    }

    // Determine comparison targets
    let targets: IndexEntry[];
    const compareSiteNames = args.compare_sites as string[] | undefined;

    if (compareSiteNames && compareSiteNames.length > 0) {
      targets = [];
      for (const name of compareSiteNames) {
        const site = resolveSite(name, services.siteData);
        if (!site) return error(`Comparison site "${name}" not found.`);
        const entry = services.indexRegistry.get(site.id);
        if (!entry?.structure) return error(`Comparison site "${site.name}" has no index data.`);
        targets.push(entry);
      }
    } else {
      targets = services.indexRegistry
        .listAll()
        .filter((e) => e.siteId !== baselineSite.id && e.structure);
    }

    if (targets.length === 0) {
      return ok('No other indexed sites to compare against.');
    }

    const baselineName = baselineEntry.siteName || baselineSite.name;
    const baselineStruct = baselineEntry.structure;
    const baselinePlugins = new Map(baselineStruct.plugins.map((p) => [p.slug, p]));
    const baselineActiveTheme = baselineStruct.themes.find((t) => t.isActive);

    const lines: string[] = [`## Drift Report: baseline = "${baselineName}"`, ''];

    for (const target of targets) {
      const targetName = target.siteName || target.siteId;
      const targetStruct = target.structure!;
      const drifts: DriftItem[] = [];

      // WordPress version
      if (targetStruct.wpVersion !== baselineStruct.wpVersion) {
        drifts.push({
          type: 'wp_version',
          description: `WordPress: ${baselineStruct.wpVersion} (baseline) vs ${targetStruct.wpVersion} (target)`,
        });
      }

      // PHP version
      if (targetStruct.phpVersion !== baselineStruct.phpVersion) {
        drifts.push({
          type: 'php_version',
          description: `PHP: ${baselineStruct.phpVersion} (baseline) vs ${targetStruct.phpVersion} (target)`,
        });
      }

      // Theme
      const targetActiveTheme = targetStruct.themes.find((t) => t.isActive);
      if (baselineActiveTheme && targetActiveTheme &&
          baselineActiveTheme.slug !== targetActiveTheme.slug) {
        drifts.push({
          type: 'theme_diff',
          description: `Active theme: ${baselineActiveTheme.name} (baseline) vs ${targetActiveTheme.name} (target)`,
        });
      }

      // Plugin comparison
      const targetPlugins = new Map(targetStruct.plugins.map((p) => [p.slug, p]));

      for (const [slug, basePlugin] of baselinePlugins) {
        const targetPlugin = targetPlugins.get(slug);
        if (!targetPlugin) {
          drifts.push({
            type: 'missing_plugin',
            description: `Missing plugin: ${basePlugin.name}`,
          });
        } else if (targetPlugin.version !== basePlugin.version) {
          drifts.push({
            type: 'version_mismatch',
            description: `${basePlugin.name}: ${basePlugin.version} (baseline) vs ${targetPlugin.version} (target)`,
          });
        }
      }

      for (const [slug, targetPlugin] of targetPlugins) {
        if (!baselinePlugins.has(slug)) {
          drifts.push({
            type: 'extra_plugin',
            description: `Extra plugin: ${targetPlugin.name} (not in baseline)`,
          });
        }
      }

      lines.push(`### ${targetName} (${drifts.length} drift${drifts.length !== 1 ? 's' : ''})`);
      if (drifts.length === 0) {
        lines.push('- All aligned \u2713');
      } else {
        for (const d of drifts) {
          lines.push(`- ${d.description}`);
        }
      }
      lines.push('');
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
