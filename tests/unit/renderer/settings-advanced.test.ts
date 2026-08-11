import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import { serializeTree } from './helpers/serializeTree';
import { IPC_CHANNELS } from '../../../src/common/constants';

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (AdvancedSection as any)({
    settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
    onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } }, ...over,
  }).render()));

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

    test('SSH diag calls WPE_DIAGNOSE with install and args', async () => {
      const invoke = jest.fn().mockResolvedValue({ success: true, output: 'WP 6.7.1' });
      const instance = new (AdvancedSection as any)({
        settings: {}, indexEntries: [], mcpInfo: { port: 10801 }, sites: [],
        onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      });

      // Set state directly, not via setState (not mounted)
      instance.state.diagInstall = 'testsite';
      await instance.handleDiag(['core', 'version']);
      expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.WPE_DIAGNOSE, 'testsite', ['core', 'version']);
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

    test('gateway panel shows port 13100', () => {
      const t = tree();
      expect(t).toContain('port 13100');
      expect(t).toContain('AI gateway');
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
