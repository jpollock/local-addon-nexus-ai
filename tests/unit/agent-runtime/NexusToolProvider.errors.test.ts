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

  it('contributed tool with no dispatcher: audit entry kept, built-in failure surfaced (QA F1/F2)', async () => {
    const registry = {
      call: jest.fn(async () => ({
        content: [{ type: 'text', text: 'prerequisites not met: site offline' }],
        isError: true,
      })),
    };
    const auditEntries: any[] = [];
    const services = {
      contributedRegistry: {
        list: () => [{ toolName: 'get_log_aggregates', agentName: 'log-processor', permissionTier: 2 }],
      },
      dispatcher: null,
      auditLogger: { log: (e: any) => auditEntries.push(e) },
    };
    const provider = new NexusToolProvider(registry as never, services as never, undefined);
    await expect(provider.invoke('get_log_aggregates', { siteId: 's1' })).rejects.toThrow(
      /contributed by log-processor and cannot be called — dispatcher not available in this context\. \(built-in call failed: prerequisites not met: site offline\)/,
    );
    // QA F1: the refusal must keep the error-audit entry the old generic path wrote —
    // exactly one, carrying the refusal, tool identity, params, and duration.
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].result).toBe('error');
    expect(auditEntries[0].toolName).toBe('log-processor/get_log_aggregates');
    expect(auditEntries[0].tier).toBe(2);
    expect(auditEntries[0].params).toEqual({ siteId: 's1' });
    expect(auditEntries[0].error).toMatch(/dispatcher not available/);
    expect(typeof auditEntries[0].duration_ms).toBe('number');
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
    expect(text).toContain('Registered tools:');
    expect(text).not.toContain('Available tools:');
    expect(text).toContain('alpha_read_tool');
    expect(text).toContain('beta_search_tool');
    expect(text).not.toContain('wpe_delete_install');
  });

  it('caps suggestions at 15 with a +N suffix at the boundary (QA F3)', async () => {
    const registry = new ToolRegistry();
    for (let i = 0; i < 16; i++) {
      registry.register({
        definition: { name: `cap_tool_${String(i).padStart(2, '0')}`, description: 'd', inputSchema: { type: 'object' } },
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
      } as never);
    }
    const result = await registry.call('cap_tool_typo', {}, noopServices); // typo has no digits: the echoed name must not pollute the count
    const text = result.content.find((c: any) => c.type === 'text')?.text ?? '';
    expect(text.match(/cap_tool_\d+/g)).toHaveLength(15); // exactly 15 suggested names
    expect(text).toContain('(+1 more)');
  });

  it('keeps the "Unknown tool:" prefix the safety wrapper classifies on', async () => {
    const registry = new ToolRegistry();
    const result = await registry.call('no_such_tool', {}, noopServices);
    const text = result.content.find((c: any) => c.type === 'text')?.text ?? '';
    expect(text.startsWith('Unknown tool: "no_such_tool".')).toBe(true);
  });
});
