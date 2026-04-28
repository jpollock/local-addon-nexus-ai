import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalSite {
  id: string;
  name: string;
  domain: string;
  searchable: boolean;
  adding: boolean; // in-progress add-to-search
  documentCount: number;
  lastIndexed: number | null;
}

interface WpeSite {
  id: string;
  name: string;
  domain: string;
  synced: boolean;
  lastSynced: number | null;
}

interface SearchGroup {
  siteId: string;
  siteName: string;
  domain: string;
  results: Array<{ id: string; title: string; content: string; postType: string }>;
}

type Tab = 'sites' | 'search';

interface State {
  loading: boolean;
  activeTab: Tab;

  localSites: LocalSite[];
  wpeSites: WpeSite[];
  wpeAuthenticated: boolean;

  makingAllSearchable: boolean;
  indexProgress: { completed: number; total: number };

  searchQuery: string;
  searchResults: SearchGroup[];
  searching: boolean;

  mcpRunning: boolean;
  mcpToolCount: number;
  startupError: string | null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
  @keyframes nxai-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .nxai-adding-bar {
    background: linear-gradient(90deg, #0ECAD4 25%, #6ee8ee 50%, #0ECAD4 75%);
    background-size: 200% 100%;
    animation: nxai-shimmer 1.6s linear infinite;
    width: 60% !important;
  }
  .nxai-search-input:focus {
    outline: none;
    border-color: #0ECAD4 !important;
    box-shadow: 0 0 0 3px rgba(14,202,212,0.15) !important;
  }
  .nxai-row:hover { background: var(--nxai-hover, rgba(0,0,0,0.025)); }
  .nxai-add-btn:hover {
    background: #0ECAD4 !important;
    color: #fff !important;
    border-color: #0ECAD4 !important;
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ago(ts: number | null): string | null {
  if (!ts) return null;
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

const card: React.CSSProperties = {
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  borderRadius: '10px',
  overflow: 'hidden',
};

const sectionLabel = (text: string): React.ReactNode =>
  React.createElement('div', {
    style: {
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px',
      textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub)',
      margin: '20px 0 8px',
    },
  }, text);

// ── Component ─────────────────────────────────────────────────────────────────

export class NexusDashboard extends React.Component<{ electron: any }, State> {
  private mounted = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  state: State = {
    loading: true,
    activeTab: 'sites',
    localSites: [],
    wpeSites: [],
    wpeAuthenticated: false,
    makingAllSearchable: false,
    indexProgress: { completed: 0, total: 0 },
    searchQuery: '',
    searchResults: [],
    searching: false,
    mcpRunning: false,
    mcpToolCount: 0,
    startupError: null,
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async componentDidMount() {
    this.mounted = true;
    this.injectStyles();
    await this.fetchAll();
  }

  componentWillUnmount() {
    this.mounted = false;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private injectStyles() {
    if (document.getElementById('nxai-dash-css')) return;
    const el = document.createElement('style');
    el.id = 'nxai-dash-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ── Data ────────────────────────────────────────────────────────────────────

  private fetchAll = async () => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [rawSites, indexEntries, mcpInfo, wpeSitesResult, startupStatus] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
        ipc.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES),
        ipc.invoke(IPC_CHANNELS.GET_STARTUP_STATUS),
      ]);
      if (!this.mounted) return;

      const entryMap = new Map<string, any>();
      for (const e of (indexEntries ?? [])) entryMap.set(e.siteId, e);

      const localSites: LocalSite[] = (rawSites ?? [])
        .filter((s: any) => !s.isWpe)
        .map((s: any) => {
          const e = entryMap.get(s.id);
          const state = e?.state ?? 'not_indexed';
          return {
            id: s.id,
            name: s.name,
            domain: s.domain ?? '',
            searchable: state === 'indexed' || state === 'stale',
            adding: state === 'indexing',
            documentCount: e?.documentCount ?? 0,
            lastIndexed: e?.lastIndexed ?? null,
          };
        });

      const wpeSites: WpeSite[] = (wpeSitesResult?.sites ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        domain: s.domain ?? '',
        synced: true,
        lastSynced: s.lastSynced ?? null,
      }));

      this.setState({
        localSites,
        wpeSites,
        wpeAuthenticated: !wpeSitesResult?.wpeAuthError && wpeSites.length > 0,
        mcpRunning: !!(mcpInfo?.running ?? mcpInfo?.url),
        mcpToolCount: mcpInfo?.tools?.length ?? 0,
        startupError: startupStatus?.error?.message ?? null,
        loading: false,
      });
    } catch {
      if (this.mounted) this.setState({ loading: false });
    }
  };

  // ── Make searchable ─────────────────────────────────────────────────────────

  private makeAllSearchable = async () => {
    if (this.state.makingAllSearchable) return;
    const total = this.state.localSites.filter(s => !s.searchable).length || this.state.localSites.length;
    this.setState({ makingAllSearchable: true, indexProgress: { completed: 0, total } });

    try {
      const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_AUTO);
      if (!this.mounted) return;
      if (res?.opId) {
        this.startPolling(res.opId);
      } else {
        this.setState({ makingAllSearchable: false });
      }
    } catch {
      if (this.mounted) this.setState({ makingAllSearchable: false });
    }
  };

  private addToSearch = async (siteId: string) => {
    this.setLocalSite(siteId, { adding: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, siteId);
      setTimeout(this.fetchAll, 3000);
    } catch {
      this.setLocalSite(siteId, { adding: false });
    }
  };

  private setLocalSite(siteId: string, patch: Partial<LocalSite>) {
    this.setState(prev => ({
      localSites: prev.localSites.map(s => s.id === siteId ? { ...s, ...patch } : s),
    }));
  }

  private startPolling(opId: string) {
    this.pollTimer = setInterval(async () => {
      try {
        const status = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.BULK_STATUS, opId);
        if (!this.mounted) return;

        const progress = status?.progress ?? { completed: 0, total: 0 };
        const siteResults: Record<string, { status: string }> = status?.siteResults ?? {};

        this.setState(prev => ({
          indexProgress: progress,
          localSites: prev.localSites.map(s => {
            const sr = siteResults[s.id];
            if (!sr) return s;
            if (sr.status === 'completed') return { ...s, searchable: true, adding: false };
            if (sr.status === 'running') return { ...s, adding: true };
            return s;
          }),
        }));

        if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status?.status)) {
          clearInterval(this.pollTimer!);
          this.pollTimer = null;
          this.setState({ makingAllSearchable: false });
          await this.fetchAll();
        }
      } catch {
        clearInterval(this.pollTimer!);
        this.pollTimer = null;
        if (this.mounted) this.setState({ makingAllSearchable: false });
      }
    }, 2000);
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  private handleSearch = (query: string) => {
    this.setState({ searchQuery: query });
    if (this.searchTimer) clearTimeout(this.searchTimer);

    if (!query.trim()) {
      this.setState({ searchResults: [], searching: false });
      return;
    }

    this.setState({ searching: true });
    this.searchTimer = setTimeout(async () => {
      try {
        const res = await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.SEARCH_UNIFIED, { query: query.trim(), options: { limit: 30 } },
        );
        if (!this.mounted) return;

        const domainMap = new Map([
          ...this.state.localSites.map(s => [s.id, s.domain] as [string, string]),
          ...this.state.wpeSites.map(s => [s.id, s.domain] as [string, string]),
        ]);

        const groupMap = new Map<string, SearchGroup>();
        for (const r of (res?.results ?? [])) {
          if (!groupMap.has(r.siteId)) {
            groupMap.set(r.siteId, { siteId: r.siteId, siteName: r.siteName, domain: domainMap.get(r.siteId) ?? '', results: [] });
          }
          groupMap.get(r.siteId)!.results.push({ id: r.id, title: r.title, content: r.content, postType: r.postType });
        }

        this.setState({ searchResults: Array.from(groupMap.values()), searching: false });
      } catch {
        if (this.mounted) this.setState({ searchResults: [], searching: false });
      }
    }, 250);
  };

  // ── Render: tab bar ─────────────────────────────────────────────────────────

  private renderTabBar(): React.ReactNode {
    const { activeTab, localSites } = this.state;
    const searchableCount = localSites.filter(s => s.searchable).length;

    const tab = (key: Tab, label: string) => {
      const active = activeTab === key;
      return React.createElement('button', {
        key,
        onClick: () => this.setState({ activeTab: key }),
        style: {
          padding: '10px 18px',
          fontSize: '13px', fontWeight: 600,
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: active ? `2.5px solid ${UI_COLORS.WPE_BRAND}` : '2.5px solid transparent',
          color: active ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
          marginBottom: '-1px',
        },
      }, label);
    };

    return React.createElement('div', {
      style: {
        display: 'flex',
        borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
        marginBottom: '0',
      },
    },
      tab('search', 'Search'),
      tab('sites', searchableCount > 0 ? `Sites · ${searchableCount} searchable` : 'Sites'),
    );
  }

  // ── Render: banners ─────────────────────────────────────────────────────────

  private renderBanners(): React.ReactNode {
    const { startupError, wpeAuthenticated, wpeSites } = this.state;
    const banners: React.ReactNode[] = [];

    if (startupError) {
      banners.push(React.createElement('div', {
        key: 'startup',
        style: {
          padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
          backgroundColor: 'rgba(239,68,68,0.08)', border: `1px solid ${UI_COLORS.STATUS_ERROR}`,
          color: UI_COLORS.STATUS_ERROR, marginBottom: '12px',
          display: 'flex', alignItems: 'center', gap: '8px',
        },
      },
        React.createElement('span', null, '⚠'),
        React.createElement('span', null, `System error: ${startupError}`),
      ));
    }

    if (!wpeAuthenticated && wpeSites.length === 0) {
      banners.push(React.createElement('div', {
        key: 'wpe-auth',
        style: {
          padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
          backgroundColor: 'rgba(245,158,11,0.08)', border: `1px solid ${UI_COLORS.STATUS_WARNING}`,
          color: UI_COLORS.STATUS_WARNING, marginBottom: '12px',
          display: 'flex', alignItems: 'center', gap: '8px',
        },
      },
        React.createElement('span', null, '⚠'),
        React.createElement('span', null, 'Not connected to WP Engine — your WPE sites won\'t appear here.'),
      ));
    }

    return banners.length > 0
      ? React.createElement('div', null, ...banners)
      : null;
  }

  // ── Render: search tab ──────────────────────────────────────────────────────

  private renderSearchTab(): React.ReactNode {
    const { searchQuery, searchResults, searching, localSites } = this.state;
    const searchableCount = localSites.filter(s => s.searchable).length;
    const hasSearchable = searchableCount > 0;
    const hasQuery = searchQuery.trim().length > 0;

    return React.createElement('div', null,
      // Search input
      React.createElement('div', { style: { marginBottom: '24px' } },
        React.createElement('div', { style: { position: 'relative' as const } },
          React.createElement('span', {
            style: {
              position: 'absolute' as const, left: '14px', top: '50%',
              transform: 'translateY(-50%)', fontSize: '16px',
              color: 'var(--nxai-card-sub)', pointerEvents: 'none' as const,
            },
          }, '🔍'),
          React.createElement('input', {
            className: 'nxai-search-input',
            type: 'text',
            autoFocus: true,
            value: searchQuery,
            disabled: !hasSearchable,
            placeholder: hasSearchable
              ? `Search across ${searchableCount} searchable site${searchableCount !== 1 ? 's' : ''}...`
              : 'No sites are searchable yet — go to Sites to get started',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.handleSearch(e.target.value),
            style: {
              width: '100%', boxSizing: 'border-box' as const,
              padding: '13px 40px 13px 44px', fontSize: '15px',
              border: '1.5px solid var(--nxai-input-border, #d1d5db)',
              borderRadius: '10px',
              backgroundColor: hasSearchable ? 'var(--nxai-input-bg, #fff)' : 'var(--nxai-score-bg)',
              color: 'var(--nxai-card-text)',
              opacity: hasSearchable ? 1 : 0.65,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            },
          }),
          searchQuery && React.createElement('button', {
            onClick: () => this.setState({ searchQuery: '', searchResults: [] }),
            style: {
              position: 'absolute' as const, right: '12px', top: '50%',
              transform: 'translateY(-50%)', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--nxai-card-sub)', fontSize: '20px',
              lineHeight: 1, padding: 0,
            },
          }, '×'),
        ),
      ),

      // Body
      !hasSearchable
        ? this.renderSearchEmptyState()
        : !hasQuery
          ? null
          : searching
            ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '48px 0', fontSize: '13px', color: 'var(--nxai-card-sub)' } }, 'Searching...')
            : searchResults.length === 0
              ? this.renderNoResults()
              : this.renderSearchResults(),
    );
  }

  private renderSearchEmptyState(): React.ReactNode {
    return React.createElement('div', {
      style: { textAlign: 'center' as const, padding: '64px 32px' },
    },
      React.createElement('div', { style: { fontSize: '36px', marginBottom: '16px' } }, '🔍'),
      React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '8px' } },
        'Your sites aren\'t searchable yet'),
      React.createElement('div', { style: { fontSize: '13px', color: 'var(--nxai-card-sub)', marginBottom: '24px', lineHeight: 1.5 } },
        'Add sites to search and find anything across\nyour WordPress content instantly.'),
      React.createElement('button', {
        onClick: () => this.setState({ activeTab: 'sites' }),
        style: {
          padding: '10px 20px', fontSize: '13px', fontWeight: 600,
          borderRadius: '8px', border: 'none', cursor: 'pointer',
          backgroundColor: UI_COLORS.WPE_BRAND, color: '#fff',
        },
      }, 'Make Sites Searchable →'),
    );
  }

  private renderNoResults(): React.ReactNode {
    const { searchQuery } = this.state;
    return React.createElement('div', { style: { textAlign: 'center' as const, padding: '48px 0' } },
      React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '6px' } },
        `No results for "${searchQuery}"`),
      React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
        'Try different words, or make more sites searchable'),
    );
  }

  private renderSearchResults(): React.ReactNode {
    const { searchResults } = this.state;
    const total = searchResults.reduce((n, g) => n + g.results.length, 0);
    const ipc = this.props.electron.ipcRenderer;

    return React.createElement('div', null,
      React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)', marginBottom: '14px' } },
        `${total} result${total !== 1 ? 's' : ''} across ${searchResults.length} site${searchResults.length !== 1 ? 's' : ''}`),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '12px' } },
        ...searchResults.map(group => {
          const openInLocal = () => ipc.invoke(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, { siteId: group.siteId });
          const openWpAdmin = () => group.domain && this.props.electron.shell?.openExternal(`http://${group.domain}/wp-admin/`);

          return React.createElement('div', { key: group.siteId, style: card },
            // Group header
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px',
                backgroundColor: 'var(--nxai-score-bg, rgba(0,0,0,0.025))',
                borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
              },
            },
              React.createElement('span', {
                style: { fontSize: '11px', fontWeight: 700, color: 'var(--nxai-card-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
              }, group.siteName),
              React.createElement('div', { style: { display: 'flex', gap: '6px' } },
                this.ghostBtn('Open in Local', openInLocal, { color: UI_COLORS.WPE_BRAND }),
                group.domain && this.ghostBtn('WP Admin', openWpAdmin),
              ),
            ),
            // Results
            ...group.results.map((r, i) =>
              React.createElement('div', {
                key: r.id,
                className: 'nxai-row',
                style: {
                  padding: '10px 14px',
                  borderBottom: i < group.results.length - 1 ? '1px solid var(--nxai-card-border)' : 'none',
                  transition: 'background 0.1s',
                },
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' } },
                  React.createElement('span', {
                    style: {
                      fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px',
                      backgroundColor: 'var(--nxai-score-bg)', color: 'var(--nxai-card-sub)',
                      textTransform: 'uppercase' as const, letterSpacing: '0.4px', flexShrink: 0,
                    },
                  }, r.postType),
                  React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)' } }, r.title || '(untitled)'),
                ),
                React.createElement('p', {
                  style: {
                    margin: 0, fontSize: '12px', color: 'var(--nxai-card-sub)', lineHeight: 1.5,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
                  },
                }, r.content),
              ),
            ),
          );
        }),
      ),
    );
  }

  // ── Render: sites tab ───────────────────────────────────────────────────────

  private renderSitesTab(): React.ReactNode {
    const { localSites, wpeSites, wpeAuthenticated, makingAllSearchable, indexProgress } = this.state;
    const searchableCount = localSites.filter(s => s.searchable).length;
    const allSearchable = searchableCount === localSites.length && localSites.length > 0;

    return React.createElement('div', null,
      // Progress banner when running
      makingAllSearchable && React.createElement('div', {
        style: {
          padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
          backgroundColor: 'rgba(14,202,212,0.08)',
          border: `1px solid ${UI_COLORS.WPE_BRAND}`,
          color: UI_COLORS.WPE_BRAND, marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '8px',
        },
      },
        React.createElement('span', { style: { animation: 'nxai-shimmer 1s linear infinite' } }, '⟳'),
        React.createElement('span', null,
          `Making sites searchable... ${indexProgress.completed} of ${indexProgress.total} done`),
      ),

      // Local sites
      sectionLabel('Local Sites'),
      localSites.length === 0
        ? React.createElement('div', { style: { fontSize: '13px', color: 'var(--nxai-card-sub)', padding: '12px 0' } }, 'No local sites found.')
        : React.createElement('div', null,
            React.createElement('div', { style: card },
              ...localSites.map((site, i) => this.renderLocalSiteRow(site, i === localSites.length - 1)),
            ),
            !allSearchable && React.createElement('button', {
              onClick: this.makeAllSearchable,
              disabled: makingAllSearchable,
              style: {
                marginTop: '10px', padding: '9px 16px', fontSize: '12px', fontWeight: 600,
                borderRadius: '8px', border: `1px solid ${UI_COLORS.WPE_BRAND}`,
                backgroundColor: 'transparent', color: UI_COLORS.WPE_BRAND,
                cursor: makingAllSearchable ? 'default' : 'pointer',
                opacity: makingAllSearchable ? 0.6 : 1,
              },
            }, makingAllSearchable ? 'Working...' : 'Make All Local Sites Searchable'),
          ),

      // WPE sites
      sectionLabel('WP Engine Sites'),
      !wpeAuthenticated
        ? React.createElement('div', { style: { fontSize: '13px', color: 'var(--nxai-card-sub)', padding: '12px 0' } },
            'Connect to WP Engine to see your remote sites here.')
        : wpeSites.length === 0
          ? React.createElement('div', { style: { fontSize: '13px', color: 'var(--nxai-card-sub)', padding: '12px 0' } },
              'No WPE sites synced yet.')
          : React.createElement('div', { style: card },
              ...wpeSites.map((site, i) => this.renderWpeSiteRow(site, i === wpeSites.length - 1)),
            ),
    );
  }

  private renderLocalSiteRow(site: LocalSite, isLast: boolean): React.ReactNode {
    const ipc = this.props.electron.ipcRenderer;
    const openInLocal = () => ipc.invoke(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, { siteId: site.id });
    const openWpAdmin = () => site.domain && this.props.electron.shell?.openExternal(`http://${site.domain}/wp-admin/`);

    return React.createElement('div', {
      key: site.id,
      className: 'nxai-row',
      style: {
        display: 'grid', gridTemplateColumns: '1fr 160px auto',
        alignItems: 'center', gap: '16px',
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--nxai-card-border, #e5e7eb)',
        transition: 'background 0.1s',
      },
    },
      // Name
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '1px' } }, site.name),
        React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } }, site.domain),
      ),
      // Status
      React.createElement('div', null,
        React.createElement('div', {
          style: { height: '3px', borderRadius: '2px', backgroundColor: 'var(--nxai-card-border, #e5e7eb)', overflow: 'hidden', marginBottom: '4px' },
        },
          (site.searchable || site.adding) && React.createElement('div', {
            className: site.adding ? 'nxai-adding-bar' : undefined,
            style: {
              height: '100%', borderRadius: '2px',
              width: site.searchable ? '100%' : undefined,
              backgroundColor: site.adding ? undefined : UI_COLORS.WPE_BRAND,
            },
          }),
        ),
        React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } },
          site.searchable
            ? `${site.documentCount} post${site.documentCount !== 1 ? 's' : ''} · ${ago(site.lastIndexed) ?? ''}`
            : site.adding ? 'making searchable...'
            : 'not in search',
        ),
      ),
      // Actions
      React.createElement('div', { style: { display: 'flex', gap: '6px' } },
        !site.searchable && !site.adding && this.ghostBtn('Add to Search', () => this.addToSearch(site.id), { className: 'nxai-add-btn' }),
        this.ghostBtn('Open', openInLocal, { color: UI_COLORS.WPE_BRAND }),
        site.domain && this.ghostBtn('WP Admin', openWpAdmin),
      ),
    );
  }

  private renderWpeSiteRow(site: WpeSite, isLast: boolean): React.ReactNode {
    return React.createElement('div', {
      key: site.id,
      style: {
        display: 'grid', gridTemplateColumns: '1fr 160px',
        alignItems: 'center', gap: '16px',
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--nxai-card-border, #e5e7eb)',
      },
    },
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '1px' } }, site.name),
        React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } }, site.domain),
      ),
      React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } },
        site.synced ? `synced${ago(site.lastSynced) ? ' · ' + ago(site.lastSynced) : ''}` : 'not synced',
      ),
    );
  }

  // ── Render: footer ──────────────────────────────────────────────────────────

  private renderFooter(): React.ReactNode {
    const { mcpRunning, mcpToolCount, wpeAuthenticated } = this.state;

    const pill = (active: boolean, label: string) =>
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '4px 10px', borderRadius: '20px',
          border: '1px solid var(--nxai-card-border, #e5e7eb)',
          fontSize: '11px', color: 'var(--nxai-card-sub)',
        },
      },
        React.createElement('span', {
          style: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, backgroundColor: active ? UI_COLORS.WPE_BRAND : '#9ca3af' },
        }),
        label,
      );

    return React.createElement('div', {
      style: {
        display: 'flex', gap: '8px', flexWrap: 'wrap' as const,
        padding: '14px 32px', borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
        flexShrink: 0,
      },
    },
      pill(mcpRunning, mcpRunning ? `MCP · ${mcpToolCount} tools` : 'MCP not connected'),
      pill(wpeAuthenticated, wpeAuthenticated ? 'WPE authenticated' : 'WPE not connected'),
    );
  }

  // ── Shared UI ───────────────────────────────────────────────────────────────

  private ghostBtn(
    label: string,
    onClick: () => void,
    opts: { color?: string; className?: string } = {},
  ): React.ReactNode {
    return React.createElement('button', {
      className: opts.className,
      onClick,
      style: {
        padding: '4px 10px', fontSize: '11px', fontWeight: 600,
        borderRadius: '6px', border: '1px solid var(--nxai-card-border, #e5e7eb)',
        backgroundColor: 'transparent', color: opts.color ?? 'var(--nxai-card-sub)',
        cursor: 'pointer', whiteSpace: 'nowrap' as const, transition: 'all 0.12s',
      },
    }, label);
  }

  // ── Root render ─────────────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { loading, activeTab } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: '40px 32px', color: 'var(--nxai-card-sub)', fontSize: '13px' },
      }, 'Loading...');
    }

    return React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column' as const,
        height: '100%', overflow: 'hidden', color: 'var(--nxai-card-text)',
      },
    },
      // Header
      React.createElement('div', { style: { flexShrink: 0, padding: '24px 32px 0' } },
        React.createElement('h1', {
          style: { fontSize: '20px', fontWeight: 700, margin: '0 0 16px', color: 'var(--nxai-card-text)' },
        }, 'Nexus AI'),
        this.renderTabBar(),
      ),

      // Body
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto' as const, padding: '20px 32px' },
      },
        this.renderBanners(),
        activeTab === 'search' ? this.renderSearchTab() : this.renderSitesTab(),
      ),

      // Footer
      this.renderFooter(),
    );
  }
}
