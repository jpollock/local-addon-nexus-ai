/**
 * WP-42 · The runner's CLI, pinned where it lied.
 *
 * THE DEFECT, filed at the WP-39 adjudication and reproduced before this fix:
 *
 *     npx ts-node --project tsconfig.test.json \
 *       tests/intelligence-evals/run.ts --only nope-not-a-spec
 *     …
 *     MILESTONE VERDICT: MET — 0 criteria pass.        exit 0
 *
 * It is the vacuous-green family at the runner's own summary line. Every
 * criterion was selected away, nothing was checked, and the one sentence a CI
 * job or a reader takes away said the milestone was MET. A typo in a spec id —
 * `--only E-01`, the sitting harness's own spelling — is enough to produce it.
 *
 * WHY A SPAWNED CHILD. The lie was jointly produced by three things that only
 * meet in the real process: the argv parse, the exit code, and the summary
 * line. `run.ts` calls `main()` at module scope, so it cannot be imported
 * (`hostSeamProbe.ts` excludes it for the same reason) — an in-process
 * assertion would have to re-implement the CLI and would then be pinning its
 * own copy. Same argument as the WP-39 host-seam child, and the same cost:
 * one ts-node startup, before the fixture is built rather than after.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

import { loadEvalSpecs } from './specLoader';
import { EVALS_DIR } from './runner';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync(
      path.join(REPO_ROOT, 'node_modules', '.bin', 'ts-node'),
      ['--project', 'tsconfig.test.json', 'tests/intelligence-evals/run.ts', ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('WP-42 · run.ts --only <no-match> is an error, never a MET', () => {
  const ids = loadEvalSpecs(EVALS_DIR).specs.map((s) => s.id);

  it('exits non-zero, names the selector, and lists the ids that do exist', () => {
    const result = runCli(['--only', 'E-01']);

    // Non-zero first: this is the half a CI job reads, and it was 0.
    expect(result.status).not.toBe(0);

    const output = `${result.stdout}\n${result.stderr}`;
    // Anchored, per WP-32: "MET" alone is a substring of "NOT MET", and this
    // assertion must not be satisfiable by the line that says the opposite.
    expect(output).not.toContain('MILESTONE VERDICT: MET');
    expect(output).toContain('"E-01"');
    for (const id of ids) expect(output).toContain(id);

    // And it refuses AT THE DOOR. Nothing ran: no fixture was built, no probe
    // drove the core, no report was rendered. Every one of those writes to
    // stdout — the probes alone emit a screenful of tool-registry debug lines —
    // so an empty stdout is the evidence that the refusal came first, and it
    // is what turns a twenty-second run into a one-second one.
    expect(result.stdout).toBe('');
  }, 180_000);

  it('still runs, and still reports, when the selector matches', () => {
    // The positive control, and it is not optional: a guard that refuses every
    // selector would satisfy the case above completely (WP-38's rule — a subset
    // check with no positive control is an assertion about an empty set).
    //
    // The exit code is deliberately NOT asserted to be 0 here: a real spec
    // carries BLOCKED criteria, so this run legitimately exits 2, which is the
    // same code the refusal above returns. Distinguishing them by code would
    // pin the wrong thing; what says the selector was honoured is that the
    // report exists and names the spec that was asked for.
    const result = runCli(['--only', ids[0]]);
    expect(result.stderr).not.toContain('no eval spec matched');
    // The rendered report, not `--json`: this runner writes its debug log to
    // stdout alongside the payload, so `--json` output is not parseable as
    // JSON today (filed under WP-42, not fixed here — it is the logger's
    // stream, not the selector).
    expect(result.stdout).toContain(ids[0]);
    expect(result.stdout).toContain('MILESTONE VERDICT');
    // …and it reached the phase the refusal above must never reach.
    expect(result.stdout).toContain('ledger events');
  }, 600_000);
});
