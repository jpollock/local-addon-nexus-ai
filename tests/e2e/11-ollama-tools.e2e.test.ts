import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

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

  it('ask_ollama generates a response', async () => {
    if (!ollamaAvailable) return;

    const result = await client.callTool('ask_ollama', {
      prompt: 'Reply with exactly the word "hello" and nothing else.',
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  }, 120000); // LLM responses can be slow
});
