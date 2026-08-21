/**
 * WP-55 · THE VENUE GUARD, MOVED OUT OF A PROLOGUE AND INTO THE REPOSITORY.
 *
 * The pwd hazard recurred three times in one day. Each time the fix was a rule,
 * and each time the rule was carried by whoever happened to be reading it. The
 * third occurrence produced the ruling this file implements: *"a guard in the
 * prologue is a habit with better spelling; a guard in the hook is the
 * mechanism the ruling asked for."*
 *
 * WHAT IT REFUSES, and it is exactly the observed failure: a commit whose
 * message names one packet, made in a worktree checked out for a different one.
 * `docs(wp-56): …` committed on branch `wp-32` is a change that landed in the
 * wrong tree, and it is visible from the message and the branch alone.
 *
 * WHAT IT MUST NOT REFUSE: anything on the base branch. Merge reports for every
 * packet are committed there by design, so a packet-scoped message on
 * `poc/nexintelligence-ux` is correct and common.
 *
 * THE HOOK IS `commit-msg`, NOT `pre-commit`, and the correction is disclosed
 * rather than silent: the ruling named `pre-commit` because it is already
 * wired, but `pre-commit` is never handed the message, and the message is the
 * only place the intended packet is written down. `core.hooksPath` is set to
 * the whole `.githooks` directory, so `commit-msg` is wired by the same
 * setting, at the same cost, and can actually read the fact it gates on.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(REPO_ROOT, '.githooks', 'commit-msg');

/** Run the hook with a message and a branch, and report what it did. */
function runHook(message: string, branch: string): { refused: boolean; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp55-venue-'));
  try {
    const file = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(file, message, 'utf-8');
    try {
      const out = execFileSync(HOOK, [file], {
        encoding: 'utf-8',
        // The hook reads the branch from the environment when told to, so the
        // test does not need a real checkout to drive every arm. A guard that
        // can only be driven by constructing the failure it prevents is a guard
        // nothing checks.
        env: { ...process.env, NEXUS_VENUE_BRANCH: branch },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { refused: false, output: out };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { refused: true, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the venue guard — a packet-scoped message in another packet\'s worktree', () => {
  test('the hook exists and is executable, or it is a rule again rather than a mechanism', () => {
    expect(fs.existsSync(HOOK)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(HOOK).mode & 0o111).not.toBe(0);
  });

  test('REFUSES the observed failure — a wp-56 message committed on the wp-32 branch', () => {
    const r = runHook('docs(wp-56): MERGE REPORT, and the first base-measure.json\n', 'wp-32');
    expect(r.refused).toBe(true);
    // The refusal must name BOTH halves, or the reader has to guess which is
    // wrong — and the whole failure is that they look correct one at a time.
    expect(r.output).toContain('wp-56');
    expect(r.output).toContain('wp-32');
  });

  test('ALLOWS the same message on its own packet branch', () => {
    expect(runHook('docs(wp-56): MERGE REPORT\n', 'wp-56').refused).toBe(false);
  });

  test('ALLOWS a packet-scoped message on the BASE branch — merge reports land there', () => {
    expect(runHook('docs(wp-56): merge accepted\n', 'poc/nexintelligence-ux').refused).toBe(false);
  });

  test('ALLOWS a message with no packet scope at all, on any branch', () => {
    expect(runHook('chore: tidy the imports\n', 'wp-32').refused).toBe(false);
    expect(runHook('fix: a thing\n', 'poc/nexintelligence-ux').refused).toBe(false);
  });

  test('a SUFFIXED packet is its own packet — wp-54a is not wp-54', () => {
    expect(runHook('feat(wp-54a): the stuck agent\n', 'wp-54').refused).toBe(true);
    expect(runHook('feat(wp-54a): the stuck agent\n', 'wp-54a').refused).toBe(false);
  });

  test('the scope is read from the CONVENTIONAL COMMIT header only, never from the body', () => {
    // A body that merely mentions another packet is a citation, not a venue
    // claim — refusing on it would make every merge report unwritable.
    const r = runHook('feat(wp-55): the coalesced screen\n\nSupersedes wp-56a and cites wp-32.\n', 'wp-55');
    expect(r.refused).toBe(false);
  });
});
