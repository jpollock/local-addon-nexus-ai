/**
 * Spec 5 kept Operations alive only because deleting it would strand five
 * maintenance actions with nowhere to go. Spec 6a built that destination, so
 * this inverts: the five must now be reachable from Advanced, and Operations
 * must be gone.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src/renderer/components', p), 'utf8');

test('Advanced reaches every maintenance action Operations used to hold', () => {
  const advanced = read('settings/AdvancedSection.tsx');
  for (const action of [
    'Start over', 'Rebuild search', 'Database health',
    'Remove ghost installs', 'SSH diagnostics',
  ]) expect(advanced).toContain(action);
});

test('the third reset is reachable too — it was buried inside Housekeeping', () => {
  expect(read('settings/AdvancedSection.tsx')).toContain('Rebuild what Nexus knows');
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
  expect(read('NexusOverview.tsx')).toContain('wpe-sync-progress');
});

test('the native panel keeps only the host-key boundary', () => {
  const prefs = read('NexusPreferences.tsx');
  expect(prefs).toContain('renderExternalHostsSection');
  // These moved to the one settings home.
  expect(prefs).not.toContain('renderChatSection');
  expect(prefs).not.toContain('renderWpeAccessControlSection');
  expect(prefs).not.toContain('renderAwsCredsSection');
});
