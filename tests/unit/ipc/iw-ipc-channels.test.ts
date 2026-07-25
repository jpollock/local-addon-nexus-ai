import { IPC_CHANNELS } from '../../../src/common/constants';

describe('IW IPC channel names', () => {
  it('GET_IW_STATUS', () => expect(IPC_CHANNELS.IW_GET_STATUS).toBe('nexus-ai:iw:get-status'));
  it('IW_CONNECT',   () => expect(IPC_CHANNELS.IW_CONNECT).toBe('nexus-ai:iw:connect'));
  it('IW_DISCONNECT',() => expect(IPC_CHANNELS.IW_DISCONNECT).toBe('nexus-ai:iw:disconnect'));
});
