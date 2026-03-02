import * as http from 'http';
import { EventEmitter } from 'events';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { VECTOR_DIMENSIONS } from '../../src/common/constants';
import { recommendModel } from '../../src/main/mcp/modules/ollama/model-recommender';
import { askOllamaHandler, refreshOllamaStatus } from '../../src/main/mcp/modules/ollama/ask-ollama';
import { listOllamaModelsHandler } from '../../src/main/mcp/modules/ollama/list-models';

// ---------------------------------------------------------------------------
// HTTP mocking
// ---------------------------------------------------------------------------

jest.mock('http');
const mockedHttp = http as jest.Mocked<typeof http>;

function fakeReq(): EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock } {
  const req = new EventEmitter() as any;
  req.write = jest.fn();
  req.end = jest.fn();
  req.destroy = jest.fn();
  return req;
}

/**
 * Mock http.request so the response callback fires synchronously (attaching
 * data/end listeners) and events fire on the next tick (after listeners exist).
 */
function setupHttpMock(statusCode: number, body: string): void {
  mockedHttp.request.mockImplementation((_opts: any, cb: any) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = statusCode;
    cb(res); // sync — source attaches listeners here
    process.nextTick(() => {
      res.emit('data', Buffer.from(body));
      res.emit('end');
    });
    return fakeReq() as any;
  });

  mockedHttp.get.mockImplementation((_opts: any, cb: any) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = statusCode;
    cb(res);
    process.nextTick(() => {
      res.emit('data', Buffer.from(body));
      res.emit('end');
    });
    return fakeReq() as any;
  });
}

/**
 * Mock http.request/get to call a function that returns (statusCode, body)
 * per invocation, allowing different responses for sequential calls.
 */
function setupHttpSequence(
  responses: Array<{ status: number; body: string }>,
): { writtenBodies: string[] } {
  const writtenBodies: string[] = [];
  let callIndex = 0;

  mockedHttp.request.mockImplementation((_opts: any, cb: any) => {
    const idx = callIndex++;
    const { status, body } = responses[idx] ?? responses[responses.length - 1];
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = status;
    cb(res);
    process.nextTick(() => {
      res.emit('data', Buffer.from(body));
      res.emit('end');
    });
    const req = fakeReq();
    req.write.mockImplementation((data: string) => writtenBodies.push(data));
    return req as any;
  });

  return { writtenBodies };
}

function setupHttpError(errorMessage: string): void {
  mockedHttp.request.mockImplementation(() => {
    const req = fakeReq();
    req.end.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error(errorMessage)));
    });
    return req as any;
  });

  mockedHttp.get.mockImplementation(() => {
    const req = fakeReq();
    process.nextTick(() => req.emit('error', new Error(errorMessage)));
    return req as any;
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockStorage(): RegistryStorage {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

function makeFakeVector(): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSIONS);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) vec[i] = Math.random();
  return vec;
}

const testSites: Record<string, LocalSiteInfo> = {
  site1: { id: 'site1', name: 'My Blog', path: '/tmp/myblog', domain: 'myblog.local' },
};

function createMockServices(indexRegistry: IndexRegistry): NexusServices {
  return {
    vectorStore: {
      search: jest.fn().mockResolvedValue([
        {
          id: 'wp_site1_1',
          title: 'Hello World',
          content: 'This is a test post about WordPress themes and plugins.',
          postType: 'post',
          postId: 1,
          score: 0.85,
          metadata: JSON.stringify({ categories: ['General'] }),
        },
      ]),
    } as any,
    embeddingService: {
      embed: jest.fn().mockResolvedValue(makeFakeVector()),
    } as any,
    contentPipeline: {} as any,
    indexRegistry,
    fileScanner: {
      scan: jest.fn().mockResolvedValue({
        themes: [{ name: 'Twenty Twenty-Four', slug: 'twentytwentyfour', version: '1.1', isActive: true, isChildTheme: false }],
        plugins: [{ name: 'WooCommerce', slug: 'woocommerce', version: '8.5', isActive: true, description: 'eCommerce' }],
        phpVersion: '8.2',
        wpVersion: '6.5',
        isMultisite: false,
        hasWooCommerce: true,
        hasACF: false,
      }),
    } as any,
    siteData: {
      getSite: (id: string) => testSites[id] ?? null,
      getSites: () => testSites,
    },
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelRecommender', () => {
  it('recommends llama3.2:3b for <= 8 GB RAM', () => {
    const rec = recommendModel(8, []);
    expect(rec.model).toBe('llama3.2:3b');
    expect(rec.installed).toBe(false);
  });

  it('recommends llama3.1:8b for 12 GB RAM', () => {
    const rec = recommendModel(12, []);
    expect(rec.model).toBe('llama3.1:8b');
    expect(rec.installed).toBe(false);
  });

  it('recommends gemma3:12b for 16 GB RAM', () => {
    const rec = recommendModel(16, []);
    expect(rec.model).toBe('gemma3:12b');
    expect(rec.installed).toBe(false);
  });

  it('recommends llama3.3:70b for 32 GB RAM', () => {
    const rec = recommendModel(32, []);
    expect(rec.model).toBe('llama3.3:70b');
    expect(rec.installed).toBe(false);
  });

  it('recommends llama3.3:70b for > 32 GB RAM', () => {
    const rec = recommendModel(64, []);
    expect(rec.model).toBe('llama3.3:70b');
  });

  it('prefers installed model that fits within budget', () => {
    const rec = recommendModel(16, ['llama3.1:8b', 'llama3.2:3b']);
    expect(rec.installed).toBe(true);
    expect(rec.model).toBe('llama3.1:8b');
  });

  it('prefers larger installed model when multiple fit', () => {
    const rec = recommendModel(32, ['gemma3:12b', 'llama3.2:3b']);
    expect(rec.model).toBe('gemma3:12b');
    expect(rec.installed).toBe(true);
  });

  it('returns fallback for very low RAM', () => {
    const rec = recommendModel(2, []);
    expect(rec.model).toBe('llama3.2:3b');
  });
});

/**
 * Reset Ollama module-level state (cachedModels, isOllamaRunning) by
 * simulating a failed connection. Must be called before tests that
 * depend on specific model availability.
 */
async function resetOllamaState(): Promise<void> {
  setupHttpError('reset');
  await refreshOllamaStatus();
  jest.clearAllMocks();
}

describe('refreshOllamaStatus', () => {
  beforeEach(async () => {
    await resetOllamaState();
  });

  it('returns true when Ollama API responds', async () => {
    setupHttpMock(200, JSON.stringify({
      models: [{ name: 'llama3.2:latest', size: 2e9 }],
    }));

    const result = await refreshOllamaStatus();
    expect(result).toBe(true);
  });

  it('returns false on connection error', async () => {
    setupHttpError('ECONNREFUSED');

    const result = await refreshOllamaStatus();
    expect(result).toBe(false);
  });
});

describe('ask_ollama handler', () => {
  let indexRegistry: IndexRegistry;
  let services: NexusServices;

  beforeEach(async () => {
    await resetOllamaState();
    indexRegistry = new IndexRegistry(createMockStorage());
    services = createMockServices(indexRegistry);
  });

  it('has correct definition with site parameter', () => {
    expect(askOllamaHandler.definition.name).toBe('ask_ollama');
    const props = askOllamaHandler.definition.inputSchema.properties as Record<string, any>;
    expect(props.prompt).toBeDefined();
    expect(props.model).toBeDefined();
    expect(props.system).toBeDefined();
    expect(props.site).toBeDefined();
    expect(props.site.type).toBe('string');
  });

  it('returns response text on success', async () => {
    setupHttpSequence([
      { status: 200, body: JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }) },
      { status: 200, body: JSON.stringify({ response: 'Hello from Ollama!' }) },
    ]);

    const result = await askOllamaHandler.execute({ prompt: 'Hello' }, services);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Hello from Ollama!');
  });

  it('returns error when no models available', async () => {
    setupHttpMock(200, JSON.stringify({ models: [] }));

    const result = await askOllamaHandler.execute({ prompt: 'Hello' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No Ollama models available');
  });

  it('returns error when site not found', async () => {
    setupHttpSequence([
      { status: 200, body: JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }) },
      { status: 200, body: JSON.stringify({ response: 'test' }) },
    ]);

    const result = await askOllamaHandler.execute(
      { prompt: 'Hello', site: 'nonexistent-site' },
      services,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Site not found');
  });

  it('injects site context when site is provided and found', async () => {
    indexRegistry.update('site1', {
      siteId: 'site1',
      siteName: 'My Blog',
      lastIndexed: Date.now(),
      documentCount: 5,
      chunkCount: 8,
      durationMs: 500,
      state: 'indexed',
      structure: {
        themes: [{ name: 'Twenty Twenty-Four', slug: 'twentytwentyfour', version: '1.1', isActive: true, isChildTheme: false }],
        plugins: [{ name: 'WooCommerce', slug: 'woocommerce', version: '8.5', isActive: true, description: 'eCommerce' }],
        phpVersion: '8.2',
        wpVersion: '6.5',
        isMultisite: false,
        hasWooCommerce: true,
        hasACF: false,
      },
    });

    const { writtenBodies } = setupHttpSequence([
      { status: 200, body: JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }) },
      { status: 200, body: JSON.stringify({ response: 'Site-aware answer' }) },
    ]);

    const result = await askOllamaHandler.execute(
      { prompt: 'What plugins are installed?', site: 'My Blog' },
      services,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Site-aware answer');

    // Verify system prompt in the generate request body
    const generateBody = writtenBodies.find((b) => {
      try { return JSON.parse(b).model !== undefined; } catch { return false; }
    });
    expect(generateBody).toBeDefined();
    const parsed = JSON.parse(generateBody!);
    expect(parsed.system).toContain('My Blog');
    expect(parsed.system).toContain('WooCommerce');
    expect(parsed.system).toContain('Twenty Twenty-Four');
  });

  it('appends user system prompt after site context', async () => {
    indexRegistry.update('site1', {
      siteId: 'site1',
      siteName: 'My Blog',
      lastIndexed: Date.now(),
      documentCount: 5,
      chunkCount: 8,
      durationMs: 500,
      state: 'indexed',
      structure: {
        themes: [{ name: 'Flavor', slug: 'flavor', version: '1.0', isActive: true, isChildTheme: false }],
        plugins: [],
        phpVersion: '8.2',
        wpVersion: '6.5',
        isMultisite: false,
        hasWooCommerce: false,
        hasACF: false,
      },
    });

    const { writtenBodies } = setupHttpSequence([
      { status: 200, body: JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }) },
      { status: 200, body: JSON.stringify({ response: 'ok' }) },
    ]);

    await askOllamaHandler.execute(
      { prompt: 'Hello', site: 'My Blog', system: 'You are a pirate.' },
      services,
    );

    const generateBody = writtenBodies.find((b) => {
      try { return JSON.parse(b).model !== undefined; } catch { return false; }
    });
    expect(generateBody).toBeDefined();
    const parsed = JSON.parse(generateBody!);
    // Site context comes first, user system prompt appended
    expect(parsed.system).toContain('My Blog');
    expect(parsed.system).toContain('You are a pirate.');
    const siteIdx = parsed.system.indexOf('My Blog');
    const pirateIdx = parsed.system.indexOf('You are a pirate.');
    expect(siteIdx).toBeLessThan(pirateIdx);
  });

  it('falls back to fileScanner when index has no structure', async () => {
    setupHttpSequence([
      { status: 200, body: JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }) },
      { status: 200, body: JSON.stringify({ response: 'Scanned answer' }) },
    ]);

    const result = await askOllamaHandler.execute(
      { prompt: 'What theme is active?', site: 'My Blog' },
      services,
    );

    expect(result.isError).toBeUndefined();
    expect(services.fileScanner.scan).toHaveBeenCalledWith('/tmp/myblog');
  });
});

describe('list_ollama_models handler', () => {
  let indexRegistry: IndexRegistry;
  let services: NexusServices;

  beforeEach(async () => {
    await resetOllamaState();
    indexRegistry = new IndexRegistry(createMockStorage());
    services = createMockServices(indexRegistry);
  });

  it('has correct definition', () => {
    expect(listOllamaModelsHandler.definition.name).toBe('list_ollama_models');
  });

  it('formats model list with hardware recommendation', async () => {
    setupHttpMock(200, JSON.stringify({
      models: [
        {
          name: 'llama3.2:latest',
          size: 2e9,
          details: { parameter_size: '3B', quantization_level: 'Q4_0', family: 'llama' },
        },
      ],
    }));

    const result = await listOllamaModelsHandler.execute({}, services);
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain('llama3.2:latest');
    expect(text).toContain('System Info');
    expect(text).toContain('Total RAM');
    expect(text).toContain('Recommended');
  });

  it('shows suggestion when no models installed', async () => {
    setupHttpMock(200, JSON.stringify({ models: [] }));

    const result = await listOllamaModelsHandler.execute({}, services);

    const text = result.content[0].text;
    expect(text).toContain('No Ollama models installed');
    expect(text).toContain('ollama pull');
    expect(text).toContain('System Info');
  });

  it('returns error on API failure', async () => {
    setupHttpError('ECONNREFUSED');

    const result = await listOllamaModelsHandler.execute({}, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list Ollama models');
  });
});
