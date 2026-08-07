import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { fetchScopeSites, ScopeSite } from './fetchScopeSites';
import { SitePicker, selectedProductionCount, productionWarningVerb } from './SitePicker';
import type { AgentScope } from './AgentStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModalProps {
  agentName: string;       // e.g. "Security Sentinel"
  agentId: string;         // e.g. "security-sentinel"
  electron: any;           // Electron IPC — same pattern as NexusOverview
  supportsFullRun: boolean;
  allowsProduction: boolean;
  /** Drives the production-warning verb: "scanned" (readonly) vs "modified" (writes). */
  effect: 'readonly' | 'writes';
  /** The agent's persisted schedule/event scope. Undefined = never configured. */
  scheduleScope?: AgentScope;
  onCancel: () => void;
  onRun: (siteNames: string[]) => void;
}

interface ModalState {
  isRunning: boolean;
  loading: boolean;
  sites: ScopeSite[];
  selection: Set<string>;
  fullRun: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export class AgentRunModal extends React.Component<ModalProps, ModalState> {
  state: ModalState = {
    loading: true,
    isRunning: false,
    sites: [],
    selection: new Set(),
    fullRun: false,
  };

  async componentDidMount() {
    const sites = await fetchScopeSites(this.props.electron);
    this.setState({ sites, loading: false, selection: this.initialSelection(sites) });
  }

  /**
   * Run now prefill: copy the schedule scope into a run-local selection. When no schedule scope
   * has ever been saved (a brand-new agent), fall back to non-production sites — the same
   * default the modal used before scope was configurable at all.
   */
  private initialSelection(sites: ScopeSite[]): Set<string> {
    const { scheduleScope, allowsProduction } = this.props;
    if (scheduleScope?.siteIds?.length) {
      const bySite = new Map(sites.map(s => [s.id, s]));
      return new Set(scheduleScope.siteIds.filter(id => {
        const site = bySite.get(id);
        return !site || allowsProduction || site.environment !== 'production';
      }));
    }
    // No saved scope to prefill from — default to non-production regardless of policy.
    // allowsProduction governs whether production CAN be selected, not whether it's
    // pre-selected; the safe default has always excluded it either way.
    return new Set(sites.filter(s => s.environment !== 'production').map(s => s.id));
  }

  private resetToScheduleScope = (): void => {
    this.setState({ selection: this.initialSelection(this.state.sites) });
  };

  /** Added/removed vs the schedule scope — computed live, never stored, per the design's state
   * management rules (delta is derived, not persisted with the run-local selection). */
  private getDelta(): { added: number; removed: number; modified: boolean } {
    const scheduleIds = new Set(this.props.scheduleScope?.siteIds ?? []);
    const current = this.state.selection;
    let added = 0, removed = 0;
    for (const id of current) if (!scheduleIds.has(id)) added++;
    for (const id of scheduleIds) if (!current.has(id)) removed++;
    return { added, removed, modified: added > 0 || removed > 0 };
  }

  private async handleRun() {
    if (this.state.isRunning) return;
    this.setState({ isRunning: true });
    const { onRun, electron, agentId } = this.props;
    const bySite = new Map(this.state.sites.map(s => [s.id, s]));
    const toRun = [...this.state.selection].map(id => bySite.get(id)?.name).filter((n): n is string => !!n);

    try {
      await electron.ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_NOW, {
        agentId,
        siteNames: toRun,
        fullRun: this.state.fullRun,
      });
    } catch (err) {
      console.warn('[AgentRunModal] run-now IPC failed:', err);
    }

    onRun(toRun); // close the modal
  }

  render() {
    const { agentName, allowsProduction, effect, onCancel, supportsFullRun } = this.props;
    const { loading, sites, selection, fullRun, isRunning } = this.state;
    const { added, removed, modified } = this.getDelta();
    const scheduleCount = this.props.scheduleScope?.siteIds?.length ?? 0;
    const prodCount = selectedProductionCount(sites, selection);
    const hasProd = prodCount > 0;
    const warningSentence = hasProd
      ? `${prodCount} live production site${prodCount === 1 ? '' : 's'} will be ${productionWarningVerb(effect)}.`
      : null;

    return React.createElement('div', null,
      React.createElement('div', {
        onClick: onCancel,
        style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.6)', zIndex: 50 },
      }),

      React.createElement('div', {
        style: {
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          background: '#0f141d', border: '1px solid #232c38', borderRadius: 18,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)', zIndex: 51, overflow: 'hidden',
        },
      },

        // Header
        React.createElement('div', { style: { padding: '22px 24px 18px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
            React.createElement('div', {
              style: { width: 38, height: 38, borderRadius: 11, background: 'rgba(53,224,197,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
            }, React.createElement('span', { style: { fontSize: 16, color: '#35e0c5' } }, '▶')),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 20, fontWeight: 800, color: 'var(--ag-text-primary)', marginBottom: 3 } }, `Run ${agentName} now`),
              React.createElement('div', { style: { fontSize: 14, color: '#8a94a2' } }, 'Runs once, immediately. Does not change the schedule.'),
              supportsFullRun && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } },
                React.createElement('div', {
                  onClick: () => this.setState(s => ({ fullRun: !s.fullRun })),
                  style: { width: 40, height: 22, borderRadius: 999, cursor: 'pointer', position: 'relative', background: fullRun ? '#22c088' : '#2a3441' },
                },
                  React.createElement('div', { style: { position: 'absolute', top: 3, left: fullRun ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' } }),
                ),
                React.createElement('span', { style: { fontSize: 14, color: 'var(--ag-text-secondary)' } }, 'Always do full run'),
              ),
            ),
            React.createElement('button', {
              onClick: onCancel,
              style: { background: 'none', border: 'none', color: '#6b7684', cursor: 'pointer', fontSize: 20, padding: 4, lineHeight: 1 },
            }, '×'),
          ),
        ),

        // Prefill banner
        !loading && React.createElement('div', { style: { padding: '0 24px 18px' } },
          React.createElement('div', {
            style: { background: 'rgba(53,224,197,0.07)', border: '1px solid rgba(53,224,197,0.24)', borderRadius: 11, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
          },
            React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-text-secondary)' } },
              modified
                ? `Changed for this run only — ${added} added, ${removed} removed vs. the schedule scope.`
                : scheduleCount > 0
                  ? `Prefilled from this agent's schedule scope (${scheduleCount} sites).`
                  : 'No schedule scope saved yet — starting from non-production sites.',
            ),
            modified && React.createElement('button', {
              onClick: this.resetToScheduleScope,
              style: { fontSize: 13, fontWeight: 600, color: '#9aa4b2', background: 'transparent', border: '1px solid #2a3441', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
            }, 'Reset to schedule scope'),
          ),
        ),

        // Picker
        React.createElement('div', { style: { padding: '0 24px', flex: 1, overflow: 'hidden', display: 'flex' } },
          loading
            ? React.createElement('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--ag-text-muted)', width: '100%' } }, 'Loading sites…')
            : React.createElement(SitePicker, {
                sites,
                selection,
                onChange: (next: Set<string>) => this.setState({ selection: next }),
                allowsProduction,
              }),
        ),

        // Footer — the production warning sentence takes over the note slot and tints the whole
        // bar (escalation signal 3); the primary button turns red (signal 4). Neither blocks.
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px', borderTop: '1px solid #1c232e',
            background: hasProd ? 'rgba(255,107,122,0.07)' : '#0d1119',
            ...(hasProd ? { borderTop: '1px solid rgba(255,107,122,0.24)' } : {}),
          },
        },
          React.createElement('span', {
            style: { flex: 1, fontSize: 13, fontWeight: hasProd ? 600 : 400, color: hasProd ? '#ff8a95' : '#7b8593' },
          },
            warningSentence
              ?? (modified ? 'This selection applies to this run only. Save it to the schedule from Settings.' : 'Same sites the schedule uses.'),
          ),
          React.createElement('button', {
            onClick: onCancel,
            style: { padding: '10px 20px', borderRadius: 9, border: '1px solid var(--ag-border)', background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => this.handleRun(),
            disabled: selection.size === 0 || isRunning,
            style: {
              padding: '10px 22px', borderRadius: 9, border: 'none', fontSize: 13.5, fontWeight: 700,
              cursor: selection.size === 0 ? 'not-allowed' : 'pointer',
              background: selection.size === 0 ? 'var(--ag-bg-elevated)' : hasProd ? '#ff8a95' : '#35e0c5',
              color: selection.size === 0 ? 'var(--ag-text-faint)' : '#0b0e14',
            },
          }, `Run on ${selection.size} site${selection.size === 1 ? '' : 's'}`),
        ),
      ),
    );
  }
}
