import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';

const servicesBase = {} as any;

function registerBuiltIn(
  registry: ToolRegistry,
  name: string,
  execute: () => Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }>,
): void {
  registry.register({
    definition: { name, description: name, inputSchema: { type: 'object' } },
    execute,
  });
}

function routingServices(name: string, withDispatcher: boolean) {
  const dispatch = jest.fn(async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ routed: true }) }],
    isError: false,
  }));
  return {
    services: {
      contributedRegistry: {
        list: () => [{ agentName: 'contributor', toolName: name, permissionTier: 1 }],
      },
      dispatcher: withDispatcher ? { dispatch } : undefined,
      auditLogger: { log: jest.fn() },
    } as any,
    dispatch,
  };
}

describe.each([false, true])(
  'NexusToolProvider routing with dispatcher=%s',
  (withDispatcher) => {
    it('returns a same-name built-in success without dispatching a contribution', async () => {
      const name = `gh59_builtin_success_${withDispatcher}`;
      const registry = new ToolRegistry();
      registerBuiltIn(registry, name, async () => ({
        content: [{ type: 'text', text: JSON.stringify({ builtIn: true }) }],
        isError: false,
      }));
      const { services, dispatch } = routingServices(name, withDispatcher);
      const provider = new NexusToolProvider(registry, services, undefined);

      await expect(provider.invoke(name, {})).resolves.toEqual({ builtIn: true });
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('returns a same-name built-in failure without dispatching a contribution', async () => {
      const name = `gh59_builtin_failure_${withDispatcher}`;
      const registry = new ToolRegistry();
      registerBuiltIn(registry, name, async () => ({
        content: [{ type: 'text', text: 'built-in failed for real' }],
        isError: true,
      }));
      const { services, dispatch } = routingServices(name, withDispatcher);
      const provider = new NexusToolProvider(registry, services, undefined);

      await expect(provider.invoke(name, {})).rejects.toThrow('built-in failed for real');
      expect(dispatch).not.toHaveBeenCalled();
    });
  },
);

describe('NexusToolProvider absent-tool routing', () => {
  it('marks a missing built-in and routes the contributed tool', async () => {
    const name = 'gh59_contributed_only';
    const registry = new ToolRegistry();
    const missing = await registry.call(name, {}, servicesBase);
    expect(missing).toMatchObject({ isError: true, notFound: true });

    const { services, dispatch } = routingServices(name, true);
    const provider = new NexusToolProvider(registry, services, undefined);
    await expect(provider.invoke(name, {})).resolves.toEqual({ routed: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('ContributedToolRegistry built-in collisions', () => {
  it('rejects the colliding contribution without changing existing contributions', () => {
    const contributed = new ContributedToolRegistry();
    contributed.register('existing-agent', {
      name: 'gh59_existing_contribution',
      description: 'keep me',
      inputSchema: {},
    });
    contributed.register('colliding-agent', {
      name: 'get_gateway_usage',
      description: 'must be rejected',
      inputSchema: {},
    });

    expect(contributed.list()).toEqual([
      expect.objectContaining({
        agentName: 'existing-agent',
        toolName: 'gh59_existing_contribution',
        description: 'keep me',
      }),
    ]);
  });
});
