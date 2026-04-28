import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  siteStatus: string;
  indexState: 'indexed' | 'indexing' | 'pending' | 'not_indexed' | 'error' | 'stale';
  documentCount: number;
  lastIndexed: number | null;
}

interface SearchGroup {
  siteId: string;
  siteName: string;
  domain: string;
  results: Array<{
    id: string;
    title: string;
    content: string;
    postType: string;
  }>;
}

type SortCol = 'name' | 'lastIndexed' | 'posts';

interface State {
  loading: boolean;
  sites: SiteRow[];
  mcpRunning: boolean;
  mcpToolCount: number;

  searchQuery: string;
  searchResults: SearchGroup[];
  searching: boolean;

  indexAllRunning: boolean;
  indexProgress: { completed: number; total: number };

  showAll: boolean;
  sortBy: SortCol;
  sortDir: 'asc' | 'desc';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VISIBLE_DEFAULT = 8;

const STYLES = `
  @keyframes nxai-slide {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .nxai-indexing-bar {
    background: linear-gradient(90deg, #0ECAD4 25%, #6ee8ee 50%, #0ECAD4 75%);
    background-size: 200% 100%;
    animation: nxai-slide 1.8s linear infinite;
  }
  .nxai-search:focus {
    outline: none;
    border-color: #0ECAD4 !important;
    box-shadow: 0 0 0 3px rgba(14,202,212,0.15) !important;
  }
  .nxai-site-row:hover { background: var(--nxai-hover-bg, rgba(0,0,0,0.025)); }
  .nxai-result-row:hover { background: var(--nxai-hover-bg, rgba(0,0,0,0.025)); }
  .nxai-ghost-btn:hover { background: #0ECAD4 !important; color: #fff !important; border-color: #0ECAD4 !important; }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: number | null): string | null {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class NexusDashboard extends React.Component<{ electron: any }, State> {
  private mounted = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  state: State = {
    loading: true,
    sites: [],
    mcpRunning: false,
    mcpToolCount: 0,
    searchQuery: '',
    searchResults: [],
    searching: false,
    indexAllRunning: false,
    indexProgress: { completed: 0, total: 0 },
    showAll: false,
    sortBy: 'name',
    sortDir: 'asc',
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
    if (document.getElementById('nxai-dashboard-css')) return;
    const el = document.createElement('style');
    el.id = 'nxai-dashboard-css';
    el.textContent = STYLES;
    document.head.appendChild(el);
  }

  // ── Data ────────────────────────────────────────────────────────────────────

  private fetchAll = async () => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [rawSites, indexEntries, mcpInfo] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SITES),
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_MCP_INFO),
      ]);
      if (!this.mounted) return;

      const entryMap = new Map<string, any>();
      for (const e of (indexEntries ?? [])) entryMap.set(e.siteId, e);

      const sites: SiteRow[] = (rawSites ?? [])
        .filter((s: any) => !s.isWpe)
        .map((s: any) => {
          const e = entryMap.get(s.id);
          return {
            id: s.id,
            name: s.name,
            domain: s.domain ?? '',
            siteStatus: s.status ?? 'halted',
            indexState: e?.state ?? 'not_indexed',
            documentCount: e?.documentCount ?? 0,
            lastIndexed: e?.lastIndexed ?? null,
          };
        });

      this.setState({
        sites,
        mcpRunning: !!(mcpInfo?.running ?? mcpInfo?.url),
        mcpToolCount: mcpInfo?.tools?.length ?? 0,
        loading: false,
      });
    } catch {
      if (this.mounted) this.setState({ loading: false });
    }
  };

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

        const domainById = new Map(this.state.sites.map(s => [s.id, s.domain]));
        const groupMap = new Map<string, SearchGroup>();

        for (const r of (res?.results ?? [])) {
          if (!groupMap.has(r.siteId)) {
            groupMap.set(r.siteId, {
              siteId: r.siteId,
              siteName: r.siteName,
              domain: domainById.get(r.siteId) ?? '',
              results: [],
            });
          }
          groupMap.get(r.siteId)!.results.push({
            id: r.id,
            title: r.title,
            content: r.content,
            postType: r.postType,
          });
        }

        this.setState({ searchResults: Array.from(groupMap.values()), searching: false });
      } catch {
        if (this.mounted) this.setState({ searchResults: [], searching: false });
      }
    }, 250);
  };

  private clearSearch = () => this.setState({ searchQuery: '', searchResults: [] });

  // ── Indexing ────────────────────────────────────────────────────────────────

  private handleIndexAll = async () => {
    if (this.state.indexAllRunning) return;
    const total = this.state.sites.length;
    this.setState({ indexAllRunning: true, indexProgress: { completed: 0, total } });

    try {
      const res = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_AUTO);
      if (!this.mounted) return;
      if (res?.opId) {
        this.startPolling(res.opId);
      } else {
        this.setState({ indexAllRunning: false });
      }
    } catch {
      if (this.mounted) this.setState({ indexAllRunning: false });
    }
  };

  private handleIndexSite = async (siteId: string) => {
    this.setSiteState(siteId, 'indexing');
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, siteId);
      setTimeout(this.fetchAll, 3000);
    } catch {
      this.setSiteState(siteId, 'not_indexed');
    }
  };

  private setSiteState(siteId: string, indexState: SiteRow['indexState']) {
    this.setState(prev => ({
      sites: prev.sites.map(s => s.id === siteId ? { ...s, indexState } : s),
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
          sites: prev.sites.map(s => {
            const sr = siteResults[s.id];
            if (!sr) return s;
            if (sr.status === 'completed') return { ...s, indexState: 'indexed' };
            if (sr.status === 'running') return { ...s, indexState: 'indexing' };
            if (sr.status === 'failed') return { ...s, indexState: 'error' };
            if (sr.status === 'pending') return { ...s, indexState: 'pending' };
            return s;
          }),
        }));

        const done = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status?.status);
        if (done) {
          clearInterval(this.pollTimer!);
          this.pollTimer = null;
          this.setState({ indexAllRunning: false });
          await this.fetchAll();
        }
      } catch {
        clearInterval(this.pollTimer!);
        this.pollTimer = null;
        if (this.mounted) this.setState({ indexAllRunning: false });
      }
    }, 2000);
  }

  // ── Sorting ─────────────────────────────────────────────────────────────────

  private toggleSort = (col: SortCol) => {
    this.setState(prev => ({
      sortBy: col,
      sortDir: prev.sortBy === col && prev.sortDir === 'asc' ? 'desc' : 'asc',
    }));
  };

  private getSortedSites(): SiteRow[] {
    const { sites, sortBy, sortDir } = this.state;
    const sorted = [...sites].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'lastIndexed') cmp = (b.lastIndexed ?? 0) - (a.lastIndexed ?? 0);
      else if (sortBy === 'posts') cmp = b.documentCount - a.documentCount;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // Indexing first, then indexed, then not indexed
    const order = ['indexing', 'pending', 'indexed', 'stale', 'not_indexed', 'error'];
    return sorted.sort((a, b) => order.indexOf(a.indexState) - order.indexOf(b.indexState));
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  private btn(
    label: string,
    onClick: () => void,
    opts: { color?: string; bg?: string; disabled?: boolean; ghost?: boolean; className?: string } = {},
  ): React.ReactNode {
    const { color = 'var(--nxai-card-sub)', bg = 'transparent', disabled = false, ghost = false, className } = opts;
    return React.createElement('button', {
      className,
      onClick,
      disabled,
      style: {
        padding: '4px 10px', fontSize: '11px', fontWeight: 600,
        borderRadius: '6px', border: '1px solid var(--nxai-card-border, #e5e7eb)',
        backgroundColor: bg, color, cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap' as const, transition: 'all 0.12s',
        opacity: disabled ? 0.5 : 1,
      },
    }, label);
  }

  // ── Search bar ──────────────────────────────────────────────────────────────

  private renderSearchBar(): React.ReactNode {
    const { searchQuery, indexAllRunning, indexProgress, sites } = this.state;
    const indexedCount = sites.filter(s => s.indexState === 'indexed' || s.indexState === 'stale').length;
    const totalCount = sites.length;
    const hasIndexed = indexedCount > 0;
    const lastTs = hasIndexed
      ? Math.max(...sites.filter(s => s.lastIndexed).map(s => s.lastIndexed!))
      : null;

    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        // Input
        React.createElement('div', { style: { position: 'relative' as const, flex: 1 } },
          React.createElement('span', {
            style: { position: 'absolute' as const, left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--nxai-card-sub)', pointerEvents: 'none' as const, fontSize: '15px' },
          }, '🔍'),
          React.createElement('input', {
            className: 'nxai-search',
            type: 'text',
            value: searchQuery,
            disabled: !hasIndexed,
            placeholder: hasIndexed
              ? `Search across ${indexedCount} indexed site${indexedCount !== 1 ? 's' : ''}...`
              : 'Index your sites to search across all of them',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.handleSearch(e.target.value),
            style: {
              width: '100%', boxSizing: 'border-box' as const,
              padding: '11px 36px 11px 40px',
              fontSize: '14px',
              border: '1.5px solid var(--nxai-input-border, #d1d5db)',
              borderRadius: '10px',
              backgroundColor: hasIndexed ? 'var(--nxai-input-bg, #fff)' : 'var(--nxai-score-bg)',
              color: 'var(--nxai-card-text)',
              opacity: hasIndexed ? 1 : 0.65,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            },
          }),
          searchQuery && React.createElement('button', {
            onClick: this.clearSearch,
            style: {
              position: 'absolute' as const, right: '11px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--nxai-card-sub)', fontSize: '18px', lineHeight: 1, padding: '0',
            },
          }, '×'),
        ),
        // Index All
        React.createElement('button', {
          onClick: this.handleIndexAll,
          disabled: indexAllRunning,
          style: {
            padding: '11px 18px', fontSize: '13px', fontWeight: 600,
            borderRadius: '10px', border: 'none', flexShrink: 0,
            cursor: indexAllRunning ? 'default' : 'pointer',
            backgroundColor: indexAllRunning ? 'var(--nxai-card-border)' : UI_COLORS.WPE_BRAND,
            color: indexAllRunning ? 'var(--nxai-card-sub)' : '#fff',
            transition: 'background 0.15s',
          },
        }, indexAllRunning
          ? `Indexing ${indexProgress.completed} / ${indexProgress.total}...`
          : indexedCount === totalCount && totalCount > 0 ? 'Re-index All' : 'Index All Sites',
        ),
      ),
      // Status line
      React.createElement('div', {
        style: { marginTop: '7px', fontSize: '12px', color: 'var(--nxai-card-sub)', display: 'flex', gap: '6px' },
      },
        React.createElement('span', null, `${indexedCount} of ${totalCount} sites indexed`),
        lastTs && React.createElement('span', null, `· last indexed ${relativeTime(lastTs)}`),
      ),
    );
  }

  // ── Site table ──────────────────────────────────────────────────────────────

  private renderSiteTable(): React.ReactNode {
    const { showAll, sortBy, sortDir } = this.state;
    const sorted = this.getSortedSites();
    const visible = showAll ? sorted : sorted.slice(0, VISIBLE_DEFAULT);
    const hasMore = sorted.length > VISIBLE_DEFAULT;

    const sortLabel = (col: SortCol, label: string) => {
      const active = sortBy === col;
      return React.createElement('button', {
        onClick: () => this.toggleSort(col),
        style: {
          background: 'none', border: 'none', cursor: 'pointer', padding: '0',
          fontSize: '11px', fontWeight: active ? 700 : 500,
          color: active ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
        },
      }, label + (active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''));
    };

    return React.createElement('div', null,
      // Header row
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', padding: '0 2px' },
      },
        React.createElement('span', {
          style: { flex: 1, fontSize: '11px', fontWeight: 700, color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, letterSpacing: '0.6px' },
        }, 'Sites'),
        React.createElement('span', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } }, 'Sort by'),
        sortLabel('name', 'Name'),
        sortLabel('lastIndexed', 'Indexed'),
        sortLabel('posts', 'Posts'),
      ),
      // Table
      React.createElement('div', {
        style: {
          border: '1px solid var(--nxai-card-border, #e5e7eb)',
          borderRadius: '10px',
          overflow: 'hidden',
        },
      },
        ...visible.map((site, i) => this.renderSiteRow(site, i === visible.length - 1)),
      ),
      // Show more
      hasMore && React.createElement('button', {
        onClick: () => this.setState(prev => ({ showAll: !prev.showAll })),
        style: {
          marginTop: '8px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '12px', color: UI_COLORS.WPE_BRAND, fontWeight: 600, padding: '4px 0',
          display: 'block',
        },
      }, showAll ? 'Show less ↑' : `Show all ${sorted.length} sites ↓`),
    );
  }

  private renderSiteRow(site: SiteRow, isLast: boolean): React.ReactNode {
    const ipc = this.props.electron.ipcRenderer;
    const openInLocal = () => ipc.invoke(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, { siteId: site.id });
    const openWpAdmin = () => this.props.electron.shell?.openExternal(`http://${site.domain}/wp-admin/`);

    const isIndexed = site.indexState === 'indexed' || site.indexState === 'stale';
    const isIndexing = site.indexState === 'indexing' || site.indexState === 'pending';
    const isError = site.indexState === 'error';

    // Progress bar
    const bar = React.createElement('div', {
      style: { height: '3px', borderRadius: '2px', backgroundColor: 'var(--nxai-card-border, #e5e7eb)', overflow: 'hidden', marginBottom: '4px' },
    },
      (isIndexed || isIndexing) && React.createElement('div', {
        className: isIndexing ? 'nxai-indexing-bar' : undefined,
        style: {
          height: '100%', borderRadius: '2px',
          width: isIndexed ? '100%' : '50%',
          backgroundColor: isIndexing ? undefined : isError ? UI_COLORS.STATUS_ERROR : UI_COLORS.WPE_BRAND,
        },
      }),
    );

    const statusText = isIndexed
      ? `${site.documentCount} post${site.documentCount !== 1 ? 's' : ''}${relativeTime(site.lastIndexed) ? ' · ' + relativeTime(site.lastIndexed) : ''}`
      : isIndexing ? 'indexing...'
      : isError ? 'index failed'
      : 'not indexed';

    return React.createElement('div', {
      key: site.id,
      className: 'nxai-site-row',
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 180px auto',
        alignItems: 'center',
        gap: '20px',
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--nxai-card-border, #e5e7eb)',
        transition: 'background 0.1s',
      },
    },
      // Name + domain
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: '1px' } }, site.name),
        React.createElement('div', { style: { fontSize: '11px', color: 'var(--nxai-card-sub)' } }, site.domain),
      ),
      // Progress + status
      React.createElement('div', null,
        bar,
        React.createElement('div', {
          style: { fontSize: '11px', color: isError ? UI_COLORS.STATUS_ERROR : 'var(--nxai-card-sub)' },
        }, statusText),
      ),
      // Actions
      React.createElement('div', { style: { display: 'flex', gap: '6px' } },
        !isIndexed && !isIndexing && this.btn('Index', () => this.handleIndexSite(site.id), { className: 'nxai-ghost-btn' }),
        this.btn('Open', openInLocal, { color: UI_COLORS.WPE_BRAND }),
        site.domain && this.btn('WP Admin', openWpAdmin),
      ),
    );
  }

  // ── Search results ──────────────────────────────────────────────────────────

  private renderSearchResults(): React.ReactNode {
    const { searchQuery, searchResults, searching } = this.state;

    if (searching) {
      return React.createElement('div', {
        style: { padding: '48px 0', textAlign: 'center' as const, color: 'var(--nxai-card-sub)', fontSize: '13px' },
      }, 'Searching...');
    }

    if (!searchResults.length) {
      return React.createElement('div', {
        style: { padding: '48px 0', textAlign: 'center' as const },
      },
        React.createElement('div', { style: { fontSize: '14px', color: 'var(--nxai-card-text)', marginBottom: '4px' } },
          `No results for "${searchQuery}"`),
        React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } },
          'Try different words, or index more sites'),
      );
    }

    const total = searchResults.reduce((n, g) => n + g.results.length, 0);

    return React.createElement('div', null,
      React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)', marginBottom: '14px' } },
        `${total} result${total !== 1 ? 's' : ''} across ${searchResults.length} site${searchResults.length !== 1 ? 's' : ''}`),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: '12px' } },
        ...searchResults.map(g => this.renderResultGroup(g)),
      ),
    );
  }

  private renderResultGroup(group: SearchGroup): React.ReactNode {
    const ipc = this.props.electron.ipcRenderer;
    const openInLocal = () => ipc.invoke(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, { siteId: group.siteId });
    const openWpAdmin = () => group.domain && this.props.electron.shell?.openExternal(`http://${group.domain}/wp-admin/`);

    return React.createElement('div', {
      key: group.siteId,
      style: { border: '1px solid var(--nxai-card-border, #e5e7eb)', borderRadius: '10px', overflow: 'hidden' },
    },
      // Group header
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px',
          backgroundColor: 'var(--nxai-score-bg, rgba(0,0,0,0.025))',
          borderBottom: '1px solid var(--nxai-card-border)',
        },
      },
        React.createElement('span', {
          style: { fontSize: '11px', fontWeight: 700, color: 'var(--nxai-card-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
        }, group.siteName),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          this.btn('Open in Local', openInLocal, { color: UI_COLORS.WPE_BRAND }),
          group.domain && this.btn('WP Admin', openWpAdmin),
        ),
      ),
      // Results
      ...group.results.map((r, i) =>
        React.createElement('div', {
          key: r.id,
          className: 'nxai-result-row',
          style: {
            padding: '10px 14px',
            borderBottom: i < group.results.length - 1 ? '1px solid var(--nxai-card-border)' : 'none',
            transition: 'background 0.1s',
          },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' } },
            React.createElement('span', {
              style: {
                fontSize: '10px', fontWeight: 600, letterSpacing: '0.4px',
                padding: '1px 5px', borderRadius: '4px',
                backgroundColor: 'var(--nxai-score-bg)',
                color: 'var(--nxai-card-sub)',
                textTransform: 'uppercase' as const, flexShrink: 0,
              },
            }, r.postType),
            React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--nxai-card-text)' } },
              r.title || '(untitled)'),
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
  }

  // ── Footer ──────────────────────────────────────────────────────────────────

  private renderFooter(): React.ReactNode {
    const { mcpRunning, mcpToolCount } = this.state;

    const pill = (active: boolean, label: string) =>
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 10px', borderRadius: '20px',
          border: '1px solid var(--nxai-card-border, #e5e7eb)',
          fontSize: '11px', color: 'var(--nxai-card-sub)',
        },
      },
        React.createElement('span', {
          style: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, backgroundColor: active ? UI_COLORS.WPE_BRAND : UI_COLORS.STATUS_HALTED },
        }),
        label,
      );

    return React.createElement('div', {
      style: {
        display: 'flex', gap: '8px', flexWrap: 'wrap' as const,
        paddingTop: '16px', marginTop: '20px',
        borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
      },
    },
      pill(mcpRunning, mcpRunning ? `MCP connected · ${mcpToolCount} tools` : 'MCP not connected'),
    );
  }

  // ── Root render ─────────────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { loading, searchQuery } = this.state;
    const isSearchActive = searchQuery.trim().length > 0;

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
      // Fixed header
      React.createElement('div', { style: { flexShrink: 0, padding: '28px 32px 16px' } },
        React.createElement('div', { style: { marginBottom: '20px' } },
          React.createElement('h1', {
            style: { fontSize: '20px', fontWeight: 700, margin: '0 0 3px', color: 'var(--nxai-card-text)' },
          }, 'Nexus AI'),
          React.createElement('p', {
            style: { fontSize: '13px', color: 'var(--nxai-card-sub)', margin: 0 },
          }, 'Search and manage your WordPress sites'),
        ),
        this.renderSearchBar(),
      ),
      // Scrollable body
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto' as const, padding: '0 32px 28px' },
      },
        isSearchActive ? this.renderSearchResults() : this.renderSiteTable(),
        this.renderFooter(),
      ),
    );
  }
}
