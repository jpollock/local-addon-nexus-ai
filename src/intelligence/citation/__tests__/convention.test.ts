/**
 * WP-34 · the instruction block and the parser must not drift apart.
 *
 * The block is prose a model reads; `resolve.ts` is code a renderer runs. They
 * describe the same grammar in two languages, which is exactly the shape that
 * rots silently: an edited example still reads fine to a reviewer while no
 * longer parsing. So every example in the text is driven through the real
 * parser here, and every carrier line the text names is checked against the
 * closed vocabulary the resolver enforces.
 */
import {
  CITATION_CONVENTION_BODY,
  CITATION_CONVENTION_VERSION,
  renderCitationConventionBlock,
  renderCitationConventionReassert,
} from '../convention';
import { CITABLE_CARRIER_LINES, parseCitations } from '../resolve';

describe('the instruction block teaches the grammar the parser implements', () => {
  const examples = parseCitations(CITATION_CONVENTION_BODY);

  it('contains an example of each of the four forms, and every one parses', () => {
    expect(examples.every((e) => e.ref !== null)).toBe(true);
    expect(new Set(examples.map((e) => e.ref!.kind))).toEqual(
      new Set(['event', 'tool', 'carrier', 'none'])
    );
  });

  it('every carrier line the text names is in the resolver’s closed vocabulary', () => {
    // The sentence that enumerates them, read out of the text rather than
    // re-typed here — a copy in the test would drift with the copy in the block.
    const listed = /citable lines are: ([^\n]*(?:\n[^\n]*)?)/.exec(CITATION_CONVENTION_BODY);
    expect(listed).not.toBeNull();
    const named = listed![1]
      .replace(/'/g, '')
      .split(/[,\s]+/)
      .map((w) => w.trim())
      .filter((w) => /^[a-z-]+$/.test(w));
    expect(named.length).toBeGreaterThan(0);
    for (const line of named) {
      expect(CITABLE_CARRIER_LINES).toContain(line);
    }
  });

  it('names no carrier line the resolver would refuse — including retired ones', () => {
    // `procedure-index` was in an early draft of both, and the section is never
    // rendered separately: the procedure block carries its own index. A text
    // that still advertised it would teach a citation that can only ever be
    // unresolvable.
    expect(CITATION_CONVENTION_BODY).not.toContain('procedure-index');
  });

  it('states the two things a model must not be allowed to believe', () => {
    // Both are P1/P4 obligations, not tone: a model told its citations are
    // verified would reasonably present a cited claim as checked, and a model
    // that thought a bad citation could be refused would cite defensively.
    expect(CITATION_CONVENTION_BODY).toContain('does NOT check that the record');
    expect(CITATION_CONVENTION_BODY).toContain('No reply is ever refused for citing badly');
  });
});

describe('versioning (ADR-20)', () => {
  it('the version is a hash OF THE TEXT, so an edit cannot re-assert as unchanged', () => {
    expect(CITATION_CONVENTION_VERSION).toMatch(/^cnv_[0-9a-f]{12}$/);
    const { createHash } = require('crypto');
    const expected = `cnv_${createHash('sha256')
      .update(CITATION_CONVENTION_BODY, 'utf8')
      .digest('hex')
      .slice(0, 12)}`;
    expect(CITATION_CONVENTION_VERSION).toBe(expected);
  });

  it('the full block carries the version; the re-assert names it and nothing else', () => {
    expect(renderCitationConventionBlock()).toContain(CITATION_CONVENTION_VERSION);
    expect(renderCitationConventionBlock()).toContain(CITATION_CONVENTION_BODY);

    const reassert = renderCitationConventionReassert();
    expect(reassert).toContain(CITATION_CONVENTION_VERSION);
    // The re-assert must be a LINE, not a quiet re-ship of the block.
    expect(reassert.split('\n')).toHaveLength(1);
    expect(reassert).not.toContain('[[cite:');
  });
});
