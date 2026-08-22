/**
 * A message naming a remedy is a claim about the tool surface — and a claim is
 * checked or it is decoration.
 *
 * ── The defect this exists for (WP-61 / D5) ─────────────────────────────────
 * Eight strings across five files told the reader to run `wpe_sync_sites`.
 * `ToolRegistry` had never carried a tool by that name, and nothing anywhere
 * could notice. Measured before the fix, this sweep reported `wpe_sync_sites`
 * as unregistered from all five files — it would have caught the defect cold.
 *
 * ── What is swept, and why it is scoped by the CLAIM ────────────────────────
 * Sweeping every snake_case token inside a string literal matches
 * `permalink_structure`, `post_type`, `last_sync_at` and a hundred others: it
 * reports a count, not a finding. What makes a string a claim about the tool
 * surface is the IMPERATIVE — "run X", "call X", "use X", "try X". That is
 * what is matched, and it is matched inside string literals only (via the
 * TypeScript parser, so comments and identifiers are structurally excluded:
 * a docblock is a note to a maintainer, not a promise to a caller).
 *
 * ── The eight tokens that are not tools ─────────────────────────────────────
 * "Use install_name as `install_name=` in wp_* tools" is a true sentence about
 * a PARAMETER. Those are enumerated in `NOT_A_TOOL` with a reason each, and
 * two guards keep that list from becoming a place to hide a failure:
 * every entry must still appear in the sweep (so it cannot go stale), and no
 * entry may also be a registered tool name (so it cannot mask a real check).
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
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
import { getGatewayUsageHandler } from '../../../src/main/mcp/modules/ai-gateway/get-gateway-usage';
import { createSearchToolsHandler } from '../../../src/main/mcp/modules/search-tools';

import { syncSitesHandler } from '../../../src/main/mcp/modules/wpe/sync-sites';
import {
  WPE_SYNC_TOOL,
  WPE_SYNC_REMEDY_METADATA,
  WPE_SYNC_REMEDY_CONTENT,
} from '../../../src/main/mcp/modules/wpe/sync-remedy';

const MCP_ROOT = path.resolve(__dirname, '../../../src/main/mcp');

/**
 * Tokens the sweep finds that name something OTHER than a tool. Each is a real
 * sentence in the product; the reason says what the token actually is.
 *
 * Verified against the sources 2026-08-21. Two tests below stop this list from
 * turning into a silencer.
 */
const NOT_A_TOOL: Record<string, string> = {
  database_only:  'a boolean argument to local_wpe_pull ("use `database_only: true`")',
  install_id:     'a field of the fleet resource, used as remote_install_id= in pull/push',
  install_name:   'a tool PARAMETER ("use install_name for WPE installs")',
  json_extract:   'the SQLite function, in fleet_sql\'s schema guidance',
  month_offset:   'a parameter of wpe_portfolio_usage',
  site_name:      'a field of the fleet resource, used as site= in wp_* tools',
  skip_plugins:   'a wp_eval parameter (skip_plugins=true)',
  skip_themes:    'a wp_eval parameter (skip_themes=true)',
};

/**
 * `run|call|use|try` followed by a snake_case identifier, optionally in
 * backticks. Case-insensitive because these sentences start sentences.
 */
const TOOL_CLAIM = /\b(?:run|call|use|try)\s+`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/gi;

/**
 * Every tool-surface claim in one TypeScript source, from its string literals.
 *
 * Exported shape rather than an inline loop so the check can be driven against
 * fabricated sources in BOTH directions — a refusal that is only ever run over
 * a clean tree has never been shown to refuse anything.
 */
export function findToolClaims(source: string, fileName = 'inline.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      let m: RegExpExecArray | null;
      TOOL_CLAIM.lastIndex = 0;
      while ((m = TOOL_CLAIM.exec((n as { text: string }).text))) found.push(m[1]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') tsFilesUnder(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

function buildFullRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  registerContentTools(r);
  registerSiteContextTools(r);
  registerOllamaTools(r);
  registerFleetTools(r);
  registerSiteManagementTools(r);
  registerWpCliTools(r);
  registerWpeTools(r);
  registerCompositeTools(r);
  registerDbScannerTools(r);
  registerSentinelScanTools(r);
  registerWpConnectorTools(r);
  registerFleetIntelligenceTools(r);
  registerFleetLinkTools(r);
  registerIwTools(r);
  registerTelemetryTools(r);
  registerTelemetryControlTools(r);
  registerNexusSettingsTools(r);
  r.register(getGatewayUsageHandler);
  // Registered last in src/main/index.ts, for the same reason: it searches the
  // others. Its own name is claimed in the server instructions, so leaving it
  // out would produce a false red.
  r.register(createSearchToolsHandler(r, () => undefined));
  return r;
}

/** The sweep over the real tree, computed once. */
function sweepRepository(): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  for (const file of tsFilesUnder(MCP_ROOT)) {
    for (const token of findToolClaims(fs.readFileSync(file, 'utf8'), file)) {
      if (!claims.has(token)) claims.set(token, new Set());
      claims.get(token)!.add(path.relative(MCP_ROOT, file));
    }
  }
  return claims;
}

describe('tool-surface claims in user-facing strings', () => {
  const registry = buildFullRegistry();
  const registered = new Set(registry.allToolNames());
  const claims = sweepRepository();

  test('the sweep actually finds something — it is not measuring an empty set', () => {
    // Shape #15/#18 guard. A green "no unregistered tools" over zero claims is
    // indistinguishable from a green over a clean tree, and the difference is
    // the whole value of the check. Measured 2026-08-21: 99 distinct tokens
    // across src/main/mcp. The floor is deliberately well under that — this
    // asserts non-emptiness, it does not pin the population (WP-58: a floor is
    // not a list).
    expect(claims.size).toBeGreaterThan(50);

    // And a floor of names that must be present, so a sweep that silently
    // stopped parsing string literals (returning a few incidental hits) still
    // fails rather than passing on a smaller set.
    for (const pinned of ['reindex_site', 'nexus_list_sites', 'wpe_login', 'wp_plugin_update']) {
      expect([...claims.keys()]).toContain(pinned);
    }
  });

  test('every tool named as a remedy is carried by the registry', () => {
    const unregistered = [...claims.entries()]
      .filter(([token]) => !registered.has(token) && !(token in NOT_A_TOOL))
      .map(([token, files]) => `${token} <- ${[...files].sort().join(', ')}`)
      .sort();

    // Before WP-61 this reported:
    //   wpe_sync_sites <- modules/content/describe-site-fields.ts,
    //     modules/content/search-content.ts, modules/wpe/detect-drift.ts,
    //     modules/wpe/fleet-versions.ts, modules/wpe/helpers.ts
    expect(unregistered).toEqual([]);
  });

  test('the not-a-tool allowlist cannot mask a real check', () => {
    // An entry that is ALSO a registered tool would silence the check for that
    // tool for ever, with nothing to say so.
    for (const token of Object.keys(NOT_A_TOOL)) {
      expect(registered.has(token)).toBe(false);
    }
  });

  test('the not-a-tool allowlist cannot go stale', () => {
    // An exception with no remaining case is a permanent exception nobody
    // reviews. If the sentence naming it is deleted or rephrased, the entry
    // goes with it.
    const unused = Object.keys(NOT_A_TOOL).filter((t) => !claims.has(t));
    expect(unused).toEqual([]);
  });

  test('the sweep REFUSES a fabricated remedy — driven in the failing direction', () => {
    // A refusal that only ever passes is not a refusal. This drives the same
    // function the repository sweep uses, over the shape the defect had.
    const fabricated = `
      export const h = {
        async execute() {
          return error('No WP Engine installs found. Run frobnicate_widgets first.');
        },
      };
    `;
    const found = findToolClaims(fabricated);
    expect(found).toContain('frobnicate_widgets');
    expect(registered.has('frobnicate_widgets')).toBe(false);
  });

  test('the sweep reads string literals, not comments or identifiers', () => {
    // The scoping claim, driven rather than asserted in prose: if this were a
    // raw text grep, all three of these would match and the check would be
    // reporting noise from places that make no promise to a caller.
    const source = `
      // Run frobnicate_from_a_comment first.
      /** Call frobnicate_from_a_docblock to fix it. */
      const x = run_frobnicate_identifier();
      const msg = 'Run frobnicate_from_a_string to fix it.';
    `;
    expect(findToolClaims(source)).toEqual(['frobnicate_from_a_string']);
  });
});

describe('the WP Engine sync remedy names the tool that was registered for it', () => {
  const registered = new Set(buildFullRegistry().allToolNames());

  test('the constant and the handler agree on the name', () => {
    // The two halves of the fix, pinned to each other: renaming the tool
    // without renaming the constant (or the reverse) is the exact drift that
    // produced eight strings naming nothing.
    expect(syncSitesHandler.definition.name).toBe(WPE_SYNC_TOOL);
    expect(registered.has(WPE_SYNC_TOOL)).toBe(true);
  });

  test('both remedies name it, and say which mode', () => {
    expect(WPE_SYNC_REMEDY_METADATA).toContain(WPE_SYNC_TOOL);
    expect(WPE_SYNC_REMEDY_CONTENT).toContain(WPE_SYNC_TOOL);
    // The content remedy must name the argument. Without it a reader runs the
    // tool bare, gets a successful metadata sync, and their search index is
    // unchanged — a remedy that reports success and does not remedy.
    expect(WPE_SYNC_REMEDY_CONTENT).toContain('content: true');
    expect(WPE_SYNC_REMEDY_METADATA).not.toContain('content: true');
  });

  test('the tool accepts the argument the content remedy tells callers to pass', () => {
    // The remedy sentence is a claim about the SCHEMA too, not only the name.
    const props = (syncSitesHandler.definition.inputSchema as {
      properties: Record<string, { type: string }>;
    }).properties;
    expect(props.content?.type).toBe('boolean');
    expect(props.install_name?.type).toBe('string');
    // Fleet-wide by default: neither argument may be required, or the six
    // metadata remedies point at a call the reader cannot make.
    expect((syncSitesHandler.definition.inputSchema as { required?: string[] }).required)
      .toBeUndefined();
  });
});
