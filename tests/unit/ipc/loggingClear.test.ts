/**
 * Tests for the LOGGING_CLEAR IPC handler.
 *
 * Issue #7: the highest-risk untested line in the batch. Replacing `applyRetention(logRoot, policy)`
 * inside the LOGGING_CLEAR handler with `fs.rmSync(logRoot, { recursive: true })` — the exact
 * second-deletion-policy that was forbidden — passes every test in the repo. This test exercises
 * the handler itself, not just the renderer's call to it.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron before any imports that use it
const mockApp = {
  getPath: jest.fn((name: string) => {
    if (name === 'userData') return mockUserDataPath;
    return os.tmpdir();
  }),
};
let mockUserDataPath: string;

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  shell: { openPath: jest.fn() },
  app: mockApp,
}));

// Must import after the mock
const ipcHandlersModule = require('../../../src/main/ipc-handlers');

describe('LOGGING_CLEAR handler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logging-clear-test-'));
    mockUserDataPath = tmpDir;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup is best-effort */ }
  });

  it('uses applyRetention, not fs.rmSync, to clear logs', async () => {
    // Setup: create a log directory with a preserved file and a non-preserved file
    const logRoot = path.join(tmpDir, 'nexus-ai', 'logs');
    fs.mkdirSync(logRoot, { recursive: true });

    const preservedLog = path.join(logRoot, 'nexus-2026-08-01.log');
    fs.writeFileSync(preservedLog, 'run.end status=error\nSome error details');

    const regularLog = path.join(logRoot, 'nexus-2026-08-02.log');
    fs.writeFileSync(regularLog, 'Normal log content');

    // Mock the IPC handler registration to capture the LOGGING_CLEAR handler
    const electron = require('electron');
    let clearHandler: Function | undefined;
    electron.ipcMain.handle.mockImplementation((channel: string, handler: Function) => {
      if (channel === 'nexus-ai:logging-clear') {
        clearHandler = handler;
      }
    });

    // Re-register handlers to capture the real handler
    const noop = () => {};
    const deps: any = {
      siteData: { getSite: () => null, getSites: () => ({}) },
      localServicesBridge: {},
      indexRegistry: { listAll: () => [], get: () => null, update: noop },
      embeddingService: {},
      contentPipeline: {},
      vectorStore: {},
      registryStorage: { get: () => null, set: () => {} },
      localLogger: { info: noop, warn: noop, error: noop, debug: noop },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService: { getDb: () => null },
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: {},
    };
    ipcHandlersModule.registerIpcHandlers(deps);

    // Invoke the handler
    expect(clearHandler).toBeDefined();
    const result = await clearHandler!({});

    expect(result.success).toBe(true);

    // The preserved file should STILL EXIST (applyRetention honors preservation)
    expect(fs.existsSync(preservedLog)).toBe(true);

    // The regular file should be DELETED (zero-day policy)
    expect(fs.existsSync(regularLog)).toBe(false);

    // If rmSync was used instead, BOTH would be gone
  });
});
