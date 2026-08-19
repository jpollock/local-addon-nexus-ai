/**
 * WP-38 · the renderer's half of ADR-24 — the corroboration render's model.
 *
 * `from-designer-07-corroboration-render.md` is the sheet; its eight pins and
 * the four rulings of `for-designer-corroboration-response.md` are this
 * module's acceptance criteria. The one sentence that governs every line below
 * is the sheet's own:
 *
 *   > The render draws what the model marked and nothing else.
 *
 * So there is no similarity matching here, no classifier, no reclassification,
 * and no arithmetic that is not a count of spans the model itself wrote. Every
 * state on the screen is `resolveCitations`'s answer, and this file's whole job
 * is to turn those answers into segments, faces and sentences.
 *
 * WHY THIS FILE IMPORTS THE JOIN INSTEAD OF MIRRORING IT.
 *
 * `procedureModel.ts` next door does the opposite — it takes `procedureView`'s
 * shapes as types and MIRRORS its four values — because that seam reaches the
 * intelligence core, and the core reaches better-sqlite3, which under Electron
 * is the wrong ABI. This seam is different in kind, and deliberately so:
 * ADR-24 P5 says the judge and the user resolve through ONE join, because "the
 * eval says it resolves" and "the surface drew a quiet link" must not be able
 * to come apart. A mirror here would be exactly the second implementation that
 * pin forbids. WP-34 made the import safe rather than assuming it: the join has
 * ZERO runtime imports — every import in it is `import type`, erased at emit —
 * and two suites MEASURE that (`citationJoin.isolation.test.ts` reads both the
 * module graph and the source, because a graph walk cannot see node builtins;
 * `procedureModel.isolation.test.ts` re-measures it from the renderer side).
 *
 * Controlled Vocabulary: a citation RESOLVES or is UNRESOLVABLE; a record is
 * SUPPLIED to a task; a claim is LINKED. The render never says *verified* of a
 * citation — the platform checks existence and refuses to check support, and
 * "verified" is the word that would erase that distinction.
 */
import {
  resolveCitations,
  tallyCitations,
  type CitationRecord,
  type CitationRef,
  type CitationResolution,
  type CitationState,
  type CitationSupply,
} from '../../../intelligence/citation/resolve';

export type {
  CitationRecord,
  CitationRef,
  CitationResolution,
  CitationState,
  CitationSupply,
};

// ---------------------------------------------------------------------------
// Strictness comes from the moment, not from the renderer (pin 4)
// ---------------------------------------------------------------------------

/**
 * The moments whose citation strictness the loop has actually RULED.
 *
 * `moments-model.md` names six. The sheet rules exactly two of them — "Investigate
 * renders an uncited factual claim loudly, and Glance renders no citations at all"
 * — and this type is those two and nothing else. The other four (Inspect,
 * Act-small, Act-big, Return) are UNRULED: widening this union is a question for
 * the vocabulary loop, not a default a renderer gets to pick, and a default
 * picked here would be the renderer setting strictness, which is the one thing
 * pin 4 says it may not do.
 *
 * `citationModel.test.ts` pins the union at these two AND pins the other four
 * ABSENT — the census-guard shape WP-20f used for capabilities, for the same
 * reason: an absence that is only an omission gets filled in by the next edit.
 */
export type CitationMoment = 'glance' | 'investigate';

export const CITATION_MOMENTS: readonly CitationMoment[] = ['glance', 'investigate'];

/** What a moment does with citations. Two ruled behaviours, named as behaviours. */
export type CitationStrictness = 'renders-none' | 'renders-all';

export const STRICTNESS_BY_MOMENT: Record<CitationMoment, CitationStrictness> = {
  // "Glance renders none: every count here is derived and dated where it sits,
  // and a glance that argues its sources is no longer a glance."
  glance: 'renders-none',
  // "Investigate renders an uncited factual claim loudly" — all three states.
  investigate: 'renders-all',
};

// ---------------------------------------------------------------------------
// Whether this reply is under the convention at all
// ---------------------------------------------------------------------------

/**
 * Four states, and the last two are the reason this is a function rather than a
 * boolean.
 *
 * - `in-effect` — the manifest names a convention. Render the states.
 * - `did-not-ride` — `citation: null`. WP-34's own words: "a bare carrier, or a
 *   fail-closed refusal. It never means one rode and is not being named."
 * - `predates-convention` — the manifest has NO `citation` key. This is the
 *   sheet's legacy card, and it is derived from the RECORD's shape, never from
 *   the text. The precedent is one field up in the same interface: `routing?` is
 *   "absent entirely when the request carried no frame — an empty array would
 *   claim routing ran and found nothing, which is a different fact from *this
 *   caller predates the frame*". Absent and null are different facts here too.
 * - `unknown` — there is no manifest at all. A surface with no record in hand
 *   must say nothing; rendering the legacy sentence here would announce that a
 *   session predates a convention on the strength of the panel not having been
 *   handed anything, which is the same class of lie the sheet exists to prevent.
 */
export type ConventionState =
  | 'in-effect'
  | 'did-not-ride'
  | 'predates-convention'
  | 'unknown';

/** The one manifest field this surface reads. Shaped as `BundleManifest.citation`. */
export interface CitationManifestField {
  convention: string;
  asserted: 'full' | 'hash';
}

export function conventionState(manifest: unknown): ConventionState {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object') {
    return 'unknown';
  }
  if (!Object.prototype.hasOwnProperty.call(manifest, 'citation')) {
    return 'predates-convention';
  }
  const citation = (manifest as { citation?: unknown }).citation;
  // A key that is present and empty says "no convention rode this turn". A
  // producer cannot write `undefined` here (the field's type is `{…} | null`
  // and JSON carries null), but reading it as `did-not-ride` rather than as
  // `predates` keeps a serialization artifact from ever printing the legacy card.
  return citation === null || citation === undefined ? 'did-not-ride' : 'in-effect';
}

// ---------------------------------------------------------------------------
// The copy. Every string below is ratified, derived, or named as neither.
// ---------------------------------------------------------------------------

/**
 * The legacy card, VERBATIM from `from-designer-07` §4b. Not paraphrased and not
 * softened: "An old session must not render as though every sentence chose to go
 * uncited" is the whole point, and the sentence the designer wrote is the one
 * that says it.
 */
export const PREDATES_CONVENTION_NOTICE =
  'This session predates the citation convention. Nothing in it is linked, and ' +
  'the platform cannot say now what supplied each sentence. Read it as a ' +
  'transcript, not as evidence.';

/**
 * The unresolved panel, VERBATIM from `from-designer-07` §4a.
 *
 * Used for `not-in-supply` only — the sentence's subject is "this id", and a
 * marker the platform could not READ has no id.
 */
export const UNRESOLVED_NOT_IN_SUPPLY =
  'No record with this id was supplied to this task. The claim above may still ' +
  'be true — the platform cannot say, and will not guess.';

/**
 * The other half of the closed `reason` channel, which the sheet does not draw.
 *
 * DERIVED, not invented: the second sentence is the designer's verbatim, and
 * only the first is replaced — because its premise ("this id") is false when
 * the body did not parse. Held at the gate as new copy; the alternative was
 * printing the ratified sentence about an id that does not exist.
 */
export const UNRESOLVED_MALFORMED =
  'The platform could not read this marker, so it cannot say which record was ' +
  'meant. The claim above may still be true — the platform cannot say, and ' +
  'will not guess.';

/** The peek's note, VERBATIM from `from-designer-07` §4a. */
export const RECORD_PEEK_NOTE =
  'A citation is a route, not a copy. The reply never renders the record’s ' +
  'contents — this is identity, trust label, and the door.';

/** The peek's door, VERBATIM. Ruling §4: honest-and-technical, never authored. */
export const RECORD_DOOR_LABEL = 'Open in the record, against its runbook';

/** The unresolved panel's door. The sheet: "a door to search the ledger for the id". */
export const LEDGER_SEARCH_DOOR_LABEL = 'Search the ledger for this id';

/**
 * What a chip prints for `[[cite:none]]`.
 *
 * The sheet's own marker cell for that row is "*no record*". A number, a
 * percentage or a traffic light would all be the confidence this render does not
 * have.
 */
export const NO_RECORD_LABEL = 'no record';

/**
 * The derived supply sentence — ruling §3.
 *
 * "Supplied to this task by the ledger" is ratified as drawn, and it is derived
 * rather than invented: `supplied` is XD-7's ruled relationship and the ledger is
 * where an `evt_` record lives. The other two kinds extend the SAME derivation
 * using the join's own nouns for them ("a tool call of this task", "a carrier
 * section that actually rendered this turn"), because the sheet's specimen is an
 * event and the render must still answer for the two kinds it did not draw.
 *
 * The record's machine trust class (`emitted`, `told`) is carried through
 * verbatim in the data and NEVER printed: ruling §3 — "no bare machine words on
 * the chip and no invented softening either". The day two trust classes must be
 * visibly different is a vocabulary row to propose, not a word to coin here.
 */
export const SUPPLY_SENTENCE: Record<CitationRecord['kind'], string> = {
  event: 'Supplied to this task by the ledger.',
  tool: 'Supplied to this task by a tool call this task made.',
  carrier: 'Supplied to this task by the platform context of this turn.',
};

// ---------------------------------------------------------------------------
// Segments — the reply, cut at the offsets the join reported
// ---------------------------------------------------------------------------

export type CitationSegment =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; resolution: CitationResolution };

/**
 * Cut the reply into runs of prose and the markers between them.
 *
 * The cuts are `ParsedCitation.start`/`end` — the join's own offsets, which is
 * what they exist for ("where the claim ended and the door goes"). Nothing here
 * searches the text for anything: a second parser in the render path is the
 * NLP the sheet forbids, wearing a smaller hat.
 *
 * Text between two markers is preserved EXACTLY, including whitespace, so the
 * uncited glue of the sheet's fifth row passes through untouched.
 */
export function segmentReply(reply: string, supply: CitationSupply): CitationSegment[] {
  const out: CitationSegment[] = [];
  let cursor = 0;
  for (const resolution of resolveCitations(reply, supply)) {
    const { start, end } = resolution.citation;
    if (start > cursor) out.push({ kind: 'text', text: reply.slice(cursor, start) });
    out.push({ kind: 'citation', resolution });
    cursor = end;
  }
  if (cursor < reply.length) out.push({ kind: 'text', text: reply.slice(cursor) });
  return out;
}

/**
 * The reply with every marker removed — what a moment that renders no citations
 * shows, and what a reply outside the convention shows.
 *
 * Built from the same segments, so the two renderings can never disagree about
 * where a marker was. Leaving the raw `[[cite:…]]` on screen was the other
 * option and is worse: it shows the convention's plumbing to a user in a moment
 * that ruled the convention out.
 */
export function stripMarkers(reply: string, supply: CitationSupply): string {
  return segmentReply(reply, supply)
    .map((s) => (s.kind === 'text' ? s.text : ''))
    .join('');
}

// ---------------------------------------------------------------------------
// The chip (design-system note: `Chip` at size=xs, in the system's own face)
// ---------------------------------------------------------------------------

/**
 * The three faces, named as the design system names them.
 *
 * Ruling §1 keeps the system's Chip in the system's face: no off-system override
 * at the exact spot where trust is the subject, and no mono variant without
 * evidence from a sitting. The mapping is the sheet's, one to one.
 */
export type ChipFace = 'neutral-subtle' | 'error-strong' | 'warning-subtle';

export const FACE_BY_STATE: Record<CitationState, ChipFace> = {
  'cited-and-resolves': 'neutral-subtle',
  'cited-but-unresolvable': 'error-strong',
  'uncited-factual-claim': 'warning-subtle',
};

export interface CitationChip {
  state: CitationState;
  face: ChipFace;
  /** What the chip prints. An identifier verbatim, or the sheet's `no record`. */
  label: string;
}

/** The id a ref names, rebuilt from the ref rather than re-parsed from the body. */
function idOfRef(ref: CitationRef): string | null {
  switch (ref.kind) {
    case 'event':
      return ref.eventId;
    case 'tool':
      return `${ref.tool}#${ref.callIndex}`;
    case 'carrier':
      return ref.line;
    case 'none':
      return null;
  }
}

/**
 * What one resolution prints and in which face.
 *
 * The resolving label is `record.id` VERBATIM. The sheet's table draws the tool
 * specimen as `wpe_backup_and_verify #2` and the join builds `name#index` with
 * no space; the join wins, because ruling §4 says the trace is the only party
 * entitled to rename a tool call, and inserting a space into an address a user
 * may copy is a rename.
 *
 * A marker the platform could not READ prints the marker verbatim. There is no
 * id to print, and printing the raw thing the model wrote is the only honest
 * answer to "what is this" — the same reasoning that keeps a malformed marker in
 * the parse result at all instead of dropping it.
 */
export function chipFor(resolution: CitationResolution): CitationChip {
  const face = FACE_BY_STATE[resolution.state];
  if (resolution.state === 'cited-and-resolves') {
    return { state: resolution.state, face, label: resolution.record.id };
  }
  if (resolution.state === 'uncited-factual-claim') {
    return { state: resolution.state, face, label: NO_RECORD_LABEL };
  }
  const id = resolution.ref ? idOfRef(resolution.ref) : null;
  return { state: resolution.state, face, label: id ?? resolution.citation.marker };
}

// ---------------------------------------------------------------------------
// The peek, and the unresolved panel
// ---------------------------------------------------------------------------

/**
 * Identity, time, the machine summary, trust label, and the door.
 *
 * WP-38 shipped this WITHOUT the sheet's time and one-line machine summary and
 * disclosed the omission rather than inventing either: the shared join carried
 * id, kind, topic and trust and nothing else. WP-43 widened `SuppliedEvent` and
 * `CitationRecord` at the source, so both are now CARRIED — never derived, and
 * never defaulted. `null` on either means the supply did not carry it, and the
 * surface then draws no line at all. An omission is honest; an invented
 * timestamp on a record peek would be the render authoring evidence, which is
 * this surface's one prohibition, and it does not become less so for being a
 * plausible value.
 *
 * Only an EVENT can populate them today, because only `SuppliedEvent` carries
 * them. A tool call's supply is a name and an index and a carrier line's is a
 * key; neither has an observation time of its own in this task's supply, and
 * the peek for those kinds draws the same three lines it always did.
 */
export interface RecordPeek {
  id: string;
  kind: CitationRecord['kind'];
  /** Carried from the supply. `null` when the supply did not carry one. */
  topic: string | null;
  /**
   * The record's trust label, VERBATIM (pin 6). Carried so a later vocabulary
   * ruling has it; never rendered, per ruling §3.
   */
  trust: string | null;
  /**
   * WP-43 · when the fact was true AT ITS SOURCE, carried verbatim as the
   * supply gave it — an ISO timestamp, not a formatted one. Formatting is the
   * surface's job and `peekTime` does it in one place; keeping the raw value
   * here means a test can pin the carry-through without pinning a locale.
   */
  observedAt: string | null;
  /** WP-43 · the one-line machine summary, carried. `null` when not supplied. */
  summary: string | null;
  supplySentence: string;
  note: string;
  doorLabel: string;
}

export function recordPeek(record: CitationRecord): RecordPeek {
  return {
    id: record.id,
    kind: record.kind,
    topic: record.topic ?? null,
    trust: record.trust ?? null,
    observedAt: record.observedAt ?? null,
    summary: record.summary ?? null,
    supplySentence: SUPPLY_SENTENCE[record.kind],
    note: RECORD_PEEK_NOTE,
    doorLabel: RECORD_DOOR_LABEL,
  };
}

/**
 * The peek's time line, or `null` when there is nothing to draw.
 *
 * Formatted in the LOCAL zone, for the reason `comparatorModel.historyLine`
 * states next door and this repo has already paid for once in the event log's
 * filenames: `toISOString()` prints the previous day for the seven hours a day
 * PDT is behind UTC. An unparseable value yields `null` rather than
 * `Invalid Date` — a surface that prints a broken timestamp beside a claim is
 * asking to be read as evidence of when something happened.
 *
 * DATE AND TIME, not date alone. The sheet's own specimen turn is an incident
 * at 02:14 whose whole argument is that an update landed seven minutes before
 * the first error; a peek that said only "8 August" would drop the half of the
 * timestamp the claim turns on.
 */
export function peekTime(peek: RecordPeek): string | null {
  if (!peek.observedAt) return null;
  const when = new Date(peek.observedAt);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface UnresolvedPanel {
  sentence: string;
  /** The id to search the ledger for, or `null` when the marker did not parse. */
  searchId: string | null;
}

export function unresolvedPanel(
  resolution: Extract<CitationResolution, { state: 'cited-but-unresolvable' }>
): UnresolvedPanel {
  if (resolution.reason === 'malformed') {
    return { sentence: UNRESOLVED_MALFORMED, searchId: null };
  }
  return {
    sentence: UNRESOLVED_NOT_IN_SUPPLY,
    searchId: resolution.ref ? idOfRef(resolution.ref) : null,
  };
}

// ---------------------------------------------------------------------------
// The tally — derived from the spans it counts, never independently computed
// ---------------------------------------------------------------------------

/**
 * The header line's phrase for one state, singular and plural.
 *
 * The designer's own header is "3 claims linked · 1 citation that does not
 * resolve · 1 fact with nothing offered"; `citationModel.test.ts` reproduces
 * that line byte for byte from the committed fixture rather than from this
 * table, so the words cannot drift from the sheet without a test going red.
 */
const TALLY_WORDS: Record<CitationState, [string, string]> = {
  'cited-and-resolves': ['claim linked', 'claims linked'],
  'cited-but-unresolvable': ['citation that does not resolve', 'citations that do not resolve'],
  'uncited-factual-claim': ['fact with nothing offered', 'facts with nothing offered'],
};

/** The order the tally reads in — the sheet's, and `CITATION_STATES`'s. */
const TALLY_ORDER: readonly CitationState[] = [
  'cited-and-resolves',
  'cited-but-unresolvable',
  'uncited-factual-claim',
];

/**
 * The tally line, or `null` when there is nothing to tally.
 *
 * Every state is printed once at least one span exists, INCLUDING at zero — the
 * shared `tallyCitations` states the reason and it is the render's reason too: a
 * tally that omits its zeroes lets a reader mistake "none of those" for "not
 * measured", and on the unresolvable row that is the difference between an
 * all-clear and a blind spot.
 *
 * With NO spans at all there is no line, because there is nothing to count — the
 * empty-container rule (XD-21, WP-35 pin 8) applied to a header: a "0 · 0 · 0"
 * strip over an ordinary answer is a container for an empty run.
 */
export function tallyLine(segments: readonly CitationSegment[]): string | null {
  const resolutions = segments
    .filter((s): s is Extract<CitationSegment, { kind: 'citation' }> => s.kind === 'citation')
    .map((s) => s.resolution);
  if (resolutions.length === 0) return null;
  const counts = tallyCitations(resolutions);
  return TALLY_ORDER.map((state) => {
    const n = counts[state];
    const [one, many] = TALLY_WORDS[state];
    return `${n} ${n === 1 ? one : many}`;
  }).join(' · ');
}

// ---------------------------------------------------------------------------
// The whole render, decided once
// ---------------------------------------------------------------------------

/** Everything the surface needs, and nothing it could compute for itself. */
export interface CitationTurn {
  /** The reply exactly as the model wrote it, markers and all. */
  reply: string;
  /** ADR-24 P1's universe: the manifest and the trace, and nothing else. */
  supply: CitationSupply;
  /**
   * The manifest of the turn that produced this reply. `undefined` when the
   * panel has none — which renders as prose, never as the legacy card.
   */
  manifest?: { citation?: CitationManifestField | null } | null;
  moment: CitationMoment;
}

/**
 * What the surface draws.
 *
 * `plain` carries its own reason so the surface cannot collapse four different
 * facts into one silent rendering, and so a test can tell them apart without
 * matching a sentence — the discriminated-union discipline the join itself uses.
 */
export type CitationRender =
  | {
      kind: 'plain';
      reason: 'moment-renders-none' | 'convention-did-not-ride' | 'convention-unknown';
      text: string;
    }
  | { kind: 'predates-convention'; text: string; notice: string }
  | { kind: 'corroborated'; segments: CitationSegment[]; tally: string | null };

/**
 * The one decision, made once.
 *
 * Order matters and is the sheet's: the MOMENT decides first ("strictness comes
 * from the moment, not the renderer"), so a Glance renders no citations even for
 * a turn that carried the convention. Only then does the record decide whether
 * this reply is under the convention at all.
 */
export function citationRender(turn: CitationTurn): CitationRender {
  if (STRICTNESS_BY_MOMENT[turn.moment] === 'renders-none') {
    return {
      kind: 'plain',
      reason: 'moment-renders-none',
      text: stripMarkers(turn.reply, turn.supply),
    };
  }
  const convention = conventionState(turn.manifest);
  if (convention === 'predates-convention') {
    return {
      kind: 'predates-convention',
      text: stripMarkers(turn.reply, turn.supply),
      notice: PREDATES_CONVENTION_NOTICE,
    };
  }
  if (convention !== 'in-effect') {
    return {
      kind: 'plain',
      reason: convention === 'did-not-ride' ? 'convention-did-not-ride' : 'convention-unknown',
      text: stripMarkers(turn.reply, turn.supply),
    };
  }
  const segments = segmentReply(turn.reply, turn.supply);
  return { kind: 'corroborated', segments, tally: tallyLine(segments) };
}
