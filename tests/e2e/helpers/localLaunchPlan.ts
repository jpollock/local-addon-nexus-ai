/**
 * Should the E2E harness adopt the running Local, or start its own?
 *
 * Kept as a pure function, separate from environment.ts, because the bug this
 * fixes was a missing decision rather than faulty I/O: startLocal() documented
 * "returns null if Local was already running" and then killed it anyway. A
 * decision with no I/O in it can be tested without spawning Electron.
 */

export interface LocalLaunchInput {
  /** MCP server answered a request. */
  mcpReachable: boolean;
  /** graphql-connection-info.json exists and parsed. */
  graphqlReady: boolean;
  /** NEXUS_E2E_MANAGE_LOCAL === '1' — CI opts in to kill-and-own. */
  manageLocal: boolean;
  /** NEXUS_E2E_LOCAL_PATH — launch the flywheel-local dev build instead. */
  devPath: string | null;
}

export type LocalLaunchPlan =
  | { action: 'adopt' }
  | { action: 'launch'; target: 'production' | 'dev'; killFirst: boolean };

export function planLocalLaunch(input: LocalLaunchInput): LocalLaunchPlan {
  const launch = (): LocalLaunchPlan => ({
    action: 'launch',
    target: input.devPath ? 'dev' : 'production',
    killFirst: true,
  });

  // Manage mode is the only path allowed to kill a Local that is answering.
  if (input.manageLocal) return launch();

  // Both must be true. A Local whose MCP is up but whose GraphQL info is not
  // yet written cannot serve the CLI tests, so adopting it would fail later
  // and more confusingly.
  if (input.mcpReachable && input.graphqlReady) return { action: 'adopt' };

  return launch();
}

/**
 * Does the harness have to build and rebuild the addon itself?
 *
 * Only for the dev build, which we spawn directly. The production path shells
 * out to ./dev-reload.sh, which already runs `npm run build` and
 * `npm run rebuild` — and, critically, injects nexus.env.local through
 * `open --env`, which nothing else does.
 *
 * Adopting rebuilds nothing at all: the jest process never imports addon
 * source (jest.e2e.config.js sets no moduleNameMapper — "we talk to the addon
 * over HTTP"), so the only reason to touch the native binding is a Local we
 * are about to start ourselves.
 */
export function planNeedsManualRebuild(plan: LocalLaunchPlan): boolean {
  return plan.action === 'launch' && plan.target === 'dev';
}
