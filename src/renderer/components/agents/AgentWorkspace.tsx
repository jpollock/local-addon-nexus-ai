import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';
import { AgentWorkspaceSettings } from './AgentWorkspaceSettings';
import { AgentRunList } from './AgentRunList';
import { AgentRunModal } from './AgentRunModal';
import { IPC_CHANNELS } from '../../../common/constants';
import { rendererGql } from '../../utils/rendererGql';

type WorkspaceTab = 'settings' | 'approvals' | 'activity' | 'tools';

interface AgentToolEntry {
  toolName: string;
  description: string;
  executionMode: string;
  permissionTier: number;
  inputSchema: string;
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
  tools: AgentToolEntry[] | null;   // null = not yet fetched
  toolsLoading: boolean;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel': '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier': '#3ecf8e',
  'dependency-auditor': '#f5b544',
  'cost-watch': '#e07acc',
};

export class AgentWorkspace extends React.Component<WorkspaceProps, WorkspaceState> {
  state: WorkspaceState = {
    activeTab: 'settings',
    status: null,
    running: false,
    showRunModal: false,
    tools: null,
    toolsLoading: false,
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

  private async loadTools() {
    if (this.state.tools !== null || this.state.toolsLoading) return;
    this.setState({ toolsLoading: true });
    try {
      const result = await rendererGql<{ nexusListAgentTools: Array<{ agentName: string; tools: AgentToolEntry[] }> }>(
        `{ nexusListAgentTools { agentName tools { toolName description executionMode permissionTier inputSchema } } }`
      );
      const group = result.nexusListAgentTools.find(g => g.agentName === this.props.agentId);
      this.setState({ tools: group?.tools ?? [], toolsLoading: false });
    } catch {
      this.setState({ tools: [], toolsLoading: false });
    }
  }

  private renderToolsTab() {
    const { agentId } = this.props;
    const { tools, toolsLoading } = this.state;

    if (toolsLoading) {
      return React.createElement('div', { style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const } }, 'Loading tools…');
    }

    if (!tools || tools.length === 0) {
      return React.createElement('div', { style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const } },
        'This agent has no contributed MCP/CLI tools.'
      );
    }

    const tierLabel = (tier: number) => tier >= 3 ? 'T3 · Destructive' : tier === 2 ? 'T2 · Modifying' : 'T1 · Read-only';
    const tierColor = (tier: number) => tier >= 3 ? '#f2666e' : tier === 2 ? '#f0b52e' : '#4ade9b';

    return React.createElement('div', null,
      React.createElement('div', { style: { color: 'var(--ag-text-muted)', fontSize: 13, marginBottom: 18 } },
        `${tools.length} tool${tools.length !== 1 ? 's' : ''} contributed by this agent — accessible via MCP and the nexus CLI.`
      ),
      ...tools.map(tool => {
        const mcpName = `agent__${agentId}__${tool.toolName}`;
        return React.createElement('div', {
          key: tool.toolName,
          style: {
            background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
            borderRadius: 12, padding: '16px 20px', marginBottom: 10,
          },
        },
          // Header row: tool name + tier badge + mode badge
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' as const } },
            React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: 'var(--ag-text-primary)' } },
              tool.toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            ),
            React.createElement('span', {
              style: {
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                background: `${tierColor(tool.permissionTier)}22`, color: tierColor(tool.permissionTier),
              },
            }, tierLabel(tool.permissionTier)),
            React.createElement('span', {
              style: {
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                background: 'var(--ag-bg-inset)', color: 'var(--ag-text-muted)',
              },
            }, tool.executionMode),
          ),
          // Description
          React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-secondary)', marginBottom: 10 } }, tool.description),
          // MCP name
          React.createElement('div', {
            style: {
              fontFamily: 'monospace', fontSize: 12, color: 'var(--ag-teal)',
              background: 'var(--ag-bg-inset)', padding: '6px 10px', borderRadius: 6,
              userSelect: 'all' as const,
            },
          }, mcpName),
        );
      }),
    );
  }

  private renderHeader() {
    const { agentId, onBack } = this.props;
    const { status, running } = this.state;
    const settings = agentStore.getOrInitSettings(agentId);
    const autonomyById = agentStore.getState().autonomyById;
    const autonomy = autonomyById[agentId] ?? 'suggest';
    const pendingCount = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;
    const isDisabled = !settings.enabled;

    // Derived trigger summary from actual config
    const triggerParts: string[] = [];
    if (settings.scheduleEnabled && settings.cadence) {
      const CADENCE_LABELS: Record<string, string> = {
        '*/15 * * * *': 'Runs every 15 minutes',
        '0 * * * *': 'Runs hourly',
        '0 */6 * * *': 'Runs every 6 hours',
        '0 0 * * *': 'Runs daily',
        '0 0 * * 0': 'Runs weekly',
      };
      triggerParts.push(CADENCE_LABELS[settings.cadence] ?? 'Runs on schedule');
    }
    if (settings.eventsEnabled) triggerParts.push('responds to events');
    triggerParts.push('ad-hoc');
    const triggerSummary = isDisabled
      ? 'Disabled — no triggers active'
      : (triggerParts.length === 1 ? 'Runs on demand only • ad-hoc' : triggerParts.join(' • '));

    const autonomyLine: Record<string, string> = {
      suggest: 'Investigates on its own • surfaces findings, takes no action',
      ask:     'Investigates on its own • you approve any change before it runs',
      auto:    'Fully autonomous • remediates in sandbox, then waits for production approval',
    };
    const accent = ACCENTS[agentId] || '#9aa1ac';
    const displayName = status?.name ?? agentId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return React.createElement('div', null,
      // Back link
      React.createElement('button', {
        onClick: onBack,
        style: {
          background: 'none', border: 'none', color: 'var(--ag-text-secondary)',
          fontSize: 13, cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6,
        },
      }, '‹ All agents'),

      React.createElement('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 24 },
      },
        // Avatar
        React.createElement('div', {
          style: {
            width: 64, height: 64, borderRadius: 16, flexShrink: 0,
            background: accent + '22', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: accent, fontSize: 26, fontWeight: 800,
          },
        }, (displayName[0] ?? 'A').toUpperCase()),

        // Name + pills + summary lines
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          // Name row with pills
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const, marginBottom: 12 } },
            React.createElement('span', { style: { fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em' } }, displayName),
            // Lifecycle pill
            React.createElement('span', {
              className: `ag-pill ${isDisabled ? 'ag-pill--disabled' : 'ag-pill--healthy'}`,
            }, isDisabled ? 'Disabled' : 'Enabled'),
            // Workload pill (only when active + pending)
            !isDisabled && pendingCount > 0 && React.createElement('span', {
              className: 'ag-pill ag-pill--review',
            }, `${pendingCount} need review`),
          ),
          // Autonomy line
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6, color: 'var(--ag-text-secondary)', fontSize: 15 } },
            React.createElement('span', { style: { color: '#f0b52e' } }, '⚑'),
            autonomyLine[autonomy] ?? autonomyLine.suggest,
          ),
          // Trigger summary
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 9, color: 'var(--ag-text-muted)', fontSize: 15 } },
            React.createElement('span', null, '◔'),
            triggerSummary,
          ),
        ),

        // Run now button
        React.createElement('button', {
          onClick: () => this.setState({ showRunModal: true }),
          disabled: running || isDisabled,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 9,
            background: running || isDisabled ? 'var(--ag-bg-elevated)' : 'var(--ag-teal)',
            color: running || isDisabled ? 'var(--ag-text-muted)' : 'var(--ag-on-teal)',
            fontWeight: 700, fontSize: 15, border: 'none', borderRadius: 10,
            padding: '12px 22px', cursor: running || isDisabled ? 'not-allowed' : 'pointer', flexShrink: 0,
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
      { id: 'settings',  label: 'Settings' },
      { id: 'approvals', label: 'Approvals', badge: pendingCount > 0 ? pendingCount : undefined },
      { id: 'activity',  label: 'Activity' },
      { id: 'tools',     label: 'Tools' },
    ];

    return React.createElement('div', {
      style: { display: 'flex', borderBottom: '1px solid var(--ag-border)', marginBottom: 24 },
    },
      ...tabs.map(tab =>
        React.createElement('button', {
          key: tab.id,
          onClick: () => { this.setState({ activeTab: tab.id }); if (tab.id === 'tools') this.loadTools(); },
          style: {
            background: 'none', border: 'none', padding: '0 0 12px', marginRight: 28,
            fontSize: 14, fontWeight: activeTab === tab.id ? 700 : 500,
            color: activeTab === tab.id ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)',
            borderBottom: activeTab === tab.id ? '2px solid var(--ag-teal)' : '2px solid transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          },
        },
          tab.label,
          tab.badge && React.createElement('span', {
            style: { background: '#f0b52e', color: '#3a2a00', fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 999 },
          }, tab.badge),
        ),
      ),
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
      activeTab === 'approvals' && this.renderApprovalsTab(),
      activeTab === 'activity' && React.createElement(AgentRunList, {
        agentId,
        onSwitchToApprovals: () => this.setState({ activeTab: 'approvals' }),
        electron: this.props.electron,
      }),
      activeTab === 'settings'  && React.createElement(AgentWorkspaceSettings, { agentId, electron: this.props.electron }),
      activeTab === 'tools'     && this.renderToolsTab(),

      // Run now site-selection modal
      showRunModal && settings.enabled && React.createElement(AgentRunModal, {
        agentName: this.state.status?.name || agentId,
        agentId,
        electron: this.props.electron,
        supportsFullRun: this.state.status?.supportsFullRun ?? false,
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
