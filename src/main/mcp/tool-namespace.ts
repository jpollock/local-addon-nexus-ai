import type { McpToolDefinition } from './types';

/**
 * P5 · namespace routing (charter 2026-08-26, tool-context design review).
 *
 * The selection funnel's first stage: before any ranking, the question's
 * domain narrows 193 tools to ~25 candidates. Deterministic and explainable —
 * "routed to wpe because the bound entity is a WP Engine install" is an
 * audit-log-worthy line; a cosine score is not.
 *
 * Prefix rules cover ~74% of the registry for free. The rest — one coherent
 * data domain wearing 18 verb prefixes (get_, list_, find_, scan_…) — must
 * declare `namespace` on their definition. `toolNamespaces.test.ts` builds
 * the full registry and fails on any tool that resolves to nothing, so the
 * annotation cannot drift: a new unroutable tool is a red suite, not a
 * silent gap.
 *
 * Nothing CONSUMES the namespace yet — grants are still unpopulated
 * (signature-only v0, gated on eval B-03). This is the routing input landing
 * ahead of the router, with zero behavior change.
 */

/** The closed namespace vocabulary. Add deliberately; the test enforces membership. */
export const TOOL_NAMESPACES = [
  'wpe',      // WP Engine platform API (CAPI)
  'wp-cli',   // WP-CLI / connector operations on a site
  'local',    // Local site lifecycle
  'nexus',    // twin, settings, procedures, linking
  'iw',       // InstaWP bridge
  'fleet',    // cross-site queries, health, drift, groups, plugins-at-scale
  'content',  // content index: search, structure, documents, indexing
  'db',       // database scanner
  'system',   // telemetry, metrics, gateway, ollama, event plumbing
  'security', // file/malware scanning
  'meta',     // tools about tools (search_tools)
  'agent',    // runtime-contributed agent__* tools
] as const;
export type ToolNamespace = (typeof TOOL_NAMESPACES)[number];

const PREFIX_RULES: Array<[string, ToolNamespace]> = [
  ['agent__', 'agent'],
  ['wpe_', 'wpe'],
  ['wp_', 'wp-cli'],
  ['local_', 'local'],
  ['iw_', 'iw'],
  ['fleet_', 'fleet'],
  ['nexus_', 'nexus'],
];

/**
 * Resolve a tool's routing namespace: explicit declaration wins, then the
 * name prefix. Returns null for a tool that resolves to neither — which the
 * enforcement test treats as a defect, never a category.
 */
export function resolveToolNamespace(
  def: Pick<McpToolDefinition, 'name' | 'namespace'>,
): ToolNamespace | null {
  if (def.namespace) {
    return (TOOL_NAMESPACES as readonly string[]).includes(def.namespace)
      ? (def.namespace as ToolNamespace)
      : null; // an invalid vocabulary entry is as much a defect as a missing one
  }
  for (const [prefix, ns] of PREFIX_RULES) {
    if (def.name.startsWith(prefix)) return ns;
  }
  return null;
}
