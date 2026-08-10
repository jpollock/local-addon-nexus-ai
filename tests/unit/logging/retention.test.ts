import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { planRetention, applyRetention } from '../../../src/main/logging/retention';

const POLICY = { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 };
const f = (over: Partial<any> = {}) => ({
  path: '/logs/nexus-2026-08-01.log', category: 'combined' as const,
  day: '2026-08-01', bytes: 1024, preserved: false, ...over,
});

describe('planRetention', () => {
  it('keeps everything inside the day windows and under budget', () => {
    const plan = planRetention([f({ day: '2026-08-09' }), f({ day: '2026-08-08' })], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('drops logs older than logDays', () => {
    const old = f({ day: '2026-07-01', path: '/logs/old.log' });
    const plan = planRetention([old, f({ day: '2026-08-09' })], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
  });

  it('holds transcripts to a shorter window than logs', () => {
    // Transcripts carry prompt text, so they age out faster than the lines that reference them.
    const t = f({ day: '2026-08-04', category: 'transcript', path: '/logs/t.jsonl' });
    const l = f({ day: '2026-08-04', path: '/logs/keep.log' });
    const plan = planRetention([t, l], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/t.jsonl']);
  });

  it('NEVER deletes a preserved file, however old', () => {
    // A run that errored or performed a Tier 3 operation is the one most worth auditing; ageing
    // it out on the same schedule as a quiet run defeats the point of keeping logs at all.
    const kept = f({ day: '2020-01-01', preserved: true, path: '/logs/failed-run.log' });
    const plan = planRetention([kept], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('evicts oldest-first when the budget is exceeded', () => {
    const big = { ...POLICY, budgetBytes: 2048 };
    const plan = planRetention([
      f({ day: '2026-08-09', bytes: 1024, path: '/logs/new.log' }),
      f({ day: '2026-08-08', bytes: 1024, path: '/logs/mid.log' }),
      f({ day: '2026-08-07', bytes: 1024, path: '/logs/old.log' }),
    ], big);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
    expect(plan.keptBytes).toBeLessThanOrEqual(2048);
  });

  it('will not breach the budget by deleting a preserved file', () => {
    // The budget yields to preservation: going over disk is recoverable, losing the evidence of a
    // failed production run is not. The caller surfaces this rather than silently deleting.
    const tiny = { ...POLICY, budgetBytes: 10 };
    const plan = planRetention([f({ bytes: 5000, preserved: true, path: '/logs/keep.log' })], tiny);
    expect(plan.deletePaths).toEqual([]);
    expect(plan.keptBytes).toBe(5000);
  });

  it('reports how much it would free, so the UI can say so before deleting', () => {
    const plan = planRetention([f({ day: '2026-07-01', bytes: 4096, path: '/logs/old.log' })], POLICY);
    expect(plan.freedBytes).toBe(4096);
  });

  it('preserved files are exempt from BOTH day and budget passes', () => {
    // A preserved file that is recent enough to pass the day window should ALSO be exempt
    // from the budget pass. This catches the bug where preserved check is only in one pass.
    const tiny = { ...POLICY, budgetBytes: 2000 };
    const plan = planRetention([
      f({ day: '2026-08-09', bytes: 1000, preserved: false, path: '/logs/unpres.log' }),
      f({ day: '2026-08-08', bytes: 2000, preserved: true, path: '/logs/pres.log' }),
    ], tiny);
    // The preserved file survived the day pass (recent). Now budget is 2000, total is 3000.
    // Only the unpreserved file should be deleted, even though it's newer.
    expect(plan.deletePaths).toEqual(['/logs/unpres.log']);
    expect(plan.keptBytes).toBe(2000);
  });

  it('keeps files at exactly the cutoff boundary', () => {
    // The cutoff is exclusive — a file from exactly logDays ago survives, one day older does not.
    // This catches the off-by-one bug: f.day < cut vs f.day <= cut.
    const now = new Date();
    const cutoff14 = new Date(now);
    cutoff14.setDate(cutoff14.getDate() - 14);
    const boundary = cutoff14.toLocaleDateString('en-CA'); // exactly 14 days ago
    const oneDayInside = new Date(cutoff14);
    oneDayInside.setDate(oneDayInside.getDate() + 1);
    const inside = oneDayInside.toLocaleDateString('en-CA'); // 13 days ago
    const oneDayOutside = new Date(cutoff14);
    oneDayOutside.setDate(oneDayOutside.getDate() - 1);
    const outside = oneDayOutside.toLocaleDateString('en-CA'); // 15 days ago

    const plan = planRetention([
      f({ day: boundary, path: '/logs/boundary.log' }),
      f({ day: inside, path: '/logs/inside.log' }),
      f({ day: outside, path: '/logs/outside.log' }),
    ], POLICY);
    // Boundary and inside survive; outside is deleted.
    expect(plan.deletePaths).toEqual(['/logs/outside.log']);
  });
});

describe('applyRetention — marker detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup is best-effort */ }
  });

  it('detects a marker straddling a 64 KB chunk boundary', () => {
    // FIX 1: chunk overlap ensures a marker at exactly position 65536 is found.
    const CHUNK_SIZE = 64 * 1024;
    const marker = ' mutation op=wp_plugin_update';

    // Build a file with the marker starting exactly at the chunk boundary.
    // Fill the first chunk with padding, then place the marker.
    const padding = 'x'.repeat(CHUNK_SIZE - 5); // Leave 5 chars before boundary
    const straddler = 'yyyy' + marker + ' target=mysite';
    const content = padding + straddler;

    const logPath = path.join(tmpDir, 'nexus-2026-08-09.log');
    fs.writeFileSync(logPath, content);

    // Marker straddles the boundary: starts at position CHUNK_SIZE - 1.
    // The overlap (marker.length - 1) carried forward must include it.
    const policy = { logDays: 0, transcriptDays: 0, budgetBytes: 1024 };
    const plan = applyRetention(tmpDir, policy);

    // File should NOT be deleted — it is preserved (contains mutation marker).
    expect(plan.deletePaths).toEqual([]);
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('detects run.end status=error in a multi-chunk file', () => {
    const CHUNK_SIZE = 64 * 1024;
    const marker = 'run.end status=error';

    // Place the marker well into the second chunk
    const content = 'a'.repeat(CHUNK_SIZE + 1000) + marker + ' message=failed';

    const logPath = path.join(tmpDir, 'nexus-2026-08-05.log');
    fs.writeFileSync(logPath, content);

    const policy = { logDays: 0, transcriptDays: 0, budgetBytes: 1024 };
    const plan = applyRetention(tmpDir, policy);

    expect(plan.deletePaths).toEqual([]);
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('deletes a file with no markers', () => {
    const content = 'This is a normal log line\nAnother line\nNo errors here\n';
    const logPath = path.join(tmpDir, 'nexus-2026-07-01.log');
    fs.writeFileSync(logPath, content);

    const policy = { logDays: 1, transcriptDays: 1, budgetBytes: 1024 * 1024 };
    const plan = applyRetention(tmpDir, policy);

    expect(plan.deletePaths).toContain(logPath);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('ignores prose that looks like a mutation', () => {
    // FIX 2: " mutation op=" is the real marker, not " mutation ".
    // A log line saying "no mutation needed" must NOT be preserved.
    const content = 'Agent decided no mutation needed for this site';
    const logPath = path.join(tmpDir, 'nexus-2026-07-01.log');
    fs.writeFileSync(logPath, content);

    const policy = { logDays: 1, transcriptDays: 1, budgetBytes: 1024 * 1024 };
    const plan = applyRetention(tmpDir, policy);

    // File SHOULD be deleted — it does not contain the real marker.
    expect(plan.deletePaths).toContain(logPath);
    expect(fs.existsSync(logPath)).toBe(false);
  });
});
