import * as React from 'react';
import { agentStore, ActivityEvent } from './AgentStore';
import { runStore } from './RunStore';

interface LedgerProps {
  onReviewEvent: (eventId: string) => void;
}

interface LedgerState {
  events: ActivityEvent[];
  searchText: string;
  statusFilter: 'all' | 'review' | 'completed' | 'dismissed';
  agentFilter: string;
  expandedEvents: Record<string, boolean>;
  hoveredRow: string | null;
}

function formatAgentName(agentId: string): string {
  return agentId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ACCENTS: Record<string, string> = {
  'security-sentinel': '#35d0c5',
  'performance-optimizer': '#7b8cff',
  'backup-verifier': '#3ecf8e',
  'dependency-auditor': '#f5b544',
  'cost-watch': '#e07acc',
};

function effectiveStatus(event: ActivityEvent): string {
  return event.status;
}

function groupByDay(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const key = e.day;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return groups;
}

function formatDayLabel(day: string): string {
  if (day === 'today') return 'TODAY';
  if (day === 'yest')  return 'YESTERDAY';
  return day.toUpperCase();
}

export class FleetActivityLedger extends React.Component<LedgerProps, LedgerState> {
  state: LedgerState = {
    events: agentStore.getState().activityEvents,
    searchText: '',
    statusFilter: 'all',
    agentFilter: 'all',
    expandedEvents: {},
    hoveredRow: null,
  };
  private unsub!: () => void;

  componentDidMount() {
    const update = () => this.setState({ events: agentStore.getState().activityEvents });
    agentStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    agentStore.unsubscribe(this.unsub);
  }

  private getFilteredEvents(): ActivityEvent[] {
    const { events, searchText, statusFilter, agentFilter } = this.state;
    return events.filter(e => {
      if (agentFilter !== 'all' && e.agentId !== agentFilter) return false;
      if (statusFilter !== 'all') {
        const eff = effectiveStatus(e);
        if (statusFilter === 'review'    && eff !== 'review')    return false;
        if (statusFilter === 'completed' && !['auto','done','info'].includes(eff)) return false;
        if (statusFilter === 'dismissed' && eff !== 'dismissed') return false;
      }
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!e.text.toLowerCase().includes(q) && !e.sub.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  private renderRow(event: ActivityEvent) {
    const { onReviewEvent } = this.props;
    const accent = ACCENTS[event.agentId] || '#9aa1ac';
    const isReviewable = event.status === 'review' && !!event.ref;
    const isViewable = (event.status === 'done' || event.status === 'auto') &&
      runStore.getState().currentRun?.runId === event.id;
    const isExpanded = this.state.expandedEvents[event.id];
    const isRollup = !!event.count;

    const typeClass = {
      Action: 'ag-chip--action', Alert: 'ag-chip--alert',
      Report: 'ag-chip--report', Info: 'ag-chip--info',
    }[event.type] || 'ag-chip--info';

    const statusClass = {
      review: 'ag-status-chip--review', auto: 'ag-status-chip--auto',
      done: 'ag-status-chip--done', info: 'ag-status-chip--info',
      dismissed: 'ag-status-chip--dismissed',
    }[effectiveStatus(event)] || 'ag-status-chip--info';

    const statusGlyph = {
      review: '◷', auto: '✓', done: '✓', info: '·', dismissed: '✕',
    }[effectiveStatus(event)] || '·';

    const statusLabel = {
      review: 'Needs review', auto: 'Completed', done: 'Completed',
      info: 'Info', dismissed: 'Dismissed',
    }[effectiveStatus(event)] || 'Info';

    return React.createElement('div', { key: event.id },
      React.createElement('div', {
        onClick: isRollup ? () => {
          this.setState(s => ({
            expandedEvents: { ...s.expandedEvents, [event.id]: !s.expandedEvents[event.id] },
          }));
        } : undefined,
        onMouseEnter: () => this.setState({ hoveredRow: event.id }),
        onMouseLeave: () => this.setState({ hoveredRow: null }),
        style: {
          display: 'flex', alignItems: 'center', gap: 13,
          padding: '13px 18px',
          borderTop: '1px solid var(--ag-border-subtle)',
          cursor: isRollup || isViewable || isReviewable ? 'pointer' : 'default',
          transition: 'background 0.1s',
          background: this.state.hoveredRow === event.id ? 'var(--ag-bg-elevated)' : 'transparent',
        },
      },
        // Agent avatar
        React.createElement('div', {
          style: {
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: accent + '22', color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700,
          },
        }, event.agentId[0]?.toUpperCase() || 'A'),

        // Text block
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)', marginBottom: 2 } }, event.text),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } }, event.sub),
        ),

        // Rollup badge
        isRollup && React.createElement('span', {
          style: {
            fontSize: 11, fontWeight: 600, color: 'var(--ag-text-secondary)',
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
            borderRadius: 20, padding: '2px 8px',
          },
        }, `×${event.count}`),

        // Type chip
        React.createElement('span', { className: `ag-chip ${typeClass}` }, event.type),

        // Status chip
        React.createElement('span', { className: `ag-status-chip ${statusClass}` }, `${statusGlyph} ${statusLabel}`),

        // Time
        React.createElement('span', {
          style: { width: 52, textAlign: 'right', fontSize: 12, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
        }, event.time),

        // Review button (review-status rows)
        isReviewable && React.createElement('button', {
          onClick: (ev: Event) => { ev.stopPropagation(); onReviewEvent(event.id); },
          style: {
            background: 'var(--ag-teal)', color: 'var(--ag-on-teal)',
            border: 'none', borderRadius: 7, padding: '5px 14px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          },
        }, 'Review'),

        // View run button (completed rows where run is still in RunStore)
        isViewable && React.createElement('button', {
          onClick: (ev: Event) => { ev.stopPropagation(); runStore.toggleDrawer(); },
          style: {
            background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)',
            border: '1px solid var(--ag-border)', borderRadius: 7, padding: '5px 14px',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
          },
        }, 'View run'),
      ),

      // Rollup children
      isExpanded && event.children && React.createElement('div', {
        style: { padding: '0 18px 14px 61px', display: 'flex', flexDirection: 'column', gap: 6 },
      }, ...event.children.map((line, i) =>
        React.createElement('div', {
          key: i, style: { fontSize: 12, color: 'var(--ag-text-secondary)', fontFamily: 'JetBrains Mono, monospace' },
        }, line),
      )),
    );
  }

  render() {
    const filtered = this.getFilteredEvents();
    const grouped = groupByDay(filtered);
    const allAgentIds = [...new Set(this.state.events.map(e => e.agentId))];
    const pendingCount = filtered.filter(e => e.status === 'review').length;

    return React.createElement('div', { style: { padding: '24px 40px' } },

      // Filter bar
      React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' } },
        React.createElement('input', {
          type: 'text', placeholder: 'Search actions, sites, plugins…',
          value: this.state.searchText,
          onChange: (e: any) => this.setState({ searchText: e.target.value }),
          style: {
            flex: 1, minWidth: 240, background: 'var(--ag-bg-inset)',
            border: '1px solid var(--ag-border)', borderRadius: 9,
            padding: '10px 14px', fontSize: 13, color: 'var(--ag-text-primary)',
          },
        }),
        // Status filter buttons (individual pills)
        React.createElement('div', { style: { display: 'flex', gap: 6 } },
          (['all', 'review', 'completed', 'dismissed'] as const).map(s => {
            const active = this.state.statusFilter === s;
            const label = s === 'review' ? 'Needs review' : s[0].toUpperCase() + s.slice(1);
            return React.createElement('button', {
              key: s,
              onClick: () => this.setState({ statusFilter: s }),
              style: {
                padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                background: active ? 'var(--ag-teal)' : 'var(--ag-bg-inset)',
                color: active ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
                border: `1px solid ${active ? 'var(--ag-teal)' : 'var(--ag-border)'}`,
              },
            }, label);
          }),
        ),
      ),

      // Agent filter chips
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 } },
        ['all', ...allAgentIds].map(id => {
          const active = this.state.agentFilter === id;
          return React.createElement('button', {
            key: id, onClick: () => this.setState({ agentFilter: id }),
            style: {
              padding: '5px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              background: active ? 'rgba(53,208,197,0.14)' : 'var(--ag-bg-inset)',
              color: active ? 'var(--ag-teal)' : 'var(--ag-text-secondary)',
              border: `1px solid ${active ? 'rgba(53,208,197,0.4)' : 'var(--ag-border)'}`,
            },
          }, id === 'all' ? 'All agents' : formatAgentName(id));
        }),
      ),

      // Result count
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', marginBottom: 16 } },
        `${filtered.length} events${pendingCount > 0 ? ` • ${pendingCount} need your review` : ''}`,
      ),

      // Day groups
      ...Array.from(grouped.entries()).map(([day, dayEvents]) =>
        React.createElement('div', { key: day, style: { marginBottom: 24 } },
          // Day header
          React.createElement('div', {
            style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 8 },
          }, `${formatDayLabel(day)} · ${dayEvents.length}`),
          // Events card
          React.createElement('div', {
            style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, overflow: 'hidden' },
          }, ...dayEvents.map(e => this.renderRow(e))),
        ),
      ),

      grouped.size === 0 && React.createElement('div', {
        style: { textAlign: 'center', padding: '60px 0', color: 'var(--ag-text-muted)' },
      }, 'No events match the current filters.'),
    );
  }
}
