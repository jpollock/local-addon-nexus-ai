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
import { BulkOperationsPanel } from '../../../src/renderer/components/BulkOperationsPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';
import { handlerExistsFor } from './helpers/ipcContracts';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src/renderer/components', p), 'utf8');

const mockElectron = {
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue(null),
  },
};

const advancedProps = {
  settings: { autoIndex: true, excludedSiteIds: [] } as any,
  indexEntries: [],
  mcpInfo: { port: 13100, stdioPath: '/path/to/stdio.js' },
  sites: [],
  fleetCounts: null,
  onSave: jest.fn(),
  electron: mockElectron,
};

/** Depth-first: is `componentType` anywhere in this element tree? */
function containsComponent(node: any, componentType: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => containsComponent(n, componentType));
  if (node.type === componentType) return true;
  return containsComponent(node.props?.children, componentType);
}

test('Advanced reaches every maintenance action Operations used to hold', () => {
  const advanced = new AdvancedSection(advancedProps);
  const tree = JSON.stringify(advanced.render());

  // The five capabilities that were stranded
  expect(tree).toContain('Start over');
  expect(tree).toContain('Rebuild search');
  expect(tree).toContain('Database health');
  expect(tree).toContain('Remove ghost installs');
  expect(tree).toContain('SSH diagnostics');
});

test('each of the five actually reaches a handler — a row is not a capability', () => {
  // "Remove ghost installs" rendered a button for a channel nothing in
  // src/main listened on: the handler shipped in c509c938 and was dropped in
  // the ipc-handlers decomposition without its caller. The label test above
  // certified the capability as reachable for the whole of that window.
  for (const channel of [
    IPC_CHANNELS.FACTORY_RESET,
    IPC_CHANNELS.RESET_CONTENT_INDEX,
    IPC_CHANNELS.DB_SCAN_ALL,
    IPC_CHANNELS.CLEANUP_GHOST_INSTALLS,
    IPC_CHANNELS.WPE_DIAGNOSE,
  ]) {
    expect({ channel, handled: handlerExistsFor(channel) })
      .toEqual({ channel, handled: true });
  }
});

test('the third reset is reachable too — it was buried inside Housekeeping', () => {
  const advanced = new AdvancedSection(advancedProps);
  const tree = JSON.stringify(advanced.render());
  expect(tree).toContain('Rebuild what Nexus knows');
  expect(handlerExistsFor(IPC_CHANNELS.RESET_AND_REFRESH)).toBe(true);
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
  //
  // Assert on the RENDERED TREE, not on the source text: `toContain(
  // 'BulkOperationsPanel')` was satisfied by the explanatory comment at
  // NexusOverview.tsx:924, so deleting the call site kept it green. Its
  // non-negotiable sibling below got a real render assertion; this one did not.
  const shell = new NexusOverview({ NavLink: () => null, electron: mockElectron });
  shell.state.activeTab = 'sites';
  shell.state.stats = { localSites: { total: 0, running: 0, halted: 0 } } as any;
  shell.state.loading = false;

  expect(containsComponent(shell.renderActiveTab(), BulkOperationsPanel)).toBe(true);
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

test('there is no Preferences page, and approving a key does not need one', () => {
  // The page once held every setting, then only host-key approval, then nothing worth
  // a menu item. What made approval safe was never the window it lived in -- it is that
  // TRUST_EXTERNAL_HOST_KEY is a real IPC channel with no GraphQL mutation and no CLI
  // caller. So the page is gone and the boundary is not.
  expect(fs.existsSync(path.join(__dirname, '../../../src/renderer/components/NexusPreferences.tsx'))).toBe(false);

  const index = fs.readFileSync(path.join(__dirname, '../../../src/renderer/index.tsx'), 'utf8');
  expect(index).not.toContain('preferencesMenuItems');

  // Both approval routes live where the user meets the problem.
  const panel = read('settings/OtherHostsPanel.tsx');
  const wizard = read('settings/ExternalHostAddWizard.tsx');
  expect(panel).toContain('TRUST_EXTERNAL_HOST_KEY');   // a key that CHANGED
  expect(wizard).toContain('TRUST_EXTERNAL_HOST_KEY');  // a key seen for the first time

  // And nothing sends the user to a page that no longer exists.
  expect(panel).not.toContain('Preferences → Nexus AI');
});
