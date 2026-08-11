import {
  LogSourcesState, deriveLogSiteRows, deriveOrphans, runnableSiteIds, loadLogSources, EMPTY_LOG_SOURCES,
} from '../../../src/renderer/components/agents/logSourcesModel';
import { IPC_CHANNELS } from '../../../src/common/constants';

const install = (site: string, objectCount: number, lastSyncedAt: number | null = null) => ({
  site, objectCount, bytes: objectCount * 1000,
  oldestObjectAt: '2026-07-01', newestObjectAt: '2026-08-01',
  sampleKey: `20260801-0016-${site}.apachestyle.log.gz`, lastSyncedAt,
});

const fleetSite = (name: string, environment: any = 'production') => ({
  id: name, name, environment, platform: 'WP Engine' as const,
});

const state = (over: Partial<LogSourcesState> = {}): LogSourcesState => ({
  bucket: { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/', lastScannedAt: 1000 },
  installs: [],
  fleet: [],
  aws: { connected: true },
  ...over,
});

describe('deriveLogSiteRows', () => {
  it('gives every install on the account a row, with logs or without', () => {
    const s = state({
      fleet: [fleetSite('alpha'), fleetSite('beta', 'staging')],
      installs: [install('alpha', 312)],
    });
    const rows = deriveLogSiteRows(s, []);
    expect(rows.map(r => [r.name, r.hasLogs])).toEqual([['alpha', true], ['beta', false]]);
    expect(rows[1].objectCount).toBe(0);
    expect(rows[1].environment).toBe('staging');
  });

  it('marks a row on only when it is scoped AND has objects', () => {
    const s = state({ fleet: [fleetSite('alpha'), fleetSite('beta')], installs: [install('alpha', 5)] });
    // 'beta' is in scope but has nothing in the bucket. It must never read as running — the
    // alternative is a row that claims to run and silently processes nothing.
    const rows = deriveLogSiteRows(s, ['alpha', 'beta']);
    expect(rows.find(r => r.name === 'alpha')?.on).toBe(true);
    expect(rows.find(r => r.name === 'beta')?.on).toBe(false);
  });

  it('does not invent rows for installs that are only in the bucket', () => {
    const s = state({ fleet: [fleetSite('alpha')], installs: [install('alpha', 5), install('someone-else', 44)] });
    expect(deriveLogSiteRows(s, []).map(r => r.name)).toEqual(['alpha']);
  });

  it('treats a zero-object scan row as no logs', () => {
    const s = state({ fleet: [fleetSite('alpha')], installs: [install('alpha', 0)] });
    expect(deriveLogSiteRows(s, ['alpha'])[0]).toMatchObject({ hasLogs: false, on: false });
  });
});

describe('deriveOrphans', () => {
  it('lists bucket installs that are not on the account', () => {
    const s = state({ fleet: [fleetSite('alpha')], installs: [install('alpha', 5), install('clientold2', 44)] });
    expect(deriveOrphans(s).map(o => o.site)).toEqual(['clientold2']);
  });

  it('ignores an orphan with no objects — there is no count gap to explain', () => {
    const s = state({ fleet: [fleetSite('alpha')], installs: [install('ghost', 0)] });
    expect(deriveOrphans(s)).toEqual([]);
  });
});

describe('runnableSiteIds — the one derived set', () => {
  it('is empty when no bucket has been connected, whatever the saved scope says', () => {
    // A stale scope survives disconnecting the bucket. If the badge/header/Run-now read the scope
    // directly they would claim sites are running with nothing to read them from.
    const s = state({ bucket: null, fleet: [fleetSite('alpha')], installs: [] });
    expect(runnableSiteIds(deriveLogSiteRows(s, ['alpha']))).toEqual([]);
  });

  it('counts exactly the switched-on installs that have objects', () => {
    const s = state({
      fleet: [fleetSite('alpha'), fleetSite('beta'), fleetSite('gamma')],
      installs: [install('alpha', 5), install('beta', 5)],
    });
    expect(runnableSiteIds(deriveLogSiteRows(s, ['alpha', 'gamma']))).toEqual(['alpha']);
  });
});

describe('loadLogSources', () => {
  const makeElectron = (handlers: Record<string, (args?: any) => any>) => ({
    ipcRenderer: { invoke: jest.fn(async (channel: string, args?: any) => handlers[channel]?.(args)) },
  });

  it('returns the empty state without electron', async () => {
    expect(await loadLogSources(undefined)).toEqual(EMPTY_LOG_SOURCES);
  });

  it('merges bucket state, the WPE fleet and the AWS credential', async () => {
    const electron = makeElectron({
      [IPC_CHANNELS.AGENT_LOG_PROCESSOR_STATE]: () => ({
        bucket: { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/', lastScannedAt: 9000 },
        installs: [install('alpha', 312)],
      }),
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [{ id: 'x', name: 'alpha', environment: 'production' }] }),
      [IPC_CHANNELS.GET_SITES]: () => [{ id: 'l1', name: 'a-local-site' }],
      [IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS]: () => ({
        connections: [{ id: 'c1', provider: 'aws', label: 'arn:aws:iam::1:user/nexus', status: 'active', createdAt: '2026-07-22' }],
      }),
    });

    const result = await loadLogSources(electron);
    expect(result.bucket?.bucket).toBe('wpejpp');
    expect(result.installs).toHaveLength(1);
    expect(result.aws).toEqual({ connected: true, label: 'arn:aws:iam::1:user/nexus', createdAt: '2026-07-22' });
    // Local sites have no S3 access log — including them would offer a row that can never run.
    expect(result.fleet.map(f => f.name)).toEqual(['alpha']);
  });

  it('reports a revoked key as not connected', async () => {
    const electron = makeElectron({
      [IPC_CHANNELS.AGENT_LOG_PROCESSOR_STATE]: () => ({ bucket: null, installs: [] }),
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [] }),
      [IPC_CHANNELS.GET_SITES]: () => [],
      [IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS]: () => ({ connections: [{ id: 'c1', provider: 'aws', label: 'x', status: 'revoked' }] }),
    });
    expect((await loadLogSources(electron)).aws).toEqual({ connected: false });
  });
});

describe('normalizeLogPrefix', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const agentImpl = require('../../../agents/log-processor/access-logs').normalizeLogPrefix as (s: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rendererImpl = require('../../../src/renderer/components/agents/logSourcesModel').normalizeLogPrefix as (s: string) => string;

  const CASES: Array<[string | undefined, string]> = [
    ['wpe_logs/nginx/', 'wpe_logs/nginx/'],
    // The case that broke a real setup: scans clean, then lists `wpe_logs/nginx20260808`.
    ['wpe_logs/nginx', 'wpe_logs/nginx/'],
    ['/wpe_logs/nginx', 'wpe_logs/nginx/'],
    ['///wpe_logs/nginx/', 'wpe_logs/nginx/'],
    ['  wpe_logs/nginx  ', 'wpe_logs/nginx/'],
    ['', ''],
    ['/', ''],
    [undefined, ''],
  ];

  it.each(CASES)('normalizes %p to %p', (input, expected) => {
    expect(agentImpl(input as string)).toBe(expected);
  });

  it('the renderer copy agrees with the agent implementation on every case', () => {
    // The renderer cannot import the agent module (it is copied standalone into Local's agents
    // directory and would drag the S3 client into the UI bundle), so the copy is guarded here.
    for (const [input] of CASES) {
      expect(rendererImpl(input as string)).toBe(agentImpl(input as string));
    }
  });
});

describe('parseDisabledGoogleApi', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseDisabledGoogleApi } = require('../../../src/renderer/components/agents/openNexusPreferences');

  it('pulls the API and console URL out of Google’s sentence', () => {
    const msg = 'Google Analytics Data API has not been used in project 212814026888 before or it is '
      + 'disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=212814026888 then retry.';
    expect(parseDisabledGoogleApi(msg)).toEqual({
      api: 'analyticsdata.googleapis.com',
      label: 'Google Analytics Data API',
      url: 'https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=212814026888',
    });
  });

  it('does not leave sentence punctuation on the URL', () => {
    const msg = 'It is disabled. Enable it by visiting https://console.developers.google.com/apis/api/x.googleapis.com/overview?project=1.';
    expect(parseDisabledGoogleApi(msg)!.url.endsWith('project=1')).toBe(true);
  });

  it('returns null for any other failure, so callers keep their generic handling', () => {
    expect(parseDisabledGoogleApi('GA4 API error: quota exceeded')).toBeNull();
    expect(parseDisabledGoogleApi('Token exchange failed: 400')).toBeNull();
  });
});
