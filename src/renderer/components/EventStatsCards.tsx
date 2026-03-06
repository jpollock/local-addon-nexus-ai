/**
 * Event Stats Cards Component (Sprint 1)
 *
 * Displays event tracking statistics in a 3-card layout:
 * - Total Events
 * - Today's Events (with comparison to yesterday)
 * - Health Status
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { EventStats } from '../../common/types';

interface EventStatsCardsProps {
  electron: any;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface EventStatsCardsState {
  stats: EventStats | null;
  loading: boolean;
  error: string | null;
}

// -- Styles --

const cardContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
  marginBottom: '24px',
};

const cardStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '12px',
};

const bigNumberStyle: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 700,
  lineHeight: 1,
  marginBottom: '8px',
  color: 'var(--nxai-card-text)',
};

const subStatStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  lineHeight: 1.6,
};

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: '6px',
  verticalAlign: 'middle',
});

const healthBadgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 12px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 600,
  backgroundColor: `${color}15`, // 15% opacity
  color,
  marginTop: '8px',
});

/**
 * EventStatsCards Component
 */
export class EventStatsCards extends React.Component<EventStatsCardsProps, EventStatsCardsState> {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  static defaultProps = {
    autoRefresh: true,
    refreshInterval: 30000, // 30 seconds
  };

  state: EventStatsCardsState = {
    stats: null,
    loading: true,
    error: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchStats();

    if (this.props.autoRefresh) {
      this.refreshTimer = setInterval(
        () => this.fetchStats(),
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

  fetchStats = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.EVENTS_GET_STATS,
      );

      if (!this.mounted) return;

      if (result.success) {
        this.setState({
          stats: result.stats,
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load stats',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        error: err.message || 'Failed to load stats',
        loading: false,
      });
    }
  };

  getHealthColor(): string {
    const { stats } = this.state;
    if (!stats) return UI_COLORS.STATUS_HALTED;

    switch (stats.healthStatus) {
      case 'good':
        return UI_COLORS.STATUS_RUNNING;
      case 'warning':
        return UI_COLORS.STATUS_WARNING;
      case 'error':
        return UI_COLORS.STATUS_ERROR;
      default:
        return UI_COLORS.STATUS_HALTED;
    }
  }

  getHealthLabel(): string {
    const { stats } = this.state;
    if (!stats) return 'Unknown';

    switch (stats.healthStatus) {
      case 'good':
        return 'All Systems Healthy';
      case 'warning':
        return 'Pending Events';
      case 'error':
        return 'Failed Events Detected';
      default:
        return 'Unknown';
    }
  }

  getHealthIcon(): string {
    const { stats } = this.state;
    if (!stats) return '○';

    switch (stats.healthStatus) {
      case 'good':
        return '✓';
      case 'warning':
        return '⚠';
      case 'error':
        return '✗';
      default:
        return '○';
    }
  }

  renderTotalEventsCard(): React.ReactNode {
    const { stats } = this.state;
    const total = stats?.total ?? 0;

    return React.createElement(
      'div',
      { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Total Events'),
      React.createElement('div', { style: bigNumberStyle }, total.toLocaleString()),
      React.createElement(
        'div',
        { style: subStatStyle },
        'All tracked WordPress events',
      ),
    );
  }

  renderTodayCard(): React.ReactNode {
    const { stats } = this.state;
    const today = stats?.today ?? 0;
    const yesterday = stats?.yesterday ?? 0;

    // Calculate comparison
    let comparison = '';
    let comparisonColor = 'var(--nxai-card-sub)';

    if (yesterday === 0 && today > 0) {
      comparison = `+${today} from yesterday`;
      comparisonColor = UI_COLORS.STATUS_RUNNING;
    } else if (yesterday > 0) {
      const diff = today - yesterday;
      const pct = Math.round((diff / yesterday) * 100);

      if (diff > 0) {
        comparison = `+${diff} (+${pct}%) from yesterday`;
        comparisonColor = UI_COLORS.STATUS_RUNNING;
      } else if (diff < 0) {
        comparison = `${diff} (${pct}%) from yesterday`;
        comparisonColor = UI_COLORS.STATUS_HALTED;
      } else {
        comparison = 'Same as yesterday';
        comparisonColor = 'var(--nxai-card-sub)';
      }
    } else {
      comparison = 'No events yesterday';
    }

    return React.createElement(
      'div',
      { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Today'),
      React.createElement('div', { style: bigNumberStyle }, today.toLocaleString()),
      React.createElement(
        'div',
        { style: { ...subStatStyle, color: comparisonColor } },
        comparison,
      ),
    );
  }

  renderHealthCard(): React.ReactNode {
    const { stats } = this.state;
    const healthColor = this.getHealthColor();
    const healthLabel = this.getHealthLabel();
    const healthIcon = this.getHealthIcon();

    const pending = stats?.pending ?? 0;
    const failed = stats?.failed ?? 0;

    return React.createElement(
      'div',
      { style: cardStyle },
      React.createElement('div', { style: cardTitleStyle }, 'Health Status'),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '12px',
          },
        },
        React.createElement('span', { style: dotStyle(healthColor) }),
        React.createElement(
          'span',
          {
            style: {
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
            },
          },
          healthLabel,
        ),
      ),
      React.createElement(
        'div',
        { style: healthBadgeStyle(healthColor) },
        React.createElement('span', { style: { fontSize: '16px' } }, healthIcon),
        React.createElement(
          'span',
          null,
          failed > 0
            ? `${failed} failed event${failed === 1 ? '' : 's'}`
            : pending > 0
            ? `${pending} pending event${pending === 1 ? '' : 's'}`
            : 'No issues detected',
        ),
      ),
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement(
      'div',
      { style: cardContainerStyle },
      Array(3)
        .fill(null)
        .map((_, i) =>
          React.createElement(
            'div',
            { key: i, style: { ...cardStyle, textAlign: 'center' as const, padding: '40px 20px' } },
            React.createElement(
              'div',
              { style: { color: 'var(--nxai-card-sub)', fontSize: '13px' } },
              'Loading...',
            ),
          ),
        ),
    );
  }

  renderError(): React.ReactNode {
    const { error } = this.state;
    return React.createElement(
      'div',
      {
        style: {
          ...cardStyle,
          padding: '20px',
          border: `1px solid ${UI_COLORS.STATUS_ERROR}`,
          backgroundColor: `${UI_COLORS.STATUS_ERROR}10`,
        },
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          },
        },
        React.createElement('span', { style: dotStyle(UI_COLORS.STATUS_ERROR) }),
        React.createElement(
          'span',
          {
            style: {
              fontSize: '14px',
              fontWeight: 600,
              color: UI_COLORS.STATUS_ERROR,
            },
          },
          'Error Loading Stats',
        ),
      ),
      React.createElement(
        'div',
        {
          style: {
            fontSize: '13px',
            color: 'var(--nxai-card-text)',
          },
        },
        error,
      ),
    );
  }

  render(): React.ReactNode {
    const { loading, error, stats } = this.state;

    if (loading) {
      return this.renderLoading();
    }

    if (error || !stats) {
      return this.renderError();
    }

    return React.createElement(
      'div',
      { style: cardContainerStyle },
      this.renderTotalEventsCard(),
      this.renderTodayCard(),
      this.renderHealthCard(),
    );
  }
}
