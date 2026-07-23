import * as React from 'react';
import { agentStore, AgentStatus } from './AgentStore';

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

const CADENCE_LABELS: Record<string, string> = {
  '*/15 * * * *': 'Every 15 minutes',
  '0 * * * *':    'Hourly',
  '0 */6 * * *':  'Every 6 hours',
  '0 0 * * *':    'Daily',
  '0 0 * * 0':    'Weekly',
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
    const cadenceLabel = CADENCE_LABELS[settings.cadence] || 'Custom schedule';

    const isDisabled = derivedStatus === 'disabled';
    const pendingCount = agentStore.getState().activityEvents.filter(
      e => e.agentId === agentId && e.status === 'review'
    ).length;

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
            // Workload pill — only when there are pending items
            !isDisabled && pendingCount > 0 && React.createElement('span', {
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
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: settings.scheduleEnabled ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)' } },
              settings.scheduleEnabled
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
