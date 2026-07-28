import type { IwConnectionStatus } from '../../../src/common/types';
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('IW WP AI setup button contract', () => {
  it('IwConnectionStatus has wpEngineConnectorApproved field', () => {
    const s: IwConnectionStatus = {
      hubInstalled: true, connected: true, copyReset: false,
      clientId: 'c', projectId: 'p', accountId: 'a',
      wpEngineConnectorApproved: false,
    };
    expect(typeof s.wpEngineConnectorApproved).toBe('boolean');
  });

  it('SETUP_AI IPC channel exists', () => {
    expect(IPC_CHANNELS.SETUP_AI).toBe('nexus-ai:setup-ai');
  });
});
