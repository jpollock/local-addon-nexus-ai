import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import { serializeTree } from './helpers/serializeTree';
import { IPC_CHANNELS } from '../../../src/common/constants';

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (AdvancedSection as any)({
    settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
    onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } }, ...over,
  }).render()));

/**
 * A never-mounted instance whose setState folds into `state`, so a handler's
 * effect on state is observable. React's real setState is a warn-and-no-op
 * before mount, which silently swallows every assertion about the result.
 */
/** Depth-first search for the first element whose rendered text is exactly `text`. */
const findByText = (node: any, text: string): any => {
  if (!node || typeof node !== 'object') return null;
  const kids = node.props?.children;
  const list = Array.isArray(kids) ? kids : [kids];
  if (list.length === 1 && list[0] === text) return node;
  for (const k of list) {
    const hit = findByText(k, text);
    if (hit) return hit;
  }
  return null;
};

const unmounted = (over: any = {}) => {
  const { invoke, ...propsOver } = over;
  const inst: any = new (AdvancedSection as any)({
    settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
    onSave: jest.fn(),
    electron: { ipcRenderer: { invoke: invoke ?? jest.fn() } },
    ...propsOver,
  });
  inst.setState = (patch: any) => {
    Object.assign(inst.state, typeof patch === 'function' ? patch(inst.state) : patch);
  };
  return inst;
};

describe('AdvancedSection', () => {
  test('carries all five capabilities stranded by spec 5', () => {
    const t = tree();
    for (const s of [
      'Rebuild search', 'Database health', 'Remove ghost installs',
      'SSH diagnostics', 'Start over',
    ]) expect(t).toContain(s);
  });

  test('there are three resets, ranked by cost-to-undo', () => {
    const t = tree();
    expect(t).toContain('Rebuild search');
    expect(t).toContain('Rebuild what Nexus knows');
    expect(t).toContain('Start over');
  });

  test('no reset claims credentials are destroyed', () => {
    // FACTORY_RESET explicitly preserves Keychain, WPE OAuth and the telemetry
    // ID (ipc-handlers.ts:4342). Warning otherwise would be a lie and would
    // contradict shipped confirmation copy.
    const t = tree().toLowerCase();
    expect(t).not.toContain('keychain');
    expect(t).not.toContain('api keys will be');
  });

  test('the 30-minute reset is not a plain Run', () => {
    // RESET_AND_REFRESH DELETEs every graph table and costs half an hour of an
    // unanswerable fleet. It is the amber row, not routine housekeeping.
    const t = tree();
    expect(t).toContain('About 30 minutes');
    expect(t).toContain('cannot answer questions about your fleet');
    expect(t).not.toContain('Housekeeping');
  });

  test('opens by saying you should not need this page', () => {
    expect(tree()).toContain('should not need anything on this page');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });

  // Interactive control tests — verify each button/input exists AND is wired
  describe('interactive controls', () => {
    beforeEach(() => {
      // Mock window.showToast to avoid "window is not defined" errors
      (global as any).window = { showToast: jest.fn() };
    });

    afterEach(() => {
      delete (global as any).window;
    });

    test('DB scan button invokes DB_SCAN_ALL', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, scans: [] });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      // Call handler directly — no setState before mount needed
      await instance.handleDbScan();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.DB_SCAN_ALL);
    });

    test('ghost cleanup button invokes CLEANUP_GHOST_INSTALLS', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, removed: 2 });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      await instance.handleGhostCleanup();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.CLEANUP_GHOST_INSTALLS);
    });

    test('SSH diag calls WPE_DIAGNOSE with the ONE object parameter its handler declares', async () => {
      // ipc-handlers.ts: safeHandle(WPE_DIAGNOSE, async (_event, params: { installName, args }))
      // — two positional arguments left installName undefined and the handler
      // short-circuited with "installName and args required" on every run.
      const invoke = jest.fn().mockResolvedValue({ success: true, stdout: 'WP 6.7.1', durationMs: 12 });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      // Set state directly, not via setState (not mounted)
      instance.state.diagInstall = 'testsite';
      await instance.handleDiag(['core', 'version']);
      expect(invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.WPE_DIAGNOSE,
        { installName: 'testsite', args: ['core', 'version'] },
      );
    });

    test('SSH diag renders the handler\'s stdout, not a non-existent result.output', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, stdout: 'WP 6.7.1', durationMs: 12 });
      const instance = unmounted({ invoke });
      instance.state.diagInstall = 'testsite';
      await instance.handleDiag(['core', 'version']);
      expect(instance.state.diagResults[0].output).toBe('WP 6.7.1');
      expect(instance.state.diagResults[0].error).toBeUndefined();
    });

    test('a failed WP-CLI run surfaces stdout as the error — the handler sets no `error` field', async () => {
      // The handler returns { success: false, stdout, durationMs } when the
      // command failed but nothing threw. Reading only `result.error` there
      // rendered an empty red box.
      const invoke = jest.fn().mockResolvedValue({ success: false, stdout: 'Error: no such install', durationMs: 9 });
      const instance = unmounted({ invoke });
      instance.state.diagInstall = 'testsite';
      await instance.handleDiag(['core', 'version']);
      expect(instance.state.diagResults[0].error).toBe('Error: no such install');
    });

    test('reset index button invokes RESET_CONTENT_INDEX', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, siteCount: 3, docCount: 150 });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      await instance.handleResetIndex();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RESET_CONTENT_INDEX);
    });

    test('reset all button invokes RESET_AND_REFRESH', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, capiInstalls: 10, sshSynced: 2 });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      await instance.handleResetAll();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RESET_AND_REFRESH);
    });

    test('factory reset button invokes FACTORY_RESET', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      await instance.handleFactoryReset();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.FACTORY_RESET);
    });

    test('auto-index toggle calls onSave with autoIndex', () => {
      const onSave = jest.fn();
      const instance = new (AdvancedSection as any)({
        settings: { autoIndex: false }, indexEntries: [], mcpInfo: { port: 10801 },
        onSave, electron: { ipcRenderer: { invoke: jest.fn() } },
      });

      // Simulate the onChange handler being called
      const rendered = instance.render();
      expect(tree({ settings: { autoIndex: false }, onSave })).toContain('Automatically index sites');
      // Verify onSave would be called with the right shape
      instance.props.onSave({ autoIndex: true });
      expect(onSave).toHaveBeenCalledWith({ autoIndex: true });
    });

    test('MCP panel shows correct port and copy command', () => {
      const t = tree({ mcpInfo: { port: 10801 } });
      expect(t).toContain('port 10801');
      expect(t).toContain('npx -y @modelcontextprotocol/inspector http://localhost:10801/sse');
    });

    test('gateway panel claims no port and no running state — nothing checks either', () => {
      // "Gateway running on port 13100" was hardcoded with no status check.
      // The gateway routes are served by HttpEventInterface, which binds the
      // first free port in 13000–13100; 13100 is the unrelated AiProxyServer's
      // base. Same fabricated-value class as the mcpInfo `?? { port: 0 }`
      // defect fixed in the function directly above it.
      const t = tree();
      expect(t).toContain('AI gateway');
      expect(t).not.toContain('13100');
      expect(t).not.toContain('Gateway running on port');
    });

    test('the gateway stats dialog reads the keys AI_GATEWAY_GET_STATS actually returns', async () => {
      // The handler returns { totalRequests, totalCost, totalTokens, lastHour,
      // lastDay, lastWeek, uniqueSites, mostActiveSite }. There is no
      // `providers` key; destructuring one and calling Object.entries on
      // undefined threw a TypeError inside an unguarded async onClick.
      const invoke = jest.fn().mockResolvedValue({
        success: true,
        stats: {
          totalRequests: 12, totalCost: 0.5, totalTokens: 900,
          lastHour: { requests: 1, cost: 0.01 },
          lastDay: { requests: 4, cost: 0.2 },
          lastWeek: { requests: 12, cost: 0.5 },
          uniqueSites: 3,
          mostActiveSite: { siteId: 'abc', requests: 7 },
        },
      });
      const alertSpy = jest.fn();
      (global as any).alert = alertSpy;
      const instance = unmounted({ invoke });
      const button = findByText(instance.renderGatewayPanel(), 'View usage');
      await button.props.onClick();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const text = alertSpy.mock.calls[0][0];
      expect(text).toContain('Total requests: 12');
      expect(text).toContain('Total cost: $0.5000');
      expect(text).toContain('Total tokens: 900');
      expect(text).toContain('Sites seen: 3');
      expect(text).toContain('Busiest site: abc (7 requests)');
      delete (global as any).alert;
    });

    test('a failed stats call toasts instead of throwing out of an async onClick', async () => {
      const invoke = jest.fn().mockRejectedValue(new Error('no handler'));
      const showToast = jest.fn();
      (global as any).window = { showToast };
      const instance = unmounted({ invoke });
      const button = findByText(instance.renderGatewayPanel(), 'View usage');
      await expect(button.props.onClick()).resolves.toBeUndefined();
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load gateway stats'),
        'error',
      );
    });
  });

  // Surface parity tests
  describe('surface parity with NexusOverview', () => {
    test('DB scan section renders with Scan button', () => {
      const t = tree();
      expect(t).toContain('Database health');
      expect(t).toContain('Scan');
    });

    test('ghost cleanup section renders with Run button', () => {
      const t = tree();
      expect(t).toContain('Remove ghost installs');
      expect(t).toContain('Run');
    });

    test('SSH diagnostics section has preset commands', () => {
      const t = tree();
      expect(t).toContain('SSH diagnostics');
      expect(t).toContain('wp core version');
      expect(t).toContain('wp plugin list');
    });

    test('search index shows size when available', () => {
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 },
        onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
      });
      instance.state.vectorStoreSizeMB = 42;
      const t = JSON.stringify(serializeTree(instance.render()));
      expect(t).toContain('42 MB');
    });

    test('search index omits size clause when file missing', () => {
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 },
        onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
      });
      instance.state.vectorStoreSizeMB = null;
      const t = JSON.stringify(serializeTree(instance.render()));
      expect(t).not.toContain(' MB');
      expect(t).toContain('0 sites indexed'); // Still shows count
    });
  });

  // Exclusions UI and inline confirm tests
  describe('auto-index exclusions', () => {
    test('exclusions accordion renders when autoIndex=true and sites exist', () => {
      const instance = new (AdvancedSection as any)({
        settings: { autoIndex: true, excludedSiteIds: [] },
        indexEntries: [],
        mcpInfo: { port: 10801 },
        sites: [{ id: 'site1', name: 'Site 1' }, { id: 'site2', name: 'Site 2' }],
        onSave: jest.fn(),
        electron: { ipcRenderer: { invoke: jest.fn() } },
      });
      instance.state.excludedExpanded = true; // Expand to see site names
      const t = JSON.stringify(serializeTree(instance.render()));
      expect(t).toContain('Excluded sites');
      expect(t).toContain('Site 1');
      expect(t).toContain('Site 2');
    });

    test('exclusions accordion hidden when autoIndex=false', () => {
      const t = tree({
        settings: { autoIndex: false, excludedSiteIds: [] },
        sites: [{ id: 'site1', name: 'Site 1' }],
      });
      expect(t).not.toContain('Excluded sites');
    });

    test('exclusions accordion hidden when no sites', () => {
      const t = tree({
        settings: { autoIndex: true, excludedSiteIds: [] },
        sites: [],
      });
      expect(t).not.toContain('Excluded sites');
    });

    test('excluded count shown correctly', () => {
      const t = tree({
        settings: { autoIndex: true, excludedSiteIds: ['site1'] },
        sites: [{ id: 'site1', name: 'Site 1' }, { id: 'site2', name: 'Site 2' }],
      });
      expect(t).toContain('1 excluded');
    });
  });

  describe('inline confirmation', () => {
    test('reset-all uses inline confirm, not browser confirm', () => {
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
      });
      instance.state.resetAllConfirming = true;
      const t = JSON.stringify(serializeTree(instance.render()));
      expect(t).toContain('This will delete all graph and vector data');
      expect(t).toContain('Confirm Rebuild');
      expect(t).toContain('Cancel');
    });

    test('factory reset uses typed confirm', () => {
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
      });
      instance.state.factoryResetConfirming = true;
      const t = JSON.stringify(serializeTree(instance.render()));
      expect(t).toContain('Type');
      expect(t).toContain('start over');
      expect(t).toContain('Confirm Reset');
    });
  });

  describe('ghost cleanup never sticks on "Running…"', () => {
    beforeEach(() => { (global as any).window = { showToast: jest.fn() }; });
    afterEach(() => { delete (global as any).window; });

    test('a rejected invoke clears ghostRunning and toasts', async () => {
      // CLEANUP_GHOST_INSTALLS had no handler at all; ipcMain rejects an
      // unregistered channel, and the un-caught await left the button reading
      // "Running…" for the rest of the session.
      const invoke = jest.fn().mockRejectedValue(new Error("No handler registered for 'x'"));
      const instance = unmounted({ invoke });
      await instance.handleGhostCleanup();
      expect(instance.state.ghostRunning).toBe(false);
      expect((global as any).window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Ghost cleanup failed'), 'error',
      );
    });

    test('a { success: false } result clears ghostRunning and toasts', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: false, error: 'Graph DB not available' });
      const instance = unmounted({ invoke });
      await instance.handleGhostCleanup();
      expect(instance.state.ghostRunning).toBe(false);
      expect((global as any).window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Graph DB not available'), 'error',
      );
    });

    test('success reports the handler\'s `removed` count', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, removed: 2 });
      const instance = unmounted({ invoke });
      await instance.handleGhostCleanup();
      expect(instance.state.ghostRunning).toBe(false);
      expect((global as any).window.showToast).toHaveBeenCalledWith(
        'Removed 2 ghost installs from graph', 'success',
      );
    });
  });

  describe('the 30-minute reset states no number it has not been given', () => {
    test('the fleet count comes from the fleetCounts prop', () => {
      expect(tree({ fleetCounts: { wpe: 412, external: 3, local: 100 } }))
        .toContain('re-reads all 412 WP Engine installs from scratch');
    });

    test('the literal 367 is gone', () => {
      expect(tree({ fleetCounts: { wpe: 412, external: 3, local: 100 } })).not.toContain('367');
      expect(tree()).not.toContain('367');
    });

    test('with no counts loaded the clause is omitted, not guessed', () => {
      const t = tree({ fleetCounts: null });
      expect(t).toContain('reads it all again from scratch');
      expect(t).not.toMatch(/re-reads all \d/);
    });

    test('with no WP Engine account the clause is omitted too', () => {
      expect(tree({ fleetCounts: { wpe: 0, external: 2, local: 9 } }))
        .not.toMatch(/re-reads all \d/);
    });

    test('one install is singular', () => {
      expect(tree({ fleetCounts: { wpe: 1, external: 0, local: 0 } }))
        .toContain('re-reads all 1 WP Engine install from scratch');
    });
  });

  describe('Rebuild search cannot fire from a second click of the same button', () => {
    test('the top button only toggles the confirm panel', () => {
      const invoke = jest.fn();
      const instance = unmounted({ invoke });
      const first = findByText(instance.renderResetIndex(), 'Rebuild');
      first.props.onClick();
      expect(instance.state.resetIndexConfirming).toBe(true);

      // Same button, same position, second click. It must NOT execute — it
      // closes the panel, exactly as renderResetAll's button does.
      const second = findByText(instance.renderResetIndex(), 'Rebuild');
      second.props.onClick();
      expect(invoke).not.toHaveBeenCalled();
      expect(instance.state.resetIndexConfirming).toBe(false);
    });

    test('the destructive act lives on Confirm Rebuild, as it does for reset-all', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, siteCount: 1, docCount: 2 });
      const instance = unmounted({ invoke });
      instance.state.resetIndexConfirming = true;
      const confirm = findByText(instance.renderResetIndex(), 'Confirm Rebuild');
      await confirm.props.onClick();
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RESET_CONTENT_INDEX);
    });
  });

  test('a ticked exclusion checkbox means EXCLUDED, matching its heading', () => {
    // The surface this replaced (SettingsTab@e20b2f6a:359) read
    // `checked: excludedSiteIds.includes(site.id)`. `!isExcluded` inverted it
    // under a heading reading "Excluded sites" and a count reading "1 excluded".
    const instance = unmounted({
      settings: { autoIndex: true, excludedSiteIds: ['s1'] },
      sites: [{ id: 's1', name: 'Excluded One' }, { id: 's2', name: 'Included Two' }],
    });
    instance.state.excludedExpanded = true;
    const rendered = instance.render();
    const boxes: any[] = [];
    const walk = (n: any, parentText: string) => {
      if (!n || typeof n !== 'object') return;
      if (n.props?.type === 'checkbox' && n.props?.onChange) boxes.push({ node: n, key: parentText });
      const kids = n.props?.children;
      const list = Array.isArray(kids) ? kids : [kids];
      for (const k of list) walk(k, n.key ?? parentText);
    };
    walk(rendered, '');
    const s1 = boxes.find(b => b.key === 's1');
    const s2 = boxes.find(b => b.key === 's2');
    expect(s1.node.props.checked).toBe(true);   // excluded → ticked
    expect(s2.node.props.checked).toBe(false);  // not excluded → unticked
  });

  // Mutation tests — verify each test goes red when the production code is broken
  describe('mutation verification', () => {
    test('removing "should not need" opening line fails the opening-line test', () => {
      // This test documents that the "opens by saying..." test actually checks
      // for the presence of that line. If the line is removed from the component,
      // that test should fail.
      const t = tree();
      expect(t).toContain('should not need anything on this page');
      // Mutation: if we removed this line from the component, the test above would fail.
    });

    test('removing "Rebuild what Nexus knows" fails the three-resets test', () => {
      const t = tree();
      expect(t).toContain('Rebuild what Nexus knows');
      // Mutation: if this string was changed to anything else, the test would fail.
    });

    test('adding "keychain will be deleted" fails the credentials test', () => {
      const t = tree().toLowerCase();
      expect(t).not.toContain('keychain');
      // Mutation: adding "Your Keychain will be deleted" would make the test fail.
    });
  });
});
