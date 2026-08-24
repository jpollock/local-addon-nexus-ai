/**
 * The Properties view — the fleet collapse drawn (plan 2026-08-24, Phase 2).
 *
 * Same serialization rule as sites-tab.test.ts: `new PropertiesTab(props)
 * .render()`, never `serializeTree(createElement(...))` — the element form
 * serializes to props and makes every assertion vacuous.
 */
import { PropertiesTab } from '../../../src/renderer/components/tabs/PropertiesTab';
import { serializeTree } from './helpers/serializeTree';
import type { FleetCollapse, PropertyView } from '../../../src/main/fleet/fleetCollapse';

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString();

const place = (over: any = {}) => ({
  rowId: 'wpe-1', kind: 'production', source: 'wpe', name: 'dbrains',
  domain: 'dbrains.wpengine.com', knowledge: 'searchable', ceiling: null,
  checked: { state: 'ok', finishedAt: iso(8), reason: null }, status: null,
  ...over,
});

const property = (over: any = {}): PropertyView => ({
  key: 'wpe:p1', name: 'dbrains', nameSource: 'portal', accountId: 'a1',
  accountName: 'dbrains', origin: 'wpe', places: [place()], hasCopy: false,
  rungs: ['searchable'], oldest: { state: 'ok', finishedAt: iso(8), reason: null },
  collision: false, ...over,
});

function collapse(properties: PropertyView[], headerOver: any = {}): FleetCollapse {
  const places = properties.flatMap((p) => p.places);
  return {
    properties,
    header: {
      total: properties.length,
      byOrigin: {
        local: properties.filter((p) => p.origin === 'local').length,
        wpe: properties.filter((p) => p.origin === 'wpe').length,
        external: properties.filter((p) => p.origin === 'external').length,
      },
      placesTotal: places.length,
      neverLookedInside: places.filter((pl) => pl.knowledge === 'nothing').length,
      onThisMachine: properties.filter((p) => p.origin === 'local' || p.hasCopy).length,
      ...headerOver,
    },
  };
}

const props = (c: FleetCollapse, over: any = {}) => ({
  loaded: true, failed: false, collapse: c, onRetry: jest.fn(), ...over,
});

function rendered(c: FleetCollapse, mutate?: (inst: any) => void): string {
  const inst: any = new (PropertiesTab as any)(props(c));
  if (mutate) mutate(inst);
  return JSON.stringify(serializeTree(inst.render()));
}

describe('PropertiesTab', () => {
  test('a single-place property renders flat — no caret, place named inline', () => {
    const t = rendered(collapse([property()]));
    expect(t).toContain('dbrains');
    expect(t).toContain('production · WP Engine');
    expect(t).not.toContain('▸');
  });

  test('a multi-place property gets a caret, and places render only when opened', () => {
    const multi = property({
      key: 'wpe:p2', name: 'benfischer',
      places: [place({ rowId: 'wpe-1', name: 'benfischer' }),
               place({ rowId: 'wpe-2', name: 'benfischer1stg', kind: 'staging' })],
      rungs: ['searchable'],
    });
    const closed = rendered(collapse([multi]));
    expect(closed).toContain('▸');
    expect(closed).toContain('2 places');
    expect(closed).not.toContain('benfischer1stg');

    const open = rendered(collapse([multi]), (inst) => { inst.state.open = { 'wpe:p2': true }; });
    expect(open).toContain('▾');
    expect(open).toContain('benfischer1stg');
  });

  test('search never hides a hit: an out-of-filter match renders, labelled', () => {
    const local = property({ key: 'local:L1', name: 'solo', origin: 'local',
      places: [place({ rowId: 'L1', source: 'local', kind: 'local', name: 'solo' })] });
    const wpe = property({ key: 'wpe:p1', name: 'remoteonly' });
    const t = rendered(collapse([local, wpe]), (inst) => {
      inst.state.origin = 'local';
      inst.state.query = 'remoteonly';
    });
    expect(t).toContain('remoteonly');
    expect(t).toContain('outside the current filter');
  });

  test('a failed roll-up shows the transport reason; a clean multi-place shows labelled oldest', () => {
    const failing = property({
      oldest: { state: 'fail', finishedAt: iso(5), reason: 'NOT NULL constraint failed: users.username' },
    });
    expect(rendered(collapse([failing]))).toContain('NOT NULL constraint failed');

    const multi = property({
      key: 'wpe:p2',
      places: [place(), place({ rowId: 'wpe-2', kind: 'staging' })],
      oldest: { state: 'ok', finishedAt: iso(12), reason: null },
    });
    expect(rendered(collapse([multi]))).toContain('oldest 12h ago');
  });

  test('ceilings, collisions and unnamed properties are stated on the row', () => {
    const auto = property({
      key: 'wpe:au', name: 'jpmeautoscale',
      places: [place({ ceiling: 'AutoscaleAlpha has no SSH gateway', knowledge: 'basic' })],
      rungs: ['basic'],
    });
    const t1 = rendered(collapse([auto]));
    expect(t1).toContain('no SSH gateway');

    const t2 = rendered(collapse([property({ collision: true })]));
    expect(t2).toContain('kept separate');

    const t3 = rendered(collapse([property({ nameSource: 'install', name: 'b68c7f0b6038 / wootestingsstg' })]));
    expect(t3).toContain('unnamed in the WP Engine portal');
  });

  test('the never-looked-inside callout leads with the count, and is absent at zero', () => {
    const dark = property({
      places: [place({ knowledge: 'nothing', checked: { state: 'never', finishedAt: null, reason: null } })],
      rungs: ['nothing'],
    });
    const t = rendered(collapse([dark]));
    expect(t).toContain('never looked inside');
    expect(t).toContain('Show them');

    expect(rendered(collapse([property()]))).not.toContain('never looked inside');
  });

  test('header counts render from the derived header block, and origins carry their counts', () => {
    const t = rendered(collapse([
      property(),
      property({ key: 'local:L1', origin: 'local', name: 'solo',
        places: [place({ rowId: 'L1', source: 'local', kind: 'local' })] }),
    ]));
    expect(t).toContain('2 properties');
    expect(t).toContain('WP Engine 1');
    expect(t).toContain('This Mac 1');
  });

  test('an XSS-shaped property name renders as text through createElement', () => {
    const t = rendered(collapse([property({ name: '<script>alert()</script>' })]));
    expect(t).toContain('<script>alert()</script>'); // a string child, never markup
  });

  test('a read failure is stated as a failure, never an empty fleet', () => {
    const inst: any = new (PropertiesTab as any)(props(collapse([]), { failed: true, collapse: null }));
    const t = JSON.stringify(serializeTree(inst.render()));
    expect(t).toContain('read failure');
    expect(t).toContain('Retry');
  });
});
