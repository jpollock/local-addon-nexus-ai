/**
 * WP-22 · the three states of the "Currently in" strip, rendered.
 *
 * The model test pins the strings; this pins that the band actually renders them, that
 * the three states are distinguishable, and that the affordance does the right thing in
 * each — a `Clear` button that opened a picker instead of clearing would pass every
 * string assertion in the model test.
 */
import { SiteContextStrip, type SiteChoice } from '../../../src/renderer/components/DockedPanel/SiteContextStrip';

const SITES: SiteChoice[] = [
  { id: 's1', name: 'alpine-outfitters' },
  { id: 's2', name: 'cedarvale' },
  { id: 's3', name: 'juniper-press' },
];

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function makeStrip(overrides: Partial<any> = {}) {
  const onPick = jest.fn();
  const onClear = jest.fn();
  const inst: any = new SiteContextStrip({
    mode: overrides.mode ?? 'viewed',
    siteName: overrides.siteName ?? 'cedarvale',
    viewedSiteName: overrides.viewedSiteName ?? 'cedarvale',
    sites: overrides.sites ?? SITES,
    onPick,
    onClear,
  });
  spySetState(inst);
  return { inst, onPick, onClear };
}

/** Every string in a rendered element tree, flattened. */
function textOf(node: any): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

/** Every element in a rendered tree whose type matches. */
function findAll(node: any, type: string): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n) => findAll(n, type));
  const here = node.type === type ? [node] : [];
  return here.concat(findAll(node.props?.children, type));
}

describe('SiteContextStrip — the three states render distinctly', () => {
  it('viewed names the site and offers to change it', () => {
    const { inst } = makeStrip({ mode: 'viewed', siteName: 'cedarvale' });
    const text = textOf(inst.render());
    expect(text).toContain('Currently in: cedarvale — your copy');
    expect(text).toContain('Change');
    expect(text).not.toContain('Clear');
  });

  it('none says the answers will be fleet-wide and offers to choose', () => {
    const { inst } = makeStrip({ mode: 'none', siteName: null, viewedSiteName: null });
    const text = textOf(inst.render());
    expect(text).toContain('No site selected — answers will be fleet-wide');
    expect(text).toContain('Choose a site');
    expect(text).not.toContain('Currently in');
  });

  it('override names the pinned site, discloses the screen, and offers to clear', () => {
    const { inst } = makeStrip({ mode: 'override', siteName: 'alpine-outfitters', viewedSiteName: 'cedarvale' });
    const text = textOf(inst.render());
    expect(text).toContain('Currently in: alpine-outfitters — your copy');
    expect(text).toContain("You're viewing cedarvale");
    expect(text).toContain('Clear');
  });

  it('marks its state on the band, so the three are distinguishable in the DOM', () => {
    expect(makeStrip({ mode: 'viewed' }).inst.render().props['data-nexus-site-strip']).toBe('viewed');
    expect(makeStrip({ mode: 'none', siteName: null }).inst.render().props['data-nexus-site-strip']).toBe('none');
    expect(makeStrip({ mode: 'override' }).inst.render().props['data-nexus-site-strip']).toBe('override');
  });
});

describe('SiteContextStrip — the affordance', () => {
  it('clears the pin in the override state rather than opening a picker', () => {
    const { inst, onClear } = makeStrip({ mode: 'override', siteName: 'alpine-outfitters' });
    inst.handleAction();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(inst.state.open).toBe(false);
  });

  it('opens the picker in the viewed state', () => {
    const { inst, onClear } = makeStrip({ mode: 'viewed' });
    inst.handleAction();
    expect(onClear).not.toHaveBeenCalled();
    expect(inst.state.open).toBe(true);
  });

  it('opens the picker in the none state', () => {
    const { inst } = makeStrip({ mode: 'none', siteName: null, viewedSiteName: null });
    inst.handleAction();
    expect(inst.state.open).toBe(true);
  });

  it('picking a site pins it and closes the list', () => {
    const { inst, onPick } = makeStrip({ mode: 'viewed' });
    inst.handleAction();
    inst.pick('s1');
    expect(onPick).toHaveBeenCalledWith('s1');
    expect(inst.state.open).toBe(false);
  });

  it('reopening starts from an unfiltered list', () => {
    // A query left behind hides sites the user expects to see, with nothing on screen
    // to explain the absence.
    const { inst } = makeStrip({ mode: 'viewed' });
    inst.handleAction();
    inst.setState({ query: 'juniper' });
    inst.handleAction(); // close
    inst.handleAction(); // reopen
    expect(inst.state.query).toBe('');
    expect(inst.visibleSites()).toHaveLength(3);
  });
});

describe('SiteContextStrip — the picker list', () => {
  it('filters by name', () => {
    const { inst } = makeStrip({ mode: 'viewed' });
    inst.setState({ query: 'CEDAR' });
    expect(inst.visibleSites().map((s: SiteChoice) => s.id)).toEqual(['s2']);
  });

  it('says so when nothing matches, rather than rendering an empty box', () => {
    const { inst } = makeStrip({ mode: 'viewed' });
    inst.setState({ open: true, query: 'nothing-like-this' });
    expect(textOf(inst.render())).toContain('No site matches that.');
  });

  it('says so when Local\'s list has not arrived', () => {
    const { inst } = makeStrip({ mode: 'none', siteName: null, viewedSiteName: null, sites: [] });
    inst.setState({ open: true });
    expect(textOf(inst.render())).toContain('No sites yet.');
  });

  it('offers a filter only once the list is long enough to need one', () => {
    const short = makeStrip({ mode: 'viewed', sites: SITES });
    short.inst.setState({ open: true });
    expect(findAll(short.inst.render(), 'input')).toHaveLength(0);

    const many = makeStrip({
      mode: 'viewed',
      sites: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `site-${i}` })),
    });
    many.inst.setState({ open: true });
    expect(findAll(many.inst.render(), 'input')).toHaveLength(1);
  });

  it('renders no picker at all while closed', () => {
    const { inst } = makeStrip({ mode: 'viewed' });
    expect(findAll(inst.render(), 'button')).toHaveLength(1); // just the affordance
  });
});
