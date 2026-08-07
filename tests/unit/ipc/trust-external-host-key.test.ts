const captureMock = jest.fn();
const trustMock = jest.fn();
const statusMock = jest.fn();
jest.mock('../../../src/main/external/hostKeyTrust', () => ({
  captureOfferedHostKey: (...args: any[]) => captureMock(...args),
  trustHostKey: (...args: any[]) => trustMock(...args),
  checkHostKeyStatus: (...args: any[]) => statusMock(...args),
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
  statusMock.mockReset();
  statusMock.mockResolvedValue('none');
  register();
});

describe('TRUST_EXTERNAL_HOST_KEY', () => {
  it('captures, trusts, and reports the trusted fingerprint on success', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    statusMock.mockResolvedValue('none');

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result).toEqual({ success: true, error: null, fingerprint: 'SHA256:abc' });
    expect(statusMock).toHaveBeenCalledWith('/home/u/.ssh/known_hosts', 'h ssh-ed25519 AAAA');
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
    statusMock.mockResolvedValue('none');
    trustMock.mockImplementation(() => { throw new Error('EACCES'); });

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toContain('EACCES');
  });

  it('proceeds normally (appends) when there is no existing host-key entry', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    statusMock.mockResolvedValue('none');

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result).toEqual({ success: true, error: null, fingerprint: 'SHA256:abc' });
    expect(trustMock).toHaveBeenCalledTimes(1);
  });

  it('reports success without re-appending when the existing entry already matches (already trusted)', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    statusMock.mockResolvedValue('trusted');

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result).toEqual({ success: true, error: null, fingerprint: 'SHA256:abc' });
    expect(trustMock).not.toHaveBeenCalled();
  });

  it('refuses and never calls trustHostKey when the existing entry is a different (changed/MITM) key', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    statusMock.mockResolvedValue('conflict');

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "This host's key has changed since it was last trusted — refusing to overwrite it. This can indicate a compromised connection; do not approve without verifying the new fingerprint out-of-band.",
    );
    expect(trustMock).not.toHaveBeenCalled();
  });

  it('refuses and never calls trustHostKey when the trust-state check itself could not be completed', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    statusMock.mockResolvedValue('error');

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Could not verify this host's existing trust state — refusing to proceed. Re-run 'nexus host test <alias>' and try again.",
    );
    expect(trustMock).not.toHaveBeenCalled();
  });
});

describe('trustHostKey has exactly one caller, and no network-reachable surface imports it', () => {
  const execSync = require('child_process').execSync;
  const path = require('path');
  const repoRoot = path.resolve(__dirname, '../../..');

  it('is imported only by hostKeyTrust.ts itself and ipc-handlers.ts', () => {
    const hits = execSync('grep -rl "trustHostKey" src/ --include=*.ts', { cwd: repoRoot })
      .toString().trim().split('\n').sort();
    expect(hits).toEqual(['src/main/external/hostKeyTrust.ts', 'src/main/ipc-handlers.ts']);
  });

  it('the channel name never appears under src/cli, src/main/mcp, or src/main/graphql', () => {
    const result = execSync(
      'grep -rl "trust-external-host-key\\|TRUST_EXTERNAL_HOST_KEY" src/cli src/main/mcp src/main/graphql --include=*.ts || true',
      { cwd: repoRoot },
    ).toString().trim();
    expect(result).toBe('');
  });
});
