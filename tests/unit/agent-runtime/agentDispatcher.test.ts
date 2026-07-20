import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

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
  it('dispatch returns error when tool not found', async () => {
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    const r = await d.dispatch('my-agent', 'missing', {});
    expect(r.isError).toBe(true);
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
