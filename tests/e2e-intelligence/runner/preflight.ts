/**
 * WP-18 · The gate in front of every journey.
 *
 * These journeys talk to a RUNNING Local instance. When it is not running they
 * must be impossible to mistake for a pass — TESTING_STRATEGY.md's "what we
 * deliberately do not do" is explicit: *environment-dependent tests that can
 * silently skip are worse than absent*. So this module has exactly one job:
 * decide whether the environment is real, and when it is not, produce a banner
 * a human cannot skim past plus a distinct exit code a machine cannot confuse
 * with a test failure.
 *
 * Pure by construction — every I/O concern (reading the connection-info file,
 * speaking JSON-RPC) is injected, so all four failure branches are pinned in
 * `preflight.test.ts` without a running app.
 */

/**
 * Exit code for "the journeys did not run".
 *
 * Deliberately NOT 1: jest exits 1 for a failing test, so sharing it would
 * make "found a defect" and "never executed" indistinguishable in CI — and the
 * second silently reads as the first, which is the whole failure mode this
 * packet is built against.
 */
export const PREFLIGHT_EXIT_CODE = 2;

/**
 * The tools the journeys call. Checked up front, by name, because a Local
 * running an addon build that predates one of them fails deep inside a journey
 * with an opaque MCP error — which reads as "the intelligence layer is broken"
 * rather than "you are running last week's build".
 */
export const REQUIRED_TOOLS = [
  'find_sites_with_plugin',
  'verify_site_live',
  'nexus_intelligence_health',
] as const;

export interface PreflightConnectionInfo {
  url: string;
  authToken: string;
}

export interface PreflightInput {
  /** Parsed MCP connection info, or null when the file is missing/unreadable. */
  connectionInfo: PreflightConnectionInfo | null;
  /** Lists tool names from the live endpoint. Throws when unreachable. */
  listTools: () => Promise<string[]>;
}

export type PreflightResult =
  | { ok: true; tools: string[] }
  | { ok: false; banner: string };

const RULE = '='.repeat(78);

/** A fenced block that survives interleaved jest output and a fast scrollback skim. */
export function loudBanner(title: string, body: string[]): string {
  return ['', RULE, `⛔  ${title}`, RULE, ...body, RULE, ''].join('\n');
}

const HEADLINE = 'E2E INTELLIGENCE JOURNEYS DID NOT RUN';

export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  if (!input.connectionInfo) {
    return {
      ok: false,
      banner: loudBanner(HEADLINE, [
        '',
        'Local does not appear to be running: the Nexus AI MCP connection-info',
        'file was not found, and it is written when the addon starts.',
        '',
        'These journeys drive the LIVE addon over MCP. There is nothing to fall',
        'back to and nothing was verified.',
        '',
        'Remedy:',
        '',
        '  ./dev-reload.sh          # build, rebuild native modules for Electron, launch Local',
        '',
        'then re-run:',
        '',
        '  npm run test:e2e:intelligence',
        '',
      ]),
    };
  }

  let tools: string[];
  try {
    tools = await input.listTools();
  } catch (err) {
    return {
      ok: false,
      banner: loudBanner(HEADLINE, [
        '',
        'The MCP endpoint did not answer.',
        '',
        `  endpoint: ${input.connectionInfo.url}`,
        `  error:    ${(err as Error)?.message ?? String(err)}`,
        '',
        'Connection info exists, so Local ran at some point — a stale file after a',
        'crash or a quit looks exactly like this.',
        '',
        'Remedy:',
        '',
        '  ./dev-reload.sh',
        '',
      ]),
    };
  }

  const missing = REQUIRED_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length > 0) {
    return {
      ok: false,
      banner: loudBanner(HEADLINE, [
        '',
        'Local is running and answering, but the loaded addon build does not',
        'expose every tool these journeys drive:',
        '',
        ...missing.map((t) => `  missing: ${t}`),
        '',
        `(${tools.length} tools were listed.)`,
        '',
        'This is almost always a stale build loaded in Local rather than a defect.',
        '',
        'Remedy:',
        '',
        '  npm run build && npm run rebuild   # then reload the addon in Local',
        '',
      ]),
    };
  }

  return { ok: true, tools };
}
