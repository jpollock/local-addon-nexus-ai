import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

function makeSettings(producesApprovals: boolean | undefined) {
  const instance: any = new AgentWorkspaceSettings({ agentId: 'log-processor', electron: undefined, producesApprovals });
  spySetState(instance);
  instance.state.scopeSites = [];
  return instance;
}

/**
 * AUTONOMY_OPTIONS' copy ("clones a sandbox", "pushing to production") is security-sentinel's
 * own remediation model, and ctx.autonomy is read only by security-sentinel/agent.js — showing
 * this card for log-processor or seo-insights was a dead control with misleading copy.
 */
describe('AgentWorkspaceSettings — Autonomy level card gated on producesApprovals', () => {
  it('hides the card when the agent declares producesApprovals: false', () => {
    const instance = makeSettings(false);
    const text = flattenText(instance.render());
    expect(text).not.toContain('Autonomy level');
    expect(text).not.toContain('sandbox');
  });

  it('shows the card when the agent declares producesApprovals: true', () => {
    const instance = makeSettings(true);
    expect(flattenText(instance.render())).toContain('Autonomy level');
  });

  it('shows the card while status is still loading (producesApprovals undefined), to avoid a flash', () => {
    const instance = makeSettings(undefined);
    expect(flattenText(instance.render())).toContain('Autonomy level');
  });
});

describe('the Sites-tab pointer line', () => {
  function makeSettings(props: Record<string, any>) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AgentWorkspaceSettings } = require('../../../src/renderer/components/agents/AgentWorkspaceSettings');
    const instance: any = new AgentWorkspaceSettings({ agentId: 'x', electron: undefined, ...props });
    return instance;
  }

  function textOf(node: any): string {
    if (node === null || node === undefined || node === false || node === true) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (node.props) return textOf(node.props.children);
    return '';
  }

  it('uses the agent’s own noun and verb', () => {
    // web-analytics has no `scope.siteIds` at all — a GA4 binding is the opt-in — so reading that
    // field reported "no installs switched on" for an agent that was in fact running.
    const wa = makeSettings({ sitesTabCount: 1, sitesTabNoun: 'site', sitesTabVerb: 'bound to a property' });
    expect(textOf(wa['renderScopeElsewhereLine']())).toContain('1 site bound to a property');

    const lp = makeSettings({ sitesTabCount: 2, sitesTabNoun: 'install', sitesTabVerb: 'switched on' });
    expect(textOf(lp['renderScopeElsewhereLine']())).toContain('2 installs switched on');
  });

  it('says nothing will run when the count is zero, in the agent’s own words', () => {
    const wa = makeSettings({ sitesTabCount: 0, sitesTabNoun: 'site', sitesTabVerb: 'bound to a property' });
    const text = textOf(wa['renderScopeElsewhereLine']());
    expect(text).toContain('No sites are bound to a property yet');
    expect(text).not.toContain('install');
  });

  it('falls back to the scope field for an agent that has no Sites tab', () => {
    const generic = makeSettings({});
    expect(textOf(generic['renderScopeElsewhereLine']())).toContain('install');
  });
});
