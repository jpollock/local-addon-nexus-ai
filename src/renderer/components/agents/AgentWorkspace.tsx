import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';
import { AgentWorkspaceSettings } from './AgentWorkspaceSettings';
import { FleetActivityLedger } from './FleetActivityLedger';
import { AgentRunModal } from './AgentRunModal';
import { IPC_CHANNELS } from '../../../common/constants';

type WorkspaceTab = 'overview' | 'approvals' | 'activity' | 'settings';

interface KpiState {
  label: string;
  value: string | null;
  color: string;
  loading: boolean;
}

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
  showRunModal: boolean;
  kpis: KpiState[];
  kpisLoaded: boolean;
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
    showRunModal: false,
    kpis: [],
    kpisLoaded: false,
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
    this.loadKpis();
  }

  private async loadKpis() {
    const { agentId } = this.props;
    const status = agentStore.getState().statuses.find(s =>
      s.name.toLowerCase().replace(/\s+/g, '-') === agentId
    );
    const kpiDefs = (status as any)?.kpis ?? [];
    if (kpiDefs.length === 0) return;

    this.setState({ kpisLoaded: false });
    const colorMap: Record<string, string> = {
      red: 'var(--ag-red)',
      green: 'var(--ag-green)',
      amber: 'var(--ag-amber)',
      default: 'var(--ag-text-primary)',
    };
    const kpis: KpiState[] = await Promise.all(kpiDefs.map(async (kpi: any) => {
      try {
        const res = await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.FLEET_SQL_QUERY, { query: kpi.query }
        );
        const value = res?.rows?.[0] ? String(Object.values(res.rows[0])[0]) : '—';
        return { label: kpi.label, value, color: colorMap[kpi.color ?? 'default'] ?? colorMap.default, loading: false };
      } catch {
        return { label: kpi.label, value: '—', color: 'var(--ag-text-muted)', loading: false };
      }
    }));
    this.setState({ kpis, kpisLoaded: true });
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private renderHeader() {
    const { status, running } = this.state;
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
              (status?.name || agentId).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
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
          onClick: () => this.setState({ showRunModal: true }),
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
    const { agentId } = this.props;
    const { kpis, kpisLoaded } = this.state;
    const pendingCount = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;

    return React.createElement('div', null,
      // KPI grid — rendered only when loaded and non-empty
      kpisLoaded && kpis.length > 0 && React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`,
          gap: 12,
          marginBottom: 24,
        },
      },
        ...kpis.map(kpi => React.createElement('div', {
          key: kpi.label,
          style: {
            background: 'var(--ag-bg-card)',
            border: '1px solid var(--ag-border)',
            borderRadius: 12,
            padding: '16px 18px',
          },
        },
          React.createElement('div', {
            style: {
              fontSize: 11.5,
              color: 'var(--ag-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 6,
            },
          }, kpi.label),
          React.createElement('div', {
            style: { fontSize: 32, fontWeight: 600, color: kpi.color },
          }, kpi.value ?? '—'),
        )),
      ),

      // Needs review section
      React.createElement('div', {
        style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 12 },
      }, 'Needs your review'),
      pendingCount > 0
        ? React.createElement('button', {
            onClick: () => this.setState({ activeTab: 'approvals' }),
            style: { background: 'none', border: 'none', color: 'var(--ag-amber)', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
          }, `${pendingCount} item${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} review — go to Approvals`)
        : React.createElement('div', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } }, 'No pending approvals.'),
    );
  }

  private renderApprovalsTab() {
    const { agentId, onReviewEvent } = this.props;
    const pending = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    );
    if (pending.length === 0) {
      return React.createElement('div', { style: { color: 'var(--ag-text-secondary)', fontSize: 13, padding: '24px 0' } }, 'No pending approvals.');
    }
    const dismiss = (id: string) => {
      agentStore.setState({
        activityEvents: agentStore.getState().activityEvents.map(e =>
          e.id === id ? { ...e, status: 'dismissed' as const } : e,
        ),
      });
    };

    return React.createElement('div', null,
      ...pending.map(e =>
        React.createElement('div', {
          key: e.id,
          style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, padding: '16px 20px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 },
        },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
              React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)' } }, e.siteName ?? e.text),
              React.createElement('span', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } }, e.time),
            ),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } }, e.sub),
          ),
          e.ref && React.createElement('button', {
            onClick: () => onReviewEvent(e.id),
            style: { background: 'var(--ag-teal)', color: 'var(--ag-on-teal)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
          }, 'Review'),
          React.createElement('button', {
            onClick: () => dismiss(e.id),
            style: { background: 'none', border: '1px solid var(--ag-border)', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: 'var(--ag-text-muted)', cursor: 'pointer' },
          }, 'Dismiss'),
        ),
      ),
    );
  }

  render() {
    const { activeTab } = this.state;
    const { agentId, onReviewEvent } = this.props;
    const { showRunModal } = this.state;
    const settings = agentStore.getOrInitSettings(agentId);

    return React.createElement('div', { style: { padding: '24px 40px' } },
      this.renderHeader(),
      this.renderTabBar(),
      activeTab === 'overview'  && this.renderOverviewTab(),
      activeTab === 'approvals' && this.renderApprovalsTab(),
      activeTab === 'activity'  && React.createElement(FleetActivityLedger, {
        onReviewEvent,
        // Scoped to this agent in future — for now shows all
      }),
      activeTab === 'settings'  && React.createElement(AgentWorkspaceSettings, { agentId }),

      // Run now site-selection modal
      showRunModal && settings.enabled && React.createElement(AgentRunModal, {
        agentName: this.state.status?.name || agentId,
        agentId,
        electron: this.props.electron,
        onCancel: () => this.setState({ showRunModal: false }),
        onRun: (_siteNames: string[]) => {
          // AgentRunModal.handleRun() already invoked AGENT_RUN_NOW via IPC.
          // Just close the modal — RunToast/RunPill/RunDrawer take over from here.
          this.setState({ showRunModal: false });
        },
      }),
    );
  }
}
