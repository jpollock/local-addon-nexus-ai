import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

function makeRegistry(tools: Record<string, any>) {
  return {
    call: jest.fn(async (name: string, args: any, services: any) => {
      if (!tools[name]) return { content: [{ type: 'text', text: `Unknown tool: "${name}"` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(tools[name](args)) }], isError: false };
    }),
  };
}

const fakeServices = {} as any;

describe('NexusToolProvider', () => {
  it('invokes a declared tool successfully', async () => {
    const registry = makeRegistry({
      nexus_list_sites: () => [{ name: 'mysite' }],
    });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['nexus_list_sites']);
    const result = await provider.invoke('nexus_list_sites', {});
    expect(result).toEqual([{ name: 'mysite' }]);
    expect(registry.call).toHaveBeenCalledWith('nexus_list_sites', {}, fakeServices, 'agent', undefined);
  });

  it('throws for an undeclared tool', async () => {
    const registry = makeRegistry({ nexus_list_sites: () => [] });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['nexus_list_sites']);
    await expect(provider.invoke('wp_eval', {})).rejects.toThrow(
      'Tool "wp_eval" is not declared in this agent\'s tools list'
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('allows any tool when tools list is undefined', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    const result = await provider.invoke('wp_eval', {});
    expect(result).toBe('ok');
  });

  it('passes runId to registry.call when events context is provided', async () => {
    const registry = makeRegistry({
      nexus_list_sites: () => [{ name: 'mysite' }],
    });
    const provider = new NexusToolProvider(
      registry as any,
      fakeServices,
      ['nexus_list_sites'],
      { agentName: 'test-agent', runId: 'r_abc123' }
    );
    const result = await provider.invoke('nexus_list_sites', {});
    expect(result).toEqual([{ name: 'mysite' }]);
    expect(registry.call).toHaveBeenCalledWith('nexus_list_sites', {}, fakeServices, 'agent', 'r_abc123');
  });

  it('throws when tool returns isError=true', async () => {
    const registry = {
      call: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Site not found' }],
        isError: true,
      }),
    };
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    await expect(provider.invoke('nexus_list_sites', {})).rejects.toThrow('Site not found');
  });
});

const fakeRegistry = {
  list: () => [
    { name: 'nexus_list_sites', description: 'List sites', inputSchema: { type: 'object', properties: {} } },
    { name: 'nexus_secret',     description: 'Secret',     inputSchema: { type: 'object', properties: {} } },
  ],
  call: jest.fn(),
};

describe('NexusToolProvider.getProviderToolDefinitions', () => {
  it('returns all tools when allowedTools is undefined', () => {
    const p = new NexusToolProvider(fakeRegistry as any, {} as any, undefined);
    expect(p.getProviderToolDefinitions()).toHaveLength(2);
  });

  it('filters to allowedTools when defined', () => {
    const p = new NexusToolProvider(fakeRegistry as any, {} as any, ['nexus_list_sites']);
    const defs = p.getProviderToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('nexus_list_sites');
  });

  it('maps inputSchema to parameters', () => {
    const p = new NexusToolProvider(fakeRegistry as any, {} as any, undefined);
    const defs = p.getProviderToolDefinitions();
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });
});
