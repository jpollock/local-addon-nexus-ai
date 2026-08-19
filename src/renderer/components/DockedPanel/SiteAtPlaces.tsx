/**
 * WP-41 · THE COMPARATOR RENDER — the site-at-places matrix, on screen.
 *
 * XD-9 ratified this shape and killed the environment-detail page with it: rows
 * are Sites, columns are places, and *"the honest rendering of records is a grid
 * where an empty or disagreeing cell does the work."* The designer's own reason
 * for the grid is the one that governs every decision below — the Site is the
 * logical thing, environments are its durable manifestations, and *"which
 * environment is this copy?"* is an invalid question by design (ADR-21).
 *
 * COMPUTES NOTHING. Every value, verdict, date and door arrives from
 * `comparatorModel`, which mirrors the seam. This component chooses geometry.
 *
 * THE FOUR BOUNDARY CONDITIONS, as rendering decisions:
 *
 *  1 · **The mark comes from `markFor`, which reads `cell.verdict` alone.** There
 *      is no comparison between cells anywhere in this file. `rowHasPlainDifference`
 *      is rendered as an unstyled, unmarked fact in the row's own line — plain
 *      difference, not an alarm — and it can never reach a mark, because
 *      `markFor` takes one cell and has no second argument to pass.
 *  2 · **The your-copy column is drawn in the same grid, and its verdict names
 *      what it was measured against.** A direction with no other side is an
 *      alarm without a subject.
 *  3 · **An absent cell is a dash and a door**, never a blank and never a zero.
 *  4 · **The row's history line says "watching since", or says nothing.**
 *
 * NO DEAD-END FACT (J-Inspect's second must-not, as structure). Every cell is a
 * `<button>` carrying `cellDoor`'s label — a populated cell selects, an excluded
 * cell states the record that removed it, an absent cell offers the row's
 * history. `cellDoor` is a total function, so a cell with no door cannot be
 * expressed, let alone rendered.
 *
 * NO SUMMARY STANDING IN FOR THE SHAPE (the first must-not). The grid is the
 * first thing in the tree and there is no prose above it. The only counts on
 * screen are the selection headline's, and both of its numbers come from the
 * derived scope rather than from a second tally.
 *
 * **THE VISUAL LANGUAGE BEYOND THE RATIFIED PINS IS INTERIM.** Ratified: the
 * grid, the ← marker for a behind verdict, place-scoped rows with honest
 * absences, "watching since". Everything else here — the → for an ahead verdict
 * (`INTERIM_MARKS`), the selected-cell treatment, the column widths, the
 * disclosure of a cell's own line — is INTERIM and is named as such at the gate.
 * The designer's cycle-four family refines it; no vocabulary is invented here.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import { ScopeBlock } from './ScopeBlock';
import type { ProcedureScope } from './scopeModel';
import {
  cellDoor,
  cellKey,
  columnHeading,
  historyLine,
  isSelected,
  markFor,
  rowHasPlainDifference,
  selectionHeadline,
  verdictLine,
} from './comparatorModel';
import type { MatrixCell, MatrixRow, SiteAtPlacesMatrix } from './comparatorModel';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';

export interface SiteAtPlacesProps {
  matrix: SiteAtPlacesMatrix;
  /** Cell keys, from `cellKey`. The surface holds no selection of its own. */
  selected: readonly string[];
  onToggle: (cell: MatrixCell) => void;
  /**
   * The split derived from the current selection, host-side. Absent while
   * nothing is selected, or while the derivation has not come back — and the bar
   * then renders the headline alone rather than a block with invented numbers.
   */
  scope?: ProcedureScope;
  /** Hand the runnable subset to a run. Absent ⇒ the act renders disabled. */
  onArm?: () => void;
  /** The barred group's door, forwarded to `ScopeBlock`. */
  onGovern?: (door: GovernDoorTarget) => void;
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column' as const, gap: 8, fontSize: 11 },
  scroller: { overflowX: 'auto' as const, maxWidth: '100%' },
  table: { borderCollapse: 'collapse' as const, width: '100%', fontSize: 11 },
  th: {
    textAlign: 'left' as const,
    padding: '4px 6px',
    color: 'var(--nxai-card-sub)',
    fontWeight: 500,
    borderBottom: `1px solid var(--nxai-card-border)`,
    whiteSpace: 'nowrap' as const,
  },
  rowHead: {
    padding: '4px 6px',
    color: 'var(--nxai-card-text)',
    borderBottom: `1px solid var(--nxai-card-border)`,
    whiteSpace: 'nowrap' as const,
  },
  td: { padding: 0, borderBottom: `1px solid var(--nxai-card-border)` },
  cellBtn: (selected: boolean, actionable: boolean) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    padding: '4px 6px',
    fontSize: 11,
    lineHeight: 1.4,
    background: selected ? 'var(--nxai-section-bg)' : 'transparent',
    border: selected ? `1px solid ${UI_COLORS.WPE_BRAND}` : '1px solid transparent',
    borderRadius: 3,
    color: actionable ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
    cursor: actionable ? 'pointer' : 'default',
    font: 'inherit',
  }),
  mark: { color: UI_COLORS.WPE_BRAND, marginRight: 4 },
  sub: { color: 'var(--nxai-card-sub)', fontSize: 10 },
  history: { color: 'var(--nxai-card-sub)', fontSize: 10, padding: '0 6px 4px' },
  bar: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  headline: { color: 'var(--nxai-card-text)', fontSize: 11, fontWeight: 600 },
  arm: {
    alignSelf: 'flex-start' as const,
    background: UI_COLORS.WPE_BRAND,
    border: 'none',
    borderRadius: 3,
    color: UI_COLORS.NEXUS_MARK,
    fontSize: 10,
    padding: '3px 8px',
    cursor: 'pointer',
  },
};

/** The honest dash. Boundary 3 — an empty cell does work, so it is drawn. */
const ABSENT = '—';

export class SiteAtPlaces extends React.Component<SiteAtPlacesProps> {
  private renderCell(row: MatrixRow, cell: MatrixCell | undefined, column: number): React.ReactNode {
    const { selected, onToggle } = this.props;
    const door = cellDoor(row, cell);
    const mark = markFor(cell);
    const verdict = verdictLine(cell);
    const actionable = door.kind !== 'history';

    return React.createElement(
      'td',
      { key: `c${column}`, style: styles.td },
      React.createElement(
        'button',
        {
          type: 'button',
          style: styles.cellBtn(isSelected(selected, cell), actionable),
          // The door is on the element, always. A reader inspecting the DOM sees
          // the same total function the model guarantees.
          'data-cell-door': door.kind,
          'data-cell-key': cell ? cellKey(cell) : undefined,
          'aria-label': `${row.siteName} · ${columnHeading(row.cells[column]?.place ?? cell?.place ?? { host: 'local' })} — ${door.label}`,
          title: door.label,
          disabled: !actionable,
          onClick: actionable && cell ? () => onToggle(cell) : undefined,
        },
        React.createElement(
          'span',
          null,
          // The mark, and it exists only because the comparator said so.
          mark ? React.createElement('span', { style: styles.mark, 'data-cell-mark': mark }, mark) : null,
          cell?.value ?? ABSENT,
        ),
        // The cell explains itself IN PLACE (J-Inspect's third key step) rather
        // than in a panel somewhere else.
        verdict ? React.createElement('div', { style: styles.sub }, verdict) : null,
        cell?.excluded ? React.createElement('div', { style: styles.sub }, cell.excluded.reason) : null,
      ),
    );
  }

  private renderRow(row: MatrixRow): React.ReactNode {
    const history = historyLine(row);
    return [
      React.createElement(
        'tr',
        { key: row.siteEntityId, 'data-matrix-row': row.siteName },
        React.createElement(
          'th',
          { scope: 'row', style: styles.rowHead },
          row.siteName,
          // Plain difference: stated, unmarked, unalarmed. Boundary 1's other half.
          rowHasPlainDifference(row)
            ? React.createElement('span', { style: styles.sub, 'data-plain-difference': 'true' }, ' · not the same everywhere')
            : null,
        ),
        ...this.props.matrix.columns.map((_, i) => this.renderCell(row, row.cells[i], i)),
      ),
      history
        ? React.createElement(
            'tr',
            { key: `${row.siteEntityId}-history` },
            React.createElement(
              'td',
              { colSpan: this.props.matrix.columns.length + 1, style: styles.history, 'data-watching-since': row.watchingSince },
              history,
            ),
          )
        : null,
    ];
  }

  /**
   * The selection bar. Draft 2 §2: the scope block renders HERE and at the head
   * of the declaration, as the same block with the same wording and the same
   * doors — which is why this mounts `ScopeBlock` rather than composing lines.
   */
  private renderSelectionBar(): React.ReactNode {
    const { selected, scope, onArm, onGovern } = this.props;
    if (!selected.length) return null;

    return React.createElement(
      'div',
      { style: styles.bar, 'data-selection-bar': String(selected.length) },
      React.createElement(
        'div',
        { style: styles.headline },
        selectionHeadline(selected.length, scope ? scope.runnable.length : 0),
      ),
      scope
        ? React.createElement(ScopeBlock, {
            scope,
            surface: 'selection-bar',
            ...(onGovern ? { onGovern } : {}),
          })
        : null,
      // XD-21, at the surface that produces the selection: the act is offered
      // whether or not anything runs. A selection of two halted sites must be
      // able to reach the refusal that names why — hiding the act would replace
      // a stated refusal with a silent one.
      React.createElement(
        'button',
        {
          type: 'button',
          style: styles.arm,
          disabled: !onArm,
          'data-arm-selection': String(selected.length),
          onClick: onArm,
        },
        'Use this selection',
      ),
    );
  }

  render(): React.ReactNode {
    const { matrix } = this.props;
    return React.createElement(
      'div',
      { style: styles.wrap, 'data-comparator': matrix.comparatorId, 'aria-label': 'Comparator' },
      // THE SHAPE IS FIRST. No prose precedes it — the first must-not is a fact
      // about the tree's order, so it is held by the tree's order.
      React.createElement(
        'div',
        { style: styles.scroller },
        React.createElement(
          'table',
          { style: styles.table },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              React.createElement('th', { style: styles.th, scope: 'col' }, matrix.filter),
              ...matrix.columns.map((place, i) =>
                React.createElement('th', { key: `h${i}`, style: styles.th, scope: 'col' }, columnHeading(place)),
              ),
            ),
          ),
          React.createElement('tbody', null, ...matrix.rows.map((row) => this.renderRow(row))),
        ),
      ),
      this.renderSelectionBar(),
    );
  }
}
