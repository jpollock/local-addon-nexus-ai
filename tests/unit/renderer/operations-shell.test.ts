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
import { serializeTree } from './helpers/serializeTree';

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
  // THE PIN'S SUBJECT IS THE MACHINERY SURVIVING, REACHABLE — a bulk action
  // must never run blind. Round-7 item 7 retired the Installs view; the
  // progress readout now lives in PropertiesTab's own job board, fed by the
  // same bulkJob state BULK_EXECUTE drives. Assert on the RENDERED TREE with
  // a live job, exactly as the original pin demanded.
  const shell = new NexusOverview({ NavLink: () => null, electron: mockElectron });
  shell.state.activeTab = 'sites';
  shell.state.stats = { localSites: { total: 0, running: 0, halted: 0 } } as any;
  shell.state.loading = false;
  shell.state.collapseLoaded = true;
  shell.state.collapse = {
    properties: [],
    header: { total: 0, byOrigin: { local: 0, wpe: 0, external: 0 }, placesTotal: 0, neverLookedInside: 0, onThisMachine: 0, ceilings: [], needsYou: null },
  } as any;
  shell.state.bulkJob = {
    phase: 'running', type: 'index', siteIds: ['a'], startedAt: 1,
    completed: 1, total: 3, failed: 0, failedIds: [],
  } as any;

  // serializeTree stops at component boundaries (its own docblock), so render
  // the PropertiesTab element the shell produced — the same wiring, executed.
  const el: any = shell.renderActiveTab();
  const propsEl = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
    .find((c: any) => c && typeof c.type === 'function' && (c.type.name === 'PropertiesTab'));
  expect(propsEl).toBeTruthy();
  const rendered = JSON.stringify(serializeTree(new propsEl.type(propsEl.props).render()));
  expect(rendered).toContain('1 of 3 places');   // the job board, rendering the live job
  expect(rendered).toContain('Stop');            // and its stop — never running blind
});

test('WPE sync progress survived — the scheduler drives it, not a button', () => {
  // Assert on the CALL SITE, not just the method body — the method could exist
  // but never be called, leaving background syncs invisible.
  const shell = new NexusOverview({ NavLink: () => null, electron: mockElectron });
  shell.state.activeTab = 'sites';
  // Round-2 finding 4 (2026-08-24): bulk machinery belongs to the installs
  // view — on the property screens it was an empty panel. The pin's subject
  // (the machinery SURVIVES, reachable) now lives behind the view toggle.
  shell.state.sitesView = 'installs';
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
