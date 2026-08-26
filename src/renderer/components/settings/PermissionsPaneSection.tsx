/**
 * THE MERGED PERMISSIONS PANE (fixes-082526 phase 5) — built to the reissued
 * sheet (docs/handoff/settings-permissions/), both owner rulings applied.
 *
 * One pane, two layers. The BOUND above (operation × place, reading stated
 * once, the account scope at its foot — ruling 2: part of the bound, one
 * mechanism); the GRANTS below (per capability: the holder SET, the act's
 * document + gates, and the clipped line derived from bound × capability).
 *
 * THIS PANE READS AND DOES NOT EDIT (ruling 1). No Switch, no editable
 * control of any kind: the bound is adjusted through its own editor (a door),
 * chat/mcp-client grants are made in Govern (a door), and an agent's grants
 * are made inside that agent. Two surfaces used to answer "may an agent pull
 * a site?" with opposite words; this is now the one surface that answers,
 * and the editors are doors away.
 *
 * Every string is derived in permissionsPaneModel.ts / permissionsPane.ts —
 * nothing here computes, nothing is authored per row.
 */
import * as React from 'react';
import type { NexusSettings } from '../../../common/types';
import {
  deriveBoundView,
  deriveGrantRows,
  type BoundView,
  type GrantRowView,
  type MatrixRowLike,
} from './permissionsPaneModel';

export interface PermissionsPaneSectionProps {
  settings: Partial<NexusSettings>;
  wpeAccounts: Array<{ id: string; name: string }>;
  electron: any;
  /** Doors — the pane never edits; it walks you to where the decision lives. */
  onOpenBoundEditor: () => void;
  onOpenGovern: () => void;
}

interface PaneState {
  matrixRows: MatrixRowLike[] | null;
  loaded: boolean;
}

const card: React.CSSProperties = {
  background: 'var(--nxai-card-bg)',
  border: '1px solid var(--nxai-card-border)',
  borderRadius: 6,
  padding: 16,
  marginBottom: 16,
};

const doorStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--nxai-action)',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const STATE_TONE: Record<string, React.CSSProperties> = {
  allowed: { color: 'var(--nxai-card-text)' },
  blocked: { color: '#8a6d1f', fontWeight: 600 },
};

export class PermissionsPaneSection extends React.Component<PermissionsPaneSectionProps, PaneState> {
  state: PaneState = { matrixRows: null, loaded: false };

  componentDidMount(): void {
    void this.loadMatrix();
  }

  private loadMatrix = async (): Promise<void> => {
    try {
      const matrix = await this.props.electron?.ipcRenderer?.invoke('nexus-ai:govern:matrix');
      this.setState({ matrixRows: matrix?.rows ?? null, loaded: true });
    } catch {
      this.setState({ matrixRows: null, loaded: true });
    }
  };

  private renderBound(bound: BoundView): React.ReactNode {
    return React.createElement('div', { style: card, 'data-pane-layer': 'bound' },
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 2 } },
        'Where agents may write at all'),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 } },
        bound.readingLine),
      // header
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2.2fr 1.4fr 1fr 1fr 1fr', gap: 10, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--nxai-muted-text)', borderBottom: '1px solid var(--nxai-card-border)', paddingBottom: 6 } },
        React.createElement('span', null, 'Operation'),
        React.createElement('span', null, 'Transport'),
        ...bound.places.map((p) => React.createElement('span', { key: p }, p)),
      ),
      ...bound.rows.map((row) => React.createElement('div', {
        key: row.op,
        'data-bound-row': row.op,
        style: { display: 'grid', gridTemplateColumns: '2.2fr 1.4fr 1fr 1fr 1fr', gap: 10, fontSize: 12.5, padding: '8px 0', borderBottom: '1px solid var(--nxai-card-border)' },
      },
        React.createElement('span', { style: { color: 'var(--nxai-card-text)', fontWeight: 500 } }, row.op),
        React.createElement('span', { style: { color: 'var(--nxai-card-sub)' } }, row.transport),
        ...row.states.map((s, i) => React.createElement('span', { key: i, style: STATE_TONE[s] }, s)),
      )),
      // the scope — ruling 2: part of the bound, stated once at its foot
      React.createElement('div', { style: { marginTop: 12 }, 'data-pane-scope': true },
        React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--nxai-card-text)' } }, bound.scope.head),
        React.createElement('div', { style: { fontSize: 11.5, color: 'var(--nxai-card-sub)', margin: '2px 0 6px' } }, bound.scope.note),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-text)' } },
          `Covered: ${bound.scope.included.join(', ') || 'none'}`),
        bound.scope.excluded.length > 0
          ? React.createElement('div', { style: { fontSize: 12, color: '#8a6d1f', fontWeight: 600 } },
              `Excluded, whole: ${bound.scope.excluded.join(', ')}`)
          : null,
      ),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('button', { style: doorStyle, onClick: this.props.onOpenBoundEditor, 'data-pane-door': 'bound-editor' },
          'Adjust where agents may write →'),
      ),
    );
  }

  private renderGrants(rows: GrantRowView[] | null): React.ReactNode {
    if (!rows) {
      return React.createElement('div', { style: card, 'data-pane-layer': 'grants' },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 4 } },
          'The grants'),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--nxai-card-sub)' } },
          'Grant records are unavailable — background record-keeping is not running. ' +
          'Nothing can be shown as granted or denied until it recovers.'),
      );
    }
    return React.createElement('div', { style: card, 'data-pane-layer': 'grants' },
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 2 } },
        'The grants'),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 } },
        'Every agent’s grants in one place, to read. A grant belongs to whoever holds it: ' +
        'chat and MCP client grants are made in Govern, an agent’s inside that agent.'),
      ...rows.map((row) => React.createElement('div', {
        key: row.capability,
        'data-grant-row': row.capability,
        style: { padding: '10px 0', borderBottom: '1px solid var(--nxai-card-border)' },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--nxai-card-text)' } }, row.label),
          React.createElement('span', { style: { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--nxai-muted-text)' } },
            `${row.capability} · ${row.kind}`),
          React.createElement('span', { style: { fontSize: 11.5, color: 'var(--nxai-card-sub)' } }, row.holderLine),
        ),
        React.createElement('div', { style: { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--nxai-muted-text)', marginTop: 2 } },
          row.documentLine),
        ...row.gatesLines.map((g, i) => React.createElement('div', { key: i, style: { fontSize: 11.5, color: 'var(--nxai-card-sub)', marginTop: 2 } }, g)),
        row.clippedLine
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-text)', marginTop: 4 }, 'data-clipped-line': true },
              row.clippedLine)
          : null,
        row.disarm
          ? React.createElement('div', { style: { fontSize: 11.5, color: '#c0392b', marginTop: 4 } },
              `${row.disarm.reason}${row.disarm.detail ? ` — ${row.disarm.detail}` : ''}`)
          : null,
      )),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('button', { style: doorStyle, onClick: this.props.onOpenGovern, 'data-pane-door': 'govern' },
          'Grant or revoke (chat & MCP clients) →'),
      ),
    );
  }

  render(): React.ReactElement {
    const bound = deriveBoundView(this.props.settings as never, this.props.wpeAccounts);
    const rows = this.state.matrixRows ? deriveGrantRows(this.state.matrixRows, bound) : null;
    return React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 12.5, lineHeight: 1.55, color: 'var(--nxai-card-sub)', marginBottom: 14, maxWidth: 720 } },
        'Nothing here is granted because a document exists. A capability arrives denied, and ' +
        'becomes granted only by an act recorded against a holder. This pane reads; the ' +
        'decisions are made where each one lives.'),
      this.renderBound(bound),
      this.renderGrants(rows),
    );
  }
}
