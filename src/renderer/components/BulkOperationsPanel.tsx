/**
 * Bulk Operations Panel Component (Sprint 2)
 *
 * Displays bulk operation status and history.
 * Features:
 * - List of bulk operations with type, state, progress
 * - State badges (pending, running, completed, failed, cancelled)
 * - Progress bar for running operations
 * - Expandable per-site results
 * - Cancel button for running operations
 * - Auto-polling every 5 seconds
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { BulkOperationStatus } from '../../common/types';
// Type only — a value import would pull main-process code into the renderer bundle.
// Typing the map by BulkOpType makes it exhaustive: a new job type fails the build here
// rather than silently rendering its raw identifier to a user.
import type { BulkOpType } from '../../main/bulk/types';
import { summarizeBulkOperation, type BulkOperationSummary } from '../../main/bulk/summary';

/**
 * Job class names are implementation identifiers. A user who pressed "Refresh metadata"
 * and then watched something called `sync-graph` has no way to tell whether it is the
 * thing they started. Unmapped types fall back to a de-slugged form rather than the raw
 * value, so a new BulkOpType reads as words even before it is added here.
 */
const BULK_TYPE_LABELS: Record<BulkOpType, string> = {
  index: 'Indexing (metadata + content)',
  'sync-graph': 'Refresh metadata',
  reindex: 'Index content',
  'setup-ai': 'Set up AI',
  'plugin-update': 'Update plugins',
  'health-refresh': 'Refresh health',
  start: 'Start sites',
  stop: 'Stop sites',
};

export function bulkTypeLabel(type: string): string {
  const known = BULK_TYPE_LABELS[type as BulkOpType];
  if (known) return known;
  const words = type.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface BulkOperationsPanelProps {
  electron: any;
  siteNames?: Map<string, string>; // id → human-readable name
}

interface BulkOperationsPanelState {
  operations: BulkOperationStatus[];
  loading: boolean;
  error: string | null;
  expandedId: string | null;
}

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '16px',
};

const operationListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const cardStyle = (isExpanded: boolean): React.CSSProperties => ({
  padding: '12px 14px',
  borderRadius: '8px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: isExpanded ? 'var(--nxai-card-bg, #fff)' : 'transparent',
  cursor: 'pointer',
  transition: 'all 0.2s',
});

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
};

const cardInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const operationTypeStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const operationMetaStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginTop: '2px',
};

export const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  running: { bg: '#3b82f6', text: '#ffffff' },
  completed: { bg: '#22c55e', text: '#ffffff' },
  // Explicit, not a fallthrough: this used to fall to the pending colour by
  // accident, which happened to read amber but claimed so by luck.
  completed_with_errors: { bg: '#a16207', text: '#ffffff' },
  failed: { bg: '#ef4444', text: '#ffffff' },
  cancelled: { bg: '#6b7280', text: '#ffffff' },
  pending: { bg: '#f59e0b', text: '#ffffff' },
  skipped: { bg: '#a16207', text: '#ffffff' },
};

/**
 * The colour a status badge actually paints — WP-67's colour rule
 * (fixes-082526 Tier A 5a): "a status word that summarizes a run must not be
 * greener than the run." A 'completed' operation in which sites were asked
 * and NONE succeeded keeps its word (the run did complete; what it completed
 * was nothing) but loses the success colour — it paints amber, the
 * did-not-run tone the counts beneath it already carry. An empty selection
 * stays green: nothing was asked, nothing failed.
 */
export function badgeToneFor(
  status: string,
  summary: BulkOperationSummary,
): { bg: string; text: string } {
  const attempted = summary.succeeded + summary.failed + summary.skipped;
  if (status === 'completed' && attempted > 0 && summary.succeeded === 0) {
    return BADGE_COLORS.skipped;
  }
  return BADGE_COLORS[status] || BADGE_COLORS.pending;
}

const badgeStyle = (state: string, tone?: { bg: string; text: string }): React.CSSProperties => {
  const colors = tone ?? BADGE_COLORS[state] ?? BADGE_COLORS.pending;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: colors.bg,
    color: colors.text,
    textTransform: 'capitalize',
    flexShrink: 0,
  };
};

const progressBarContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '6px',
  backgroundColor: 'var(--nxai-card-border, #e5e7eb)',
  borderRadius: '3px',
  overflow: 'hidden',
  marginTop: '8px',
};

const progressBarFillStyle = (progress: number): React.CSSProperties => ({
  height: '100%',
  width: `${Math.min(progress, 100)}%`,
  backgroundColor: '#3b82f6',
  transition: 'width 0.3s ease',
});

const cardActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexShrink: 0,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '#ef444420',
  color: 'var(--color-error, #ef4444)',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
};

const expandedSectionStyle: React.CSSProperties = {
  marginTop: '12px',
  paddingTop: '12px',
  borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
};

const resultListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

/**
 * Three visual states, because there are three outcomes. A boolean here
 * painted every "did not run" row in failure red, which is the opposite
 * mistake to the one that painted them green — both misreport.
 */
const RESULT_TONE: Record<string, { fg: string; bg: string }> = {
  completed: { fg: '#22c55e', bg: '#22c55e10' },
  skipped: { fg: '#a16207', bg: '#f59e0b10' },
  // In flight, not a verdict. Without an entry here `toneFor` fell through to
  // the failure colour and painted every working site red.
  running: { fg: '#3b82f6', bg: '#3b82f610' },
  failed: { fg: '#ef4444', bg: '#ef444410' },
};
const toneFor = (status: string) => RESULT_TONE[status] ?? RESULT_TONE.failed;

const resultItemStyle = (status: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  borderRadius: '4px',
  backgroundColor: toneFor(status).bg,
  fontSize: '12px',
});

const resultSiteIdStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
};

const resultMessageStyle = (status: string): React.CSSProperties => ({
  fontSize: '11px',
  color: toneFor(status).fg,
  flexShrink: 0,
  marginLeft: '8px',
});

const resultDurationStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  flexShrink: 0,
  marginLeft: '8px',
};

const resultsSummaryStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '8px',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  padding: '20px',
  border: '1px solid #ef4444',
  borderRadius: '6px',
  backgroundColor: '#ef444410',
  color: 'var(--color-error, #ef4444)',
  fontSize: '13px',
};

/**
 * BulkOperationsPanel Component
 */
export class BulkOperationsPanel extends React.Component<BulkOperationsPanelProps, BulkOperationsPanelState> {
  private _mounted = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  state: BulkOperationsPanelState = {
    operations: [],
    loading: true,
    error: null,
    expandedId: null,
  };

  componentDidMount(): void {
    this._mounted = true;
    this.fetchOperations();

    this._pollTimer = setInterval(() => this.fetchOperations(), 5000);
  }

  componentWillUnmount(): void {
    this._mounted = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  fetchOperations = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.BULK_LIST,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          operations: result.operations || [],
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load operations',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({
        error: err.message || 'Failed to load operations',
        loading: false,
      });
    }
  };

  handleCancel = async (e: React.MouseEvent, opId: string): Promise<void> => {
    e.stopPropagation();

    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.BULK_CANCEL,
        opId,
      );

      if (!this._mounted) return;

      // Refresh immediately after cancel
      this.fetchOperations();
    } catch (err: any) {
      // Silently handle
    }
  };

  handleToggleExpand = (opId: string): void => {
    this.setState(prev => ({
      expandedId: prev.expandedId === opId ? null : opId,
    }));
  };

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;

    return date.toLocaleDateString();
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const secs = (ms / 1000).toFixed(1);
    return `${secs}s`;
  }

  /**
   * Derived, never independently computed. This used to count 'completed'
   * entries itself, which is how the panel printed "413 succeeded" for a run
   * in which three sites did the work.
   */
  getResultsSummary(op: BulkOperationStatus): BulkOperationSummary {
    return summarizeBulkOperation(op);
  }

  renderBadge(state: string, summary?: BulkOperationSummary): React.ReactNode {
    const tone = summary ? badgeToneFor(state, summary) : undefined;
    return React.createElement('span', { style: badgeStyle(state, tone) }, state);
  }

  renderProgressBar(progress: number): React.ReactNode {
    return React.createElement(
      'div',
      { style: progressBarContainerStyle },
      React.createElement('div', { style: progressBarFillStyle(progress) }),
    );
  }

  renderExpandedResults(op: BulkOperationStatus): React.ReactNode {
    const resultEntries = Object.entries(op.siteResults);
    const nonPendingIds = new Set(resultEntries.filter(([, r]) => (r as any).status !== 'pending').map(([id]) => id));
    const pendingSiteIds = op.siteIds.filter(id => !nonPendingIds.has(id));
    const summary = this.getResultsSummary(op);

    // "Did not run" is named, not folded into either of the other two. A run
    // where nothing happened must not read as a run where everything worked.
    const summaryLine = `Results: ${summary.succeeded} succeeded, ${summary.failed} failed, `
      + `${summary.skipped} did not run, ${summary.running} running, ${summary.pending} pending`;

    return React.createElement(
      'div',
      { style: expandedSectionStyle },
      React.createElement('div', { style: resultsSummaryStyle }, summaryLine),
      React.createElement(
        'div',
        { style: resultListStyle },
        resultEntries
          .filter(([, r]) => (r as any).status !== 'pending')
          .map(([siteId, result]: [string, any]) =>
            React.createElement(
              'div',
              { key: siteId, style: resultItemStyle(result.status) },
              React.createElement('span', { style: resultSiteIdStyle }, op.siteNames?.[siteId] ?? this.props.siteNames?.get(siteId) ?? siteId),
              React.createElement(
                'span',
                { style: resultMessageStyle(result.status) },
                // "Skipped — SSH key not configured" is a shippable sentence.
                // "Success" is not, and it is what this said for 410 of 413.
                // A site being worked on is not a verdict. The final branch
                // used to catch 'running' too, so a working site printed the
                // word "Failed" while the summary line said 0 failed.
                result.status === 'completed'
                  ? 'Success'
                  : result.status === 'skipped'
                    ? `Did not run — ${result.skipReason || 'reason not recorded'}`
                    : result.status === 'running'
                      ? 'Running…'
                      : (result.error || 'Failed'),
              ),
              result.completedAt && result.startedAt
                ? React.createElement('span', { style: resultDurationStyle }, this.formatDuration(result.completedAt - result.startedAt))
                : null,
            ),
          ),
        pendingSiteIds.map(siteId =>
          React.createElement(
            'div',
            {
              key: siteId,
              style: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 10px',
                borderRadius: '4px',
                backgroundColor: 'var(--nxai-card-border, #e5e7eb)',
                fontSize: '12px',
              },
            },
            React.createElement('span', { style: resultSiteIdStyle }, op.siteNames?.[siteId] ?? this.props.siteNames?.get(siteId) ?? siteId),
            React.createElement(
              'span',
              { style: { fontSize: '11px', color: 'var(--nxai-card-sub, #6b7280)' } },
              'Pending',
            ),
          ),
        ),
      ),
    );
  }

  renderOperation(op: BulkOperationStatus): React.ReactNode {
    const isExpanded = this.state.expandedId === op.id;
    const isRunning = op.status === 'running';

    return React.createElement(
      'div',
      {
        key: op.id,
        style: cardStyle(isExpanded),
        onClick: () => this.handleToggleExpand(op.id),
      },
      React.createElement(
        'div',
        { style: cardHeaderStyle },
        React.createElement(
          'div',
          { style: cardInfoStyle },
          React.createElement('div', { style: operationTypeStyle }, bulkTypeLabel(op.type)),
          React.createElement(
            'div',
            { style: operationMetaStyle },
            `${op.siteIds.length} site${op.siteIds.length === 1 ? '' : 's'} | Started ${this.formatTime(op.createdAt)}`,
          ),
        ),
        React.createElement(
          'div',
          { style: cardActionsStyle },
          this.renderBadge(op.status, this.getResultsSummary(op)),
          React.createElement(
            'span',
            { style: { fontSize: '14px', color: 'var(--nxai-status-neutral, #9ca3af)', marginLeft: '6px', userSelect: 'none' } },
            isExpanded ? '▾' : '▸',
          ),
          isRunning
            ? React.createElement(
                'button',
                {
                  style: cancelBtnStyle,
                  onClick: (e: React.MouseEvent) => this.handleCancel(e, op.id),
                },
                'Cancel',
              )
            : null,
        ),
      ),
      isRunning ? this.renderProgressBar(op.progress.total > 0 ? Math.round((op.progress.completed / op.progress.total) * 100) : 0) : null,
      isExpanded ? this.renderExpandedResults(op) : null,
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement('div', { style: loadingStyle }, 'Loading operations...');
  }

  renderError(): React.ReactNode {
    return React.createElement('div', { style: errorStyle }, `Error: ${this.state.error}`);
  }

  renderEmptyState(): React.ReactNode {
    return React.createElement('div', { style: emptyStateStyle }, 'No bulk operations yet');
  }

  render(): React.ReactNode {
    const { loading, error, operations } = this.state;

    let content: React.ReactNode;
    if (loading) {
      content = this.renderLoading();
    } else if (error) {
      content = this.renderError();
    } else if (operations.length === 0) {
      content = this.renderEmptyState();
    } else {
      content = React.createElement(
        'div',
        { style: operationListStyle },
        operations.map(op => this.renderOperation(op)),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Bulk Operations'),
      content,
    );
  }
}
