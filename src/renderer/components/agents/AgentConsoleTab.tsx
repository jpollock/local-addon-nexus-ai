import * as React from 'react';
import { agentStore } from './AgentStore';
import { AgentsHub } from './AgentsHub';
import { FleetActivityLedger } from './FleetActivityLedger';
import { AgentWorkspace } from './AgentWorkspace';
import { GenericApprovalDrawer, GenericApproval } from './GenericApprovalDrawer';
import { SentinelReviewOverlay, AccountDecisionMap } from './SentinelReviewOverlay';
import { ExecuteModal } from './ExecuteModal';
import type { SentinelCase } from './SentinelTypes';
import { parseSentinelReport, findLatestReport } from '../../utils/parseSentinelReport';
import { rendererGql } from '../../utils/rendererGql';
import { runStore } from './RunStore';
import { RunToast } from './RunToast';
import { RunPill } from './RunPill';
import { RunDrawer } from './RunDrawer';
import { IPC_CHANNELS } from '../../../common/constants';

interface AgentConsoleTabProps {
  electron: any;
}

interface AgentConsoleTabState {
  homeTab: 'agents' | 'activity';
  selectedAgentId: string | null;
  activeApproval: GenericApproval | null;
  activeSentinelCase: SentinelCase | null;
  executeDecisions: AccountDecisionMap | null;
  executeCommands: string[];
}

export class AgentConsoleTab extends React.Component<AgentConsoleTabProps, AgentConsoleTabState> {
  state: AgentConsoleTabState = {
    homeTab: 'agents',
    selectedAgentId: null,
    activeApproval: null,
    activeSentinelCase: null,
    executeDecisions: null,
    executeCommands: [],
  };
  private unsub!: () => void;
  private runStartedHandler: ((_: any, payload: any) => void) | null = null;
  private runCompleteHandler: ((_: any, payload: any) => void) | null = null;

  componentDidMount() {
    // Load agent statuses via IPC
    this.refreshAgents();
    // Subscribe to store for reactive updates
    const update = () => this.forceUpdate();
    agentStore.subscribe(update);
    this.unsub = update;

    // Wire agent run lifecycle IPC events → RunStore
    const ipc = this.props.electron.ipcRenderer;
    this.runStartedHandler = (_event: any, payload: any) => {
      runStore.startRun(payload);
    };
    this.runCompleteHandler = (_event: any, payload: any) => {
      runStore.completeRun(payload);
      // OS notification when window is in background
      if (typeof Notification !== 'undefined' && document.visibilityState === 'hidden') {
        const state = runStore.getState();
        new Notification(`${state.currentRun?.agentName || 'Agent'} run complete`, {
          body: payload.failedCount === 0
            ? 'All sites clean.'
            : `${payload.failedCount} failed, ${(payload.findingsSites?.length || 0)} need review.`,
        });
      }
    };
    ipc.on(IPC_CHANNELS.AGENT_RUN_STARTED, this.runStartedHandler);
    ipc.on(IPC_CHANNELS.AGENT_RUN_COMPLETE, this.runCompleteHandler);
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
    const ipc = this.props.electron.ipcRenderer;
    if (this.runStartedHandler) ipc.removeListener(IPC_CHANNELS.AGENT_RUN_STARTED, this.runStartedHandler);
    if (this.runCompleteHandler) ipc.removeListener(IPC_CHANNELS.AGENT_RUN_COMPLETE, this.runCompleteHandler);
  }

  private openSentinelReview(_eventId: string) {
    const reportsBase = require('path').join(
      require('os').homedir(),
      'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', 'security-sentinel', 'reports',
    );
    try {
      const fs = require('fs') as typeof import('fs');
      const sites = fs.readdirSync(reportsBase);
      for (const site of sites) {
        const reportPath = findLatestReport(site);
        if (reportPath) {
          const sc = parseSentinelReport(reportPath);
          if (sc) {
            this.setState({ activeSentinelCase: sc });
            return;
          }
        }
      }
    } catch {}
  }

  private handleExecuteDone() {
    this.setState({ activeSentinelCase: null, executeDecisions: null, executeCommands: [] });
    this.refreshAgents();
  }

  private generateCommands(sentinelCase: SentinelCase, decisions: AccountDecisionMap): string[] {
    const pluginSlugs = ['fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
      'noted', 'woocommerce-conversion-tracking', 'wp-file-manager'];
    const cmds: string[] = [];
    cmds.push(`wp plugin delete ${pluginSlugs.join(' ')}`);
    cmds.push('rm wp-content/mu-plugins/index.php');
    const toDelete = sentinelCase.accounts
      .filter(a => a.autoDeleted || decisions[a.id]?.decision === 'delete')
      .map(a => a.uid).filter(Boolean);
    if (toDelete.length > 0) {
      cmds.push(`wp user delete ${toDelete.join(' ')} --reassign=1`);
    }
    for (const a of sentinelCase.accounts.filter(a => decisions[a.id]?.decision === 'keep')) {
      cmds.push(`wp user update ${a.uid} --role=subscriber`);
    }
    cmds.push('wp config shuffle-salts');
    cmds.push('wp config set DISALLOW_FILE_EDIT true --raw');
    return cmds;
  }

  private renderSentinelModals(): React.ReactNode[] {
    const { activeSentinelCase, executeDecisions, executeCommands } = this.state;
    const { electron } = this.props;

    const nodes: React.ReactNode[] = [];

    if (activeSentinelCase && !executeDecisions) {
      nodes.push(React.createElement(SentinelReviewOverlay, {
        key: 'sentinel-review',
        sentinelCase: activeSentinelCase,
        onDismiss: () => this.setState({ activeSentinelCase: null }),
        onExecute: (decisions: AccountDecisionMap) => {
          const commands = activeSentinelCase
            ? this.generateCommands(activeSentinelCase, decisions)
            : [];
          this.setState({ executeDecisions: decisions, executeCommands: commands });
        },
      }));
    }

    if (executeDecisions && activeSentinelCase) {
      nodes.push(React.createElement(ExecuteModal, {
        key: 'execute-modal',
        sentinelCase: activeSentinelCase,
        commands: executeCommands,
        electron,
        onCancel: () => this.setState({ executeDecisions: null }),
        onDone: () => this.handleExecuteDone(),
      }));
    }

    return nodes;
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
    const { homeTab, selectedAgentId, activeApproval, activeSentinelCase, executeDecisions, executeCommands } = this.state;
    const { electron } = this.props;

    // Run lifecycle overlays — fixed-position, self-manage via RunStore
    const runOverlays = [
      React.createElement(RunToast, {
        onViewProgress: () => runStore.setState({ drawerOpen: true }),
        onViewReport: () => runStore.setState({ drawerOpen: true }),
      }),
      React.createElement(RunPill, {
        onOpen: () => runStore.setState({ drawerOpen: true }),
      }),
      React.createElement(RunDrawer, {}),
    ];

    // Agent workspace view
    if (selectedAgentId) {
      return React.createElement('div', null,
        React.createElement(AgentWorkspace, {
          agentId: selectedAgentId,
          electron,
          onBack: () => this.setState({ selectedAgentId: null }),
          onReviewEvent: (eventId: string) => this.openSentinelReview(eventId),
        }),
        activeApproval && React.createElement(GenericApprovalDrawer, {
          approval: activeApproval,
          onDismiss: () => this.setState({ activeApproval: null }),
          onApprove: () => {
            // Mark resolved in store
            this.setState({ activeApproval: null });
          },
        }),
        ...this.renderSentinelModals(),
        ...runOverlays,
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
            onReviewEvent: (eventId: string) => this.openSentinelReview(eventId),
          }),
      ...this.renderSentinelModals(),
      ...runOverlays,
    );
  }
}
