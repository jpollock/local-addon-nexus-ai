import { WpeRefreshScheduler } from '../../../src/main/startup/WpeRefreshScheduler';

/**
 * Minimal mock db — handles column existence checks, the sites SELECT, and the UPDATE.
 */
function makeMockDb(siteRows: any[] = []) {
  return {
    exec: jest.fn(),
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pragma_table_info')) {
        // Columns already exist — skip ALTER TABLE
        return { get: jest.fn().mockReturnValue({ c: 1 }) };
      }
      if (sql.includes('SELECT') && sql.includes('FROM sites')) {
        return { all: jest.fn().mockReturnValue(siteRows) };
      }
      // UPDATE sites ... and any other statement
      return { run: jest.fn(), all: jest.fn().mockReturnValue([]), get: jest.fn() };
    }),
  } as any;
}

/**
 * Minimal mock for LocalServicesBridge — SSH available, all WP-CLI calls fail gracefully.
 */
function makeMockLocalServices(sshAvailable = true) {
  return {
    isSSHKeyAvailable: jest.fn().mockReturnValue(sshAvailable),
    remoteWpCliRun: jest.fn().mockResolvedValue({ success: false, stdout: null }),
  } as any;
}

/**
 * Minimal mock for GraphService.
 */
function makeMockGraphService(db: any) {
  return {
    getDb: jest.fn().mockReturnValue(db),
    deletePlugins: jest.fn().mockResolvedValue(undefined),
    deleteThemes: jest.fn().mockResolvedValue(undefined),
    upsertPlugin: jest.fn().mockResolvedValue(undefined),
    upsertTheme: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const defaultLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

it('emits wpe:sync.completed after a successful install refresh', async () => {
  const siteRow = {
    id: 'site-abc',
    name: 'myinstall',
    remote_install_id: 'rid-123',
    ssh_last_sync_at: null, // stale — will be refreshed
    account_id: null,
  };

  const db = makeMockDb([siteRow]);
  const mockGraphService = makeMockGraphService(db);
  const mockLocalServices = makeMockLocalServices(true);
  const publishMock = jest.fn();

  const scheduler = new WpeRefreshScheduler({
    graphService: mockGraphService,
    localServices: mockLocalServices,
    agentEventBus: { publish: publishMock } as any,
    logger: defaultLogger,
  });

  await scheduler.runNow();

  expect(publishMock).toHaveBeenCalledWith(
    expect.objectContaining({
      key: 'wpe:sync.completed',
      namespace: 'wpe',
      type: 'sync.completed',
      siteId: 'site-abc',
      payload: expect.objectContaining({
        installName: 'myinstall',
        installId: 'site-abc',
        siteId: 'site-abc',
      }),
    })
  );
});

it('does not emit wpe:sync.completed when no agentEventBus is provided', async () => {
  const siteRow = {
    id: 'site-abc',
    name: 'myinstall',
    remote_install_id: 'rid-123',
    ssh_last_sync_at: null,
    account_id: null,
  };

  const db = makeMockDb([siteRow]);
  const mockGraphService = makeMockGraphService(db);
  const mockLocalServices = makeMockLocalServices(true);

  const scheduler = new WpeRefreshScheduler({
    graphService: mockGraphService,
    localServices: mockLocalServices,
    // no agentEventBus
    logger: defaultLogger,
  });

  // Should not throw — optional chaining guards the publish call
  await expect(scheduler.runNow()).resolves.not.toThrow();
});

it('skips refresh and emits nothing when SSH is not available', async () => {
  const db = makeMockDb([]);
  const mockGraphService = makeMockGraphService(db);
  const mockLocalServices = makeMockLocalServices(false); // SSH unavailable
  const publishMock = jest.fn();

  const scheduler = new WpeRefreshScheduler({
    graphService: mockGraphService,
    localServices: mockLocalServices,
    agentEventBus: { publish: publishMock } as any,
    logger: defaultLogger,
  });

  await scheduler.runNow();

  expect(publishMock).not.toHaveBeenCalled();
});
