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
  if (!tools || tools.length === 0) return [];
  return tools.filter((name) => !universe.builtIn.has(name) && !universe.contributed.has(name));
}

/** One warning line per agent with unresolvable tools; empty array when everyone resolves. */
export function collectAgentToolWarnings(
  agents: readonly AgentDefinition[],
  universe: ToolUniverse,
): string[] {
  const warnings: string[] = [];
  for (const def of agents) {
    for (const name of unresolvedTools(def.tools, universe)) {
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
