import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';
import { AgentWorkspaceSettings } from './AgentWorkspaceSettings';
import { FleetActivityLedger } from './FleetActivityLedger';
import { rendererGql } from '../../utils/rendererGql';

type WorkspaceTab = 'overview' | 'approvals' | 'activity' | 'settings';

interface WorkspaceProps {
  agentId: string;
  onBack: () => void;
  electron: any;
  onReviewEvent: (eventId: string) => void;
}

interface WorkspaceState {
  activeTab: WorkspaceTab;
  status: AgentStatus | null;
  running: boolean;
  showRunBanner: boolean;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel': '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier': '#3ecf8e',
  'dependency-auditor': '#f5b544',
  'cost-watch': '#e07acc',
};

const KPIS: Record<string, Array<{ label: string; valKey: keyof AgentStatus; color?: string }>> = {
  'security-sentinel': [
    { label: 'Sites monitored', valKey: 'name', color: 'var(--ag-text-primary)' }, // placeholder
  ],
};

export class AgentWorkspace extends React.Component<WorkspaceProps, WorkspaceState> {
  state: WorkspaceState = {
    activeTab: 'overview',
    status: null,
    running: false,
    showRunBanner: false,
  };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => {
      const statuses = agentStore.getState().statuses;
      const found = statuses.find(s => s.name.toLowerCase().replace(/\s+/g, '-') === this.props.agentId) || null;
      this.setState({ status: found });
    };
    agentStore.subscribe(update);
    this.unsub = update;
    update();
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private async runNow() {
    const { agentId } = this.props;
    this.setState({ running: true });
    try {
      await rendererGql(
        `mutation AgentRun($name: String!) { agentRun(name: $name) { agentName status error } }`,
        { name: agentId },
      );
      this.setState({ showRunBanner: true });
      setTimeout(() => this.setState({ showRunBanner: false }), 4000);
    } catch (err) {
      console.warn('[AgentWorkspace] Run now failed:', err);
    } finally {
      this.setState({ running: false });
    }
  }

  private renderHeader() {
    const { status, running, showRunBanner } = this.state;
    const { agentId, onBack } = this.props;
    const accent = ACCENTS[agentId] || '#9aa1ac';
    const derivedStatus = agentStore.getAgentDerivedStatus(agentId);
    const settings = agentStore.getOrInitSettings(agentId);
    const pillLabel = derivedStatus === 'action' ? 'Needs review' : derivedStatus === 'disabled' ? 'Disabled' : 'Healthy';
    const pillClass = derivedStatus === 'action' ? 'ag-pill--review' : derivedStatus === 'disabled' ? 'ag-pill--disabled' : 'ag-pill--healthy';

    return React.createElement('div', null,
      // Back link
      React.createElement('button', {
        onClick: onBack,
        style: {
          background: 'none', border: 'none', color: 'var(--ag-text-secondary)',
          fontSize: 13, cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6,
        },
      }, '‹ All agents'),

      // Agent header
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 } },
        React.createElement('div', {
          style: {
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: accent + '22', color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 21, fontWeight: 700,
          },
        }, agentId[0]?.toUpperCase() || 'A'),

        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 } },
            React.createElement('span', { style: { fontSize: 21, fontWeight: 600, color: 'var(--ag-text-primary)' } },
              status?.name || agentId,
            ),
            React.createElement('span', { className: `ag-pill ${pillClass}` }, pillLabel),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 } },
            '🛡️',
            React.createElement('span', null, settings.enabled ? 'Investigates on its own • you approve anything on production' : 'Agent disabled'),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
            '⏱',
            React.createElement('span', null, 'Runs every 15 minutes • responds to events • ad-hoc'),
          ),
        ),

        // Run now button
        React.createElement('button', {
          onClick: () => this.runNow(),
          disabled: running || !settings.enabled,
          style: {
            background: running || !settings.enabled ? 'var(--ag-bg-elevated)' : 'var(--ag-teal)',
            color: running || !settings.enabled ? 'var(--ag-text-faint)' : 'var(--ag-on-teal)',
            border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 13, fontWeight: 600,
            cursor: running || !settings.enabled ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          },
        }, running ? '⟳ Running…' : '▶ Run now'),
      ),

      // Ad-hoc run complete banner
      showRunBanner && React.createElement('div', {
        style: {
          background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 12,
          fontSize: 13, color: 'var(--ag-green)',
        },
      }, '✓ Ad-hoc run complete — check Approvals and Activity for results.'),
    );
  }

  private renderTabBar() {
    const { activeTab } = this.state;
    const { agentId } = this.props;
    const pendingCount = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;

    const tabs: Array<{ id: WorkspaceTab; label: string; badge?: number }> = [
      { id: 'overview',  label: 'Overview' },
      { id: 'approvals', label: 'Approvals', badge: pendingCount > 0 ? pendingCount : undefined },
      { id: 'activity',  label: 'Activity' },
      { id: 'settings',  label: 'Settings' },
    ];

    return React.createElement('div', {
      style: { display: 'flex', borderBottom: '1px solid var(--ag-border)', marginBottom: 24 },
    },
      ...tabs.map(tab =>
        React.createElement('button', {
          key: tab.id,
          onClick: () => this.setState({ activeTab: tab.id }),
          style: {
            background: 'none', border: 'none', padding: '0 0 12px', marginRight: 28,
            fontSize: 14, fontWeight: activeTab === tab.id ? 500 : 400,
            color: activeTab === tab.id ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)',
            borderBottom: activeTab === tab.id ? '2px solid var(--ag-teal)' : '2px solid transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          },
        },
          tab.label,
          tab.badge && React.createElement('span', {
            className: 'ag-pill ag-pill--review',
            style: { fontSize: 10, padding: '1px 7px' },
          }, tab.badge),
        ),
      ),
    );
  }

  private renderOverviewTab() {
    const { agentId, onReviewEvent } = this.props;

    // KPI grid
    const kpis = [
      { label: 'Sites monitored', val: '343', color: 'var(--ag-text-primary)' },
      { label: 'Clean',           val: '341', color: 'var(--ag-green)' },
      { label: 'Active threats',  val: '2',   color: 'var(--ag-red)' },
      { label: 'Pending approval',val: '1',   color: 'var(--ag-amber)' },
    ];

    return React.createElement('div', null,
      // KPI grid
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, gap: 12, marginBottom: 24 },
      },
        ...kpis.map(kpi =>
          React.createElement('div', {
            key: kpi.label,
            style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, padding: '16px 18px' },
          },
            React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, kpi.label),
            React.createElement('div', { style: { fontSize: 32, fontWeight: 600, color: kpi.color || 'var(--ag-text-primary)' } }, kpi.val),
          ),
        ),
      ),

      // Needs your review
      React.createElement('div', { style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 12 } }, 'Needs your review'),
      React.createElement('div', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } }, 'No pending approvals.'),
    );
  }

  render() {
    const { activeTab } = this.state;
    const { agentId, onReviewEvent } = this.props;

    return React.createElement('div', { style: { padding: '24px 40px' } },
      this.renderHeader(),
      this.renderTabBar(),
      activeTab === 'overview'  && this.renderOverviewTab(),
      activeTab === 'approvals' && React.createElement('div', { style: { color: 'var(--ag-text-secondary)' } }, 'No pending approvals.'),
      activeTab === 'activity'  && React.createElement(FleetActivityLedger, {
        onReviewEvent,
        // Scoped to this agent in future — for now shows all
      }),
      activeTab === 'settings'  && React.createElement(AgentWorkspaceSettings, { agentId }),
    );
  }
}
