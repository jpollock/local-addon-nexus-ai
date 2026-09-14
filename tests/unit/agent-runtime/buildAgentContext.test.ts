import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';
import { initializeProviders } from '../../../src/main/chat/providers';

// getProvider() reads from a registry populated only by this call (normally done once at app
// startup) — without it, getProvider() returns null for every id and buildAgentContext falls
// back to its own stub {run, generateObject}, silently masking which provider ctx.ai resolved to.
beforeAll(() => { initializeProviders(); });

const makeAgent = () => ({
  name: 'test-agent',
  version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  logDir: path.join(os.tmpdir(), 'nexus-test-logs'),
});

describe('buildAgentContext', () => {
  it('returns a ctx with log, state, tools, ai, autonomy', () => {
    const { ctx, agentLog, accFindings, accSites } = buildAgentContext({
      agent: makeAgent(),
      ...makeStubs(),
    });
    expect(ctx.log).toBeDefined();
    expect(ctx.state).toBeDefined();
    expect(ctx.tools).toBeDefined();
    expect(ctx.ai).toBeDefined();
    expect(ctx.autonomy).toBe('ask'); // default when cache is empty
    expect(agentLog).toBe(ctx.log);
    expect(Array.isArray(accFindings)).toBe(true);
    expect(accSites).toEqual({});
  });

  it('log.finding pushes to accFindings', () => {
    const { ctx, accFindings } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.finding({ id: 'T-01', severity: 'high', title: 'test', site: 's' });
    expect(accFindings).toHaveLength(1);
    expect(accFindings[0].id).toBe('T-01');
  });

  it('log.siteStatus updates accSites', () => {
    const { ctx, accSites } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.siteStatus('my-site', 'clean');
    expect(accSites['my-site'].status).toBe('clean');
  });

  describe('agent.tools scoping', () => {
    it('agent.tools: [] produces a NexusToolProvider that denies every tool (not unrestricted access)', async () => {
      const stubs = makeStubs();
      stubs.toolRegistry.list.mockReturnValue([
        { name: 'nexus_list_sites', description: 'List sites', inputSchema: { type: 'object', properties: {} } },
      ]);
      const { ctx } = buildAgentContext({
        agent: { ...makeAgent(), tools: [] },
        ...stubs,
      });
      // An empty tools list must not fall through to "undefined = unrestricted".
      expect((ctx.tools as any).getProviderToolDefinitions()).toEqual([]);
      await expect(ctx.tools.invoke('nexus_list_sites', {})).rejects.toThrow(
        'Tool "nexus_list_sites" is not in this agent\'s tools[] declaration'
      );
    });

    it('agent with no tools field at all remains unrestricted (existing behavior, unchanged)', async () => {
      const stubs = makeStubs();
      stubs.toolRegistry.list.mockReturnValue([
        { name: 'nexus_list_sites', description: 'List sites', inputSchema: { type: 'object', properties: {} } },
      ]);
      stubs.toolRegistry.call.mockResolvedValue({ content: [{ type: 'text', text: '{}' }], isError: false });
      const { ctx } = buildAgentContext({
        agent: makeAgent(), // no `tools` field
        ...stubs,
      });
      expect((ctx.tools as any).getProviderToolDefinitions()).toHaveLength(1);
      await expect(ctx.tools.invoke('nexus_list_sites', {})).resolves.toEqual({});
    });
  });

  describe('agents never route through the Local AI Gateway, regardless of useLocalGateway', () => {
    // Reproduced live: with settings.useLocalGateway=true (a flag meant to route a WordPress
    // SITE's own AI calls through Local so Nexus can inject credentials the site never sees),
    // buildAgentContext also routed the security-sentinel agent's own specialist/synthesis
    // calls through that same HTTP server. An agent runs in this process already, with direct
    // access to resolvedProvider.apiKey — it has no WP-site credential problem to solve by
    // detouring through a server built for a different caller. The practical failure: the
    // gateway's own provider routing only recognized a subset of providers, so an agent
    // configured for 'power' 503'd with "No API key configured" even with a real key present.
    it('resolves the configured provider directly even when useLocalGateway is true', () => {
      const stubs = makeStubs();
      const { ctx } = buildAgentContext({
        agent: makeAgent(),
        ...stubs,
        resolvedProvider: { ...stubs.resolvedProvider, provider: 'anthropic', useLocalGateway: true },
      });
      const provider = (ctx.ai as any).provider;
      expect(provider?.id).not.toBe('local-gateway');
      expect(provider?.id).toBe('anthropic');
    });

    it('does not route to the gateway URL/token even when a gateway is configured', () => {
      const stubs = makeStubs();
      const { ctx } = buildAgentContext({
        agent: makeAgent(),
        ...stubs,
        services: { ...stubs.services, gatewayUrl: 'http://127.0.0.1:13100', gatewayAuthToken: 'gw-token' },
        resolvedProvider: { ...stubs.resolvedProvider, provider: 'anthropic', apiKey: 'sk-ant-real', useLocalGateway: true },
      });
      const config = (ctx.ai as any).config;
      expect(config?.baseUrl).not.toBe('http://127.0.0.1:13100');
      expect(config?.apiKey).toBe('sk-ant-real');
    });
  });
});
