import * as React from 'react';
import { runStore, Run, LogLine, SiteRunStatus } from './RunStore';
import { IPC_CHANNELS } from '../../../common/constants';

interface DrawerState { run: Run | null; elapsed: string; }

const STATUS_ICON: Record<SiteRunStatus, string> = {
  running: '⟳', done: '✓', findings: '!', failed: '✗',
};
const STATUS_COLOR: Record<SiteRunStatus, string> = {
  running: 'var(--ag-teal)', done: 'var(--ag-green)', findings: 'var(--ag-amber)', failed: 'var(--ag-red)',
};
const LOG_COLORS: Record<LogLine['level'], string> = {
  info: '#9aa1ac', ok: '#3ecf8e', warn: '#f5b544', error: '#f4685f',
};

interface DrawerProps { electron?: any; }

export class RunDrawer extends React.Component<DrawerProps, DrawerState> {
  state: DrawerState = { run: runStore.getState().currentRun, elapsed: '0:00' };
  private unsub!: () => void;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private logRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    const update = () => this.setState({ run: runStore.getState().currentRun, elapsed: runStore.getElapsed() });
    runStore.subscribe(update);
    this.unsub = update;
    this.ticker = setInterval(() => this.setState({ elapsed: runStore.getElapsed() }), 1000);
  }

  componentDidUpdate() {
    // Auto-scroll log to newest
    if (this.logRef.current) {
      this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
    }
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.ticker) clearInterval(this.ticker);
  }

  render() {
    const { run, elapsed } = this.state;
    if (!run || !runStore.getState().drawerOpen) return null;

    const isDone = run.phase === 'done';
    const isCancelled = isDone && !!run.cancelled;
    const isClean = isDone && !isCancelled && run.failedCount === 0 && run.findingsSites.length === 0;
    const accentColor = isCancelled ? 'var(--ag-text-muted)' : isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';
    const doneSites = Object.values(run.siteStatus).filter(s => s !== 'running').length;
    const totalSites = run.siteNames.length;
    const progress = totalSites > 0 ? (doneSites / totalSites) * 100 : 0;

    const activeSites = Object.entries(run.siteStatus);

    return React.createElement('div', null,
      // Scrim (click to close)
      React.createElement('div', {
        onClick: () => runStore.toggleDrawer(),
        style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.4)', zIndex: 198 },
      }),

      // Drawer
      React.createElement('div', {
        style: {
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 540,
          background: 'var(--ag-bg-card)', borderLeft: '1px solid var(--ag-border)',
          zIndex: 199, display: 'flex', flexDirection: 'column', animation: 'slideIn 0.28s ease',
        },
      },
        // Header
        React.createElement('div', { style: { padding: '18px 22px', borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
            React.createElement('span', {
              style: { fontSize: 20, color: accentColor, animation: isDone ? 'none' : 'spin 0.9s linear infinite', display: 'inline-block' },
            }, isDone ? (isClean ? '✓' : '!') : '⟳'),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
                isCancelled ? `${run.agentName} cancelled` : `${run.agentName} ${isDone ? 'done' : 'running'}`,
              ),
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } },
                isDone
                  ? `Finished in ${elapsed}`
                  : `${doneSites} of ${totalSites} sites · ${elapsed} elapsed`,
              ),
            ),
            React.createElement('button', {
              onClick: () => runStore.toggleDrawer(),
              style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 },
            }, '✕'),
          ),

          // Progress bar
          React.createElement('div', { style: { height: 5, background: 'var(--ag-bg-elevated)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } },
            React.createElement('div', { style: { height: '100%', width: `${isDone ? 100 : progress}%`, background: accentColor, borderRadius: 3, transition: 'width 0.5s' } }),
          ),

          // Stat line
          React.createElement('div', { style: { display: 'flex', gap: 16, fontSize: 12.5 } },
            React.createElement('span', { style: { color: 'var(--ag-green)' } }, `✓ ${run.doneCount} done`),
            run.failedCount > 0 && React.createElement('span', { style: { color: 'var(--ag-red)' } }, `! ${run.failedCount} failed`),
            run.findingsSites.length > 0 && React.createElement('span', { style: { color: 'var(--ag-amber)' } }, `◷ ${run.findingsSites.length} need review`),
          ),
        ),

        // Per-site status list
        activeSites.length > 0 && React.createElement('div', {
          style: { padding: '14px 22px', borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0 },
        },
          React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10 } },
            `Sites (${activeSites.length})`,
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
            ...activeSites.map(([site, status]) =>
              React.createElement('div', {
                key: site,
                style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 },
              },
                React.createElement('span', {
                  style: {
                    color: STATUS_COLOR[status], fontSize: 14, flexShrink: 0,
                    animation: status === 'running' ? 'spin 0.9s linear infinite' : 'none',
                    display: 'inline-block',
                  },
                }, STATUS_ICON[status]),
                React.createElement('span', { style: { color: 'var(--ag-text-primary)', fontWeight: 500 } }, site),
                React.createElement('span', { style: { color: 'var(--ag-text-muted)', fontSize: 11.5 } },
                  status === 'findings' ? '· findings detected' : status === 'failed' ? '· failed' : '',
                ),
              ),
            ),
          ),
        ),

        // Live log console
        React.createElement('div', {
          ref: this.logRef,
          style: {
            flex: 1, overflowY: 'auto' as const, background: '#0d0f13',
            padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
          },
        },
          run.log.length === 0
            ? React.createElement('div', { style: { color: '#4a4d55', padding: '20px 0', textAlign: 'center' as const } }, 'Waiting for output…')
            : run.log.map((line, i) =>
                React.createElement('div', {
                  key: i,
                  style: { display: 'flex', gap: 12, marginBottom: 3, lineHeight: 1.5 },
                },
                  React.createElement('span', { style: { color: '#4a4d55', flexShrink: 0, width: 36 } }, line.ts),
                  line.site && React.createElement('span', { style: { color: '#6b7280', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, line.site),
                  React.createElement('span', { style: { color: LOG_COLORS[line.level], wordBreak: 'break-word' as const } }, line.msg),
                ),
              ),
        ),

        // Running: cancel button
        !isDone && React.createElement('div', {
          style: { padding: '14px 22px', borderTop: '1px solid var(--ag-border-subtle)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 },
        },
          React.createElement('button', {
            onClick: () => {
              const r = runStore.getState().currentRun;
              if (r) {
                this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.AGENT_RUN_CANCEL, { runId: r.runId });
              }
            },
            style: { padding: '9px 20px', background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border)', borderRadius: 8, fontSize: 13, color: 'var(--ag-red)', cursor: 'pointer' },
          }, 'Cancel run'),
        ),

        // Completion actions
        isDone && React.createElement('div', {
          style: { padding: '14px 22px', borderTop: '1px solid var(--ag-border-subtle)', display: 'flex', gap: 10, flexShrink: 0 },
        },
          run.findingsSites.length > 0 && React.createElement('span', {
            style: { flex: 2, fontSize: 12.5, color: 'var(--ag-text-muted)', display: 'flex', alignItems: 'center' },
          }, 'Open the Agents tab to review findings'),
          React.createElement('button', {
            onClick: () => runStore.dismissRun(),
            style: { flex: 1, padding: '9px 0', background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border)', borderRadius: 8, fontSize: 13, color: 'var(--ag-text-secondary)', cursor: 'pointer' },
          }, 'Dismiss'),
        ),
      ),
    );
  }
}
