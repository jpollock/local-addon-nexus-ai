import { mockContext } from '../../../../src/main/agent-sdk/testing';
import type { AgentDefinition } from '../../../../src/main/agent-sdk/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const agent: AgentDefinition = require('../../../../agents/seo-insights/agent').default;

/**
 * seo-insights' scheduled run used to fall back to a "watchlist" state key, then to
 * auto-picking the largest Local sites by post count — both acted without the user having
 * chosen anything, the same "unconfigured must never mean pick-for-me" bug security-sentinel's
 * resolveScanScope exists to prevent. Replaced with the same settings.scope.siteIds field
 * security-sentinel and log-processor use.
 */
describe('seo-insights — agent.effect', () => {
  it('declares effect: writes — it pulls WPE installs to a local sandbox and creates sites', () => {
    expect((agent as unknown as { effect?: string }).effect).toBe('writes');
  });
});

describe('seo-insights — producesApprovals / producesReports', () => {
  it('produces reports (the Site Content Report), not approvals — no gated action exists to pause on', () => {
    const a = agent as unknown as { producesApprovals?: boolean; producesReports?: boolean };
    expect(a.producesApprovals).toBe(false);
    expect(a.producesReports).toBe(true);
  });
});

describe('seo-insights — wpe:sync.completed trigger removed (2026-08-07 incident class)', () => {
  it('does not subscribe to wpe:sync.completed — its only real publisher is the fleet-wide, opt-in WpeRefreshScheduler', () => {
    expect(agent.triggers.some((t: { type: string; pattern?: string }) => t.type === 'event' && t.pattern === 'wpe:sync.completed')).toBe(false);
  });

  it('still has exactly the weekly cron trigger', () => {
    expect(agent.triggers).toHaveLength(1);
    expect(agent.triggers[0].type).toBe('cron');
  });
});

describe('seo-insights — scheduled run scope (no event payload)', () => {
  it('does nothing when scope is entirely absent — no watchlist or auto-pick fallback remains', async () => {
    const ctx = mockContext(); // no settings.scope, no tools configured
    const info = jest.spyOn(ctx.log, 'info');
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('no sites in scope'));
  });

  it('does nothing when scope is an empty list', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const info = jest.spyOn(ctx.log, 'info');
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('no sites in scope'));
  });

  it('never touches fleet_sql or any site when scope is empty — proves no auto-pick remains', async () => {
    const ctx = mockContext(); // tools intentionally unconfigured — any invoke() call throws
    await expect(agent.run(ctx)).resolves.not.toThrow();
  });
});
