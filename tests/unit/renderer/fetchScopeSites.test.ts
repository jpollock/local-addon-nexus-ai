import { fetchScopeSites } from '../../../src/renderer/components/agents/fetchScopeSites';
import { IPC_CHANNELS } from '../../../src/common/constants';

function mockElectron(handlers: Record<string, () => any>) {
  return {
    ipcRenderer: {
      invoke: jest.fn((channel: string) => Promise.resolve(handlers[channel]?.())),
    },
  };
}

describe('fetchScopeSites', () => {
  it('merges WPE and local sites into one normalized, sorted list', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({
        sites: [
          { id: 'wpe-1', name: 'zzz-prod', environment: 'production', created_at: 1000 },
          { id: 'wpe-2', name: 'aaa-staging', environment: 'staging', created_at: 2000 },
        ],
      }),
      [IPC_CHANNELS.GET_SITES]: () => ([
        { id: 'local-1', name: 'mmm-local' },
      ]),
    });

    const sites = await fetchScopeSites(electron);

    expect(sites.map(s => s.name)).toEqual(['aaa-staging', 'mmm-local', 'zzz-prod']);
    expect(sites.find(s => s.name === 'zzz-prod')).toMatchObject({
      environment: 'production', platform: 'WP Engine', createdAt: 1000,
    });
    expect(sites.find(s => s.name === 'mmm-local')).toMatchObject({
      environment: 'local', platform: 'Local',
    });
    expect(sites.find(s => s.name === 'mmm-local')?.createdAt).toBeUndefined();
  });

  it('excludes security-sentinel sandbox sites (sentinel-* prefix)', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [] }),
      [IPC_CHANNELS.GET_SITES]: () => ([
        { id: 'a', name: 'real-site' },
        { id: 'b', name: 'sentinel-nitropack-production-1786061424150' },
      ]),
    });

    const sites = await fetchScopeSites(electron);

    expect(sites.map(s => s.name)).toEqual(['real-site']);
  });

  it('defaults a WPE site with no environment field to production', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.WPE_GET_SYNCED_SITES]: () => ({ sites: [{ id: 'x', name: 'no-env-site' }] }),
      [IPC_CHANNELS.GET_SITES]: () => ([]),
    });

    const sites = await fetchScopeSites(electron);

    expect(sites[0].environment).toBe('production');
  });

  it('returns local sites alone when WPE is not connected (rejects/throws)', async () => {
    const electron = {
      ipcRenderer: {
        invoke: jest.fn((channel: string) => {
          if (channel === IPC_CHANNELS.WPE_GET_SYNCED_SITES) return Promise.reject(new Error('not connected'));
          if (channel === IPC_CHANNELS.GET_SITES) return Promise.resolve([{ id: 'a', name: 'local-only' }]);
          return Promise.resolve(null);
        }),
      },
    };

    const sites = await fetchScopeSites(electron);

    expect(sites.map(s => s.name)).toEqual(['local-only']);
  });

  it('returns an empty list when electron/ipcRenderer is unavailable', async () => {
    expect(await fetchScopeSites(undefined)).toEqual([]);
    expect(await fetchScopeSites({})).toEqual([]);
  });
});
