/**
 * Top Issues Panel Component (Sprint 1)
 *
 * Displays proactive issue detection and quick actions.
 * Features:
 * - Issue list sorted by severity (error > warning)
 * - Color-coded severity badges
 * - Action buttons for quick fixes
 * - Empty state when all systems healthy
 * - Max 5 issues shown
 * - Auto-refresh
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { Issue } from '../../common/types';

interface TopIssuesPanelProps {
  electron: any;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface TopIssuesPanelState {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  actionInProgress: string | null; // Issue ID being acted upon
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

const issueListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const issueEntryStyle = (severity: 'warning' | 'error'): React.CSSProperties => {
  const borderColor = severity === 'error' ? UI_COLORS.STATUS_ERROR : UI_COLORS.STATUS_WARNING;
  const bgColor = severity === 'error' ? `${UI_COLORS.STATUS_ERROR}08` : `${UI_COLORS.STATUS_WARNING}08`;

  return {
    padding: '12px',
    borderRadius: '6px',
    border: `1px solid ${borderColor}`,
    backgroundColor: bgColor,
  };
};

const issueHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
};

const severityBadgeStyle = (severity: 'warning' | 'error'): React.CSSProperties => {
  const color = severity === 'error' ? UI_COLORS.STATUS_ERROR : UI_COLORS.STATUS_WARNING;

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: `${color}20`,
    color,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };
};

const issueTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  flex: 1,
};

const issueDescriptionStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '8px',
  lineHeight: 1.5,
};

const actionButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: disabled ? 'var(--nxai-card-border, #e5e7eb)' : UI_COLORS.STATUS_RUNNING,
  color: disabled ? 'var(--nxai-card-sub, #6b7280)' : '#fff',
  fontSize: '12px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'all 0.2s',
});

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: '48px',
  marginBottom: '12px',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: UI_COLORS.STATUS_RUNNING,
  marginBottom: '4px',
};

const emptySubtextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

/**
 * TopIssuesPanel Component
 */
export class TopIssuesPanel extends React.Component<TopIssuesPanelProps, TopIssuesPanelState> {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  static defaultProps = {
    autoRefresh: true,
    refreshInterval: 60000, // 60 seconds
  };

  state: TopIssuesPanelState = {
    issues: [],
    loading: true,
    error: null,
    actionInProgress: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchIssues();

    if (this.props.autoRefresh) {
      this.refreshTimer = setInterval(
        () => this.fetchIssues(),
        this.props.refreshInterval!,
      );
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  fetchIssues = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.ISSUES_DETECT,
      );

      if (!this.mounted) return;

      if (result.success) {
        // Sort by severity (error > warning), then by count (desc)
        const sortedIssues = (result.issues || []).sort((a: Issue, b: Issue) => {
          if (a.severity !== b.severity) {
            return a.severity === 'error' ? -1 : 1;
          }
          return b.count - a.count;
        });

        // Limit to 5 issues
        const limitedIssues = sortedIssues.slice(0, 5);

        this.setState({
          issues: limitedIssues,
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to detect issues',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        error: err.message || 'Failed to detect issues',
        loading: false,
      });
    }
  };

  handleRetryFailed = async (): Promise<void> => {
    if (this.state.actionInProgress) return;

    this.setState({ actionInProgress: 'retry-failed' });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.EVENTS_RETRY_FAILED,
      );

      if (!this.mounted) return;

      if (result.success) {
        // Refresh issues after retry
        setTimeout(() => this.fetchIssues(), 500);
      }

      this.setState({ actionInProgress: null });
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({ actionInProgress: null });
    }
  };

  handleCleanupStorage = async (): Promise<void> => {
    if (this.state.actionInProgress) return;

    this.setState({ actionInProgress: 'cleanup-storage' });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.STORAGE_CLEANUP,
        { retentionDays: 30 },
      );

      if (!this.mounted) return;

      if (result.success) {
        // Refresh issues after cleanup
        setTimeout(() => this.fetchIssues(), 500);
      }

      this.setState({ actionInProgress: null });
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({ actionInProgress: null });
    }
  };

  getSeverityIcon(severity: 'warning' | 'error'): string {
    return severity === 'error' ? '✗' : '⚠';
  }

  getActionButton(issue: Issue): React.ReactNode {
    const { actionInProgress } = this.state;
    const isDisabled = actionInProgress !== null;

    if (issue.type === 'failed_events') {
      return React.createElement(
        'button',
        {
          style: actionButtonStyle(isDisabled),
          onClick: this.handleRetryFailed,
          disabled: isDisabled,
        },
        actionInProgress === 'retry-failed' ? 'Retrying...' : 'Retry Failed Events',
      );
    }

    if (issue.type === 'storage_high') {
      return React.createElement(
        'button',
        {
          style: actionButtonStyle(isDisabled),
          onClick: this.handleCleanupStorage,
          disabled: isDisabled,
        },
        actionInProgress === 'cleanup-storage' ? 'Cleaning...' : 'Cleanup Storage',
      );
    }

    return null;
  }

  renderIssue(issue: Issue): React.ReactNode {
    return React.createElement(
      'div',
      { key: issue.id, style: issueEntryStyle(issue.severity) },
      React.createElement(
        'div',
        { style: issueHeaderStyle },
        React.createElement(
          'span',
          { style: severityBadgeStyle(issue.severity) },
          React.createElement('span', null, this.getSeverityIcon(issue.severity)),
          React.createElement('span', null, issue.severity.toUpperCase()),
        ),
        React.createElement('div', { style: issueTitleStyle }, issue.title),
      ),
      React.createElement('div', { style: issueDescriptionStyle }, issue.description),
      this.getActionButton(issue),
    );
  }

  renderEmptyState(): React.ReactNode {
    return React.createElement(
      'div',
      { style: emptyStateStyle },
      React.createElement('div', { style: emptyIconStyle }, '✓'),
      React.createElement('div', { style: emptyTextStyle }, 'All Systems Healthy'),
      React.createElement('div', { style: emptySubtextStyle }, 'No issues detected'),
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement(
      'div',
      { style: { ...emptyStateStyle, padding: '40px 20px' } },
      'Detecting issues...',
    );
  }

  renderError(): React.ReactNode {
    const { error } = this.state;
    return React.createElement(
      'div',
      {
        style: {
          padding: '20px',
          border: `1px solid ${UI_COLORS.STATUS_ERROR}`,
          borderRadius: '6px',
          backgroundColor: `${UI_COLORS.STATUS_ERROR}10`,
          color: UI_COLORS.STATUS_ERROR,
          fontSize: '13px',
        },
      },
      `Error: ${error}`,
    );
  }

  render(): React.ReactNode {
    const { loading, error, issues } = this.state;

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Top Issues'),
      loading
        ? this.renderLoading()
        : error
        ? this.renderError()
        : issues.length === 0
        ? this.renderEmptyState()
        : React.createElement(
            'div',
            { style: issueListStyle },
            issues.map(issue => this.renderIssue(issue)),
          ),
    );
  }
}
