// tests/unit/agent-runtime/cadenceReactivity.test.ts
//
// A cadence the user picks has to take effect now, not at the next restart. The scheduler reads
// its cron once, at register() time, so AGENT_SETTINGS_UPDATE must re-register an agent whose
// cadence changed — otherwise the picker is still a control that does nothing for the rest of
// the session, which is the whole defect being fixed.
//
// NOTE: the AGENT_SETTINGS_UPDATE handler persists the settings cache to the user's REAL
// ~/Library/Application Support/Local/nexus-ai/agent-settings.json. Writes are intercepted below
// and every test asserts the interception was hit — if it ever stops applying, the assertion
// fails rather than the test quietly overwriting a real file.

// Every write this handler attempts, captured instead of performed. `jest.spyOn(fs,
// 'writeFileSync')` cannot be used: the property is non-configurable in current Node and spyOn
// throws "Cannot redefine property". A module mock proxying the real fs intercepts the one
// method while leaving readFileSync and everything else genuine.
const mockWriteCalls: Array<{ path: string }> = [];
jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return new Proxy(real, {
    get(target: any, prop: string | symbol) {
      if (prop === 'writeFileSync') {
        return (p: string) => { mockWriteCalls.push({ path: String(p) }); };
      }
      return target[prop];
    },
  });
});

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
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

// ts-jest does not hoist jest.mock() above imports — this must follow the mock setup.
import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

const AGENT = 'cadence-reactivity-test-agent';

function harness() {
  const registered: string[] = [];
  const agent: any = { name: AGENT, version: '1.0.0', triggers: [{ type: 'cron', expression: '0 7 * * 1' }], run: async () => {} };
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
    nexusServices: {
      agentRegistry: { get: (id: string) => (id === AGENT ? agent : null) },
      agentScheduler: { register: (a: any) => registered.push(a.name) },
    },
  };
  registerIpcHandlers(deps);
  return { deps, registered };
}

describe('a cadence change re-registers the agent immediately', () => {
  beforeEach(() => { mockWriteCalls.length = 0; });

  it('re-registers when the picked cadence changes', () => {
    const { registered } = harness();

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      [AGENT]: { enabled: true, scheduleEnabled: true, cadence: '0 */6 * * *', cadenceSetAt: 1_754_000_000_000 },
    });

    // Proves the interception applied — if it ever stops, this fails rather than the test
    // quietly rewriting the user's real agent-settings.json.
    expect(mockWriteCalls.some(c => c.path.endsWith('agent-settings.json'))).toBe(true);
    expect(registered).toEqual([AGENT]);
  });

  it('re-registers when a cadence is chosen for the first time', () => {
    // The value is unchanged; only cadenceSetAt appears. That alone changes which schedule runs,
    // because an unstamped cadence is ignored in favour of the manifest.
    const { deps, registered } = harness();
    (deps as any).__agentSettingsCache.set(AGENT, { enabled: true, scheduleEnabled: true, cadence: '0 */6 * * *' });

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      [AGENT]: { enabled: true, scheduleEnabled: true, cadence: '0 */6 * * *', cadenceSetAt: 1_754_000_000_000 },
    });

    expect(mockWriteCalls.some(c => c.path.endsWith('agent-settings.json'))).toBe(true);
    expect(registered).toEqual([AGENT]);
  });

  it('does NOT re-register when the schedule did not change', () => {
    // Toggling something unrelated must not tear down and rebuild a cron task: register() stops
    // and destroys the existing task first, so a needless call is a real interruption, not a no-op.
    const { deps, registered } = harness();
    (deps as any).__agentSettingsCache.set(AGENT, { enabled: true, scheduleEnabled: true, cadence: '0 */6 * * *', cadenceSetAt: 5 });

    mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      [AGENT]: { enabled: false, scheduleEnabled: true, cadence: '0 */6 * * *', cadenceSetAt: 5 },
    });

    expect(mockWriteCalls.some(c => c.path.endsWith('agent-settings.json'))).toBe(true);
    expect(registered).toEqual([]);
  });

  it('survives an agent the registry does not know', () => {
    // A settings row can outlive its agent (uninstalled, renamed, failed to load). Re-registration
    // must not throw out of the settings write the user just made.
    const { registered } = harness();

    expect(() => mockIpc.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, {
      'no-such-agent': { enabled: true, cadence: '0 * * * *', cadenceSetAt: 1 },
    })).not.toThrow();
    expect(registered).toEqual([]);
  });
});
