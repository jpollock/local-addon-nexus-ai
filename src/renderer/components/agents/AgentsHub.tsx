import * as React from 'react';
import { agentStore, AgentState, AgentStatus } from './AgentStore';
import { AgentCard } from './AgentCard';

interface AgentsHubProps {
  onSelectAgent: (id: string) => void;
}

interface AgentsHubState extends Pick<AgentState, 'statuses' | 'activityEvents'> {}

export class AgentsHub extends React.Component<AgentsHubProps, AgentsHubState> {
  state: AgentsHubState = { statuses: agentStore.getState().statuses, activityEvents: agentStore.getState().activityEvents };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({
      statuses: agentStore.getState().statuses,
      activityEvents: agentStore.getState().activityEvents,
    });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private getTotalPending(): number {
    return this.state.activityEvents.filter(e => e.status === 'review').length;
  }

  private getAgentsWithPending(): number {
    const ids = new Set(this.state.activityEvents.filter(e => e.status === 'review').map(e => e.agentId));
    return ids.size;
  }

  private renderInbox() {
    const pending = this.getTotalPending();
    const agentCount = this.getAgentsWithPending();
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
          isClean ? 'Nothing needs you right now' : `${pending} action${pending !== 1 ? 's' : ''} need your review`,
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
          // Navigate to first agent with pending items
          const firstPendingId = this.state.activityEvents.find(e => e.status === 'review')?.agentId;
          if (firstPendingId) this.props.onSelectAgent(firstPendingId);
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

    return React.createElement('div', { style: { padding: '24px 40px' } },
      // Page header
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 } },
        React.createElement('div', null,
          React.createElement('h1', { style: { fontSize: 20, fontWeight: 600, color: 'var(--ag-text-primary)', margin: '0 0 4px' } }, 'Agents'),
          React.createElement('p', { style: { fontSize: 13, color: 'var(--ag-text-secondary)', margin: 0 } },
            'Autonomous agents working across your fleet • configure how much each can do on its own',
          ),
        ),
        React.createElement('button', {
          style: {
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
            borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 500,
            color: '#c8ccd2', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          },
        }, '+ Add agent'),
      ),

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
              onSelect: () => onSelectAgent(s.name.toLowerCase().replace(/\s+/g, '-')),
            })),
          ),
    );
  }
}
