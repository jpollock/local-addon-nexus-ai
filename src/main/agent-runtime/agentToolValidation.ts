import type { AgentDefinition } from '../agent-sdk/types';

/**
 * GH-47 — load-time validation for agent tools[] declarations.
 *
 * Pure functions, no logging: the caller (AgentRegistry) decides how to surface the findings.
 * Kept side-effect-free so tests assert on returned data instead of mocking the logger.
 */

/** Every tool name an agent may legally invoke, from both registries. */
export interface ToolUniverse {
  builtIn: ReadonlySet<string>;
  contributed: ReadonlySet<string>;
}

/**
 * Build the universe from whatever registries are available. Both are optional: a caller wired
 * without one just gets an empty set for it, and validation then reports only cross-registry
 * truth it actually has — an agent tool checked against an absent registry is "unknown", so
 * callers should pass registries when they have them.
 */
export function buildToolUniverse(
  toolRegistry?: { allToolNames(): string[] },
  contributedRegistry?: { list(): readonly { toolName: string }[] },
): ToolUniverse {
  return {
    builtIn: new Set(toolRegistry ? toolRegistry.allToolNames() : []),
    contributed: new Set(
      contributedRegistry ? contributedRegistry.list().map((t) => t.toolName) : [],
    ),
  };
}

/** The declared tools that exist in neither registry, in declaration order. */
export function unresolvedTools(
  tools: readonly string[] | undefined,
  universe: ToolUniverse,
): string[] {
  // A malformed declaration (tools: 'fleet_sql' — a string, not an array) degrades to
  // "nothing resolvable here" instead of throwing: agents.load() must stay warn-only even for
  // declarations that fail AgentRegistry's name/run shape check. AgentRegistry warns about the
  // malformed shape separately.
  if (!tools || !Array.isArray(tools) || tools.length === 0) return [];
  return tools.filter((name) => !universe.builtIn.has(name) && !universe.contributed.has(name));
}

/**
 * One warning line per DISTINCT unknown tool per agent, in first-declaration order; empty array
 * when everyone resolves. Malformed declarations (non-array tools) produce one diagnostic each
 * instead of throwing — a bad agent must never reject the whole load.
 */
export function collectAgentToolWarnings(
  agents: readonly AgentDefinition[],
  universe: ToolUniverse,
): string[] {
  const warnings: string[] = [];
  for (const def of agents) {
    if (def.tools !== undefined && !Array.isArray(def.tools)) {
      warnings.push(
        `AgentRegistry: agent "${def.name}" has a malformed tools declaration (expected an array, ` +
        `got ${typeof def.tools}) — treating as no tools. Fix tools[] in defineAgent().`,
      );
      continue;
    }
    // F6: a name declared twice yields ONE warning, at its first occurrence's position.
    const seen = new Set<string>();
    for (const name of unresolvedTools(def.tools, universe)) {
      if (seen.has(name)) continue;
      seen.add(name);
      warnings.push(
        `AgentRegistry: agent "${def.name}" declares unknown tool "${name}" — found in neither ` +
        `ToolRegistry (${universe.builtIn.size} built-ins) nor ContributedToolRegistry ` +
        `(${universe.contributed.size} contributed). ctx.tools.invoke("${name}") will fail at runtime; ` +
        `fix the typo in tools[] or register the tool.`,
      );
    }
  }
  return warnings;
}
