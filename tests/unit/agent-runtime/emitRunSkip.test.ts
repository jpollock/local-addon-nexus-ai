// tests/unit/agent-runtime/emitRunSkip.test.ts
//
// The actual behaviour Task 6 adds: writing a `run.skip` event when an automatic trigger is
// refused. `canAutoRunWith` (tested in can-auto-run.test.ts) only decides whether a run is
// allowed — it never touches the EventLog. The write itself happens in `canAutoRun`
// (ipc-handlers.ts), which reads `_agentSettingsDepsRef`, a module-private variable populated
// only inside `registerIpcHandlers()`. That function needs Electron and does a great deal of
// startup work, so the write side effect was extracted into `emitRunSkip` — a small function
// that takes its inputs as arguments instead of reading module state — specifically so it can
// be exercised directly here, with a fake log and no Electron/IPC machinery at all.
//
// The second describe block below additionally proves the real wiring: that `canAutoRun`,
// reading from the actual settings cache `registerIpcHandlers()` builds, really does call
// `emitRunSkip` with the right log instance — not just that `emitRunSkip` behaves correctly in
// isolation.

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

// ts-jest does not hoist jest.mock() above imports the way babel-jest does — this must come
// after the mock setup above, or `require('electron')` resolves before `mockIpc` exists.
import { registerIpcHandlers, canAutoRun, emitRunSkip, getAgentLogLevel } from '../../../src/main/ipc-handlers';
import type { AutoRunDecision } from '../../../src/main/agent-runtime/auto-run-gate';

/** A fake EventLog that only implements the one method emitRunSkip calls, and records every call. */
function fakeLog() {
  const calls: any[] = [];
  return { calls, log: { write: (e: any) => { calls.push(e); } } as any };
}

describe('emitRunSkip', () => {
  it('writes one run.skip event when refused for the master switch', () => {
    const { calls, log } = fakeLog();
    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };

    emitRunSkip('security-sentinel', 'schedule', decision, log);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'INFO',
      source: 'security-sentinel',
      sourceKind: 'agent',
      event: 'run.skip',
      fields: { trigger: 'schedule', reason: 'agent-disabled' },
    });
    expect(typeof calls[0].runId).toBe('string');
  });

  it('writes one run.skip event when refused for the per-trigger switch, on a schedule trigger', () => {
    const { calls, log } = fakeLog();

    emitRunSkip('an-agent', 'schedule', { allowed: false, reason: 'trigger-disabled' }, log);

    expect(calls).toHaveLength(1);
    expect(calls[0].fields).toEqual({ trigger: 'schedule', reason: 'trigger-disabled' });
  });

  it('writes one run.skip event when refused for the per-trigger switch, on an event trigger', () => {
    const { calls, log } = fakeLog();

    emitRunSkip('an-agent', 'event', { allowed: false, reason: 'trigger-disabled' }, log);

    expect(calls).toHaveLength(1);
    expect(calls[0].fields).toEqual({ trigger: 'event', reason: 'trigger-disabled' });
  });

  it('writes nothing when the run is allowed', () => {
    const { calls, log } = fakeLog();

    emitRunSkip('an-agent', 'schedule', { allowed: true }, log);

    expect(calls).toHaveLength(0);
  });

  it('does not throw, and does not affect the caller, when no log is attached', () => {
    // This is the DEFAULT path — undefined in every test above unless a fake is passed, and in
    // production until the `if (agentDb)` block in src/main/index.ts runs. A missing log must
    // never break the gate itself.
    expect(() =>
      emitRunSkip('an-agent', 'schedule', { allowed: false, reason: 'agent-disabled' }),
    ).not.toThrow();
    expect(() => emitRunSkip('an-agent', 'schedule', { allowed: true })).not.toThrow();
  });
});

describe('canAutoRun wires emitRunSkip through the real settings cache', () => {
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

  it('writes a run.skip event when the real cache holds a disabled agent', () => {
    const { calls, log } = fakeLog();
    const deps = registerWithServices({ eventLog: log });
    // Set directly on the cache registerIpcHandlers() builds — deliberately not going through
    // the AGENT_SETTINGS_UPDATE IPC handler, which persists to the user's real
    // agent-settings.json on disk; this test must not touch that file.
    (deps as any).__agentSettingsCache.set('emit-run-skip-test-disabled', {
      enabled: false, scheduleEnabled: true,
    });

    const allowed = canAutoRun('emit-run-skip-test-disabled', 'schedule');

    expect(allowed).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].fields).toEqual({ trigger: 'schedule', reason: 'agent-disabled' });
  });

  it('writes nothing when the real cache allows the run', () => {
    const { calls, log } = fakeLog();
    const deps = registerWithServices({ eventLog: log });
    (deps as any).__agentSettingsCache.set('emit-run-skip-test-allowed', {
      enabled: true, scheduleEnabled: true,
    });

    const allowed = canAutoRun('emit-run-skip-test-allowed', 'schedule');

    expect(allowed).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('does not throw when no EventLog is attached — the default path in every test and until startup finishes', () => {
    const deps = registerWithServices({}); // no eventLog — matches production before the `if (agentDb)` block runs
    (deps as any).__agentSettingsCache.set('emit-run-skip-test-no-log', {
      enabled: false, scheduleEnabled: true,
    });

    expect(() => canAutoRun('emit-run-skip-test-no-log', 'schedule')).not.toThrow();
    expect(canAutoRun('emit-run-skip-test-no-log', 'schedule')).toBe(false);
  });
});

describe('getAgentLogLevel returns undefined when no override is set', () => {
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

  it('returns undefined when no cache entry exists for the agent', () => {
    registerWithServices();
    // No cache entry set at all — agent has never been seen by the renderer
    const result = getAgentLogLevel('no-such-agent');
    expect(result).toBeUndefined();
  });

  it('returns undefined when the cache entry has no logLevel field', () => {
    const deps = registerWithServices();
    // Set directly on the cache, deliberately not going through AGENT_SETTINGS_UPDATE (which would
    // persist to the user's real agent-settings.json on disk; this test must not touch that file).
    (deps as any).__agentSettingsCache.set('agent-with-no-override', {
      enabled: true, scheduleEnabled: true,
      // no logLevel field — no override set
    });

    const result = getAgentLogLevel('agent-with-no-override');
    expect(result).toBeUndefined();
  });

  it('returns the override when logLevel is set', () => {
    const deps = registerWithServices();
    (deps as any).__agentSettingsCache.set('agent-with-override', {
      enabled: true, scheduleEnabled: true, logLevel: 'DEBUG',
    });

    const result = getAgentLogLevel('agent-with-override');
    expect(result).toBe('DEBUG');
  });

  it('returns undefined when logLevel is an invalid value', () => {
    const deps = registerWithServices();
    (deps as any).__agentSettingsCache.set('agent-with-invalid-override', {
      enabled: true, scheduleEnabled: true, logLevel: 'LOUD',
    });

    const result = getAgentLogLevel('agent-with-invalid-override');
    expect(result).toBeUndefined();
  });
});
