import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';
import type { ScopeSite } from '../../../src/renderer/components/agents/fetchScopeSites';

const SITES: ScopeSite[] = [
  { id: 'p1', name: 'prod-one', environment: 'production', platform: 'WP Engine', createdAt: 5000 },
  { id: 's1', name: 'stage-one', environment: 'staging', platform: 'WP Engine', createdAt: 1000 },
  { id: 'l1', name: 'local-one', environment: 'local', platform: 'Local' }, // no createdAt
];

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function makeSettings(overrides: Partial<any> = {}) {
  const instance: any = new AgentWorkspaceSettings({ agentId: 'security-sentinel', electron: undefined });
  spySetState(instance);
  instance.state.scopeSites = overrides.sites ?? SITES;
  instance.state.settings = {
    ...instance.state.settings,
    scanScope: overrides.scanScope ?? { mode: 'explicit', siteIds: [] },
    scopeUpdatedAt: overrides.scopeUpdatedAt,
    savedScopes: overrides.savedScopes,
  };
  const updateSettings = jest.spyOn(instance, 'updateSettings').mockImplementation(() => {});
  return { instance, updateSettings };
}

describe('AgentWorkspaceSettings — "Every site" mode retired, transparent migration', () => {
  it('treats legacy mode:"all" data as every currently-known site, with no behavior change at read time', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    expect(instance['currentScopeSiteIds']()).toEqual(SITES.map(s => s.id));
  });

  it('opening the editor on a legacy mode:"all" agent pre-selects every known site', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    instance['openScopeEditor']();
    expect(instance.state.scopeDraftSelection).toEqual(new Set(SITES.map(s => s.id)));
  });

  it('saving after opening a legacy mode:"all" scope always writes mode:"explicit", completing the migration', () => {
    const { instance, updateSettings } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    instance['openScopeEditor']();
    instance['saveScopeEdit']();
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      scanScope: expect.objectContaining({ mode: 'explicit' }),
    }));
  });

  it('an explicit-mode scope is read as-is, unaffected by the migration path', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    expect(instance['currentScopeSiteIds']()).toEqual(['s1']);
  });
});

describe('AgentWorkspaceSettings — drift detection', () => {
  it('flags a WPE site created after the scope was last saved', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 2000, scanScope: { mode: 'explicit', siteIds: [] } });
    const drifted = instance['getDriftedSites']();
    expect(drifted.map((s: ScopeSite) => s.id)).toEqual(['p1']); // created 5000, after 2000
  });

  it('does not flag a site created before the scope was saved', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 9000, scanScope: { mode: 'explicit', siteIds: [] } });
    expect(instance['getDriftedSites']()).toEqual([]);
  });

  it('never flags local sites — no creation-time data is available for them', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 1, scanScope: { mode: 'explicit', siteIds: [] } });
    const drifted = instance['getDriftedSites']();
    expect(drifted.some((s: ScopeSite) => s.id === 'l1')).toBe(false);
  });

  it('does not flag a drifted site that is already in the current scope', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 2000, scanScope: { mode: 'explicit', siteIds: ['p1'] } });
    expect(instance['getDriftedSites']()).toEqual([]);
  });

  it('reports no drift when the scope has never been saved (scopeUpdatedAt undefined)', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: undefined });
    expect(instance['getDriftedSites']()).toEqual([]);
  });
});

describe('AgentWorkspaceSettings — staged scope editing (draft, not live)', () => {
  it('opening the editor initializes the draft from the currently-saved scope', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    instance['openScopeEditor']();
    expect(instance.state.scopeExpanded).toBe(true);
    expect(instance.state.scopeDraftSelection).toEqual(new Set(['s1']));
  });

  it('editing the draft does not touch saved settings until Save is clicked', () => {
    const { instance, updateSettings } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['s1', 'p1']); // simulate SitePicker's onChange
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('Cancel discards the draft without calling updateSettings', () => {
    const { instance, updateSettings } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    instance['cancelScopeEdit']();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(instance.state.scopeExpanded).toBe(false);
    expect(instance.state.scopeDraftSelection).toBeNull();
  });

  it('Save commits the draft to scanScope and stamps scopeUpdatedAt', () => {
    const { instance, updateSettings } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1', 'l1']);
    instance['saveScopeEdit']();

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      scanScope: { mode: 'explicit', siteIds: expect.arrayContaining(['p1', 'l1']) },
      scopeUpdatedAt: expect.any(Number),
    }));
    expect(instance.state.scopeExpanded).toBe(false);
    expect(instance.state.scopeDraftSelection).toBeNull();
  });

  it('Save is a no-op when there is no active draft', () => {
    const { instance, updateSettings } = makeSettings();
    instance.state.scopeDraftSelection = null;
    instance['saveScopeEdit']();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

describe('AgentWorkspaceSettings — v2 scope-sentence forms', () => {
  it('renders "no sites selected" when the scope is empty', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: [] } });
    expect(flattenText(instance['renderScanScope']())).toContain('No sites selected — this agent will not run.');
  });

  it('renders "{n} sites — no production" when nothing selected is in production', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1', 'l1'] } });
    expect(flattenText(instance['renderScanScope']())).toContain('2 sites — no production');
  });

  it('renders "{n} sites, {p} of them in production" for a mixed scope', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['p1', 's1'] } });
    expect(flattenText(instance['renderScanScope']())).toContain('2 sites, 1 of them in production');
  });

  it('renders "1 site, in production" (not "1 sites, 1 of them") for a single-site production-only scope', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['p1'] } });
    const text = flattenText(instance['renderScanScope']());
    expect(text).toContain('1 site, in production');
    expect(text).not.toContain('1 sites');
  });

  it('renders the "every site" form when the scope is exactly every known site and includes production', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: SITES.map(s => s.id) } });
    expect(flattenText(instance['renderScanScope']())).toContain('Every site on the account, including 1 in production');
  });
});

describe('AgentWorkspaceSettings — v2 production warning under the picker', () => {
  it('shows the agent-derived, cadence-aware warning sentence when the draft includes production', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: [] } });
    instance.state.settings.cadence = '0 * * * *'; // Hourly
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    expect(flattenText(instance['renderScanScope']())).toContain('1 live production site will be modified every hour.');
  });

  it('shows no warning sentence when the draft has no production sites', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: [] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['s1']);
    expect(flattenText(instance['renderScanScope']())).not.toContain('will be modified');
  });

  it('uses "scanned" for a read-only agent instead of "modified"', () => {
    const instance: any = new AgentWorkspaceSettings({ agentId: 'security-sentinel', electron: undefined, effect: 'readonly' });
    spySetState(instance);
    instance.state.scopeSites = SITES;
    instance.state.settings = { ...instance.state.settings, scanScope: { mode: 'explicit', siteIds: [] } };
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    expect(flattenText(instance['renderScanScope']())).toContain('will be scanned');
  });
});

describe('AgentWorkspaceSettings — renderScanScope() smoke tests', () => {
  it('renders without throwing across the collapsed, expanded, drifted and legacy mode:"all" states', () => {
    const { instance: collapsed } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    expect(() => collapsed['renderScanScope']()).not.toThrow();

    const { instance: expanded } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    expanded['openScopeEditor']();
    expect(() => expanded['renderScanScope']()).not.toThrow();

    const { instance: drifted } = makeSettings({ scopeUpdatedAt: 1, scanScope: { mode: 'explicit', siteIds: [] } });
    expect(() => drifted['renderScanScope']()).not.toThrow();

    // No live "every site" toggle exists anymore — this only exercises a pre-migration agent
    // whose settings still carry the retired mode:'all' shape.
    const { instance: legacyAll } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    expect(() => legacyAll['renderScanScope']()).not.toThrow();
  });
});
