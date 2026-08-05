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
    // Hydrate from the persisted settings BEFORE registering the syncer. The renderer is the
    // only writer, so if it registers first it pushes its localStorage guess over whatever is
    // actually on disk — which is how an agent that had been switched off came back with a
    // 15-minute cron. Read first, then echo.
    const ipc = this.props.electron?.ipcRenderer;
    Promise.resolve(ipc?.invoke(IPC_CHANNELS.AGENT_SETTINGS_GET))
      .then((res: any) => agentStore.hydrateFromMain(res?.settings))
      .catch(() => agentStore.hydrateFromMain(null))  // no channel (older main) — do not block the UI
      .then(() => {
        agentStore.setIpcSyncer((settings) => {
          ipc?.invoke(IPC_CHANNELS.AGENT_SETTINGS_UPDATE, settings).catch(() => {});
        });
      });
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private openSentinelReview(eventId: string) {
    // Prefer the plan stored on the specific activity event (set on AGENT_RUN_COMPLETE).
    // Falls back to the global __nexusSentinelPlan for events that predate this field.
    const event = agentStore.getState().activityEvents.find(e => e.id === eventId);
    const eventPlan = (event as any)?.plan;
    const eventFindings = (event as any)?.findings;

    const planData = eventPlan
      ? { plan: eventPlan, findings: eventFindings ?? [], site: (eventPlan as any).site }
      : (window as any).__nexusSentinelPlan;

    if (planData?.plan) {
      const { plan, findings, site } = planData;
      const siteName: string = plan.site ?? site ?? 'unknown';
      const sc: SentinelCase = {
        site: siteName,
        host: `${siteName}.wpengine.com`,
        env: 'PRODUCTION',
        detectedAt: new Date().toISOString(),
        reportPath: (eventPlan as any)?.reportPath ?? '',
        sandbox: { id: plan.sandbox ?? '', url: '' },
        verdict: plan.verdict === 'ready' ? 'ready' : 'blocked',
        failedSteps: (plan.steps as any[]).filter((s: any) => s.verificationResult === 'failed').length,
        findings: ((findings ?? []) as any[]).map((f: any) => ({
          id: f.id,
          sev: f.severity as any,
          title: f.title,
          plain: f.description ?? f.title,
        })),
        steps: (plan.steps as any[]).map((s: any, i: number) => ({
          n: i + 1,
          title: s.label ?? '',
          by: 'agent' as const,
          review: false,
          action: s.verificationOutput ?? '',
          proof: s.verificationOutput ?? '',
          ok: s.verificationResult !== 'failed',
          deferred: false,
        })),
        accounts: [],
        pendingApproval: (eventPlan as any)?.pendingApproval ?? false,
        signals: (eventPlan as any)?.signals ?? eventFindings ?? [],
        uncoveredCritical: (eventPlan as any)?.uncoveredCritical ?? [],
      };
      this.setState({ activeSentinelCase: sc });
      return;
    }
    // Final fallback: read the most recent report file from disk.
    // Covers events that predate the SDK refactor (no plan field) and cases
    // where window.__nexusSentinelPlan was cleared (Local restart).
    const path = require('path') as typeof import('path');
    const fs   = require('fs')   as typeof import('fs');
    const os   = require('os')   as typeof import('os');
    const reportsBase = path.join(
      os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', 'security-sentinel', 'reports',
    );
    try {
      const siteHint = event?.siteName;
      const allReports: Array<{ path: string; mtime: number }> = [];

      // If we know the site, try it first — only fall back to other sites if no report exists
      const tryDirs = siteHint
        ? [siteHint, ...fs.readdirSync(reportsBase).filter((s: string) => s !== siteHint)]
        : fs.readdirSync(reportsBase) as string[];

      for (const site of tryDirs) {
        const siteDir = path.join(reportsBase, site);
        try {
          const files = fs.readdirSync(siteDir).filter((f: string) => f.endsWith('.md')).sort().reverse();
          if (files.length > 0) {
            const p = path.join(siteDir, files[0]);
            allReports.push({ path: p, mtime: fs.statSync(p).mtimeMs });
          }
        } catch {}
      }

      // If siteHint is set, only use a report for a different site as a last resort
      // (prefer showing nothing over showing the wrong site)
      const candidates = siteHint
        ? allReports.filter(r => r.path.includes(`/${siteHint}/`))
        : allReports.sort((a, b) => b.mtime - a.mtime);
      for (const { path: reportPath } of candidates) {
        const content = fs.readFileSync(reportPath, 'utf-8');
        const lines = content.split('\n');
        const site = (lines.find((l: string) => l.startsWith('**Site:**')) ?? '').replace('**Site:**', '').trim() || 'unknown';
        const detectedAt = (lines.find((l: string) => l.startsWith('**Date:**')) ?? '').replace('**Date:**', '').trim();
        const sandbox = (lines.find((l: string) => l.startsWith('**Sandbox:**')) ?? '').replace('**Sandbox:**', '').trim();
        const verdict = content.includes('READY TO PUSH') ? 'ready' : 'blocked';
        const findingsStart = lines.findIndex((l: string) => l.startsWith('## Findings'));
        const checklistStart = lines.findIndex((l: string) => l.startsWith('## Remediation Checklist'));
        const verdictIdx = lines.findIndex((l: string) => l.startsWith('## Verdict'));
        const findingLines = findingsStart >= 0 && checklistStart >= 0 ? lines.slice(findingsStart + 1, checklistStart) : [];
        const checklistLines = checklistStart >= 0 && verdictIdx >= 0 ? lines.slice(checklistStart + 1, verdictIdx) : [];
        const findings = findingLines
          .map((l: string) => { const m = l.match(/^- \[([\w]+)\]\s+([\w-]+):\s+(.+)$/); return m ? { id: m[2], sev: m[1].toLowerCase() as any, title: m[3], plain: m[3] } : null; })
          .filter(Boolean) as any[];
        const steps = checklistLines
          .map((l: string, i: number) => { const m = l.match(/^([✅❌⚪])\s+Step\s+(\d+):\s+(.+?)(?:\s+—\s+(.*))?$/u); return m ? { n: i + 1, title: m[3], by: 'agent' as const, review: false, action: m[4] ?? '', proof: m[4] ?? '', ok: m[1] === '✅', deferred: m[1] === '⚪' } : null; })
          .filter(Boolean) as any[];
        if (findings.length > 0 || steps.length > 0) {
          this.setState({ activeSentinelCase: { site, host: `${site}.wpengine.com`, env: 'PRODUCTION', detectedAt, reportPath, sandbox: { id: sandbox, url: '' }, verdict, failedSteps: steps.filter((s: any) => !s.ok).length, findings, steps, accounts: [] } });
          return;
        }
      }
    } catch {}
  }

  private handleExecuteDone(executedSteps?: Array<{ label: string; ok: boolean; durationMs: number }>) {
    const sc = this.state.activeSentinelCase;
    if (sc) {
      const children = executedSteps?.map(s =>
        `${s.ok ? '✅' : '❌'} ${s.label} — ${(s.durationMs / 1000).toFixed(1)}s`,
      );
      const updated = agentStore.getState().activityEvents.map(e =>
        e.status === 'review' && (e.siteName === sc.site || e.sub?.includes(sc.site))
          ? { ...e, status: 'done' as const, count: executedSteps?.length, children }
          : e,
      );
      agentStore.setState({ activityEvents: updated });
    }
    this.setState({ activeSentinelCase: null, executeDecisions: null, executeCommands: [] });
    this.refreshAgents();
  }

  private generateCommands(sentinelCase: SentinelCase, decisions: AccountDecisionMap): string[] {
    const planData = (window as any).__nexusSentinelPlan;
    if (planData?.plan?.steps) {
      const plan = planData.plan;
      // Use the SDK-provided commands for tier-3 steps — these are the exact
      // commands the sentinel verified in the sandbox
      const cmds: string[] = (plan.steps as any[])
        .filter((s: any) => s.tier === 3)
        .map((s: any) => s.command as string)
        .filter(Boolean);
      // Account decisions (derived from the review overlay)
      const toDelete = sentinelCase.accounts
        .filter(a => a.autoDeleted || decisions[a.id]?.decision === 'delete')
        .map(a => a.uid).filter(Boolean);
      if (toDelete.length > 0) {
        cmds.push(`wp user delete ${toDelete.join(' ')} --reassign=1`);
      }
      for (const a of sentinelCase.accounts.filter(a => decisions[a.id]?.decision === 'keep')) {
        cmds.push(`wp user update ${a.uid} --role=subscriber`);
      }
      return cmds;
    }

    // Fallback: hardcoded list (for cases where no typed plan is stored)
    const pluginSlugs = ['fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
      'noted', 'woocommerce-conversion-tracking', 'wp-file-manager'];
    const cmds: string[] = [];
    cmds.push('rm wp-content/mu-plugins/index.php');
    cmds.push(`wp plugin delete ${pluginSlugs.join(' ')}`);
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
        onDone: (steps) => this.handleExecuteDone(steps),
      }));
    }

    return nodes;
  }

  private async refreshAgents() {
    try {
      const result = await rendererGql<{ agentStatus: any[] }>(
        `{ agentStatus { name version description cronExpression lastRunAt lastRunStatus lastRunDurationMs lastRunError supportsFullRun } }`,
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
