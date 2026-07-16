import * as React from 'react';
import { runStore, Run } from './RunStore';

interface PillProps {
  onOpen: () => void;
}

interface PillState { run: Run | null; elapsed: string; drawerOpen: boolean; }

export class RunPill extends React.Component<PillProps, PillState> {
  state: PillState = { run: runStore.getState().currentRun, elapsed: '0:00', drawerOpen: runStore.getState().drawerOpen };
  private unsub!: () => void;
  private ticker: ReturnType<typeof setInterval> | null = null;

  componentDidMount() {
    const update = () => this.setState({ run: runStore.getState().currentRun, elapsed: runStore.getElapsed(), drawerOpen: runStore.getState().drawerOpen });
    runStore.subscribe(update);
    this.unsub = update;
    this.ticker = setInterval(() => this.setState({ elapsed: runStore.getElapsed() }), 1000);
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.ticker) clearInterval(this.ticker);
  }

  render() {
    const { run, elapsed, drawerOpen } = this.state;
    const { onOpen } = this.props;
    if (!run || drawerOpen) return null;

    const isDone = run.phase === 'done';
    const isCancelled = isDone && !!run.cancelled;
    const doneSites = Object.values(run.siteStatus).filter(s => s === 'done' || s === 'findings' || s === 'failed').length;
    const isClean = isDone && !isCancelled && run.failedCount === 0;
    const accentColor = isCancelled ? 'var(--ag-text-muted)' : isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';
    const totalSites = run.siteNames.length;

    // Progress bar width
    const progress = totalSites > 0 ? (doneSites / totalSites) * 100 : 0;

    return React.createElement('div', {
      onClick: onOpen,
      style: {
        position: 'fixed', bottom: 20, right: 20, width: 280, zIndex: 199,
        background: 'var(--ag-bg-card)', border: `1px solid ${accentColor}40`,
        borderRadius: 12, padding: '12px 16px', cursor: 'pointer',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)', animation: 'fadeUp 0.25s ease',
      },
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
        React.createElement('span', {
          style: {
            fontSize: 16, color: accentColor, flexShrink: 0,
            animation: isDone ? 'none' : 'spin 0.9s linear infinite', display: 'inline-block',
          },
        }, isDone ? (isClean ? '✓' : '!') : '⟳'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 1 } },
            isCancelled ? `${run.agentName} cancelled` : isDone ? `${run.agentName} done` : `${run.agentName} running`,
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } },
            isDone
              ? `${run.doneCount} done · ${run.failedCount} failed · ${run.findingsSites.length} review`
              : `${doneSites} / ${totalSites} sites · ${elapsed} elapsed`,
          ),
        ),
        isDone && React.createElement('button', {
          onClick: (e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); runStore.dismissRun(); },
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', cursor: 'pointer', fontSize: 14, padding: 0 },
        }, '✕'),
      ),
      // Progress bar
      React.createElement('div', { style: { height: 4, background: 'var(--ag-bg-elevated)', borderRadius: 2, overflow: 'hidden' } },
        React.createElement('div', {
          style: { height: '100%', width: `${isDone ? 100 : progress}%`, background: accentColor, borderRadius: 2, transition: 'width 0.3s' },
        }),
      ),
    );
  }
}
