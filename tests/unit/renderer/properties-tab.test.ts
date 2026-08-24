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
  domain: 'dbrains.wpengine.com', address: 'dbrains.wpengine.com', knowledge: 'searchable', ceiling: null,
  checked: { state: 'ok', finishedAt: iso(8), reason: null },
  checkedL2: { state: 'ok', finishedAt: iso(8), reason: null },
  checkedL3: { state: 'ok', finishedAt: iso(9), reason: null },
  status: null, wpVersion: '6.8', phpVersion: '8.2', pluginCount: 24, docCount: 412,
  ...over,
});

const property = (over: any = {}): PropertyView => ({
  key: 'wpe:p1', name: 'dbrains', nameSource: 'portal', accountId: 'a1',
  accountName: 'dbrains', origin: 'wpe', places: [place()], hasCopy: false,
  rungs: ['searchable'], oldest: { state: 'ok', finishedAt: iso(8), reason: null },
  collision: false,
  lineage: ['No copy of this site exists on your machine. Each place stands alone until a pull or deploy is observed.'],
  ...over,
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
      ceilings: [],
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
    // Round-6: the row carries NOTHING of the account's condition — the
    // banner owns it entirely.
    expect(t1).not.toContain('capped');
    expect(t1).not.toContain('cannot go deeper');
    expect(t1).not.toContain('no SSH gateway');

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

    expect(rendered(collapse([property()]))).not.toContain('places Nexus has never looked inside');
  });

  test('header counts render from the derived header block, and origins carry their counts', () => {
    const t = rendered(collapse([
      property(),
      property({ key: 'local:L1', origin: 'local', name: 'solo',
        places: [place({ rowId: 'L1', source: 'local', kind: 'local' })] }),
    ]));
    expect(t).toContain('2 properties');
    expect(t).toContain('WP Engine 1');
    expect(t).toContain('Your machine 1');
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

describe('drill-ins (Phase 2)', () => {
  test('the property screen renders place cards and the composed lineage', () => {
    const p = property({
      key: 'wpe:p2', name: 'benfischer',
      places: [place({ rowId: 'wpe-1' }), place({ rowId: 'wpe-2', kind: 'staging' })],
      lineage: ['A copy of this site lives on this machine (ben-local) — linked to benfischer.',
                "Your copy's content was pulled from benfischer1stg — its content is 11 day(s) behind."],
    });
    const t = rendered(collapse([p]), (inst) => { inst.state.view = { screen: 'property', key: 'wpe:p2' }; });
    expect(t).toContain('← All sites');
    expect(t).toContain('staging');
    expect(t).toContain('pulled from benfischer1stg');
    expect(t).toContain('11 day(s) behind');
  });

  test('the place screen states per-layer ages, honest absences, the ceiling, and barred procedures', () => {
    const p = property({
      key: 'wpe:au', name: 'jpmeautoscale',
      places: [place({
        rowId: 'wpe-au', knowledge: 'basic',
        ceiling: 'AutoscaleAlpha has no SSH gateway',
        pluginCount: null, docCount: null,
        checkedL3: { state: 'never', finishedAt: null, reason: null },
      })],
      rungs: ['basic'],
    });
    const t = rendered(collapse([p]), (inst) => { inst.state.view = { screen: 'place', key: 'wpe:au', rowId: 'wpe-au' }; });
    expect(t).toContain('cannot go deeper');
    expect(t).toContain('AutoscaleAlpha has no SSH gateway');
    expect(t).toContain('not yet checked');                     // L3 never ran
    expect(t).toContain('Index content here — barred');         // barred with the reason visible
    expect(t).toContain('Nothing on this screen edits anything');
  });

  test('a failing layer shows its transport reason on the place screen', () => {
    const p = property({
      places: [place({
        checkedL2: { state: 'fail', finishedAt: iso(5), reason: 'NOT NULL constraint failed: users.username' },
      })],
    });
    const t = rendered(collapse([p]), (inst) => { inst.state.view = { screen: 'place', key: 'wpe:p1', rowId: 'wpe-1' }; });
    expect(t).toContain('NOT NULL constraint failed: users.username');
  });

  test('a stale drill-in key falls back to the list, never a ghost', () => {
    const t = rendered(collapse([property()]), (inst) => { inst.state.view = { screen: 'property', key: 'wpe:gone' }; });
    expect(t).toContain('properties');   // the fleet header rendered instead
    expect(t).not.toContain('← All sites');
  });
});

describe('designer round-2 findings', () => {
  test('finding 3: a Nexus storage fault is never phrased as the site failing', () => {
    const ours = property({
      oldest: { state: 'fail', finishedAt: iso(6), reason: 'NOT NULL constraint failed: users.username' },
    });
    const t1 = rendered(collapse([ours]));
    expect(t1).toContain('a Nexus storage error, not the site');

    const theirs = property({
      oldest: { state: 'fail', finishedAt: iso(3), reason: 'ssh: connection refused' },
    });
    const t2 = rendered(collapse([theirs]));
    expect(t2).toContain('failed 3h ago');              // the short cell
    expect(t2).toContain('ssh: connection refused');    // the detail sub-row
    expect(t2).not.toContain('a Nexus storage error');
  });

  test('finding 5: every procedure names its runbook; the barred one carries no raw capability token', () => {
    const t = rendered(collapse([property()]), (inst) => {
      inst.state.view = { screen: 'place', key: 'wpe:p1', rowId: 'wpe-1' };
    });
    expect(t).toContain('rb.wpe-sync 1.0.0');
    expect(t).toContain('rb.wpe-pull 1.0.0');
    expect(t).toContain('rb.bulk-plugin-update 1.2.0');
    expect(t).not.toContain('wpcli');
  });

  test('finding 6: the copy anchors the property screen — first and accented', () => {
    const p = property({
      key: 'wpe:p2', hasCopy: true,
      places: [place({ rowId: 'wpe-1' }), place({ rowId: 'L1', kind: 'copy', source: 'local', name: 'ben-local' })],
    });
    const t = rendered(collapse([p]), (inst) => { inst.state.view = { screen: 'property', key: 'wpe:p2' }; });
    expect(t).toContain('your copy');
    expect(t.indexOf('your copy')).toBeLessThan(t.indexOf('production')); // copy card renders first
  });

  test('finding 7: the sort is consequence-ranked and the footer states it', () => {
    const failing = property({ key: 'wpe:f', name: 'zzz-failing',
      oldest: { state: 'fail', finishedAt: iso(2), reason: 'ssh: refused' } });
    const dark = property({ key: 'wpe:d', name: 'yyy-dark', rungs: ['nothing'],
      places: [place({ rowId: 'wpe-d', knowledge: 'nothing' })] });
    const fine = property({ key: 'wpe:a', name: 'aaa-fine' });
    const t = rendered(collapse([fine, dark, failing]));
    expect(t.indexOf('zzz-failing')).toBeLessThan(t.indexOf('yyy-dark'));   // fail before nothing
    expect(t.indexOf('yyy-dark')).toBeLessThan(t.indexOf('aaa-fine'));     // nothing before A–Z rest
    expect(t).toContain('Sort: failures · never looked inside · A–Z'); // the labelled sort control
  });

  test('finding 1: no rationale leaks into product copy', () => {
    const t = rendered(collapse([property()]));
    expect(t).not.toContain('most actionable');
    expect(t).not.toContain('register D20');
    expect(t).toContain('Search sites by name or domain');
    expect(t).not.toContain('filters never hide');
  });
});

describe('designer round-3 findings', () => {
  const capped = () => property({
    key: 'wpe:au', name: 'jpmeautoscale', accountId: 'acct-auto',
    places: [place({ ceiling: 'no SSH gateway on account "AutoscaleAlpha" — Nexus cannot index its installs over SSH', knowledge: 'basic' })],
    rungs: ['basic'],
  });
  const cappedHeader = {
    ceilings: [{ accountId: 'acct-auto', accountName: 'AutoscaleAlpha',
      statement: 'AutoscaleAlpha has no SSH gateway, so Nexus cannot index its 73 installs — 1 property — over SSH.',
      placeCount: 73, propertyKeys: ['wpe:au'] }],
  };

  test('finding 1: the ceiling is ONE verdict with a door — never one alarm per row', () => {
    const t = rendered(collapse([capped(), property()], cappedHeader));
    expect(t.split('has no SSH gateway, so Nexus cannot index').length - 1).toBe(1); // said once
    expect(t).toContain('— 1 property —');           // the banner explains its own two counts
    expect(t).not.toContain('⛔');
    expect(t).not.toContain('🚫');
  });

  test('finding 1: the banner door filters to the capped set, with a clear chip', () => {
    const t = rendered(collapse([capped(), property({ name: 'uncapped-prop' })], cappedHeader), (inst) => {
      inst.state.ceilingAccount = 'acct-auto';
    });
    expect(t).toContain('jpmeautoscale');
    expect(t).not.toContain('uncapped-prop'); // the uncapped property is out of view
    expect(t).toContain('capped installs ×');
  });

  test('finding 2: one sentence for the fourth rung — rung cell says it, age cell stays silent', () => {
    const dark = property({
      places: [place({ knowledge: 'nothing', checked: { state: 'never', finishedAt: null, reason: null }, checkedL3: { state: 'never', finishedAt: null, reason: null } })],
      rungs: ['nothing'],
      oldest: { state: 'never', finishedAt: null, reason: null },
    });
    const t = rendered(collapse([dark]));
    expect(t).toContain('Never looked inside');
    expect(t).not.toContain('Nothing yet');
    expect(t).not.toContain('never checked');
  });

  test('finding 4: the absence callout is not the danger register', () => {
    const dark = property({ rungs: ['nothing'],
      places: [place({ knowledge: 'nothing', checked: { state: 'never', finishedAt: null, reason: null } })],
      oldest: { state: 'never', finishedAt: null, reason: null } });
    const t = rendered(collapse([dark]));
    const callout = t.slice(t.indexOf('places Nexus has never looked inside') - 600, t.indexOf('places Nexus has never looked inside'));
    expect(callout).not.toContain('danger');
  });

  test('finding 5: an open row states the failure once — short on the group, full on the place', () => {
    const failing = property({
      key: 'wpe:q', name: 'QWERKY',
      places: [
        place({ rowId: 'wpe-q1', checked: { state: 'fail', finishedAt: iso(6), reason: 'NOT NULL constraint failed: users.username' } }),
        place({ rowId: 'wpe-q2', kind: 'staging' }),
      ],
      oldest: { state: 'fail', finishedAt: iso(6), reason: 'NOT NULL constraint failed: users.username' },
    });
    const t = rendered(collapse([failing]), (inst) => { inst.state.open = { 'wpe:q': true }; });
    expect(t.split('NOT NULL constraint failed: users.username').length - 1).toBe(1); // once, on the place sub-row
    expect(t).toContain('record failed 6h ago');                                       // the short cell form
  });

  test('finding 6: no register references reach the screen', () => {
    const t = rendered(collapse([capped()], cappedHeader), (inst) => {
      inst.state.view = { screen: 'place', key: 'wpe:au', rowId: 'wpe-1' };
    });
    expect(t).not.toContain('(D15)');
    expect(t).not.toContain('(D20)');
  });
});

describe('designer round-4 — the visual layer', () => {
  test('the list has column heads sharing the row grid, and Site/Checked switch the sort', () => {
    const t = rendered(collapse([property({ name: 'bbb' }), property({ key: 'wpe:p2', name: 'aaa' })]));
    for (const head of ['Site', 'Where it lives', 'What Nexus knows', 'Checked']) {
      expect(t).toContain(head);
    }
    const sorted = rendered(collapse([
      property({ name: 'bbb', oldest: { state: 'fail', finishedAt: iso(2), reason: 'x' } }),
      property({ key: 'wpe:p2', name: 'aaa' }),
    ]), (inst) => { inst.state.sortBy = 'name'; });
    expect(sorted.indexOf('aaa')).toBeLessThan(sorted.indexOf('bbb')); // name sort beats consequence
    expect(sorted).toContain('Sort: A–Z');
  });

  test('the address renders in mono, verbatim — hostname for an environment, path for a copy', () => {
    const t = rendered(collapse([property()]));
    expect(t).toContain('dbrains.wpengine.com');
    expect(t).toContain('monospace');

    const withCopy = property({
      key: 'wpe:p2', hasCopy: true,
      places: [place({ rowId: 'wpe-1' }),
               place({ rowId: 'L1', kind: 'copy', source: 'local', name: 'ben-local', address: '/Users/j/Local Sites/ben' })],
    });
    const t2 = rendered(collapse([withCopy]), (inst) => { inst.state.open = { 'wpe:p2': true }; });
    expect(t2).toContain('/Users/j/Local Sites/ben');
  });

  test('the state filter says Needs you, and the rungs render as chips', () => {
    const t = rendered(collapse([property()]));
    expect(t).toContain('Needs you');
    expect(t).not.toContain('Needs attention');
  });

  test('the copy card holds the lineage legs; environments list below it', () => {
    const withCopy = property({
      key: 'wpe:p2', hasCopy: true,
      places: [place({ rowId: 'wpe-1' }),
               place({ rowId: 'L1', kind: 'copy', source: 'local', name: 'ben-local', address: '/Users/j/ben' })],
      lineage: ["Your copy's content was pulled from benfischer1stg — its content is 11 day(s) behind."],
    });
    const t = rendered(collapse([withCopy]), (inst) => { inst.state.view = { screen: 'property', key: 'wpe:p2' }; });
    expect(t).toContain('your copy');
    expect(t).toContain('pulled from benfischer1stg');
    expect(t.indexOf('pulled from')).toBeLessThan(t.indexOf('Environments')); // legs inside the card, envs below
  });
});

describe('designer round-5', () => {
  test('a failing row: short form in the cell, the full sentence once on its own line', () => {
    const failing = property({
      oldest: { state: 'fail', finishedAt: iso(7), reason: 'NOT NULL constraint failed: users.username' },
      places: [place({ checked: { state: 'fail', finishedAt: iso(7), reason: 'NOT NULL constraint failed: users.username' } })],
    });
    const t = rendered(collapse([failing]));
    expect(t).toContain('record failed 7h ago');                                        // the short cell
    expect(t.split('NOT NULL constraint failed: users.username').length - 1).toBe(1);   // full sentence once
  });

  test('the consequence hoist is labelled: Needs you first, then Everything else', () => {
    const failing = property({ key: 'wpe:f', name: 'zzz',
      oldest: { state: 'fail', finishedAt: iso(2), reason: 'x' } });
    const fine = property({ key: 'wpe:a', name: 'aaa' });
    const t = rendered(collapse([fine, failing]));
    expect(t).toContain('Needs you first');
    expect(t).toContain('Everything else · A–Z');
    expect(t.indexOf('Needs you first')).toBeLessThan(t.indexOf('zzz'));

    // No dividers when the hoist is empty, or when another sort is active.
    expect(rendered(collapse([fine]))).not.toContain('Needs you first');
    expect(rendered(collapse([fine, failing]), (i) => { i.state.sortBy = 'name'; }))
      .not.toContain('Needs you first');
  });

  test('depth is plain text like Checked — no chip borders in the knows cell', () => {
    const t = rendered(collapse([property()]));
    expect(t).toContain('Searchable');
    expect(t).not.toContain('cannot go deeper');
  });
});

describe('designer round-6', () => {
  test('the screen has a name and the add door; the subtitle is one separator level', () => {
    const t = rendered(collapse([property()]));
    expect(t).toContain('Your sites');
    expect(t).toContain('1 properties · 1 places');
    const withDoor = JSON.stringify(serializeTree(
      new (PropertiesTab as any)(props(collapse([property()]), { onAddSite: jest.fn() })).render()));
    expect(withDoor).toContain('Add a site');
  });

  test('the partition note states the arithmetic that makes Where a partition', () => {
    const t = rendered(collapse([
      property(),
      property({ key: 'local:L1', origin: 'local', name: 'solo',
        places: [place({ rowId: 'L1', source: 'local', kind: 'local' })] }),
    ]));
    expect(t).toContain('1 + 1 + 0 = 2');
    expect(t).toContain('Where');
  });

  test('a group row shows the host SET, not a count of it', () => {
    const p = property({
      key: 'wpe:p2', hasCopy: true,
      places: [place({ rowId: 'wpe-1' }),
               place({ rowId: 'L1', kind: 'copy', source: 'local', name: 'ben', address: '~/ben' })],
    });
    const t = rendered(collapse([p]));
    expect(t).toContain('WP Engine · your machine');
    expect(t).toContain('2 places incl. your copy');
  });

  test('search matches by domain too — the placeholder states the real boundary', () => {
    const t = rendered(collapse([
      property({ name: 'findme-not' }),
      property({ key: 'wpe:p2', name: 'other', places: [place({ rowId: 'wpe-2', address: 'special-domain.com', domain: 'special-domain.com' })] }),
    ]), (inst) => { inst.state.query = 'special-domain'; });
    expect(t).toContain('other');
    expect(t).not.toContain('findme-not');
  });

  test('the failure detail never repeats the short form, and never crosses a track', () => {
    const failing = property({
      oldest: { state: 'fail', finishedAt: iso(7), reason: 'ssh: connection refused' },
    });
    const t = rendered(collapse([failing]));
    // short form once (the cell), detail once (the sub-row), no combined sentence
    expect(t.split('failed 7h ago').length - 1).toBe(1);
    expect(t.split('ssh: connection refused').length - 1).toBe(1);
    expect(t).not.toContain('failed 7h ago — ssh');
  });
});
