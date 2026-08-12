/**
 * The E2E harness must not kill a Local the developer is using.
 *
 * This pins the decision only. The I/O that acts on it lives in
 * environment.ts; see localLaunchPlan.ts for why the decision is separate.
 */
import { planLocalLaunch, planNeedsManualRebuild } from '../../e2e/helpers/localLaunchPlan';

const reachable = { mcpReachable: true, graphqlReady: true };
const dead = { mcpReachable: false, graphqlReady: false };

describe('planLocalLaunch', () => {
  it('adopts a Local that is already answering', () => {
    expect(planLocalLaunch({ ...reachable, manageLocal: false, devPath: null }))
      .toEqual({ action: 'adopt' });
  });

  it('does not adopt when MCP answers but GraphQL has not written its info yet', () => {
    // Half-started Local: the CLI tests would fail on a missing token.
    expect(planLocalLaunch({ mcpReachable: true, graphqlReady: false, manageLocal: false, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('launches production Local when nothing is answering', () => {
    expect(planLocalLaunch({ ...dead, manageLocal: false, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('launches the dev build when NEXUS_E2E_LOCAL_PATH is set', () => {
    expect(planLocalLaunch({ ...dead, manageLocal: false, devPath: '/repo/flywheel-local' }))
      .toEqual({ action: 'launch', target: 'dev', killFirst: true });
  });

  it('kills and owns Local when NEXUS_E2E_MANAGE_LOCAL is set, even if one is running', () => {
    // CI has no human session to protect. This is the ONLY path that may
    // kill a reachable Local.
    expect(planLocalLaunch({ ...reachable, manageLocal: true, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('honours NEXUS_E2E_LOCAL_PATH under manage mode too', () => {
    expect(planLocalLaunch({ ...reachable, manageLocal: true, devPath: '/repo/flywheel-local' }))
      .toEqual({ action: 'launch', target: 'dev', killFirst: true });
  });
});

describe('planNeedsManualRebuild', () => {
  it('is false when adopting — we touch nothing the developer has', () => {
    expect(planNeedsManualRebuild({ action: 'adopt' })).toBe(false);
  });

  it('is false for a production launch — dev-reload.sh already builds and rebuilds', () => {
    expect(planNeedsManualRebuild({ action: 'launch', target: 'production', killFirst: true })).toBe(false);
  });

  it('is true only for the dev build, which we spawn ourselves', () => {
    expect(planNeedsManualRebuild({ action: 'launch', target: 'dev', killFirst: true })).toBe(true);
  });
});
