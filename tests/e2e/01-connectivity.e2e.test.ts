import { McpClient } from './helpers/client';
import { deserializeEnvironment, getClient } from './helpers/environment';

/**
 * Gate test — if this fails, skip everything else.
 * Validates the addon's MCP server is running and reachable inside Local.
 */
describe('01 — Connectivity', () => {
  let client: McpClient;

  beforeAll(() => {
    client = getClient();
  });

  it('GET /health returns 200 with status ok', async () => {
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(typeof health.port).toBe('number');
  });

  it('initialize returns protocol version and server info', async () => {
    const result = await client.initialize() as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
      instructions?: string;
    };

    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo).toBeDefined();
    expect(result.serverInfo.name).toBeTruthy();
    expect(result.serverInfo.version).toBeTruthy();
    expect(result.capabilities).toBeDefined();
  });

  it('initialize includes server instructions', async () => {
    const result = await client.initialize() as {
      instructions?: string;
    };

    expect(result.instructions).toBeDefined();
    expect(typeof result.instructions).toBe('string');
    expect(result.instructions!.length).toBeGreaterThan(100);
  });

  it('initialize capabilities include resources', async () => {
    const result = await client.initialize() as {
      capabilities: Record<string, unknown>;
    };

    expect(result.capabilities).toHaveProperty('resources');
  });

  it('tools/list returns registered tools', async () => {
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    // Every tool should have name, description, and inputSchema
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('tools/list includes site-management tools (LocalServicesBridge is wired)', async () => {
    const tools = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    // These tools require localServices to be available
    expect(toolNames).toContain('local_list_sites');
    expect(toolNames).toContain('local_get_site');
    expect(toolNames).toContain('local_start_site');
    expect(toolNames).toContain('local_stop_site');
  });

  it('tools/list includes wp-cli tools', async () => {
    const tools = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('wp_plugin_list');
    expect(toolNames).toContain('wp_theme_list');
    expect(toolNames).toContain('wp_core_version');
  });

  it('tools/list matches connection info tool count', async () => {
    const env = deserializeEnvironment();
    const tools = await client.listTools();

    // The connection info lists all registered tools; tools/list only returns
    // those whose isAvailable() returns true. So tools/list <= connection info.
    expect(tools.length).toBeLessThanOrEqual(env.availableTools.length);
    expect(tools.length).toBeGreaterThan(0);
  });
});
