/**
 * WP-32 · the design fixture is DERIVED, and stays derived.
 *
 * `scripts/generate-procedure-fixtures.ts` exists because pin 7 makes a
 * hand-written checkpoint list a defect wherever it appears — and a generator
 * nobody re-runs is a hand-written file with extra steps. These three tests are
 * what keep the committed artifact honest:
 *
 *  1. it MATCHES the derivation (so a runbook version bump that skips the
 *     regenerate turns red here, not in a designer's prototype three weeks on),
 *  2. it is DETERMINISTIC (so "regenerate and commit the diff" is a review
 *     someone can actually read), and
 *  3. its checkpoint sequence is the shipped document's, in the shipped order —
 *     the specific thing draft 1 got wrong, asserted as a sequence rather than
 *     as a set, because the defect was ORDER (canary before approval) and a set
 *     comparison would have passed it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadLawDirectory, RunbookRegistry } from '../../../intelligence';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'docs', 'intelligence', 'design-fixtures', 'declared-procedures.json');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-procedure-fixtures.ts');

function runGenerator(args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync('npx', ['ts-node', GENERATOR, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('WP-32 · the generated design fixture', () => {
  it('is committed', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
  });

  it('MATCHES the derivation — a runbook change without a regenerate fails here', () => {
    const { status, output } = runGenerator(['--check']);
    expect(`${status} ${output.trim()}`).toContain('up to date');
    expect(status).toBe(0);
  }, 120_000);

  it('is DETERMINISTIC — two runs on an unchanged tree are byte-identical', () => {
    // Written to a temp path, NEVER to the tracked artifact: a test that rewrites
    // the committed file could silently repair the staleness the test above
    // exists to catch, and no suite may mutate the working tree.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp32-fixture-'));
    try {
      const a = path.join(dir, 'a.json');
      const b = path.join(dir, 'b.json');
      runGenerator(['--out', a]);
      runGenerator(['--out', b]);
      expect(fs.readFileSync(b, 'utf8')).toBe(fs.readFileSync(a, 'utf8'));
      // And the deterministic output IS the committed one.
      expect(fs.readFileSync(a, 'utf8')).toBe(fs.readFileSync(FIXTURE, 'utf8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('carries the SHIPPED checkpoint sequence, in the SHIPPED order, for every strict runbook', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
      runbooks: Record<string, { checkpoints: Array<{ id: string }>; verifiableCount: number }>;
    };
    const registry = RunbookRegistry.build({
      documents: loadLawDirectory(path.join(REPO_ROOT, 'law')).documents,
    });

    const strict = registry.runbooks({ strictness: 'strict' });
    expect(strict.length).toBeGreaterThan(0);

    for (const runbook of strict) {
      const entry = fixture.runbooks[runbook.id];
      expect(entry).toBeDefined();
      // A SEQUENCE, not a set: draft 1's defect was the order (canary before
      // approval — writes before consent), which a set comparison would pass.
      expect(entry.checkpoints.map((c) => c.id)).toEqual(runbook.checkpoints.map((c) => c.id));
      expect(entry.verifiableCount).toBe(
        runbook.checkpoints.filter((c) => c.attest !== 'narrative').length
      );
    }
  });

  it('never ticks a narrative checkpoint — the one rule, in the fixture too', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
      runbooks: Record<string, { checkpoints: Array<{ attest: string; verified: boolean }> }>;
    };
    const narrative = Object.values(fixture.runbooks)
      .flatMap((r) => r.checkpoints)
      .filter((c) => c.attest === 'narrative');

    expect(narrative.length).toBeGreaterThan(0);
    expect(narrative.filter((c) => c.verified)).toEqual([]);
  });

  it('the anchor renders 4 of 8 — the honest denominator the designer builds against', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
      runbooks: Record<string, { verifiableCount: number; checkpointCount: number; version: string }>;
    };
    const anchor = fixture.runbooks['rb.bulk-plugin-update'];
    expect([anchor.verifiableCount, anchor.checkpointCount]).toEqual([4, 8]);
    expect(anchor.version).toBe('1.2.0');
  });

  it('badges exactly the four checkpoints the reviewed document marks unrequested', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
      runbooks: Record<string, { checkpoints: Array<{ id: string; badge: unknown }> }>;
    };
    const badged = fixture.runbooks['rb.bulk-plugin-update'].checkpoints
      .filter((c) => c.badge !== null)
      .map((c) => c.id);
    expect(badged).toEqual(['cp.consult-history', 'cp.dry-run', 'cp.canary', 'cp.verify-canary']);
  });
});
