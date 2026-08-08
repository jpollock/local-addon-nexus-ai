const listSshConfigHostsMock = jest.fn();
jest.mock('../../../src/main/external/sshConfigParser', () => ({
  listSshConfigHosts: (...args: any[]) => listSshConfigHostsMock(...args),
}));

const previewHostBlockMock = jest.fn();
const detectCollisionMock = jest.fn();
jest.mock('../../../src/main/external/sshConfigWriter', () => ({
  previewHostBlock: (...args: any[]) => previewHostBlockMock(...args),
  detectCollision: (...args: any[]) => detectCollisionMock(...args),
  // writeHostBlock/generateHostKey are also exported from this module and
  // imported by the existing WRITE_SSH_HOST_ENTRY/GENERATE_SSH_KEY handlers
  // registered by the same registerIpcHandlers() call -- stub them too so
  // registration doesn't throw on an unmocked import.
  writeHostBlock: jest.fn(),
  generateHostKey: jest.fn(),
}));

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() {}
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() {}
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

function register(graphDb: any = null) {
  const noop = () => {};
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {}, indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {}, contentPipeline: {}, vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null, getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: { getDb: () => graphDb }, eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db', nexusServices: {},
  };
  registerIpcHandlers(deps);
}

beforeEach(() => {
  listSshConfigHostsMock.mockReset(); previewHostBlockMock.mockReset(); detectCollisionMock.mockReset();
  register();
});

describe('LIST_SSH_CONFIG_HOSTS', () => {
  it('returns the enumerated hosts on success', async () => {
    listSshConfigHostsMock.mockReturnValue([
      { alias: 'prod', hostname: '1.1.1.1', user: 'u', port: '22', alreadyRegistered: false },
    ]);
    const result = await mockIpc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS);
    expect(result).toEqual({
      success: true,
      hosts: [{ alias: 'prod', hostname: '1.1.1.1', user: 'u', port: '22', alreadyRegistered: false }],
    });
  });

  it('passes the real graph db through so alreadyRegistered reflects the graph', async () => {
    const fakeDb = { prepare: () => ({ all: () => [] }) };
    register(fakeDb);
    listSshConfigHostsMock.mockReturnValue([]);
    await mockIpc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS);
    expect(listSshConfigHostsMock).toHaveBeenCalledWith(fakeDb);
  });

  it('reports failure when listSshConfigHosts throws, without crashing the handler', async () => {
    listSshConfigHostsMock.mockImplementation(() => { throw new Error('permission denied reading ~/.ssh/config'); });
    const result = await mockIpc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS);
    expect(result).toEqual({ success: false, error: 'permission denied reading ~/.ssh/config' });
  });
});

describe('PREVIEW_SSH_HOST_ENTRY', () => {
  const input = { alias: 'new-host', hostname: '2.2.2.2', user: 'u', port: '22', identityFile: '/k' };

  it('returns the rendered block and collision result on success', async () => {
    previewHostBlockMock.mockReturnValue('Host new-host\n  HostName 2.2.2.2\n');
    detectCollisionMock.mockReturnValue({ kind: 'none' });
    const result = await mockIpc.invoke(IPC_CHANNELS.PREVIEW_SSH_HOST_ENTRY, input);
    expect(result).toEqual({
      success: true,
      block: 'Host new-host\n  HostName 2.2.2.2\n',
      collision: { kind: 'none' },
    });
    expect(previewHostBlockMock).toHaveBeenCalledWith(input);
    expect(detectCollisionMock).toHaveBeenCalledWith(input.alias);
  });

  it('still returns the collision result when it is a pattern warning, not just none/exact', async () => {
    previewHostBlockMock.mockReturnValue('Host new-host\n  HostName 2.2.2.2\n');
    detectCollisionMock.mockReturnValue({ kind: 'pattern', pattern: '*', file: '/home/u/.ssh/config' });
    const result = await mockIpc.invoke(IPC_CHANNELS.PREVIEW_SSH_HOST_ENTRY, input);
    expect(result.collision).toEqual({ kind: 'pattern', pattern: '*', file: '/home/u/.ssh/config' });
  });

  it('reports failure when previewHostBlock throws (e.g. an unsafe alias), without crashing', async () => {
    previewHostBlockMock.mockImplementation(() => { throw new Error('Invalid SSH host alias'); });
    const result = await mockIpc.invoke(IPC_CHANNELS.PREVIEW_SSH_HOST_ENTRY, input);
    expect(result).toEqual({ success: false, error: 'Invalid SSH host alias' });
  });
});

describe('LIST_SSH_CONFIG_HOSTS and PREVIEW_SSH_HOST_ENTRY are never exposed over GraphQL or CLI', () => {
  it('neither channel name appears under src/main/graphql or src/cli', () => {
    const { execSync } = require('child_process');
    const result = execSync(
      'grep -rl "LIST_SSH_CONFIG_HOSTS\\|PREVIEW_SSH_HOST_ENTRY" src/main/graphql src/cli 2>/dev/null || true',
      { cwd: require('path').resolve(__dirname, '../../..') },
    ).toString().trim();
    expect(result).toBe('');
  });
});
