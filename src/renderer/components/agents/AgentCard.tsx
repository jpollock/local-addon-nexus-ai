import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';
import { pendingForAgent } from './pending';
import { effectiveCadenceExpression, describeCron } from './effectiveCadence';

interface AgentCardProps {
  status: AgentStatus;
  onSelect: () => void;
}

interface AgentCardState {
  hovered: boolean;
}

const ACCENTS: Record<string, string> = {
  'security-sentinel':     '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier':       '#3ecf8e',
  'dependency-auditor':    '#f5b544',
  'cost-watch':            '#e07acc',
};

function formatLastRun(ms: number | null): string {
  if (!ms) return 'Never run';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export class AgentCard extends React.Component<AgentCardProps, AgentCardState> {
  state: AgentCardState = { hovered: false };

  render() {
    const { status, onSelect } = this.props;
    const { hovered } = this.state;
    const agentId = status.name.toLowerCase().replace(/\s+/g, '-');
    const accent = ACCENTS[agentId] || '#9aa1ac';
    const derivedStatus = agentStore.getAgentDerivedStatus(agentId);
    const settings = agentStore.getOrInitSettings(agentId);
    // The schedule that actually runs — the agent's manifest cron unless the user picked a
    // cadence. Reading settings.cadence alone announced a schedule the scheduler never used.
    const effectiveCron = effectiveCadenceExpression(settings, status.cronExpression);
    const cadenceLabel = effectiveCron ? describeCron(effectiveCron) : 'Not scheduled';

    const isDisabled = derivedStatus === 'disabled';
    const pendingCount = pendingForAgent(agentStore.getState().pendingBySource, agentId);
    const pendingLoaded = agentStore.getState().pendingLoaded;

    return React.createElement('div', {
      onClick: onSelect,
      onMouseEnter: () => this.setState({ hovered: true }),
      onMouseLeave: () => this.setState({ hovered: false }),
      style: {
        background: 'var(--ag-bg-card)',
        border: `1px solid ${hovered ? '#3a4049' : 'var(--ag-border)'}`,
        borderRadius: 14,
        padding: 20,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'border-color 0.15s, transform 0.15s',
      },
    },
      // Top row: avatar + name + pill
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 } },
        // Avatar tile
        React.createElement('div', {
          style: {
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: accent + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent, fontSize: 19, fontWeight: 700,
          },
        }, (status.name || 'A')[0]),

        // Name + tagline
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' as const },
          },
            React.createElement('span', {
              style: { fontSize: 15.5, fontWeight: 600, color: 'var(--ag-text-primary)', flex: 1 },
            }, status.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
            // Lifecycle pill
            React.createElement('span', {
              className: `ag-pill ${isDisabled ? 'ag-pill--disabled' : 'ag-pill--healthy'}`,
            }, isDisabled ? 'Disabled' : 'Enabled'),
            // Workload pill — only when there are pending items AND pending has loaded.
            // Before pendingLoaded, suppress the badge entirely rather than showing 0.
            !isDisabled && pendingLoaded && pendingCount > 0 && React.createElement('span', {
              className: 'ag-pill ag-pill--review',
              style: { fontSize: 11, padding: '2px 8px' },
            }, `${pendingCount} need review`),
          ),
          React.createElement('p', {
            style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', margin: 0 },
          }, status.description || ''),
        ),
      ),

      // Divider
      React.createElement('div', { style: { height: 1, background: 'var(--ag-border-subtle)', margin: '0 0 12px' } }),

      // Bottom row: mini-stats + last run
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        // Mini-stats (2 columns)
        React.createElement('div', { style: { display: 'flex', gap: 24 } },
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 17, fontWeight: 600, color: status.lastRunStatus === 'error' ? 'var(--ag-red)' : 'var(--ag-green)' },
            }, status.lastRunStatus === 'success' ? '✓' : status.lastRunStatus === 'error' ? '✗' : '—'),
            React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ag-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Last status'),
          ),
          React.createElement('div', null,
            // `effectiveCron` as well as the toggle. An agent with no cron trigger cannot be
            // scheduled, but may still carry a stale `scheduleEnabled: true` written before the
            // Settings toggle was withdrawn from such agents — and there is no longer a control
            // that can clear it. Reading the toggle alone printed "Not scheduled" under the
            // heading "Schedule", permanently. Nothing there is the honest answer.
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: (settings.scheduleEnabled && effectiveCron) ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)' } },
              settings.scheduleEnabled && effectiveCron
                ? (() => { const parts = cadenceLabel.split(' '); return parts.length > 1 ? `${parts[0]} ${parts[1]}` : parts[0]; })()
                : '—',
            ),
            React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ag-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Schedule'),
          ),
        ),

        // Last run time — italicised when agent is disabled to signal it's historical
        React.createElement('div', {
          style: { fontSize: 11, color: 'var(--ag-text-muted)', fontStyle: isDisabled ? 'italic' : 'normal' },
        }, isDisabled && status.lastRunAt ? `Last run ${formatLastRun(status.lastRunAt)} (disabled)` : `Last run ${formatLastRun(status.lastRunAt)}`),
      ),
    );
  }
}
