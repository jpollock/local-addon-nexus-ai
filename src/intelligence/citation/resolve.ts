/**
 * WP-34 · ADR-24's claim→record join. ONE join, two consumers (P5).
 *
 * The eval sheet imports this today; the M5 corroboration render imports the
 * same functions later. That is the PROCEDURE_AUDIT_COLUMNS precedent applied
 * to citations: the judge and the user resolve through one piece of code, so
 * "the eval says it resolves" and "the surface drew a quiet link" cannot come
 * apart. Two implementations of one join would drift on the first edit, and the
 * drift would be invisible — both halves would still look right.
 *
 * WHAT THIS FILE DOES: parse the markers a model emitted, and ask of each one
 * whether the record it names was SUPPLIED to this task.
 *
 * WHAT IT MUST NEVER DO: read the claim. Nothing here compares a sentence to a
 * record, scores a similarity, or forms an opinion about whether the record
 * backs what was said. That is P1 ("verified for EXISTENCE, never for support")
 * and P4 ("anything wanting the gateway to judge citation quality is refused by
 * this note"). A join that guessed would be a plausibility matcher wearing
 * evidence's clothes — the exact dishonesty the surface exists to prevent.
 *
 * RENDERER-SAFE BY CONSTRUCTION (ADR-16). This module has ZERO runtime imports:
 * no electron, no `src/main`, no node builtins, not even the rest of the core.
 * The hashing and the carrier text live next door in `convention.ts`, which is
 * core-only for exactly that reason — `createHash` in a renderer bundle is a
 * polyfill, and a polyfill is a second implementation. `citation.isolation.
 * test.ts` MEASURES the emptiness rather than asserting it, because purity is
 * one careless value-import away from being false and nothing would fail until
 * somebody opened the panel.
 */

// ---------------------------------------------------------------------------
// The convention's grammar
// ---------------------------------------------------------------------------

/**
 * The marker, as the model writes it: `[[cite:<body>]]`.
 *
 * Three properties, each of them load-bearing rather than stylistic:
 *
 *  - **The literal word `cite`.** It is what makes the marker impossible to
 *    confuse with user content. `[[…]]` alone is a wiki link and appears in
 *    real WordPress posts; `[[cite:` followed by a body this grammar accepts
 *    does not occur in prose by accident. Retrieved site content rides the
 *    carrier wrapped as untrusted data, so it CAN be echoed into a reply —
 *    the discriminator has to survive that, not merely be tidy.
 *  - **No newline inside.** An unclosed `[[cite:` cannot swallow the rest of
 *    the reply and turn a whole answer into one malformed citation.
 *  - **A bounded body.** The class is negated and capped, so the expression
 *    cannot backtrack catastrophically over an adversarial reply.
 *
 * `[[ cite:… ]]` with spaces deliberately does NOT match. One spelling, so a
 * marker either is the convention or is not; a lenient parser here would make
 * the render's states depend on whitespace.
 */
const MARKER = /\[\[cite:([^[\]\n]{1,160})\]\]/g;

/** A ledger event of this task's supply. Ids are opaque — existence decides. */
const EVENT_BODY = /^(evt_[A-Za-z0-9_-]{1,64})$/;
/** A tool call of this task: name, `#`, then WHICH call of that tool, from 1. */
const TOOL_BODY = /^tool:([a-z][a-z0-9_]{0,63})#([1-9][0-9]{0,3})$/;
/** A line of the platform carrier that rode this turn. */
const CARRIER_BODY = /^carrier:([a-z][a-z0-9._-]{0,63})$/;
/** An explicit "I am stating a fact and nothing above supplies it". */
const NONE_BODY = 'none';

/**
 * The carrier sections a claim may cite, in the order the carrier renders them.
 *
 * A CLOSED vocabulary, because "addressable" has to mean something a resolver
 * can check. Section grain, not constraint grain: a finer address (a single
 * policy constraint id, one freshness fact) is a real want and is recorded as a
 * follow-up rather than guessed at here — widening an address space later is
 * additive, narrowing one is not.
 */
export const CITABLE_CARRIER_LINES = [
  'policy',
  'procedure',
  'routing',
  'freshness',
  'retrieved',
] as const;

export type CitableCarrierLine = (typeof CITABLE_CARRIER_LINES)[number];

// ---------------------------------------------------------------------------
// What a marker refers to
// ---------------------------------------------------------------------------

/**
 * The citation's KIND, addressable in the parse result rather than sniffed
 * back out of the id by whoever consumes it.
 *
 * This is the constraint the designer's ratification flowed back into the
 * convention (`for-designer-corroboration-response.md` §2): the render is a
 * TRAILING door at the end of the claim, and a door has to know both what it
 * points at and what kind of thing that is. A consumer re-deriving the kind
 * from the id's shape would be a second parser, and the day an id scheme
 * changes the two would disagree.
 */
export type CitationRef =
  | { kind: 'event'; eventId: string }
  | { kind: 'tool'; tool: string; callIndex: number }
  | { kind: 'carrier'; line: string }
  | { kind: 'none' };

export interface ParsedCitation {
  /** The marker exactly as it appeared, for a render that replaces it in place. */
  marker: string;
  /** Offsets into the source text — where the claim ended and the door goes. */
  start: number;
  end: number;
  /** The body between `[[cite:` and `]]`, verbatim. Kept even when it is junk. */
  body: string;
  /**
   * `null` when the body did not parse. Not dropped: a marker the model wrote
   * and the platform could not read is a fact about the reply, and a parser
   * that silently discarded it would render that claim as though the model had
   * never tried to cite anything.
   */
  ref: CitationRef | null;
}

// ---------------------------------------------------------------------------
// What the task supplied
// ---------------------------------------------------------------------------

/**
 * A ledger event that rode this task. `topic` and `trust` are carried THROUGH,
 * never invented: ADR-24 gives the citation the cited record's trust label
 * verbatim, and a resolver that filled in a plausible label would be authoring
 * the one field the surface exists to prove it does not author.
 */
export interface SuppliedEvent {
  id: string;
  topic?: string;
  trust?: string;
}

/** A tool call of this task. `index` counts that tool's calls, from 1. */
export interface SuppliedToolCall {
  name: string;
  index: number;
}

/** A carrier section that actually rendered this turn. */
export interface SuppliedCarrierLine {
  key: string;
  label?: string;
}

/**
 * THE UNIVERSE (P1): the manifest and the trace, and nothing else.
 *
 * Everything a citation may resolve against is here. There is no fallback
 * lookup, no "check the ledger too" — a record that did not ride this task is
 * not part of this task's supply even if it exists on disk, because the claim
 * being checked is "the model cited something it was given".
 */
export interface CitationSupply {
  events: readonly SuppliedEvent[];
  toolCalls: readonly SuppliedToolCall[];
  carrierLines: readonly SuppliedCarrierLine[];
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** ADR-24's three states, in the note's own words. */
export const CITATION_STATES = [
  'cited-and-resolves',
  'cited-but-unresolvable',
  'uncited-factual-claim',
] as const;

export type CitationState = (typeof CITATION_STATES)[number];

/**
 * Why a citation did not resolve — a CLOSED machine channel, not a message.
 *
 * `malformed` (the platform could not read what was written) and
 * `not-in-supply` (it read it fine and nobody supplied that record) are
 * different facts about the reply and lead to different follow-ups. A consumer
 * telling them apart by matching words in a sentence is the string-matching the
 * packet's own contract forbids.
 */
export type UnresolvableReason = 'malformed' | 'not-in-supply';

/** Identity, kind and trust label — a ROUTE to the record, never a copy of it. */
export interface CitationRecord {
  kind: 'event' | 'tool' | 'carrier';
  /** The record's own id, as the render prints it. */
  id: string;
  /** Carried through from the supply. Absent when the supply did not carry it. */
  topic?: string;
  trust?: string;
}

/**
 * The join's answer for one marker.
 *
 * A DISCRIMINATED UNION on `state`, and the payloads differ per arm on purpose:
 * `record` exists only where a record was found, `reason` only where none was.
 * A consumer therefore cannot read a record off an unresolvable citation — the
 * compiler stops it — and cannot tell the states apart by matching a string,
 * which is what the packet requires of this return shape.
 */
export type CitationResolution =
  | { state: 'cited-and-resolves'; citation: ParsedCitation; ref: CitationRef; record: CitationRecord }
  | {
      state: 'cited-but-unresolvable';
      citation: ParsedCitation;
      ref: CitationRef | null;
      reason: UnresolvableReason;
    }
  | { state: 'uncited-factual-claim'; citation: ParsedCitation };

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

function refFor(body: string): CitationRef | null {
  if (body === NONE_BODY) return { kind: 'none' };

  const event = EVENT_BODY.exec(body);
  if (event) return { kind: 'event', eventId: event[1] };

  const tool = TOOL_BODY.exec(body);
  if (tool) return { kind: 'tool', tool: tool[1], callIndex: Number(tool[2]) };

  const carrier = CARRIER_BODY.exec(body);
  if (carrier) return { kind: 'carrier', line: carrier[1] };

  return null;
}

/**
 * Every marker in a reply, in the order it appears.
 *
 * Total and side-effect free: any text is valid input, and text containing no
 * markers yields an empty array rather than an error. An uncited reply is a
 * state, not a fault (P3).
 */
export function parseCitations(text: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  // A fresh regex per call: `MARKER` carries /g, and a shared lastIndex across
  // calls would make the second parse of the same string return nothing.
  const re = new RegExp(MARKER.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    out.push({
      marker: m[0],
      start: m.index,
      end: m.index + m[0].length,
      body,
      ref: refFor(body),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

function recordFor(ref: CitationRef, supply: CitationSupply): CitationRecord | null {
  switch (ref.kind) {
    case 'event': {
      const hit = supply.events.find((e) => e.id === ref.eventId);
      if (!hit) return null;
      return {
        kind: 'event',
        id: hit.id,
        ...(hit.topic !== undefined ? { topic: hit.topic } : {}),
        ...(hit.trust !== undefined ? { trust: hit.trust } : {}),
      };
    }
    case 'tool': {
      const hit = supply.toolCalls.find(
        (t) => t.name === ref.tool && t.index === ref.callIndex
      );
      if (!hit) return null;
      return { kind: 'tool', id: `${hit.name}#${hit.index}` };
    }
    case 'carrier': {
      const hit = supply.carrierLines.find((c) => c.key === ref.line);
      if (!hit) return null;
      return { kind: 'carrier', id: hit.key };
    }
    case 'none':
      return null;
  }
}

/**
 * Resolve every marker in a reply against this task's supply.
 *
 * The whole contract in four lines of behaviour: a body that did not parse is
 * unresolvable-because-malformed; `[[cite:none]]` is the third state; a ref
 * naming a record in the supply resolves and carries that record's identity;
 * anything else is unresolvable-because-nobody-supplied-it, which the render
 * draws as the loudest state on the surface.
 */
export function resolveCitations(
  text: string,
  supply: CitationSupply
): CitationResolution[] {
  return parseCitations(text).map((citation): CitationResolution => {
    const ref = citation.ref;
    if (!ref) {
      return { state: 'cited-but-unresolvable', citation, ref: null, reason: 'malformed' };
    }
    if (ref.kind === 'none') {
      return { state: 'uncited-factual-claim', citation };
    }
    const record = recordFor(ref, supply);
    return record
      ? { state: 'cited-and-resolves', citation, ref, record }
      : { state: 'cited-but-unresolvable', citation, ref, reason: 'not-in-supply' };
  });
}

/**
 * Counts per state — the header tally the render derives from the spans it
 * counts, and the number the eval reports.
 *
 * Every state is present even at zero. A tally that omits its zeroes lets a
 * reader mistake "none of those" for "not measured", which on the unresolvable
 * row is the difference between an all-clear and a blind spot.
 */
export function tallyCitations(
  resolutions: readonly CitationResolution[]
): Record<CitationState, number> {
  const counts = {
    'cited-and-resolves': 0,
    'cited-but-unresolvable': 0,
    'uncited-factual-claim': 0,
  } as Record<CitationState, number>;
  for (const r of resolutions) counts[r.state]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Building the universe
// ---------------------------------------------------------------------------

/**
 * TYPE-ONLY, and that is load-bearing rather than stylistic: TypeScript elides
 * a type-only import entirely, so this file keeps its zero runtime imports and
 * stays safe to pull into a renderer bundle. `citation.isolation.test.ts`
 * MEASURES that (require.cache, not a promise), because WP-24's finding is
 * exactly that an `import type` looks like an import and compiles to nothing.
 */
import type { ContextBundle } from '../assemble/types';

/**
 * The task's supply, read off the bundle the assembler produced — P1's universe
 * for the two of its three kinds the platform can know without the trace.
 *
 * `toolCalls` is a PARAMETER, not a derivation: the manifest's `tools` field is
 * `[]` by the assembler's v0 contract and says nothing about what the actor
 * then called. The trace is the caller's to supply, and passing none means "no
 * tool call is citable this task" — which is true of the assembly moment, and
 * is why an eval that judges tool citations has to hand its trace in rather
 * than let this function invent one.
 *
 * Carrier lines are filtered to the CITABLE set, so the convention's own
 * instruction block — which rides as a section like any other — is not itself
 * citable. It is instruction, not evidence.
 */
export function supplyFromBundle(
  bundle: ContextBundle,
  toolCalls: readonly SuppliedToolCall[] = []
): CitationSupply {
  const citable = new Set<string>(CITABLE_CARRIER_LINES);
  return {
    events: bundle.retrieved
      .filter((i) => i.store === 'ledger')
      .map((i) => ({
        id: i.id,
        // The episodic collector puts the event's TOPIC in `title` — carried
        // through under the name the render uses, never re-derived.
        ...(i.title !== undefined ? { topic: i.title } : {}),
        ...(i.trust !== undefined ? { trust: i.trust } : {}),
      })),
    toolCalls: [...toolCalls],
    carrierLines: (bundle.blocks.turnSections ?? [])
      .filter((k) => citable.has(k))
      .map((k) => ({ key: k })),
  };
}

/**
 * Number a flat list of tool-call names into the `name#index` addresses the
 * convention cites — index counts each TOOL's own calls, from 1.
 *
 * Per tool rather than per task, because ADR-24 fixes the address as "tool name
 * + call index": a global counter would make `wp_plugin_list#3` mean the third
 * call of the task, which is a different record from the third call of that
 * tool and is unreadable from the transcript without counting everything.
 */
export function numberToolCalls(names: readonly string[]): SuppliedToolCall[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    return { name, index };
  });
}
