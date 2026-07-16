import * as React from 'react';
import { agentStore } from './AgentStore';
import { IPC_CHANNELS } from '../../../common/constants';
import { AgentsHub } from './AgentsHub';
import { FleetActivityLedger } from './FleetActivityLedger';
import { AgentWorkspace } from './AgentWorkspace';
import { GenericApprovalDrawer, GenericApproval } from './GenericApprovalDrawer';
import { SentinelReviewOverlay, AccountDecisionMap } from './SentinelReviewOverlay';
import { ExecuteModal } from './ExecuteModal';
import type { SentinelCase } from './SentinelTypes';
import { parseSentinelReport, findLatestReport } from '../../utils/parseSentinelReport';
import { rendererGql } from '../../utils/rendererGql';

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

  componentDidMount() {
    // Load agent statuses via IPC
    this.refreshAgents();
    // Subscribe to store for reactive updates
    const update = () => this.forceUpdate();
    agentStore.subscribe(update);
    this.unsub = update;
    // Sync agent settings to main process so scheduler/event-bus respects toggles
    agentStore.setIpcSyncer((settings) => {
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, settings).catch(() => {});
    });
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
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

  render() {
    const { homeTab, selectedAgentId, activeApproval, activeSentinelCase, executeDecisions, executeCommands } = this.state;
    const { electron } = this.props;

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
      );
    }

    // Hub / ledger home view
    const pendingCount = agentStore.getState().activityEvents.filter(e => e.status === 'review').length;

    return React.createElement('div', { style: { padding: '24px 40px 0' } },
      // Shared heading area
      React.createElement('div', { style: { marginBottom: 20 } },
        React.createElement('h1', { style: { fontSize: 20, fontWeight: 600, color: 'var(--ag-text-primary)', margin: '0 0 4px' } }, 'Agents'),
        React.createElement('p', { style: { fontSize: 13, color: 'var(--ag-text-secondary)', margin: '0 0 20px' } },
          'Autonomous agents working across your fleet • configure how much each can do on its own',
        ),
        // Tab bar — underline style
        React.createElement('div', {
          style: { display: 'flex', borderBottom: '1px solid var(--ag-border)', marginBottom: 0 },
        },
          React.createElement('button', {
            onClick: () => this.setState({ homeTab: 'agents' }),
            style: {
              background: 'none', border: 'none', padding: '0 0 12px', marginRight: 28,
              fontSize: 14, fontWeight: homeTab === 'agents' ? 500 : 400,
              color: homeTab === 'agents' ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)',
              borderBottom: homeTab === 'agents' ? '2px solid var(--ag-teal)' : '2px solid transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            },
          }, 'Agents'),
          React.createElement('button', {
            onClick: () => this.setState({ homeTab: 'activity' }),
            style: {
              background: 'none', border: 'none', padding: '0 0 12px', marginRight: 28,
              fontSize: 14, fontWeight: homeTab === 'activity' ? 500 : 400,
              color: homeTab === 'activity' ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)',
              borderBottom: homeTab === 'activity' ? '2px solid var(--ag-teal)' : '2px solid transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            },
          },
            'Fleet activity',
            pendingCount > 0 && React.createElement('span', {
              style: { background: 'rgba(245,181,68,0.20)', color: 'var(--ag-amber)', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 600 },
            }, pendingCount),
          ),
        ),
      ),
      // Content
      homeTab === 'agents'
        ? React.createElement(AgentsHub, { onSelectAgent: (id: string) => this.setState({ selectedAgentId: id }) })
        : React.createElement(FleetActivityLedger, { onReviewEvent: (eventId: string) => this.openSentinelReview(eventId) }),
      ...this.renderSentinelModals(),
    );
  }
}
