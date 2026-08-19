/**
 * WP-38 · the render answers the designer's six-row table, and keeps answering
 * it.
 *
 * The chain this file closes, link by link:
 *
 *   `from-designer-07-corroboration-render.md` §4a  (the designer's own table)
 *      → `scripts/generate-citation-fixtures.ts`     (WP-34's generator)
 *      → `docs/intelligence/design-fixtures/citation-spans.json`  (committed)
 *      → `citationTurn.fake.ts`                      (what the surface renders)
 *      → `citationRender()`                          (what a user would see)
 *
 * WP-34's `designFixture.test.ts` pins the first three links. This file pins the
 * last two, BYTE for byte at the fixture boundary and row for row against the
 * designer's markdown — so the surface cannot be shown a scenario that the sheet
 * does not contain, and cannot draw a state the join did not derive.
 *
 * Why the fake holds literals at all rather than importing the JSON: a renderer
 * module has no repo to read at runtime (`procedureStream.fake.ts` states the
 * same for its own). The cost of literals is drift; this file is the payment.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  FIXTURE_REPLY,
  FIXTURE_SUPPLY,
  fixtureCitationTurn,
} from '../../../src/renderer/components/DockedPanel/citationTurn.fake';
import { citationRender } from '../../../src/renderer/components/DockedPanel/citationModel';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'design-fixtures', 'citation-spans.json'
);
const SHEET = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'from-designer-07-corroboration-render.md'
);

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The designer's state words, mapped onto ADR-24's three. WP-34's table. */
const DESIGNER_STATE: Record<string, string | null> = {
  resolves: 'cited-and-resolves',
  unresolvable: 'cited-but-unresolvable',
  'uncited factual claim': 'uncited-factual-claim',
  'uncited glue — legitimate': null,
};

/** The six rows, re-extracted from the committed markdown on every run. */
function designerRows(): { claim: string; state: string | null }[] {
  const rows: { claim: string; state: string | null }[] = [];
  for (const line of fs.readFileSync(SHEET, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 5) continue;
    const [, claim, state] = cells;
    if (!(state in DESIGNER_STATE)) continue;
    rows.push({ claim, state: DESIGNER_STATE[state] });
  }
  return rows;
}

describe('the fixture the surface renders IS the adherence fixture', () => {
  it('renders the committed reply, byte for byte', () => {
    expect(FIXTURE_REPLY).toBe(fixture.reply);
  });

  it('renders against the committed supply, exactly', () => {
    // Sorted-key comparison, because the generator writes JSON with sorted keys
    // and a literal is written for a human to read.
    expect(JSON.parse(JSON.stringify(FIXTURE_SUPPLY))).toEqual(fixture.supply);
  });

  it('names a convention that actually shipped', () => {
    // `cnv_6c2b11952046` is WP-34's ratified carrier block. A fixture claiming a
    // convention nothing ever taught would make every state below fictional.
    const turn = fixtureCitationTurn();
    expect(turn.manifest).toEqual({
      citation: { convention: 'cnv_6c2b11952046', asserted: 'full' },
    });
    // Against the LIVE constant, which is a hash over the carrier block's own
    // text — so a fixture naming a convention that never shipped, or one whose
    // text later changed, goes red here rather than rendering a plausible
    // version number nobody ever taught a model.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CITATION_CONVENTION_VERSION } = require('../../../src/intelligence/citation/convention');
    expect(CITATION_CONVENTION_VERSION).toBe('cnv_6c2b11952046');
  });
});

describe('the render draws the designer’s table, row for row', () => {
  const render = citationRender(fixtureCitationTurn());
  if (render.kind !== 'corroborated') throw new Error(`expected corroborated, got ${render.kind}`);

  it('re-extracts six rows from the sheet — five with a state, one without', () => {
    const rows = designerRows();
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.state === null)).toHaveLength(1);
  });

  it('derives the same state for each of the six claims the designer drew', () => {
    const rows = designerRows();
    const segments = render.segments;

    // Pair each designer row with what the render produced for its claim.
    //
    // TRAILING is the whole pin (ruling §2), so the pairing is by OFFSET and not
    // by segment: a marker belongs to a claim only when it sits at the end of
    // that claim, separated by spaces alone. The glue row and the last claim
    // share one text run — the glue carries no marker and the claim after it
    // does — and a pairing that took "the next citation segment" would hand the
    // glue the backup claim's chip and pass while drawing a lie.
    const drawn = rows.map((row) => {
      const at = FIXTURE_REPLY.indexOf(row.claim);
      expect(at).toBeGreaterThanOrEqual(0);
      const end = at + row.claim.length;
      const trailing = segments.find(
        (s) =>
          s.kind === 'citation' &&
          s.resolution.citation.start >= end &&
          /^ *$/.test(FIXTURE_REPLY.slice(end, s.resolution.citation.start))
      );
      return trailing && trailing.kind === 'citation' ? trailing.resolution.state : null;
    });

    expect(drawn).toEqual(rows.map((r) => r.state));
  });

  it('agrees with the committed fixture’s own derived states, in order', () => {
    const fixtureStates = (fixture.spans as Array<{ state: string | null }>).map((s) => s.state);
    const rendered = render.segments
      .filter((s) => s.kind === 'citation')
      .map((s) => (s as { resolution: { state: string } }).resolution.state);
    // The fixture's sixth row is the glue: a null state and no marker. Drop the
    // nulls to compare against the markers the render actually drew.
    expect(rendered).toEqual(fixtureStates.filter((s) => s !== null));
  });

  it('derives the tally the designer’s header line states', () => {
    expect(fixture.tally).toEqual({
      'cited-and-resolves': 3,
      'cited-but-unresolvable': 1,
      'uncited-factual-claim': 1,
    });
    expect(render.tally).toBe(
      '3 claims linked · 1 citation that does not resolve · 1 fact with nothing offered'
    );
    // and the sheet says it in words, which is the line above being true
    expect(fs.readFileSync(SHEET, 'utf8')).toContain(
      '*3 claims linked · 1 citation that does not resolve · 1 fact with nothing offered*'
    );
  });

  it('reaches the unresolvable state for the reason the sheet gives', () => {
    const unresolvable = render.segments
      .filter((s) => s.kind === 'citation')
      .map((s) => (s as any).resolution)
      .find((r: any) => r.state === 'cited-but-unresolvable');
    // "not in this task's supply" — not malformed. The sheet's third row is a
    // well-formed id nobody supplied, which is the state that looks like
    // evidence and is the only reason it is drawn loudest.
    expect(unresolvable.reason).toBe('not-in-supply');
    expect(fixture.spans[2].reason).toBe('not-in-supply');
  });
});
