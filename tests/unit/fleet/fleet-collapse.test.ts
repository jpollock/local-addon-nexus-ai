/**
 * The fleet-collapse read model — Phase 1 of the implementation plan.
 *
 * The fixtures ARE the plan's acceptance list: multi-install property with a
 * copy; the single-install 74% case; the Autoscale ceiling; external
 * ungrouped; the collision pair; the unnamed-property fallback;
 * counts-that-sum; and the labelled-oldest roll-up in its fail and never
 * shapes. Every header figure must derive from the same property list —
 * a fixture where a hand-computed count disagrees is the test failing.
 */
import {
  buildFleetCollapse,
  FleetCollapseInput,
  CheckedView,
} from '../../../src/main/fleet/fleetCollapse';

const ok = (iso: string): CheckedView => ({ state: 'ok', finishedAt: iso, reason: null });
const fail = (iso: string, reason: string): CheckedView => ({ state: 'fail', finishedAt: iso, reason });

function wpeRow(
  id: string,
  name: string,
  over: Partial<FleetCollapseInput['graphRows'][number]> = {},
): FleetCollapseInput['graphRows'][number] {
  return {
    id, name, source: 'wpe', domain: `${name}.wpengine.com`,
    wp_version: '6.8', php_version: '8.2', host: null,
    content_indexed_at: 1700000000000, last_sync_at: 1700000000000,
    remote_install_id: `inst-${name}`, wpe_site_id: null,
    environment: 'production', account_id: 'acct-1',
    ...over,
  };
}

function base(over: Partial<FleetCollapseInput> = {}): FleetCollapseInput {
  return {
    localSites: [],
    graphRows: [],
    indexedSiteIds: new Set(),
    wpeSites: [],
    wpeAccounts: [{ id: 'acct-1', name: 'acct1', nickname: 'Fischer Digital' }],
    siteLinks: [],
    gatewaylessAccounts: new Map(),
    checked: new Map(),
    ...over,
  };
}

describe('grouping and naming', () => {
  test('a multi-install property groups under its portal name, with the copy nested', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'benfischer', { wpe_site_id: 'prop-1', environment: 'production' }),
        wpeRow('wpe-2', 'benfischer1stg', { wpe_site_id: 'prop-1', environment: 'staging' }),
        wpeRow('wpe-3', 'benfischerdev', { wpe_site_id: 'prop-1', environment: 'development' }),
      ],
      wpeSites: [{ id: 'prop-1', name: 'benfischer', account_id: 'acct-1' }],
      localSites: [{ id: 'LocA', name: 'benfischer-local', wpVersion: '6.8' }],
      siteLinks: [{ localSiteId: 'LocA', wpeInstallId: 'inst-benfischer1stg' }],
    });

    const { properties, header } = buildFleetCollapse(input);

    expect(properties).toHaveLength(1);
    const p = properties[0];
    expect(p.name).toBe('benfischer');
    expect(p.nameSource).toBe('portal');
    expect(p.accountName).toBe('Fischer Digital');
    expect(p.places.map((pl) => pl.kind).sort()).toEqual(['copy', 'development', 'production', 'staging']);
    expect(p.hasCopy).toBe(true);
    expect(header.onThisMachine).toBe(1);
    expect(header.byOrigin).toEqual({ local: 0, wpe: 1, external: 0 }); // the copy is not its own property
  });

  test('the 74% case: a single-install property stands alone with one place', () => {
    const input = base({
      graphRows: [wpeRow('wpe-9', 'dbrains', { wpe_site_id: 'prop-9' })],
      wpeSites: [{ id: 'prop-9', name: 'dbrains', account_id: 'acct-1' }],
    });
    const { properties } = buildFleetCollapse(input);
    expect(properties).toHaveLength(1);
    expect(properties[0].places).toHaveLength(1);
    expect(properties[0].places[0].kind).toBe('production');
  });

  test('an unnamed property shows its grouped install names — never a derived guess', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-a', 'b68c7f0b6038', { wpe_site_id: 'prop-x' }),
        wpeRow('wpe-b', 'wootestingsstg', { wpe_site_id: 'prop-x', environment: 'staging' }),
      ],
      wpeSites: [], // D21 row not collected yet
    });
    const p = buildFleetCollapse(input).properties[0];
    expect(p.name).toBe('b68c7f0b6038 / wootestingsstg');
    expect(p.nameSource).toBe('install');
  });

  test('a WPE row with no wpe_site_id is its own property, never folded into a sibling', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'grouped', { wpe_site_id: 'prop-1' }),
        wpeRow('wpe-2', 'ungrouped', { wpe_site_id: null }),
      ],
      wpeSites: [{ id: 'prop-1', name: 'Grouped', account_id: 'acct-1' }],
    });
    const { properties } = buildFleetCollapse(input);
    expect(properties).toHaveLength(2);
  });

  test('external sites are one property per row, named by the site, account shows the alias', () => {
    const input = base({
      graphRows: [{
        id: 'ssh:willow/derm', name: 'willowcreekderm', source: 'external',
        domain: 'willowcreekderm.com', wp_version: '6.8', php_version: '8.3',
        host: null, content_indexed_at: 1, last_sync_at: 1,
      }],
    });
    const p = buildFleetCollapse(input).properties[0];
    expect(p.origin).toBe('external');
    expect(p.nameSource).toBe('alias');
    expect(p.accountName).toBe('ssh:willow');
  });

  test('the collision pair: same name across origins, kept separate and flagged', () => {
    const input = base({
      graphRows: [wpeRow('wpe-t', 'thelocalshed', { wpe_site_id: 'prop-t' })],
      wpeSites: [{ id: 'prop-t', name: 'thelocalshed', account_id: 'acct-1' }],
      localSites: [{ id: 'LocT', name: 'thelocalshed', wpVersion: '6.8' }],
    });
    const { properties, header } = buildFleetCollapse(input);
    expect(properties).toHaveLength(2);
    expect(properties.every((p) => p.collision)).toBe(true);
    expect(header.total).toBe(2);
  });
});

describe('ceiling, roll-ups and the header', () => {
  test('every place of a gatewayless account carries the stated ceiling', () => {
    const input = base({
      graphRows: [wpeRow('wpe-au', 'jpmeautoscale', { wpe_site_id: 'prop-au', account_id: 'acct-auto' })],
      wpeSites: [{ id: 'prop-au', name: 'jpmeautoscale', account_id: 'acct-auto' }],
      wpeAccounts: [{ id: 'acct-auto', name: 'esm5z2bl7u8vqk', nickname: 'AutoscaleAlpha' }],
      gatewaylessAccounts: new Map([['acct-auto', 'AutoscaleAlpha has no SSH gateway']]),
    });
    const place = buildFleetCollapse(input).properties[0].places[0];
    expect(place.ceiling).toContain('no SSH gateway');
  });

  test('the roll-up is the labelled set-minimum: fail beats never beats oldest', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' }),
        wpeRow('wpe-2', 'astg', { wpe_site_id: 'p1', environment: 'staging' }),
      ],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
      checked: new Map([
        ['wpe-1', { l3: ok('2026-08-24T10:00:00.000Z') }],
        ['wpe-2', { l3: ok('2026-08-24T02:00:00.000Z') }], // the OLDEST — this one wins
      ]),
    });
    expect(buildFleetCollapse(input).properties[0].oldest.finishedAt).toBe('2026-08-24T02:00:00.000Z');

    const withFail = base({
      graphRows: input.graphRows,
      wpeSites: input.wpeSites,
      checked: new Map([
        ['wpe-1', { l3: ok('2026-08-24T10:00:00.000Z') }],
        ['wpe-2', { l3: fail('2026-08-24T09:00:00.000Z', 'ssh: connection refused') }],
      ]),
    });
    const rolled = buildFleetCollapse(withFail).properties[0].oldest;
    expect(rolled.state).toBe('fail');
    expect(rolled.reason).toBe('ssh: connection refused');

    const withNever = base({ graphRows: input.graphRows, wpeSites: input.wpeSites, checked: new Map([['wpe-1', { l3: ok('2026-08-24T10:00:00.000Z') }]]) });
    expect(buildFleetCollapse(withNever).properties[0].oldest.state).toBe('never');
  });

  test('rungs are an enumerated set in ladder order, never an average', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' }),                                        // indexed → searchable
        wpeRow('wpe-2', 'astg', { wpe_site_id: 'p1', environment: 'staging', content_indexed_at: null }), // metadata → detailed
      ],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
    });
    expect(buildFleetCollapse(input).properties[0].rungs).toEqual(['detailed', 'searchable']);
  });

  test('header counts derive from the same list: origins sum, nothing-rung counted, machine count includes copies', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'one', { wpe_site_id: 'p1' }),
        wpeRow('wpe-2', 'never1', { wpe_site_id: 'p2', wp_version: null, content_indexed_at: null }), // rung nothing
        { id: 'ssh:w/w', name: 'ext', source: 'external', domain: null, wp_version: '6.8', php_version: null, host: null, content_indexed_at: null, last_sync_at: 1 },
      ],
      wpeSites: [
        { id: 'p1', name: 'One', account_id: 'acct-1' },
        { id: 'p2', name: 'Never', account_id: 'acct-1' },
      ],
      localSites: [
        { id: 'LocA', name: 'solo', wpVersion: '6.8' },
        { id: 'LocB', name: 'copyof1', wpVersion: '6.8' },
      ],
      siteLinks: [{ localSiteId: 'LocB', wpeInstallId: 'inst-one' }],
    });

    const { header, properties } = buildFleetCollapse(input);
    expect(header.total).toBe(properties.length);
    expect(header.byOrigin.local + header.byOrigin.wpe + header.byOrigin.external).toBe(header.total);
    expect(header.byOrigin).toEqual({ local: 1, wpe: 2, external: 1 });
    expect(header.placesTotal).toBe(5); // 2 wpe installs + 1 copy + 1 local + 1 external
    expect(header.neverLookedInside).toBe(1);
    expect(header.onThisMachine).toBe(2); // solo + the property holding copyof1
  });
});

describe('drill-in facts and lineage (Phase 2)', () => {
  test('a place carries both layers; the merged checked is the LATER of the two', () => {
    const input = base({
      graphRows: [wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' })],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
      checked: new Map([['wpe-1', {
        l2: ok('2026-08-24T01:00:00.000Z'),
        l3: fail('2026-08-24T09:00:00.000Z', 'ssh: refused'),
      }]]),
      pluginCounts: new Map([['wpe-1', 24]]),
      docCounts: new Map([['wpe-1', 412]]),
    });
    const place = buildFleetCollapse(input).properties[0].places[0];
    expect(place.checkedL2.state).toBe('ok');
    expect(place.checkedL3.reason).toBe('ssh: refused');
    expect(place.checked.state).toBe('fail'); // the later layer
    expect(place.pluginCount).toBe(24);
    expect(place.docCount).toBe(412);
    expect(place.wpVersion).toBe('6.8');
  });

  test('unknown facts are NULL, never a default', () => {
    const input = base({
      graphRows: [wpeRow('wpe-1', 'a', { wpe_site_id: 'p1', php_version: null })],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
    });
    const place = buildFleetCollapse(input).properties[0].places[0];
    expect(place.pluginCount).toBeNull();
    expect(place.docCount).toBeNull();
    expect(place.phpVersion).toBeNull();
  });

  test('lineage: a pulled copy gets the recorded source and drift; the code leg is always a stated absence', () => {
    const input = base({
      graphRows: [wpeRow('wpe-1', 'benfischer', { wpe_site_id: 'prop-1' })],
      wpeSites: [{ id: 'prop-1', name: 'benfischer', account_id: 'acct-1' }],
      localSites: [{ id: 'LocA', name: 'ben-local', wpVersion: '6.8' }],
      siteLinks: [{ localSiteId: 'LocA', wpeInstallId: 'inst-benfischer', wpeInstallName: 'benfischer' }],
      contentStatus: new Map([['LocA', { state: 'pulled', sourceName: 'benfischer1stg', behindSeconds: 11 * 86_400 }]]),
    });
    const prop = buildFleetCollapse(input).properties[0];
    const copyPlace = prop.places.find((pl) => pl.kind === 'copy')!;
    // The legs live ON the copy (a second copy carries its own), the code leg
    // on the property.
    expect(copyPlace.lineage!.join(' ')).toContain('Linked to benfischer');
    expect(copyPlace.lineage!.join(' ')).toContain('pulled from benfischer1stg — its content is 11 day(s) behind');
    expect(prop.lineage.join(' ')).toContain('Code moves through git');
  });

  test('lineage: absence is stated with a reason — never an empty block', () => {
    const noCopy = base({
      graphRows: [wpeRow('wpe-1', 'solo', { wpe_site_id: 'p1' })],
      wpeSites: [{ id: 'p1', name: 'Solo', account_id: 'acct-1' }],
    });
    expect(buildFleetCollapse(noCopy).properties[0].lineage.join(' '))
      .toContain('No copy of this site exists on your machine');

    const unlinkedCopy = base({
      graphRows: [wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' })],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
      localSites: [{ id: 'LocB', name: 'copy-b', wpVersion: '6.8' }],
      siteLinks: [{ localSiteId: 'LocB', wpeInstallId: 'inst-a' }],
      // no contentStatus — no recorded pull
    });
    const unlinked = buildFleetCollapse(unlinkedCopy).properties[0];
    expect(unlinked.places.find((pl) => pl.kind === 'copy')!.lineage!.join(' '))
      .toContain("No recorded pull links this copy's content");

    const localOnly = base({ localSites: [{ id: 'LocC', name: 'mine', wpVersion: '6.8' }] });
    expect(buildFleetCollapse(localOnly).properties[0].lineage.join(' '))
      .toContain('exists only on your machine');
  });
});

describe('round-6 model rulings', () => {
  test('the banner statement explains its own two counts; the callout excludes capped places', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-a1', 'auto1', { wpe_site_id: 'pa', account_id: 'acct-auto', wp_version: null, content_indexed_at: null }),
        wpeRow('wpe-a2', 'auto2', { wpe_site_id: 'pb', account_id: 'acct-auto', wp_version: null, content_indexed_at: null }),
        wpeRow('wpe-n', 'normie', { wpe_site_id: 'pc', wp_version: null, content_indexed_at: null }), // nothing-rung, NOT capped
      ],
      wpeSites: [
        { id: 'pa', name: 'A', account_id: 'acct-auto' },
        { id: 'pb', name: 'B', account_id: 'acct-auto' },
        { id: 'pc', name: 'C', account_id: 'acct-1' },
      ],
      wpeAccounts: [{ id: 'acct-auto', name: 'esm', nickname: 'AutoscaleAlpha' }],
      gatewaylessAccounts: new Map([['acct-auto', 'no SSH gateway']]),
    });
    const { header } = buildFleetCollapse(input);
    expect(header.ceilings).toHaveLength(1);
    expect(header.ceilings[0].statement)
      .toBe('AutoscaleAlpha has no SSH gateway, so Nexus cannot index its 2 installs — 2 properties — over SSH.');
    // The capped nothing-rung places belong to the banner; the callout counts
    // only the syncable ones.
    expect(header.neverLookedInside).toBe(1);
  });
});

describe('phase 3 — needs-you through the model', () => {
  test('a backed zero is zero; no reading at all is null; the property sums its places', () => {
    const input = base({
      graphRows: [
        wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' }),
        wpeRow('wpe-2', 'astg', { wpe_site_id: 'p1', environment: 'staging' }),
      ],
      wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }],
      needsYou: new Map([['wpe-1', { count: 2, tier: 3 }]]),
      needsYouMeta: { situations: 2, unattributed: 1 },
    });
    const { properties, header } = buildFleetCollapse(input);
    const [prod, stg] = properties[0].places;
    expect(prod.needsYou).toEqual({ count: 2, tier: 3 });
    expect(stg.needsYou).toEqual({ count: 0, tier: 0 });      // backed zero
    expect(properties[0].needsYou).toEqual({ count: 2, tier: 3 });
    expect(header.needsYou).toEqual({ situations: 2, unattributed: 1 });

    const noReading = buildFleetCollapse(base({ graphRows: [wpeRow('wpe-1', 'a', { wpe_site_id: 'p1' })], wpeSites: [{ id: 'p1', name: 'A', account_id: 'acct-1' }] }));
    expect(noReading.properties[0].places[0].needsYou).toBeNull();
    expect(noReading.header.needsYou).toBeNull();
  });
});
