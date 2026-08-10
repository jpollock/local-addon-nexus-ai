/**
 * Operations after spec 5 guts it.
 *
 * Zones 1 and 2 move to the Sites table. Zone 3 stays, because Factory Reset
 * and friends are app-level maintenance with no per-site meaning — they cannot
 * become bulk actions, and their destination is the Advanced section spec 6
 * builds. Deleting the tab now would strand them for the whole gap.
 *
 * These read the source rather than rendering, because what they guard is
 * "this capability is still reachable from somewhere", which survives a
 * refactor of how it is rendered.
 */
import * as fs from 'fs';
import * as path from 'path';

const OVERVIEW = path.join(__dirname, '../../../src/renderer/components/NexusOverview.tsx');
const src = () => fs.readFileSync(OVERVIEW, 'utf8');

test('Operations still reaches every Advanced maintenance action', () => {
  // Five, not the four the plan lists — SSH Diagnostics is in the same zone and
  // would be stranded just as silently.
  for (const action of [
    'Factory Reset',
    'Reset Content Index',
    'Database Health',
    'Housekeeping',
    'SSH Diagnostics',
  ]) {
    expect(src()).toContain(action);
  }
});

test('the retired zone-1 bulk buttons are gone from Operations', () => {
  expect(src()).not.toContain('Refresh metadata');
  expect(src()).not.toContain('Sync metadata');
});

test('the per-site list is gone from Operations', () => {
  // Zone 2 was SystemTab. The Sites table replaces it.
  expect(src()).not.toContain('SystemTab');
});

test('bulk progress survives the gutting', () => {
  // BulkOperationsPanel lived inside zone 1. It is the ONLY progress readout
  // for BULK_EXECUTE, which is what the Sites table's bulk bar dispatches — so
  // deleting it with the buttons would leave every bulk action running blind.
  expect(src()).toContain('BulkOperationsPanel');
});

test('WPE sync progress survives, because the scheduler drives it too', () => {
  // `checkWpeSyncStatus` runs on mount and sets wpeSyncing for a sync started
  // by the scheduler, not by the deleted button. Removing this readout would
  // hide background syncs entirely.
  expect(src()).toContain('wpe-sync-progress');
});

test('the dashboard no longer carries the two fleet cards', () => {
  const overviewTab = fs.readFileSync(
    path.join(__dirname, '../../../src/renderer/components/tabs/OverviewTab.tsx'), 'utf8');
  // Usage, not mention: a comment explaining where they went is worth keeping,
  // and a bare `not.toContain(name)` would forbid writing one.
  expect(overviewTab).not.toContain('React.createElement(FleetCompletenessWidget');
  expect(overviewTab).not.toContain('this.renderFleetSummaryCard(');
  expect(overviewTab).not.toContain("from '../FleetCompletenessWidget'");
});
