import { SitePicker, selectedProductionCount, productionWarningVerb } from '../../../src/renderer/components/agents/SitePicker';
import type { ScopeSite } from '../../../src/renderer/components/agents/fetchScopeSites';

const SITES: ScopeSite[] = [
  { id: 'p1', name: 'prod-one', environment: 'production', platform: 'WP Engine', createdAt: 1000 },
  { id: 's1', name: 'stage-one', environment: 'staging', platform: 'WP Engine', createdAt: 2000 },
  { id: 'd1', name: 'dev-one', environment: 'development', platform: 'WP Engine', createdAt: 3000 },
  { id: 'l1', name: 'local-one', environment: 'local', platform: 'Local' },
  { id: 'l2', name: 'local-two', environment: 'local', platform: 'Local' },
];

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function makePicker(overrides: Partial<any> = {}) {
  const onChange = jest.fn((next: Set<string>) => { instance.props.selection = next; });
  const instance: any = new SitePicker({
    sites: overrides.sites ?? SITES,
    selection: overrides.selection ?? new Set<string>(),
    onChange,
    allowsProduction: overrides.allowsProduction ?? true,
  });
  spySetState(instance);
  return { instance, onChange };
}

describe('SitePicker — filtering never touches the basket (the core v2 rule)', () => {
  it('search narrows the left list without touching the selection', () => {
    const { instance } = makePicker({ selection: new Set(['p1', 'l1']) });
    instance.props.selection = new Set(['p1', 'l1']);

    instance.setState({ query: 'stage' });
    const visible = instance['getVisible']();

    expect(visible.map((s: ScopeSite) => s.id)).toEqual(['s1']);
    expect(instance.props.selection).toEqual(new Set(['p1', 'l1']));
  });

  it('the platform tab narrows the left list without touching the selection', () => {
    const { instance } = makePicker({ selection: new Set(['p1', 'l1']) });
    instance.setState({ platformFilter: 'Local' });
    expect(instance['getVisible']().map((s: ScopeSite) => s.id)).toEqual(['l1', 'l2']);
    expect(instance.props.selection).toEqual(new Set(['p1', 'l1']));
  });
});

describe('SitePicker — clicking a row toggles it', () => {
  it('clicking an unselected row adds it', () => {
    const { instance } = makePicker();
    instance['toggleSite'](SITES[1]); // stage-one
    expect(instance.props.selection).toEqual(new Set(['s1']));
  });

  it('clicking an already-selected row removes it', () => {
    const { instance } = makePicker({ selection: new Set(['s1']) });
    instance['toggleSite'](SITES[1]);
    expect(instance.props.selection).toEqual(new Set());
  });

  it('removeSite (basket × ) removes a single site', () => {
    const { instance } = makePicker({ selection: new Set(['s1', 'l1']) });
    instance['removeSite']('s1');
    expect(instance.props.selection).toEqual(new Set(['l1']));
  });
});

describe('SitePicker — quick-add chips are additive, never a replace', () => {
  it('"+ All WP Engine" adds WPE sites on top of the existing selection', () => {
    const { instance } = makePicker({ selection: new Set(['l1']) });
    instance['addAllWpEngine']();
    expect(instance.props.selection).toEqual(new Set(['l1', 'p1', 's1', 'd1']));
  });

  it('"+ All non-prod" adds every non-production site', () => {
    const { instance } = makePicker({ selection: new Set(['p1']) });
    instance['addAllNonProd']();
    expect(instance.props.selection).toEqual(new Set(['p1', 's1', 'd1', 'l1', 'l2']));
  });

  it('"+ Everything" adds every selectable site', () => {
    const { instance } = makePicker();
    instance['addEverything']();
    expect(instance.props.selection).toEqual(new Set(['p1', 's1', 'd1', 'l1', 'l2']));
  });

  it('"+ Everything" excludes policy-locked production sites', () => {
    const { instance } = makePicker({ allowsProduction: false });
    instance['addEverything']();
    expect(instance.props.selection).toEqual(new Set(['s1', 'd1', 'l1', 'l2']));
  });
});

describe('SitePicker — Clear and per-group remove', () => {
  it('"Clear" empties the selection entirely', () => {
    const { instance } = makePicker({ selection: new Set(['p1', 's1', 'l1']) });
    instance['clearAll']();
    expect(instance.props.selection).toEqual(new Set());
  });

  it('a group header × removes only that environment\'s sites', () => {
    const { instance } = makePicker({ selection: new Set(['l1', 'l2', 's1']) });
    instance['removeGroup']('local');
    expect(instance.props.selection).toEqual(new Set(['s1']));
  });
});

describe('SitePicker — production-locked policy (allowsProduction: false)', () => {
  it('clicking a locked (production) row is a no-op', () => {
    const { instance, onChange } = makePicker({ allowsProduction: false });
    instance['toggleSite'](SITES[0]); // prod-one
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a non-production row still toggles normally under the same policy', () => {
    const { instance } = makePicker({ allowsProduction: false });
    instance['toggleSite'](SITES[1]); // stage-one
    expect(instance.props.selection).toEqual(new Set(['s1']));
  });
});

describe('SitePicker — search matches name or ID', () => {
  it('matches by site name, case-insensitively', () => {
    const { instance } = makePicker();
    instance.setState({ query: 'PROD' });
    expect(instance['getVisible']().map((s: ScopeSite) => s.id)).toEqual(['p1']);
  });

  it('matches by site ID', () => {
    const { instance } = makePicker();
    instance.setState({ query: 'l2' });
    expect(instance['getVisible']().map((s: ScopeSite) => s.id)).toEqual(['l2']);
  });
});

describe('selectedProductionCount', () => {
  it('counts only production sites in the selection', () => {
    expect(selectedProductionCount(SITES, new Set(['p1', 's1', 'l1']))).toBe(1);
    expect(selectedProductionCount(SITES, new Set(['s1', 'l1']))).toBe(0);
    expect(selectedProductionCount(SITES, new Set())).toBe(0);
  });
});

describe('productionWarningVerb', () => {
  it('derives the verb from the agent\'s declared effect, never hardcoded', () => {
    expect(productionWarningVerb('readonly')).toBe('scanned');
    expect(productionWarningVerb('writes')).toBe('modified');
  });
});

describe('SitePicker — platform tabs hide when a platform has zero sites', () => {
  it('omits a platform tab that would only ever show "No sites match"', () => {
    const { instance } = makePicker(); // SITES has no 'External' platform
    const tabsRow = instance['renderSearchAndTabs']();
    const labels = tabsRow.props.children[1].props.children.map((t: any) => t.props.children);
    expect(labels).toEqual(['All 5', 'WP Engine 3', 'Local 2']);
  });
});

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

describe('SitePicker — a selected id that no longer resolves to a known site', () => {
  it('surfaces it in a "NOT FOUND" basket group instead of silently dropping it', () => {
    const { instance } = makePicker({ selection: new Set(['s1', 'ghost-id']) });
    const text = flattenText(instance.render());
    expect(text).toContain('NOT FOUND');
    expect(text).toContain('ghost-id');
  });

  it('is still counted in "In scope" — the header and the basket never disagree', () => {
    const { instance } = makePicker({ selection: new Set(['s1', 'ghost-id']) });
    const text = flattenText(instance.render());
    expect(text).toContain('In scope');
    expect(text).toContain('2'); // header count includes the unresolved id
  });

  it('removeSite on an unresolved id removes it from the selection like any other', () => {
    const { instance } = makePicker({ selection: new Set(['s1', 'ghost-id']) });
    instance['removeSite']('ghost-id');
    expect(instance.props.selection).toEqual(new Set(['s1']));
  });

  it('does not render a NOT FOUND group when every selected id resolves', () => {
    const { instance } = makePicker({ selection: new Set(['s1']) });
    expect(flattenText(instance.render())).not.toContain('NOT FOUND');
  });
});

describe('SitePicker — render() smoke tests', () => {
  it('renders without throwing in every prop combination exercised elsewhere', () => {
    const { instance: basic } = makePicker();
    expect(() => basic.render()).not.toThrow();

    const { instance: withSelection } = makePicker({ selection: new Set(['p1', 's1', 'l1']) });
    expect(() => withSelection.render()).not.toThrow();

    const { instance: locked } = makePicker({ allowsProduction: false, selection: new Set(['s1']) });
    expect(() => locked.render()).not.toThrow();

    const { instance: empty } = makePicker({ sites: [] });
    expect(() => empty.render()).not.toThrow();
  });

  it('renders the policy banner only when production sites actually exist and are locked', () => {
    const { instance: locked } = makePicker({ allowsProduction: false });
    expect(() => locked.render()).not.toThrow();
    expect(locked['renderPolicyBanner']()).not.toBeNull();

    const { instance: noProd } = makePicker({ allowsProduction: false, sites: SITES.filter(s => s.environment !== 'production') });
    expect(noProd['renderPolicyBanner']()).toBeNull();
  });
});
