/**
 * WP-41 · the renderer's half of the comparator seam.
 *
 * `src/main/comparator/siteAtPlaces.ts` is the ONLY source of derivations over a
 * matrix. This module derives no fact: it holds the WIRE SHAPES (as types), the
 * SELECTION state a human builds by clicking, and the COPY rules that turn what
 * arrived into lines a person reads. Same contract as `procedureModel.ts` and
 * `scopeModel.ts`, and for the same measured reason — a VALUE import from
 * `src/main/` pulls the intelligence core and, through it, better-sqlite3 with
 * the wrong ABI into a surface that predates the intelligence layer. Every
 * import below is `import type`.
 *
 * WHAT IS RATIFIED HERE, AND WHAT IS INTERIM.
 *
 * Ratified, and implemented as such:
 *
 *  - **The unit is the CELL** (split-sheet pin 1). `cellKey` keys on site AND
 *    place, so the same site at staging and at production are two selectables
 *    under two different laws. A selection model keyed by site id is how a
 *    production write hides inside a staging selection.
 *  - **Divergence is the comparator's verdict** (XD-9 boundary 1). `markFor`
 *    reads `cell.verdict` and NOTHING else. There is deliberately no code path
 *    from "these two cells hold different strings" to a mark: `differsFrom` is
 *    exported for the surface to render plain difference with, and it can never
 *    reach `markFor`. The two are separate functions because they are separate
 *    claims.
 *  - **"Watching since", never "unknown"** (XD-9 boundary 4). `historyLine`
 *    returns the sentence when a date exists and NULL when none does. There is
 *    no `'unknown'` string in this module, and no fallback that would produce a
 *    shrug in place of an omission.
 *  - **No place named as a single value** (draft 2's absence list). Place is a
 *    set everywhere: the columns are a list, and the scope block's `Places:` line
 *    comes from the seam already.
 *
 * INTERIM, and named so the designer's cycle-four family can replace it without
 * anyone having to guess what was ruled and what was filled in:
 *
 *  - `MARK_AHEAD` (`→`). XD-9 ratified the ← marker for a behind verdict and
 *    said nothing about ahead. The comparator computes both, so the surface must
 *    render both; this is the arrow that has not been through the loop.
 *  - The column header for the your-copy column. XD-9's prose calls it "the
 *    your-copy column" and Controlled Vocabulary v1 says **your copy**, never
 *    working copy or sandbox — but the shipped `placeLabel` renders
 *    `{host:'local'}` as `local`, and the scope block uses that same function.
 *    Rendering `your copy` here and `local` in the block two inches away would
 *    break the one wording the seam exists to keep single, so the header uses
 *    `placeLabel` and the mismatch is ESCALATED rather than resolved locally.
 *  - `INTERIM_MARKS` names both, so a test can assert the interim set is exactly
 *    what this comment says it is.
 */
import type {
  CellVerdict,
  MatrixCell,
  MatrixRow,
  SiteAtPlacesMatrix,
} from '../../../main/comparator/siteAtPlaces';
import type { ScopeFrom, ScopeSelection, SelectedCell } from './scopeModel';
import { placeLabel } from './scopeModel';

export type { CellVerdict, MatrixCell, MatrixRow, SiteAtPlacesMatrix };

// ---------------------------------------------------------------------------
// The marks
// ---------------------------------------------------------------------------

/** XD-9's ratified marker: this cell is behind what the comparator measured it against. */
export const MARK_BEHIND = '←';

/**
 * INTERIM. The comparator returns `ahead` as well as `behind`, and a verdict the
 * platform computed must not be silently dropped for want of a ratified glyph —
 * dropping it would be the mirror image of inventing one. Named interim, listed
 * in `INTERIM_MARKS`, and carried to the gate as such.
 */
export const MARK_AHEAD = '→';

/** Every mark on this surface that has NOT been through the design loop. */
export const INTERIM_MARKS: readonly string[] = [MARK_AHEAD];

/**
 * The mark for a cell, from the COMPARATOR'S VERDICT and from nothing else.
 *
 * Takes one cell. It structurally cannot see a neighbour, which is what makes
 * "no cell-inequality-as-divergence" a property of the code rather than a
 * promise in a comment: there is no argument here that could carry the other
 * cell's value.
 */
export function markFor(cell: MatrixCell | undefined): string | null {
  if (!cell?.verdict) return null;
  return cell.verdict.direction === 'behind' ? MARK_BEHIND : MARK_AHEAD;
}

/**
 * Plain difference — XD-9 boundary 1's other half. Two populated cells holding
 * different values. This is NOT a verdict and never becomes one: it is offered
 * so the surface can show that the row is not uniform without claiming the
 * platform computed anything about why.
 */
export function differsFrom(a: MatrixCell | undefined, b: MatrixCell | undefined): boolean {
  if (!a?.value || !b?.value) return false;
  return a.value !== b.value;
}

/** True when the row holds two populated cells that disagree — plain, unalarmed. */
export function rowHasPlainDifference(row: MatrixRow): boolean {
  const values = row.cells.filter((c): c is MatrixCell => !!c?.value).map((c) => c.value);
  return new Set(values).size > 1;
}

// ---------------------------------------------------------------------------
// The explanation lines
// ---------------------------------------------------------------------------

/**
 * XD-9 boundary 4, verbatim in shape: *"Nexus AI has been watching this site
 * since 14 August"* — a fact we own — never *"origin unknown"*, a shrug we do
 * not. Null when nothing is recorded, and the surface then renders no line at
 * all: an omission is honest, a word standing in for one is not.
 *
 * The date is formatted in the LOCAL zone. `toISOString()` here would print the
 * previous day for the seven hours a day PDT is behind UTC — this repo has paid
 * for that once already, in the event log's filenames.
 */
export function historyLine(row: MatrixRow): string | null {
  if (!row.watchingSince) return null;
  const when = new Date(row.watchingSince);
  if (Number.isNaN(when.getTime())) return null;
  const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return `Nexus AI has been watching this site since ${date}`;
}

/**
 * What a cell says about itself in place — the verdict's own sentence.
 *
 * Names the other side and its value, because a direction with neither is an
 * alarm without a subject. Null when the comparator produced no verdict, which
 * is the ordinary case for every durable place (see the module header's note on
 * the shipped comparator's reach).
 */
export function verdictLine(cell: MatrixCell | undefined): string | null {
  const verdict = cell?.verdict;
  if (!verdict) return null;
  const head = `${verdict.direction} ${verdict.comparedAgainst}`;
  return verdict.upstreamValue ? `${head}, which is at ${verdict.upstreamValue}` : head;
}

// ---------------------------------------------------------------------------
// The doors — J-Inspect's "no dead-end fact"
// ---------------------------------------------------------------------------

/**
 * Where a cell leads. EVERY cell has one, which is the must-not stated as a
 * total function: `cellDoor` has no null return, so a dead-end cell cannot be
 * expressed in this model.
 *
 *  - `select`   — a populated cell the world has not removed. It enters a scope.
 *  - `excluded` — the world removed it; the door is the record that says so.
 *  - `history`  — an absent cell, or a cell with nothing else to offer. The door
 *                 is the row's own watching-since line (boundary 4).
 *
 * `history` is a real door and not a placeholder: boundary 3 says a "—" cell is
 * honest, and boundary 4 says what the surface owes a reader looking at one.
 */
export type CellDoorKind = 'select' | 'excluded' | 'history';

export interface CellDoor {
  kind: CellDoorKind;
  /** What the door says, already composed. Never null — see the type's contract. */
  label: string;
}

export function cellDoor(row: MatrixRow, cell: MatrixCell | undefined): CellDoor {
  if (cell?.excluded) return { kind: 'excluded', label: cell.excluded.reason };
  if (cell?.value) return { kind: 'select', label: SELECT_LABEL };
  return { kind: 'history', label: historyLine(row) ?? NOTHING_RECORDED };
}

/** The act a populated cell offers. One verb, and it is the one the scope uses. */
const SELECT_LABEL = 'Select this cell';

/**
 * The honest floor under boundary 4. When the ledger holds no date either, the
 * surface still says what it consulted rather than nothing — but it claims
 * nothing about the site's origin, which is the half XD-9 forbade guessing at.
 */
const NOTHING_RECORDED = 'Nothing recorded here yet';

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

/**
 * The key a selection is held by — SITE AND PLACE (pin 1). Mirrors the seam's
 * own `cellKey`, which keys `checkDryRunTargets` the same way; the two must
 * agree or a cell selected here and a cell checked there are different things
 * wearing one name.
 */
export function cellKey(cell: Pick<MatrixCell, 'entityId' | 'place'>): string {
  const place = cell.place.host === 'local' ? 'local' : `${cell.place.host}_${cell.place.kind}`;
  return `${cell.entityId}|${place}`;
}

export function isSelected(selected: readonly string[], cell: MatrixCell | undefined): boolean {
  return !!cell && selected.includes(cellKey(cell));
}

/**
 * Click a cell. Cells the world has removed are STILL selectable, deliberately.
 *
 * The matrix is a shape, not a permission model (draft 2 §1: "Nothing here
 * should stop her selecting a production cell"), and the same reasoning runs
 * one step further for the world's own state: a user who selects two halted
 * sites must reach the refusal that names why, carrying the record. Making them
 * unclickable would replace a stated exclusion with a silent one — the exact
 * defect "no silent exclusion" forbids, moved from the block to the grid.
 *
 * A cell with NO value is not selectable: there is no fact there to act on, and
 * a scope cell with nothing behind it would be a target invented by a click.
 */
export function toggleCell(selected: readonly string[], cell: MatrixCell | undefined): string[] {
  if (!cell?.value && !cell?.excluded) return [...selected];
  const key = cellKey(cell);
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

/**
 * The selection, as the carrier wants it.
 *
 * THE FROM-LINE RESOLVES TO THIS RENDER (pin 5, and the WP-37 ruling's whole
 * point): `comparatorId` and `filter` are the matrix's own, verbatim as it
 * applied them — not composed here, not defaulted, and not a fixture. `surface`
 * is `'comparator'`, the only ratified variant; candidate B's model-named
 * selection was refused precisely so this field could never mean two things.
 *
 * Cells come out in MATRIX ORDER rather than click order: a scope is a set, the
 * block renders it as a list, and a list whose order records the order a human
 * happened to click reads as a fact about the plan that nobody asserted.
 */
export function buildSelection(
  matrix: SiteAtPlacesMatrix,
  selected: readonly string[]
): ScopeSelection | null {
  const cells: SelectedCell[] = [];
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (!cell || !selected.includes(cellKey(cell))) continue;
      const bare = { siteId: cell.entityId, siteName: row.siteName, place: cell.place };
      cells.push(cell.excluded ? { ...bare, excluded: cell.excluded } : bare);
    }
  }
  if (!cells.length) return null;
  const from: ScopeFrom = {
    surface: 'comparator',
    comparatorId: matrix.comparatorId,
    filter: matrix.filter,
  };
  return { cells, from };
}

/**
 * The selection bar's headline, verbatim in shape from draft 2 §2:
 * **"5 cells selected · 3 can run now"**.
 *
 * `canRunNow` comes from the derived scope's runnable set — the same number the
 * block's `Targets:` line is built from, read rather than recounted. Passing it
 * in rather than computing it here is the point: a second count of the same
 * thing is a second chance to disagree.
 */
export function selectionHeadline(selectedCount: number, canRunNow: number): string {
  return `${selectedCount} ${selectedCount === 1 ? 'cell' : 'cells'} selected · ${canRunNow} can run now`;
}

/** The column's heading. `placeLabel` and nothing else — see the header's escalation. */
export function columnHeading(place: SiteAtPlacesMatrix['columns'][number]): string {
  return placeLabel(place);
}
