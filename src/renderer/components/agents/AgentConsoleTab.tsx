import * as React from 'react';
import { agentStore } from './AgentStore';
import { AgentsHub } from './AgentsHub';
import { FleetActivityLedger } from './FleetActivityLedger';
import { AgentWorkspace } from './AgentWorkspace';
import { GenericApprovalDrawer, GenericApproval } from './GenericApprovalDrawer';
import { rendererGql } from '../../utils/rendererGql';

interface AgentConsoleTabProps {
  electron: any;
}

interface AgentConsoleTabState {
  homeTab: 'agents' | 'activity';
  selectedAgentId: string | null;
  activeApproval: GenericApproval | null;
}

export class AgentConsoleTab extends React.Component<AgentConsoleTabProps, AgentConsoleTabState> {
  state: AgentConsoleTabState = {
    homeTab: 'agents',
    selectedAgentId: null,
    activeApproval: null,
  };
  private unsub!: () => void;

  componentDidMount() {
    // Load agent statuses via IPC
    this.refreshAgents();
    // Subscribe to store for reactive updates
    const update = () => this.forceUpdate();
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private async refreshAgents() {
    try {
      const result = await rendererGql<{ agentStatus: any[] }>(
        `{ agentStatus { name version description cronExpression lastRunAt lastRunStatus lastRunDurationMs lastRunError } }`,
      );
      if (result?.agentStatus) {
        agentStore.setState({ statuses: result.agentStatus });
      }
    } catch (err) {
      console.warn('[AgentConsoleTab] Failed to load agent statuses:', err);
    }
  }

  private renderModeSwitch() {
    const { homeTab } = this.state;
    const pendingCount = agentStore.getState().activityEvents.filter(e => e.status === 'review').length;

    const segStyle = (active: boolean): React.CSSProperties => ({
      padding: '5px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none',
      background: active ? 'var(--ag-teal)' : 'transparent',
      color: active ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
      display: 'flex', alignItems: 'center', gap: 6,
    });

    return React.createElement('div', {
      style: { display: 'flex', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)', borderRadius: 10, padding: 4, marginBottom: 0 },
    },
      React.createElement('button', { onClick: () => this.setState({ homeTab: 'agents' }), style: segStyle(homeTab === 'agents') }, 'Agents'),
      React.createElement('button', { onClick: () => this.setState({ homeTab: 'activity' }), style: segStyle(homeTab === 'activity') },
        'Fleet activity',
        pendingCount > 0 && React.createElement('span', {
          style: { background: 'rgba(245,181,68,0.16)', color: 'var(--ag-amber)', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 600 },
        }, pendingCount),
      ),
    );
  }

  render() {
    const { homeTab, selectedAgentId, activeApproval } = this.state;
    const { electron } = this.props;

    // Agent workspace view
    if (selectedAgentId) {
      return React.createElement('div', null,
        React.createElement(AgentWorkspace, {
          agentId: selectedAgentId,
          electron,
          onBack: () => this.setState({ selectedAgentId: null }),
          onReviewEvent: (eventId: string) => {
            // For now log — Plan B wires Sentinel review
            console.log('Review event:', eventId);
          },
        }),
        activeApproval && React.createElement(GenericApprovalDrawer, {
          approval: activeApproval,
          onDismiss: () => this.setState({ activeApproval: null }),
          onApprove: () => {
            // Mark resolved in store
            this.setState({ activeApproval: null });
          },
        }),
      );
    }

    // Hub / ledger home view
    return React.createElement('div', null,
      // Mode switch (rendered inside the content area, not the tab bar)
      React.createElement('div', { style: { padding: '16px 40px 0' } },
        this.renderModeSwitch(),
      ),
      homeTab === 'agents'
        ? React.createElement(AgentsHub, { onSelectAgent: (id: string) => this.setState({ selectedAgentId: id }) })
        : React.createElement(FleetActivityLedger, {
            onReviewEvent: (eventId: string) => console.log('Review:', eventId),
          }),
    );
  }
}
