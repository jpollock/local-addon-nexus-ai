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

/**
 * D18 — post_count_by_type listed only 'post' while the L3 index held seven
 * types (cedarvalehealt: 842 documents vs post_count 600). Both the by-type
 * map AND the total undercounted, because both queries defaulted to
 * --post_type=post. wp eval is blocked on the WPE gateway, so the fix is
 * native subcommands: discover types with `wp post-type list`, count each
 * publish-status type, skip the machinery types the extractor also excludes.
 */
it('D18: counts every registered post type, not just post', async () => {
  const siteRow = {
    id: 'site-cpt', name: 'cedarlike', remote_install_id: 'rid-cpt',
    environment: 'production', ssh_last_sync_at: null,
  };
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    exec: jest.fn(),
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pragma_table_info')) return { get: jest.fn().mockReturnValue({ c: 1 }) };
      if (sql.includes('SELECT') && sql.includes('FROM sites')) return { all: jest.fn().mockReturnValue([siteRow]) };
      return { run: jest.fn((...args: unknown[]) => { updates.push({ sql, args }); }), all: jest.fn().mockReturnValue([]), get: jest.fn() };
    }),
  } as any;

  const counts: Record<string, number> = { post: 600, page: 2, provider: 60, condition: 80 };
  const queriedTypes: string[] = [];
  const localServices = {
    isSSHKeyAvailable: jest.fn().mockReturnValue(true),
    remoteWpCliRun: jest.fn().mockImplementation(async (_i: string, args: string[]) => {
      if (args[0] === 'post-type' && args[1] === 'list') {
        // Registered types include machinery the index excludes.
        return { success: true, stdout: 'post\npage\nprovider\ncondition\nattachment\nrevision\nwp_font_face\n' };
      }
      const typeArg = args.find(a => a.startsWith('--post_type='));
      if (args[0] === 'post' && args[1] === 'list' && args.includes('--format=count') && typeArg) {
        const t = typeArg.split('=')[1];
        queriedTypes.push(t);
        return { success: true, stdout: String(counts[t] ?? 0) };
      }
      return { success: false, stdout: null };
    }),
  } as any;

  const scheduler = new WpeRefreshScheduler({
    graphService: makeMockGraphService(db),
    localServices,
    logger: defaultLogger,
    intervalMs: 3600_000,
  } as any);
  await (scheduler as any).refreshInstall('cedarlike', 'site-cpt');

  // Machinery types are never even queried — same exclusion set as the index.
  expect(queriedTypes).not.toContain('attachment');
  expect(queriedTypes).not.toContain('revision');
  expect(queriedTypes).not.toContain('wp_font_face');
  expect(queriedTypes.sort()).toEqual(['condition', 'page', 'post', 'provider']);

  const update = updates.find(u => u.sql.includes('post_count_by_type'));
  expect(update).toBeDefined();
  const flat = update!.args.flat() as unknown[];
  expect(flat).toContain(742); // 600+2+60+80 — the true total
  const byTypeJson = flat.find(a => typeof a === 'string' && (a as string).includes('provider')) as string;
  expect(JSON.parse(byTypeJson)).toEqual({ post: 600, page: 2, provider: 60, condition: 80 });
});

/**
 * D15 — installs on a confirmed gateway-less account are stated once and
 * skipped, not attempted 73 times per cycle.
 */
it('D15: skips installs on accounts with no SSH gateway, counted and named once', async () => {
  const rows = [
    { id: 's-1', name: 'jpmeautoscale', remote_install_id: 'r1', ssh_last_sync_at: null, account_id: 'acct-auto', environment: 'production' },
    { id: 's-2', name: 'cedarvalehealt', remote_install_id: 'r2', ssh_last_sync_at: null, account_id: 'acct-ok', environment: 'production' },
  ];
  const db = {
    exec: jest.fn(),
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('pragma_table_info')) return { get: jest.fn().mockReturnValue({ c: 1 }) };
      if (sql.includes("ssh_gateway = 'unavailable'")) {
        return { all: jest.fn().mockReturnValue([{ id: 'acct-auto', name: 'esm5z2bl7u8vqk', nickname: 'AutoscaleAlpha' }]) };
      }
      if (sql.includes('SELECT') && sql.includes('FROM sites')) return { all: jest.fn().mockReturnValue(rows) };
      return { run: jest.fn(), all: jest.fn().mockReturnValue([]), get: jest.fn() };
    }),
  } as any;
  const attempted: string[] = [];
  const localServices = {
    isSSHKeyAvailable: jest.fn().mockReturnValue(true),
    remoteWpCliRun: jest.fn().mockImplementation(async (installName: string) => {
      attempted.push(installName);
      return { success: false, stdout: null };
    }),
  } as any;

  const scheduler = new WpeRefreshScheduler({
    graphService: makeMockGraphService(db),
    localServices,
    logger: defaultLogger,
    intervalMs: 3600_000,
  } as any);
  const result = await (scheduler as any).runNow();

  expect(attempted).not.toContain('jpmeautoscale'); // never dialled
  expect(result.skipped).toBeGreaterThanOrEqual(1);
  const said = defaultLogger.info.mock.calls.flat().join(' ');
  expect(said).toContain('AutoscaleAlpha');
  expect(said).toMatch(/no SSH gateway/i);
});
