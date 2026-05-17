/**
 * SystemTab — Temporary debug/inspection tab for the Nexus dashboard.
 *
 * Shows the real-time state of each local site across all three data stores:
 *   1. Content Index  (IndexRegistry: state, docs, last indexed)
 *   2. Metadata Cache (SiteMetadataCache: WP version, plugins, age)
 *   3. Live Events    (INDEX_PROGRESS IPC stream)
 *
 * Actions per site: Re-index, Refresh Metadata.
 *
 * Class-based, React.createElement only — no JSX, no hooks (Local React).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';

interface IndexEntry {
  siteId: string;
  siteName: string;
  state: string;
  documentCount?: number;
  chunkCount?: number;
  lastIndexed?: number;
  durationMs?: number;
  errors?: string[];
}

interface SiteMetadata {
  wpVersion?: string;
  phpVersion?: string;
  plugins?: Array<{ name: string; status: string }>;
  themes?: Array<{ name: string; status: string }>;
  activeTheme?: string;
  postCount?: number;
  updateSource?: string;
  scanDepth?: string;
  lastUpdated?: number;
}

interface LiveEvent {
  ts: number;
  siteId: string;
  siteName: string;
  state: string;
  progress?: number;
  message?: string;
}

interface SystemTabProps {
  electron: any;
  sites: Array<{ id: string; name: string; status: string }>;
  indexEntries: IndexEntry[];
}

interface SystemTabState {
  siteMetadata: Record<string, { metadata: SiteMetadata | null; ageString: string | null }>;
  liveProgress: Record<string, { state: string; progress: number; message: string }>;
  events: LiveEvent[];
  loading: boolean;
  actionInProgress: Record<string, string>; // siteId → 'indexing' | 'refreshing'
}

const MAX_EVENTS = 50;

export class SystemTab extends React.Component<SystemTabProps, SystemTabState> {
  private mounted = false;
  private _progressHandler: ((_: any, data: any) => void) | null = null;

  state: SystemTabState = {
    siteMetadata: {},
    liveProgress: {},
    events: [],
    loading: true,
    actionInProgress: {},
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadAllMetadata();

    const ipc = this.props.electron.ipcRenderer;
    this._progressHandler = (_: any, data: any) => {
      if (!this.mounted) return;
      const site = this.props.sites.find(s => s.id === data.siteId);
      this.setState(prev => ({
        liveProgress: {
          ...prev.liveProgress,
          [data.siteId]: { state: data.state, progress: data.progress ?? 0, message: data.message ?? '' },
        },
        events: [
          { ts: Date.now(), siteId: data.siteId, siteName: site?.name ?? data.siteId, state: data.state, progress: data.progress, message: data.message },
          ...prev.events,
        ].slice(0, MAX_EVENTS),
      }));
    };
    ipc.on(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this._progressHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
    }
  }

  async loadAllMetadata(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const results: SystemTabState['siteMetadata'] = {};
    await Promise.all(
      this.props.sites.map(async (site) => {
        try {
          const res = await ipc.invoke(IPC_CHANNELS.GET_SITE_METADATA, site.id);
          results[site.id] = {
            metadata: res?.metadata?.metadata ?? null,
            ageString: res?.ageString ?? null,
          };
        } catch {
          results[site.id] = { metadata: null, ageString: null };
        }
      }),
    );
    if (this.mounted) this.setState({ siteMetadata: results, loading: false });
  }

  handleReindex = async (siteId: string): Promise<void> => {
    this.setState(prev => ({ actionInProgress: { ...prev.actionInProgress, [siteId]: 'indexing' } }));
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, { siteId, force: true });
    } catch { /* errors surface via INDEX_PROGRESS events */ }
    if (this.mounted) {
      this.setState(prev => {
        const next = { ...prev.actionInProgress };
        delete next[siteId];
        return { actionInProgress: next };
      });
    }
  };

  handleRefreshMetadata = async (siteId: string): Promise<void> => {
    this.setState(prev => ({ actionInProgress: { ...prev.actionInProgress, [siteId]: 'refreshing' } }));
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.REFRESH_SITE_METADATA, siteId);
      // Reload metadata for this site
      const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SITE_METADATA, siteId);
      if (this.mounted) {
        this.setState(prev => ({
          siteMetadata: {
            ...prev.siteMetadata,
            [siteId]: { metadata: res?.metadata?.metadata ?? null, ageString: res?.ageString ?? null },
          },
        }));
      }
    } catch { /* ignore */ }
    if (this.mounted) {
      this.setState(prev => {
        const next = { ...prev.actionInProgress };
        delete next[siteId];
        return { actionInProgress: next };
      });
    }
  };

  formatTs(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  formatAge(ts?: number): string {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  stateColor(state: string): string {
    if (state === 'indexed') return '#51BB7B';
    if (state === 'indexing') return '#0ECAD4';
    if (state === 'error') return '#ef4444';
    if (state === 'stale') return '#f59e0b';
    return '#6b7280';
  }

  renderSiteCard(site: { id: string; name: string; status: string }): React.ReactNode {
    const entry = this.props.indexEntries.find(e => e.siteId === site.id);
    const live = this.state.liveProgress[site.id];
    const meta = this.state.siteMetadata[site.id];
    const action = this.state.actionInProgress[site.id];

    const indexState = live?.state ?? entry?.state ?? 'idle';
    const stateCol = this.stateColor(indexState);
    const isRunning = site.status === 'running';

    const card: React.CSSProperties = {
      background: 'var(--nxai-code-bg, #1f1f1f)',
      border: '1px solid var(--nxai-card-border, #30363d)',
      borderRadius: 8,
      marginBottom: 10,
      overflow: 'hidden',
    };

    const row: React.CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '9px 14px',
      borderBottom: '1px solid rgba(42,47,61,0.5)',
      fontSize: 12,
    };

    const label: React.CSSProperties = { color: '#555', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em', minWidth: 90, paddingTop: 1 };
    const val: React.CSSProperties = { color: 'var(--nxai-card-text, #e6edf3)', flex: 1 };
    const muted: React.CSSProperties = { color: '#555', fontSize: 11 };

    // Progress bar if indexing
    const showProgress = indexState === 'indexing' && live;
    const progress = live?.progress ?? 0;

    return React.createElement('div', { key: site.id, style: card },

      // ── Site header ──────────────────────────────────────────
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(255,255,255,0.02)' } },
        React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: isRunning ? '#51BB7B' : '#333', flexShrink: 0 } }),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, flex: 1 } }, site.name),
        React.createElement('span', { style: { fontSize: 10, color: isRunning ? '#51BB7B' : '#555' } }, isRunning ? 'running' : 'halted'),
      ),

      // ── Progress bar (live) ──────────────────────────────────
      showProgress ? React.createElement('div', { style: { padding: '0 14px 0', background: 'rgba(14,202,212,0.03)' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 11 } },
          React.createElement('div', { style: { flex: 1, background: '#222', borderRadius: 2, height: 3, overflow: 'hidden' } },
            React.createElement('div', { style: { width: `${progress}%`, height: '100%', background: '#0ECAD4', borderRadius: 2, transition: 'width 0.3s' } }),
          ),
          React.createElement('span', { style: { color: '#0ECAD4', minWidth: 32, textAlign: 'right' as const } }, `${progress}%`),
        ),
        live?.message ? React.createElement('div', { style: { ...muted, paddingBottom: 6 } }, live.message) : null,
      ) : null,

      // ── Content Index row ────────────────────────────────────
      React.createElement('div', { style: row },
        React.createElement('span', { style: label }, 'Index'),
        React.createElement('div', { style: val },
          React.createElement('span', { style: { color: stateCol, fontWeight: 600 } }, indexState),
          entry?.documentCount ? React.createElement('span', { style: { ...muted, marginLeft: 8 } }, `${entry.documentCount} docs · ${entry.chunkCount ?? '?'} chunks`) : null,
          React.createElement('br'),
          React.createElement('span', { style: muted },
            entry?.lastIndexed ? `last: ${this.formatAge(entry.lastIndexed)}` : 'never indexed',
            entry?.durationMs ? ` (${(entry.durationMs / 1000).toFixed(1)}s)` : '',
          ),
          entry?.errors?.length ? React.createElement('div', { style: { color: '#ef4444', fontSize: 11, marginTop: 2 } }, `${entry.errors.length} error(s): ${entry.errors[0]}`) : null,
        ),
      ),

      // ── Metadata Cache row ───────────────────────────────────
      React.createElement('div', { style: row },
        React.createElement('span', { style: label }, 'Metadata'),
        React.createElement('div', { style: val },
          meta?.metadata
            ? React.createElement('div', null,
                React.createElement('span', null,
                  meta.metadata.wpVersion ? `WP ${meta.metadata.wpVersion}` : 'WP ?',
                  meta.metadata.phpVersion ? ` · PHP ${meta.metadata.phpVersion}` : '',
                  meta.metadata.plugins ? ` · ${meta.metadata.plugins.length} plugins` : '',
                  meta.metadata.activeTheme ? ` · ${meta.metadata.activeTheme}` : '',
                ),
                React.createElement('br'),
                React.createElement('span', { style: muted },
                  meta.metadata.postCount !== undefined ? `${meta.metadata.postCount} posts · ` : '',
                  meta.ageString ?? this.formatAge(meta.metadata.lastUpdated),
                  meta.metadata.updateSource ? ` via ${meta.metadata.updateSource}` : '',
                  meta.metadata.scanDepth ? ` (${meta.metadata.scanDepth})` : '',
                ),
              )
            : React.createElement('span', { style: muted }, this.state.loading ? 'loading…' : 'no cache — start site to populate'),
        ),
      ),

      // ── Actions row ──────────────────────────────────────────
      React.createElement('div', { style: { ...row, borderBottom: 'none', gap: 8, flexWrap: 'wrap' as const } },
        React.createElement('span', { style: label }, 'Actions'),
        React.createElement('button', {
          disabled: !!action,
          onClick: () => this.handleReindex(site.id),
          style: {
            padding: '4px 10px', borderRadius: 5, border: '1px solid var(--nxai-card-border, #30363d)',
            background: 'var(--nxai-card-bg, #21262d)', color: action === 'indexing' ? '#0ECAD4' : 'inherit',
            fontSize: 11, cursor: action ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: action ? 0.6 : 1,
          },
        }, action === 'indexing' ? '⏳ Indexing…' : '⚡ Re-index'),
        React.createElement('button', {
          disabled: !!action || !isRunning,
          onClick: () => this.handleRefreshMetadata(site.id),
          title: isRunning ? 'Refresh metadata via WP-CLI' : 'Site must be running',
          style: {
            padding: '4px 10px', borderRadius: 5, border: '1px solid var(--nxai-card-border, #30363d)',
            background: 'var(--nxai-card-bg, #21262d)', color: action === 'refreshing' ? '#51BB7B' : 'inherit',
            fontSize: 11, cursor: (action || !isRunning) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: (action || !isRunning) ? 0.5 : 1,
          },
        }, action === 'refreshing' ? '⏳ Refreshing…' : '🔄 Refresh Metadata'),
      ),
    );
  }

  renderEventLog(): React.ReactNode {
    const { events } = this.state;

    return React.createElement('div', {
      style: { background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' },
    },
      React.createElement('div', { style: { padding: '8px 14px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--nxai-card-border, #30363d)', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' } },
        'Live Events',
        React.createElement('span', { style: { marginLeft: 8, color: '#333', fontWeight: 400 } }, '— INDEX_PROGRESS stream'),
      ),
      events.length === 0
        ? React.createElement('div', { style: { padding: '16px 14px', fontSize: 12, color: '#333', fontStyle: 'italic' } }, 'No events yet — start a site or trigger re-index to see events here.')
        : React.createElement('div', { style: { maxHeight: 280, overflowY: 'auto' as const, fontFamily: 'monospace', fontSize: 11 } },
            ...events.map((e, i) =>
              React.createElement('div', {
                key: i,
                style: {
                  display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 14px',
                  borderBottom: '1px solid rgba(42,47,61,0.3)',
                  background: i === 0 ? 'rgba(14,202,212,0.04)' : 'transparent',
                },
              },
                React.createElement('span', { style: { color: '#444', flexShrink: 0 } }, this.formatTs(e.ts)),
                React.createElement('span', { style: { color: this.stateColor(e.state), flexShrink: 0, fontWeight: 600 } }, e.state),
                React.createElement('span', { style: { color: '#666', flexShrink: 0 } }, e.siteName),
                e.message ? React.createElement('span', { style: { color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, e.message) : null,
                e.progress !== undefined && e.state === 'indexing'
                  ? React.createElement('span', { style: { color: '#333', marginLeft: 'auto', flexShrink: 0 } }, `${e.progress}%`)
                  : null,
              ),
            ),
          ),
    );
  }

  render(): React.ReactNode {
    const { sites } = this.props;
    const localSites = sites; // props already filtered to local sites by NexusOverview

    return React.createElement('div', { style: { padding: '20px 24px' } },
      // Header
      React.createElement('div', { style: { marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 4 } }, 'System Inspector'),
        React.createElement('p', { style: { fontSize: 12, color: '#555' } },
          'Real-time view of the content index and metadata cache for each local site. ',
          React.createElement('span', { style: { color: '#333' } }, 'Temporary debug tab.'),
        ),
      ),

      // Two-column layout: site cards left, event log right
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16, alignItems: 'start' } },

        // Site cards
        React.createElement('div', null,
          localSites.length === 0
            ? React.createElement('div', { style: { color: '#555', fontSize: 13 } }, 'No local sites found.')
            : localSites.map(site => this.renderSiteCard(site)),
        ),

        // Event log (sticky)
        React.createElement('div', { style: { position: 'sticky' as const, top: 20 } },
          this.renderEventLog(),
          // Refresh all metadata button
          React.createElement('button', {
            onClick: () => this.loadAllMetadata(),
            style: { marginTop: 10, width: '100%', padding: '7px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, color: '#555', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' },
          }, '↻ Refresh all metadata'),
        ),
      ),
    );
  }
}
