/**
 * nexus_get_site_twin — return the assembled digital twin for a site.
 *
 * This is the primary read path for AI agents that need a complete,
 * freshness-aware view of a site. Unlike tools that read one store at a
 * time, the twin assembles everything into a single structured response
 * with per-field provenance.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { freshnessFooter } from '../../../twin/twin-helpers';

export const getSiteTwinHandler: McpToolHandler = {
  definition: {
    name: 'nexus_get_site_twin',
    description:
      'Get the complete digital twin for a Local site — a unified, freshness-aware snapshot ' +
      'of everything Nexus knows about the site: WP version, PHP, plugins (with active status), ' +
      'themes, post counts, content index state, WPE link, and usage metrics. ' +
      'Each field carries provenance (how it was obtained, how old it is). ' +
      'Use this before answering questions about a site — it tells you what you know and ' +
      'how confident you should be. Call nexus_site_refresh first if data is missing or stale.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        show_sources: {
          type: 'boolean',
          description: 'Include per-field provenance (source method + age) in output. Default: false',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found`);

    const twinService = services.twinService;
    if (!twinService) return error('Digital twin service not available');

    const twin = twinService.get(site.id);
    if (!twin) return error(`No twin found for site "${args.site}"`);

    const report = twinService.format(twin, { showSources: !!(args.show_sources) });
    const freshness = twinService.getFreshness(twin);

    const lines: string[] = [report];

    if (twin.completeness === 'none') {
      lines.push('');
      lines.push('> **No data available.** Run `nexus_site_refresh` to populate the twin.');
    } else if (freshness.staleFields.length > 0) {
      lines.push('');
      lines.push(`> ⚠️ ${freshness.staleFields.length} field(s) are > 24h old. Consider running \`nexus_site_refresh\`.`);
    }

    if (freshness.requiresRunningFields.length > 0 && twin.completeness === 'filesystem') {
      lines.push('');
      lines.push(`> 🔶 Some fields (${freshness.requiresRunningFields.slice(0, 3).join(', ')}…) require the site to be running.`);
    }

    const footer = freshnessFooter(twin);
    if (footer) { lines.push(''); lines.push(footer); }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
