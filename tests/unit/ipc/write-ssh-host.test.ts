const detectCollisionMock = jest.fn();
const writeHostBlockMock = jest.fn();
const generateHostKeyMock = jest.fn();
jest.mock('../../../src/main/external/sshConfigWriter', () => ({
  detectCollision: (...args: any[]) => detectCollisionMock(...args),
  writeHostBlock: (...args: any[]) => writeHostBlockMock(...args),
  generateHostKey: (...args: any[]) => generateHostKeyMock(...args),
}));

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op in tests */ }
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

function register() {
  const noop = () => {};
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
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

beforeEach(() => {
  detectCollisionMock.mockReset();
  writeHostBlockMock.mockReset();
  generateHostKeyMock.mockReset();
  register();
});

describe('WRITE_SSH_HOST_ENTRY', () => {
  it('refuses on an exact collision without calling writeHostBlock', async () => {
    detectCollisionMock.mockReturnValue({ kind: 'exact', file: '/home/u/.ssh/config', line: 3 });
    const result = await mockIpc.invoke(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
      alias: 'taken', hostname: 'h', user: 'u', port: '22', identityFile: '/k',
    });
    expect(result.success).toBe(false);
    expect(writeHostBlockMock).not.toHaveBeenCalled();
  });

  it('writes and reports success when there is no collision', async () => {
    detectCollisionMock.mockReturnValue({ kind: 'none' });
    const result = await mockIpc.invoke(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
      alias: 'new-host', hostname: 'h', user: 'u', port: '22', identityFile: '/k',
    });
    expect(result.success).toBe(true);
    expect(writeHostBlockMock).toHaveBeenCalledWith(
      { alias: 'new-host', hostname: 'h', user: 'u', port: '22', identityFile: '/k' },
    );
  });

  it('reports failure when writeHostBlock throws, without crashing the handler', async () => {
    detectCollisionMock.mockReturnValue({ kind: 'none' });
    writeHostBlockMock.mockImplementation(() => { throw new Error('disk full'); });
    const result = await mockIpc.invoke(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
      alias: 'x', hostname: 'h', user: 'u', port: '22', identityFile: '/k',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('disk full');
  });
});

describe('GENERATE_SSH_KEY', () => {
  it('returns the generated key on success', async () => {
    generateHostKeyMock.mockReturnValue({ privateKeyPath: '/home/u/.ssh/nexus_x', publicKeyLine: 'ssh-ed25519 AAAA... nexus-x' });
    const result = await mockIpc.invoke(IPC_CHANNELS.GENERATE_SSH_KEY, 'x');
    expect(result).toEqual({ success: true, error: null, privateKeyPath: '/home/u/.ssh/nexus_x', publicKeyLine: 'ssh-ed25519 AAAA... nexus-x' });
  });

  it('reports failure when ssh-keygen fails, without crashing', async () => {
    generateHostKeyMock.mockImplementation(() => { throw new Error('ssh-keygen not found'); });
    const result = await mockIpc.invoke(IPC_CHANNELS.GENERATE_SSH_KEY, 'x');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ssh-keygen not found');
  });
});

describe('WRITE_SSH_HOST_ENTRY and GENERATE_SSH_KEY are never exposed over GraphQL or CLI', () => {
  it('neither channel name appears under src/main/graphql or src/cli', () => {
    const { execSync } = require('child_process');
    const result = execSync(
      'grep -rl "WRITE_SSH_HOST_ENTRY\\|GENERATE_SSH_KEY\\|writeHostBlock\\|generateHostKey" src/main/graphql src/cli 2>/dev/null || true',
      { cwd: require('path').resolve(__dirname, '../../..') },
    ).toString().trim();
    expect(result).toBe('');
  });
});
