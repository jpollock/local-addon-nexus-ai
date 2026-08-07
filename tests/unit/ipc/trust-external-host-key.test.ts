const captureMock = jest.fn();
const trustMock = jest.fn();
jest.mock('../../../src/main/external/hostKeyTrust', () => ({
  captureOfferedHostKey: (...args: any[]) => captureMock(...args),
  trustHostKey: (...args: any[]) => trustMock(...args),
}));
const resolveMock = jest.fn();
jest.mock('../../../src/main/external/sshExec', () => ({
  resolveSshConfig: (...args: any[]) => resolveMock(...args),
  defaultSshExec: jest.fn(),
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
  captureMock.mockReset();
  trustMock.mockReset();
  resolveMock.mockReset();
  register();
});

describe('TRUST_EXTERNAL_HOST_KEY', () => {
  it('captures, trusts, and reports the trusted fingerprint on success', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result).toEqual({ success: true, error: null, fingerprint: 'SHA256:abc' });
    expect(trustMock).toHaveBeenCalledWith('/home/u/.ssh/known_hosts', 'h ssh-ed25519 AAAA');
  });

  it('reports failure and never calls trustHostKey when capture fails', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue(null);

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not/i);
    expect(trustMock).not.toHaveBeenCalled();
  });

  it('reports failure when trustHostKey itself throws (e.g. permission error)', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/root/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    trustMock.mockImplementation(() => { throw new Error('EACCES'); });

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toContain('EACCES');
  });
});

describe('TRUST_EXTERNAL_HOST_KEY is never exposed over GraphQL', () => {
  it('does not appear anywhere in schema.ts', () => {
    const fs = require('fs');
    const schema = fs.readFileSync(require.resolve('../../../src/main/graphql/schema.ts'), 'utf-8');
    expect(schema).not.toMatch(/TRUST_EXTERNAL_HOST_KEY|trustExternalHostKey|nexusHostTrustKey/i);
  });
});
