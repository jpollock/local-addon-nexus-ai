/**
 * Guards the shape trap. These read the source rather than running a cycle:
 * what they protect is "every one of the seven records a duration", which is a
 * property of the wiring, not of a single run. Running seven real cycles would
 * need SSH, a graph DB and Local's service container.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src', p), 'utf8');

describe('every scheduled job records its duration', () => {
  test.each([
    ['main/startup/WpeRefreshScheduler.ts', 'wpeRefresh'],
    ['main/startup/ExternalRefreshScheduler.ts', 'externalRefresh'],
    ['main/startup/ExternalContentIndexScheduler.ts', 'externalContentIndex'],
    ['main/startup/HaltedSiteRefreshScheduler.ts', 'haltedSiteRefresh'],
  ])('%s records %s', (file, key) => {
    const src = read(file);
    expect(src).toContain('jobRunStore');
    expect(src).toContain(`'${key}'`);
  });

  test('the two non-class jobs are instrumented at their call sites in index.ts', () => {
    // wpeContentIndexTimer is a bare setInterval and runWpeAutoSyncIncremental
    // is a closure — neither has restart/stop, so neither can be instrumented
    // in a shared base.
    const src = read('main/index.ts');
    expect(src).toContain("'wpeContentIndex'");
    expect(src).toContain("'wpeSync'");
  });

  test('localContentIndex is NOT recorded — work happens asynchronously', () => {
    // OpportunisticScheduler.runCycle() dispatches work fire-and-forget through
    // BulkOperationManager.execute(), which returns immediately. The actual
    // indexing happens asynchronously over minutes/hours. Measuring dispatch time
    // (~0-1ms) would be meaningless. Awaiting completion would block the
    // setInterval and change scheduler semantic from "dispatch every N hours" to
    // "wait for completion then N more hours" — a scheduling behavior change that
    // violates the task constraint. Result: no recording, averageMs() returns
    // null, UI omits the duration clause. This test pins that decision so nobody
    // "fixes" it back.
    const src = read('main/scheduler/OpportunisticScheduler.ts');
    expect(src).toContain('Duration not recorded');
    expect(src).toContain('fire-and-forget');
  });
});
