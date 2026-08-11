/**
 * Wiring between NexusOverview and the Sites table.
 *
 * The component itself is covered by sites-tab.test.ts. This file covers the
 * shell: that GET_SITE_ROWS's response reaches the right state fields.
 *
 * The reason it exists: `fetchAll` destructures a `Promise.all` POSITIONALLY.
 * Inserting a channel anywhere but the end shifts every later variable onto the
 * wrong response, and TypeScript cannot see it because every entry is a promise
 * of `any`. Each channel below returns a distinguishable shape, so a misaligned
 * destructuring lands the wrong one in `siteRows` and these fail.
 */
import { NexusOverview } from '../../../src/renderer/components/NexusOverview';
import { IPC_CHANNELS } from '../../../src/common/constants';

const ROWS = [
  { id: 'L1', name: 'Local One', source: 'local', host: null, domain: null,
    status: 'running', wpVersion: '6.5', phpVersion: '8.2',
    knowledge: 'basic', lastSyncAt: null },
  { id: 'ssh:hostinger/shop', name: 'shop', source: 'external', host: 'hostinger',
    domain: 'shop.example', status: null, wpVersion: null, phpVersion: null,
    knowledge: 'searchable', lastSyncAt: 1786397387376 },
];
const TOTAL = { count: 2, scope: 'installs on this Mac, WP Engine and other hosts' };

function makeShell(siteRowsResponse: any) {
  const invoke = jest.fn(async (channel: string) => {
    if (channel === IPC_CHANNELS.GET_SITE_ROWS) return siteRowsResponse;
    // Deliberately distinguishable from the site-rows shape: if the positional
    // destructuring slips, `siteRows` picks one of these up instead.
    if (channel === IPC_CHANNELS.GET_SITES) return [];
    if (channel === IPC_CHANNELS.GET_FLEET_STATUS) return [];
    if (channel === IPC_CHANNELS.GET_WPE_ACCOUNTS) return [];
    return null;
  });
  const shell: any = new NexusOverview({
    NavLink: () => null,
    electron: { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() } },
  } as any);
  shell.mounted = true;
  // Collect setState patches rather than mounting; React is not rendering here.
  shell.setState = (patch: any) => Object.assign(shell.state, typeof patch === 'function' ? patch(shell.state) : patch);
  return { shell, invoke };
}

describe('NexusOverview → SitesTab wiring', () => {
  test('GET_SITE_ROWS is requested at all', async () => {
    const { shell, invoke } = makeShell({ success: true, rows: ROWS, total: TOTAL });
    await shell.fetchAll();
    expect(invoke.mock.calls.map(c => c[0])).toContain(IPC_CHANNELS.GET_SITE_ROWS);
  });

  test('a successful read lands in siteRows, not another channel\'s response', async () => {
    const { shell } = makeShell({ success: true, rows: ROWS, total: TOTAL });
    await shell.fetchAll();
    expect(shell.state.siteRows).toHaveLength(2);
    expect(shell.state.siteRows[0].name).toBe('Local One');
    expect(shell.state.siteRowsTotal).toEqual(TOTAL);
    expect(shell.state.siteRowsFailed).toBe(false);
    expect(shell.state.siteRowsLoaded).toBe(true);
  });

  test('a failed read sets failed, and loaded is still true', async () => {
    // loaded:false here would leave the spinner up forever and the error unseen.
    const { shell } = makeShell({ success: false, rows: [], total: { count: 0, scope: '' } });
    await shell.fetchAll();
    expect(shell.state.siteRowsFailed).toBe(true);
    expect(shell.state.siteRowsLoaded).toBe(true);
    expect(shell.state.siteRows).toEqual([]);
  });

  test('a rejected invoke does not blank the rest of the dashboard', async () => {
    // Promise.all rejects wholesale, so the invoke must carry its own catch.
    const invoke = jest.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.GET_SITE_ROWS) throw new Error('ipc exploded');
      if (channel === IPC_CHANNELS.GET_SITES) return [];
      if (channel === IPC_CHANNELS.GET_FLEET_STATUS) return [];
      if (channel === IPC_CHANNELS.GET_WPE_ACCOUNTS) return [];
      return null;
    });
    const shell: any = new NexusOverview({
      NavLink: () => null,
      electron: { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() } },
    } as any);
    shell.mounted = true;
    shell.setState = (patch: any) => Object.assign(shell.state, typeof patch === 'function' ? patch(shell.state) : patch);

    await shell.fetchAll();

    expect(shell.state.siteRowsFailed).toBe(true);
    // The tell-tale of a wholesale rejection: loading never clears.
    expect(shell.state.loading).toBe(false);
  });
});

describe('bulk dispatch', () => {
  function bulkShell(invokeImpl?: any) {
    const invoke = jest.fn(invokeImpl ?? (async () => ({ success: true, opId: 'op1' })));
    const shell: any = new NexusOverview({
      NavLink: () => null,
      electron: { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() } },
    } as any);
    shell.setState = (patch: any) => Object.assign(shell.state, typeof patch === 'function' ? patch(shell.state) : patch);
    shell.state.siteRows = ROWS;
    shell.state.selectedSiteIds = ['L1'];
    return { shell, invoke };
  }

  test('dispatches through BULK_EXECUTE with exactly the given ids', async () => {
    // One audited bulk path. A second one would lose the audit trail.
    const { shell, invoke } = bulkShell();
    await shell.handleSiteBulk('reindex', ['L1']);
    const call = invoke.mock.calls.find(c => c[0] === IPC_CHANNELS.BULK_EXECUTE);
    expect(call).toBeDefined();
    expect(call![1].type).toBe('reindex');
    expect(call![1].siteIds).toEqual(['L1']);
  });

  test('carries the names of the selected sites, and only those', async () => {
    const { shell, invoke } = bulkShell();
    await shell.handleSiteBulk('sync-graph', ['ssh:hostinger/shop']);
    const call = invoke.mock.calls.find(c => c[0] === IPC_CHANNELS.BULK_EXECUTE);
    expect(call![1].siteNames).toEqual({ 'ssh:hostinger/shop': 'shop' });
  });

  test('an empty selection dispatches nothing, even here', async () => {
    // Last line of defence before 369 sites. `disabled` is a UI guard only.
    const { shell, invoke } = bulkShell();
    await shell.handleSiteBulk('reindex', []);
    expect(invoke.mock.calls.find(c => c[0] === IPC_CHANNELS.BULK_EXECUTE)).toBeUndefined();
  });

  test('keeps the selection when the job starts — it is the input, not the fuel', async () => {
    // This asserted the opposite until BULK-OPERATIONS.md criterion 4. BULK_EXECUTE
    // returns an opId the instant the manager ACCEPTS the job, not when it finishes, so
    // clearing on `success` unticked the rows the moment the work began — and with them
    // the user's only record of which sites they had just acted on.
    const { shell } = bulkShell();
    await shell.handleSiteBulk('reindex', ['L1']);
    expect(shell.state.selectedSiteIds).toEqual(['L1']);
  });

  test('the selection bar becomes a job bar in the same paint as the click', async () => {
    // No frame in which neither is present: the job is set before the await, so a
    // pending BULK_EXECUTE still has something on screen saying work started.
    const { shell } = bulkShell(() => new Promise(() => { /* never settles */ }));
    void shell.handleSiteBulk('reindex', ['L1']);
    expect(shell.state.bulkJob).toBeTruthy();
    expect(shell.state.bulkJob.phase).toBe('starting');
    expect(shell.state.bulkJob.siteIds).toEqual(['L1']);
  });

  test('dismissing the finished job is what releases the selection', async () => {
    const { shell } = bulkShell();
    await shell.handleSiteBulk('reindex', ['L1']);
    shell.dismissBulkJob();
    expect(shell.state.selectedSiteIds).toEqual([]);
    expect(shell.state.bulkJob).toBeNull();
  });

  test('a failed start surfaces on the bar instead of vanishing', async () => {
    const { shell } = bulkShell(async () => ({ success: false, error: 'nope' }));
    await shell.handleSiteBulk('reindex', ['L1']);
    expect(shell.state.bulkJob.phase).toBe('error');
    expect(shell.state.bulkJob.error).toBe('nope');
  });

  test('keeps the selection when the operation fails, so it can be retried', async () => {
    const { shell } = bulkShell(async () => ({ success: false, error: 'nope' }));
    await shell.handleSiteBulk('reindex', ['L1']);
    expect(shell.state.selectedSiteIds).toEqual(['L1']);
  });

  test('a rejected invoke does not throw out of the handler', async () => {
    const { shell } = bulkShell(async () => { throw new Error('ipc exploded'); });
    await expect(shell.handleSiteBulk('reindex', ['L1'])).resolves.toBeUndefined();
    expect(shell.state.selectedSiteIds).toEqual(['L1']);
  });
});

describe('site selection', () => {
  function shellWith(selected: string[]) {
    const { shell } = makeShell({ success: true, rows: ROWS, total: TOTAL });
    shell.state.selectedSiteIds = selected;
    return shell;
  }

  test('toggling adds then removes', () => {
    const shell = shellWith([]);
    shell.toggleSiteSelection('L1');
    expect(shell.state.selectedSiteIds).toEqual(['L1']);
    shell.toggleSiteSelection('L1');
    expect(shell.state.selectedSiteIds).toEqual([]);
  });

  test('select-all is scoped to the ids given, never the whole fleet', () => {
    // Ticking "all" while filtered to External must not arm 331 WPE installs.
    const shell = shellWith([]);
    shell.toggleAllSiteSelection(['ssh:hostinger/shop']);
    expect(shell.state.selectedSiteIds).toEqual(['ssh:hostinger/shop']);
  });

  test('select-all again clears only those ids, leaving others selected', () => {
    const shell = shellWith(['W1']);
    shell.toggleAllSiteSelection(['L1']);
    expect(shell.state.selectedSiteIds.sort()).toEqual(['L1', 'W1']);
    shell.toggleAllSiteSelection(['L1']);
    expect(shell.state.selectedSiteIds).toEqual(['W1']);
  });
});
