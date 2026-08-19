/**
 * WP-41 · the comparator surface — J-Inspect's criteria, as pins.
 *
 * The eval's four key steps and four must-nots are the acceptance frame, and
 * each one below names the criterion it holds. Two are structural rather than
 * behavioural, deliberately:
 *
 *   - *"The verdict on a disagreeing cell comes from the comparator, not from
 *     cell inequality"* is held by `markFor` taking ONE cell. It has no second
 *     argument, so there is no expression in the surface that could compare two
 *     — the must-not is unreachable rather than merely unexercised.
 *   - *"A dead-end fact: any cell with no door"* is held by `cellDoor` being a
 *     total function. A doorless cell cannot be constructed.
 *
 * Both are still measured below, because a structural argument that nobody ran
 * is an argument, and this repo's own vacuous-guard list is mostly arguments
 * that were never run.
 */
import { serializeTree } from './helpers/serializeTree';
import {
  INTERIM_MARKS,
  MARK_AHEAD,
  MARK_BEHIND,
  buildSelection,
  cellDoor,
  cellKey,
  columnHeading,
  differsFrom,
  historyLine,
  markFor,
  rowHasPlainDifference,
  selectionHeadline,
  toggleCell,
  verdictLine,
} from '../../../src/renderer/components/DockedPanel/comparatorModel';
import type {
  MatrixCell,
  MatrixRow,
  SiteAtPlacesMatrix,
} from '../../../src/renderer/components/DockedPanel/comparatorModel';
import { SiteAtPlaces } from '../../../src/renderer/components/DockedPanel/SiteAtPlaces';

const PROD = { host: 'wpe' as const, kind: 'production' as const };
const STG = { host: 'wpe' as const, kind: 'staging' as const };
const DEV = { host: 'wpe' as const, kind: 'development' as const };
const LOCAL = { host: 'local' as const };

const cell = (over: Partial<MatrixCell> & { entityId: string; place: MatrixCell['place'] }): MatrixCell =>
  ({ ...over }) as MatrixCell;

const ROW: MatrixRow = {
  siteEntityId: 'ent.alpha',
  siteName: 'Alpha',
  watchingSince: '2026-08-14T09:00:00.000Z',
  cells: [
    cell({ entityId: 'e.prod', place: PROD, value: '9.5.0' }),
    cell({ entityId: 'e.stg', place: STG, value: '9.4.2' }),
    undefined as never,
    cell({
      entityId: 'e.copy',
      place: LOCAL,
      value: '9.4.2',
      verdict: { direction: 'behind', comparedAgainst: 'Alpha', upstreamValue: '9.5.0' },
    }),
  ],
};

const MATRIX: SiteAtPlacesMatrix = {
  fact: 'plugin:woocommerce',
  filter: 'plugin=woocommerce',
  comparatorId: 'cmp.plugin-woocommerce',
  columns: [PROD, STG, DEV, LOCAL],
  rows: [ROW],
  verdictCoverage: { cells: 3, verdicts: 1 },
};

const render = (props: Record<string, unknown>): unknown =>
  serializeTree(new (SiteAtPlaces as never as new (p: unknown) => { render(): unknown })(props).render());

function walk(node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    out.push(node as Record<string, unknown>);
    walk((node as { children?: unknown }).children, out);
  }
  return out;
}

const propsOf = (tree: unknown, key: string) =>
  walk(tree)
    .map((n) => (n.props as Record<string, unknown> | undefined)?.[key])
    .filter((v) => v !== undefined);

// ---------------------------------------------------------------------------
// must_not · "A claim in the surrounding prose that no cell supplies"
//            and boundary 1, from both sides
// ---------------------------------------------------------------------------

describe('the verdict comes from the comparator, never from cell inequality', () => {
  it('marks a cell the comparator judged, and marks it with XD-9’s ratified arrow', () => {
    expect(markFor(ROW.cells[3])).toBe(MARK_BEHIND);
    expect(MARK_BEHIND).toBe('←');
  });

  it('marks NOTHING on two cells that merely differ', () => {
    // Both populated, both different, neither judged. This is the must-not.
    expect(differsFrom(ROW.cells[0], ROW.cells[1])).toBe(true);
    expect(markFor(ROW.cells[0])).toBeNull();
    expect(markFor(ROW.cells[1])).toBeNull();
  });

  it('has no expression that could turn inequality into a mark', () => {
    // The structural half, run rather than argued: `markFor` is unary, so a
    // neighbour cannot be passed to it even by accident.
    expect(markFor.length).toBe(1);
    // And the surface renders plain difference as words, with no mark near it.
    const tree = render({ matrix: MATRIX, selected: [], onToggle: () => {} });
    expect(propsOf(tree, 'data-plain-difference')).toEqual(['true']);
    expect(propsOf(tree, 'data-cell-mark')).toEqual([MARK_BEHIND]);
  });

  it('names the ahead arrow as INTERIM, because XD-9 ratified only the behind one', () => {
    expect(INTERIM_MARKS).toEqual([MARK_AHEAD]);
    expect(INTERIM_MARKS).not.toContain(MARK_BEHIND);
  });

  it('renders plain difference only where two populated cells disagree', () => {
    expect(rowHasPlainDifference(ROW)).toBe(true);
    const uniform: MatrixRow = {
      ...ROW,
      cells: [cell({ entityId: 'a', place: PROD, value: '9.5.0' }), cell({ entityId: 'b', place: STG, value: '9.5.0' })],
    };
    expect(rowHasPlainDifference(uniform)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// key_step · "A disagreeing cell explains itself in place"
// must_not  · "watching since", never "unknown"
// ---------------------------------------------------------------------------

describe('a cell explains itself in place, and an absence never becomes a shrug', () => {
  it('names the other side and its value in the verdict line', () => {
    expect(verdictLine(ROW.cells[3])).toBe('behind Alpha, which is at 9.5.0');
    expect(verdictLine(ROW.cells[0])).toBeNull();
  });

  it('says "watching since", in the LOCAL zone, and never says unknown', () => {
    const line = historyLine(ROW)!;
    expect(line).toContain('Nexus AI has been watching this site since');
    expect(line).not.toContain('unknown');
    // Local, not UTC: `toISOString` prints the previous day for the seven hours
    // a day PDT is behind UTC, which this repo has already paid for once.
    const local = new Date(ROW.watchingSince!).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
    });
    expect(line).toBe(`Nexus AI has been watching this site since ${local}`);
  });

  it('renders NO line at all when nothing is recorded — an omission, not a word', () => {
    expect(historyLine({ ...ROW, watchingSince: undefined })).toBeNull();
    expect(historyLine({ ...ROW, watchingSince: 'not-a-date' })).toBeNull();
    const tree = render({
      matrix: { ...MATRIX, rows: [{ ...ROW, watchingSince: undefined }] },
      selected: [],
      onToggle: () => {},
    });
    expect(propsOf(tree, 'data-watching-since')).toEqual([]);
    expect(JSON.stringify(tree)).not.toContain('unknown');
  });
});

// ---------------------------------------------------------------------------
// must_not · "A dead-end fact: any cell with no door"
// ---------------------------------------------------------------------------

describe('no dead-end fact — every cell has a door', () => {
  it('gives a door to a populated cell, an excluded cell and an absent one', () => {
    expect(cellDoor(ROW, ROW.cells[0]).kind).toBe('select');
    expect(cellDoor(ROW, undefined).kind).toBe('history');
    const excluded = cell({
      entityId: 'e.fox',
      place: STG,
      value: '9.4.2',
      excluded: {
        reason: 'halted, and said so',
        causedBy: { recordId: 'ev.1', topic: 't', observedAt: '2026-08-18T09:04:00.000Z' },
      },
    });
    expect(cellDoor(ROW, excluded)).toEqual({ kind: 'excluded', label: 'halted, and said so' });
  });

  it('gives every rendered cell a door, including the empty column', () => {
    const tree = render({ matrix: MATRIX, selected: [], onToggle: () => {} });
    const doors = propsOf(tree, 'data-cell-door');
    // One per column, per row. None missing, none blank.
    expect(doors).toHaveLength(MATRIX.columns.length * MATRIX.rows.length);
    expect(doors.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    expect(doors).toContain('history'); // the absent column still leads somewhere
  });

  it('never returns a door with an empty label, even with nothing recorded', () => {
    const bare: MatrixRow = { siteEntityId: 'x', siteName: 'X', cells: [] };
    expect(cellDoor(bare, undefined).label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// must_not · "A summary standing in for the shape"
// ---------------------------------------------------------------------------

describe('the shape is on screen before any prose about it', () => {
  it('puts the table first in the tree, with nothing above it', () => {
    const tree = render({ matrix: MATRIX, selected: [], onToggle: () => {} });
    const types = walk(tree)
      .map((n) => n.type)
      .filter((t) => typeof t === 'string');
    expect(types.indexOf('table')).toBeGreaterThan(-1);
    // No paragraph, heading or prose element precedes the grid.
    expect(types.slice(0, types.indexOf('table')).every((t) => t === 'div')).toBe(true);
  });

  it('draws no selection bar at all until something is selected', () => {
    const tree = render({ matrix: MATRIX, selected: [], onToggle: () => {} });
    expect(propsOf(tree, 'data-selection-bar')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// key_step · "The selection becomes the next act's scope"
// must_not · "A scope the user must confirm by re-listing the targets"
// ---------------------------------------------------------------------------

describe('the selection becomes a scope, with nothing retyped', () => {
  it('keys a selection by site AND place — the unit is the cell', () => {
    expect(cellKey(ROW.cells[0]!)).toBe('e.prod|wpe_production');
    expect(cellKey(ROW.cells[1]!)).toBe('e.stg|wpe_staging');
    expect(cellKey(ROW.cells[0]!)).not.toBe(cellKey(ROW.cells[1]!));
  });

  it('builds a ScopeSelection whose from-line is the matrix’s own', () => {
    const selection = buildSelection(MATRIX, [cellKey(ROW.cells[0]!), cellKey(ROW.cells[3]!)])!;
    expect(selection.from).toEqual({
      surface: 'comparator',
      comparatorId: MATRIX.comparatorId,
      filter: MATRIX.filter,
    });
    // The cells the user clicked, and nothing typed: names come from the row,
    // places from the cell, ids from the entity.
    expect(selection.cells.map((c) => [c.siteName, c.place])).toEqual([
      ['Alpha', PROD],
      ['Alpha', LOCAL],
    ]);
  });

  it('returns cells in MATRIX order, not click order', () => {
    const backwards = buildSelection(MATRIX, [cellKey(ROW.cells[3]!), cellKey(ROW.cells[0]!)])!;
    expect(backwards.cells.map((c) => c.place)).toEqual([PROD, LOCAL]);
  });

  it('returns null rather than an empty selection', () => {
    expect(buildSelection(MATRIX, [])).toBeNull();
  });

  it('lets a selected cell be deselected, and refuses a cell with nothing behind it', () => {
    const key = cellKey(ROW.cells[0]!);
    expect(toggleCell([], ROW.cells[0])).toEqual([key]);
    expect(toggleCell([key], ROW.cells[0])).toEqual([]);
    // An empty cell is not a target: a scope cell with no fact behind it would
    // be a target invented by a click.
    expect(toggleCell([], undefined)).toEqual([]);
    expect(toggleCell([], cell({ entityId: 'e.x', place: DEV }))).toEqual([]);
  });

  it('keeps an EXCLUDED cell selectable — the matrix is a shape, not a permission model', () => {
    const excluded = cell({
      entityId: 'e.fox',
      place: STG,
      excluded: {
        reason: 'halted, and said so',
        causedBy: { recordId: 'ev.1', topic: 't', observedAt: '2026-08-18T09:04:00.000Z' },
      },
    });
    // Making it unclickable would replace a STATED exclusion with a silent one.
    expect(toggleCell([], excluded)).toEqual([cellKey(excluded)]);
  });
});

// ---------------------------------------------------------------------------
// The selection bar, and the block it mounts
// ---------------------------------------------------------------------------

describe('the selection bar renders the scope block itself', () => {
  const SCOPE = {
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    runnable: [{ siteId: 'e.stg', siteName: 'Alpha', place: STG }],
    barred: [],
    excluded: [],
    places: ['wpe_staging'],
    from: { surface: 'comparator' as const, comparatorId: 'cmp.x', filter: 'f' },
    opensRun: true,
  };

  it('states its unit in draft 2’s wording, from the derived scope’s own count', () => {
    expect(selectionHeadline(5, 3)).toBe('5 cells selected · 3 can run now');
    expect(selectionHeadline(1, 0)).toBe('1 cell selected · 0 can run now');
  });

  it('mounts ScopeBlock rather than composing lines of its own', () => {
    const tree = render({
      matrix: MATRIX,
      selected: [cellKey(ROW.cells[1]!)],
      onToggle: () => {},
      scope: SCOPE,
    });
    // `serializeTree` renders THIS component's output, not its children — the
    // helper's own documented limitation. So the pin is that the element is
    // there, is ScopeBlock, and carries the selection-bar surface; the block's
    // byte-identity across surfaces is `scopeBlock.test.ts`'s subject.
    const blocks = walk(tree).filter((n) => String(n.type).includes('ScopeBlock'));
    expect(blocks).toHaveLength(1);
    expect((blocks[0].props as Record<string, unknown>).surface).toBe('selection-bar');
    expect((blocks[0].props as Record<string, unknown>).scope).toBe(SCOPE);
    expect(propsOf(tree, 'data-selection-bar')).toEqual(['1']);
  });

  it('offers the act even when nothing runs — a refusal must be reachable', () => {
    const tree = render({
      matrix: MATRIX,
      selected: [cellKey(ROW.cells[0]!)],
      onToggle: () => {},
      scope: { ...SCOPE, runnable: [], opensRun: false },
      onArm: () => {},
    });
    expect(propsOf(tree, 'data-arm-selection')).toEqual(['1']);
  });
});

describe('the column heading is the seam’s own word', () => {
  it('renders places through placeLabel, so the grid and the block cannot drift', () => {
    expect(columnHeading(PROD)).toBe('production');
    expect(columnHeading(STG)).toBe('staging');
    // ESCALATED, not resolved here: XD-9's prose calls this "the your-copy
    // column" and Controlled Vocabulary v1 says "your copy" — but the scope
    // block two inches away renders `local` from this same function, and two
    // wordings for one place is the drift the seam exists to prevent.
    expect(columnHeading(LOCAL)).toBe('local');
  });
});
