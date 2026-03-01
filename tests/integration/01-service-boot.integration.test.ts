import * as path from 'path';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { IndexRegistry } from '../../src/main/content/IndexRegistry';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { registerContentTools } from '../../src/main/mcp/modules/content/index';
import { registerSiteContextTools } from '../../src/main/mcp/modules/site-context/index';
import { registerOllamaTools } from '../../src/main/mcp/modules/ollama/index';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';
import { registerSiteManagementTools } from '../../src/main/mcp/modules/site-management/index';
import { registerWpCliTools } from '../../src/main/mcp/modules/wp-cli/index';
import { registerWpeTools } from '../../src/main/mcp/modules/wpe/index';
import { createLocalServicesBridge } from '../../src/main/mcp/local-services-bridge';
import { TIER_OVERRIDES } from '../../src/main/mcp/safety';
import { VECTOR_DIMENSIONS } from '../../src/common/constants';
import * as fs from 'fs';
import * as os from 'os';

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models', 'all-MiniLM-L6-v2-quantized');

describe('Service Initialization', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-integration-boot-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('EmbeddingService loads ONNX model and reports ready', async () => {
    const service = new EmbeddingService(MODELS_DIR);
    await service.initialize();
    expect(service.isReady()).toBe(true);
  }, 60000);

  test('EmbeddingService.embed() returns 384-dimension vector', async () => {
    const service = new EmbeddingService(MODELS_DIR);
    await service.initialize();

    const result = await service.embed('test input text');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(VECTOR_DIMENSIONS);

    // Values should be finite numbers
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  }, 60000);

  test('EmbeddingService.embedBatch() handles multiple texts', async () => {
    const service = new EmbeddingService(MODELS_DIR);
    await service.initialize();

    const results = await service.embedBatch([
      'first text',
      'second text',
      'third text',
    ]);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(VECTOR_DIMENSIONS);
    }
  }, 60000);

  test('EmbeddingService rejects embed() before initialize()', async () => {
    const service = new EmbeddingService(MODELS_DIR);
    // Do NOT call initialize()
    await expect(service.embed('test')).rejects.toThrow(
      'EmbeddingService not initialized. Call initialize() first.',
    );
  });

  test('VectorStore initializes and creates db directory', async () => {
    const dbPath = path.join(tmpDir, 'vector-boot-test');
    const store = new VectorStore(dbPath);
    await store.initialize();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  test('VectorStore rejects operations before initialize()', async () => {
    const store = new VectorStore(path.join(tmpDir, 'uninit'));
    // Do NOT call initialize()
    await expect(store.listSites()).rejects.toThrow(
      'VectorStore not initialized. Call initialize() first.',
    );
  });

  test('ToolRegistry registers all 46 tools without errors', () => {
    const registry = new ToolRegistry();
    registerContentTools(registry);
    registerSiteContextTools(registry);
    registerOllamaTools(registry);
    registerFleetTools(registry);
    registerSiteManagementTools(registry);
    registerWpCliTools(registry);
    registerWpeTools(registry);

    const names = registry.allToolNames();
    expect(names.length).toBeGreaterThanOrEqual(46);
  });

  test('IndexRegistry round-trips entries through in-memory storage', () => {
    const store = new Map<string, any>();
    const storage = {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: any) => { store.set(key, value); },
    };
    const registry = new IndexRegistry(storage);

    registry.update('test-site', {
      siteName: 'Test',
      lastIndexed: Date.now(),
      documentCount: 5,
      chunkCount: 8,
      durationMs: 100,
      structure: null,
      state: 'indexed',
    });

    const entry = registry.get('test-site');
    expect(entry).not.toBeNull();
    expect(entry!.siteName).toBe('Test');
    expect(entry!.documentCount).toBe(5);
    expect(entry!.state).toBe('indexed');
  });

  test('createLocalServicesBridge with empty container does not crash', () => {
    // This is the EXACT bug from Bug #1.
    // If the bridge eagerly resolves services in the constructor, this test fails.
    const bridge = createLocalServicesBridge({});
    expect(bridge.isCAPIAvailable()).toBe(false);
  });
});
