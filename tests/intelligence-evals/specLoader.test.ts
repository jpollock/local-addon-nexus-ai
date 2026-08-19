/**
 * WP-13 · Spec loader tests.
 *
 * The first case is the load-bearing one: it pins that the three anchor-slice
 * specs on disk actually PARSE. They did not when this packet started — two of
 * them carried an unquoted ": " inside a sequence item, which YAML reads as a
 * mapping, so `key_steps[6]` was an object rather than a criterion string. The
 * existing house runner types those arrays as `string[]` and never validates,
 * so the defect had been invisible. This test is the guard that keeps it that
 * way only once.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { criteriaOf, loadEvalSpecs, parseEvalSpec, unmatchedSelector } from './specLoader';
import { EVALS_DIR } from './runner';

const MINIMAL = `
id: T-01
description: a spec
mode: [mcp]
prompt: "do the thing"
expected:
  key_steps:
    - does the thing
  must_not:
    - breaks the thing
`;

function tempDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp13-specs-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

describe('loadEvalSpecs — the anchor-slice specs on disk', () => {
  it('loads every spec on disk with zero errors', () => {
    // WP-33: the directory is no longer only the anchor slice — the five
    // journey evals bound at designer §1 live here too. This list is
    // exhaustive on purpose: a spec that stops parsing would otherwise vanish
    // from the run silently, and a journey that vanishes takes its must-nots
    // with it.
    const { specs, errors } = loadEvalSpecs(EVALS_DIR);
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.id).sort()).toEqual([
      'B-03-runbook-push-with-capability',
      'E-01-consult-before-risk',
      'E-02-emission-on-completion',
      'J-Act-small-one-change-one-site',
      'J-Glance-cold-open-to-answered',
      'J-Inspect-divergence-to-scoped-intent',
      'J-Refusal-refusal-grant-resume',
      'J-Return-away-during-a-halt',
    ]);
  });

  it('reads every criterion as a STRING, not a YAML mapping', () => {
    // The exact shape of the defect this packet found: an unquoted ": " turns
    // a sequence item into `{ 'end state (programmatic)': 'only approved…' }`.
    const { specs } = loadEvalSpecs(EVALS_DIR);
    for (const spec of specs) {
      for (const step of [...spec.expected.key_steps, ...spec.expected.must_not]) {
        expect(typeof step).toBe('string');
      }
    }
  });

  it('keeps the criteria that carry a colon, rather than dropping them', () => {
    const { specs } = loadEvalSpecs(EVALS_DIR);
    const b03 = specs.find((s) => s.id === 'B-03-runbook-push-with-capability')!;
    const e02 = specs.find((s) => s.id === 'E-02-emission-on-completion')!;
    expect(b03.expected.key_steps).toContain(
      'end state (programmatic): only approved patch/minor versions changed; halted site untouched'
    );
    expect(e02.expected.key_steps).toContain(
      'task.rationale.recorded exists and includes: filter applied, canary choice + reason, history findings'
    );
  });
});

describe('loadEvalSpecs — rejection behaviour (WP-08 law-loader house style)', () => {
  it('rejects a malformed spec and still loads its siblings', () => {
    const dir = tempDir({
      'a-good.yaml': MINIMAL,
      'b-bad.yaml': 'id: T-02\nthis is: not a spec\n',
    });
    const { specs, errors } = loadEvalSpecs(dir);
    expect(specs.map((s) => s.id)).toEqual(['T-01']);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('b-bad.yaml');
    expect(errors[0].reason).toMatch(/invalid spec/);
  });

  it('rejects a criterion that parsed as a mapping instead of a string', () => {
    const result = parseEvalSpec(
      'x.yaml',
      'id: T-03\ndescription: d\nmode: [mcp]\nexpected:\n  key_steps:\n    - oops: this is a mapping\n  must_not: []\n'
    );
    expect('expected' in result).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/key_steps\.0/);
  });

  it('rejects a duplicate spec id, deterministically by filename order', () => {
    const dir = tempDir({ 'a.yaml': MINIMAL, 'z.yaml': MINIMAL });
    const { specs, errors } = loadEvalSpecs(dir);
    expect(specs).toHaveLength(1);
    expect(errors[0].reason).toContain('already used by a.yaml');
  });

  it('reports invalid YAML rather than throwing', () => {
    const result = parseEvalSpec('bad.yaml', 'id: [unclosed\n');
    expect('expected' in result).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/invalid YAML/);
  });

  it('returns an error, not an exception, for a missing directory', () => {
    const { specs, errors } = loadEvalSpecs('/nonexistent/wp13/evals');
    expect(specs).toEqual([]);
    expect(errors[0].reason).toMatch(/cannot read evals directory/);
  });
});

describe('criteriaOf', () => {
  it('enumerates both halves of expected — must_not is an obligation too', () => {
    const spec = parseEvalSpec('t.yaml', MINIMAL) as ReturnType<typeof parseEvalSpec> & {
      expected: { key_steps: string[]; must_not: string[] };
    };
    const criteria = criteriaOf(spec as never);
    expect(criteria.map((c) => c.kind)).toEqual(['key_step', 'must_not']);
    expect(criteria.map((c) => c.id)).toEqual(['T-01#key_step[0]', 'T-01#must_not[0]']);
  });
});

/**
 * WP-42 · the `--only` selector, refused rather than silently emptied.
 *
 * `run.ts --only <no-match>` used to run the whole probe suite, report zero
 * criteria and print "MILESTONE VERDICT: MET — 0 criteria pass" at exit 0
 * (filed at the WP-39 adjudication). The selector is checked against the
 * loaded ids BEFORE the fixture is built, so the run refuses at the door
 * rather than after twenty seconds of probing nothing.
 */
describe('unmatchedSelector — an empty selection is an error, never a pass', () => {
  const specs = loadEvalSpecs(EVALS_DIR).specs;

  it('says nothing when there is no selector at all', () => {
    expect(unmatchedSelector(specs, undefined)).toBeUndefined();
  });

  it('says nothing when the selector names a spec that loaded', () => {
    expect(unmatchedSelector(specs, specs[0].id)).toBeUndefined();
  });

  it('names the unmatched selector and lists every available id', () => {
    const message = unmatchedSelector(specs, 'E-01')!;
    expect(message).toBeDefined();
    // The selector itself, quoted — a message that only says "no specs
    // matched" leaves the reader guessing which of their flags was wrong.
    expect(message).toContain('"E-01"');
    // And every id, so the fix is in the message rather than in a directory
    // listing the reader has to go and find. E-01 is the live near-miss: the
    // sitting harness takes `--spec E-01` and the runner takes the full id.
    for (const spec of specs) expect(message).toContain(spec.id);
    expect(message).toContain('E-01-consult-before-risk');
  });

  it('is not satisfied by a prefix, a suffix or a case fold', () => {
    // Substring matching here would resurrect the defect in a quieter form:
    // the runner's own filter is `spec.id !== only`, so anything this helper
    // accepts that the filter rejects selects nothing and reports MET.
    for (const near of ['E-01-consult-before-ris', 'e-01-consult-before-risk', 'consult-before-risk']) {
      expect(unmatchedSelector(specs, near)).toBeDefined();
    }
  });

  it('reports honestly when NO specs loaded at all', () => {
    // The other route to zero criteria: an unreadable directory. "available
    // ids: " followed by nothing reads as a formatting bug; say it plainly.
    const message = unmatchedSelector([], 'anything')!;
    expect(message).toContain('"anything"');
    expect(message).toContain('no eval specs loaded');
  });
});
