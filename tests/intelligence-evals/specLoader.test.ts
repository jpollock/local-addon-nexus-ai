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
import { criteriaOf, loadEvalSpecs, parseEvalSpec } from './specLoader';
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
  it('loads all three with zero errors', () => {
    const { specs, errors } = loadEvalSpecs(EVALS_DIR);
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.id).sort()).toEqual([
      'B-03-runbook-push-with-capability',
      'E-01-consult-before-risk',
      'E-02-emission-on-completion',
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
      'task.rationale_recorded exists and includes: filter applied, canary choice + reason, history findings'
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
