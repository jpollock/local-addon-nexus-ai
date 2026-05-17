/**
 * SystemTab — Fleet completeness + freshness inspector.
 *
 * Shows the real-time state of ALL local sites across four data stores,
 * with freshness calculated relative to the most recent known change:
 *
 *   Metadata Cache   — stale when plugin events arrive after last refresh
 *   Content Index    — stale when post_created/post_updated after last index
 *   Graph Plugins    — stale when plugin events after last index
 *   Graph Users      — stale when user events after last index
 *
 * Change events come from event_queue (WP Connector webhooks).
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
  lastPostAt?: number;
  updateSource?: string;
  lastUpdated?: number;
}

interface ChangeEvents {
  lastContent: number | null;
  lastPlugin:  number | null;
  lastUser:    number | null;
}

type Freshness = 'fresh' | 'stale' | 'empty' | 'unknown';

interface SystemTabProps {
  electron: any;
  sites: Array<{ id: string; name: string; status: string }>;
  indexEntries: IndexEntry[];
}

interface SiteData {
  metadata: SiteMetadata | null;
  metaAge: string | null;
  events: ChangeEvents;
}

interface LiveProgress {
  state: string;
  progress: number;
  message: string;
}

interface SystemTabState {
  siteData: Record<string, SiteData>;
  liveProgress: Record<string, LiveProgress>;
  loading: boolean;
  actionInProgress: Record<string, string>;
  factoryResetConfirming: boolean;
  factoryResetRunning: boolean;
  factoryResetDone: boolean;
  factoryResetChecked: boolean;
}

export class SystemTab extends React.Component<SystemTabProps, SystemTabState> {
  private mounted = false;
  private _progressHandler: ((_: any, data: any) => void) | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  state: SystemTabState = {
    siteData: {},
    liveProgress: {},
    loading: true,
    actionInProgress: {},
    factoryResetConfirming: false,
    factoryResetRunning: false,
    factoryResetDone: false,
    factoryResetChecked: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadAll();

    const ipc = this.props.electron.ipcRenderer;
    this._progressHandler = (_: any, data: any) => {
      if (!this.mounted) return;
      this.setState(prev => ({
        liveProgress: {
          ...prev.liveProgress,
          [data.siteId]: { state: data.state, progress: data.progress ?? 0, message: data.message ?? '' },
        },
      }));
      // When indexing completes, reload metadata for that site
      if (data.state === 'indexed') {
        setTimeout(() => this.loadSite(data.siteId), 500);
      }
    };
    ipc.on(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);

    // Poll every 30s to pick up new webhook events
    this._pollTimer = setInterval(() => this.loadChangeEvents(), 30_000);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this._progressHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
    }
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;

    // Load change events and all site metadata in parallel
    const [changeEvents] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SITE_CHANGE_EVENTS).catch(() => ({})),
    ]);

    const siteData: Record<string, SiteData> = {};
    await Promise.all(
      this.props.sites.map(async site => {
        const res = await ipc.invoke(IPC_CHANNELS.GET_SITE_METADATA, site.id).catch(() => null);
        siteData[site.id] = {
          metadata: res?.metadata ?? null,
          metaAge:  res?.ageString ?? null,
          events:   changeEvents[site.id] ?? { lastContent: null, lastPlugin: null, lastUser: null },
        };
      }),
    );

    if (this.mounted) this.setState({ siteData, loading: false });
  }

  async loadSite(siteId: string): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [res, changeEvents] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SITE_METADATA, siteId).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITE_CHANGE_EVENTS).catch(() => ({})),
    ]);
    if (!this.mounted) return;
    this.setState(prev => ({
      siteData: {
        ...prev.siteData,
        [siteId]: {
          metadata: res?.metadata ?? null,
          metaAge:  res?.ageString ?? null,
          events:   changeEvents[siteId] ?? prev.siteData[siteId]?.events ?? { lastContent: null, lastPlugin: null, lastUser: null },
        },
      },
    }));
  }

  async loadChangeEvents(): Promise<void> {
    const events = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_SITE_CHANGE_EVENTS).catch(() => ({}));
    if (!this.mounted) return;
    this.setState(prev => {
      const next = { ...prev.siteData };
      Object.entries(events as Record<string, ChangeEvents>).forEach(([id, ev]) => {
        if (next[id]) next[id] = { ...next[id], events: ev };
      });
      return { siteData: next };
    });
  }

  // ── Freshness logic ────────────────────────────────────────────

  freshness(builtAt: number | undefined, sourceChangedAt: number | null): Freshness {
    if (!builtAt) return 'empty';
    if (!sourceChangedAt) return 'unknown'; // no webhook events yet
    if (sourceChangedAt > builtAt) return 'stale';
    return 'fresh';
  }

  // ── Actions ────────────────────────────────────────────────────

  handleStartIndexing = async (): Promise<void> => {
    this.setState(prev => ({ actionInProgress: { ...prev.actionInProgress, _all: 'starting' } }));
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_AUTO).catch(() => {});
    setTimeout(() => {
      if (this.mounted) this.setState(prev => { const n = {...prev.actionInProgress}; delete n._all; return { actionInProgress: n }; });
    }, 3000);
  };

  handleReindex = async (siteId: string): Promise<void> => {
    this.setState(prev => ({ actionInProgress: { ...prev.actionInProgress, [siteId]: 'indexing' } }));
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, { siteId, force: true }).catch(() => {});
    if (this.mounted) {
      this.setState(prev => { const n = {...prev.actionInProgress}; delete n[siteId]; return { actionInProgress: n }; });
    }
  };

  handleRefreshMeta = async (siteId: string): Promise<void> => {
    this.setState(prev => ({ actionInProgress: { ...prev.actionInProgress, [siteId]: 'refreshing' } }));
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.REFRESH_SITE_METADATA, siteId).catch(() => {});
    await this.loadSite(siteId);
    if (this.mounted) {
      this.setState(prev => { const n = {...prev.actionInProgress}; delete n[siteId]; return { actionInProgress: n }; });
    }
  };

  // ── Formatting ─────────────────────────────────────────────────

  ago(ts?: number | null): string {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  // ── Summary counts ─────────────────────────────────────────────

  getStoreCounts(): { meta: {fresh:number;stale:number;unknown:number}; index: {fresh:number;stale:number;unknown:number}; plugins: {fresh:number;stale:number;unknown:number}; users: {fresh:number;stale:number;unknown:number} } {
    const counts = { fresh: 0, stale: 0, unknown: 0 };
    const r = { meta: {...counts}, index: {...counts}, plugins: {...counts}, users: {...counts} };
    this.props.sites.forEach(site => {
      const entry = this.props.indexEntries.find(e => e.siteId === site.id);
      const sd = this.state.siteData[site.id];
      const ev = sd?.events;

      const mF = this.freshness(sd?.metadata?.lastUpdated, ev?.lastPlugin ?? null);
      if (mF !== 'empty') r.meta[mF === 'unknown' ? 'unknown' : mF]++;

      const iF = this.freshness(entry?.lastIndexed, ev?.lastContent ?? null);
      if (iF !== 'empty') r.index[iF === 'unknown' ? 'unknown' : iF]++;

      // Plugins and users share the index timestamp (written during indexing)
      const pF = this.freshness(entry?.lastIndexed, ev?.lastPlugin ?? null);
      if (pF !== 'empty') r.plugins[pF === 'unknown' ? 'unknown' : pF]++;

      const uF = this.freshness(entry?.lastIndexed, ev?.lastUser ?? null);
      if (uF !== 'empty') r.users[uF === 'unknown' ? 'unknown' : uF]++;
    });
    return r;
  }

  // ── Render helpers ─────────────────────────────────────────────

  renderFreshnessBar(fresh: number, stale: number, unknown: number, color: string): React.ReactNode {
    const total = this.props.sites.length;
    const freshPct  = (fresh   / total) * 100;
    const stalePct  = (stale   / total) * 100;
    const unknPct   = (unknown / total) * 100;

    return React.createElement('div', { style: { background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 3, height: 5, overflow: 'hidden', position: 'relative' as const, marginBottom: 4 } },
      React.createElement('div', { style: { position: 'absolute' as const, top: 0, left: 0, height: '100%', width: `${freshPct}%`, background: color, opacity: 0.9, transition: 'width .6s' } }),
      React.createElement('div', { style: { position: 'absolute' as const, top: 0, left: `${freshPct}%`, height: '100%', width: `${stalePct}%`, background: '#f59e0b', opacity: 0.7, transition: 'all .6s' } }),
      React.createElement('div', { style: { position: 'absolute' as const, top: 0, left: `${freshPct + stalePct}%`, height: '100%', width: `${unknPct}%`, background: '#333', opacity: 1, transition: 'all .6s' } }),
    );
  }

  renderSummaryCard(title: string, color: string, total: number, fresh: number, stale: number, unknown: number, sub: string): React.ReactNode {
    const empty = total - fresh - stale - unknown;
    return React.createElement('div', { style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, padding: '10px 12px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 } },
        React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color } }, title),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 700 } },
          `${fresh + stale + unknown}`,
          React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, `/${this.props.sites.length}`),
          stale > 0 ? React.createElement('span', { style: { fontSize: 10, color: '#f59e0b', marginLeft: 6 } }, `${stale} stale`) : null,
        ),
      ),
      this.renderFreshnessBar(fresh, stale, unknown, color),
      React.createElement('div', { style: { display: 'flex', gap: 10, fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } },
        React.createElement('span', null, '■', React.createElement('span', { style: { color } }, ` ${fresh} fresh`)),
        stale > 0 ? React.createElement('span', null, '■', React.createElement('span', { style: { color: '#f59e0b' } }, ` ${stale} stale`)) : null,
        unknown > 0 ? React.createElement('span', null, `■ ${unknown} no events`) : null,
        empty > 0   ? React.createElement('span', null, `■ ${empty} empty`) : null,
      ),
      React.createElement('div', { style: { fontSize: 10, color: '#2a2f3d', marginTop: 3 } }, sub),
    );
  }

  renderCell(builtAt: number | undefined, sourceChangedAt: number | null, value: string, sub: string): React.ReactNode {
    const f = this.freshness(builtAt, sourceChangedAt);
    if (f === 'empty') return React.createElement('span', { style: { color: '#252a35', fontSize: 16 } }, '—');

    const colors: Record<Freshness, string> = { fresh: '#51BB7B', stale: '#f59e0b', unknown: '#6b7280', empty: '#252a35' };
    const badges: Record<Freshness, string> = { fresh: '✓ fresh', stale: '⚠ stale', unknown: '? no events', empty: '' };
    const col = colors[f];

    return React.createElement('div', { style: { lineHeight: 1.35 } },
      React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: col } }, value),
      React.createElement('span', {
        style: { display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, marginLeft: 4, background: `${col}18`, color: col, border: `1px solid ${col}30`, verticalAlign: 'middle' },
      }, badges[f]),
      React.createElement('span', { style: { display: 'block', fontSize: 10, color: f === 'stale' ? '#f59e0b' : '#2a4a35', marginTop: 1 } },
        sub,
        builtAt ? ` · ${this.ago(builtAt)}` : '',
      ),
    );
  }

  // ── Main render ────────────────────────────────────────────────

  render(): React.ReactNode {
    const { sites, indexEntries } = this.props;
    const { siteData, liveProgress, loading, actionInProgress, factoryResetConfirming, factoryResetRunning, factoryResetDone, factoryResetChecked } = this.state;
    const counts = this.getStoreCounts();
    const N = sites.length;

    const col = { meta: '#a78bfa', index: '#0ECAD4', plugins: '#f59e0b', users: '#f97316' };

    // Grid template: name | status | last-change | meta | index | plugins | users | actions
    const grid = '150px 66px 90px 150px 150px 110px 95px 1fr';
    const mch: React.CSSProperties = { padding: '6px 9px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.05em', color: 'var(--nxai-card-sub, #6b7280)' };
    const mc: React.CSSProperties = { padding: '8px 9px', fontSize: 12 };

    return React.createElement('div', { style: { padding: '18px 22px', overflow: 'auto' } },

      // ── Source legend ──────────────────────────────────────────
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 16, fontSize: 11 } },
        ...([
          { col: '#51BB7B', text: 'Auto on site start — metadata cache · content vectors · graph records' },
          { col: '#a78bfa', text: 'WP Connector webhooks — post_created · post_updated · plugin_activated' },
          { col: '#f59e0b', text: 'Manual — re-index · refresh metadata' },
          { col: '#555',   text: 'WPE sync — disabled' },
        ]).map((s, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 5, background: `${s.col}0d`, border: `1px solid ${s.col}22`, color: s.col } },
            React.createElement('div', { style: { width: 5, height: 5, borderRadius: '50%', background: s.col, flexShrink: 0 } }),
            s.text,
          ),
        ),
      ),

      // ── Fleet completeness bars ────────────────────────────────
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 } },
        this.renderSummaryCard('Metadata Cache', col.meta, N, counts.meta.fresh, counts.meta.stale, counts.meta.unknown, 'Stale: plugin_activated event after last refresh'),
        this.renderSummaryCard('Content Index', col.index, N, counts.index.fresh, counts.index.stale, counts.index.unknown, 'Stale: post_updated event after last index'),
        this.renderSummaryCard('Graph — Plugins & Themes', col.plugins, N, counts.plugins.fresh, counts.plugins.stale, counts.plugins.unknown, 'Written during content indexing · stale on plugin events'),
        this.renderSummaryCard('Graph — Users', col.users, N, counts.users.fresh, counts.users.stale, counts.users.unknown, 'Written during content indexing · stale on user events'),
      ),

      // ── Global actions ─────────────────────────────────────────
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 7, marginBottom: factoryResetConfirming || factoryResetDone ? 0 : 14, borderBottomLeftRadius: factoryResetConfirming || factoryResetDone ? 0 : 7, borderBottomRightRadius: factoryResetConfirming || factoryResetDone ? 0 : 7 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, 'Fleet Actions'),
        React.createElement('button', {
          disabled: !!actionInProgress._all,
          onClick: this.handleStartIndexing,
          style: { padding: '5px 11px', borderRadius: 5, background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
        }, actionInProgress._all ? '⏳ Starting…' : '⚡ Start + index all sites'),
        React.createElement('button', {
          onClick: () => this.loadAll(),
          style: { padding: '5px 11px', borderRadius: 5, background: 'var(--nxai-card-bg, #21262d)', color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11, border: '1px solid var(--nxai-card-border, #30363d)', cursor: 'pointer', fontFamily: 'inherit' },
        }, '↻ Refresh'),
        React.createElement('button', {
          onClick: () => this.setState(prev => ({ factoryResetConfirming: !prev.factoryResetConfirming, factoryResetDone: false, factoryResetChecked: false })),
          style: { padding: '5px 11px', borderRadius: 5, background: factoryResetConfirming ? 'rgba(239,68,68,0.15)' : 'transparent', color: '#ef4444', fontSize: 11, border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer', fontFamily: 'inherit' },
        }, '⚠ Factory Reset'),
      ),

      // ── Factory reset confirmation panel ────────────────────────
      factoryResetDone
        ? React.createElement('div', { style: { padding: '10px 14px', background: 'rgba(81,187,123,0.06)', border: '1px solid rgba(81,187,123,0.2)', borderTop: 'none', borderRadius: '0 0 7px 7px', marginBottom: 14, fontSize: 12, color: '#51BB7B' } },
            '✓ All Nexus AI data deleted. ',
            React.createElement('strong', null, 'Restart Local'),
            ' to complete the reset — electron-store will otherwise recreate files on exit.',
          )
        : factoryResetConfirming
        ? React.createElement('div', { style: { padding: '12px 14px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderTop: 'none', borderRadius: '0 0 7px 7px', marginBottom: 14 } },
            React.createElement('div', { style: { fontSize: 12, marginBottom: 10, lineHeight: 1.55 } },
              React.createElement('strong', { style: { color: '#ef4444' } }, 'Permanently deletes:'),
              React.createElement('ul', { style: { margin: '5px 0 5px 16px', color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11 } },
                React.createElement('li', null, 'IndexRegistry · SiteMetadataCache · Settings'),
                React.createElement('li', null, 'API key status · Site AI configs · WPE install cache'),
                React.createElement('li', null, 'Graph DB (plugins, themes, users, events)'),
                React.createElement('li', null, 'Vector store — all embeddings'),
              ),
              React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 5 } },
                '✓ API keys (Keychain), WPE OAuth, and telemetry ID are ',
                React.createElement('strong', null, 'not affected'),
                '. Restart Local after reset.',
              ),
            ),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 10 } },
              React.createElement('input', {
                type: 'checkbox',
                checked: factoryResetChecked,
                onChange: (e: any) => this.setState({ factoryResetChecked: e.target.checked }),
              }),
              'I understand — this cannot be undone without re-indexing',
            ),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                disabled: !factoryResetChecked || factoryResetRunning,
                onClick: async () => {
                  this.setState({ factoryResetRunning: true });
                  const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.FACTORY_RESET);
                  if (result?.success) {
                    this.setState({ factoryResetRunning: false, factoryResetConfirming: false, factoryResetDone: true, factoryResetChecked: false, siteData: {}, liveProgress: {} });
                  } else {
                    this.setState({ factoryResetRunning: false });
                    (window as any).showToast?.(`Reset failed: ${result?.error}`, 'error');
                  }
                },
                style: { padding: '5px 14px', borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: !factoryResetChecked || factoryResetRunning ? 'not-allowed' : 'pointer', background: !factoryResetChecked ? '#333' : '#ef4444', color: '#fff', border: 'none', opacity: !factoryResetChecked ? 0.5 : 1, fontFamily: 'inherit' },
              }, factoryResetRunning ? '⏳ Resetting…' : 'Reset Everything'),
              React.createElement('button', {
                onClick: () => this.setState({ factoryResetConfirming: false, factoryResetChecked: false }),
                style: { padding: '5px 12px', borderRadius: 5, fontSize: 12, background: 'var(--nxai-card-bg, #21262d)', color: 'var(--nxai-card-sub, #6b7280)', border: '1px solid var(--nxai-card-border, #30363d)', cursor: 'pointer', fontFamily: 'inherit' },
              }, 'Cancel'),
            ),
          )
        : null,

      // ── Site matrix ────────────────────────────────────────────
      React.createElement('div', { style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' } },

        // Header
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: grid, background: 'var(--nxai-code-bg, #1f1f1f)', borderBottom: '1px solid var(--nxai-card-border, #30363d)' } },
          React.createElement('div', { style: mch }, 'Site'),
          React.createElement('div', { style: mch }, 'Status'),
          React.createElement('div', { style: mch }, 'Last change'),
          React.createElement('div', { style: { ...mch, color: col.meta } }, 'Metadata'),
          React.createElement('div', { style: { ...mch, color: col.index } }, 'Content Index'),
          React.createElement('div', { style: { ...mch, color: col.plugins } }, 'Plugins'),
          React.createElement('div', { style: { ...mch, color: col.users } }, 'Users'),
          React.createElement('div', { style: mch }),
        ),

        // Rows
        ...sites.map((site, i) => {
          const entry  = indexEntries.find(e => e.siteId === site.id);
          const sd     = siteData[site.id];
          const ev     = sd?.events ?? { lastContent: null, lastPlugin: null, lastUser: null };
          const live   = liveProgress[site.id];
          const action = actionInProgress[site.id];
          const running = site.status === 'running';

          // Last-change summary for this site
          const lastAny = Math.max(ev.lastContent ?? 0, ev.lastPlugin ?? 0, ev.lastUser ?? 0) || null;
          const changeTypes: string[] = [];
          if (ev.lastContent) changeTypes.push('post');
          if (ev.lastPlugin)  changeTypes.push('plugin');
          if (ev.lastUser)    changeTypes.push('user');

          // Cells
          const metaVal   = sd?.metadata ? `WP ${sd.metadata.wpVersion ?? '?'} · PHP ${sd.metadata.phpVersion ?? '?'}` : '';
          const metaSub   = sd?.metadata?.plugins ? `${sd.metadata.plugins.length} plugins` : '';
          const indexVal  = live?.state === 'indexing'
            ? `${live.progress}%`
            : entry?.documentCount ? `${entry.documentCount} docs` : '';
          const indexSub  = live?.state === 'indexing'
            ? live.message
            : entry?.chunkCount ? `${entry.chunkCount} chunks` : '';
          const pluginVal = sd?.metadata?.plugins ? `${sd.metadata.plugins.length} plugins` : (entry?.documentCount ? '?' : '');
          const pluginSub = sd?.metadata?.themes ? `${sd.metadata.themes.length} themes` : '';
          const usersVal  = '';  // would need nexusSiteUsers call
          const usersSub  = '';

          const borderStyle = i < sites.length - 1 ? '1px solid rgba(42,47,61,.4)' : 'none';

          return React.createElement('div', {
            key: site.id,
            style: { display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderBottom: borderStyle },
          },
            // Name
            React.createElement('div', { style: { ...mc, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, site.name),

            // Status
            React.createElement('div', { style: mc },
              React.createElement('span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                  background: running ? 'rgba(81,187,123,.1)' : 'rgba(107,114,128,.08)',
                  color: running ? '#51BB7B' : 'var(--nxai-card-sub, #6b7280)',
                  border: `1px solid ${running ? 'rgba(81,187,123,.2)' : 'rgba(107,114,128,.15)'}` },
              },
                React.createElement('div', { style: { width: 5, height: 5, borderRadius: '50%', background: 'currentColor' } }),
                running ? 'running' : 'halted',
              ),
            ),

            // Last change
            React.createElement('div', { style: { ...mc, fontSize: 10, lineHeight: 1.4 } },
              lastAny
                ? React.createElement('div', null,
                    React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, this.ago(lastAny)),
                    React.createElement('span', { style: { display: 'block', color: '#333', fontSize: 9 } }, changeTypes.join(' · ')),
                  )
                : React.createElement('span', { style: { color: '#252a35' } }, 'no events'),
            ),

            // Metadata cell
            React.createElement('div', { style: mc },
              loading ? React.createElement('span', { style: { color: '#333', fontSize: 11 } }, 'loading…')
              : this.renderCell(sd?.metadata?.lastUpdated, ev.lastPlugin, metaVal, metaSub),
            ),

            // Content index cell
            React.createElement('div', { style: mc },
              live?.state === 'indexing'
                ? React.createElement('div', null,
                    React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: '#0ECAD4' } }, `${live.progress}%`),
                    React.createElement('div', { style: { background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 2, height: 3, overflow: 'hidden', marginTop: 3 } },
                      React.createElement('div', { style: { height: '100%', width: `${live.progress}%`, background: '#0ECAD4', borderRadius: 2, transition: 'width .3s' } }),
                    ),
                    React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4', display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, live.message),
                  )
                : this.renderCell(entry?.lastIndexed, ev.lastContent, indexVal, indexSub),
            ),

            // Plugins cell
            React.createElement('div', { style: mc },
              this.renderCell(entry?.lastIndexed, ev.lastPlugin, pluginVal, pluginSub),
            ),

            // Users cell
            React.createElement('div', { style: mc },
              this.renderCell(entry?.lastIndexed, ev.lastUser, usersVal || (entry?.lastIndexed ? '?' : ''), usersSub),
            ),

            // Actions
            React.createElement('div', { style: { padding: '6px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' as const } },
              !running && !action && !live
                ? React.createElement('button', {
                    onClick: () => this.props.electron.ipcRenderer.invoke('nexus-ai:start-site', { siteId: site.id }).catch(() => {}),
                    style: { padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(81,187,123,.25)', background: 'rgba(81,187,123,.1)', color: '#51BB7B', fontFamily: 'inherit' },
                  }, '▶ Start')
                : null,
              // Re-index if stale or never indexed
              running && !action && this.freshness(entry?.lastIndexed, ev.lastContent) !== 'fresh'
                ? React.createElement('button', {
                    onClick: () => this.handleReindex(site.id),
                    style: { padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(245,158,11,.25)', background: 'rgba(245,158,11,.1)', color: '#f59e0b', fontFamily: 'inherit' },
                  }, entry?.lastIndexed ? '⚡ Re-index' : '⚡ Index')
                : null,
              action === 'indexing' ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4' } }, '⏳ indexing…') : null,
              action === 'refreshing' ? React.createElement('span', { style: { fontSize: 10, color: '#51BB7B' } }, '⏳ refreshing…') : null,
            ),
          );
        }),
      ),
    );
  }
}
