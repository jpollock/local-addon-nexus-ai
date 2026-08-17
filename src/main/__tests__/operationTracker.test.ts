/**
 * WP-14 · The observation seam.
 *
 * `OperationTracker` was chosen over the pull/push tool handlers because it is
 * the only place that sees a sync started from Local's OWN UI — and those are
 * the majority. These tests pin the three things the scout found, each of
 * which the seam would otherwise get wrong:
 *
 *   1. success and failure arrive with the IDENTICAL status string, so the
 *      banner id is the only discriminator;
 *   2. a caller's declared facts must survive to the observation;
 *   3. the database phase is the only evidence a UI-initiated sync carried the
 *      database at all.
 *
 * The electron mock is local to this file: the shared one has no `on`, and the
 * tracker's whole contract is what it does with events it hears.
 */
import { EventEmitter } from 'events';

const bus = new EventEmitter();
jest.mock('electron', () => ({ ipcMain: bus }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OperationTracker } = require('../operation-tracker') as typeof import('../operation-tracker');
type SyncObservation = import('../operation-tracker').SyncObservation;

function freshTracker(): { tracker: InstanceType<typeof OperationTracker>; seen: SyncObservation[] } {
  bus.removeAllListeners();
  const tracker = new OperationTracker();
  tracker.start();
  const seen: SyncObservation[] = [];
  tracker.onSync((o) => seen.push(o));
  return { tracker, seen };
}

/** Exactly what Local emits, in Local's order, for a UI-initiated pull. */
function localPull(siteId: string, opts: { withDatabase: boolean; fails?: boolean }): void {
  bus.emit('updateSiteStatus', null, siteId, 'pulling');
  bus.emit('updateSiteMessage', null, siteId, { label: 'Ensuring SSH key' });
  bus.emit('updateSiteMessage', null, siteId, { label: 'Downloading and extracting files' });
  if (opts.withDatabase) {
    bus.emit('updateSiteMessage', null, siteId, { label: 'Downloading and importing database' });
  }
  // Both the success path AND WPEBaseService.errorHandler send this.
  bus.emit('updateSiteStatus', null, siteId, 'running');
  bus.emit('showSiteBanner', null, {
    siteID: siteId,
    id: opts.fails ? 'pulling-error' : 'site-pulled',
    title: 'x',
  });
}

test('a UI-initiated pull is observed, with the database phase as the only db evidence', () => {
  const { seen } = freshTracker();
  localPull('site-a', { withDatabase: true });

  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    siteId: 'site-a',
    type: 'pull',
    outcome: 'succeeded',
    databasePhaseObserved: true,
  });
  // Nothing declared it — the whole point of the tracker seam.
  expect(seen[0].detail).toBeUndefined();
});

test('a files-only UI pull reports no database phase', () => {
  const { seen } = freshTracker();
  localPull('site-b', { withDatabase: false });
  expect(seen[0].databasePhaseObserved).toBe(false);
});

test('a FAILED pull is reported as failed — the status string cannot tell them apart', () => {
  const { seen } = freshTracker();
  localPull('site-c', { withDatabase: true, fails: true });

  expect(seen).toHaveLength(1);
  expect(seen[0].outcome).toBe('failed');
});

test('a non-terminal error banner does not end the operation', () => {
  const { seen } = freshTracker();
  bus.emit('updateSiteStatus', null, 'site-d', 'pushing_v2');
  // Local emits these mid-push; neither finishes it.
  bus.emit('showSiteBanner', null, { siteID: 'site-d', id: 'cache-purging-error' });
  bus.emit('showSiteBanner', null, { siteID: 'site-d', id: 'table-prefix-error' });
  expect(seen).toHaveLength(0);

  bus.emit('showSiteBanner', null, { siteID: 'site-d', id: 'site-pushed' });
  expect(seen).toHaveLength(1);
  expect(seen[0].type).toBe('push');
});

test('a tool-declared sync carries its detail through to the observation', () => {
  const { tracker, seen } = freshTracker();
  tracker.register('site-e', 'Site E', 'pull', {
    installName: 'jpp0413p',
    installId: 'inst-uuid',
    wpeSiteId: 'wpe-site-uuid',
    environment: 'production',
    includesDb: true,
    databaseOnly: true,
  });
  bus.emit('updateSiteStatus', null, 'site-e', 'pulling');
  bus.emit('updateSiteStatus', null, 'site-e', 'running');
  bus.emit('showSiteBanner', null, { siteID: 'site-e', id: 'site-pulled' });

  expect(seen[0].detail).toEqual({
    installName: 'jpp0413p',
    installId: 'inst-uuid',
    wpeSiteId: 'wpe-site-uuid',
    environment: 'production',
    includesDb: true,
    databaseOnly: true,
  });
  expect(seen[0].siteName).toBe('Site E');
});

test('an export is not a sync', () => {
  const { seen } = freshTracker();
  bus.emit('updateSiteStatus', null, 'site-f', 'exporting');
  bus.emit('updateSiteStatus', null, 'site-f', 'running');
  // An export emits no pull/push banner, but assert the guard directly too.
  bus.emit('showSiteBanner', null, { siteID: 'site-f', id: 'site-pulled' });
  expect(seen).toHaveLength(0);
});

test('a throwing listener cannot break the operation it observes', () => {
  bus.removeAllListeners();
  const tracker = new OperationTracker();
  tracker.start();
  const after: SyncObservation[] = [];
  tracker.onSync(() => { throw new Error('observer exploded'); });
  tracker.onSync((o) => after.push(o));

  expect(() => localPull('site-g', { withDatabase: true })).not.toThrow();
  expect(after).toHaveLength(1); // the second listener still ran
  expect(tracker.getOperation('site-g')?.status).toBe('completed');
});

test('the tracker keeps reporting operation status as it always did', () => {
  const { tracker } = freshTracker();
  bus.emit('updateSiteStatus', null, 'site-h', 'pulling');
  expect(tracker.getAllActive().map((o) => o.siteId)).toEqual(['site-h']);
  expect(tracker.getOperation('site-h')?.type).toBe('pull');
  bus.emit('updateSiteMessage', null, 'site-h', { label: 'Ensuring SSH key' });
  expect(tracker.getOperation('site-h')?.lastMessage).toBe('Ensuring SSH key');
});
