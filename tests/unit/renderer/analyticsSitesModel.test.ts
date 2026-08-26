import {
  AnalyticsState, deriveAnalyticsRows, boundSiteNames, matchScore, loadAnalyticsState, EMPTY_ANALYTICS,
} from '../../../src/renderer/components/agents/analyticsSitesModel';
import { IPC_CHANNELS } from '../../../src/common/constants';

const site = (name: string, environment: any = 'local', platform: any = 'Local') => ({
  id: name, name, environment, platform,
});

const state = (over: Partial<AnalyticsState> = {}): AnalyticsState => ({
  bindings: {},
  fleet: [],
  google: { connected: true, accountExists: true, label: 'jeremy@wpengine.com' },
  ...over,
});

describe('deriveAnalyticsRows', () => {
  it('gives every site a row, bound or not', () => {
    const s = state({
      fleet: [site('alpha'), site('beta')],
      bindings: { alpha: { property: 'properties/1', displayName: 'Alpha' } },
    });
    const rows = deriveAnalyticsRows(s);
    expect(rows.map(r => [r.name, r.bound])).toEqual([['alpha', true], ['beta', false]]);
    expect(rows[0].binding?.displayName).toBe('Alpha');
  });

  it('sorts bound sites first so a handful are not lost in a large fleet', () => {
    const s = state({
      fleet: [site('aaa'), site('zzz')],
      bindings: { zzz: { property: 'properties/9' } },
    });
    expect(deriveAnalyticsRows(s).map(r => r.name)).toEqual(['zzz', 'aaa']);
  });

  it('ignores a binding for a site that is no longer in the fleet', () => {
    // A removed site's row would have no environment and nothing to act on.
    const s = state({ fleet: [site('alpha')], bindings: { gone: { property: 'properties/7' } } });
    expect(deriveAnalyticsRows(s).map(r => r.name)).toEqual(['alpha']);
  });
});

describe('boundSiteNames — the one derived set', () => {
  it('is exactly the bound sites', () => {
    const s = state({
      fleet: [site('a'), site('b'), site('c')],
      bindings: { a: { property: 'properties/1' }, c: { property: 'properties/3' } },
    });
    expect(boundSiteNames(deriveAnalyticsRows(s))).toEqual(['a', 'c']);
  });

  it('is empty with no bindings, whatever the fleet size', () => {
    const s = state({ fleet: [site('a'), site('b')] });
    expect(boundSiteNames(deriveAnalyticsRows(s))).toEqual([]);
  });
});

describe('matchScore', () => {
  it('scores an exact name match highest', () => {
    expect(matchScore('myloop', 'My Loop')).toBe(3);
  });

  it('scores containment above a shared prefix', () => {
    expect(matchScore('myloop', 'My Loop (old, pre-2024)')).toBe(2);
    expect(matchScore('alpineoutfitters', 'Alpine Outdoors')).toBe(1);
  });

  it('scores unrelated names zero', () => {
    expect(matchScore('myloop', 'WPE Marketing')).toBe(0);
  });

  it('never claims a match on a one or two letter overlap', () => {
    // A weak prefix is not evidence — surfacing it as a match would invite a wrong binding, and
    // nothing downstream would catch one client's traffic landing in another's report.
    expect(matchScore('alpha', 'alien corp')).toBe(0);
  });
});

describe('loadAnalyticsState', () => {
  const makeElectron = (handlers: Record<string, () => any>) => ({
    ipcRenderer: { invoke: jest.fn(async (channel: string) => handlers[channel]?.()) },
  });

  it('returns the empty state without electron', async () => {
    expect(await loadAnalyticsState(undefined)).toEqual(EMPTY_ANALYTICS);
  });

  it('merges bindings, the fleet and the Google account', async () => {
    const electron = makeElectron({
      [IPC_CHANNELS.AGENT_WEB_ANALYTICS_STATE]: () => ({ bindings: { alpha: { property: 'properties/1' } } }),
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [{ id: 'w', name: 'wpesite', environment: 'production' }] }),
      [IPC_CHANNELS.GET_SITES]: () => [{ id: 'l', name: 'alpha' }],
      [IPC_CHANNELS.CREDENTIAL_STATUS]: () => ({
        connections: [{ id: 'c', provider: 'google', accountLabel: 'jeremy@wpengine.com', status: 'active' }],
        grantedConnections: [{ id: 'c', provider: 'google', accountLabel: 'jeremy@wpengine.com', status: 'active' }],
        agentStatus: 'connected',
      }),
    });
    const result = await loadAnalyticsState(electron);
    expect(result.google).toEqual({
      connected: true, accountExists: true, label: 'jeremy@wpengine.com',
      labels: ['jeremy@wpengine.com'], status: 'connected',
    });
    expect(result.bindings.alpha.property).toBe('properties/1');
    // Unlike log-processor, both platforms are eligible — a GA4 property can belong to either.
    expect(result.fleet.map(f => f.name).sort()).toEqual(['alpha', 'wpesite']);
  });

  it('distinguishes revoked from never-connected', async () => {
    const electron = makeElectron({
      [IPC_CHANNELS.AGENT_WEB_ANALYTICS_STATE]: () => ({ bindings: {} }),
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [] }),
      [IPC_CHANNELS.GET_SITES]: () => [],
      [IPC_CHANNELS.CREDENTIAL_STATUS]: () => ({
        connections: [{ id: 'c', provider: 'google', status: 'revoked' }],
        agentStatus: 'revoked',
      }),
    });
    expect((await loadAnalyticsState(electron)).google).toEqual({
      connected: false, accountExists: false, label: undefined, labels: [], status: 'revoked',
    });
  });
});

describe('the per-agent gate', () => {
  const makeElectron = (agentStatus: string | null, connections: any[]) => ({
    ipcRenderer: {
      invoke: jest.fn(async (channel: string) => {
        if (channel === IPC_CHANNELS.AGENT_WEB_ANALYTICS_STATE) return { bindings: {} };
        if (channel === IPC_CHANNELS.CREDENTIAL_STATUS) return { connections, agentStatus };
        if (channel === IPC_CHANNELS.WPE_GET_SYNCED_SITES) return { sites: [] };
        return [];
      }),
    },
  });

  const ACTIVE = [{ id: 'c', provider: 'google', accountLabel: 'jeremy@wpengine.com', status: 'active' }];

  it('reports NOT connected when the account exists but this agent has no grant', async () => {
    // The bug this fixes: an OAuth connection is one Google account, but access is granted per
    // agent. Gating on `connections` alone showed the bind table for an agent whose every tool
    // call would be refused — the UI and the runtime disagreeing about the same question.
    const result = await loadAnalyticsState(makeElectron('not_connected', ACTIVE));
    expect(result.google.connected).toBe(false);
    expect(result.google.accountExists).toBe(true);
    expect(result.google.label).toBe('jeremy@wpengine.com');
  });

  it('reports connected only when the agent itself has access', async () => {
    const result = await loadAnalyticsState(makeElectron('connected', ACTIVE));
    expect(result.google).toMatchObject({ connected: true, accountExists: true });
  });

  it('distinguishes "no account at all" from "no grant for this agent"', async () => {
    const none = await loadAnalyticsState(makeElectron('not_connected', []));
    expect(none.google).toMatchObject({ connected: false, accountExists: false });
  });
});

describe('multiple granted accounts on the Sites tab', () => {
  const makeElectron = (handlers: Record<string, () => any>) => ({
    ipcRenderer: { invoke: jest.fn(async (channel: string) => handlers[channel]?.()) },
  });

  it('carries every granted account label — the account card must not show one of two', async () => {
    const electron = makeElectron({
      [IPC_CHANNELS.AGENT_WEB_ANALYTICS_STATE]: () => ({ bindings: {} }),
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [] }),
      [IPC_CHANNELS.GET_SITES]: () => [],
      [IPC_CHANNELS.CREDENTIAL_STATUS]: () => ({
        connections: [
          { id: 'c1', provider: 'google', accountLabel: 'jeremy@wpengine.com', status: 'active' },
          { id: 'c2', provider: 'google', accountLabel: 'jpollock911@gmail.com', status: 'active' },
          // Granted to a DIFFERENT agent — exists on the machine, not this agent's to show.
          { id: 'c3', provider: 'google', accountLabel: 'other-agents@example.com', status: 'active' },
        ],
        grantedConnections: [
          { id: 'c1', provider: 'google', accountLabel: 'jeremy@wpengine.com', status: 'active' },
          { id: 'c2', provider: 'google', accountLabel: 'jpollock911@gmail.com', status: 'active' },
        ],
        agentStatus: 'connected',
      }),
    });
    const result = await loadAnalyticsState(electron);
    expect(result.google.labels).toEqual(['jeremy@wpengine.com', 'jpollock911@gmail.com']);
  });
});
