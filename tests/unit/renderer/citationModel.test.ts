/**
 * WP-38 · the corroboration render's model — every rule ADR-24 and
 * `from-designer-07-corroboration-render.md` put on it.
 *
 * The sheet's own sentence is the subject of this file: "The render draws what
 * the model marked and nothing else." So the assertions below are mostly
 * assertions about what the model does NOT do — no classifier, no second
 * parser, no invented label, no fabricated field, no default for a moment the
 * loop has not ruled.
 */
import {
  CITATION_MOMENTS,
  FACE_BY_STATE,
  LEDGER_SEARCH_DOOR_LABEL,
  NO_RECORD_LABEL,
  PREDATES_CONVENTION_NOTICE,
  RECORD_DOOR_LABEL,
  RECORD_PEEK_NOTE,
  STRICTNESS_BY_MOMENT,
  SUPPLY_SENTENCE,
  UNRESOLVED_MALFORMED,
  UNRESOLVED_NOT_IN_SUPPLY,
  chipFor,
  citationRender,
  conventionState,
  peekTime,
  recordPeek,
  segmentReply,
  stripMarkers,
  tallyLine,
  unresolvedPanel,
  type CitationResolution,
  type CitationSupply,
} from '../../../src/renderer/components/DockedPanel/citationModel';
import {
  FIXTURE_REPLY,
  FIXTURE_SUPPLY,
  fixtureCitationTurn,
  legacyCitationTurn,
} from '../../../src/renderer/components/DockedPanel/citationTurn.fake';
import { resolveCitations } from '../../../src/intelligence/citation/resolve';

const EMPTY: CitationSupply = { events: [], toolCalls: [], carrierLines: [] };

function citations(render: ReturnType<typeof citationRender>): CitationResolution[] {
  if (render.kind !== 'corroborated') throw new Error(`expected corroborated, got ${render.kind}`);
  return render.segments
    .filter((s): s is Extract<typeof s, { kind: 'citation' }> => s.kind === 'citation')
    .map((s) => s.resolution);
}

// ---------------------------------------------------------------------------
// Pin 4 — strictness comes from the moment, not the renderer
// ---------------------------------------------------------------------------

describe('the moment decides, and only two moments have been ruled', () => {
  it('rules exactly Glance and Investigate, and pins the other four ABSENT', () => {
    // The census-guard shape: naming what IS ruled is half the assertion, and
    // the half that rots. `moments-model.md` names six moments; the sheet rules
    // two of them. An entry appearing here for Inspect, Act-small, Act-big or
    // Return would be the RENDERER choosing a strictness, which is the one thing
    // pin 4 forbids — so their absence is asserted, not merely unwritten.
    expect(Object.keys(STRICTNESS_BY_MOMENT).sort()).toEqual(['glance', 'investigate']);
    for (const unruled of ['inspect', 'act-small', 'act-big', 'return']) {
      expect(Object.prototype.hasOwnProperty.call(STRICTNESS_BY_MOMENT, unruled)).toBe(false);
    }
    expect([...CITATION_MOMENTS].sort()).toEqual(['glance', 'investigate']);
  });

  it('Glance renders NO citations, even for a turn that carried the convention', () => {
    // "a glance that argues its sources is no longer a glance" — and the moment
    // decides BEFORE the manifest does, so a fully-cited Investigate reply shown
    // at Glance still draws nothing.
    const render = citationRender(fixtureCitationTurn({ moment: 'glance' }));
    expect(render.kind).toBe('plain');
    expect(render.kind === 'plain' && render.reason).toBe('moment-renders-none');
  });

  it('Glance strips the markers rather than printing the convention’s plumbing', () => {
    const render = citationRender(fixtureCitationTurn({ moment: 'glance' }));
    const text = render.kind === 'plain' ? render.text : '';
    expect(text).not.toContain('[[cite:');
    // and the prose survives intact, every claim of it
    expect(text).toContain('Checkout has been returning 500s on Charlie since 02:14 this morning.');
    expect(text).toContain('That points at the gateway rather than at WooCommerce itself');
  });

  it('Investigate renders all three states', () => {
    const states = citations(citationRender(fixtureCitationTurn())).map((r) => r.state);
    expect(new Set(states)).toEqual(
      new Set(['cited-and-resolves', 'cited-but-unresolvable', 'uncited-factual-claim'])
    );
  });
});

// ---------------------------------------------------------------------------
// The legacy state — derived from the record, never inferred from text
// ---------------------------------------------------------------------------

describe('whether this reply is under the convention at all', () => {
  it('a manifest with no `citation` key predates the convention', () => {
    expect(conventionState({})).toBe('predates-convention');
    expect(conventionState({ policy: { asserted: 'full' } })).toBe('predates-convention');
  });

  it('`citation: null` is NOT the legacy state — it is a turn that taught none', () => {
    // WP-34's own words: null "means NO convention rode this turn — a bare
    // carrier, or a fail-closed refusal". Printing "this session predates the
    // citation convention" over a turn from today would be a false statement
    // about the session, made by the surface that exists to stop false
    // statements. The precedent for absent-vs-null is one field up in the same
    // interface: `routing?` is absent when the caller predates the frame.
    expect(conventionState({ citation: null })).toBe('did-not-ride');
  });

  it('no manifest at all says NOTHING — it never borrows the legacy sentence', () => {
    // The dangerous direction: an un-wired caller hands the surface no record,
    // and the surface announces that the session predates a convention on the
    // strength of not having been handed anything.
    expect(conventionState(undefined)).toBe('unknown');
    expect(conventionState(null)).toBe('unknown');
  });

  it('a named convention is in effect', () => {
    expect(conventionState({ citation: { convention: 'cnv_6c2b11952046', asserted: 'full' } }))
      .toBe('in-effect');
    expect(conventionState({ citation: { convention: 'cnv_6c2b11952046', asserted: 'hash' } }))
      .toBe('in-effect');
  });

  it('the legacy card carries the designer’s sentence verbatim and no citations', () => {
    const render = citationRender(legacyCitationTurn());
    expect(render.kind).toBe('predates-convention');
    if (render.kind !== 'predates-convention') throw new Error('unreachable');
    expect(render.notice).toBe(PREDATES_CONVENTION_NOTICE);
    expect(render.notice).toContain('Read it as a transcript, not as evidence.');
    expect(render.text).not.toContain('[[cite:');
  });

  it('a turn that taught no convention renders as prose, with its own reason', () => {
    const render = citationRender(fixtureCitationTurn({ manifest: { citation: null } }));
    expect(render.kind).toBe('plain');
    expect(render.kind === 'plain' && render.reason).toBe('convention-did-not-ride');
  });

  it('a turn with no manifest renders as prose, distinguishably', () => {
    const render = citationRender(fixtureCitationTurn({ manifest: undefined }));
    expect(render.kind).toBe('plain');
    // A separate reason, not a shared silence: the two facts lead to different
    // follow-ups, and a consumer must not have to match a sentence to tell them
    // apart — the closed-channel discipline the join's `reason` uses.
    expect(render.kind === 'plain' && render.reason).toBe('convention-unknown');
  });
});

// ---------------------------------------------------------------------------
// The segments — cut at the join's offsets, nothing searched for
// ---------------------------------------------------------------------------

describe('segments', () => {
  it('cuts the reply at the join’s own offsets and loses not one character', () => {
    const segments = segmentReply(FIXTURE_REPLY, FIXTURE_SUPPLY);
    const rebuilt = segments
      .map((s) => (s.kind === 'text' ? s.text : s.resolution.citation.marker))
      .join('');
    expect(rebuilt).toBe(FIXTURE_REPLY);
  });

  it('leaves uncited glue completely untouched', () => {
    // The sheet's fifth row: hedged inference, legitimately uncited. It carries
    // NO marker — an absence, not a fourth state — and nothing may attach one.
    const glue = 'That points at the gateway rather than at WooCommerce itself, but I have not proved it.';
    const segments = segmentReply(FIXTURE_REPLY, FIXTURE_SUPPLY);
    const carrier = segments.find((s) => s.kind === 'text' && s.text.includes(glue));
    expect(carrier).toBeDefined();
    // the glue sits inside a TEXT run, and no citation segment names it
    for (const s of segments) {
      if (s.kind === 'citation') expect(s.resolution.citation.marker).not.toContain('proved');
    }
  });

  it('a reply with no markers is one text run — not a fault, and not a state', () => {
    const segments = segmentReply('No markers here at all.', EMPTY);
    expect(segments).toEqual([{ kind: 'text', text: 'No markers here at all.' }]);
  });

  it('stripMarkers and segmentReply cannot disagree about where a marker was', () => {
    const stripped = stripMarkers(FIXTURE_REPLY, FIXTURE_SUPPLY);
    const fromSegments = segmentReply(FIXTURE_REPLY, FIXTURE_SUPPLY)
      .map((s) => (s.kind === 'text' ? s.text : ''))
      .join('');
    expect(stripped).toBe(fromSegments);
    expect(stripped).not.toContain('[[cite:');
  });
});

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

describe('the chip', () => {
  const byState = (state: string) =>
    citations(citationRender(fixtureCitationTurn())).find((r) => r.state === state)!;

  it('maps the three states onto the sheet’s three faces, one to one', () => {
    expect(FACE_BY_STATE).toEqual({
      'cited-and-resolves': 'neutral-subtle',
      'cited-but-unresolvable': 'error-strong',
      'uncited-factual-claim': 'warning-subtle',
    });
  });

  it('a resolving citation prints the record’s id VERBATIM', () => {
    expect(chipFor(byState('cited-and-resolves'))).toEqual({
      state: 'cited-and-resolves',
      face: 'neutral-subtle',
      label: 'evt_9c41',
    });
  });

  it('a tool call keeps the trace’s own address — no space inserted into it', () => {
    // Ruling §4: the trace is the only party entitled to rename a tool call. The
    // sheet's table draws `wpe_backup_and_verify #2`; the address a user can
    // copy is `wpe_backup_and_verify#2`, and the address wins.
    const tool = citations(citationRender(fixtureCitationTurn())).find(
      (r) => r.state === 'cited-and-resolves' && r.record.kind === 'tool'
    )!;
    expect(chipFor(tool).label).toBe('wpe_backup_and_verify#2');
  });

  it('an unresolvable citation prints the id it named, in the loudest face', () => {
    expect(chipFor(byState('cited-but-unresolvable'))).toEqual({
      state: 'cited-but-unresolvable',
      face: 'error-strong',
      label: 'evt_8e90',
    });
  });

  it('an unreadable marker prints the marker itself — there is no id to print', () => {
    const [malformed] = resolveCitations('A claim. [[cite:???]]', EMPTY);
    expect(chipFor(malformed)).toEqual({
      state: 'cited-but-unresolvable',
      face: 'error-strong',
      label: '[[cite:???]]',
    });
  });

  it('`[[cite:none]]` prints the sheet’s own words, never a number', () => {
    expect(chipFor(byState('uncited-factual-claim'))).toEqual({
      state: 'uncited-factual-claim',
      face: 'warning-subtle',
      label: NO_RECORD_LABEL,
    });
    expect(NO_RECORD_LABEL).toBe('no record');
  });
});

// ---------------------------------------------------------------------------
// The peek — identity, trust label, and the door. Never contents.
// ---------------------------------------------------------------------------

describe('the record peek', () => {
  const resolving = () =>
    citations(citationRender(fixtureCitationTurn())).find(
      (r) => r.state === 'cited-and-resolves'
    )! as Extract<CitationResolution, { state: 'cited-and-resolves' }>;

  it('carries identity, the topic it was supplied with, and the derived sentence', () => {
    // WP-43 widened this by two fields (`observedAt`, `summary`). The fixture
    // supply carries neither, so both are NULL here — which is the honest-
    // absence half of the widening asserted in the same breath as the rest.
    expect(recordPeek(resolving().record)).toEqual({
      id: 'evt_9c41',
      kind: 'event',
      topic: 'incident.opened',
      trust: 'emitted',
      observedAt: null,
      summary: null,
      supplySentence: 'Supplied to this task by the ledger.',
      note: RECORD_PEEK_NOTE,
      doorLabel: RECORD_DOOR_LABEL,
    });
  });

  it('inherits the record’s trust label VERBATIM and invents none', () => {
    // Pin 6. The label is carried, never authored — and the day two trust
    // classes must be visibly different is a vocabulary row to propose, which is
    // why nothing here translates `emitted` into a friendlier word.
    const peek = recordPeek({ kind: 'event', id: 'evt_x', trust: 'told' });
    expect(peek.trust).toBe('told');
    const unlabelled = recordPeek({ kind: 'event', id: 'evt_y' });
    expect(unlabelled.trust).toBeNull();
    expect(unlabelled.topic).toBeNull();
  });

  it('derives one supply sentence per kind, from the join’s own nouns', () => {
    expect(SUPPLY_SENTENCE.event).toBe('Supplied to this task by the ledger.');
    expect(recordPeek({ kind: 'tool', id: 'wp_plugin_list#1' }).supplySentence)
      .toBe(SUPPLY_SENTENCE.tool);
    expect(recordPeek({ kind: 'carrier', id: 'freshness' }).supplySentence)
      .toBe(SUPPLY_SENTENCE.carrier);
    for (const sentence of Object.values(SUPPLY_SENTENCE)) {
      expect(sentence.startsWith('Supplied to this task by ')).toBe(true);
    }
  });

  it('is a ROUTE, never a copy — the note says so and no field carries contents', () => {
    // THE CENSUS MOVED ONCE, AND ONLY ONCE, AND THIS IS THE ARGUMENT.
    //
    // WP-38 wrote this list with `summary` on the FORBIDDEN side. That was
    // right at the time and for a reason that has since changed: the join
    // carried no summary, so the only way one could have appeared here was for
    // the render to compose it — which is authoring, and is what the forbidden
    // list is for. WP-43 widened `SuppliedEvent` at the source, so `summary` is
    // now CARRIED, and it is carried from the field the sheet itself asks the
    // peek to draw: "identity, topic, time, the derived supply sentence, a
    // one-line machine summary and the door."
    //
    // The distinction the list is really drawing is between the record's
    // CONTENTS and a bounded line ABOUT the record. `summary` is WP-13c's:
    // composed from an explicit allow-list of payload fields, never a dump,
    // and already shown to the model. `body`, `payload`, `contents` and `text`
    // remain forbidden and are asserted below — a copy is still a second place
    // a fact can be wrong, and the note above the peek still says so.
    const peek = recordPeek(resolving().record);
    expect(peek.note).toContain('A citation is a route, not a copy.');
    expect(Object.keys(peek).sort()).toEqual(
      ['doorLabel', 'id', 'kind', 'note', 'observedAt', 'summary', 'supplySentence', 'topic', 'trust'].sort()
    );
    for (const forbidden of ['body', 'payload', 'contents', 'text']) {
      expect(Object.prototype.hasOwnProperty.call(peek, forbidden)).toBe(false);
    }
  });

  it('carries the widened fields VERBATIM, and null when the supply had none', () => {
    // WP-43. Same discipline as `trust` one test up: carried, never authored.
    const full = recordPeek({
      kind: 'event',
      id: 'evt_z',
      observedAt: '2026-08-13T09:41:00.000Z',
      summary: 'woocommerce 9.1.4 → 9.2.1; resolved',
    });
    expect(full.observedAt).toBe('2026-08-13T09:41:00.000Z');
    expect(full.summary).toBe('woocommerce 9.1.4 → 9.2.1; resolved');
    const bare = recordPeek({ kind: 'tool', id: 'wp_plugin_list#1' });
    expect(bare.observedAt).toBeNull();
    expect(bare.summary).toBeNull();
  });

  it('formats the time in the LOCAL zone, and refuses a value it cannot read', () => {
    // `toISOString()` here would print the previous day for the seven hours a
    // day PDT is behind UTC — this repo has paid for that once, in the event
    // log's filenames, and `comparatorModel.historyLine` says so next door.
    const at = '2026-08-13T09:41:00.000Z';
    const peek = recordPeek({ kind: 'event', id: 'evt_z', observedAt: at });
    expect(peekTime(peek)).toBe(
      new Date(at).toLocaleString(undefined, {
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      })
    );
    // Null rather than "Invalid Date": a broken timestamp beside a claim is
    // asking to be read as evidence of when something happened.
    expect(peekTime(recordPeek({ kind: 'event', id: 'evt_z', observedAt: 'not a date' }))).toBeNull();
    expect(peekTime(recordPeek({ kind: 'event', id: 'evt_z' }))).toBeNull();
  });
});

describe('the unresolved panel', () => {
  it('states the limit and refuses to guess, verbatim', () => {
    const unresolved = citations(citationRender(fixtureCitationTurn())).find(
      (r) => r.state === 'cited-but-unresolvable'
    )! as Extract<CitationResolution, { state: 'cited-but-unresolvable' }>;
    expect(unresolvedPanel(unresolved)).toEqual({
      sentence: UNRESOLVED_NOT_IN_SUPPLY,
      searchId: 'evt_8e90',
    });
    expect(UNRESOLVED_NOT_IN_SUPPLY).toContain('the platform cannot say, and will not guess.');
    expect(LEDGER_SEARCH_DOOR_LABEL).toBe('Search the ledger for this id');
  });

  it('says something DIFFERENT when the marker could not be read, and offers no id', () => {
    // The ratified sentence's subject is "this id". A marker the platform could
    // not parse has none, so the first sentence is replaced and the second — the
    // designer's — is kept word for word.
    const [malformed] = resolveCitations('A claim. [[cite:???]]', EMPTY);
    const panel = unresolvedPanel(malformed as Extract<CitationResolution, { state: 'cited-but-unresolvable' }>);
    expect(panel).toEqual({ sentence: UNRESOLVED_MALFORMED, searchId: null });
    expect(panel.sentence).not.toBe(UNRESOLVED_NOT_IN_SUPPLY);
    expect(panel.sentence).toContain('the platform cannot say, and will not guess.');
  });
});

// ---------------------------------------------------------------------------
// The tally — derived from the spans it counts
// ---------------------------------------------------------------------------

describe('the tally', () => {
  it('reproduces the designer’s header line exactly', () => {
    const render = citationRender(fixtureCitationTurn());
    expect(render.kind === 'corroborated' && render.tally).toBe(
      '3 claims linked · 1 citation that does not resolve · 1 fact with nothing offered'
    );
  });

  it('prints every state even at zero, once anything is counted', () => {
    // `tallyCitations`'s own reason, and the render's: a tally that omits its
    // zeroes lets a reader mistake "none of those" for "not measured", which on
    // the unresolvable row is an all-clear standing in for a blind spot.
    const line = tallyLine(
      segmentReply('One claim. [[cite:evt_a]]', { ...EMPTY, events: [{ id: 'evt_a' }] })
    );
    expect(line).toBe(
      '1 claim linked · 0 citations that do not resolve · 0 facts with nothing offered'
    );
  });

  it('opens NO container for a reply with no spans', () => {
    // XD-21 applied to a header: "0 · 0 · 0" over an ordinary answer is a
    // container for an empty run.
    expect(tallyLine(segmentReply('Just an answer.', EMPTY))).toBeNull();
    const render = citationRender(fixtureCitationTurn({ reply: 'Just an answer.' }));
    expect(render.kind === 'corroborated' && render.tally).toBeNull();
  });

  it('counts spans and nothing else — the tally has no opinion about the text', () => {
    const render = citationRender(fixtureCitationTurn());
    const counted = citations(render).length;
    // Five markers, six rows on the sheet: the sixth row is glue and carries no
    // marker, so it is counted nowhere. A tally that reached six would be the
    // render classifying a sentence.
    expect(counted).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// The must-nots, as assertions
// ---------------------------------------------------------------------------

describe('what this model may never do', () => {
  it('never resolves a citation the supply does not carry, however similar the text', () => {
    // The one thing a plausibility matcher would get right and this must get
    // wrong: the claim names the event's own topic word for word, and the record
    // is still not in the supply.
    const [only] = resolveCitations(
      'The incident was opened at 02:14. [[cite:evt_9c41]]',
      { ...EMPTY, events: [{ id: 'evt_other', topic: 'incident.opened' }] }
    );
    expect(only.state).toBe('cited-but-unresolvable');
  });

  it('never reclassifies: the same reply resolved twice gives the same states', () => {
    const once = citations(citationRender(fixtureCitationTurn())).map((r) => r.state);
    const twice = citations(citationRender(fixtureCitationTurn())).map((r) => r.state);
    expect(once).toEqual(twice);
  });

  it('never refuses: an unresolvable citation still renders its claim', () => {
    const render = citationRender(fixtureCitationTurn());
    const text = render.kind === 'corroborated'
      ? render.segments.map((s) => (s.kind === 'text' ? s.text : '')).join('')
      : '';
    expect(text).toContain('payment-gateway-x was updated on the same site forty minutes earlier.');
  });

  it('never links retroactively: a legacy reply gets no citations even with a full supply', () => {
    const render = citationRender(legacyCitationTurn());
    expect(render.kind).toBe('predates-convention');
  });

  it('carries no confidence anywhere in its vocabulary', () => {
    const strings = [
      PREDATES_CONVENTION_NOTICE,
      UNRESOLVED_NOT_IN_SUPPLY,
      UNRESOLVED_MALFORMED,
      RECORD_PEEK_NOTE,
      RECORD_DOOR_LABEL,
      LEDGER_SEARCH_DOOR_LABEL,
      NO_RECORD_LABEL,
      ...Object.values(SUPPLY_SENTENCE),
    ].join(' ');
    expect(strings).not.toMatch(/\bconfidence\b|\bscore\b|\d+\s*%|\blikel(y|ihood)\b|\bprobab/i);
    // and never the live check's word about a citation
    expect(strings).not.toMatch(/\bverified\b/i);
  });
});
