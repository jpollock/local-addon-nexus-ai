/**
 * Per-Site Nexus AI Section
 *
 * Renders on the site overview page via `SiteInfoOverview_Addon_Section` filter.
 * Shows index status, index/reindex controls, per-site search, and auto-index toggle.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';

interface SiteNexusSectionProps {
  site: { id: string; name: string; path: string; status?: string };
  electron: any;
}

interface IndexEntry {
  siteId: string;
  state: string;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number;
}

interface UISearchResult {
  id: string;
  title: string;
  content: string;
  postType: string;
  score: number;
  siteName: string;
}

interface SiteNexusSectionState {
  indexEntry: IndexEntry | null;
  indexing: boolean;
  searchQuery: string;
  searchResults: UISearchResult[];
  searching: boolean;
  excluded: boolean;
  loading: boolean;
}

const cardStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '16px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  marginBottom: '12px',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: UI_COLORS.WPE_BRAND,
  color: '#fff',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export class SiteNexusSection extends React.Component<SiteNexusSectionProps, SiteNexusSectionState> {
  private mounted = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  state: SiteNexusSectionState = {
    indexEntry: null,
    indexing: false,
    searchQuery: '',
    searchResults: [],
    searching: false,
    excluded: false,
    loading: true,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [entries, settings] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS),
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
      ]);
      if (!this.mounted) return;
      const entry = (entries ?? []).find((e: IndexEntry) => e.siteId === this.props.site.id) ?? null;
      const nexusSettings = settings as NexusSettings | null;
      this.setState({
        indexEntry: entry,
        excluded: nexusSettings?.excludedSiteIds?.includes(this.props.site.id) ?? false,
        loading: false,
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }
  };

  handleIndex = async (): Promise<void> => {
    this.setState({ indexing: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, this.props.site.id);
      if (!this.mounted) return;
      await this.fetchData();
    } catch {
      // Error handled by refresh
    }
    if (this.mounted) this.setState({ indexing: false });
  };

  handleSearch = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const query = e.target.value;
    this.setState({ searchQuery: query });

    if (this.searchTimer) clearTimeout(this.searchTimer);

    if (!query.trim()) {
      this.setState({ searchResults: [], searching: false });
      return;
    }

    this.setState({ searching: true });
    this.searchTimer = setTimeout(async () => {
      try {
        const result = await this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.SEARCH, query, this.props.site.id, 5,
        );
        if (!this.mounted) return;
        this.setState({ searchResults: result?.results ?? [], searching: false });
      } catch {
        if (!this.mounted) return;
        this.setState({ searchResults: [], searching: false });
      }
    }, 300);
  };

  handleExclusionToggle = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const settings = (await ipc.invoke(IPC_CHANNELS.GET_SETTINGS)) as NexusSettings;
      const siteId = this.props.site.id;
      const isExcluded = settings.excludedSiteIds.includes(siteId);
      const newExcluded = isExcluded
        ? settings.excludedSiteIds.filter((id: string) => id !== siteId)
        : [...settings.excludedSiteIds, siteId];

      await ipc.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { excludedSiteIds: newExcluded });
      if (this.mounted) this.setState({ excluded: !isExcluded });
    } catch {
      // Best-effort
    }
  };

  render(): React.ReactNode {
    const { indexEntry, indexing, searchQuery, searchResults, searching, excluded, loading } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: '12px', color: 'var(--nxai-card-sub, #6b7280)', fontSize: '13px' },
      }, 'Loading...');
    }

    const dotStyle = (color: string): React.CSSProperties => ({
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: color,
      marginRight: '6px',
    });

    const stateColor = !indexEntry ? 'var(--nxai-card-sub)'
      : indexEntry.state === 'indexed' ? UI_COLORS.STATUS_RUNNING
      : indexEntry.state === 'stale' ? UI_COLORS.STATUS_WARNING
      : indexEntry.state === 'error' ? UI_COLORS.STATUS_ERROR
      : UI_COLORS.WPE_BRAND;

    return React.createElement('div', { style: { padding: '4px 0' } },
      // Index status card
      React.createElement('div', { style: cardStyle },
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
        },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' },
          },
            React.createElement('span', { style: dotStyle(stateColor) }),
            React.createElement('span', {
              style: { fontSize: '14px', fontWeight: 600, color: 'var(--nxai-card-text, #111827)' },
            }, indexEntry ? indexEntry.state.charAt(0).toUpperCase() + indexEntry.state.slice(1) : 'Not indexed'),
          ),
          React.createElement('button', {
            style: indexing ? { ...btnStyle, opacity: 0.6, cursor: 'not-allowed' } : btnStyle,
            onClick: indexing ? undefined : this.handleIndex,
            disabled: indexing,
          }, indexing ? 'Indexing...' : (indexEntry ? 'Re-index' : 'Index Now')),
        ),
        indexEntry
          ? React.createElement('div', {
              style: { fontSize: '13px', color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.6 },
            },
              `${indexEntry.documentCount.toLocaleString()} documents \u2022 ${indexEntry.chunkCount.toLocaleString()} chunks`,
              React.createElement('br'),
              `Last indexed: ${formatTimeAgo(indexEntry.lastIndexed)}`,
            )
          : React.createElement('div', {
              style: { fontSize: '13px', color: 'var(--nxai-card-sub, #6b7280)' },
            }, 'Click "Index Now" to make this site searchable by AI.'),
      ),

      // Auto-index toggle
      React.createElement('label', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 0',
          marginBottom: '12px',
        },
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: !excluded,
          onChange: this.handleExclusionToggle,
          style: { width: '14px', height: '14px', cursor: 'pointer' },
        }),
        React.createElement('span', {
          style: { fontSize: '13px', color: 'var(--nxai-card-text, #111827)' },
        }, 'Auto-index this site when started'),
      ),

      // Per-site search
      indexEntry
        ? React.createElement('div', null,
            React.createElement('input', {
              type: 'text',
              value: searchQuery,
              onChange: this.handleSearch,
              placeholder: `Search ${this.props.site.name}...`,
              style: {
                width: '100%',
                padding: '10px 14px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--nxai-input-border, #d1d5db)',
                backgroundColor: 'var(--nxai-input-bg, #fff)',
                color: 'var(--nxai-card-text)',
                outline: 'none',
                boxSizing: 'border-box' as const,
                marginBottom: '8px',
              },
            }),

            searching
              ? React.createElement('div', {
                  style: { fontSize: '12px', color: 'var(--nxai-card-sub)', padding: '8px 0' },
                }, 'Searching...')
              : null,

            searchQuery && !searching && searchResults.length === 0
              ? React.createElement('div', {
                  style: { fontSize: '12px', color: 'var(--nxai-card-sub)', padding: '8px 0' },
                }, 'No results found')
              : null,

            searchResults.map((r, i) =>
              React.createElement('div', {
                key: `${r.id}-${i}`,
                style: {
                  padding: '10px 0',
                  borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
                },
              },
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' },
                },
                  React.createElement('span', {
                    style: { fontWeight: 600, fontSize: '13px', color: 'var(--nxai-card-text)' },
                  }, r.title),
                  React.createElement('span', {
                    style: {
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(14, 202, 212, 0.1)',
                      color: UI_COLORS.WPE_BRAND,
                    },
                  }, r.postType),
                  React.createElement('span', {
                    style: { fontSize: '11px', color: 'var(--nxai-card-sub)', marginLeft: 'auto' },
                  }, `${Math.round(r.score * 100)}%`),
                ),
                React.createElement('div', {
                  style: { fontSize: '12px', color: 'var(--nxai-card-sub)', lineHeight: 1.4 },
                }, truncate(r.content, 150)),
              ),
            ),
          )
        : null,
    );
  }
}
