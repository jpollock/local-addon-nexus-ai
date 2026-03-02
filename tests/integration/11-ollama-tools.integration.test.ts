import { TestHarness } from './helpers/harness';
import { loadPosts, createSiteData } from './helpers/fixtures';
import { expectToolError, expectToolSuccess, expectToolText } from './helpers/assertions';
import { recommendModel } from '../../src/main/mcp/modules/ollama/model-recommender';
import { refreshOllamaStatus, getOllamaStatus } from '../../src/main/mcp/modules/ollama/ask-ollama';
import * as os from 'os';

/**
 * Integration tests for Ollama tools.
 *
 * These run against the real embedding pipeline and vector store (no mocks
 * for the core pipeline). Ollama itself is NOT required — tests exercise:
 *   - Model recommender with real system RAM
 *   - Site context building through real embeddings
 *   - Error paths when Ollama is offline
 *   - Tool registration and availability gating
 */

describe('Ollama Integration — ModelRecommender with real hardware', () => {
  it('recommends a model appropriate for this machine', () => {
    const totalMemGB = Math.round(os.totalmem() / (1024 ** 3));
    const rec = recommendModel(totalMemGB, []);

    expect(rec.model).toBeTruthy();
    expect(rec.reason).toContain(`${totalMemGB} GB RAM`);
    expect(rec.installed).toBe(false); // no models passed in
  });

  it('prefers installed model when available', () => {
    const totalMemGB = Math.round(os.totalmem() / (1024 ** 3));
    // Simulate having a small model installed
    const rec = recommendModel(totalMemGB, ['llama3.2:3b']);

    expect(rec.installed).toBe(true);
    expect(rec.model).toBe('llama3.2:3b');
  });
});

describe('Ollama Integration — refreshOllamaStatus', () => {
  it('detects Ollama as unavailable when not running', async () => {
    // This test assumes Ollama is NOT guaranteed to be running in CI.
    // We test that the function doesn't throw and returns a boolean.
    const result = await refreshOllamaStatus();
    expect(typeof result).toBe('boolean');

    const status = getOllamaStatus();
    expect(typeof status.available).toBe('boolean');
    expect(Array.isArray(status.models)).toBe(true);
  });
});

describe('Ollama Integration — ask_ollama with site context (live pipeline)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-ollama-test': {
        id: 'site-ollama-test',
        name: 'Ollama Test Blog',
        path: '/tmp/nexus-test/ollama-blog',
        domain: 'ollama-blog.local',
      },
    });

    harness = await TestHarness.create({ skipServer: true, siteData });

    // Index fixture posts through real embedding pipeline
    const posts = loadPosts('blog-posts');
    await harness.indexFixturePosts('site-ollama-test', 'Ollama Test Blog', posts);
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  it('returns site-not-found error for unknown site', async () => {
    const result = await harness.callTool('ask_ollama', {
      prompt: 'Hello',
      site: 'nonexistent-site-xyz',
    });

    // Ollama tools are gated by isAvailable.
    // If Ollama is not running, the tool is unavailable and returns a different error.
    // Either way, the call should not succeed.
    expect(result.isError).toBe(true);
  });

  it('verifies indexed site has searchable content for context injection', async () => {
    // This validates the pipeline that feeds ask_ollama's site context:
    // embed query → search vector store → get results
    const queryVec = await harness.embeddingService.embed('WordPress plugin development');
    const results = await harness.vectorStore.search('site-ollama-test', queryVec, { limit: 3 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBeTruthy();
    expect(results[0].content).toBeTruthy();
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('verifies site structure is stored in index registry', () => {
    const entry = harness.indexRegistry.get('site-ollama-test');
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe('indexed');
    expect(entry!.siteName).toBe('Ollama Test Blog');
    expect(entry!.documentCount).toBeGreaterThan(0);
  });

  it('verifies content relevance for context injection queries', async () => {
    // "WooCommerce payment" should rank WooCommerce posts higher
    const queryVec = await harness.embeddingService.embed('WooCommerce payment gateway');
    const results = await harness.vectorStore.search('site-ollama-test', queryVec, { limit: 3 });

    expect(results.length).toBeGreaterThan(0);
    const topResult = results[0];
    // The top result should be the WooCommerce post
    const text = (topResult.title + ' ' + topResult.content).toLowerCase();
    expect(text).toMatch(/woocommerce|payment/);
  });
});

describe('Ollama Integration — list_ollama_models tool availability', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create({ skipServer: true });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  it('ask_ollama and list_ollama_models are registered', () => {
    const names = harness.registry.allToolNames();
    expect(names).toContain('ask_ollama');
    expect(names).toContain('list_ollama_models');
  });

  it('ollama tools are gated by availability', () => {
    // Without Ollama running, tools should be filtered from list()
    const available = harness.registry.list(harness.services);
    const names = available.map((t) => t.name);

    // If Ollama is not running, these should NOT appear in available tools
    const status = getOllamaStatus();
    if (!status.available) {
      expect(names).not.toContain('ask_ollama');
      expect(names).not.toContain('list_ollama_models');
    } else {
      // If Ollama happens to be running, they should appear
      expect(names).toContain('ask_ollama');
      expect(names).toContain('list_ollama_models');
    }
  });
});
