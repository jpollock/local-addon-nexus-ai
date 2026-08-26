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
import type { ContributedToolRegistry } from '../../agent-runtime/ContributedToolRegistry';
import { ToolRanker } from '../tool-ranker';

// ---------------------------------------------------------------------------
// Tool handler factory — needs registry reference at registration time
// ---------------------------------------------------------------------------

export function createSearchToolsHandler(
  registry: ToolRegistry,
  getContributedRegistry?: () => ContributedToolRegistry | undefined,
): McpToolHandler {
  // P5 stage 4 — the discovery floor is HYBRID: lexical (moved verbatim to
  // tool-ranker.ts) + cosine over MiniLM embeddings of name+description,
  // built lazily in the background off services.embeddingService on the
  // first search. Walt's template_catalog degradation, ported: lexical-only
  // until the index is ready or whenever embedding fails — a search never
  // waits on ONNX warmup. Measured motive: B-03's lexical baseline is blind
  // to intent phrasings ("how many sites do I have?" → fleet_overview,
  // zero token overlap), and this tool is P2's escape hatch — its recall is
  // what "call search_tools before concluding a capability is unavailable"
  // leans on.
  let ranker: ToolRanker | null = null;

  const handler: McpToolHandler = {
    definition: {
      name: 'search_tools',
      namespace: 'meta',
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

    async execute(args, services): Promise<McpToolResult> {
      const query = (args.query as string ?? '').trim();
      if (!query) {
        return { content: [{ type: 'text', text: 'Query is required.' }], isError: true };
      }

      const limit = Math.min(Math.max(1, (args.limit as number) ?? 8), 20);

      // Score all registered tools — built-in + contributed
      const builtinTools = registry.list({ localServices: null } as any);
      const contributedDefs = getContributedRegistry?.()?.toMcpDefinitions() ?? [];
      const contributedTools = contributedDefs.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: {},
        isAvailable: () => true,
      }));
      const tools = [...builtinTools, ...contributedTools];

      if (!ranker) {
        const embedBatch = services?.embeddingService?.embedBatch?.bind(services.embeddingService);
        ranker = new ToolRanker(embedBatch);
        (handler as unknown as { __ranker: ToolRanker }).__ranker = ranker; // test seam
      }
      const rankable = tools.map((t) => ({ name: t.name, description: (t.description as string) ?? '' }));
      ranker.ensureIndex(rankable); // background; no-op when unchanged
      const scored = (await ranker.rank(query, rankable, limit))
        .map((t) => ({ ...t, description: t.description.slice(0, 200) }));

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
  return handler;
}
