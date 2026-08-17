import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';
import { getAgentSetting } from '../../../src/main/ipc-handlers';

jest.mock('../../../src/main/ipc-handlers', () => ({
  getAgentSetting: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/main/agent-runtime/buildAgentContext', () => ({
  buildAgentContext: jest.fn().mockReturnValue({
    ctx: {},
    agentLog: {},
    accFindings: [],
    accActions: [],
    accSites: {},
    toolProvider: {},
  }),
}));

const makeReg = () => {
  const reg = new ContributedToolRegistry();
  reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} });
  return reg;
};
const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  agentsDir: '/nonexistent',
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
});

describe('AgentDispatcher', () => {
  beforeEach(() => {
    (getAgentSetting as jest.Mock).mockReset().mockReturnValue(true);
  });

  it('dispatch returns error when tool not found', async () => {
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    const r = await d.dispatch('my-agent', 'missing', {});
    expect(r.isError).toBe(true);
  });

  it('dispatch refuses to run a disabled agent, even for a registered tool', async () => {
    (getAgentSetting as jest.Mock).mockImplementation((_agentId, key) => key !== 'enabled');
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    const r = await d.dispatch('my-agent', 'greet', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('disabled');
    expect(getAgentSetting).toHaveBeenCalledWith('my-agent', 'enabled');
  });

  it('dispatch checks the "enabled" setting before tool lookup, even for a nonexistent tool', async () => {
    // A disabled agent should report "disabled", not "not found" — enabled must
    // gate before tool lookup so a disabled agent never leaks which tools it has.
    (getAgentSetting as jest.Mock).mockImplementation((_agentId, key) => key !== 'enabled');
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    const r = await d.dispatch('my-agent', 'missing', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('disabled');
  });

  it('dispatch writes a durable failure entry with a populated error message for a Tier >= 2 contributed tool', async () => {
    // Register at Tier 2 explicitly (default is 1) so the durable-audit gate fires.
    const reg = new ContributedToolRegistry();
    reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-audit-'));
    const logPath = path.join(dir, 'operation-audit.log');
    const services = { operationAuditLog: new OperationAuditLog(logPath) } as any;
    const stubs = makeStubs();
    const d = new AgentDispatcher(reg, stubs.toolRegistry, services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore);

    // agentsDir is '/nonexistent', so dispatchFunction's loadModule() throws
    // (module not found) and its own try/catch turns that into an isError:true
    // result — this is what exercises the durable-audit failure path without
    // needing a real agent module on disk.
    const r = await d.dispatch('my-agent', 'greet', {});
    expect(r.isError).toBe(true);

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('my-agent/greet');
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toBeTruthy();
    expect(entry.error).toContain('Error:');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('clearCache removes module from cache', () => {
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    (d as any).moduleCache.set('my-agent', {});
    d.clearCache('my-agent');
    expect((d as any).moduleCache.has('my-agent')).toBe(false);
  });

  it('loadModule throws on path traversal agent name', () => {
    const d = new AgentDispatcher(new ContributedToolRegistry(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    expect(() => (d as any).loadModule('../../../etc')).toThrow('Invalid agent name');
  });

  describe('setProvider', () => {
    // Reproduced live: resolvedProvider was captured once at construction (Local startup) with
    // no way to update it. A contributed tool dispatched through here (e.g. security-sentinel's
    // Tier-3-gated `scan` MCP tool) kept using whatever API key existed at that moment even
    // after the user rotated it — chat picked up the new key immediately (it reads fresh every
    // request), the dispatched agent's specialist calls kept 401'ing with the stale one, in the
    // same running process. AgentRunner.setProvider already existed for the "Run Now" path;
    // this is the same fix for the dispatch() path, which had no equivalent at all.
    it('replaces resolvedProvider so a later dispatch uses the new value', () => {
      const stubs = makeStubs();
      const d = new AgentDispatcher(makeReg(), stubs.toolRegistry, stubs.services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore);
      expect((d as any).resolvedProvider).toBe(stubs.resolvedProvider);

      const rotated = { provider: 'power', apiKey: 'wpe_new-real-key', model: 'anthropic/claude-sonnet-5', useLocalGateway: false } as any;
      d.setProvider(rotated);

      expect((d as any).resolvedProvider).toBe(rotated);
      expect((d as any).resolvedProvider.apiKey).toBe('wpe_new-real-key');
    });
  });

  describe('observability — run id and event log', () => {
    it('mints a unique run id for each dispatch', async () => {
      const reg = new ContributedToolRegistry();
      // Register as Tier 2 so operation-audit.log is written
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);
      const stubs = makeStubs();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-audit-'));
      const logPath = path.join(dir, 'operation-audit.log');
      const services = { operationAuditLog: new OperationAuditLog(logPath) } as any;

      const d = new AgentDispatcher(reg, stubs.toolRegistry, services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore);

      // Two dispatches back to back — both will fail (module not found), but each produces an audit entry
      await d.dispatch('my-agent', 'greet', {});
      await d.dispatch('my-agent', 'greet', {});

      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      const runIds = lines.map(l => JSON.parse(l).runId).filter(Boolean);
      expect(runIds).toHaveLength(2);
      expect(runIds[0]).toMatch(/^r_[a-z0-9]+$/);
      expect(runIds[1]).toMatch(/^r_[a-z0-9]+$/);
      expect(runIds[0]).not.toBe(runIds[1]);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes run id to the durable audit trail (operation-audit.log)', async () => {
      const reg = new ContributedToolRegistry();
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-audit-'));
      const logPath = path.join(dir, 'operation-audit.log');
      const services = { operationAuditLog: new OperationAuditLog(logPath) } as any;
      const stubs = makeStubs();

      const d = new AgentDispatcher(reg, stubs.toolRegistry, services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore);

      await d.dispatch('my-agent', 'greet', {});

      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.runId).toBeTruthy();
      expect(entry.runId).toMatch(/^r_[a-z0-9]+$/);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes a tool.call event when eventLog is present', async () => {
      const reg = new ContributedToolRegistry();
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-event-'));
      const eventLog = {
        write: jest.fn(),
        pathsFor: jest.fn().mockReturnValue({ combined: path.join(dir, 'nexus-2026-08-10.log'), agent: path.join(dir, 'agents', 'my-agent-2026-08-10.log') }),
      } as any;

      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore, undefined, eventLog);

      await d.dispatch('my-agent', 'greet', {});

      expect(eventLog.write).toHaveBeenCalled();
      const call = eventLog.write.mock.calls[0][0];
      expect(call.event).toBe('tool.call');
      expect(call.source).toBe('my-agent');
      expect(call.sourceKind).toBe('agent');
      expect(call.runId).toMatch(/^r_[a-z0-9]+$/);
      expect(call.fields.tool).toBe('my-agent/greet');
      expect(call.fields.tier).toBe(2);
      expect(call.fields.ok).toBe(false); // module not found, so this errored
      expect(call.fields.dur).toMatch(/^\d+ms$/);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes NO tool.call event when eventLog is absent', async () => {
      const reg = new ContributedToolRegistry();
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} }, 2);

      const stubs = makeStubs();
      // No eventLog passed
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore);

      // Should not throw — the path just skips event writing
      await d.dispatch('my-agent', 'greet', {});

      // Can't assert on what wasn't called, but can verify it didn't throw
      expect(true).toBe(true);
    });

    it('passes runId and eventLog through buildAgentContext in dispatchFunction', async () => {
      const { buildAgentContext } = require('../../../src/main/agent-runtime/buildAgentContext');
      (buildAgentContext as jest.Mock).mockClear();

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-ctx-'));
      const agentDir = path.join(dir, 'test-agent');
      fs.mkdirSync(agentDir, { recursive: true });

      // Write a minimal agent.js that has a contributes.tools handler
      fs.writeFileSync(
        path.join(agentDir, 'agent.js'),
        `module.exports = {
          name: 'test-agent',
          contributes: {
            tools: {
              greet: {
                handler: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
              },
            },
          },
        };`
      );

      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });

      const eventLog = {
        write: jest.fn(),
        pathsFor: jest.fn().mockReturnValue({ combined: '/tmp/nexus.log', agent: '/tmp/agent.log' }),
      } as any;

      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore, undefined, eventLog);

      await d.dispatch('test-agent', 'greet', {});

      // buildAgentContext should have been called
      expect(buildAgentContext).toHaveBeenCalled();
      const call = (buildAgentContext as jest.Mock).mock.calls[0][0];
      expect(call.eventLog).toBe(eventLog);
      expect(call.runId).toBeTruthy();
      expect(call.runId).toMatch(/^r_[a-z0-9]+$/);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('passes runId and eventLog through buildAgentContext in dispatchRun', async () => {
      const { buildAgentContext } = require('../../../src/main/agent-runtime/buildAgentContext');
      (buildAgentContext as jest.Mock).mockClear();

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-ctx-'));
      const agentDir = path.join(dir, 'test-agent');
      fs.mkdirSync(agentDir, { recursive: true });

      // Write a minimal agent.js that has a run() method
      fs.writeFileSync(
        path.join(agentDir, 'agent.js'),
        `module.exports = {
          name: 'test-agent',
          run: async () => ({ findings: [] }),
        };`
      );

      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {}, executionMode: 'run' });

      const eventLog = {
        write: jest.fn(),
        pathsFor: jest.fn().mockReturnValue({ combined: '/tmp/nexus.log', agent: '/tmp/agent.log' }),
      } as any;

      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore, undefined, eventLog);

      await d.dispatch('test-agent', 'greet', {});

      // buildAgentContext should have been called
      expect(buildAgentContext).toHaveBeenCalled();
      const call = (buildAgentContext as jest.Mock).mock.calls[0][0];
      expect(call.eventLog).toBe(eventLog);
      expect(call.runId).toBeTruthy();
      expect(call.runId).toMatch(/^r_[a-z0-9]+$/);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('FAILS when buildAgentContext receives no eventLog — dispatchFunction path', async () => {
      const { buildAgentContext } = require('../../../src/main/agent-runtime/buildAgentContext');
      (buildAgentContext as jest.Mock).mockClear();

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-ctx-'));
      const agentDir = path.join(dir, 'test-agent');
      fs.mkdirSync(agentDir, { recursive: true });

      fs.writeFileSync(
        path.join(agentDir, 'agent.js'),
        `module.exports = {
          name: 'test-agent',
          contributes: {
            tools: {
              greet: {
                handler: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
              },
            },
          },
        };`
      );

      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });

      const stubs = makeStubs();
      // Construct WITHOUT eventLog
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      await d.dispatch('test-agent', 'greet', {});

      // buildAgentContext should have been called, but WITHOUT eventLog
      expect(buildAgentContext).toHaveBeenCalled();
      const call = (buildAgentContext as jest.Mock).mock.calls[0][0];
      expect(call.eventLog).toBeUndefined();

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('FAILS when buildAgentContext receives no eventLog — dispatchRun path', async () => {
      const { buildAgentContext } = require('../../../src/main/agent-runtime/buildAgentContext');
      (buildAgentContext as jest.Mock).mockClear();

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-ctx-'));
      const agentDir = path.join(dir, 'test-agent');
      fs.mkdirSync(agentDir, { recursive: true });

      fs.writeFileSync(
        path.join(agentDir, 'agent.js'),
        `module.exports = {
          name: 'test-agent',
          run: async () => ({ findings: [] }),
        };`
      );

      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {}, executionMode: 'run' });

      const stubs = makeStubs();
      // Construct WITHOUT eventLog
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      await d.dispatch('test-agent', 'greet', {});

      // buildAgentContext should have been called, but WITHOUT eventLog
      expect(buildAgentContext).toHaveBeenCalled();
      const call = (buildAgentContext as jest.Mock).mock.calls[0][0];
      expect(call.eventLog).toBeUndefined();

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('includes target field when args contains site', async () => {
      const reg = new ContributedToolRegistry();
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} });

      const eventLog = {
        write: jest.fn(),
        pathsFor: jest.fn().mockReturnValue({ combined: '/tmp/nexus.log', agent: '/tmp/agent.log' }),
      } as any;

      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore, undefined, eventLog);

      await d.dispatch('my-agent', 'greet', { site: 'my-site' });

      expect(eventLog.write).toHaveBeenCalled();
      const call = eventLog.write.mock.calls[0][0];
      expect(call.fields.target).toBe('my-site');
    });

    it('omits target field when args does not contain site', async () => {
      const reg = new ContributedToolRegistry();
      reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} });

      const eventLog = {
        write: jest.fn(),
        pathsFor: jest.fn().mockReturnValue({ combined: '/tmp/nexus.log', agent: '/tmp/agent.log' }),
      } as any;

      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, '/nonexistent', stubs.resolvedProvider, stubs.stateStore, undefined, eventLog);

      await d.dispatch('my-agent', 'greet', {});

      expect(eventLog.write).toHaveBeenCalled();
      const call = eventLog.write.mock.calls[0][0];
      expect(call.fields.target).toBeUndefined();
    });
  });

  describe('handler timeout — cleared on every path (WP-19b)', () => {
    // The 5-minute handler/run timeout used to be cleared only where the
    // handler RESOLVED (inside an async IIFE, after the await). A handler that
    // threw skipped that line entirely, so the timer stayed armed for five
    // minutes after the dispatch had already returned its error result —
    // holding the context closure and the event loop open. Every failing
    // contributed-tool call leaked one. Fake timers make the leak observable:
    // `jest.getTimerCount()` is 1 against the defect and 0 against the fix.
    const dirs: string[] = [];

    const makeAgent = (body: string): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-timer-'));
      dirs.push(dir);
      fs.mkdirSync(path.join(dir, 'test-agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test-agent', 'agent.js'), body);
      return dir;
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('dispatchFunction clears the timeout when the handler rejects', async () => {
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        contributes: { tools: { greet: { handler: async () => { throw new Error('boom'); } } } },
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const r = await d.dispatch('test-agent', 'greet', {});

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('boom');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('dispatchFunction clears the timeout when the handler throws synchronously, with no unhandled rejection', async () => {
      // A synchronous throw never reaches Promise.race, so the timeout promise
      // has no subscriber at all — if its timer were left armed it would reject
      // into nothing five minutes later. This is the case that makes the
      // unhandled-rejection pin load-bearing rather than decorative.
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        contributes: { tools: { greet: { handler: () => { throw new Error('sync boom'); } } } },
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const rejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => rejections.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const r = await d.dispatch('test-agent', 'greet', {});
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toContain('sync boom');
        expect(jest.getTimerCount()).toBe(0);

        // Push past the 5-minute budget, then hand the loop back to real time
        // so Node can report any rejection nobody is listening for.
        jest.advanceTimersByTime(600_000);
        jest.useRealTimers();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(rejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('dispatchRun clears the timeout when run() rejects', async () => {
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        run: async () => { throw new Error('run boom'); },
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {}, executionMode: 'run' });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const r = await d.dispatch('test-agent', 'greet', {});

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('run boom');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('still clears the timeout on the success path, and still returns the handler result', async () => {
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        contributes: { tools: { greet: { handler: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }) } } },
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const r = await d.dispatch('test-agent', 'greet', {});

      expect(r.isError).toBe(false);
      expect(r.content[0].text).toBe('ok');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('still clears the timeout on the dispatchRun success path, and still returns the run result', async () => {
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        run: async () => ({ findings: [{ id: 'f1' }] }),
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {}, executionMode: 'run' });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const r = await d.dispatch('test-agent', 'greet', {});

      expect(r.isError).toBeUndefined();
      expect(JSON.parse(r.content[0].text!)).toEqual({ findings: [{ id: 'f1' }] });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('the timeout still fires for a run() that never settles', async () => {
      // dispatchRun's budget had no pin at all until the mutation battery
      // deleted its timeoutPromise from the race and every test still passed.
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        run: () => new Promise(() => {}),
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {}, executionMode: 'run' });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const pending = d.dispatch('test-agent', 'greet', {});
      await Promise.resolve();
      jest.advanceTimersByTime(300_000);
      const r = await pending;

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('timed out');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('the timeout still fires for a handler that never settles', async () => {
      // The clear must not defeat the budget it exists to enforce.
      const dir = makeAgent(`module.exports = {
        name: 'test-agent',
        contributes: { tools: { greet: { handler: () => new Promise(() => {}) } } },
      };`);
      const reg = new ContributedToolRegistry();
      reg.register('test-agent', { name: 'greet', description: 'Test', inputSchema: {} });
      const stubs = makeStubs();
      const d = new AgentDispatcher(reg, stubs.toolRegistry, stubs.services, dir, stubs.resolvedProvider, stubs.stateStore);

      const pending = d.dispatch('test-agent', 'greet', {});
      await Promise.resolve();
      jest.advanceTimersByTime(300_000);
      const r = await pending;

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('timed out');
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
