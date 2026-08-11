/**
 * Sites tab — one table, three host types.
 *
 * Replaces SystemTab (the per-site list inside Operations), the dashboard's
 * FleetCompletenessWidget and its Fleet Summary card. A row is a site, whatever
 * hosts it: Local, WP Engine or an external SSH host.
 *
 * Selection state lives here but the bulk action bar is Task 5; this task
 * renders the table and wires the checkbox handlers it is given.
 *
 * Colours are `var(--nxai-*)` with NO hex fallback, deliberately. The variables
 * are injected by NexusOverview's componentDidMount before this ever renders,
 * and a fallback would defeat the test that pins zero hardcoded colours.
 */
import * as React from 'react';
import { KNOWLEDGE_LABELS } from '../../../main/fleet/knowledgeLadder';
import type { SiteRow } from '../../../main/fleet/siteRows';
import type { PopulationCount } from '../../../main/fleet/FleetCounts';

type HostFilter = 'all' | 'local' | 'wpe' | 'external';

interface SitesTabProps {
  /** False until the first GET_SITE_ROWS response has landed. */
  loaded: boolean;
  /** The read failed. Distinct from an empty fleet — never conflate them. */
  failed: boolean;
  rows: SiteRow[];
  total: PopulationCount;
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  /** Task 5 adds the bulk bar that calls this. Two args: never "all", always ids. */
  onBulk: (action: string, ids: string[]) => void;
  onIndexHost: (alias: string) => void;
  onRetry: () => void;
}

interface SitesTabState {
  filter: HostFilter;
}

/** The words the design uses. Not the raw `source` value. */
const SOURCE_LABELS: Record<SiteRow['source'], string> = {
  local: 'This Mac',
  wpe: 'WP Engine',
  external: 'External',
};

const FILTERS: Array<{ key: HostFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'local', label: 'This Mac' },
  { key: 'wpe', label: 'WP Engine' },
  { key: 'external', label: 'External' },
];

/** Unknown renders as an em dash. Never as a plausible-looking default. */
const UNKNOWN = '—';

/**
 * Operations' zone 1 offered four buttons, but only two distinct operations —
 * `Refresh metadata` and `Index content`, once per source. The source split
 * disappears here because the selection carries it, so four collapse to two.
 * (Task 5's prose says "the four actions"; its own mapping line gives these two.)
 *
 * These are BulkOpType values and go through BulkOperationManager, which is
 * where the audit trail lives. Do not add a second bulk path.
 */
const BULK_ACTIONS: Array<{ type: string; label: string }> = [
  { type: 'sync-graph', label: 'Refresh metadata' },
  { type: 'reindex', label: 'Index content' },
];

const wrapStyle: React.CSSProperties = {
  padding: '4px 0',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '16px',
  marginBottom: '12px',
};

const totalStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub)',
};

const totalCountStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: 'var(--nxai-card-text)',
  marginRight: '6px',
};

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  marginBottom: '12px',
};

const filterBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid var(--nxai-card-border)',
  backgroundColor: active ? 'var(--nxai-accent)' : 'var(--nxai-card-bg)',
  color: active ? 'var(--nxai-accent-text)' : 'var(--nxai-card-text)',
});

const bulkBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 12px',
  marginBottom: '12px',
  borderRadius: '8px',
  border: '1px solid var(--nxai-card-border)',
  backgroundColor: 'var(--nxai-section-bg)',
};

const bulkCountStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub)',
  marginRight: 'auto',
};

const bulkBtnStyle = (enabled: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  borderRadius: '6px',
  border: 'none',
  fontSize: '12px',
  fontWeight: 500,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
  backgroundColor: 'var(--nxai-accent)',
  color: 'var(--nxai-accent-text)',
});

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  color: 'var(--nxai-card-label)',
  borderBottom: '1px solid var(--nxai-card-border)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--nxai-card-border)',
  verticalAlign: 'top',
};

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
};

const subStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub)',
};

const messageStyle: React.CSSProperties = {
  padding: '32px 20px',
  textAlign: 'center',
  fontSize: '13px',
  color: 'var(--nxai-card-sub)',
  border: '1px solid var(--nxai-card-border)',
  borderRadius: '10px',
  backgroundColor: 'var(--nxai-card-bg)',
};

const errorTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--nxai-danger-text)',
  marginBottom: '8px',
};

const retryBtnStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '6px 14px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'var(--nxai-accent)',
  color: 'var(--nxai-accent-text)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

function formatLastSync(ms: number | null): string {
  if (!ms) return UNKNOWN;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return UNKNOWN;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export class SitesTab extends React.Component<SitesTabProps, SitesTabState> {
  state: SitesTabState = { filter: 'all' };

  private visibleRows(): SiteRow[] {
    const { filter } = this.state;
    if (filter === 'all') return this.props.rows;
    return this.props.rows.filter(r => r.source === filter);
  }

  /**
   * Acts on the selection and nothing else. The empty check is duplicated here
   * on purpose: `disabled` is a visual guard a keyboard or programmatic caller
   * can walk straight past, and an empty selection must never be read as "all".
   */
  handleBulk = (type: string): void => {
    const ids = this.props.selected;
    if (ids.length === 0) return;
    this.props.onBulk(type, ids);
  };

  private renderBulkBar(): React.ReactNode {
    const enabled = this.props.selected.length > 0;
    return React.createElement(
      'div',
      { style: bulkBarStyle },
      React.createElement(
        'span',
        { style: bulkCountStyle },
        // Scoped to the whole list, not the filtered view: the selection
        // survives a filter change, so counting against visible rows would
        // report "1 of 3" for a selection of five.
        `${this.props.selected.length} of ${this.props.rows.length} selected`,
      ),
      BULK_ACTIONS.map(a =>
        React.createElement(
          'button',
          {
            key: a.type,
            type: 'button',
            disabled: !enabled,
            style: bulkBtnStyle(enabled),
            onClick: () => this.handleBulk(a.type),
          },
          a.label,
        ),
      ),
    );
  }

  private renderFilters(): React.ReactNode {
    return React.createElement(
      'div',
      { style: filterBarStyle },
      FILTERS.map(f =>
        React.createElement(
          'button',
          {
            key: f.key,
            type: 'button',
            style: filterBtnStyle(this.state.filter === f.key),
            onClick: () => this.setState({ filter: f.key }),
          },
          f.label,
        ),
      ),
    );
  }

  private renderTypeCell(r: SiteRow): React.ReactNode {
    // External rows name the connection they live under. The alias is a
    // connection, not a site — one alias can host several, so the row needs it
    // to be identifiable at all.
    return React.createElement(
      'td',
      { style: tdStyle },
      React.createElement('div', null, SOURCE_LABELS[r.source]),
      r.source === 'external' && r.host
        ? React.createElement('div', { style: subStyle }, r.host)
        : null,
    );
  }


  private renderRow(r: SiteRow): React.ReactNode {
    const checked = this.props.selected.indexOf(r.id) !== -1;
    return React.createElement(
      'tr',
      { key: r.id },
      React.createElement(
        'td',
        { style: tdStyle },
        React.createElement('input', {
          type: 'checkbox',
          checked,
          'aria-label': `Select ${r.name}`,
          onChange: () => this.props.onToggle(r.id),
        }),
      ),
      React.createElement(
        'td',
        { style: tdStyle },
        React.createElement('div', { style: nameStyle }, r.name),
        r.domain ? React.createElement('div', { style: subStyle }, r.domain) : null,
      ),
      this.renderTypeCell(r),
      React.createElement('td', { style: tdStyle }, KNOWLEDGE_LABELS[r.knowledge]),
      React.createElement('td', { style: tdStyle }, r.wpVersion || UNKNOWN),
      React.createElement('td', { style: tdStyle }, r.phpVersion || UNKNOWN),
      React.createElement('td', { style: tdStyle }, formatLastSync(r.lastSyncAt)),
    );
  }

  private renderTable(rows: SiteRow[]): React.ReactNode {
    const ids = rows.map(r => r.id);
    const allChecked = ids.length > 0 && ids.every(id => this.props.selected.indexOf(id) !== -1);

    return React.createElement(
      'table',
      { style: tableStyle },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          React.createElement(
            'th',
            { style: thStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: allChecked,
              'aria-label': 'Select all sites',
              onChange: () => this.props.onToggleAll(ids),
            }),
          ),
          React.createElement('th', { style: thStyle }, 'Name'),
          React.createElement('th', { style: thStyle }, 'Type'),
          React.createElement('th', { style: thStyle }, 'Knowledge'),
          React.createElement('th', { style: thStyle }, 'WP'),
          React.createElement('th', { style: thStyle }, 'PHP'),
          React.createElement('th', { style: thStyle }, 'Last sync'),
        ),
      ),
      React.createElement('tbody', null, rows.map(r => this.renderRow(r))),
    );
  }

  render(): React.ReactNode {
    const { loaded, failed, total } = this.props;

    // Guard order: failed → !loaded → empty → table. `failed` is checked first
    // and never falls through: a read that failed is not an empty fleet, and
    // telling a user with 300 sites that they have none is the worse error.
    if (failed) {
      return React.createElement(
        'div',
        { style: messageStyle },
        React.createElement('div', { style: errorTitleStyle }, "Couldn't read your sites"),
        React.createElement(
          'div',
          null,
          'This is a problem reading them, not a sign that you have none.',
        ),
        React.createElement(
          'button',
          { type: 'button', style: retryBtnStyle, onClick: this.props.onRetry },
          'Try again',
        ),
      );
    }

    if (!loaded) {
      return React.createElement('div', { style: messageStyle }, 'Loading your sites…');
    }

    if (this.props.rows.length === 0) {
      return React.createElement(
        'div',
        { style: messageStyle },
        'No sites yet. Local sites appear automatically; add a WP Engine account or an SSH host to see more.',
      );
    }

    const rows = this.visibleRows();

    return React.createElement(
      'div',
      { style: wrapStyle },
      React.createElement(
        'div',
        { style: headerRowStyle },
        // Always `{count} {scope}`. A bare number leaves the reader guessing
        // which population it counts — three disagree in this codebase.
        React.createElement(
          'div',
          { style: totalStyle },
          React.createElement('span', { style: totalCountStyle }, String(total.count)),
          total.scope,
        ),
      ),
      this.renderFilters(),
      this.renderBulkBar(),
      rows.length === 0
        ? React.createElement(
            'div',
            { style: messageStyle },
            'No sites of that type.',
          )
        : this.renderTable(rows),
    );
  }
}
