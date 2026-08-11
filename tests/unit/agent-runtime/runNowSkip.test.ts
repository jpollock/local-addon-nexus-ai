// tests/unit/agent-runtime/runNowSkip.test.ts
//
// Task 3: The last silent refusal — Run Now records why it refused a disabled agent.
//
// Three paths refuse a run. The scheduler and the event bus both write `run.skip` through
// `canAutoRun`. `AGENT_RUN_NOW` has its own guard — `getAgentSetting(agentId, 'enabled') === false`
// — that returns an error object and writes nothing, so a user pressing Run Now on a disabled
// agent produces no evidence at all. This test verifies that the guard now emits `run.skip` with
// `trigger: 'manual'` before returning the error.
//
// TYPE-LEVEL GUARANTEE: AutoRunKind is 'schedule' | 'event' only. SkipTrigger extends it with
// 'manual', but canAutoRun() and canAutoRunWith() accept only AutoRunKind. Attempting to call
// canAutoRun(agentId, 'manual') is a compile-time error. Verified via temporary test file that
// produced: "error TS2345: Argument of type '"manual"' is not assignable to parameter of type
// 'AutoRunKind'." This prevents the latent bug where a 'manual' trigger would fall into the
// else branch of canAutoRunWith's ternary and incorrectly check eventsEnabled.

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

/** A fake EventLog that only implements the one method emitRunSkip calls, and records every call. */
function fakeLog() {
  const calls: any[] = [];
  return { calls, log: { write: (e: any) => { calls.push(e); } } as any };
}

/**
 * Harness: copy the MockIpcMain + registerWithServices harness from
 * tests/unit/agent-runtime/emitRunSkip.test.ts — including its note about never invoking
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

describe('AGENT_RUN_NOW emits run.skip when refusing a disabled agent', () => {
  it('writes run.skip when Run Now refuses a disabled agent', async () => {
    const { calls, log } = fakeLog();
    const deps = registerWithServices({ eventLog: log });
    (deps as any).__agentSettingsCache.set('run-now-skip-test', { enabled: false, scheduleEnabled: true });

    await mockIpc.invoke(IPC_CHANNELS.AGENT_RUN_NOW, { agentId: 'run-now-skip-test', siteNames: [] });

    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('run.skip');
    expect(calls[0].fields).toEqual({ trigger: 'manual', reason: 'agent-disabled' });
  });

  it('writes nothing when the agent is enabled', async () => {
    const { calls, log } = fakeLog();
    const deps = registerWithServices({ eventLog: log });
    (deps as any).__agentSettingsCache.set('run-now-ok-test', { enabled: true, scheduleEnabled: true });
    await mockIpc.invoke(IPC_CHANNELS.AGENT_RUN_NOW, { agentId: 'run-now-ok-test', siteNames: [] })
      .catch(() => { /* the agent does not exist; the guard under test is the one before that */ });
    expect(calls.filter((c: any) => c.event === 'run.skip')).toHaveLength(0);
  });
});
