/**
 * Characterization snapshots for the Overview tab.
 *
 * These exist to make the extraction in Task 5 provably behaviour-preserving.
 * They are intentionally brittle: if the extraction changes the rendered tree
 * in any way, they fail. A change here needs justifying, not `-u`.
 */
import { NexusOverview } from '../../../src/renderer/components/NexusOverview';
import { serializeTree } from './helpers/serializeTree';

function makeInstance(stateOverrides: Record<string, unknown>): any {
  const electron = {
    ipcRenderer: {
      invoke: jest.fn(async () => ({ success: false })),
      on: jest.fn(),
      removeListener: jest.fn(),
    },
  };
  const inst: any = new NexusOverview({ NavLink: () => null, electron });
  Object.assign(inst.state, stateOverrides);
  return inst;
}

const POPULATED_STATS = {
  localSites: { total: 37, running: 4, halted: 33 },
  wpeConnected: { count: 19 },
  remoteSites: {
    total: 330, unlinked: 301, capiAvailable: true, wpeAuthenticated: true,
    scope: 'installs reported by the WP Engine API',
  },
  mcpServer: { running: true, toolCount: 201, port: 10801, version: '0.2.3' },
  embedding: { ready: true, model: 'all-MiniLM-L6-v2', quantized: true, dimensions: 384, maxSequenceLength: 256 },
};

// Only variants that produce a DIFFERENT tree are snapshotted.
//
// `renderOverviewTab` early-returns `null` when `stats` is null, so `loading`
// and `error` would both snapshot as literal `null` — a passing snapshot that
// protects nothing. They are covered by an explicit assertion below instead.
// `wpeSyncing` is not read anywhere in the Overview tree (it belongs to
// Operations), so that variant would be byte-identical to `populated`; it is
// asserted structurally in Task 6 rather than snapshotted here.
const VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['empty fleet', {
    loading: false,
    stats: {
      ...POPULATED_STATS,
      localSites: { total: 0, running: 0, halted: 0 },
      wpeConnected: { count: 0 },
      remoteSites: { total: 0, unlinked: 0, capiAvailable: false, wpeAuthenticated: false, scope: 'installs reported by the WP Engine API' },
    },
    fleetSummary: null,
  }],
  ['populated', { loading: false, stats: POPULATED_STATS }],
  ['wpe not connected', {
    loading: false,
    stats: {
      ...POPULATED_STATS,
      remoteSites: { total: 0, unlinked: 0, capiAvailable: false, wpeAuthenticated: false, scope: 'installs reported by the WP Engine API' },
    },
    wpeAuthError: true,
  }],
];

describe('Overview tab — characterization', () => {
  test.each(VARIANTS)('renders %s identically before and after extraction', (_name, state) => {
    const inst = makeInstance(state);
    expect(serializeTree(inst.renderOverviewTab())).toMatchSnapshot();
  });

  // Covers the two variants deliberately excluded from the snapshot set:
  // both produce a literal `null`, which a snapshot would record as a pass
  // while protecting nothing.
  test('renders nothing until stats have loaded', () => {
    expect(makeInstance({ loading: true, stats: null }).renderOverviewTab()).toBeNull();
    expect(makeInstance({ loading: false, stats: null, error: 'Failed to load stats' }).renderOverviewTab()).toBeNull();
  });
});
