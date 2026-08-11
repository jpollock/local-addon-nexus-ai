/**
 * Spec 5 kept Operations alive only because deleting it would strand five
 * maintenance actions with nowhere to go. Spec 6a built that destination, so
 * this inverts: the five must now be reachable from Advanced, and Operations
 * must be gone.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import { NexusOverview } from '../../../src/renderer/components/NexusOverview';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src/renderer/components', p), 'utf8');

const mockElectron = {
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue(null),
  },
};

test('Advanced reaches every maintenance action Operations used to hold', () => {
  const advanced = new AdvancedSection({
    settings: { autoIndex: true, excludedSiteIds: [] } as any,
    indexEntries: [],
    mcpInfo: { port: 13100 },
    sites: [],
    onSave: jest.fn(),
    electron: mockElectron,
  });
  const tree = JSON.stringify(advanced.render());

  // The five capabilities that were stranded
  expect(tree).toContain('Start over');
  expect(tree).toContain('Rebuild search');
  expect(tree).toContain('Database health');
  expect(tree).toContain('Remove ghost installs');
  expect(tree).toContain('SSH diagnostics');
});

test('the third reset is reachable too — it was buried inside Housekeeping', () => {
  const advanced = new AdvancedSection({
    settings: { autoIndex: true, excludedSiteIds: [] } as any,
    indexEntries: [],
    mcpInfo: { port: 13100 },
    sites: [],
    onSave: jest.fn(),
    electron: mockElectron,
  });
  const tree = JSON.stringify(advanced.render());
  expect(tree).toContain('Rebuild what Nexus knows');
});

test('Operations is gone from the dashboard', () => {
  const overview = read('NexusOverview.tsx');
  expect(overview).not.toContain('renderOperationsTab');
  expect(overview).not.toContain("case 'operations'");
});

test('bulk progress survived the move', () => {
  // BulkOperationsPanel is the ONLY progress readout for BULK_EXECUTE, which
  // the Sites table's bulk bar dispatches. Deleting it with the tab would
  // leave every bulk action running blind.
  expect(read('NexusOverview.tsx')).toContain('BulkOperationsPanel');
});

test('WPE sync progress survived — the scheduler drives it, not a button', () => {
  // Assert on the CALL SITE, not just the method body — the method could exist
  // but never be called, leaving background syncs invisible.
  const shell = new NexusOverview({ NavLink: () => null, electron: mockElectron });
  shell.state.activeTab = 'sites';
  shell.state.stats = { localSites: { total: 0, running: 0, halted: 0 } } as any;
  shell.state.loading = false;
  shell.state.wpeSyncing = true;
  shell.state.wpeSyncProgress = { current: 5, total: 10, skipped: 0, currentSite: 'test-site', status: 'syncing' };

  const tree = JSON.stringify(shell.renderActiveTab());
  expect(tree).toContain('wpe-sync-progress');
});

test('the native panel keeps only the host-key boundary', () => {
  const prefs = read('NexusPreferences.tsx');
  expect(prefs).toContain('renderExternalHostsSection');
  // These moved to the one settings home.
  expect(prefs).not.toContain('renderChatSection');
  expect(prefs).not.toContain('renderWpeAccessControlSection');
  expect(prefs).not.toContain('renderAwsCredsSection');
});
