/**
 * Integration tests for WordPress Version IPC handlers
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GraphService } from '../../src/main/events/GraphService';
import { EventProcessor } from '../../src/main/events/EventProcessor';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { IPC_CHANNELS } from '../../src/common/constants';

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models', 'all-MiniLM-L6-v2-quantized');

/**
 * Mock ipcMain that stores handlers we can call manually
 */
class MockIpcMain {
  private handlers: Map<string, Function> = new Map();
  private syncHandlers: Map<string, Function> = new Map();

  handle(channel: string, handler: Function) {
    this.handlers.set(channel, handler);
  }

  on(channel: string, handler: Function) {
    this.syncHandlers.set(channel, handler);
  }

  async invokeHandler(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }

  hasHandler(channel: string): boolean {
    return this.handlers.has(channel) || this.syncHandlers.has(channel);
  }
}

// Mock electron before importing ipc-handlers
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({
  ipcMain: mockIpc,
}));

// NOW import the module that depends on electron
import { registerIpcHandlers, IpcHandlerDeps } from '../../src/main/ipc-handlers';

describe('WordPress Version IPC Handlers', () => {
  let tmpDir: string;
  let graphDbPath: string;
  let vectorDbPath: string;
  let graphService: GraphService;
  let eventProcessor: EventProcessor;
  let vectorStore: VectorStore;
  let embeddingService: EmbeddingService;
  let mockBridge: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ipc-wpver-'));
    graphDbPath = path.join(tmpDir, 'graph.db');
    vectorDbPath = path.join(tmpDir, 'vectors');

    // Initialize services
    graphService = new GraphService(graphDbPath);
    await graphService.initialize();

    vectorStore = new VectorStore(vectorDbPath);
    await vectorStore.initialize();

    embeddingService = new EmbeddingService(MODELS_DIR);
    await embeddingService.initialize();

    eventProcessor = new EventProcessor({
      graphService,
      vectorStore,
      embeddingService,
      logger: console,
    });
    await eventProcessor.initialize();

    // Create mock bridge with wpCli methods
    mockBridge = {
      getAllSiteStatuses: jest.fn(() => ({ '550e8400-e29b-41d4-a716-446655440000': 'running' })),
      isCAPIAvailable: () => false,
      startSite: async () => {},
      stopSite: async () => {},
      getWpVersion: jest.fn(),
      wpCliRun: jest.fn(),
    };

    // Create mock dependencies
    const mockSiteData = {
      getSite: (id: string) => ({ id, name: `Site ${id}`, domain: `${id}.local` }),
      getSites: () => ({}),
    };

    const mockRegistry = {
      listAll: () => [],
      get: () => null,
      update: () => {},
    };

    const mockContentPipeline = {
      indexSite: async () => ({ documentsIndexed: 0, chunksIndexed: 0, durationMs: 0, errors: [] }),
    };

    const mockStorage = {
      get: () => null,
      set: () => {},
    };

    const deps: IpcHandlerDeps = {
      siteData: mockSiteData,
      localServicesBridge: mockBridge as any,
      indexRegistry: mockRegistry as any,
      embeddingService,
      contentPipeline: mockContentPipeline as any,
      vectorStore,
      registryStorage: mockStorage,
      localLogger: console,
      getMcpServer: () => null,
      graphService,
      eventProcessor,
      vectorDbPath,
    };

    // Register handlers
    registerIpcHandlers(deps);
  }, 120000);

  afterAll(async () => {
    await graphService?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET_WP_VERSION', () => {
    test('should return WordPress version when available', async () => {
      mockBridge.getWpVersion.mockResolvedValue('7.0.1');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.GET_WP_VERSION, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
      expect(result.version).toBe('7.0.1');
      expect(mockBridge.getWpVersion).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    });

    test('should return null version when not available', async () => {
      mockBridge.getWpVersion.mockResolvedValue(null);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.GET_WP_VERSION, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
      expect(result.version).toBe(null);
    });

    test('should return error when getWpVersion fails', async () => {
      mockBridge.getWpVersion.mockRejectedValue(new Error('WP-CLI failed'));

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.GET_WP_VERSION, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('WP-CLI failed');
    });

    test('should handle WordPress 6.9.4 version', async () => {
      mockBridge.getWpVersion.mockResolvedValue('6.9.4');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.GET_WP_VERSION, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
      expect(result.version).toBe('6.9.4');
    });
  });

  describe('UPGRADE_WP', () => {
    test('should upgrade WordPress successfully', async () => {
      mockBridge.wpCliRun
        .mockResolvedValueOnce({ stdout: 'Success', success: true }) // core update
        .mockResolvedValueOnce({ stdout: 'Success', success: true }); // update-db
      mockBridge.getWpVersion
        .mockResolvedValueOnce('6.9.4') // Current version
        .mockResolvedValueOnce('7.0.1'); // New version after upgrade

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
      expect(result.version).toBe('7.0.1');

      // Should call core update with version 7.0-beta6
      expect(mockBridge.wpCliRun).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', ['core', 'update', '--version=7.0-beta6', '--force']);

      // Should call update-db
      expect(mockBridge.wpCliRun).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', ['core', 'update-db']);

      // Should get version twice (before and after)
      expect(mockBridge.getWpVersion).toHaveBeenCalledTimes(2);
    });

    test('should return error when core update fails', async () => {
      mockBridge.getWpVersion.mockResolvedValueOnce('6.9.4'); // Current version check
      mockBridge.wpCliRun.mockRejectedValue(new Error('Update failed'));

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });

    test('should return error when core update returns success: false', async () => {
      mockBridge.getWpVersion.mockResolvedValueOnce('6.9.4'); // Current version check
      mockBridge.wpCliRun.mockResolvedValueOnce({
        stdout: 'Error: Download failed.',
        success: false
      });

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Download failed');
    });

    test('should upgrade from 6.9.4 to 7.0.x', async () => {
      // First call succeeds (core update)
      // Second call succeeds (update-db)
      mockBridge.wpCliRun
        .mockResolvedValueOnce({ stdout: 'Success', success: true })
        .mockResolvedValueOnce({ stdout: 'Success', success: true });

      // Return current version then new version
      mockBridge.getWpVersion
        .mockResolvedValueOnce('6.9.4')
        .mockResolvedValueOnce('7.0.1');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
      expect(result.version).toBe('7.0.1');
      expect(mockBridge.wpCliRun).toHaveBeenCalledTimes(2);
      expect(mockBridge.wpCliRun).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', ['core', 'update', '--version=7.0-beta6', '--force']);
    });

    test('should handle update-db failure after core update succeeds', async () => {
      // Core update succeeds, update-db fails
      mockBridge.wpCliRun
        .mockResolvedValueOnce({ stdout: 'Success', success: true })
        .mockRejectedValueOnce(new Error('DB update failed'));

      mockBridge.getWpVersion.mockResolvedValueOnce('6.9.4'); // Current version check

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB update failed');
    });

    test('should return error when site is not running', async () => {
      // Mock site as halted
      mockBridge.getAllSiteStatuses.mockReturnValueOnce({ '550e8400-e29b-41d4-a716-446655440000': 'halted' });

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be running');
      expect(result.error).toContain('halted');

      // Should not attempt to run WP-CLI
      expect(mockBridge.wpCliRun).not.toHaveBeenCalled();
    });

    test('should return error when site status is unknown', async () => {
      // Mock site status as undefined
      mockBridge.getAllSiteStatuses.mockReturnValueOnce({});

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.UPGRADE_WP, '660e8400-e29b-41d4-a716-446655440001');

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be running');

      // Should not attempt to run WP-CLI
      expect(mockBridge.wpCliRun).not.toHaveBeenCalled();
    });
  });

  test('WordPress version IPC channels are registered', () => {
    expect(mockIpc.hasHandler(IPC_CHANNELS.GET_WP_VERSION)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.UPGRADE_WP)).toBe(true);
  });
});
