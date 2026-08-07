import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';
import type { ScopeSite } from '../../../src/renderer/components/agents/fetchScopeSites';

const SITES: ScopeSite[] = [
  { id: 'p1', name: 'prod-one', environment: 'production', platform: 'WP Engine', createdAt: 5000 },
  { id: 's1', name: 'stage-one', environment: 'staging', platform: 'WP Engine', createdAt: 1000 },
  { id: 'l1', name: 'local-one', environment: 'local', platform: 'Local' }, // never indexed — no createdAt
];

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function makeSettings(overrides: Partial<any> = {}) {
  const instance: any = new AgentWorkspaceSettings({ agentId: 'security-sentinel', electron: undefined, effect: overrides.effect });
  spySetState(instance);
  instance.state.scopeSites = overrides.sites ?? SITES;
  const settings: any = {
    ...instance.state.settings,
    scope: overrides.scope ?? { siteIds: [] },
    scopeUpdatedAt: overrides.scopeUpdatedAt,
    savedScopes: overrides.savedScopes,
  };
  // Only present when a test explicitly wants to exercise the legacy-shape fallback.
  if (overrides.scanScope) {
    delete settings.scope;
    settings.scanScope = overrides.scanScope;
  }
  instance.state.settings = settings;
  const updateSettings = jest.spyOn(instance, 'updateSettings').mockImplementation(() => {});
  return { instance, updateSettings };
}

describe('AgentWorkspaceSettings — legacy scanScope migration (pre-unification on-disk data)', () => {
  it('reads the legacy explicit-mode siteIds when scope is entirely absent', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    expect(instance['currentScopeSiteIds']()).toEqual(['s1']);
  });

  it('treats legacy mode:"all" as no sites selected — there is no equivalent under the current model', () => {
    const { instance } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    expect(instance['currentScopeSiteIds']()).toEqual([]);
  });

  it('prefers scope over a legacy scanScope when both are somehow present', () => {
    const { instance } = makeSettings({ scope: { siteIds: ['p1'] } });
    instance.state.settings.scanScope = { mode: 'explicit', siteIds: ['s1'] };
    expect(instance['currentScopeSiteIds']()).toEqual(['p1']);
  });

  it('saving after opening a legacy scope always writes the unified scope field, completing the migration', () => {
    const { instance, updateSettings } = makeSettings({ scanScope: { mode: 'explicit', siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance['saveScopeEdit']();
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      scope: { siteIds: expect.arrayContaining(['s1']) },
    }));
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ scanScope: expect.anything() }));
  });
});

describe('AgentWorkspaceSettings — drift detection', () => {
  it('flags a WPE site created after the scope was last saved', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 2000, scope: { siteIds: [] } });
    const drifted = instance['getDriftedSites']();
    expect(drifted.map((s: ScopeSite) => s.id)).toEqual(['p1']); // created 5000, after 2000
  });

  it('does not flag a site created before the scope was saved', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 9000, scope: { siteIds: [] } });
    expect(instance['getDriftedSites']()).toEqual([]);
  });

  it('never flags a site with no known creation time (an unindexed local site)', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 1, scope: { siteIds: [] } });
    const drifted = instance['getDriftedSites']();
    expect(drifted.some((s: ScopeSite) => s.id === 'l1')).toBe(false);
  });

  it('flags a local site too, once it has been indexed and has a known createdAt', () => {
    const sites = [...SITES, { id: 'l2', name: 'local-two', environment: 'local' as const, platform: 'Local' as const, createdAt: 6000 }];
    const { instance } = makeSettings({ sites, scopeUpdatedAt: 2000, scope: { siteIds: [] } });
    const drifted = instance['getDriftedSites']();
    expect(drifted.map((s: ScopeSite) => s.id)).toEqual(expect.arrayContaining(['p1', 'l2']));
  });

  it('does not flag a drifted site that is already in the current scope', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: 2000, scope: { siteIds: ['p1'] } });
    expect(instance['getDriftedSites']()).toEqual([]);
  });

  it('reports no drift when the scope has never been saved (scopeUpdatedAt undefined)', () => {
    const { instance } = makeSettings({ scopeUpdatedAt: undefined });
    expect(instance['getDriftedSites']()).toEqual([]);
  });
});

describe('AgentWorkspaceSettings — staged scope editing (draft, not live)', () => {
  it('opening the editor initializes the draft from the currently-saved scope', () => {
    const { instance } = makeSettings({ scope: { siteIds: ['s1'] } });
    instance['openScopeEditor']();
    expect(instance.state.scopeExpanded).toBe(true);
    expect(instance.state.scopeDraftSelection).toEqual(new Set(['s1']));
  });

  it('editing the draft does not touch saved settings until Save is clicked', () => {
    const { instance, updateSettings } = makeSettings({ scope: { siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['s1', 'p1']); // simulate SitePicker's onChange
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('Cancel discards the draft without calling updateSettings', () => {
    const { instance, updateSettings } = makeSettings({ scope: { siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    instance['cancelScopeEdit']();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(instance.state.scopeExpanded).toBe(false);
    expect(instance.state.scopeDraftSelection).toBeNull();
  });

  it('Save commits the draft to scope and stamps scopeUpdatedAt', () => {
    const { instance, updateSettings } = makeSettings({ scope: { siteIds: ['s1'] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1', 'l1']);
    instance['saveScopeEdit']();

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      scope: { siteIds: expect.arrayContaining(['p1', 'l1']) },
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
    const { instance } = makeSettings({ scope: { siteIds: [] } });
    expect(flattenText(instance['renderScanScope']())).toContain('No sites selected — this agent will not run.');
  });

  it('renders "{n} sites — no production" when nothing selected is in production', () => {
    const { instance } = makeSettings({ scope: { siteIds: ['s1', 'l1'] } });
    expect(flattenText(instance['renderScanScope']())).toContain('2 sites — no production');
  });

  it('renders "{n} sites, {p} of them in production" for a mixed scope', () => {
    const { instance } = makeSettings({ scope: { siteIds: ['p1', 's1'] } });
    expect(flattenText(instance['renderScanScope']())).toContain('2 sites, 1 of them in production');
  });

  it('renders "1 site, in production" (not "1 sites, 1 of them") for a single-site production-only scope', () => {
    const { instance } = makeSettings({ scope: { siteIds: ['p1'] } });
    const text = flattenText(instance['renderScanScope']());
    expect(text).toContain('1 site, in production');
    expect(text).not.toContain('1 sites');
  });

  it('renders the "every site" form when the scope is exactly every known site and includes production', () => {
    const { instance } = makeSettings({ scope: { siteIds: SITES.map(s => s.id) } });
    expect(flattenText(instance['renderScanScope']())).toContain('Every site on the account, including 1 in production');
  });
});

describe('AgentWorkspaceSettings — v2 production warning under the picker', () => {
  it('shows the agent-derived, cadence-aware warning sentence when the draft includes production', () => {
    const { instance } = makeSettings({ scope: { siteIds: [] } });
    instance.state.settings.cadence = '0 * * * *'; // Hourly
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    expect(flattenText(instance['renderScanScope']())).toContain('1 live production site will be modified every hour.');
  });

  it('shows no warning sentence when the draft has no production sites', () => {
    const { instance } = makeSettings({ scope: { siteIds: [] } });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['s1']);
    expect(flattenText(instance['renderScanScope']())).not.toContain('will be modified');
  });

  it('uses "scanned" for a read-only agent instead of "modified"', () => {
    const { instance } = makeSettings({ scope: { siteIds: [] }, effect: 'readonly' });
    instance['openScopeEditor']();
    instance.state.scopeDraftSelection = new Set(['p1']);
    expect(flattenText(instance['renderScanScope']())).toContain('will be scanned');
  });
});

describe('AgentWorkspaceSettings — renderScanScope() smoke tests', () => {
  it('renders without throwing across the collapsed, expanded, drifted and legacy-scanScope states', () => {
    const { instance: collapsed } = makeSettings({ scope: { siteIds: ['s1'] } });
    expect(() => collapsed['renderScanScope']()).not.toThrow();

    const { instance: expanded } = makeSettings({ scope: { siteIds: ['s1'] } });
    expanded['openScopeEditor']();
    expect(() => expanded['renderScanScope']()).not.toThrow();

    const { instance: drifted } = makeSettings({ scopeUpdatedAt: 1, scope: { siteIds: [] } });
    expect(() => drifted['renderScanScope']()).not.toThrow();

    // Exercises a pre-migration agent whose on-disk settings still carry the retired scanScope shape.
    const { instance: legacy } = makeSettings({ scanScope: { mode: 'all', siteIds: [] } });
    expect(() => legacy['renderScanScope']()).not.toThrow();
  });
});
