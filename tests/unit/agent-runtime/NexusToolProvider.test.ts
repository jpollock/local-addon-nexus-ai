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
    // requireConfirmation sits at position 5 — an agent loop has no human confirmation of its
    // own, so it must never be the caller that waives the Tier 3 gate. runId follows it.
    expect(registry.call).toHaveBeenCalledWith('nexus_list_sites', {}, fakeServices, 'agent', true, undefined);
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
    // Use a tool with no extra per-tool gate. wp_eval carries an additional sandbox site gate
    // (see the "wp_eval sandbox scoping" block) that applies to unrestricted agents too, so it
    // is the wrong tool to demonstrate the plain tool-scope fallthrough with.
    const registry = makeRegistry({ nexus_list_sites: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    const result = await provider.invoke('nexus_list_sites', {});
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
    expect(registry.call).toHaveBeenCalledWith('nexus_list_sites', {}, fakeServices, 'agent', true, 'r_abc123');
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

describe('NexusToolProvider — Tier 3 destructive tools are refused for agents (P0-1 / C2)', () => {
  it('refuses a declared Tier-3 tool and never reaches the registry', async () => {
    // wpe_delete_install is Tier 3 in TIER_OVERRIDES. Even though the agent declares it,
    // an agent loop has no human to satisfy the confirmation token, so it must be refused
    // outright rather than handed a token the model can re-issue to itself.
    const registry = makeRegistry({ wpe_delete_install: () => 'deleted' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wpe_delete_install']);
    await expect(provider.invoke('wpe_delete_install', { install_name: 'prod' })).rejects.toThrow(
      /Tier 3/i,
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('refuses a Tier-3 tool even for an unrestricted (no tools list) agent', async () => {
    const registry = makeRegistry({ local_wpe_push: () => 'pushed' });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    await expect(provider.invoke('local_wpe_push', { site: 'x' })).rejects.toThrow(/Tier 3/i);
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('still allows a declared Tier-2 tool (the refusal is Tier-3 specific)', async () => {
    const registry = makeRegistry({ local_stop_site: () => 'stopped' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['local_stop_site']);
    const result = await provider.invoke('local_stop_site', { site: 'x' });
    expect(result).toBe('stopped');
    expect(registry.call).toHaveBeenCalled();
  });

  // P1-1: the WPE create/provision family was Tier 2, so a prompt-injected agent could stand up
  // billed production infrastructure unattended. Now Tier 3, it is refused here like any other
  // destructive tool. Non-vacuous: this passed straight through to registry.call when the tool
  // was Tier 2.
  it('refuses a newly-promoted WPE create tool for an agent (P1-1)', async () => {
    const registry = makeRegistry({ wpe_create_install: () => 'created' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wpe_create_install']);
    await expect(provider.invoke('wpe_create_install', { name: 'prod', accountId: 'x' })).rejects.toThrow(
      /Tier 3/i,
    );
    expect(registry.call).not.toHaveBeenCalled();
  });
});

describe('NexusToolProvider.getProviderToolDefinitions — Tier 3 excluded from the agent model', () => {
  const registryWithT3 = {
    list: () => [
      { name: 'nexus_list_sites', description: 'read', inputSchema: { type: 'object', properties: {} } },
      { name: 'wpe_delete_install', description: 'destroy', inputSchema: { type: 'object', properties: {} } },
      { name: 'local_wpe_push', description: 'push', inputSchema: { type: 'object', properties: {} } },
    ],
    call: jest.fn(),
  };

  it('does not offer Tier-3 tools to the agent model, even when unrestricted', () => {
    const p = new NexusToolProvider(registryWithT3 as any, {} as any, undefined);
    const names = p.getProviderToolDefinitions().map(d => d.name);
    expect(names).toContain('nexus_list_sites');
    expect(names).not.toContain('wpe_delete_install');
    expect(names).not.toContain('local_wpe_push');
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

  // Regression: the site gate must NOT depend on allowedTools. An agent that declares no
  // tools list (allowedTools === undefined) is the MORE privileged caller (every tool allowed),
  // so it is exactly the one that must still be scoped for wp_eval. Guarding the gate with
  // `&& this.allowedTools` let an unrestricted agent run arbitrary PHP fleet-wide.
  it('applies the site gate to an unrestricted (no tools list) agent — refuses when no sandbox registered', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    await expect(provider.invoke('wp_eval', { site: 'any-site' })).rejects.toThrow(
      'wp_eval refused: no sandbox site registered for this agent'
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('an unrestricted agent may run wp_eval only against a registered sandbox site', async () => {
    const registry = makeRegistry({ wp_eval: () => 'ok' });
    const provider = new NexusToolProvider(registry as any, fakeServices, undefined);
    provider.registerSandbox('my-site');
    await expect(provider.invoke('wp_eval', { site: 'other' })).rejects.toThrow(
      'wp_eval: site "other" is not in this agent\'s registered sandbox scope'
    );
    expect(await provider.invoke('wp_eval', { site: 'my-site' })).toBe('ok');
  });

  // T-INJECTION: the same sandbox gate covers wp_search_replace (a bulk-overwrite freeform tool),
  // not just wp_eval — an agent must not be steerable into rewriting an arbitrary site's DB.
  it('refuses wp_search_replace for an agent with no registered sandbox', async () => {
    const registry = makeRegistry({ wp_search_replace: () => 'replaced' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wp_search_replace']);
    await expect(provider.invoke('wp_search_replace', { site: 'any', search: 'a', replace: 'b' })).rejects.toThrow(
      'wp_search_replace refused: no sandbox site registered for this agent'
    );
    expect(registry.call).not.toHaveBeenCalled();
  });

  it('allows wp_search_replace only against a registered sandbox site', async () => {
    const registry = makeRegistry({ wp_search_replace: () => 'replaced' });
    const provider = new NexusToolProvider(registry as any, fakeServices, ['wp_search_replace']);
    provider.registerSandbox('my-site');
    await expect(provider.invoke('wp_search_replace', { site: 'other', search: 'a', replace: 'b' })).rejects.toThrow(
      /not in this agent's registered sandbox scope/
    );
    expect(await provider.invoke('wp_search_replace', { site: 'my-site', search: 'a', replace: 'b' })).toBe('replaced');
  });
});
