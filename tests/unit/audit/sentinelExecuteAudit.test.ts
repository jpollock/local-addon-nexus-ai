/**
 * S9 — `nexus:sentinel:execute` must be audited.
 *
 * This handler runs arbitrary WP-CLI over SSH against a PRODUCTION install and
 * raw `rm -f /nas/content/live/<install>/<path>` that deliberately bypasses
 * WordPress (SentinelExecutor.remoteSshRaw). Its blast radius exceeds every
 * path this branch already instruments, and it produced no durable audit entry
 * at all.
 *
 * The handler is exercised through a real `registerIpcHandlers` call against a
 * captured `ipcMain`, not by mocking the handler itself — a mocked handler
 * would not prove the audit call is wired into the code that ships. No SQLite:
 * every dependency here is an inert stub.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog, AuditEntry } from '../../../src/main/audit/OperationAuditLog';

// --- capture ipcMain handlers -------------------------------------------------

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels are irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* hot-reload cleanup, no-op in tests */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

// --- stub the executor: we assert on the AUDIT, not on SSH --------------------

const executeSentinelCommands = jest.fn();
jest.mock('../../../src/main/sentinel/SentinelExecutor', () => ({
  executeSentinelCommands: (...args: any[]) => executeSentinelCommands(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';

// --- helpers ------------------------------------------------------------------

function makeLog(): { dir: string; logPath: string; log: OperationAuditLog } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sentinel-audit-'));
  const logPath = path.join(dir, 'operation-audit.log');
  return { dir, logPath, log: new OperationAuditLog(logPath) };
}

function readEntries(logPath: string): AuditEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
}

function register(log: OperationAuditLog): void {
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
    nexusServices: { operationAuditLog: log },
  };
  registerIpcHandlers(deps);
}

// --- tests --------------------------------------------------------------------

describe('nexus:sentinel:execute is audited', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    executeSentinelCommands.mockReset();
    const made = makeLog();
    dir = made.dir;
    logPath = made.logPath;
    register(made.log);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registers the channel at all', () => {
    expect(mockIpc.handlers.has('nexus:sentinel:execute')).toBe(true);
  });

  it('writes a success entry naming the install and the commands run', async () => {
    executeSentinelCommands.mockResolvedValue({
      success: true,
      steps: [
        { command: 'rm -f wp-content/mu-plugins/evil.php', ok: true, durationMs: 12 },
        { command: 'wp plugin deactivate badplugin', ok: true, durationMs: 30 },
      ],
    });

    const res = await mockIpc.invoke('nexus:sentinel:execute', {
      installName: 'acme-prod',
      commands: ['rm -f wp-content/mu-plugins/evil.php', 'wp plugin deactivate badplugin'],
    });
    expect(res.success).toBe(true);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('ipc.sentinel.execute');
    expect(entries[0].target).toBe('wpe:acme-prod');
    expect(entries[0].outcome).toBe('success');
    // Which commands ran against production is the whole point of the record.
    expect(entries[0].parameters.commands).toEqual([
      'rm -f wp-content/mu-plugins/evil.php',
      'wp plugin deactivate badplugin',
    ]);
    expect(entries[0].parameters.stepCount).toBe(2);
  });

  it('writes a failure entry when a step fails', async () => {
    executeSentinelCommands.mockResolvedValue({
      success: false,
      steps: [
        { command: 'rm -f wp-content/mu-plugins/evil.php', ok: true, durationMs: 5 },
        { command: 'wp plugin deactivate badplugin', ok: false, durationMs: 9, error: 'Permission denied' },
      ],
    });

    const res = await mockIpc.invoke('nexus:sentinel:execute', {
      installName: 'acme-prod',
      commands: ['rm -f wp-content/mu-plugins/evil.php', 'wp plugin deactivate badplugin'],
    });
    expect(res.success).toBe(false);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('failure');
    expect(entries[0].parameters.failedCount).toBe(1);
    expect(entries[0].error).toContain('Permission denied');
  });

  it('writes a failure entry when the executor throws', async () => {
    executeSentinelCommands.mockRejectedValue(new Error('ssh: connect timeout'));

    const res = await mockIpc.invoke('nexus:sentinel:execute', {
      installName: 'acme-prod',
      commands: ['wp plugin deactivate badplugin'],
    });
    expect(res.success).toBe(false);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('ipc.sentinel.execute');
    expect(entries[0].outcome).toBe('failure');
    expect(entries[0].error).toContain('ssh: connect timeout');
  });

  it('redacts a credential embedded in a remediation command', async () => {
    executeSentinelCommands.mockResolvedValue({ success: true, steps: [{ command: 'x', ok: true, durationMs: 1 }] });

    await mockIpc.invoke('nexus:sentinel:execute', {
      installName: 'acme-prod',
      commands: ['wp config set DB_PASSWORD Pr0dDbP4ssw0rd'],
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('Pr0dDbP4ssw0rd');
    expect(raw).toContain('DB_PASSWORD');
  });
});
