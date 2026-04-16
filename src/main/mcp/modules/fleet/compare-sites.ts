import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { SiteStructure } from '../../../../common/types';
import { fleetFreshnessWarning } from '../../../twin/twin-helpers';

export const compareSitesHandler: McpToolHandler = {
  definition: {
    name: 'compare_sites',
    description:
      'Side-by-side comparison of two indexed sites — shared and unique plugins, version differences, WordPress/PHP version, and theme differences. Use to synchronize environments (e.g. confirm local matches WPE production), identify configuration drift, or plan migrations. Both sites must be indexed — run reindex_site if data is stale.' +
      'theme differences, user counts, and content volume. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        site_a: {
          type: 'string',
          description: 'First site — name, ID, or domain',
        },
        site_b: {
          type: 'string',
          description: 'Second site — name, ID, or domain',
        },
      },
      required: ['site_a', 'site_b'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const siteA = resolveSite(args.site_a as string, services.siteData);
    if (!siteA) return error(`Site "${args.site_a}" not found.`);

    const siteB = resolveSite(args.site_b as string, services.siteData);
    if (!siteB) return error(`Site "${args.site_b}" not found.`);

    const entryA = services.indexRegistry.get(siteA.id);
    if (!entryA?.structure) return error(`Site "${siteA.name}" has no index data.`);

    const entryB = services.indexRegistry.get(siteB.id);
    if (!entryB?.structure) return error(`Site "${siteB.name}" has no index data.`);

    const nameA = entryA.siteName || siteA.name;
    const nameB = entryB.siteName || siteB.name;
    const structA = entryA.structure;
    const structB = entryB.structure;

    const lines: string[] = [`## Site Comparison: ${nameA} vs ${nameB}`, ''];

    // Shared attributes
    const shared: string[] = [];
    if (structA.wpVersion === structB.wpVersion) {
      shared.push(`- WordPress ${structA.wpVersion}`);
    }
    if (structA.phpVersion === structB.phpVersion) {
      shared.push(`- PHP ${structA.phpVersion}`);
    }

    // Shared plugins
    const pluginsA = new Map(structA.plugins.map((p) => [p.slug, p]));
    const pluginsB = new Map(structB.plugins.map((p) => [p.slug, p]));

    for (const [slug, pA] of pluginsA) {
      const pB = pluginsB.get(slug);
      if (pB) {
        if (pA.version === pB.version) {
          shared.push(`- ${pA.name} v${pA.version}`);
        }
      }
    }

    if (shared.length > 0) {
      lines.push('### Shared');
      lines.push(...shared);
      lines.push('');
    }

    // Version differences (for shared components)
    const diffs: string[] = [];
    if (structA.wpVersion !== structB.wpVersion) {
      diffs.push(`- WordPress: ${structA.wpVersion} (${nameA}) vs ${structB.wpVersion} (${nameB})`);
    }
    if (structA.phpVersion !== structB.phpVersion) {
      diffs.push(`- PHP: ${structA.phpVersion} (${nameA}) vs ${structB.phpVersion} (${nameB})`);
    }
    for (const [slug, pA] of pluginsA) {
      const pB = pluginsB.get(slug);
      if (pB && pA.version !== pB.version) {
        diffs.push(`- ${pA.name}: v${pA.version} (${nameA}) vs v${pB.version} (${nameB})`);
      }
    }
    if (diffs.length > 0) {
      lines.push('### Version Differences');
      lines.push(...diffs);
      lines.push('');
    }

    // Only in A
    const onlyA: string[] = [];
    for (const [slug, pA] of pluginsA) {
      if (!pluginsB.has(slug)) {
        onlyA.push(`- ${pA.name} v${pA.version}`);
      }
    }
    const activeThemeA = structA.themes.find((t) => t.isActive);
    const activeThemeB = structB.themes.find((t) => t.isActive);
    if (activeThemeA) {
      onlyA.push(`- Theme: ${activeThemeA.name} (${activeThemeA.isActive ? 'active' : 'inactive'})`);
    }
    if (onlyA.length > 0) {
      lines.push(`### Only in ${nameA}`);
      lines.push(...onlyA);
      lines.push('');
    }

    // Only in B
    const onlyB: string[] = [];
    for (const [slug, pB] of pluginsB) {
      if (!pluginsA.has(slug)) {
        onlyB.push(`- ${pB.name} v${pB.version}`);
      }
    }
    if (activeThemeB) {
      onlyB.push(`- Theme: ${activeThemeB.name} (${activeThemeB.isActive ? 'active' : 'inactive'})`);
    }
    if (onlyB.length > 0) {
      lines.push(`### Only in ${nameB}`);
      lines.push(...onlyB);
      lines.push('');
    }

    // Content comparison
    lines.push('### Content');
    lines.push(`| | ${nameA} | ${nameB} |`);
    lines.push('|---|---|---|');
    lines.push(`| Documents | ${entryA.documentCount} | ${entryB.documentCount} |`);
    lines.push(`| Chunks | ${entryA.chunkCount} | ${entryB.chunkCount} |`);

    const usersA = structA.users?.totalUsers ?? '—';
    const usersB = structB.users?.totalUsers ?? '—';
    lines.push(`| Users | ${usersA} | ${usersB} |`);

    // Integration flags
    const integrations: string[] = [];
    if (structA.hasWooCommerce !== structB.hasWooCommerce) {
      integrations.push(`- WooCommerce: ${nameA}=${structA.hasWooCommerce}, ${nameB}=${structB.hasWooCommerce}`);
    }
    if (structA.hasACF !== structB.hasACF) {
      integrations.push(`- ACF: ${nameA}=${structA.hasACF}, ${nameB}=${structB.hasACF}`);
    }
    if (integrations.length > 0) {
      lines.push('');
      lines.push('### Integration Differences');
      lines.push(...integrations);
    }

    const warning = fleetFreshnessWarning([entryA, entryB]);
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
