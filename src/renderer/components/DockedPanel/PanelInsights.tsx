import React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import { agentStore } from '../agents/AgentStore';

export interface PanelInsightsProps {
  electron: any;
  onOpenAgents: () => void;
}

interface FleetCount {
  count: number;
  scope: string;
}

interface FleetCounts {
  installs: FleetCount;
  local: FleetCount;
  wpe: FleetCount;
  external: FleetCount;
}

interface BackgroundJobIntervals {
  halted?: number;
  wpe?: number;
  external?: number;
  externalContentIndex?: number;
}

interface InsightsState {
  pendingCount: number | null;
  counts: FleetCounts | null;
  intervals: BackgroundJobIntervals | null;
  error: string | null;
}

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px 16px',
    background: 'var(--nxai-card-bg)',
  },
  card: {
    borderRadius: 10,
    border: '1px solid var(--nxai-card-border)',
    background: 'var(--nxai-card-bg)',
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '13px 15px',
    borderBottom: '1px solid var(--nxai-card-border)',
    background: 'var(--nxai-table-hover)',
  },
  cardBody: {
    padding: 15,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--nxai-card-text)',
    margin: 0,
  },
  clickableCard: {
    cursor: 'pointer',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  statLabel: {
    fontSize: 13,
    color: 'var(--nxai-card-sub)',
  },
  statValue: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--nxai-card-text)',
  },
  loadingText: {
    fontSize: 13,
    color: 'var(--nxai-card-sub)',
    fontStyle: 'italic' as const,
  },
  errorText: {
    fontSize: 13,
    color: UI_COLORS.STATUS_ERROR,
  },
};

export class PanelInsights extends React.Component<PanelInsightsProps, InsightsState> {
  private agentStoreUnsub: (() => void) | null = null;

  constructor(props: PanelInsightsProps) {
    super(props);
    this.state = {
      pendingCount: null,
      counts: null,
      intervals: null,
      error: null,
    };
  }

  componentDidMount() {
    this.fetchData();
    this.subscribeToAgentStore();
  }

  componentWillUnmount() {
    if (this.agentStoreUnsub) {
      this.agentStoreUnsub();
      this.agentStoreUnsub = null;
    }
  }

  private subscribeToAgentStore() {
    const update = () => {
      const events = agentStore.getState().activityEvents;
      const pendingCount = events.filter((e) => e.status === 'review').length;
      this.setState({ pendingCount });
    };
    update(); // Initial read
    agentStore.subscribe(update);
    this.agentStoreUnsub = () => agentStore.unsubscribe(update);
  }

  private async fetchData() {
    try {
      const [dashboardStats, settings] = await Promise.all([
        this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS),
        this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
      ]);

      this.setState({
        counts: dashboardStats?.counts ?? null,
        intervals: {
          halted: settings?.haltedSiteRefreshIntervalHours,
          wpe: settings?.wpeRefreshIntervalHours,
          external: settings?.externalRefreshIntervalHours,
          externalContentIndex: settings?.externalContentIndexIntervalHours,
        },
        error: null,
      });
    } catch (err) {
      this.setState({ error: (err as Error).message });
    }
  }

  private renderWaitingItems() {
    const { pendingCount } = this.state;

    const headerStyle = {
      ...styles.cardHeader,
      ...(pendingCount !== null && pendingCount > 0 ? { background: 'rgba(245,181,68,0.08)' } : {}),
    };

    const bodyContent =
      pendingCount === null
        ? React.createElement('div', { style: styles.loadingText }, 'Loading...')
        : pendingCount === 0
        ? React.createElement('div', { style: styles.statLabel }, 'Nothing needs you right now')
        : React.createElement(
            'div',
            null,
            React.createElement(
              'div',
              { style: { fontSize: 22, fontWeight: 700, color: UI_COLORS.WPE_BRAND, marginBottom: 6 } },
              pendingCount,
            ),
            React.createElement(
              'div',
              { style: { fontSize: 13, color: 'var(--nxai-card-sub)' } },
              `${pendingCount} thing${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} you`,
            ),
          );

    const cardStyle =
      pendingCount !== null && pendingCount > 0
        ? { ...styles.card, ...styles.clickableCard }
        : styles.card;

    const onClick = pendingCount !== null && pendingCount > 0 ? this.props.onOpenAgents : undefined;

    return React.createElement(
      'div',
      { style: cardStyle, onClick, 'data-test': 'waiting-items' },
      React.createElement(
        'div',
        { style: headerStyle },
        React.createElement('h3', { style: styles.cardTitle }, 'Waiting'),
      ),
      React.createElement('div', { style: styles.cardBody }, bodyContent),
    );
  }

  private renderFleetStats() {
    const { counts, error } = this.state;

    const bodyContent = error
      ? React.createElement('div', { style: styles.errorText }, `Failed to load: ${error}`)
      : counts === null
      ? React.createElement('div', { style: styles.loadingText }, 'Loading...')
      : React.createElement(
          'div',
          null,
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, counts.installs.scope),
            React.createElement('div', { style: styles.statValue }, counts.installs.count),
          ),
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, counts.local.scope),
            React.createElement('div', { style: styles.statValue }, counts.local.count),
          ),
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, counts.wpe.scope),
            React.createElement('div', { style: styles.statValue }, counts.wpe.count),
          ),
          React.createElement(
            'div',
            { style: { ...styles.statRow, marginBottom: 0 } },
            React.createElement('div', { style: styles.statLabel }, counts.external.scope),
            React.createElement('div', { style: styles.statValue }, counts.external.count),
          ),
        );

    return React.createElement(
      'div',
      { style: styles.card },
      React.createElement(
        'div',
        { style: styles.cardHeader },
        React.createElement('h3', { style: styles.cardTitle }, 'Fleet'),
      ),
      React.createElement('div', { style: styles.cardBody }, bodyContent),
    );
  }

  private renderBackgroundJobs() {
    const { intervals, error } = this.state;

    const formatInterval = (hours: number | undefined) => {
      if (hours === undefined || hours === 0) return 'manual';
      if (hours === 1) return '1 hour';
      if (hours < 24) return `${hours} hours`;
      const days = hours / 24;
      return days === 1 ? '1 day' : `${days} days`;
    };

    const bodyContent = error
      ? React.createElement('div', { style: styles.errorText }, `Failed to load: ${error}`)
      : intervals === null
      ? React.createElement('div', { style: styles.loadingText }, 'Loading...')
      : React.createElement(
          'div',
          null,
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, 'Halted site refresh'),
            React.createElement('div', { style: styles.statValue }, formatInterval(intervals.halted)),
          ),
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, 'WP Engine refresh'),
            React.createElement('div', { style: styles.statValue }, formatInterval(intervals.wpe)),
          ),
          React.createElement(
            'div',
            { style: styles.statRow },
            React.createElement('div', { style: styles.statLabel }, 'External host refresh'),
            React.createElement('div', { style: styles.statValue }, formatInterval(intervals.external)),
          ),
          React.createElement(
            'div',
            { style: { ...styles.statRow, marginBottom: 0 } },
            React.createElement('div', { style: styles.statLabel }, 'External host indexing'),
            React.createElement('div', { style: styles.statValue }, formatInterval(intervals.externalContentIndex)),
          ),
        );

    return React.createElement(
      'div',
      { style: styles.card },
      React.createElement(
        'div',
        { style: styles.cardHeader },
        React.createElement('h3', { style: styles.cardTitle }, 'Running on its own'),
      ),
      React.createElement('div', { style: styles.cardBody }, bodyContent),
    );
  }

  render() {
    return React.createElement(
      'div',
      { style: styles.container },
      this.renderWaitingItems(),
      this.renderFleetStats(),
      this.renderBackgroundJobs(),
    );
  }
}
