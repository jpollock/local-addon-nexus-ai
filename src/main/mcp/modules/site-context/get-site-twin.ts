/**
 * nexus_get_site_twin — return the assembled digital twin for a site.
 *
 * This is the primary read path for AI agents that need a complete,
 * freshness-aware view of a site. Unlike tools that read one store at a
 * time, the twin assembles everything into a single structured response
 * with per-field provenance.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';
import { freshnessFooter } from '../../../twin/twin-helpers';

/**
 * Callers (including chat agents) sometimes pass full target syntax
 * (`ssh:alias@env`, `wpe:account/install@env`) even though this tool's
 * `site` argument is documented as a bare name/ID/domain. Strip the prefix
 * so both forms resolve to the same graph lookup by name.
 */
function extractLookupName(query: string): string {
  const sshMatch = query.match(/^ssh:([^@]+)/);
  if (sshMatch) return sshMatch[1];
  const wpeMatch = query.match(/^wpe:(?:[^/]+\/)?([^@]+)/);
  if (wpeMatch) return wpeMatch[1];
  return query;
}

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
    const twinService = services.twinService;
    if (!twinService) return error('Digital twin service not available');

    // WP-58: local-then-graph, with the graph reached only on a MISS, cannot
    // see a name that means both — and under the decline the local half now
    // returns nothing for exactly those names, so the graph half would have
    // answered about the install as if it had been asked for. `resolveAnySite`
    // consults both stores before answering.
    const graphService = (services as any).graphService;
    const raw = args.site as string;
    let resolved = resolveAnySite(raw, services.siteData, graphService);

    // A bare `ssh:<alias>` (no environment suffix) is not a parseable target,
    // so it reaches the bare-name path as a whole string and matches nothing.
    // This tool has always tolerated that spelling; keep the tolerance as a
    // fallback rather than dropping it on the way past.
    const lookup = extractLookupName(raw);
    if (resolved.kind === 'none' && lookup !== raw) {
      resolved = resolveAnySite(lookup, services.siteData, graphService);
    }

    if (resolved.kind === 'none') {
      return error(`Site "${raw}" not found`);
    }
    if (resolved.kind === 'ambiguous') {
      return error(
        `"${raw}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`,
      );
    }

    let twin;
    if (resolved.source === 'local') {
      twin = twinService.get(resolved.id);
      if (!twin) return error(`No twin found for site "${raw}"`);
    } else {
      const db = graphService?.getDb?.();
      const graphSite = db.prepare('SELECT * FROM sites WHERE id = ?').get(resolved.id);
      twin = twinService.getFromGraph(graphSite, graphService);
    }

    const report = twinService.format(twin, { showSources: !!(args.show_sources) });
    const freshness = twinService.getFreshness(twin);

    const lines: string[] = [report];

    if (twin.completeness === 'none') {
      lines.push('');
      lines.push('> **No data available.** Run `nexus_site_refresh` to populate the twin.');
    } else if (twin.completeness === 'filesystem' || twin.completeness === 'metadata') {
      // Surface per-field canAnswer results for key fields
      const keyFields: Array<keyof typeof twin> = ['wpVersion', 'plugins', 'themes'];
      const staleReasons: string[] = [];
      const missingFields: string[] = [];

      for (const field of keyFields) {
        const check = twinService.canAnswer(twin, field as any);
        if (!check.can) {
          missingFields.push(field as string);
        } else if (check.confidence === 'stale' && check.reason) {
          staleReasons.push(`\`${field as string}\`: ${check.reason}`);
        }
      }

      if (staleReasons.length > 0) {
        lines.push('');
        for (const reason of staleReasons) {
          lines.push(`> ⚠️ ${reason}`);
        }
      }

      if (missingFields.length > 0) {
        lines.push('');
        lines.push(`> ⚠️ Missing data for: ${missingFields.join(', ')}. Run \`nexus_site_refresh\` to populate.`);
      }
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
