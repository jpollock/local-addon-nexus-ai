/**
 * Storage Health Panel Component (Sprint 1)
 *
 * Displays storage metrics and provides cleanup actions.
 * Features:
 * - Graph DB and Vector DB size visualization
 * - Progress bars with percentage
 * - Warning colors when >75% full
 * - Event count and date range
 * - Cleanup old events action
 * - Auto-refresh
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { StorageHealth } from '../../common/types';

interface StorageHealthPanelProps {
  electron: any;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface StorageHealthPanelState {
  health: StorageHealth | null;
  loading: boolean;
  error: string | null;
  cleaning: boolean;
  cleanupSuccess: string | null;
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

const storageGroupStyle: React.CSSProperties = {
  marginBottom: '20px',
};

const storageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
};

const storageLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
};

const storageSizeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

const progressBarContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '8px',
  backgroundColor: 'var(--nxai-card-border, #e5e7eb)',
  borderRadius: '4px',
  overflow: 'hidden',
  marginBottom: '8px',
};

const progressBarFillStyle = (percentage: number, isWarning: boolean): React.CSSProperties => ({
  height: '100%',
  width: `${Math.min(percentage, 100)}%`,
  backgroundColor: isWarning ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING,
  transition: 'width 0.3s ease',
});

const storageMetaStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

const actionsStyle: React.CSSProperties = {
  marginTop: '16px',
  display: 'flex',
  gap: '12px',
};

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: disabled ? 'var(--nxai-card-border, #e5e7eb)' : 'var(--nxai-card-bg, #fff)',
  color: disabled ? 'var(--nxai-card-sub, #6b7280)' : 'var(--nxai-card-text)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'all 0.2s',
});

const successMessageStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: `${UI_COLORS.STATUS_RUNNING}15`,
  color: UI_COLORS.STATUS_RUNNING,
  fontSize: '13px',
  fontWeight: 600,
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

/**
 * StorageHealthPanel Component
 */
export class StorageHealthPanel extends React.Component<StorageHealthPanelProps, StorageHealthPanelState> {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  static defaultProps = {
    autoRefresh: true,
    refreshInterval: 60000, // 60 seconds
  };

  state: StorageHealthPanelState = {
    health: null,
    loading: true,
    error: null,
    cleaning: false,
    cleanupSuccess: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchHealth();

    if (this.props.autoRefresh) {
      this.refreshTimer = setInterval(
        () => this.fetchHealth(),
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

  fetchHealth = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.STORAGE_GET_HEALTH,
      );

      if (!this.mounted) return;

      if (result.success) {
        this.setState({
          health: result.health,
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load storage health',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        error: err.message || 'Failed to load storage health',
        loading: false,
      });
    }
  };

  handleCleanup = async (): Promise<void> => {
    if (this.state.cleaning) return;

    this.setState({ cleaning: true, cleanupSuccess: null });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.STORAGE_CLEANUP,
        { retentionDays: 30 },
      );

      if (!this.mounted) return;

      if (result.success) {
        this.setState({
          cleaning: false,
          cleanupSuccess: `Cleaned up ${result.deletedCount} old event${result.deletedCount === 1 ? '' : 's'}`,
        });

        // Refresh health after cleanup
        setTimeout(() => this.fetchHealth(), 500);

        // Clear success message after 5 seconds
        setTimeout(() => {
          if (this.mounted) {
            this.setState({ cleanupSuccess: null });
          }
        }, 5000);
      } else {
        this.setState({
          cleaning: false,
          error: result.error || 'Cleanup failed',
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        cleaning: false,
        error: err.message || 'Cleanup failed',
      });
    }
  };

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  formatDate(timestamp: number | null): string {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleDateString();
  }

  calculatePercentage(bytes: number, maxBytes: number = 10 * 1024 * 1024 * 1024): number {
    // Default max: 10 GB (reasonable for local storage)
    return Math.round((bytes / maxBytes) * 100);
  }

  renderStorageBar(label: string, sizeBytes: number, meta: React.ReactNode): React.ReactNode {
    const percentage = this.calculatePercentage(sizeBytes);
    const isWarning = percentage > 75;

    return React.createElement(
      'div',
      { style: storageGroupStyle },
      React.createElement(
        'div',
        { style: storageHeaderStyle },
        React.createElement('div', { style: storageLabelStyle }, label),
        React.createElement('div', { style: storageSizeStyle }, this.formatBytes(sizeBytes)),
      ),
      React.createElement(
        'div',
        { style: progressBarContainerStyle },
        React.createElement('div', { style: progressBarFillStyle(percentage, isWarning) }),
      ),
      meta,
    );
  }

  renderGraphDb(): React.ReactNode {
    const { health } = this.state;
    if (!health) return null;

    const meta = React.createElement(
      'div',
      { style: storageMetaStyle },
      React.createElement('span', null, `${health.graphDb.eventCount.toLocaleString()} events`),
      health.graphDb.oldestEvent && React.createElement('span', null, '•'),
      health.graphDb.oldestEvent && React.createElement(
        'span',
        null,
        `${this.formatDate(health.graphDb.oldestEvent)} - ${this.formatDate(health.graphDb.newestEvent)}`,
      ),
    );

    return this.renderStorageBar('Graph Database', health.graphDb.sizeBytes, meta);
  }

  renderVectorDb(): React.ReactNode {
    const { health } = this.state;
    if (!health) return null;

    const meta = React.createElement(
      'div',
      { style: storageMetaStyle },
      React.createElement('span', null, `${health.vectorDb.tableCount} table${health.vectorDb.tableCount === 1 ? '' : 's'}`),
    );

    return this.renderStorageBar('Vector Database', health.vectorDb.sizeBytes, meta);
  }

  renderActions(): React.ReactNode {
    const { cleaning, cleanupSuccess } = this.state;

    return React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { style: actionsStyle },
        React.createElement(
          'button',
          {
            style: buttonStyle(cleaning),
            onClick: this.handleCleanup,
            disabled: cleaning,
          },
          cleaning ? 'Cleaning...' : 'Cleanup Old Events (30+ days)',
        ),
      ),
      cleanupSuccess && React.createElement(
        'div',
        { style: successMessageStyle },
        `✓ ${cleanupSuccess}`,
      ),
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement(
      'div',
      { style: emptyStateStyle },
      'Loading storage health...',
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
    const { loading, error, health } = this.state;

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Storage Health'),
      loading
        ? this.renderLoading()
        : error
        ? this.renderError()
        : health
        ? React.createElement(
            'div',
            null,
            this.renderGraphDb(),
            this.renderVectorDb(),
            this.renderActions(),
          )
        : this.renderLoading(),
    );
  }
}
