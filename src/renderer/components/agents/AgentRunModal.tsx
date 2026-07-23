import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteEnv = 'production' | 'staging' | 'development' | 'local';

interface SiteForRun {
  id: string;
  name: string;
  displayName: string;
  account: string;
  environment: SiteEnv;
}

interface ModalProps {
  agentName: string;       // e.g. "Security Sentinel"
  agentId: string;         // e.g. "security-sentinel"
  electron: any;           // Electron IPC — same pattern as NexusOverview
  supportsFullRun: boolean;
  onCancel: () => void;
  onRun: (siteNames: string[]) => void;
}

interface ModalState {
  isRunning: boolean;
  sites: SiteForRun[];
  selected: Set<string>;
  searchText: string;
  accountFilter: string;   // 'all' | 'wpe' | 'local' | account name
  loading: boolean;
  includeProd: boolean;
  fullRun: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ENV_COLORS: Record<SiteEnv, { bg: string; color: string; label: string }> = {
  production:  { bg: 'rgba(244,104,95,0.16)',  color: '#f4685f', label: 'PROD' },
  staging:     { bg: 'rgba(245,181,68,0.16)',  color: '#f5b544', label: 'STAGING' },
  development: { bg: 'rgba(123,140,255,0.16)', color: '#7b8cff', label: 'DEV' },
  local:       { bg: 'rgba(53,208,197,0.16)',  color: '#35d0c5', label: 'LOCAL' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export class AgentRunModal extends React.Component<ModalProps, ModalState> {
  state: ModalState = {
    sites: [],
    selected: new Set(),
    searchText: '',
    accountFilter: 'all',
    loading: true,
    isRunning: false,
    includeProd: false,
    fullRun: false,
  };

  async componentDidMount() {
    await this.loadSites();
  }

  private async loadSites() {
    const { electron } = this.props;
    const ipc = electron.ipcRenderer;
    const sites: SiteForRun[] = [];

    // WPE installs — returns { success, sites: Site[] } where Site has name, environment, account_id
    try {
      const wpeResult = await ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES).catch(() => null);
      const wpeSites: any[] = wpeResult?.sites || [];
      for (const s of wpeSites) {
        const name: string = s.name || '';
        const env = (s.environment || 'production') as SiteEnv;
        if (!name) continue;
        sites.push({ id: s.id || name, name, displayName: name, account: s.account_id || 'WP Engine', environment: env });
      }
    } catch {}

    // Local sites — returns Site[] directly with { id, name, status, ... }
    try {
      const localSites: any[] = await ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []);
      for (const s of (localSites || [])) {
        const name: string = s.name || '';
        if (!name || name.startsWith('sentinel-')) continue; // skip sentinel sandboxes
        sites.push({ id: s.id || name, name, displayName: name, account: 'Local sites', environment: 'local' });
      }
    } catch {}

    // C1: Default selection — non-production only
    const selected = new Set(sites.filter(s => s.environment !== 'production').map(s => s.id));
    this.setState({ sites, selected, loading: false });
  }

  private getFiltered(): SiteForRun[] {
    const { sites, searchText, accountFilter } = this.state;
    return sites.filter(s => {
      if (searchText && !s.name.includes(searchText.toLowerCase()) && !s.displayName.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (accountFilter === 'all') return true;
      if (accountFilter === 'wpe') return s.environment !== 'local';
      if (accountFilter === 'local') return s.environment === 'local';
      return s.account === accountFilter;
    });
  }

  private getAccounts(): Array<{ id: string; label: string; count: number }> {
    const { sites } = this.state;
    let wpe = 0, local = 0;
    for (const s of sites) {
      if (s.environment === 'local') local++;
      else wpe++;
    }
    return [
      { id: 'all',   label: `All sites (${sites.length})`, count: sites.length },
      { id: 'wpe',   label: `WP Engine (${wpe})`,          count: wpe },
      { id: 'local', label: `Local (${local})`,            count: local },
    ];
  }

  private toggleSite(id: string) {
    this.setState(s => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    });
  }

  private clearAll() {
    this.setState({ selected: new Set() });
  }

  private async handleRun() {
    if (this.state.isRunning) return;
    this.setState({ isRunning: true });
    const { onRun, electron, agentId } = this.props;
    const filtered = this.getFiltered();
    const toRun = filtered.filter(s => this.state.selected.has(s.id)).map(s => s.name);

    // C3: Pass fullRun in IPC call
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
    const { agentName, onCancel } = this.props;
    const { searchText, accountFilter, selected, loading, includeProd, fullRun } = this.state;
    const filtered = this.getFiltered();
    const selectedCount = filtered.filter(s => selected.has(s.id)).length;
    const accounts = this.getAccounts();

    const chipStyle = (active: boolean): React.CSSProperties => ({
      padding: '5px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 500,
      cursor: 'pointer', border: 'none', whiteSpace: 'nowrap' as const,
      background: active ? 'rgba(53,208,197,0.14)' : 'var(--ag-bg-inset)',
      color: active ? 'var(--ag-teal)' : 'var(--ag-text-secondary)',
      outline: active ? '1px solid rgba(53,208,197,0.4)' : '1px solid var(--ag-border)',
    });

    return React.createElement('div', null,
      // Scrim
      React.createElement('div', {
        onClick: onCancel,
        style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.6)', zIndex: 50 },
      }),

      // Modal
      React.createElement('div', {
        style: {
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderRadius: 16, zIndex: 51, animation: 'fadeUp 0.2s ease', overflow: 'hidden',
        },
      },

        // Header
        React.createElement('div', { style: { padding: '22px 24px 18px', borderBottom: '1px solid var(--ag-border-subtle)' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 } },
            React.createElement('div', {
              style: { width: 40, height: 40, borderRadius: 10, background: 'rgba(53,208,197,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
            },
              React.createElement('span', { style: { fontSize: 18, color: 'var(--ag-teal)' } }, '▶'),
            ),
            // C4: Updated subtitle + fullRun toggle
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 18, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 3 } },
                `Run ${agentName} now`,
              ),
              React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-secondary)' } },
                'Non-production sites are selected by default.',
              ),
              // C4: "Always do full run" toggle — only when supportsFullRun
              this.props.supportsFullRun && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } },
                React.createElement('div', {
                  onClick: () => this.setState(s => ({ fullRun: !s.fullRun })),
                  style: {
                    width: 46, height: 26, borderRadius: 999, cursor: 'pointer', position: 'relative' as const,
                    background: fullRun ? 'var(--ag-teal)' : '#2a323e', transition: 'background .15s',
                  },
                },
                  React.createElement('div', {
                    style: {
                      position: 'absolute' as const, top: 3, left: fullRun ? 23 : 3,
                      width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s',
                    },
                  }),
                ),
                React.createElement('span', { style: { fontSize: 14, color: 'var(--ag-text-secondary)' } }, 'Always do full run'),
              ),
            ),
            React.createElement('button', {
              onClick: onCancel,
              style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 },
            }, '✕'),
          ),

          // C4: Search + "Select non-prod" button (replaces Select all / Clear)
          React.createElement('div', { style: { display: 'flex', gap: 10, marginBottom: 10 } },
            React.createElement('input', {
              type: 'text', placeholder: 'Search sites…',
              value: searchText,
              onChange: (e: any) => this.setState({ searchText: e.target.value }),
              style: {
                flex: 1, background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)',
                borderRadius: 9, padding: '9px 14px', fontSize: 13, color: 'var(--ag-text-primary)',
              },
            }),
            React.createElement('button', {
              onClick: () => {
                const nonProd = this.state.sites.filter(s => s.environment !== 'production').map(s => s.id);
                this.setState({ selected: new Set(nonProd), includeProd: false });
              },
              style: { padding: '9px 16px', borderRadius: 9, border: '1px solid var(--ag-border)', background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)', fontSize: 13, cursor: 'pointer' },
            }, 'Select non-prod'),
          ),

          // C4: "Include production sites" checkbox row
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 4 } },
            React.createElement('div', {
              onClick: () => {
                const next = !this.state.includeProd;
                this.setState(s => {
                  const newSel = new Set(s.selected);
                  s.sites.forEach(site => {
                    if (site.environment === 'production') {
                      if (next) newSel.add(site.id);
                      else newSel.delete(site.id);
                    }
                  });
                  return { includeProd: next, selected: newSel };
                });
              },
              style: {
                width: 22, height: 22, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `2px solid ${includeProd ? '#f2666e' : '#3a4452'}`,
                background: includeProd ? '#f2666e' : 'transparent',
                color: '#2a0f11', fontWeight: 800, fontSize: 13,
              },
            }, includeProd ? '✓' : ''),
            React.createElement('span', { style: { fontSize: 14, color: includeProd ? 'var(--ag-text-primary)' : 'var(--ag-text-secondary)' } },
              'Include production sites ',
              React.createElement('span', { style: { fontSize: 12, color: '#f2666e', fontWeight: 700 } }, '— use with care'),
            ),
          ),

          // Filter chips (below include-prod checkbox)
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 14 } },
            ...accounts.map(a =>
              React.createElement('button', {
                key: a.id, onClick: () => this.setState({ accountFilter: a.id }),
                style: chipStyle(accountFilter === a.id),
              }, a.label),
            ),
          ),
        ),

        // Site list
        React.createElement('div', { style: { flex: 1, overflowY: 'auto' as const } },

          // Result count
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', padding: '10px 24px', fontSize: 12.5, color: 'var(--ag-text-muted)', borderBottom: '1px solid var(--ag-border-subtle)' },
          },
            React.createElement('span', null, `${filtered.length} shown`),
            React.createElement('button', {
              onClick: () => this.clearAll(),
              style: { background: 'none', border: 'none', color: 'var(--ag-teal)', fontSize: 12.5, cursor: 'pointer', padding: 0 },
            }, 'Clear these'),
          ),

          loading
            ? React.createElement('div', { style: { padding: '40px', textAlign: 'center' as const, color: 'var(--ag-text-muted)' } }, 'Loading sites…')
            : React.createElement('div', null,
                ...filtered.map((site, i) => {
                  const isSelected = selected.has(site.id);
                  const envInfo = ENV_COLORS[site.environment];
                  return React.createElement('div', {
                    key: site.id,
                    onClick: () => this.toggleSite(site.id),
                    style: {
                      display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px',
                      cursor: 'pointer', borderBottom: i < filtered.length - 1 ? '1px solid var(--ag-border-subtle)' : 'none',
                      background: isSelected ? 'rgba(53,208,197,0.04)' : 'transparent',
                    },
                  },
                    // Checkbox
                    React.createElement('div', {
                      className: `ag-checkbox ${isSelected ? 'ag-checkbox--checked' : ''}`,
                      style: { flexShrink: 0 },
                    }, isSelected ? '✓' : ''),

                    // Name + account
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)' } }, site.displayName),
                      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, site.account),
                    ),

                    // C4: No status badge — env pill only
                    // Env pill
                    React.createElement('span', {
                      style: { fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 5, background: envInfo.bg, color: envInfo.color, flexShrink: 0 },
                    }, envInfo.label),
                  );
                }),
              ),
        ),

        // Footer
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderTop: '1px solid var(--ag-border-subtle)', background: 'var(--ag-bg-card)' },
        },
          React.createElement('span', { style: { flex: 1, fontSize: 13, color: 'var(--ag-text-muted)' } },
            `${selectedCount} of ${filtered.length} sites selected`,
          ),
          React.createElement('button', {
            onClick: onCancel,
            style: { padding: '10px 20px', borderRadius: 9, border: '1px solid var(--ag-border)', background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => this.handleRun(),
            disabled: selectedCount === 0 || this.state.isRunning,
            style: {
              padding: '10px 22px', borderRadius: 9, border: 'none', fontSize: 13.5, fontWeight: 600, cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
              background: selectedCount === 0 ? 'var(--ag-bg-elevated)' : 'var(--ag-teal)',
              color: selectedCount === 0 ? 'var(--ag-text-faint)' : 'var(--ag-on-teal)',
              display: 'flex', alignItems: 'center', gap: 8,
            },
          },
            React.createElement('span', null, '▶'),
            selectedCount === filtered.length
              ? `Run on all ${selectedCount} sites`
              : `Run on ${selectedCount} selected`,
          ),
        ),
      ),
    );
  }
}
