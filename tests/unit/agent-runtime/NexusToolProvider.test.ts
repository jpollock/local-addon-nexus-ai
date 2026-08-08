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
    expect(registry.call).toHaveBeenCalledWith('nexus_list_sites', {}, fakeServices, 'agent');
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

  it('an empty tools array denies every tool (no unrestricted fallback)', () => {
    const p = new NexusToolProvider(fakeRegistry as any, {} as any, []);
    expect(p.getProviderToolDefinitions()).toEqual([]);
  });
});

describe('NexusToolProvider — empty allowedTools denies everything', () => {
  it('an empty tools array refuses invoke() for any tool name', async () => {
    const registry = makeRegistry({ nexus_list_sites: () => [{ name: 'mysite' }] });
    const provider = new NexusToolProvider(registry as any, fakeServices, []);
    await expect(provider.invoke('nexus_list_sites', {})).rejects.toThrow(
      'Tool "nexus_list_sites" is not declared in this agent\'s tools list'
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('undefined tools (agent never declares) remains unrestricted, unchanged', async () => {
    const registry = makeRegistry({ nexus_list_sites: () => [{ name: 'mysite' }] });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    const result = await provider.invoke('nexus_list_sites', {});
    expect(result).toEqual([{ name: 'mysite' }]);
  });
});

describe('NexusToolProvider — wp_eval sandbox scoping', () => {
  it('refuses wp_eval against any site when allowedTools is set but registerSandbox was never called', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wp_eval']);
    // registerSandbox() is never called -- sandboxSiteIds stays empty.
    await expect(provider.invoke('wp_eval', { site: 'any-site' })).rejects.toThrow(
      'wp_eval refused: no sandbox site registered for this agent'
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('allows wp_eval against a registered sandbox site', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wp_eval']);
    provider.registerSandbox('my-site');
    const result = await provider.invoke('wp_eval', { site: 'my-site' });
    expect(result).toBe('ok');
  });

  it('still refuses wp_eval against a site outside the registered sandbox', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wp_eval']);
    provider.registerSandbox('my-site');
    await expect(provider.invoke('wp_eval', { site: 'other-site' })).rejects.toThrow(
      'wp_eval: site "other-site" is not in this agent\'s registered sandbox scope'
    );
  });
});
