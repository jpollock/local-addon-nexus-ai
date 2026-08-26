/**
 * P5 · the namespace enforcement pin (charter 2026-08-26).
 *
 * GENERATIVE, like collision-decline.test.ts: it builds the full production
 * registry (every register* module index.ts calls) and asserts every tool
 * resolves to a namespace. A new tool with neither a routable prefix nor an
 * explicit `namespace` fails the suite with its name in the message — the
 * annotation cannot drift from the registry, because the registry IS the
 * test input.
 */
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { resolveToolNamespace, TOOL_NAMESPACES } from '../../../src/main/mcp/tool-namespace';

import { registerContentTools } from '../../../src/main/mcp/modules/content/index';
import { registerSiteContextTools } from '../../../src/main/mcp/modules/site-context/index';
import { registerOllamaTools } from '../../../src/main/mcp/modules/ollama/index';
import { registerFleetTools } from '../../../src/main/mcp/modules/fleet/index';
import { registerSiteManagementTools } from '../../../src/main/mcp/modules/site-management/index';
import { registerWpCliTools } from '../../../src/main/mcp/modules/wp-cli/index';
import { registerWpeTools } from '../../../src/main/mcp/modules/wpe/index';
import { registerCompositeTools } from '../../../src/main/mcp/modules/composite/index';
import { registerDbScannerTools } from '../../../src/main/mcp/modules/db-scanner/index';
import { registerSentinelScanTools } from '../../../src/main/mcp/modules/sentinel-scan/index';
import { registerWpConnectorTools } from '../../../src/main/mcp/modules/wp-connector/index';
import { registerFleetIntelligenceTools } from '../../../src/main/mcp/modules/fleet-intelligence/index';
import { registerFleetLinkTools } from '../../../src/main/mcp/modules/fleet-links/index';
import { registerIwTools } from '../../../src/main/mcp/modules/iw/index';
import { registerTelemetryTools } from '../../../src/main/mcp/modules/telemetry-tools';
import { registerTelemetryControlTools } from '../../../src/main/mcp/modules/telemetry-control-tools';
import { registerNexusSettingsTools } from '../../../src/main/mcp/modules/nexus-settings';
import { createSearchToolsHandler } from '../../../src/main/mcp/modules/search-tools';

function buildFullRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // Same set index.ts registers at startup (test-tools excluded — dev-only).
  registerContentTools(registry);
  registerSiteContextTools(registry);
  registerOllamaTools(registry);
  registerFleetTools(registry);
  registerSiteManagementTools(registry);
  registerWpCliTools(registry);
  registerWpeTools(registry);
  registerCompositeTools(registry);
  registerDbScannerTools(registry);
  registerSentinelScanTools(registry);
  registerWpConnectorTools(registry);
  registerFleetIntelligenceTools(registry);
  registerFleetLinkTools(registry);
  registerIwTools(registry);
  registerTelemetryTools(registry);
  registerTelemetryControlTools(registry);
  registry.register(createSearchToolsHandler(registry, () => undefined));
  return registry;
}

function allDefinitions(registry: ToolRegistry) {
  // The handlers map is private; tests reach it the way the repo's partial
  // mocks do. list(services) would filter by isAvailable — routing must
  // cover UNAVAILABLE tools too (availability is per-session, names are not).
  return Array.from(
    (registry as never as { handlers: Map<string, { definition: { name: string; namespace?: string } }> })
      .handlers.values(),
  ).map((h) => h.definition);
}

it('every registered tool resolves to a namespace — no tool is unroutable', () => {
  const defs = allDefinitions(buildFullRegistry());
  expect(defs.length).toBeGreaterThan(150); // sanity: the real registry loaded

  const unroutable = defs
    .filter((d) => resolveToolNamespace(d) === null)
    .map((d) => `${d.name}${d.namespace ? ` (invalid namespace '${d.namespace}')` : ''}`);

  expect(unroutable).toEqual([]);
});

it('explicit namespaces stay inside the closed vocabulary', () => {
  const defs = allDefinitions(buildFullRegistry());
  for (const d of defs) {
    if (d.namespace) {
      expect(TOOL_NAMESPACES).toContain(d.namespace);
    }
  }
});

it('an explicit namespace outranks the prefix rule', () => {
  expect(resolveToolNamespace({ name: 'wpe_something', namespace: 'fleet' })).toBe('fleet');
});

it('a bogus explicit namespace is a defect, not a category', () => {
  expect(resolveToolNamespace({ name: 'anything', namespace: 'not-a-namespace' })).toBeNull();
});
