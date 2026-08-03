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
});
