/**
 * search_tools — Tool discovery meta-tool
 *
 * With 160+ tools, Claude cannot reliably pick the right one by scanning
 * all descriptions internally. This tool lets Claude search for tools by
 * intent or keyword before committing to a specific call.
 *
 * Uses TF-IDF-like scoring: terms that match the tool name score higher
 * than terms that match only the description.
 */

import { McpToolHandler, McpToolResult, NexusServices } from '../types';
import type { ToolRegistry } from '../tool-registry';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_\-\/]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function score(query: string, name: string, description: string): number {
  const queryTerms = tokenize(query);
  const nameTerms = new Set(tokenize(name));
  const descTerms = new Set(tokenize(description));

  let total = 0;
  for (const term of queryTerms) {
    // Exact match in name: weight 4
    if (nameTerms.has(term)) { total += 4; continue; }
    // Partial match in name: weight 2
    if (Array.from(nameTerms).some((t) => t.includes(term) || term.includes(t))) { total += 2; continue; }
    // Match in description: weight 1
    if (descTerms.has(term) || Array.from(descTerms).some((t) => t.includes(term))) { total += 1; }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Tool handler factory — needs registry reference at registration time
// ---------------------------------------------------------------------------

export function createSearchToolsHandler(registry: ToolRegistry): McpToolHandler {
  return {
    definition: {
      name: 'search_tools',
      description:
        'Search available tools by intent or keyword. ' +
        'Use this when you are unsure which specific tool to call for an operation. ' +
        'Returns the top matching tools with their names and descriptions. ' +
        'Examples: search_tools("backup wpe install"), search_tools("update plugins remote"), ' +
        'search_tools("domain ssl certificate"). ' +
        'Call this BEFORE attempting an unfamiliar operation rather than guessing the tool name.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What you want to do, e.g. "backup a WPE install" or "list plugins on remote site"',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default: 8, max: 20)',
          },
        },
        required: ['query'],
      },
      isAvailable: (_services: NexusServices) => true,
    },

    async execute(args): Promise<McpToolResult> {
      const query = (args.query as string ?? '').trim();
      if (!query) {
        return { content: [{ type: 'text', text: 'Query is required.' }], isError: true };
      }

      const limit = Math.min(Math.max(1, (args.limit as number) ?? 8), 20);

      // Score all registered tools
      const tools = registry.list({ localServices: null } as any);
      const scored = tools
        .map((t) => ({
          name: t.name,
          description: (t.description as string ?? '').slice(0, 200),
          score: score(query, t.name, t.description as string ?? ''),
        }))
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No tools matched "${query}". Try broader terms or check \`nexus://guide/getting-started\` for a tool overview.`,
          }],
        };
      }

      const lines = [`## Tools matching "${query}" (${scored.length} results)\n`];
      for (const t of scored) {
        lines.push(`### \`${t.name}\``);
        lines.push(t.description.split('.')[0] + '.');  // First sentence only
        lines.push('');
      }
      lines.push('_Call the tool by name once you have identified the right one._');

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  };
}
