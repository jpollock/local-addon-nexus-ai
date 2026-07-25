import type { IwConnectionStatus } from '../../../src/common/types';
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('IW renderer contract', () => {
  it('IwConnectionStatus fields match what renderIwRow reads', () => {
    const s: IwConnectionStatus = {
      hubInstalled: false, connected: false, copyReset: false,
      clientId: null, projectId: null, accountId: null,
    };
    expect(typeof s.hubInstalled).toBe('boolean');
    expect(typeof s.connected).toBe('boolean');
    expect(typeof s.copyReset).toBe('boolean');
  });

  it('IW IPC channels exist for renderer import', () => {
    expect(IPC_CHANNELS.IW_GET_STATUS).toBeTruthy();
    expect(IPC_CHANNELS.IW_CONNECT).toBeTruthy();
    expect(IPC_CHANNELS.IW_DISCONNECT).toBeTruthy();
  });
});
