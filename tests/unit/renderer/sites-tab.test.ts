/**
 * The Sites table: all three host types in one list.
 *
 * NOTE ON SERIALIZATION. These call `new SitesTab(props).render()` rather than
 * `serializeTree(React.createElement(SitesTab, props))`. serializeTree's own
 * docblock records why: a component element serializes to its type name and
 * props only, never its rendered output. Serializing the element would make
 * every assertion below either vacuous (`'Local One'` is present in the *props*
 * whatever the component draws) or impossible (`'Searchable'` is a label the
 * render applies; props carry the lowercase rung). The `column headers` test
 * exists specifically to fail if anyone reverts to the element form.
 */
import { SitesTab } from '../../../src/renderer/components/tabs/SitesTab';
import { serializeTree } from './helpers/serializeTree';

// A real `last_sync_at` read from graph.db. The column is milliseconds
// (ipc-handlers.ts:2276 says so and the live values confirm it: 1786397387376
// is 2026-08-10). The old fixture value of 1000 rendered "Dec 31, 1969" in any
// negative-offset zone, which is what surfaced the zone dependency.
const LAST_SYNC_MS = 1786397387376;

const row = (over: any = {}) => ({
  id: 'L1', name: 'My Site', source: 'local', host: null, domain: null,
  status: 'running', wpVersion: '6.5', phpVersion: '8.2',
  knowledge: 'searchable', lastSyncAt: LAST_SYNC_MS, ...over,
});

const props = (over: any = {}) => ({
  loaded: true, failed: false,
  rows: [row()],
  total: { count: 1, scope: 'installs on this Mac, WP Engine and other hosts' },
  selected: [], onToggle: jest.fn(), onToggleAll: jest.fn(),
  onBulk: jest.fn(), onIndexHost: jest.fn(), onRetry: jest.fn(),
  ...over,
});

const tree = (over: any = {}) =>
  JSON.stringify(serializeTree(new (SitesTab as any)(props(over)).render()));

describe('SitesTab', () => {
  test('renders all three host types in one table', () => {
    const t = tree({
      rows: [
        row({ id: 'L1', source: 'local',    name: 'Local One' }),
        row({ id: 'W1', source: 'wpe',      name: 'wpe-install' }),
        row({ id: 'X1', source: 'external', name: 'shop', host: 'hostinger' }),
      ],
      total: { count: 3, scope: 'installs on this Mac, WP Engine and other hosts' },
    });
    expect(t).toContain('Local One');
    expect(t).toContain('wpe-install');
    expect(t).toContain('shop');
    expect(t).toContain('hostinger');   // the host is named on the row
  });

  test('renders column headers, proving the tree is rendered output', () => {
    // Guard against reverting to serializeTree(createElement(...)), which
    // yields the props bag and would make the assertions above vacuous.
    // These strings exist only in render(); no prop carries them.
    const t = tree();
    expect(t).toContain('Knowledge');
    expect(t).toContain('Last sync');
  });

  test('each host type is named in the words the design uses', () => {
    const t = tree({
      rows: [
        row({ id: 'L1', source: 'local' }),
        row({ id: 'W1', source: 'wpe' }),
        row({ id: 'X1', source: 'external', host: 'hostinger' }),
      ],
    });
    expect(t).toContain('This Mac');
    expect(t).toContain('WP Engine');
    expect(t).toContain('External');
  });

  test('the total renders with its scope, never bare', () => {
    expect(tree()).toContain('installs on this Mac, WP Engine and other hosts');
  });

  test('an indexed external host shows Searchable, not a cap', () => {
    // Regression test for DECISIONS.md's stale "external caps at Detailed".
    expect(tree({
      rows: [row({ id: 'X1', source: 'external', host: 'hostinger', knowledge: 'searchable' })],
    })).toContain('Searchable');
  });

  test('every knowledge rung renders its label, not its raw value', () => {
    const t = tree({
      rows: [
        row({ id: 'A', knowledge: 'nothing' }),
        row({ id: 'B', knowledge: 'basic' }),
        row({ id: 'C', knowledge: 'detailed' }),
        row({ id: 'D', knowledge: 'searchable' }),
      ],
    });
    expect(t).toContain('Nothing yet');
    expect(t).toContain('Basic');
    expect(t).toContain('Detailed');
    expect(t).toContain('Searchable');
  });

  test('a failed read is not rendered as an empty fleet', () => {
    const t = tree({ failed: true, rows: [], total: { count: 0, scope: '' } }).toLowerCase();
    expect(t).toContain("couldn't read");
    expect(t).not.toContain('no sites yet');
  });

  test('a failed read wins over not-loaded — it never falls through to empty', () => {
    // Guard order is failed → !loaded → empty → table. A `failed` response that
    // also has loaded:false must still say so, not show a spinner forever.
    const t = tree({ failed: true, loaded: false, rows: [], total: { count: 0, scope: '' } })
      .toLowerCase();
    expect(t).toContain("couldn't read");
    expect(t).not.toContain('no sites yet');
  });

  test('a not-yet-loaded fleet is neither an error nor empty', () => {
    const t = tree({ loaded: false, rows: [], total: { count: 0, scope: '' } }).toLowerCase();
    expect(t).not.toContain("couldn't read");
    expect(t).not.toContain('no sites yet');
  });

  test('a genuinely empty fleet says so', () => {
    const t = tree({
      rows: [], total: { count: 0, scope: 'installs on this Mac, WP Engine and other hosts' },
    }).toLowerCase();
    expect(t).toContain('no sites yet');
  });

  test('renders no hardcoded hex colours', () => {
    expect(tree()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test('last sync renders as a date, and a never-synced row says nothing', () => {
    // last_sync_at is milliseconds. Reading it as seconds — which
    // SYSTEM_WPE_STATUS still does — would render the year 58578.
    expect(tree({ rows: [row({ lastSyncAt: LAST_SYNC_MS })] })).toContain('2026');
    expect(tree({ rows: [row({ lastSyncAt: null })] })).toContain('—');
  });

  test('a missing version reads as unknown, never as a fabricated default', () => {
    // CLAUDE.md: never default an unknown input to a plausible value. '8.0' is
    // the specific fabrication this codebase has been burned by.
    const t = tree({ rows: [row({ wpVersion: null, phpVersion: null })] });
    expect(t).not.toContain('8.0');
    expect(t).toContain('—');
  });

  test('snapshot', () => {
    // `lastSyncAt: null` deliberately. A locale-formatted date makes the
    // snapshot depend on the machine's zone — measured, `Aug 10, 2026` in UTC
    // becomes `Aug 11, 2026` under Pacific/Kiritimati, so it would pass here and
    // fail in CI. Setting process.env.TZ in this file does NOT fix it; jest has
    // already resolved the zone by the time module code runs. The date cell is
    // covered zone-independently by the `last sync renders as a date` test.
    expect(
      serializeTree(new (SitesTab as any)(props({ rows: [row({ lastSyncAt: null })] })).render()),
    ).toMatchSnapshot();
  });
});


describe('SitesTab selection', () => {
  const twoRows = { rows: [row({ id: 'A' }), row({ id: 'B' })] };

  test('an empty selection disables every bulk action', () => {
    // A button that quietly fans out to 367 installs because nothing was ticked
    // is the worst version of this feature.
    const t = tree({ ...twoRows, selected: [] });
    expect(t).toContain('"disabled":true');
    // Stronger than the above on its own: `toContain('"disabled":true')` passes
    // if ONE of several buttons is disabled. Nothing may be enabled.
    expect(t).not.toContain('"disabled":false');
  });

  test('a non-empty selection enables them', () => {
    const t = tree({ ...twoRows, selected: ['A'] });
    expect(t).toContain('"disabled":false');
    expect(t).not.toContain('"disabled":true');
  });

  test('a bulk action dispatches ONLY the selected ids', () => {
    const onBulk = jest.fn();
    const inst = new (SitesTab as any)(props({
      rows: [row({ id: 'A' }), row({ id: 'B' }), row({ id: 'C' })],
      selected: ['A', 'C'], onBulk,
    }));
    inst.handleBulk('reindex');
    expect(onBulk).toHaveBeenCalledWith('reindex', ['A', 'C']);
    // Not all three, and not the visible page.
    expect(onBulk.mock.calls[0][1]).toHaveLength(2);
  });

  test('a bulk action on an empty selection dispatches nothing at all', () => {
    // The disabled attribute is the UI guard; this is the behavioural one. A
    // keyboard or programmatic call must not slip past a visual-only check.
    const onBulk = jest.fn();
    const inst = new (SitesTab as any)(props({ ...twoRows, selected: [], onBulk }));
    inst.handleBulk('reindex');
    expect(onBulk).not.toHaveBeenCalled();
  });

  test('the selection count renders with what it is scoped to', () => {
    expect(tree({ ...twoRows, selected: ['A'] })).toContain('1 of 2');
  });

  test('the bulk bar does not appear when there is nothing to act on', () => {
    // Failed and empty states have no rows; a bar reading "0 of 0" there is noise.
    expect(tree({ rows: [], total: { count: 0, scope: 'x' } })).not.toContain('of 0');
  });
});
