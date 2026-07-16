import * as React from 'react';
import { runStore, Run } from './RunStore';

interface ToastProps {
  onViewProgress: () => void;
  onViewReport: () => void;
}

interface ToastState {
  run: Run | null;
  startDismissed: boolean;
}

export class RunToast extends React.Component<ToastProps, ToastState> {
  state: ToastState = { run: runStore.getState().currentRun, startDismissed: runStore.getState().drawerOpen };
  private unsub!: () => void;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidMount() {
    const update = () => {
      const prev = this.state.run;
      const next = runStore.getState().currentRun;
      // When a new run starts, reset dismissed state
      if (next && (!prev || next.runId !== prev?.runId)) {
        this.setState({ run: next, startDismissed: runStore.getState().drawerOpen });
        // Auto-dismiss the start toast after 5s
        if (this.autoTimer) clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => this.setState({ startDismissed: true }), 5000);
      } else {
        // Auto-suppress start toast if drawer is open
        const drawerOpen = runStore.getState().drawerOpen;
        this.setState({ run: next, startDismissed: drawerOpen });
      }
    };
    runStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }

  render() {
    const { run, startDismissed } = this.state;
    const { onViewProgress, onViewReport } = this.props;
    if (!run) return null;

    const isDone = run.phase === 'done';
    const isCancelled = isDone && !!run.cancelled;
    const isClean = isDone && !isCancelled && run.failedCount === 0 && run.findingsSites.length === 0;
    const accentColor = isCancelled ? 'var(--ag-text-muted)' : isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';

    // Start toast: show while running and not dismissed
    if (!isDone && !startDismissed) {
      return React.createElement('div', {
        style: {
          position: 'fixed', top: 20, right: 20, width: 360, zIndex: 200,
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderLeft: `4px solid ${accentColor}`, borderRadius: 12,
          padding: '14px 18px', animation: 'slideIn 0.28s ease',
          display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        },
      },
        React.createElement('span', {
          style: { fontSize: 18, animation: 'spin 0.9s linear infinite', display: 'inline-block', flexShrink: 0 },
        }, '⟳'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
            `${run.agentName} started on ${run.siteNames.length} site${run.siteNames.length !== 1 ? 's' : ''}.`,
          ),
        ),
        React.createElement('button', {
          onClick: onViewProgress,
          style: { background: 'none', border: 'none', color: 'var(--ag-teal)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0, padding: '0 0 0 4px' },
        }, 'View progress'),
        React.createElement('button', {
          onClick: () => this.setState({ startDismissed: true }),
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 14, cursor: 'pointer', padding: 0 },
        }, '✕'),
      );
    }

    // Completion toast: show when done until dismissed
    if (isDone) {
      const summaryText = isCancelled
        ? `${run.agentName} run cancelled.`
        : isClean
          ? `${run.agentName} finished — all sites clean.`
          : `${run.agentName} finished · ${run.failedCount} failed · ${run.findingsSites.length} need review`;
      return React.createElement('div', {
        style: {
          position: 'fixed', top: 20, right: 20, width: 360, zIndex: 200,
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderLeft: `4px solid ${accentColor}`, borderRadius: 12,
          padding: '14px 18px', animation: 'slideIn 0.28s ease',
          display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        },
      },
        React.createElement('span', { style: { fontSize: 18, color: accentColor, flexShrink: 0 } }, isClean ? '✓' : '!'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-primary)' } }, summaryText),
        ),
        React.createElement('button', {
          onClick: onViewReport,
          style: { background: 'none', border: 'none', color: accentColor, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0, padding: '0 4px' },
        }, 'View report'),
        React.createElement('button', {
          onClick: () => runStore.dismissRun(),
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 14, cursor: 'pointer', padding: 0 },
        }, '✕'),
      );
    }

    return null;
  }
}
