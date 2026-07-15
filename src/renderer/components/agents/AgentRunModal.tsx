import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IPC_CHANNELS } from '../../common/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteEnv = 'production' | 'staging' | 'development' | 'local';
type SiteStatus = 'active-threat' | 'needs-review' | null;

interface SiteForRun {
  id: string;
  name: string;
  displayName: string;
  account: string;
  environment: SiteEnv;
  status: SiteStatus;
}

interface ModalProps {
  agentName: string;       // e.g. "Security Sentinel"
  agentId: string;         // e.g. "security-sentinel"
  electron: any;           // Electron IPC — same pattern as NexusOverview
  onCancel: () => void;
  onRun: (siteNames: string[]) => void;
}

interface ModalState {
  sites: SiteForRun[];
  selected: Set<string>;
  searchText: string;
  accountFilter: string;   // 'all' | 'wpe' | 'local' | account name
  loading: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSentinelStatus(siteName: string): SiteStatus {
  const reportsDir = path.join(
    os.homedir(), 'Library', 'Application Support', 'Local',
    'nexus-ai', 'agents', 'security-sentinel', 'reports', siteName,
  );
  try {
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (!files.length) return null;
    const content = fs.readFileSync(path.join(reportsDir, files[0]), 'utf-8');
    if (content.includes('NOT SAFE TO PUSH') || content.includes('CRITICAL')) return 'active-threat';
    if (content.includes('READY TO PUSH') || content.includes('[HIGH]')) return 'needs-review';
    return null;
  } catch { return null; }
}

const ENV_COLORS: Record<SiteEnv, { bg: string; color: string; label: string }> = {
  production:  { bg: 'rgba(244,104,95,0.16)',  color: '#f4685f', label: 'PROD' },
  staging:     { bg: 'rgba(245,181,68,0.16)',  color: '#f5b544', label: 'STAGING' },
  development: { bg: 'rgba(123,140,255,0.16)', color: '#7b8cff', label: 'DEV' },
  local:       { bg: 'rgba(53,208,197,0.16)',  color: '#35d0c5', label: 'LOCAL' },
};

const STATUS_STYLES: Record<NonNullable<SiteStatus>, { bg: string; color: string; label: string }> = {
  'active-threat':  { bg: 'rgba(244,104,95,0.14)',  color: '#f4685f', label: 'Active threat' },
  'needs-review':   { bg: 'rgba(245,181,68,0.14)',  color: '#f5b544', label: 'Needs review' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export class AgentRunModal extends React.Component<ModalProps, ModalState> {
  state: ModalState = {
    sites: [],
    selected: new Set(),
    searchText: '',
    accountFilter: 'all',
    loading: true,
  };

  async componentDidMount() {
    await this.loadSites();
  }

  private async loadSites() {
    const { electron } = this.props;
    const ipc = electron.ipcRenderer;
    const sites: SiteForRun[] = [];

    // WPE installs via existing IPC channel (same as NexusOverview)
    try {
      const wpeSites = await ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES).catch(() => []);
      for (const s of (wpeSites || [])) {
        const name: string = s.name || s.installName || '';
        const env = (s.environment || 'production') as SiteEnv;
        const account: string = s.accountName || s.account || 'WP Engine';
        if (!name) continue;
        sites.push({ id: s.id || name, name, displayName: name, account, environment: env, status: getSentinelStatus(name) });
      }
    } catch {}

    // Local sites via existing IPC channel (same as NexusOverview)
    try {
      const localSites = await ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []);
      for (const s of (localSites || [])) {
        const name: string = s.name || '';
        if (!name) continue;
        sites.push({ id: s.id || name, name, displayName: name, account: 'Local sites', environment: 'local', status: getSentinelStatus(name) });
      }
    } catch {}

    const selected = new Set(sites.map(s => s.id));
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
    const counts: Record<string, number> = { all: sites.length, wpe: 0, local: 0 };
    const accountCounts: Record<string, number> = {};
    for (const s of sites) {
      if (s.environment === 'local') counts.local++;
      else counts.wpe++;
      accountCounts[s.account] = (accountCounts[s.account] || 0) + 1;
    }
    const chips = [
      { id: 'all', label: `All sites (${counts.all})`, count: counts.all },
      { id: 'wpe', label: `WP Engine (${counts.wpe})`, count: counts.wpe },
      { id: 'local', label: `Local (${counts.local})`, count: counts.local },
    ];
    for (const [account, count] of Object.entries(accountCounts)) {
      chips.push({ id: account, label: `${account} (${count})`, count });
    }
    return chips;
  }

  private toggleSite(id: string) {
    this.setState(s => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    });
  }

  private selectAll() {
    this.setState(s => ({ selected: new Set(this.getFiltered().map(site => site.id)) }));
  }

  private clearAll() {
    this.setState({ selected: new Set() });
  }

  private handleRun() {
    const { onRun } = this.props;
    const filtered = this.getFiltered();
    const toRun = filtered.filter(s => this.state.selected.has(s.id)).map(s => s.name);
    onRun(toRun);
  }

  render() {
    const { agentName, onCancel } = this.props;
    const { searchText, accountFilter, selected, loading } = this.state;
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
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 18, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 3 } },
                `Run ${agentName} now`,
              ),
              React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-secondary)' } },
                'Runs against WP Engine and local sites. All are selected by default.',
              ),
            ),
            React.createElement('button', {
              onClick: onCancel,
              style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 },
            }, '✕'),
          ),

          // Search + action buttons
          React.createElement('div', { style: { display: 'flex', gap: 10, marginBottom: 14 } },
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
              onClick: () => this.selectAll(),
              style: { padding: '9px 16px', borderRadius: 9, border: '1px solid var(--ag-border)', background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)', fontSize: 13, cursor: 'pointer' },
            }, 'Select all'),
            React.createElement('button', {
              onClick: () => this.clearAll(),
              style: { padding: '9px 16px', borderRadius: 9, border: '1px solid var(--ag-border)', background: 'var(--ag-bg-elevated)', color: 'var(--ag-text-secondary)', fontSize: 13, cursor: 'pointer' },
            }, 'Clear'),
          ),

          // Filter chips
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } },
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
                  const statusInfo = site.status ? STATUS_STYLES[site.status] : null;
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

                    // Status badge
                    statusInfo && React.createElement('span', {
                      style: { fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: statusInfo.bg, color: statusInfo.color, flexShrink: 0 },
                    }, statusInfo.label),

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
            disabled: selectedCount === 0,
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
