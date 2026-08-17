/**
 * WP-18 · Global setup for the MCP-driven intelligence journeys.
 *
 * The journeys drive a RUNNING Local instance. This is the gate that makes a
 * missing one impossible to mistake for a pass: a loud banner and a DISTINCT
 * exit code, never a skip. TESTING_STRATEGY.md is explicit that an
 * environment-dependent test which can silently skip is worse than absent.
 *
 * `process.exit` rather than a thrown error, deliberately: jest reports a
 * globalSetup throw as exit 1, the same code a failing test produces, and
 * "never ran" reading as "ran and failed" is the confusion this whole packet
 * exists to remove.
 */
import { loadConnectionInfo, NexusMcpClient } from '../e2e-cli/helpers/mcp-client';
import { PREFLIGHT_EXIT_CODE, preflight } from './runner/preflight';
import { localProcessStart } from './runner/localProcess';

export default async function globalSetup(): Promise<void> {
  const info = loadConnectionInfo();

  const result = await preflight({
    connectionInfo: info,
    listTools: async () => {
      const client = new NexusMcpClient(info!);
      const tools = await client.listToolsForAnthropic();
      return tools.map((t) => t.name);
    },
  });

  if (!result.ok) {
    console.error(result.banner);
    process.exit(PREFLIGHT_EXIT_CODE);
  }

  console.log(`[e2e-intelligence] MCP endpoint ready: ${info!.url} (${result.tools.length} tools)`);

  // The boot anchor for the startup-log journey. Captured once, here, so every
  // journey sees the same value and a failure to establish it surfaces at the
  // gate rather than as a puzzling red inside one test.
  const boot = localProcessStart();
  if (boot) {
    process.env.E2E_INTEL_LOCAL_BOOT_ISO = boot.toISOString();
    console.log(`[e2e-intelligence] Local started at ${boot.toISOString()}`);
  } else {
    console.warn(
      '[e2e-intelligence] Could not determine when Local started — the startup-log ' +
        'journey will say so rather than assert against an anchor it does not have.'
    );
  }
}
