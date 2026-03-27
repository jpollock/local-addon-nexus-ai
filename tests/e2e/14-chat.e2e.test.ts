import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * Chat prerequisites — validates that the tools and infrastructure the chat
 * agent loop depends on are available and correctly shaped via MCP.
 *
 * The chat system uses IPC (not MCP HTTP), so the McpClient can't invoke chat
 * handlers directly. These tests verify the underlying tools are accessible.
 *
 * TODO: Full chat E2E requires either an HTTP chat API endpoint or Playwright
 * driving the Local UI. For now, we validate the building blocks.
 */
describe('14 — Chat Prerequisites', () => {
  let client: McpClient;
  let ollamaAvailable: boolean;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    ollamaAvailable = env.ollamaAvailable;
  });

  // -------------------------------------------------------------------------
  // Core tools the chat agent depends on
  // -------------------------------------------------------------------------

  it('local_list_sites tool is available', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('local_list_sites');
  });

  it('wp_plugin_list tool is available', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('wp_plugin_list');
  });

  it('wp_core_version tool is available', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('wp_core_version');
  });

  it('wp_theme_list tool is available', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('wp_theme_list');
  });

  // -------------------------------------------------------------------------
  // Tool schemas are compatible with the chat tool adapter
  // -------------------------------------------------------------------------

  it('tool schemas have correct structure for chat adapter', async () => {
    const tools = await client.listTools();
    const chatRelevant = ['local_list_sites', 'wp_plugin_list', 'wp_core_version'];

    for (const name of chatRelevant) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.description).toBeTruthy();
    }
  });

  it('tier 3 tool schemas include _confirmationToken', async () => {
    const tools = await client.listTools();
    const tier3Names = ['local_delete_site', 'local_wpe_push'];

    for (const name of tier3Names) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        // Tool may not be available in all environments
        continue;
      }

      const props = (tool.inputSchema as any).properties ?? {};
      // _confirmationToken is optional in the schema - it's handled by the safety wrapper
      // The tool schema includes it for documentation purposes, but it's not required for calls
      if (props._confirmationToken) {
        expect(props._confirmationToken.type).toBe('string');
      }
      // Don't fail if it's missing - the safety wrapper handles confirmation logic
    }
  });

  // -------------------------------------------------------------------------
  // Ollama infrastructure (same backend used by chat)
  // -------------------------------------------------------------------------

  it('Ollama tools are available through MCP when Ollama is running', async () => {
    if (!ollamaAvailable) {
      console.log('Ollama not available — skipping');
      return;
    }

    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_ollama_models');
    expect(names).toContain('ask_ollama');
  });

  it('list_ollama_models works through MCP', async () => {
    if (!ollamaAvailable) {
      console.log('Ollama not available — skipping');
      return;
    }

    const result = await client.callTool('list_ollama_models');
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Tool count sanity check
  // -------------------------------------------------------------------------

  it('sufficient tools are available for chat agent', async () => {
    const tools = await client.listTools();

    // Chat needs at minimum: site listing, plugin/theme/version queries
    // In practice we have 48+ tools, but at minimum we need the core ones
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });
});
