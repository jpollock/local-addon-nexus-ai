/**
 * WP-34 · the adherence fixture answers the designer's sheet, and keeps
 * answering it.
 *
 * `from-designer-07-corroboration-render.md` §4a is a six-row table of claims
 * and states, drawn against ADR-24 before the convention had a syntax. The
 * designer built it for this diff. So the pin is not "the fixture has six
 * entries" — it is that the STATE this packet's join derives for each of those
 * six claims is the state the designer drew, row for row, with the expectation
 * RE-EXTRACTED from their committed text on every run rather than re-typed
 * here. That is the `checks.test.ts` discipline (transcription pinned to its
 * source, not to a reviewer's memory of it) applied to a design fixture.
 *
 * The three generator properties are pinned too — committed, matching the
 * derivation, deterministic — for the reasons `designFixtures.test.ts` states
 * about its own artifact: a generator nobody re-runs is a hand-written file
 * with extra steps.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildFixture, FIXTURE_REPLY } from '../../../../scripts/generate-citation-fixtures';
import { parseCitations } from '../resolve';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'docs',
  'intelligence',
  'design-fixtures',
  'citation-spans.json'
);
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-citation-fixtures.ts');
const SHEET = path.join(
  REPO_ROOT,
  'docs',
  'intelligence',
  'from-designer',
  'from-designer-07-corroboration-render.md'
);

/**
 * The designer's own table, read out of their file.
 *
 * Their state words map onto ADR-24's three; `uncited glue` is the fourth ROW
 * kind and the absence of a state, which is why it maps to `null` rather than
 * to a fourth state.
 */
const DESIGNER_STATE: Record<string, string | null> = {
  resolves: 'cited-and-resolves',
  unresolvable: 'cited-but-unresolvable',
  'uncited factual claim': 'uncited-factual-claim',
  'uncited glue — legitimate': null,
};

function designerRows(): { claim: string; state: string | null }[] {
  const text = fs.readFileSync(SHEET, 'utf8');
  const rows: { claim: string; state: string | null }[] = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | claim | state | marker | → ['', claim, state, marker, '']
    if (cells.length !== 5) continue;
    const [, claim, state] = cells;
    if (!(state in DESIGNER_STATE)) continue;
    rows.push({ claim, state: DESIGNER_STATE[state] });
  }
  return rows;
}

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

describe('the fixture lines up against from-designer-07 §4a', () => {
  const rows = designerRows();
  const spans = buildFixture().spans as {
    claim: string;
    marker: string | null;
    state: string | null;
  }[];

  it('reads six rows out of the designer’s own table', () => {
    // A guard on the EXTRACTOR, not on the fixture: if the sheet is reformatted
    // and the table stops parsing, every assertion below would pass vacuously
    // over an empty list.
    expect(rows).toHaveLength(6);
  });

  it('every claim is the designer’s sentence, verbatim and in their order', () => {
    expect(spans.map((s) => s.claim)).toEqual(rows.map((r) => r.claim));
  });

  it('every state is the state they drew — derived here, transcribed there', () => {
    expect(spans.map((s) => s.state)).toEqual(rows.map((r) => r.state));
  });

  it('the tally is the header line they derived: 3 linked, 1 unresolvable, 1 with nothing offered', () => {
    expect(buildFixture().tally).toEqual({
      'cited-and-resolves': 3,
      'cited-but-unresolvable': 1,
      'uncited-factual-claim': 1,
    });
  });

  it('the glue row carries NO marker at all — absence, not a fourth state', () => {
    const glue = spans[4];
    expect(glue.marker).toBeNull();
    expect(glue.state).toBeNull();
  });

  it('every marker in the reply parses — the fixture cannot contain a typo', () => {
    const parsed = parseCitations(FIXTURE_REPLY);
    expect(parsed).toHaveLength(5);
    expect(parsed.filter((p) => p.ref === null)).toEqual([]);
  });
});

describe('the generator', () => {
  it('has a committed artifact', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
  });

  it('MATCHES the derivation — an edit to the join without a regenerate fails here', () => {
    const { status, output } = runGenerator(['--check']);
    // Anchored on the whole sentence, not on a fragment: WP-32's finding is
    // that a pass-condition substring which also appears inside a FAILURE
    // message reports two different outcomes the same way.
    expect(output).toContain('citation-spans.json is current');
    expect(status).toBe(0);
  }, 120_000);

  it('is DETERMINISTIC — two runs on an unchanged tree are byte-identical', () => {
    // Temp paths only. A battery run of a generator that writes its TRACKED
    // output leaves the poisoned artifact behind when the mutation reverts —
    // PARALLEL_PROTOCOL's sixth form of the poisoned-cache rule.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp34-fixture-'));
    try {
      const a = path.join(dir, 'a.json');
      const b = path.join(dir, 'b.json');
      runGenerator(['--out', a]);
      runGenerator(['--out', b]);
      expect(fs.readFileSync(a, 'utf8')).toBe(fs.readFileSync(b, 'utf8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
