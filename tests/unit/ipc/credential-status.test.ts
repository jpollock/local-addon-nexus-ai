/**
 * CREDENTIAL_STATUS × multiple accounts (2026-08-26).
 *
 * The channel used to return only the machine-wide connection list, so an agent's
 * Connected Accounts card rendered OTHER agents' connections as its own (live repro:
 * seo-insights' July connection shown on web-analytics' card). The grant is the reach
 * boundary — the card needs the granted list, while accountExists still needs the full one.
 */
class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

const ALL = [
  { id: 'c-old', provider: 'google', accountLabel: 'other-agents@example.com', status: 'active' },
  { id: 'c-mine', provider: 'google', accountLabel: 'mine@example.com', status: 'active' },
];

function register() {
  const noop = () => {};
  const credentialManager = {
    listConnections: jest.fn(() => ALL),
    listGrantedConnections: jest.fn((_p: string, agentId: string) =>
      agentId === 'web-analytics' ? [ALL[1]] : []),
    getStatusForAgent: jest.fn(async () => 'connected'),
  };
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {},
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: { getDb: () => null },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: { credentialManager },
  };
  registerIpcHandlers(deps);
  return credentialManager;
}

describe('CREDENTIAL_STATUS grant scoping', () => {
  it('returns grantedConnections for the asking agent alongside the full list', async () => {
    register();
    const result = await mockIpc.invoke(IPC_CHANNELS.CREDENTIAL_STATUS, { provider: 'google', agentId: 'web-analytics' });
    expect(result.connections).toHaveLength(2);
    expect(result.grantedConnections.map((c: any) => c.id)).toEqual(['c-mine']);
  });

  it('an agent with no grants gets an empty granted list, not the machine list', async () => {
    register();
    const result = await mockIpc.invoke(IPC_CHANNELS.CREDENTIAL_STATUS, { provider: 'google', agentId: 'security-sentinel' });
    expect(result.grantedConnections).toEqual([]);
  });
});
