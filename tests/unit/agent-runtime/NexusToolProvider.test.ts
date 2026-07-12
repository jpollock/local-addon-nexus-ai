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
