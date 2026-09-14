/**
 * Generate src/main/agent-sdk/built-in-tools.ts — the BuiltInTool string-literal union used for
 * IDE autocomplete on AgentDefinition.tools (GH-50).
 *
 * Names are collected through the REAL registration path: the same register*Tools calls
 * src/main/index.ts makes at startup, recorded via a stub registry. No regex scraping — if a
 * module renames a tool, this picks it up.
 *
 * Usage:
 *   npm run generate:built-in-tools            # rewrite the file
 *   npm run generate:built-in-tools:check      # exit 1 if the file is out of date (CI drift gate)
 *
 * Runs under `ts-node --transpile-only` (both npm scripts do). electron and the @getflywheel
 * peers are optional peerDependencies that a normal checkout does not install, yet parts of the
 * registration graph import them at load time (e.g. security/KeyVault -> electron). Registration
 * never calls into them, so those module requests are mapped to electron-runtime-stub.js before
 * any tool module is imported, and the real tool names load in plain Node.
 */
import * as fs from 'fs';
import * as Module from 'module';
import * as path from 'path';

const STUBBED_PEERS = new Set(['electron', '@getflywheel/local', '@getflywheel/local-components']);
const STUB_PATH = require.resolve('./electron-runtime-stub.js');
// Module._resolveFilename and Module._load are getter-only non-configurable on Node >= 22, so
// hook the one remaining seam: Module.prototype.require, swapping peer requests for the stub.
const ModuleProto = Module.prototype as unknown as { require: (request: string) => unknown };
const origRequire = ModuleProto.require;
ModuleProto.require = function(request: string) {
  if (STUBBED_PEERS.has(request)) return origRequire.call(this, STUB_PATH);
  return origRequire.apply(this, arguments as unknown as [string]);
};

import { registerContentTools } from '../src/main/mcp/modules/content';
import { registerSiteContextTools } from '../src/main/mcp/modules/site-context';
import { registerOllamaTools } from '../src/main/mcp/modules/ollama';
import { registerFleetTools } from '../src/main/mcp/modules/fleet';
import { registerSiteManagementTools } from '../src/main/mcp/modules/site-management';
import { registerWpCliTools } from '../src/main/mcp/modules/wp-cli';
import { registerWpeTools } from '../src/main/mcp/modules/wpe';
import { registerCompositeTools } from '../src/main/mcp/modules/composite';
import { registerDbScannerTools } from '../src/main/mcp/modules/db-scanner';
import { registerSentinelScanTools } from '../src/main/mcp/modules/sentinel-scan';
import { registerWpConnectorTools } from '../src/main/mcp/modules/wp-connector';
import { registerFleetIntelligenceTools } from '../src/main/mcp/modules/fleet-intelligence';
import { registerFleetLinkTools } from '../src/main/mcp/modules/fleet-links';
import { registerTelemetryTools } from '../src/main/mcp/modules/telemetry-tools';
import { registerTelemetryControlTools } from '../src/main/mcp/modules/telemetry-control-tools';
import { registerNexusSettingsTools } from '../src/main/mcp/modules/nexus-settings';
import { getGatewayUsageHandler } from '../src/main/mcp/modules/ai-gateway/get-gateway-usage';
import { createSearchToolsHandler } from '../src/main/mcp/modules/search-tools';

const OUT_FILE = path.resolve(__dirname, '..', 'src', 'main', 'agent-sdk', 'built-in-tools.ts');

/** Collects tool names through the same calls the app's startup wiring makes. */
export function collectBuiltInToolNames(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const stubRegistry = {
    register(handler: { definition: { name: string } }): void {
      const name = handler?.definition?.name;
      if (!name) throw new Error('registered handler without definition.name');
      if (seen.has(name)) throw new Error(`duplicate tool registration: ${name}`);
      seen.add(name);
      names.push(name);
    },
    allToolNames(): string[] {
      return [...names];
    },
  };

  // Mirror of the registration block in src/main/index.ts — same order, same set, minus
  // registerTestTools (E2E-only, must not advertise built-ins).
  registerContentTools(stubRegistry as any);
  registerSiteContextTools(stubRegistry as any);
  registerOllamaTools(stubRegistry as any);
  registerFleetTools(stubRegistry as any);
  registerSiteManagementTools(stubRegistry as any);
  registerWpCliTools(stubRegistry as any);
  registerWpeTools(stubRegistry as any);
  registerCompositeTools(stubRegistry as any);
  registerDbScannerTools(stubRegistry as any);
  registerSentinelScanTools(stubRegistry as any);
  registerWpConnectorTools(stubRegistry as any);
  registerFleetIntelligenceTools(stubRegistry as any);
  registerFleetLinkTools(stubRegistry as any);
  registerTelemetryTools(stubRegistry as any);
  stubRegistry.register(getGatewayUsageHandler as any);
  registerTelemetryControlTools(stubRegistry as any);
  registerNexusSettingsTools(stubRegistry as any);
  stubRegistry.register(createSearchToolsHandler(stubRegistry as any, () => undefined) as any);

  // Plain lexicographic sort (UTF-16 code units): localeCompare orders differently across
  // Node/jest ICU setups, which would make the "committed file matches" check environment-dependent.
  return names.sort();
}

export function renderBuiltInToolsModule(names: readonly string[]): string {
  const literals = names.map((n) => `  | '${n}'`).join('\n');
  const arrayEntries = names.map((n) => `  '${n}',`).join('\n');
  return `// AUTO-GENERATED by \`npm run generate:built-in-tools\` — do not edit by hand.
// Drift gate: \`npm run generate:built-in-tools:check\` (exit 1 when out of date).
// Names come from the real registration path — the same register*Tools calls the app makes in
// src/main/index.ts — collected through a stub registry, sorted, deduplicated by the generator.

export type BuiltInTool =
${literals};

export const BUILT_IN_TOOL_NAMES = [
${arrayEntries}
] as const;
`;
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const names = collectBuiltInToolNames();
  if (names.length === 0) {
    console.error('generate-built-in-tools: no tools registered — refusing to write an empty union');
    process.exit(1);
  }
  const generated = renderBuiltInToolsModule(names);

  if (checkOnly) {
    const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    if (existing !== generated) {
      console.error('src/main/agent-sdk/built-in-tools.ts is out of date. Run: npm run generate:built-in-tools');
      process.exit(1);
    }
    console.log(`built-in-tools.ts is up to date (${names.length} tools).`);
    return;
  }

  fs.writeFileSync(OUT_FILE, generated, 'utf8');
  console.log(`Wrote ${OUT_FILE} (${names.length} tools).`);
}

if (require.main === module) {
  main();
}
