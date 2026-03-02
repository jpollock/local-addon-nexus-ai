import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment, resultText, expectSuccess, getAnySite } from './helpers/environment';

/**
 * Ollama tools — conditional on Ollama being running.
 * These tests only run if the developer has Ollama installed and running.
 */
describe('11 — Ollama Tools', () => {
  let client: McpClient;
  let ollamaAvailable: boolean;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    ollamaAvailable = env.ollamaAvailable;
    if (!ollamaAvailable) {
      console.log('Ollama not available — skipping Ollama tool tests');
    }
  });

  it('list_ollama_models returns available models', async () => {
    if (!ollamaAvailable) return;

    const result = await client.callTool('list_ollama_models');
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('list_ollama_models includes System Info section', async () => {
    if (!ollamaAvailable) return;

    const result = await client.callTool('list_ollama_models');
    expectSuccess(result);

    const text = resultText(result);
    expect(text).toContain('System Info');
    expect(text).toContain('Total RAM');
    expect(text).toContain('Recommended');
  });

  it('ask_ollama generates a response', async () => {
    if (!ollamaAvailable) return;

    const result = await client.callTool('ask_ollama', {
      prompt: 'Reply with exactly the word "hello" and nothing else.',
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  }, 120000); // LLM responses can be slow

  it('ask_ollama with site param returns site-aware response', async () => {
    if (!ollamaAvailable) return;

    const env = deserializeEnvironment();
    if (env.runningSites.length === 0) {
      console.log('No running sites — skipping site context test');
      return;
    }

    const site = env.runningSites[0];
    const result = await client.callTool('ask_ollama', {
      prompt: 'What is this WordPress site about? Reply in one sentence.',
      site: site.name,
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  }, 120000);

  it('ask_ollama with unknown site returns error', async () => {
    if (!ollamaAvailable) return;

    const result = await client.callTool('ask_ollama', {
      prompt: 'Hello',
      site: 'nonexistent-site-xyz-99999',
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Site not found');
  }, 30000);
});
