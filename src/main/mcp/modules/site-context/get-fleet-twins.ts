/**
 * nexus_get_fleet_twins — return digital twins for all local sites.
 *
 * Gives an AI agent a fleet-wide view of completeness and freshness before
 * deciding which sites to query, refresh, or skip.
 */
import { McpToolHandler, McpToolResult } from '../../types';

export const getFleetTwinsHandler: McpToolHandler = {
  definition: {
    name: 'nexus_get_fleet_twins',
    description:
      'Get a completeness and freshness overview of the digital twin for every local site. ' +
      'Returns a summary table showing what data is available (none/filesystem/metadata/indexed), ' +
      'how old it is, and which sites need refreshing. ' +
      'Use as a fleet health check before running bulk operations or answering cross-site questions.',
    inputSchema: {
      type: 'object',
      properties: {
        completeness_filter: {
          type: 'string',
          enum: ['none', 'filesystem', 'metadata', 'indexed'],
          description: 'Only return sites at this completeness level or below',
        },
      },
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const twinService = services.twinService;
    if (!twinService) return error('Digital twin service not available');

    const twins = twinService.getAll();
    if (twins.length === 0) return ok('No local sites found.');

    const filter = args.completeness_filter as string | undefined;
    const order: Record<string, number> = { none: 0, filesystem: 1, metadata: 2, indexed: 3 };

    const filtered = filter
      ? twins.filter((t) => (order[t.completeness] ?? 0) <= (order[filter] ?? 0))
      : twins;

    const completenessIcon: Record<string, string> = {
      none:       '❌',
      filesystem: '🔶',
      metadata:   '✅',
      indexed:    '🔍',
    };

    const lines: string[] = [];
    lines.push(`## Fleet twin overview — ${twins.length} sites`);
    if (filter) lines.push(`_Filtered to: ${filter} and below_`);
    lines.push('');

    // Group by completeness
    const groups: Record<string, typeof twins> = { indexed: [], metadata: [], filesystem: [], none: [] };
    for (const twin of filtered) {
      groups[twin.completeness]?.push(twin);
    }

    for (const level of ['indexed', 'metadata', 'filesystem', 'none'] as const) {
      const group = groups[level];
      if (!group.length) continue;
      lines.push(`### ${completenessIcon[level]} ${level.charAt(0).toUpperCase() + level.slice(1)} (${group.length})`);
      for (const twin of group) {
        const freshness = twinService.getFreshness(twin);
        const staleWarn = freshness.staleFields.length > 0 ? ' ⚠️' : '';
        const age = twin.asOf ? formatAge(Date.now() - twin.asOf) : 'no data';
        lines.push(`- **${twin.siteName}** — ${age}${staleWarn}`);
      }
      lines.push('');
    }

    // Summary
    const counts = Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.length])
    );
    lines.push(`**Summary:** ${counts.indexed} indexed, ${counts.metadata} metadata, ${counts.filesystem} filesystem, ${counts.none} no data`);

    if (counts.none > 0 || counts.filesystem > 0) {
      lines.push('');
      lines.push('_Run `nexus_fleet_refresh` to populate missing twins._');
    }

    return ok(lines.join('\n'));
  },
};

function formatAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
