/**
 * WP-44 · THE GOVERN MATRIX — M7's Settings section, and the control a grant is
 * made AT.
 *
 * COMPUTES NOTHING. Every string on every row arrives from
 * `src/main/intelligence-host/governMatrix.ts` over `GOVERN_MATRIX`. There is no
 * arithmetic here, no label table, no state machine and no copy of the ratified
 * sentences: a second place that knows what "4 of 8 checkpoints" means is a
 * second place that can drift from the documents, and the whole ruling on the
 * gates column is that it is derived or it is nothing. Same discipline as
 * `ScopeBlock`, for the same reason and with the same result — if a fact needs
 * to change it changes in the seam and arrives here.
 *
 * WHY THERE IS NO RENDERER MIRROR, where `scopeModel.ts` has one. A mirror
 * exists when the renderer must derive something with no round trip available
 * (a scope previewed per click). This surface has a round trip for everything it
 * shows, so a mirror would be a duplicate rule with no call for it. The seam is
 * imported for TYPES ONLY — a value import from `src/main/intelligence-host/`
 * pulls the intelligence core and better-sqlite3 into the renderer's require
 * graph, thrown at panel load with the wrong ABI.
 *
 * THE SWITCH RENDERS CONSENT; THE CHIP RENDERS FORCE (ruling 3). A disarmed row
 * shows its switch ON, its chip loud, and a band beneath it with the reason and
 * a door. It is never drawn as denied: an integrity failure is the platform's
 * report about a document, and drawing the switch off would be the platform
 * quietly revoking on the user's behalf.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import type { GovernMatrix, GovernRow, GovernState } from '../../../main/intelligence-host/governMatrix';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';

export interface GovernSectionProps {
  electron: any;
  /**
   * The door a refusal sent the user through, or null. It lands on the ROW —
   * this component scrolls to it and marks it, and never merely opens the page.
   */
  door?: GovernDoorTarget | null;
  /** Called once the door has been honoured, so the request is not re-applied. */
  onDoorHandled?: () => void;
}

interface GovernSectionState {
  matrix: GovernMatrix | null;
  loading: boolean;
  /** The capability an act is in flight for. One at a time, like the acts. */
  pending: string | null;
  /** An act that could not be performed, in the words the seam gave. */
  error: string | null;
  /** The row a door landed on. Marked until the user acts or navigates away. */
  landedOn: string | null;
}

/**
 * The chip's colours, from the design-system note.
 *
 * `neutral` for granted and denied, `error/strong` for disarmed,
 * `warning/subtle` for never-by-default. NOT a severity scale: the production
 * rows are warning-subtle because they are a disclosure a person can act on, and
 * the denied rows are neutral because being ungranted is the normal state of a
 * capability rather than a problem with one.
 */
const CHIP_TONE: Readonly<Record<GovernState, { fg: string; bg: string; border: string }>> = {
  materialized: { fg: 'var(--nxai-card-text)', bg: 'var(--nxai-section-bg)', border: 'var(--nxai-card-border)' },
  'granted-by-you': { fg: 'var(--nxai-card-text)', bg: 'var(--nxai-section-bg)', border: 'var(--nxai-card-border)' },
  disarmed: { fg: '#fff', bg: '#c0392b', border: '#c0392b' },
  'never-by-default': { fg: '#8a6d1f', bg: 'rgba(240, 180, 41, 0.14)', border: 'rgba(240, 180, 41, 0.5)' },
  denied: { fg: 'var(--nxai-card-text)', bg: 'var(--nxai-section-bg)', border: 'var(--nxai-card-border)' },
};

const styles = {
  preamble: {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--nxai-card-text)',
    margin: '0 0 14px',
    maxWidth: 720,
  },
  table: { display: 'flex', flexDirection: 'column' as const, gap: 0 },
  headRow: {
    display: 'grid',
    gridTemplateColumns: '2.2fr 1.6fr 1.6fr 2fr 64px',
    gap: 12,
    padding: '0 0 6px',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: 'var(--nxai-muted-text)',
    borderBottom: '1px solid var(--nxai-card-border)',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '2.2fr 1.6fr 1.6fr 2fr 64px',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid var(--nxai-card-border)',
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--nxai-card-text)',
    alignItems: 'start' as const,
  },
  landed: { boxShadow: `inset 3px 0 0 ${UI_COLORS.WPE_BRAND}`, paddingLeft: 9 },
  label: { fontWeight: 600 },
  id: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: 'var(--nxai-muted-text)' },
  ceremony: { color: 'var(--nxai-muted-text)' },
  chip: {
    display: 'inline-block',
    borderRadius: 3,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 600,
    border: '1px solid',
    marginBottom: 4,
  },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, wordBreak: 'break-all' as const },
  gatesLead: { fontWeight: 600 },
  band: {
    gridColumn: '1 / -1',
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 4,
    border: '1px solid #c0392b',
    background: 'rgba(192, 57, 43, 0.08)',
  },
  door: {
    alignSelf: 'flex-start' as const,
    marginTop: 6,
    background: 'transparent',
    border: `1px solid ${UI_COLORS.WPE_BRAND}`,
    color: UI_COLORS.WPE_BRAND,
    borderRadius: 3,
    fontSize: 10,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  switchWrap: { display: 'flex', justifyContent: 'flex-end' },
  error: { color: '#c0392b', fontSize: 11, margin: '8px 0 0' },
};

export class GovernSection extends React.Component<GovernSectionProps, GovernSectionState> {
  private mounted = false;

  state: GovernSectionState = { matrix: null, loading: true, pending: null, error: null, landedOn: null };

  componentDidMount(): void {
    this.mounted = true;
    void this.load();
  }

  componentDidUpdate(prev: GovernSectionProps): void {
    if (prev.door !== this.props.door) this.applyDoor();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  private async load(): Promise<void> {
    try {
      const matrix = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GOVERN_MATRIX);
      if (!this.mounted) return;
      this.setState({ matrix: matrix ?? null, loading: false }, () => this.applyDoor());
    } catch {
      if (!this.mounted) return;
      // A matrix that could not be read is NOT an empty matrix: "no rows" and
      // "seven rows, all denied" are different claims and only one is true.
      this.setState({ matrix: null, loading: false });
    }
  }

  /**
   * Land the door on its row.
   *
   * J-Refusal's deep-link criterion: the row is the answer to the refusal that
   * sent you here, so the door scrolls to that row and marks it. A door that
   * merely opened this page would be the "top of Settings" the criterion names
   * as the failure.
   */
  private applyDoor(): void {
    const { door, onDoorHandled } = this.props;
    const { matrix } = this.state;
    if (!door || !matrix) return;
    if (door.surface !== 'settings' || door.section !== 'capabilities') return;
    const row = matrix.rows.find((r) => r.capability === door.capability);
    // No row means nothing serves that capability any more. Marking nothing is
    // correct; falling back to the first row would land a promotion refusal on
    // the plugin-update row and look like it had worked.
    if (!row) return;
    this.setState({ landedOn: row.capability }, () => {
      const el = document.querySelector(`[data-govern-row="${row.capability}"]`);
      if (el && typeof (el as any).scrollIntoView === 'function') {
        (el as any).scrollIntoView({ block: 'center' });
      }
      onDoorHandled?.();
    });
  }

  /**
   * The act. ONE capability, and the row it was made on is the row it is
   * reversible from.
   */
  private setGrant = async (capability: string, grant: boolean): Promise<void> => {
    this.setState({ pending: capability, error: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GOVERN_SET_GRANT, {
        capability,
        grant,
      });
      if (!this.mounted) return;
      if (result?.ok) {
        this.setState({ matrix: result.matrix ?? this.state.matrix, pending: null });
        return;
      }
      // An act that did not happen must never leave the switch looking moved.
      this.setState({
        pending: null,
        matrix: result?.matrix ?? this.state.matrix,
        error: REFUSAL_COPY[result?.reason as keyof typeof REFUSAL_COPY] ?? REFUSAL_COPY.unknown,
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ pending: null, error: REFUSAL_COPY.unknown });
    }
  };

  render(): React.ReactNode {
    const { matrix, loading, error } = this.state;
    if (loading) return React.createElement('div', { style: styles.preamble }, 'Reading what agents may do…');
    if (!matrix) {
      return React.createElement(
        'div',
        { style: styles.preamble },
        'Nexus could not read the capability register, so this list is not shown. ' +
          'Nothing was granted or revoked.'
      );
    }

    return React.createElement(
      'div',
      { 'data-govern-matrix': 'true' },
      React.createElement('p', { key: 'preamble', style: styles.preamble }, matrix.preamble),
      React.createElement(
        'div',
        { key: 'table', style: styles.table },
        React.createElement(
          'div',
          { key: 'head', style: styles.headRow },
          React.createElement('div', { key: 'c' }, 'Capability'),
          React.createElement('div', { key: 's' }, 'State'),
          React.createElement('div', { key: 'd' }, 'The document it is pinned to'),
          React.createElement('div', { key: 'g' }, 'What granting it gates'),
          React.createElement('div', { key: 'a' }, '')
        ),
        ...matrix.rows.map((row) => this.renderRow(row))
      ),
      error ? React.createElement('p', { key: 'error', style: styles.error }, error) : null
    );
  }

  private renderRow(row: GovernRow): React.ReactNode {
    const landed = this.state.landedOn === row.capability;
    const tone = CHIP_TONE[row.state];
    return React.createElement(
      'div',
      {
        key: row.capability,
        'data-govern-row': row.capability,
        'data-govern-state': row.state,
        style: landed ? { ...styles.row, ...styles.landed } : styles.row,
      },
      // Capability — the ratified label, with the id in mono beside it. The
      // refusals cite ids; hiding the id breaks the door's own vocabulary.
      React.createElement(
        'div',
        { key: 'cap' },
        React.createElement('div', { style: styles.label }, row.label),
        React.createElement('div', { 'data-govern-id': row.capability, style: styles.id }, row.id),
        React.createElement('div', { style: styles.ceremony }, row.ceremony)
      ),
      // State — the chip, then the act that made it, from the grant's own event.
      React.createElement(
        'div',
        { key: 'state' },
        React.createElement(
          'span',
          { 'data-govern-chip': row.state, style: { ...styles.chip, color: tone.fg, background: tone.bg, borderColor: tone.border } },
          row.chip
        ),
        React.createElement('div', { style: styles.mono }, row.stateLine)
      ),
      // Document — named, versioned, hashed. Never copied.
      React.createElement('div', { key: 'doc', style: styles.mono }, row.documentLine),
      // Gates — the seam's lines, in order, unsoftened.
      React.createElement(
        'div',
        { key: 'gates' },
        ...row.gatesLines.map((line, i) =>
          React.createElement('div', { key: `g${i}`, style: i === 0 ? styles.gatesLead : undefined }, line)
        )
      ),
      // The act.
      React.createElement(
        'div',
        { key: 'act', style: styles.switchWrap },
        this.renderSwitch(row)
      ),
      row.disarm ? this.renderBand(row) : null
    );
  }

  /**
   * The switch — CONSENT, never force.
   *
   * `checked` is `row.consent`, which is true on a disarmed row. That is ruling
   * 3 in one line: the user granted this and nothing they did withdrew it, so
   * the switch that represents their consent stays where they left it, and the
   * chip beside it carries the platform's report that it is not in force.
   */
  private renderSwitch(row: GovernRow): React.ReactNode {
    const pending = this.state.pending === row.capability;
    return React.createElement('input', {
      type: 'checkbox',
      role: 'switch',
      'data-govern-switch': row.capability,
      'aria-label': `${row.label} (${row.id})`,
      checked: row.consent,
      disabled: pending,
      onChange: () => this.setGrant(row.capability, !row.consent),
    });
  }

  /** The disarm band: the reason in the seam's words, and its door. */
  private renderBand(row: GovernRow): React.ReactNode {
    const disarm = row.disarm!;
    return React.createElement(
      'div',
      { key: 'band', 'data-govern-band': row.capability, style: styles.band },
      React.createElement('div', { key: 'text' }, disarm.band),
      disarm.detail ? React.createElement('div', { key: 'detail', style: styles.mono }, disarm.detail) : null,
      disarm.doorLabel
        ? React.createElement(
            'button',
            {
              key: 'door',
              type: 'button',
              style: styles.door,
              'data-govern-band-door': row.capability,
              disabled: this.state.pending === row.capability,
              // Re-granting pins the CURRENT document — which is what the door's
              // own words promise, and what makes it an act rather than a label.
              onClick: () => this.setGrant(row.capability, true),
            },
            disarm.doorLabel
          )
        : null
    );
  }
}

/**
 * What a refused act says.
 *
 * Named per reason rather than passed through from the seam: these are the only
 * sentences this file authors, and they are about the CLICK rather than about a
 * capability, so they are the surface's to write. Each one says what did not
 * happen, because on this surface the harmful lie is a person believing they
 * granted something.
 */
const REFUSAL_COPY = {
  'no-core': 'Nexus could not reach the capability register, so nothing was granted or revoked.',
  'not-served': 'No document serves that capability any more, so there is nothing to grant.',
  unwritable: 'That change could not be saved, so nothing was granted or revoked.',
  unknown: 'That change did not go through, so nothing was granted or revoked.',
} as const;
