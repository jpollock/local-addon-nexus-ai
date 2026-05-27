/**
 * SystemTab — Fleet completeness + freshness inspector.
 *
 * Shows the real-time state of ALL local sites with data level indicators:
 * Level 1 (Scanned): WP version + installed plugins known
 * Level 2 (Configured): active plugins, users, post counts known
 * Level 3 (Searchable): content indexed and searchable
 *
 * WPE installs shown as aggregate summary at the bottom.
 *
 * Class-based, React.createElement only — no JSX, no hooks (Local React).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import { nexusStore } from '../store/NexusStateManager';
import type { WpeSyncProgress } from '../store/NexusStateManager';

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
  userCount?: number;
  updateSource?: string;
  lastUpdated?: number;
}

interface ChangeEvents {
  lastContent: number | null;
  lastPlugin:  number | null;
  lastUser:    number | null;
  userCount:   number | null;
}

type Freshness = 'fresh' | 'stale' | 'empty' | 'unknown';

interface WpeStatus {
  total: number;
  fresh: number;
  stale: number;
  withPlugins: number;
  withUsers: number;
  withWpVersion: number;
  withPhpVersion: number;
  lastSyncAt: number | null;
}

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
  wpeStatus: WpeStatus | null;
  expandedSiteId: string | null;
  wpeSyncProgress: WpeSyncProgress | null;
}

export class SystemTab extends React.Component<SystemTabProps, SystemTabState> {
  private mounted = false;
  private _progressHandler: ((_: any, data: any) => void) | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsub?: () => void;

  state: SystemTabState = {
    siteData: {},
    liveProgress: {},
    loading: true,
    actionInProgress: {},
    wpeStatus: null,
    expandedSiteId: null,
    wpeSyncProgress: null,
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

    // Poll every 30s to pick up new webhook events (local site change events)
    this._pollTimer = setInterval(() => this.loadChangeEvents(), 30_000);

    // Subscribe to store for wpeStatus + wpeSyncProgress (pushed from main process)
    this.unsub = nexusStore.subscribe(() => {
      if (!this.mounted) return;
      const s = nexusStore.get();
      this.setState({
        wpeStatus: s.wpeStatus as WpeStatus | null,
        wpeSyncProgress: s.wpeSyncProgress,
      });
    });
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this._progressHandler) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
    }
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.unsub?.();
  }

  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;

    const [changeEvents, wpeStatus] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SITE_CHANGE_EVENTS).catch(() => ({})),
      ipc.invoke(IPC_CHANNELS.SYSTEM_WPE_STATUS).catch(() => null),
    ]);

    // Seed the store — subscription in componentDidMount will sync state
    nexusStore.update({ wpeStatus: wpeStatus ?? null });

    const siteData: Record<string, SiteData> = {};
    await Promise.all(
      this.props.sites.map(async site => {
        const res = await ipc.invoke(IPC_CHANNELS.GET_SITE_METADATA, site.id).catch(() => null);
        siteData[site.id] = {
          metadata: res?.metadata ?? null,
          metaAge:  res?.ageString ?? null,
          events:   changeEvents[site.id] ?? { lastContent: null, lastPlugin: null, lastUser: null, userCount: null },
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
          events:   changeEvents[siteId] ?? prev.siteData[siteId]?.events ?? { lastContent: null, lastPlugin: null, lastUser: null, userCount: null },
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

  // ── Level computation ──────────────────────────────────────────

  computeLevel(
    metadata: SiteMetadata | null,
    entry: IndexEntry | undefined,
  ): { level: 0 | 1 | 2 | 3; label: string; dots: string } {
    if (!metadata) return { level: 0, label: 'Unknown', dots: '○○○' };
    const isConfigured = !!(metadata.plugins && metadata.plugins.length > 0);
    // 'stale' = indexed but a change event fired after — content is still searchable
    const isSearchable = entry?.state === 'indexed' || entry?.state === 'stale';
    if (isSearchable) return { level: 3, label: 'Searchable', dots: '●●●' };
    if (isConfigured) return { level: 2, label: 'Configured', dots: '●●○' };
    return { level: 1, label: 'Scanned', dots: '●○○' };
  }

  // ── Main render ────────────────────────────────────────────────

  render(): React.ReactNode {
    const { sites, indexEntries } = this.props;
    const { siteData, liveProgress, loading: _loading, actionInProgress, wpeStatus, wpeSyncProgress } = this.state;

    const mch: React.CSSProperties = { padding: '6px 9px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.05em', color: 'var(--nxai-card-sub, #6b7280)' };
    const mc: React.CSSProperties = { padding: '8px 9px', fontSize: 12 };

    return React.createElement('div', { style: { padding: '18px 22px', overflow: 'auto' } },

      // ── WPE Installs summary ───────────────────────────────────
      wpeStatus && wpeStatus.total > 0
        ? React.createElement('div', {
            style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, padding: '12px 16px', marginBottom: 14, background: 'var(--nxai-card-bg, #21262d)' },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 } },
              React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: '#0ECAD4' } }, 'WP Engine'),
              React.createElement('span', { style: { fontSize: 20, fontWeight: 700 } }, wpeStatus.total),
              React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, 'installs'),
              wpeStatus.lastSyncAt
                ? React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginLeft: 'auto' } },
                    `Last sync: ${this.ago(wpeStatus.lastSyncAt)}`,
                  )
                : null,
            ),
            // Freshness bar
            React.createElement('div', { style: { background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 3, height: 5, overflow: 'hidden', position: 'relative' as const, marginBottom: 8 } },
              React.createElement('div', { style: { position: 'absolute' as const, top: 0, left: 0, height: '100%', width: `${(wpeStatus.fresh / wpeStatus.total) * 100}%`, background: '#0ECAD4', transition: 'width .6s' } }),
              React.createElement('div', { style: { position: 'absolute' as const, top: 0, left: `${(wpeStatus.fresh / wpeStatus.total) * 100}%`, height: '100%', width: `${(wpeStatus.stale / wpeStatus.total) * 100}%`, background: '#f59e0b', opacity: 0.7, transition: 'all .6s' } }),
            ),
            React.createElement('div', { style: { display: 'flex', gap: 16, fontSize: 11, flexWrap: 'wrap' as const } },
              React.createElement('span', null,
                React.createElement('span', { style: { color: '#0ECAD4' } }, `■ ${wpeStatus.fresh} fresh`),
                React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, ' (synced within 8h)'),
              ),
              React.createElement('span', null,
                React.createElement('span', { style: { color: '#f59e0b' } }, `■ ${wpeStatus.stale} stale`),
              ),
              React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, '·'),
              React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, `WP version: ${wpeStatus.withWpVersion}/${wpeStatus.total}`),
              React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, `PHP: ${wpeStatus.withPhpVersion}/${wpeStatus.total}`),
              React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, `Plugins: ${wpeStatus.withPlugins}/${wpeStatus.total}`),
              React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, `Users: ${wpeStatus.withUsers}/${wpeStatus.total}`),
            ),
            wpeStatus.withWpVersion === 0 && wpeStatus.withPlugins === 0 && wpeStatus.total > 0
              ? React.createElement('div', {
                  style: { fontSize: 11, color: '#f97316', marginTop: 6 },
                  'data-testid': 'wpe-ssh-not-run-hint',
                }, 'SSH sync not yet run — enable Metadata sync in Settings → WP Engine Installs to populate WP version and plugins.')
              : null,
            wpeSyncProgress?.active
              ? React.createElement('div', {
                  style: { fontSize: 11, color: '#0ECAD4', marginTop: 6 },
                  'data-testid': 'wpe-sync-progress',
                }, `Syncing ${wpeSyncProgress.currentSite} (${wpeSyncProgress.current}/${wpeSyncProgress.total})...`)
              : null,
          )
        : null,

      // ── Local sites label ──────────────────────────────────────
      React.createElement('div', {
        style: {
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
          letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 6,
        },
      }, `Local sites — ${sites.length}`),

      // ── Site matrix (level dots) ───────────────────────────────
      React.createElement('div', { style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' } },

        // Header
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: '160px 80px 1fr 130px',
            background: 'var(--nxai-code-bg, #1f1f1f)',
            borderBottom: '1px solid var(--nxai-card-border, #30363d)',
          },
        },
          React.createElement('div', { style: mch }, 'Site'),
          React.createElement('div', { style: mch }, 'Status'),
          React.createElement('div', { style: mch }, 'Level'),
          React.createElement('div', { style: mch }),
        ),

        // Rows
        ...sites.map((site, i) => {
          const entry  = indexEntries.find(e => e.siteId === site.id);
          const sd     = siteData[site.id];
          const live   = liveProgress[site.id];
          const action = actionInProgress[site.id];
          const running = site.status === 'running';
          const expanded = this.state.expandedSiteId === site.id;
          const { level, label, dots } = this.computeLevel(sd?.metadata ?? null, entry);

          const dotColors: Record<number, string> = {
            0: '#333', 1: '#51BB7B', 2: '#a78bfa', 3: '#0ECAD4',
          };
          const dotColor = dotColors[level];

          const levelAge = entry?.lastIndexed
            ? this.ago(entry.lastIndexed)
            : sd?.metadata?.lastUpdated
            ? this.ago(sd.metadata.lastUpdated)
            : null;

          const border = i < sites.length - 1
            ? '1px solid rgba(42,47,61,.4)'
            : 'none';

          return React.createElement('div', { key: site.id },
            // Main row — clickable to expand
            React.createElement('div', {
              style: {
                display: 'grid', gridTemplateColumns: '160px 80px 1fr 130px',
                alignItems: 'center', borderBottom: border, cursor: 'pointer',
              },
              onClick: () => this.setState(prev => ({
                expandedSiteId: prev.expandedSiteId === site.id ? null : site.id,
              })),
            },
              // Name
              React.createElement('div', {
                style: {
                  ...mc, fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                },
              },
                React.createElement('span', {
                  style: { color: 'var(--nxai-card-sub, #6b7280)', fontSize: 10, marginRight: 4 },
                }, expanded ? '▼' : '▶'),
                site.name,
              ),
              // Status
              React.createElement('div', { style: mc },
                React.createElement('span', {
                  style: {
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                    background: running ? 'rgba(81,187,123,.1)' : 'rgba(107,114,128,.08)',
                    color: running ? '#51BB7B' : 'var(--nxai-card-sub, #6b7280)',
                    border: `1px solid ${running ? 'rgba(81,187,123,.2)' : 'rgba(107,114,128,.15)'}`,
                  },
                },
                  React.createElement('div', {
                    style: { width: 5, height: 5, borderRadius: '50%', background: 'currentColor' },
                  }),
                  running ? 'running' : 'halted',
                ),
              ),
              // Level
              React.createElement('div', {
                style: { ...mc, display: 'flex', alignItems: 'center', gap: 8 },
              },
                live?.state === 'indexing'
                  ? React.createElement('div', null,
                      React.createElement('span', { style: { fontSize: 11, color: '#0ECAD4' } },
                        `${live.progress}% indexing…`,
                      ),
                      React.createElement('div', {
                        style: {
                          background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 2,
                          height: 3, width: 80, overflow: 'hidden', marginTop: 3,
                        },
                      },
                        React.createElement('div', {
                          style: {
                            height: '100%', width: `${live.progress}%`,
                            background: '#0ECAD4', borderRadius: 2, transition: 'width .3s',
                          },
                        }),
                      ),
                    )
                  : React.createElement('div', null,
                      React.createElement('span', {
                        style: { fontFamily: 'monospace', fontSize: 13, letterSpacing: 2, color: dotColor },
                      }, dots),
                      React.createElement('span', {
                        style: { fontSize: 11, fontWeight: 500, color: dotColor, marginLeft: 6 },
                      }, label),
                      levelAge
                        ? React.createElement('span', {
                            style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', marginLeft: 4 },
                          }, levelAge)
                        : null,
                    ),
              ),
              // Actions — stopPropagation so clicks don't toggle expand
              React.createElement('div', {
                style: { padding: '6px 8px', display: 'flex', gap: 4 },
                onClick: (e: any) => e.stopPropagation(),
              },
                running && !action && !live && level < 3
                  ? React.createElement('button', {
                      onClick: () => this.handleReindex(site.id),
                      style: {
                        padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        cursor: 'pointer', border: '1px solid rgba(14,202,212,.25)',
                        background: 'rgba(14,202,212,.08)', color: '#0ECAD4', fontFamily: 'inherit',
                      },
                    }, level < 3 ? '⚡ Index' : '↻ Re-index')
                  : null,
                action
                  ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4' } }, '⏳…')
                  : null,
              ),
            ),

            // Expanded detail panel
            expanded
              ? React.createElement('div', {
                  style: {
                    borderBottom: border,
                    background: 'rgba(14,202,212,0.02)',
                    padding: '10px 20px 12px 32px',
                  },
                },
                  ...[
                    {
                      done: level >= 1,
                      label: 'Scanned',
                      detail: sd?.metadata?.wpVersion
                        ? `WP ${sd.metadata.wpVersion}${sd.metadata.plugins ? ` · ${sd.metadata.plugins.length} plugins installed` : ''}`
                        : 'No metadata yet',
                      missing: level < 1 ? 'Filesystem scan not complete' : null,
                    },
                    {
                      done: level >= 2,
                      label: 'Configured',
                      detail: level >= 2 && sd?.metadata?.plugins
                        ? [
                            `${sd.metadata.plugins.filter((p: any) => p.status === 'active').length} active plugins`,
                            `${sd?.metadata?.userCount ?? '?'} users`,
                            sd?.metadata?.phpVersion ? `PHP ${sd.metadata.phpVersion}` : null,
                          ].filter(Boolean).join(' · ')
                        : null,
                      missing: level < 2
                        ? (running ? 'WP-CLI enrichment pending' : 'Site is halted — start to enrich')
                        : null,
                    },
                    {
                      done: level >= 3,
                      label: 'Searchable',
                      detail: level >= 3 && entry
                        ? `${entry.documentCount} docs · ${entry.chunkCount} chunks`
                        : null,
                      missing: level < 3
                        ? level < 2
                          ? 'Requires Configured first'
                          : running
                          ? 'Click ⚡ Index to index content'
                          : 'Start site to index content'
                        : null,
                    },
                  ].map((row, j) =>
                    React.createElement('div', {
                      key: j,
                      style: {
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        marginBottom: j < 2 ? 6 : 0, fontSize: 11,
                      },
                    },
                      React.createElement('span', {
                        style: {
                          color: row.done ? '#51BB7B' : 'var(--nxai-card-sub, #6b7280)',
                          minWidth: 12,
                        },
                      }, row.done ? '✓' : '○'),
                      React.createElement('span', {
                        style: {
                          fontWeight: 600, minWidth: 80,
                          color: row.done
                            ? 'var(--nxai-card-text, #e6edf3)'
                            : 'var(--nxai-card-sub, #6b7280)',
                        },
                      }, row.label),
                      row.detail
                        ? React.createElement('span', {
                            style: { color: 'var(--nxai-card-sub, #6b7280)' },
                          }, row.detail)
                        : row.missing
                        ? React.createElement('span', {
                            style: { color: '#444', fontStyle: 'italic' },
                          }, row.missing)
                        : null,
                    ),
                  ),
                )
              : null,
          );
        }),
      ),
    );
  }
}
