import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

describe('ContributedToolRegistry', () => {
  let reg: ContributedToolRegistry;
  beforeEach(() => { reg = new ContributedToolRegistry(); });

  it('register and get a tool', () => {
    reg.register('my-agent', { name: 'check', description: 'Check', inputSchema: {} });
    const t = reg.get('my-agent', 'check');
    expect(t?.agentName).toBe('my-agent');
    expect(t?.executionMode).toBe('function');
    expect(t?.permissionTier).toBe(1);
  });

  it('getByMcpName parses agent__name__tool', () => {
    reg.register('my-agent', { name: 'check', description: 'c', inputSchema: {} });
    const t = reg.getByMcpName('agent__my-agent__check');
    expect(t?.toolName).toBe('check');
  });

  it('getByMcpName rejects double-underscore agent name', () => {
    // Even if someone manually registers with __, getByMcpName should not
    // accidentally split 'agent__my__agent__check' into wrong parts
    const t = reg.getByMcpName('agent__my__agent__check');
    expect(t).toBeUndefined();
  });

  it('unregisterAgent removes all tools for that agent', () => {
    reg.register('a', { name: 't1', description: '', inputSchema: {} });
    reg.register('a', { name: 't2', description: '', inputSchema: {} });
    reg.register('b', { name: 't3', description: '', inputSchema: {} });
    reg.unregisterAgent('a');
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].agentName).toBe('b');
  });

  it('toMcpDefinitions prefixes with agent__', () => {
    reg.register('acme', { name: 'scan', description: 'Scan', inputSchema: { type: 'object' } });
    const defs = reg.toMcpDefinitions();
    expect(defs[0].name).toBe('agent__acme__scan');
  });
});
