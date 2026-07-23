import * as React from 'react';
import { AgentRunRecord } from './AgentStore';
import { rendererGql } from '../../utils/rendererGql';
import { IPC_CHANNELS } from '../../../common/constants';

// ─── Props / State ────────────────────────────────────────────────────────────

interface AgentRunListProps {
  agentId: string;
  onSwitchToApprovals: () => void;
  electron?: any;
}

interface AgentRunListState {
  runs: AgentRunRecord[];
  loading: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDay(ms: number): string {
  const today = new Date();
  const d = new Date(ms);
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export class AgentRunList extends React.Component<AgentRunListProps, AgentRunListState> {
  state: AgentRunListState = { runs: [], loading: true };

  async componentDidMount() {
    await this.loadRuns();
  }

  private async loadRuns() {
    const { agentId } = this.props;
    try {
      const result = await rendererGql<{ agentRunHistory: AgentRunRecord[] }>(
        `query AgentRunHistory($agentName: String!) {
          agentRunHistory(agentName: $agentName, limit: 50) {
            id agentName startedAt finishedAt status error summary findingsCount logFile reportFile
          }
        }`,
        { agentName: agentId },
      );
      const runs: AgentRunRecord[] = result?.agentRunHistory ?? [];
      this.setState({ runs, loading: false });
    } catch {
      this.setState({ loading: false });
    }
  }

  render() {
    const { runs, loading } = this.state;
    const { onSwitchToApprovals } = this.props;

    if (loading) {
      return React.createElement('div', {
        style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const },
      }, 'Loading run history…');
    }

    if (runs.length === 0) {
      return React.createElement('div', {
        style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const },
      }, 'No runs recorded yet.');
    }

    // Group by day
    const byDay = new Map<string, AgentRunRecord[]>();
    for (const run of runs) {
      const label = formatDay(run.startedAt);
      const group = byDay.get(label) ?? [];
      group.push(run);
      byDay.set(label, group);
    }

    return React.createElement('div', { style: { marginTop: 4 } },
      ...Array.from(byDay.entries()).map(([dayLabel, dayRuns]) =>
        React.createElement('div', { key: dayLabel },
          // Day header
          React.createElement('div', {
            style: {
              color: 'var(--ag-text-muted)', fontSize: 12.5, fontWeight: 600,
              letterSpacing: '0.03em', margin: '20px 0 10px',
            },
          }, dayLabel),

          // Run rows
          ...dayRuns.map(run =>
            React.createElement('div', {
              key: run.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 16,
                background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
                borderRadius: 12, padding: '14px 18px', marginBottom: 8,
              },
            },
              // Summary text
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', {
                  style: { fontWeight: 600, color: 'var(--ag-text-primary)', fontSize: 14 },
                }, `${run.agentName} sweep ${run.status === 'error' ? 'failed' : 'complete'}`),
                React.createElement('div', {
                  style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 3 },
                },
                  run.summary
                    ? (run.summary.length > 80 ? run.summary.slice(0, 80) + '…' : run.summary)
                    : (run.status === 'error' ? (run.error ?? 'Run failed') : 'No summary available'),
                ),
              ),

              // Artifact chips
              React.createElement('div', { style: { display: 'flex', gap: 8, flexShrink: 0 } },
                // Log chip — opens agent log file in system default app
                React.createElement('span', {
                  title: 'Open log file',
                  onClick: () => this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.AGENT_LOG_OPEN, { agentId: this.props.agentId, logFile: run.logFile }),
                  style: {
                    fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 7,
                    background: 'rgba(96,165,250,0.14)', color: '#7cb6ff', cursor: 'pointer',
                  },
                }, 'Log'),

                // Report chip — opens report file when available, otherwise no-op
                run.reportFile && React.createElement('span', {
                  title: 'Open report file',
                  onClick: () => this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.AGENT_LOG_OPEN, { agentId: this.props.agentId, logFile: run.reportFile }),
                  style: {
                    fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 7,
                    background: 'rgba(167,139,250,0.14)', color: '#b79bff', cursor: 'pointer',
                  },
                }, 'Report'),

                // Approval chip — amber when findings, gray when none
                React.createElement('span', {
                  onClick: run.findingsCount > 0 ? onSwitchToApprovals : undefined,
                  style: {
                    fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 7,
                    cursor: run.findingsCount > 0 ? 'pointer' : 'default',
                    background: run.findingsCount > 0 ? 'rgba(240,181,46,0.14)' : 'rgba(139,149,163,0.14)',
                    color: run.findingsCount > 0 ? '#f0b52e' : '#8b95a3',
                  },
                }, run.findingsCount > 0 ? 'Approval' : 'No action'),
              ),

              // Timestamp
              React.createElement('span', {
                style: {
                  color: 'var(--ag-text-muted)', fontSize: 12.5,
                  flexShrink: 0, width: 44, textAlign: 'right' as const,
                },
              }, formatTime(run.startedAt)),
            ),
          ),
        ),
      ),
    );
  }
}
