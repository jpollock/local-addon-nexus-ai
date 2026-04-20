/**
 * Unit tests for src/main/ipc/handlers/bulk.ts
 *
 * Verifies that registerBulkHandlers correctly registers IPC channels
 * and that each handler calls bulkOpManager with the right arguments.
 */
import { ipcMain } from 'electron';
import { registerBulkHandlers, BulkHandlerContext } from '../../../src/main/ipc/handlers/bulk';
import { IPC_CHANNELS } from '../../../src/common/constants';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

// Valid bulk operation ID matching the schema: ^bulk-\d+-[a-z0-9]+$
const VALID_OP_ID = 'bulk-1234567890-abc123';

function createMockBulkOpManager(overrides?: any) {
  return {
    execute: jest.fn().mockReturnValue(VALID_OP_ID),
    getStatus: jest.fn().mockReturnValue({ status: 'running', progress: { completed: 0, total: 1, errors: [] } }),
    cancel: jest.fn().mockReturnValue(true),
    listAll: jest.fn().mockReturnValue([]),
    ...overrides,
  };
}

function createMockAuditLogger() {
  return {
    log: jest.fn(),
    logSuccess: jest.fn(),
    logFailure: jest.fn(),
  };
}

function createMockDeps(siteIds = ['site-1', 'site-2'], overrides?: any): any {
  const sites = Object.fromEntries(siteIds.map((id) => [id, { id, name: `Site ${id}` }]));
  return {
    siteData: {
      getSites: jest.fn().mockReturnValue(sites),
      getSite: jest.fn().mockImplementation((id: string) => sites[id] ?? null),
    },
    localServicesBridge: {
      getAllSiteStatuses: jest.fn().mockReturnValue(
        Object.fromEntries(siteIds.map((id) => [id, 'running']))
      ),
    },
    registryStorage: {
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
    },
    localLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    nexusServices: null,
    ...overrides,
  };
}

function createCtx(overrides?: any): BulkHandlerContext {
  return {
    bulkOpManager: createMockBulkOpManager(overrides?.bulkOpManager),
    auditLogger: createMockAuditLogger() as any,
    buildSiteNames: jest.fn().mockReturnValue({}),
    ...overrides,
  };
}

/** Extract the handler function registered for a given channel. */
function captureHandler(channel: string): (...args: any[]) => any {
  const calls = (ipcMain.handle as jest.Mock).mock.calls;
  const found = calls.find(([ch]: [string]) => ch === channel);
  if (!found) throw new Error(`No handler registered for ${channel}`);
  return found[1];
}

// ---------------------------------------------------------------------------

describe('registerBulkHandlers', () => {
  beforeEach(() => {
    (ipcMain.handle as jest.Mock).mockClear();
    (ipcMain.removeHandler as jest.Mock).mockClear();
  });

  // 1. Core channel registration
  it('registers BULK_EXECUTE handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.BULK_EXECUTE);
  });

  it('registers BULK_STATUS handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.BULK_STATUS);
  });

  it('registers BULK_CANCEL handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.BULK_CANCEL);
  });

  it('registers BULK_LIST handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.BULK_LIST);
  });

  it('registers SETUP_AI_FLEET handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.SETUP_AI_FLEET);
  });

  it('registers INDEX_ALL_FLEET handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.INDEX_ALL_FLEET);
  });

  it('registers SETUP_AI_ALL_AUTO handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.SETUP_AI_ALL_AUTO);
  });

  it('registers INDEX_ALL_AUTO handler', () => {
    registerBulkHandlers(createMockDeps(), createCtx());
    const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain(IPC_CHANNELS.INDEX_ALL_AUTO);
  });

  // 2. BULK_STATUS returns status from manager
  it('BULK_STATUS returns status for an existing operation', async () => {
    const ctx = createCtx();
    registerBulkHandlers(createMockDeps(), ctx);
    const handler = captureHandler(IPC_CHANNELS.BULK_STATUS);
    const result = await handler(null, VALID_OP_ID);
    expect(ctx.bulkOpManager.getStatus).toHaveBeenCalledWith(VALID_OP_ID);
    expect(result.success).toBe(true);
  });

  // 3. BULK_STATUS returns error when operation not found
  it('BULK_STATUS returns error when operation not found', async () => {
    const ctx = createCtx({ bulkOpManager: { ...createMockBulkOpManager(), getStatus: jest.fn().mockReturnValue(null) } });
    registerBulkHandlers(createMockDeps(), ctx);
    const handler = captureHandler(IPC_CHANNELS.BULK_STATUS);
    const result = await handler(null, VALID_OP_ID);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Operation not found');
  });

  // 4. BULK_CANCEL returns success=true when cancel succeeds
  it('BULK_CANCEL returns success when cancellation works', async () => {
    const ctx = createCtx();
    registerBulkHandlers(createMockDeps(), ctx);
    const handler = captureHandler(IPC_CHANNELS.BULK_CANCEL);
    const result = await handler(null, VALID_OP_ID);
    expect(result.success).toBe(true);
  });

  // 5. BULK_LIST returns all operations
  it('BULK_LIST returns list from manager', async () => {
    const ops = [{ id: 'op-1' }, { id: 'op-2' }];
    const ctx = createCtx({ bulkOpManager: { ...createMockBulkOpManager(), listAll: jest.fn().mockReturnValue(ops) } });
    registerBulkHandlers(createMockDeps(), ctx);
    const handler = captureHandler(IPC_CHANNELS.BULK_LIST);
    const result = await handler();
    expect(result.success).toBe(true);
    expect(result.operations).toEqual(ops);
  });

  // 6. SETUP_AI_FLEET creates operation for running sites
  it('SETUP_AI_FLEET calls execute with running site IDs', async () => {
    const ctx = createCtx();
    registerBulkHandlers(createMockDeps(['site-1', 'site-2']), ctx);
    const handler = captureHandler(IPC_CHANNELS.SETUP_AI_FLEET);
    const result = await handler(null, undefined);
    expect(ctx.bulkOpManager.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setup-ai' })
    );
    expect(result.success).toBe(true);
    expect(result.opId).toBe(VALID_OP_ID);
  });

  // 7. SETUP_AI_FLEET returns no-op message when no running sites
  it('SETUP_AI_FLEET returns no-op when no running sites', async () => {
    const deps = createMockDeps(['site-1']);
    deps.localServicesBridge.getAllSiteStatuses = jest.fn().mockReturnValue({ 'site-1': 'halted' });
    const ctx = createCtx();
    registerBulkHandlers(deps, ctx);
    const handler = captureHandler(IPC_CHANNELS.SETUP_AI_FLEET);
    const result = await handler(null, undefined);
    expect(ctx.bulkOpManager.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.opId).toBeNull();
  });

  // 8. SETUP_AI_ALL_AUTO includes ALL sites (even halted)
  it('SETUP_AI_ALL_AUTO includes halted sites', async () => {
    const deps = createMockDeps(['site-1', 'site-2']);
    deps.localServicesBridge.getAllSiteStatuses = jest.fn().mockReturnValue({ 'site-1': 'running', 'site-2': 'halted' });
    const ctx = createCtx();
    registerBulkHandlers(deps, ctx);
    const handler = captureHandler(IPC_CHANNELS.SETUP_AI_ALL_AUTO);
    await handler(null);
    expect(ctx.bulkOpManager.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setup-ai', options: { autoStartStop: true } })
    );
    // Both sites should be included
    const call = (ctx.bulkOpManager.execute as jest.Mock).mock.calls[0][0];
    expect(call.siteIds).toHaveLength(2);
  });

  // 9. INDEX_ALL_AUTO includes all sites with autoStartStop
  it('INDEX_ALL_AUTO runs with autoStartStop option', async () => {
    const ctx = createCtx();
    registerBulkHandlers(createMockDeps(['s1', 's2', 's3']), ctx);
    const handler = captureHandler(IPC_CHANNELS.INDEX_ALL_AUTO);
    await handler(null);
    expect(ctx.bulkOpManager.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reindex', options: { autoStartStop: true } })
    );
  });

  // 10. SYNC_GRAPH_ALL error returns failure response
  it('SYNC_GRAPH_ALL returns error when no sites exist', async () => {
    const deps = createMockDeps([]);
    const ctx = createCtx();
    registerBulkHandlers(deps, ctx);
    const handler = captureHandler(IPC_CHANNELS.SYNC_GRAPH_ALL);
    const result = await handler(null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No sites');
  });
});
