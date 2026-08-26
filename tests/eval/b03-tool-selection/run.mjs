#!/usr/bin/env node
/**
 * B-03 runner — selector recall over the ground-truth cases.
 *
 * Usage:
 *   node tests/eval/b03-tool-selection/run.mjs [--k 12] [--selector path.mjs]
 *
 * Loads the live registry the same way toolNamespaces.test.ts does is not
 * possible from ESM without the TS build, so it reads the compiled lib —
 * run `npx tsc -p tsconfig.json` first if lib/ is stale. The baseline
 * selector mirrors search_tools' lexical scoring (name ×4, partial ×2,
 * description ×1): the floor any candidate selector must beat.
 *
 * Escape-hatch cases are SKIPPED here — they need the append-only grants
 * plumbing (P5 stage 3) and a live provider loop. This runner measures the
 * recall half only.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const require = createRequire(join(repo, 'package.json'));

// Registration-only stubs for main-process-host modules, mirroring jest's
// moduleNameMapper: definitions register fine without a real Electron; only
// execute() paths would need the real thing, and this runner never executes.
{
  const Module = require('module');
  const orig = Module._load;
  const STUBS = {
    'electron': { safeStorage: { isEncryptionAvailable: () => false }, app: { getPath: () => '/tmp' } },
    '@getflywheel/local/main': {},
    '@getflywheel/local-components': {},
  };
  Module._load = function (id, ...rest) {
    if (id in STUBS) return STUBS[id];
    return orig.call(this, id, ...rest);
  };
}

const args = process.argv.slice(2);
const K = parseInt(args[args.indexOf('--k') + 1], 10) || 12;
const selectorPath = args.includes('--selector') ? args[args.indexOf('--selector') + 1] : null;

// ── registry defs from the compiled lib ─────────────────────────────────────
function loadDefs() {
  const { ToolRegistry } = require('./lib/main/mcp/tool-registry.js');
  const { resolveToolNamespace } = require('./lib/main/mcp/tool-namespace.js');
  const registry = new ToolRegistry();
  const mods = [
    ['./lib/main/mcp/modules/content/index.js', 'registerContentTools'],
    ['./lib/main/mcp/modules/site-context/index.js', 'registerSiteContextTools'],
    ['./lib/main/mcp/modules/ollama/index.js', 'registerOllamaTools'],
    ['./lib/main/mcp/modules/fleet/index.js', 'registerFleetTools'],
    ['./lib/main/mcp/modules/site-management/index.js', 'registerSiteManagementTools'],
    ['./lib/main/mcp/modules/wp-cli/index.js', 'registerWpCliTools'],
    ['./lib/main/mcp/modules/wpe/index.js', 'registerWpeTools'],
    ['./lib/main/mcp/modules/composite/index.js', 'registerCompositeTools'],
    ['./lib/main/mcp/modules/db-scanner/index.js', 'registerDbScannerTools'],
    ['./lib/main/mcp/modules/sentinel-scan/index.js', 'registerSentinelScanTools'],
    ['./lib/main/mcp/modules/wp-connector/index.js', 'registerWpConnectorTools'],
    ['./lib/main/mcp/modules/fleet-intelligence/index.js', 'registerFleetIntelligenceTools'],
    ['./lib/main/mcp/modules/fleet-links/index.js', 'registerFleetLinkTools'],
    ['./lib/main/mcp/modules/iw/index.js', 'registerIwTools'],
    ['./lib/main/mcp/modules/telemetry-tools.js', 'registerTelemetryTools'],
    ['./lib/main/mcp/modules/telemetry-control-tools.js', 'registerTelemetryControlTools'],
    ['./lib/main/mcp/modules/nexus-settings.js', 'registerNexusSettingsTools'],
  ];
  for (const [path, fn] of mods) require(path)[fn](registry);
  const { createSearchToolsHandler } = require('./lib/main/mcp/modules/search-tools.js');
  registry.register(createSearchToolsHandler(registry, () => undefined));
  return Array.from(registry.handlers.values()).map((h) => ({
    name: h.definition.name,
    description: h.definition.description,
    namespace: resolveToolNamespace(h.definition),
  }));
}

// ── baseline: search_tools' lexical scoring ─────────────────────────────────
function lexicalBaseline(request, _context, defs) {
  const words = request.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return defs
    .map((d) => {
      const name = d.name.toLowerCase();
      const desc = (d.description || '').toLowerCase();
      let score = 0;
      for (const w of words) {
        if (name === w) score += 4;
        else if (name.includes(w)) score += 2;
        if (desc.includes(w)) score += 1;
      }
      return { name: d.name, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.name);
}

// ── run ─────────────────────────────────────────────────────────────────────
const { cases } = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const defs = loadDefs();
const selector = selectorPath
  ? (await import(resolve(selectorPath))).default
  : lexicalBaseline;

// Bucket 1's Orient stage — resident regardless of selection.
const RESIDENT = new Set(['search_tools', 'nexus_where_am_i', 'nexus_load_procedure', 'local_operation_status']);

let hits = 0, total = 0, skipped = 0;
for (const c of cases) {
  if (c.kind === 'escape-hatch') { skipped++; continue; }
  total++;
  const ranked = selector(c.request, c.context ?? {}, defs).slice(0, K);
  const hit = RESIDENT.has(c.correct_tool) || ranked.includes(c.correct_tool);
  if (hit) hits++;
  console.log(`${hit ? '✓' : '✗'}  ${c.id}  →  ${c.correct_tool}  ${hit ? '' : `(top-${K}: ${ranked.slice(0, 5).join(', ') || '∅'}…)`}`);
}
console.log(`\nrecall@${K}: ${hits}/${total}${skipped ? `  (${skipped} escape-hatch case(s) skipped — need P5 stage 3 plumbing)` : ''}`);
process.exit(hits === total ? 0 : 1);
