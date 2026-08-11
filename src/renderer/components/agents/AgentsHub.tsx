import * as React from 'react';
import { agentStore, AgentState, AgentStatus } from './AgentStore';
import { AgentCard } from './AgentCard';
import { totalPending, agentsWithPending } from './pending';
import { IPC_CHANNELS } from '../../../common/constants';

interface AgentsHubProps {
  onSelectAgent: (id: string) => void;
  onNavigateToInbox?: () => void;
  electron: any;
}

interface AgentsHubState extends Pick<AgentState, 'statuses' | 'activityEvents' | 'pendingBySource' | 'pendingLoaded'> {
  healthStatus: 'ok' | 'degraded' | 'failing' | 'unknown' | null;
}

export class AgentsHub extends React.Component<AgentsHubProps, AgentsHubState> {
  state: AgentsHubState = {
    statuses: agentStore.getState().statuses,
    activityEvents: agentStore.getState().activityEvents,
    pendingBySource: agentStore.getState().pendingBySource,
    pendingLoaded: agentStore.getState().pendingLoaded,
    healthStatus: null,
  };
  private unsub!: () => void;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  componentDidMount() {
    this.mounted = true;
    const update = () => this.setState({
      statuses: agentStore.getState().statuses,
      activityEvents: agentStore.getState().activityEvents,
      pendingBySource: agentStore.getState().pendingBySource,
      pendingLoaded: agentStore.getState().pendingLoaded,
    });
    agentStore.subscribe(update);
    this.unsub = update;

    // Fetch system health to power the banner — same source as the Activity pill.
    this.fetchSystemHealth();
    this.healthTimer = setInterval(() => this.fetchSystemHealth(), 30000); // 30s, matching EventStatsCards
  }

  componentWillUnmount() {
    this.mounted = false;
    agentStore.unsubscribe(this.unsub);
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async fetchSystemHealth(): Promise<void> {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.EVENTS_GET_STATS);
      if (!this.mounted) return;
      if (result.success && result.stats?.healthStatus) {
        this.setState({ healthStatus: result.stats.healthStatus });
      }
    } catch {
      // Swallow — health stays null, banner remains neutral.
    }
  }

  private getTotalPending(): number {
    return totalPending(this.state.pendingBySource);
  }

  private getAgentsWithPending(): number {
    return agentsWithPending(this.state.pendingBySource);
  }

  private getAgentId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
  }

  private renderInbox() {
    const { pendingLoaded, healthStatus } = this.state;
    const pending = this.getTotalPending();
    const agentCount = this.getAgentsWithPending();

    // Before pendingLoaded OR healthStatus, render a neutral "Checking…" state, never the all-clear.
    // pendingBySource is {} before the first GET_INBOX resolves, so painting
    // "Nothing needs you / Everything is running autonomously" on every load is a regression
    // from the old counters (which read persisted data and had a value at first paint).
    if (!pendingLoaded || healthStatus === null) {
      return React.createElement('div', {
        style: {
          width: '100%', borderRadius: 12, padding: '16px 22px', marginBottom: 20,
          background: 'rgba(130,130,130,0.06)',
          border: '1px solid rgba(130,130,130,0.25)',
          display: 'flex', alignItems: 'center', gap: 16,
        },
      },
        React.createElement('div', {
          style: {
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: 'rgba(130,130,130,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--ag-text-secondary)',
            fontSize: 16, fontWeight: 700,
          },
        }, '…'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
            'Checking…',
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
            'Loading status',
          ),
        ),
      );
    }

    // Banner state: pending items OR system health is not 'ok'. Match the Activity pill's rollup.
    const hasPending = pending > 0;
    const healthIsGood = healthStatus === 'ok';
    const isClean = !hasPending && healthIsGood;

    // When health is unknown, say so — never paint green.
    const healthUnknown = healthStatus === 'unknown';

    // Title and subtitle logic
    let title: string;
    let subtitle: string;

    if (isClean) {
      title = 'Nothing needs you right now';
      subtitle = 'Everything is running autonomously';
    } else if (hasPending) {
      title = `${pending} action${pending !== 1 ? 's' : ''} need${pending === 1 ? 's' : ''} your review`;
      subtitle = `Across ${agentCount} agent${agentCount !== 1 ? 's' : ''} • everything else is running autonomously`;
    } else if (healthUnknown) {
      // pendingLoaded is true, pending === 0, but health is unknown (e.g. agents never ran).
      // This is the fix for BUILD-REVIEW §2.6: the banner and the pill must agree.
      title = 'Nothing waiting on you';
      const agentStatuses = agentStore.getState().statuses;
      const neverRun = agentStatuses.filter((s: AgentStatus) => s.lastRunStatus === null);
      subtitle = neverRun.length === 1
        ? `${neverRun.length} agent hasn't reported yet`
        : `${neverRun.length} agents haven't reported yet`;
    } else {
      // Health is degraded or failing but no pending items (e.g. stale syncs, failed events).
      title = 'Nothing waiting on you';
      subtitle = healthStatus === 'degraded' ? 'Something needs attention' : 'Something is broken';
    }

    return React.createElement('div', {
      style: {
        width: '100%', borderRadius: 12, padding: '16px 22px', marginBottom: 20,
        background: isClean ? 'rgba(62,207,142,0.06)' : 'rgba(245,181,68,0.06)',
        border: `1px solid ${isClean ? 'rgba(62,207,142,0.35)' : 'rgba(245,181,68,0.35)'}`,
        display: 'flex', alignItems: 'center', gap: 16,
      },
    },
      // Icon tile
      React.createElement('div', {
        style: {
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: isClean ? 'rgba(62,207,142,0.16)' : 'rgba(245,181,68,0.16)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isClean ? 'var(--ag-green)' : 'var(--ag-amber)',
          fontSize: 16, fontWeight: 700,
        },
      }, isClean ? '✓' : healthStatus === 'failing' ? '✕' : '!'),

      // Text
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
          title,
        ),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
          subtitle,
        ),
      ),

      // Review now button (only when pending)
      hasPending && React.createElement('button', {
        onClick: () => {
          // Navigate to Inbox tab if available, otherwise first agent with pending items
          if (this.props.onNavigateToInbox) {
            this.props.onNavigateToInbox();
          } else {
            const firstPendingSource = Object.keys(this.state.pendingBySource).find(k => this.state.pendingBySource[k] > 0);
            if (firstPendingSource) this.props.onSelectAgent(firstPendingSource);
          }
        },
        style: {
          background: 'var(--ag-amber)', color: '#1a1200',
          border: 'none', borderRadius: 8, padding: '8px 16px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        },
      }, 'Review now'),
    );
  }

  render() {
    const { statuses } = this.state;
    const { onSelectAgent } = this.props;

    return React.createElement('div', { style: { padding: '0 0 24px' } },
      // Inbox banner
      this.renderInbox(),

      // Agent grid
      statuses.length === 0
        ? React.createElement('div', {
            style: { textAlign: 'center', padding: '60px 0', color: 'var(--ag-text-muted)' },
          }, 'No agents registered. Add an agent to get started.')
        : React.createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
          },
            ...statuses.map(s => React.createElement(AgentCard, {
              key: s.name,
              status: s,
              onSelect: () => onSelectAgent(this.getAgentId(s.name)),
            })),
          ),
    );
  }
}
