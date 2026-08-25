/**
 * The permissions pane — one surface, two layers.
 *
 * Built to `docs/handoff/settings-permissions/from-designer-20-permissions-pane.md`
 * (designer, 2026-08-25), which this module implements the derivation half of.
 *
 * ── Why two layers rather than one table ──────────────────────────────────
 * A GRANT is per-capability and recorded as an act (`control.grant.issued`),
 * cited by refusals, and what a door lands on — a decision. A BOUND is
 * fleet-wide, applies across every capability, and is recorded as no act
 * about any one of them — a limit. Flattened into one grid they would need a
 * cell that is both an act and a state, which is why the merge stalled twice.
 * Stacked, they compose: the bound is the outer limit, and each grant states
 * the bound's consequence on itself.
 *
 * ── The one vocabulary rule ───────────────────────────────────────────────
 * granted/denied belongs to grants (an act). allowed/blocked belongs to the
 * bound (a state). Never mixed, never both for one thing — the two shipped
 * panes used both vocabularies for one concept, which is why a reader could
 * not tell whether an agent may pull a site.
 */

export type BoundState = 'allowed' | 'blocked';
export type GrantState = 'granted' | 'denied';

export interface BoundRow {
  /** The operation, in the customer's words. */
  op: string;
  /** Which transport carries it — named so the row is not magic. */
  transport: string;
  /** One state per place, positionally matched to `places`. */
  states: BoundState[];
}

export interface Bound {
  places: string[];
  rows: BoundRow[];
}

export interface Grant {
  cap: string;
  label: string;
  state: GrantState;
  /** The bound operation this capability needs. Empty = needs no write. */
  needs: string;
}

/**
 * The line that makes the merge worth it.
 *
 * Both statements were true on the shipped panes — "Update plugins across
 * sites: Granted" and, on the other screen, "Install or update things:
 * Blocked on production" — and neither said the other existed, so the reader
 * had to find the interaction themselves. This states what runs, states what
 * is barred, and names what bars it.
 *
 * DERIVED from bound × capability, never authored per row: the day the bound
 * changes, every clipped line moves with it. A per-row string would be a
 * second copy of the bound, free to disagree with it — which is the defect
 * this whole merge exists to remove.
 *
 * Returns `null` where there is nothing to say:
 *  - a DENIED grant — a bound clips only what was granted. The denial is the
 *    reason; naming a second reason would imply two.
 *  - a capability that needs no write operation.
 *  - an operation the bound does not carry (stated as unknown, not guessed).
 *  - a grant that is allowed everywhere — a clipped line that clips nothing
 *    is noise on every row that has no problem.
 */
export function deriveClippedLine(bound: Bound, grant: Grant): string | null {
  if (grant.state !== 'granted') return null;
  if (!grant.needs) return null;

  const row = bound.rows.filter((r) => r.op === grant.needs)[0];
  if (!row) return null;

  const runs: string[] = [];
  const barred: string[] = [];
  bound.places.forEach((place, i) => {
    (row.states[i] === 'allowed' ? runs : barred).push(place);
  });

  if (barred.length === 0) return null;

  if (runs.length === 0) {
    // Granted and reaching nothing. The loudest state on the surface that
    // grants it — previously readable only by cross-referencing two screens.
    return `Blocked everywhere by the write bound, so this grant currently gates nothing.`;
  }

  return `Runs on ${joinPlaces(runs)}. Blocked on ${joinPlaces(barred)} by the write bound.`;
}

/** "a", "a and b", "a, b and c" — the reading voice, not a CSV. */
export function joinPlaces(places: string[]): string {
  if (places.length <= 1) return places[0] ?? '';
  if (places.length === 2) return `${places[0]} and ${places[1]}`;
  return `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
}

/**
 * Whether a granted capability reaches nothing at all — the state worth
 * surfacing loudly, because a grant that gates nothing looks like permission.
 */
export function grantGatesNothing(bound: Bound, grant: Grant): boolean {
  if (grant.state !== 'granted' || !grant.needs) return false;
  const row = bound.rows.filter((r) => r.op === grant.needs)[0];
  if (!row) return false;
  return row.states.every((s) => s === 'blocked');
}
