import { STORAGE_KEYS, IPC_CHANNELS } from '../../../src/common/constants';
import type { IwConnectionStatus, IwSiteBinding } from '../../../src/common/types';

describe('IW constants', () => {
  it('has IW_SITE_BINDINGS storage key', () => {
    expect(STORAGE_KEYS.IW_SITE_BINDINGS).toBe('nexus-ai_iw_site_bindings');
  });

  it('has IW IPC channels', () => {
    expect(IPC_CHANNELS.IW_GET_STATUS).toBe('nexus-ai:iw:get-status');
    expect(IPC_CHANNELS.IW_CONNECT).toBe('nexus-ai:iw:connect');
    expect(IPC_CHANNELS.IW_DISCONNECT).toBe('nexus-ai:iw:disconnect');
  });
});

describe('IW types compile', () => {
  it('IwConnectionStatus shape is correct', () => {
    const status: IwConnectionStatus = {
      hubInstalled: true,
      connected: false,
      copyReset: false,
      clientId: null,
      projectId: null,
      accountId: null,
    };
    expect(status.hubInstalled).toBe(true);
  });

  it('IwSiteBinding shape is correct', () => {
    const binding: IwSiteBinding = {
      siteId: 'l_abc',
      clientId: 'client_123',
      projectId: 'proj_abc',
      accountId: 'acct_xyz',
      connectedAt: 1000,
    };
    expect(binding.siteId).toBe('l_abc');
  });
});
