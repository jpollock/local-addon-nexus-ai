import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';

const noopServices = {} as never;

function makeRegistry(opts: { unknownResult?: boolean } = {}) {
  return {
    call: jest.fn(async () => ({
      content: [{ type: 'text', text: `Unknown tool: "whatever"` }],
      isError: true,
    })),
  };
}

describe('agent tool invoke error messages (GH-49)', () => {
  it('allowlist miss names the fix (tools[] in defineAgent)', async () => {
    const registry = makeRegistry();
    const provider = new NexusToolProvider(
      registry as never, noopServices, ['local_list_sites'],
    );
    await expect(provider.invoke('wp_eval', {})).rejects.toThrow(
      /not in this agent's tools\[\] declaration\. Add it to tools\[\] in defineAgent\(\)/,
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('contributed tool with no dispatcher says which agent contributes it and what is missing', async () => {
    const registry = makeRegistry();
    const services = {
      contributedRegistry: {
        list: () => [{ toolName: 'get_log_aggregates', agentName: 'log-processor', permissionTier: 1 }],
      },
      dispatcher: null,
    };
    const provider = new NexusToolProvider(registry as never, services as never, undefined);
    await expect(provider.invoke('get_log_aggregates', {})).rejects.toThrow(
      /contributed by log-processor and cannot be called — dispatcher not available in this context/,
    );
  });

  it('contributed tool WITH a dispatcher still routes (no false refusal)', async () => {
    const registry = {
      call: jest.fn(async () => ({
        content: [{ type: 'text', text: `Unknown tool: "get_log_aggregates"` }],
        isError: true,
      })),
    };
    const dispatched: Array<[string, string]> = [];
    const services = {
      contributedRegistry: {
        list: () => [{ toolName: 'get_log_aggregates', agentName: 'log-processor', permissionTier: 1 }],
      },
      dispatcher: {
        dispatch: async (agentName: string, toolName: string) => {
          dispatched.push([agentName, toolName]);
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], isError: false };
        },
      },
    };
    const provider = new NexusToolProvider(registry as never, services as never, undefined);
    const result = await provider.invoke('get_log_aggregates', {});
    expect(result).toEqual({ ok: true });
    expect(dispatched).toEqual([['log-processor', 'get_log_aggregates']]);
  });
});

describe('ToolRegistry unknown-tool hint (GH-49)', () => {
  function handler(name: string) {
    return {
      definition: { name, description: `${name} description`, inputSchema: { type: 'object' } },
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    };
  }

  it('suggests available non-Tier-3 tools and never advertises Tier 3', async () => {
    const registry = new ToolRegistry();
    registry.register(handler('alpha_read_tool') as never);
    registry.register(handler('beta_search_tool') as never);
    registry.register(handler('wpe_delete_install') as never); // Tier 3 — must NOT be suggested

    const result = await registry.call('alpha_read_toll' /* typo */, {}, noopServices);
    expect(result.isError).toBe(true);
    const text = result.content.find((c: any) => c.type === 'text')?.text ?? '';
    expect(text).toMatch(/^Unknown tool: "alpha_read_toll"\./);
    expect(text).toContain('alpha_read_tool');
    expect(text).toContain('beta_search_tool');
    expect(text).not.toContain('wpe_delete_install');
  });

  it('keeps the "Unknown tool:" prefix the safety wrapper classifies on', async () => {
    const registry = new ToolRegistry();
    const result = await registry.call('no_such_tool', {}, noopServices);
    const text = result.content.find((c: any) => c.type === 'text')?.text ?? '';
    expect(text.startsWith('Unknown tool: "no_such_tool".')).toBe(true);
  });
});
