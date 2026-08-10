import * as React from 'react';
import { agentStore, AgentState, AgentStatus } from './AgentStore';
import { AgentCard } from './AgentCard';
import { totalPending, agentsWithPending } from './pending';

interface AgentsHubProps {
  onSelectAgent: (id: string) => void;
  onNavigateToInbox?: () => void;
}

interface AgentsHubState extends Pick<AgentState, 'statuses' | 'activityEvents' | 'pendingBySource' | 'pendingLoaded'> {}

export class AgentsHub extends React.Component<AgentsHubProps, AgentsHubState> {
  state: AgentsHubState = {
    statuses: agentStore.getState().statuses,
    activityEvents: agentStore.getState().activityEvents,
    pendingBySource: agentStore.getState().pendingBySource,
    pendingLoaded: agentStore.getState().pendingLoaded,
  };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({
      statuses: agentStore.getState().statuses,
      activityEvents: agentStore.getState().activityEvents,
      pendingBySource: agentStore.getState().pendingBySource,
      pendingLoaded: agentStore.getState().pendingLoaded,
    });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
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
    const { pendingLoaded } = this.state;
    const pending = this.getTotalPending();
    const agentCount = this.getAgentsWithPending();

    // Before pendingLoaded, render a neutral "Checking…" state, never the all-clear.
    // pendingBySource is {} before the first GET_INBOX resolves, so painting
    // "Nothing needs you / Everything is running autonomously" on every load is a regression
    // from the old counters (which read persisted data and had a value at first paint).
    if (!pendingLoaded) {
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
            'Loading inbox status',
          ),
        ),
      );
    }

    const isClean = pending === 0;

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
      }, isClean ? '✓' : '!'),

      // Text
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
          isClean ? 'Nothing needs you right now' : `${pending} action${pending !== 1 ? 's' : ''} need${pending === 1 ? 's' : ''} your review`,
        ),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
          isClean
            ? 'Everything is running autonomously'
            : `Across ${agentCount} agent${agentCount !== 1 ? 's' : ''} • everything else is running autonomously`,
        ),
      ),

      // Review now button (only when pending)
      !isClean && React.createElement('button', {
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
