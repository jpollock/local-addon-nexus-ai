/**
 * Sheet 19 — search becomes filters. The interpretation is a removable
 * clause in the filter row; a clarification is the question plus the one
 * facet it names; source presses the segment instead of minting a chip; the
 * searched composition states its zeros.
 */
import { PropertiesTab, filtersToChips, removeChipFromFilters } from '../../../src/renderer/components/tabs/PropertiesTab';
import { serializeTree } from './helpers/serializeTree';
import type { FleetCollapse, PropertyView } from '../../../src/main/fleet/fleetCollapse';

const NOW = Date.now();
const iso = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const place = (over: any = {}) => ({
  rowId: 'wpe-1', kind: 'production', source: 'wpe', name: 'dbrains',
  domain: 'dbrains.wpengine.com', address: 'dbrains.wpengine.com', knowledge: 'searchable', ceiling: null,
  checked: { state: 'ok', finishedAt: iso(8), reason: null },
  checkedL2: { state: 'ok', finishedAt: iso(8), reason: null },
  checkedL3: { state: 'ok', finishedAt: iso(9), reason: null },
  status: null, wpVersion: '6.8', phpVersion: '8.2', pluginCount: 24, docCount: 412,
  needsYou: null, ...over,
});
const property = (over: any = {}): PropertyView => ({
  key: 'wpe:p1', name: 'dbrains', nameSource: 'portal', accountId: 'a1',
  accountName: 'dbrains', origin: 'wpe', places: [place()], hasCopy: false,
  rungs: ['searchable'], oldest: { state: 'ok', finishedAt: iso(8), reason: null },
  collision: false, lineage: ['x'], needsYou: null, ...over,
});
const collapse = (properties: PropertyView[]): FleetCollapse => ({
  properties,
  header: {
    total: properties.length,
    byOrigin: {
      local: properties.filter((p) => p.origin === 'local').length,
      wpe: properties.filter((p) => p.origin === 'wpe').length,
      external: properties.filter((p) => p.origin === 'external').length,
    },
    placesTotal: properties.reduce((n, p) => n + p.places.length, 0),
    neverLookedInside: 0, onThisMachine: 0, ceilings: [], needsYou: null,
  },
});
const props = (c: FleetCollapse, over: any = {}) => ({
  loaded: true, failed: false, collapse: c, onRetry: jest.fn(), ...over,
});
const tree = (inst: any) => JSON.stringify(serializeTree(inst.render()));

describe('filtersToChips — every clause readable, operator inside the value', () => {
  test('thresholds, windows, booleans and widened content all carry their operator', () => {
    const labels = filtersToChips({
      plugins: ['advanced-custom-fields'],
      stalePostDays: 30,
      minPluginCount: 4,
      phpEolOnly: true,
      contentQuery: 'tools equipment hardware',
      commentsDisabled: false,
    }).map((c) => c.label);
    expect(labels).toContain('Plugins: advanced-custom-fields');
    expect(labels).toContain('Not updated in: more than 30 days');   // never a bare "30 days"
    expect(labels).toContain('Plugins: at least 4');
    expect(labels).toContain('PHP: end of life');
    expect(labels).toContain('Content: "tools equipment hardware"'); // the widening shown whole
    expect(labels).toContain('Comments: enabled');
  });

  test('removing a chip removes exactly its clause — one value from an array, a scalar whole', () => {
    const f = { plugins: ['a', 'b'], phpEolOnly: true };
    const chips = filtersToChips(f);
    const afterOne = removeChipFromFilters(f, chips.find((c) => c.value === 'a')!);
    expect(afterOne.plugins).toEqual(['b']);
    const afterBool = removeChipFromFilters(afterOne, filtersToChips(afterOne).find((c) => c.key === 'phpEolOnly')!);
    expect('phpEolOnly' in afterBool).toBe(false);
    expect(afterBool.plugins).toEqual(['b']);
  });
});

describe('the interpretation flow', () => {
  test('an interpreted filter set renders as chips, clears the field, and source presses the segment', async () => {
    const onInterpret = jest.fn(async () => ({
      kind: 'filters' as const,
      filters: { plugins: ['advanced-custom-fields'], source: 'wpe' },
    }));
    const onResolveFilterIds = jest.fn(async () => ['wpe-1']);
    const inst: any = new (PropertiesTab as any)(props(collapse([property()]), { onInterpret, onResolveFilterIds }));
    inst.setState = (u: any) => { Object.assign(inst.state, typeof u === 'function' ? u(inst.state) : u); };
    inst.state.query = 'ACF sites on WPE';

    await inst.submitQuery();

    expect(onInterpret).toHaveBeenCalledWith('ACF sites on WPE');
    expect(inst.state.origin).toBe('wpe');                               // segment pressed
    expect(onResolveFilterIds).toHaveBeenCalledWith({ plugins: ['advanced-custom-fields'] }); // no source key
    expect(inst.state.query).toBe('');                                   // the query became a control
    const t = tree(inst);
    expect(t).toContain('Plugins: advanced-custom-fields');
    expect(t).not.toContain('Source: wpe');                              // one control per axis
  });

  test('the id set narrows the list, and the composition states its zeros', async () => {
    const wpeP = property();
    const localP = property({ key: 'local:L1', name: 'solo', origin: 'local',
      places: [place({ rowId: 'L1', source: 'local', kind: 'local' })] });
    const inst: any = new (PropertiesTab as any)(props(collapse([wpeP, localP]), {
      onInterpret: jest.fn(), onResolveFilterIds: jest.fn(),
    }));
    inst.state.interp = { filters: { plugins: ['acf'] }, ids: ['wpe-1'] };
    const t = tree(inst);
    expect(t).toContain('dbrains');
    expect(t).not.toContain('"solo"');
    expect(t).toContain('matched: none on your machine · 1 WP Engine · none external');
  });

  test('Board F: a clarification renders the question with the named facet open beneath it', () => {
    const inst: any = new (PropertiesTab as any)(props(collapse([property()]), {
      onInterpret: jest.fn(),
      filterOptions: { plugins: [], themes: [], wpVersions: [], phpVersions: ['7.4', '8.1'], pluginCounts: {}, wpVersionCounts: {} },
    }));
    inst.state.clarify = { question: 'Which PHP versions count as old?', facet: 'phpVersions', forText: 'sites on old PHP' };
    const t = tree(inst);
    expect(t).toContain('Which PHP versions count as old?');
    expect(t).toContain('7.4');                        // the facet's values, right beneath
    expect(t).not.toContain('Ask this in chat');       // a facet question is answerable here
  });

  test("the unresolvable case renders the surface's own door, never routing advice", () => {
    const onOpenComposer = jest.fn();
    const inst: any = new (PropertiesTab as any)(props(collapse([property()]), {
      onInterpret: jest.fn(), onOpenComposer,
    }));
    inst.state.clarify = { question: "Traffic data isn't available for these sites.", facet: null, forText: 'busy sites' };
    const t = tree(inst);
    expect(t).toContain('Ask this in chat');
    expect(t).not.toContain('Ask/Tell');
  });
});
