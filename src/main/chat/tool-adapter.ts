import type { McpToolDefinition, NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ProviderToolDefinition } from './providers/types';

/**
 * Convert ToolRegistry definitions to provider-agnostic tool definitions.
 * Strips _confirmationToken from schemas — chat UI handles tier 3 approval separately.
 * Also includes contributed agent tools from ContributedToolRegistry when present.
 *
 * `grants` (WP-11) is the seam for the context assembler's scoped tool grants
 * (`ContextBundle.tools`). SIGNATURE ONLY in v0 — nothing populates it, because
 * narrowing what the model can see changes behaviour and is gated on eval B-03.
 *
 * `undefined` means unrestricted and MUST preserve today's behaviour exactly.
 * An empty array is deliberately treated as unrestricted too: `[]` means
 * deny-all in this codebase's one existing scoping surface (`agent.tools`,
 * buildAgentContext.ts:81-87), and an assembler that returned an empty grant
 * list would otherwise silently strip every tool from the chat model.
 */
export function adaptToolsForChat(
  registry: ToolRegistry,
  services: NexusServices,
  grants?: string[],
): ProviderToolDefinition[] {
  const mcpTools: McpToolDefinition[] = registry.list(services);

  // Append contributed agent tools (agent__<name>__<tool>) from ContributedToolRegistry
  const contributedDefs = (services as any).contributedRegistry?.toMcpDefinitions() ?? [];
  const allTools: McpToolDefinition[] = [
    ...mcpTools,
    ...contributedDefs.map((t: { name: string; description: string; inputSchema?: Record<string, unknown> }) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      isAvailable: () => true,
    })),
  ];

  // P5 stage 3 — the granted array follows GRANTS order, not registry order.
  // Load-bearing for append-only turns: a tool appended to the grant list
  // must land at the END of the tools array, so the prior array stays a
  // strict prefix and the cache invalidates once, from the tail. A
  // registry-order filter (the previous implementation) would insert a
  // discovered tool mid-array and re-tokenize everything after it. Grants
  // naming tools the registry lacks are dropped — nothing unsendable is sent.
  const byName = new Map(allTools.map((t) => [t.name, t]));
  const granted = grants && grants.length > 0
    ? grants.map((name) => byName.get(name)).filter((t): t is McpToolDefinition => t !== undefined)
    : allTools;

  // P2(a) — the discovery invariant: search_tools survives every assembly and
  // rides at the FRONT of the toolset. Any future bound that trims the array
  // (a cap, a byte budget, a grants list that forgot it) must never remove the
  // one tool that lets the model learn what exists — that silent removal is
  // the mechanism behind the 2026-08-25 "no web-analytics capability" lie, and
  // Anthropic's own API enforces the same rule (deferring every tool is a
  // 400). Pinned by tests/unit/chat/discoveryInvariant.test.ts.
  const searchTool = allTools.find((t) => t.name === 'search_tools');
  const withDiscovery = searchTool
    ? [searchTool, ...granted.filter((t) => t.name !== 'search_tools')]
    : granted;

  return withDiscovery.map((tool) => {
    // Deep-clone the schema to avoid mutating the original
    const parameters = JSON.parse(JSON.stringify(tool.inputSchema));

    // Remove _confirmationToken from properties if present
    if (parameters.properties?._confirmationToken) {
      delete parameters.properties._confirmationToken;
    }

    // Remove from required array if present
    if (Array.isArray(parameters.required)) {
      parameters.required = parameters.required.filter(
        (r: string) => r !== '_confirmationToken',
      );
      if (parameters.required.length === 0) {
        delete parameters.required;
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });
}
