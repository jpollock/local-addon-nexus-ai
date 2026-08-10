// tests/unit/agent-runtime/runNowSiteScoped.test.ts
//
// Task 2: The handler is the boundary — Run Now performs one run for a non-scoped agent.
//
// AGENT_RUN_NOW is the **only** fan-out point in the system — the scheduler, event bus, GraphQL
// `agentRun` and MCP dispatch all call `runner.run()` once. This task is therefore the whole of
// the enforcement.
//
// The handler is the boundary, not the UI: the CLI and any future caller reach this channel
// too, so a renderer-only gate would not hold.

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels are irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }));

// ts-jest does not hoist jest.mock() above imports the way babel-jest does — this must come
// after the mock setup above, or `require('electron')` resolves before `mockIpc` exists.
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

/**
 * Harness: copy the MockIpcMain + registerWithServices harness from
 * tests/unit/agent-runtime/runNowSkip.test.ts — including its note about never invoking
 * AGENT_SETTINGS_UPDATE, which writes the user's real agent-settings.json.
 */
function registerWithServices(nexusServices: any = {}) {
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
    nexusServices,
  };
  registerIpcHandlers(deps);
  return deps;
}

/**
 * invokeRunNow: drive the real AGENT_RUN_NOW handler and capture the runner.run() calls.
 * Returns the collected runIds from the broadcast.
 */
async function invokeRunNow(opts: { agent: any; runner: any; siteNames: string[] }) {
  const { agent, runner, siteNames } = opts;
  const agentRegistry = { get: () => agent };
  const deps = registerWithServices({ agentRunner: runner, agentRegistry });

  // Agent must be enabled or the handler refuses immediately
  (deps as any).__agentSettingsCache.set(agent.name, { enabled: true, scheduleEnabled: true });

  // Capture the broadcast to collect runIds
  let capturedCompletion: any = null;
  const originalBroadcast = require('electron').BrowserWindow.getAllWindows;
  require('electron').BrowserWindow.getAllWindows = () => [{
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: any) => {
        if (channel === IPC_CHANNELS.AGENT_RUN_COMPLETE) {
          capturedCompletion = payload;
        }
      }
    }
  }];

  try {
    await mockIpc.invoke(IPC_CHANNELS.AGENT_RUN_NOW, { agentId: agent.name, siteNames, fullRun: false });

    // Wait a tick for the IIFE to complete
    await new Promise(resolve => setImmediate(resolve));

    return { runIds: capturedCompletion?.runIds || [] };
  } finally {
    require('electron').BrowserWindow.getAllWindows = originalBroadcast;
  }
}

describe('AGENT_RUN_NOW honours siteScoped', () => {
  it('runs a non-scoped agent exactly once, whatever the caller selected', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_one' }) };
    const agent = { name: 'auth-probe', siteScoped: false } as any;
    const runs = await invokeRunNow({ agent, runner, siteNames: ['a', 'b', 'c'] });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls[0][1]).toBeUndefined(); // no scoped event
    expect(runs.runIds).toEqual(['r_one']);
  });

  it('still loops per site for a scoped agent', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_x' }) };
    const agent = { name: 'security-sentinel' } as any; // siteScoped undefined → true
    await invokeRunNow({ agent, runner, siteNames: ['a', 'b', 'c'] });
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runner.run.mock.calls[0][1]).toMatchObject({ siteId: 'a' });
  });

  it('runs a non-scoped agent once even when the caller sends no sites', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_one' }) };
    const agent = { name: 'auth-probe', siteScoped: false } as any;
    await invokeRunNow({ agent, runner, siteNames: [] });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
