/**
 * SearchTab — Unified fleet search.
 *
 * One search box queries both content vectors (LanceDB) and fleet metadata
 * (graph.db plugins/themes/versions). Results appear in tabbed columns:
 * All / Sites / Content.
 *
 * Mode pills: Auto (intent-detected) | Content | Site Metadata
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { UnifiedSearchResponse, MetadataSearchResult, ContentSearchResult } from '../../common/types';

type SearchMode = 'auto' | 'content' | 'metadata';
type ResultTab = 'all' | 'sites' | 'content';

interface SearchTabProps {
  electron: any;
  indexedCount: number;
  totalSites: number;
  hasApiKey: boolean;
}

interface SearchTabState {
  query: string;
  mode: SearchMode;
  activeResultTab: ResultTab;
  searching: boolean;
  response: UnifiedSearchResponse | null;
}

export class SearchTab extends React.Component<SearchTabProps, SearchTabState> {
  private mounted = false;

  state: SearchTabState = {
    query: '',
    mode: 'auto',
    activeResultTab: 'all',
    searching: false,
    response: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  handleSearch = async (): Promise<void> => {
    const q = this.state.query.trim();
    if (!q) return;
    this.setState({ searching: true, response: null });

    const res: UnifiedSearchResponse | null = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.SEARCH_UNIFIED, { query: q, mode: this.state.mode, limit: 15 })
      .catch(() => null);

    if (!this.mounted) return;

    let activeResultTab: ResultTab = 'all';
    if (res) {
      if (res.metadataResults.length > 0 && res.contentResults.length === 0) activeResultTab = 'sites';
      else if (res.contentResults.length > 0 && res.metadataResults.length === 0) activeResultTab = 'content';
    }

    this.setState({ searching: false, response: res, activeResultTab });
  };

  renderModePills(): React.ReactNode {
    const { mode } = this.state;
    const { hasApiKey } = this.props;
    const pills: Array<{ key: SearchMode; label: string }> = [
      { key: 'auto', label: 'Auto' },
      { key: 'content', label: 'Content' },
      { key: 'metadata', label: 'Site Metadata' },
    ];
    return React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 },
    },
      ...pills.map(p =>
        React.createElement('button', {
          key: p.key,
          onClick: () => this.setState({ mode: p.key }),
          style: {
            padding: '4px 12px', borderRadius: 20, fontSize: 11,
            fontWeight: p.key === mode ? 700 : 400,
            background: p.key === mode ? 'rgba(14,202,212,0.15)' : 'transparent',
            color: p.key === mode ? '#0ECAD4' : 'var(--nxai-card-sub, #6b7280)',
            border: `1px solid ${p.key === mode ? 'rgba(14,202,212,0.3)' : 'var(--nxai-card-border, #30363d)'}`,
            cursor: 'pointer', fontFamily: 'inherit',
          },
        }, (p.key === 'auto' && mode === 'auto' ? '● ' : '') + p.label),
      ),
      React.createElement('span', {
        style: { fontSize: 10, color: hasApiKey ? '#0ECAD4' : 'var(--nxai-card-sub, #6b7280)', marginLeft: 6 },
      }, hasApiKey ? '✦ AI-powered' : 'Heuristic intent'),
    );
  }

  renderResultTabs(metaCount: number, contentCount: number): React.ReactNode {
    const { activeResultTab } = this.state;
    const total = metaCount + contentCount;
    const tabs: Array<{ key: ResultTab; label: string; count: number }> = [
      { key: 'all',     label: 'All',     count: total },
      { key: 'sites',   label: 'Sites',   count: metaCount },
      { key: 'content', label: 'Content', count: contentCount },
    ];
    return React.createElement('div', {
      style: {
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--nxai-card-border, #30363d)',
        marginBottom: 12,
      },
    },
      ...tabs.map(t =>
        React.createElement('button', {
          key: t.key,
          onClick: () => this.setState({ activeResultTab: t.key }),
          style: {
            padding: '6px 14px', fontSize: 12,
            fontWeight: t.key === activeResultTab ? 600 : 400,
            color: t.key === activeResultTab
              ? 'var(--nxai-card-text, #e6edf3)'
              : 'var(--nxai-card-sub, #6b7280)',
            background: 'transparent', border: 'none',
            borderBottom: t.key === activeResultTab ? '2px solid #0ECAD4' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
          },
        }, `${t.label} (${t.count})`),
      ),
    );
  }

  renderMetadataResult(r: MetadataSearchResult, i: number): React.ReactNode {
    // Dot: green/teal for active plugins, neutral teal for version matches, grey for inactive
    const isPlugin = r.matchKind === 'plugin' || r.matchKind === 'theme';
    const isActive = r.value.startsWith('active');
    const dotColor = !isPlugin
      ? '#0ECAD4'  // version/php matches — always show as informational teal
      : isActive
        ? (r.siteSource === 'wpe' ? '#0ECAD4' : '#51BB7B')
        : '#555';

    const sourceLabel = r.siteSource === 'wpe' ? 'WPE' : 'Local';

    return React.createElement('div', {
      key: `${r.siteId}-${r.field}-${i}`,
      style: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px',
        borderBottom: '1px solid rgba(42,47,61,0.4)',
        fontSize: 12,
      },
    },
      React.createElement('div', {
        style: { width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 },
      }),
      React.createElement('span', {
        style: { flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
      }, r.siteName),
      React.createElement('span', {
        style: {
          fontSize: 10, padding: '1px 5px', borderRadius: 3,
          background: 'rgba(14,202,212,0.08)', color: '#0ECAD4',
          border: '1px solid rgba(14,202,212,0.15)', flexShrink: 0,
        },
      }, r.matchKind),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', flexShrink: 0 } }, r.value),
      React.createElement('span', {
        style: {
          fontSize: 9, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
          background: r.siteSource === 'wpe' ? 'rgba(14,202,212,0.06)' : 'rgba(81,187,123,0.06)',
          color: r.siteSource === 'wpe' ? '#0ECAD4' : '#51BB7B',
          border: `1px solid ${r.siteSource === 'wpe' ? 'rgba(14,202,212,0.15)' : 'rgba(81,187,123,0.15)'}`,
        },
      }, sourceLabel),
    );
  }

  renderContentResult(r: ContentSearchResult, i: number): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${r.postId}-${i}`,
      style: { padding: '10px 12px', borderBottom: '1px solid rgba(42,47,61,0.4)' },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
      },
        React.createElement('span', {
          style: {
            fontSize: 10, padding: '1px 5px', borderRadius: 3,
            background: 'rgba(81,187,123,0.08)', color: '#51BB7B',
            border: '1px solid rgba(81,187,123,0.15)',
          },
        }, 'content'),
        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, r.siteName),
        React.createElement('span', { style: { fontSize: 10, color: '#333', marginLeft: 'auto' } },
          r.score.toFixed(2),
        ),
      ),
      React.createElement('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 3 } }, r.title),
      React.createElement('div', {
        style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.5 },
      }, r.excerpt),
    );
  }

  renderResults(): React.ReactNode {
    const { response, activeResultTab } = this.state;
    if (!response) return null;

    const { metadataResults, contentResults } = response;
    const showMeta    = activeResultTab === 'all' || activeResultTab === 'sites';
    const showContent = activeResultTab === 'all' || activeResultTab === 'content';
    const SHOW_MAX = 8;

    const visibleMeta    = showMeta    ? metadataResults.slice(0, SHOW_MAX) : [];
    const visibleContent = showContent ? contentResults.slice(0,  SHOW_MAX) : [];
    const hiddenMeta     = showMeta    ? Math.max(0, metadataResults.length - SHOW_MAX) : 0;
    const hasAny         = visibleMeta.length > 0 || visibleContent.length > 0;

    const showDivider = activeResultTab === 'all' && visibleMeta.length > 0 && visibleContent.length > 0;
    const sectionLabel = (label: string) => React.createElement('div', {
      style: {
        padding: '5px 12px', fontSize: 10, fontWeight: 700,
        textTransform: 'uppercase' as const, letterSpacing: '.06em',
        color: 'var(--nxai-card-sub, #6b7280)',
        background: 'var(--nxai-code-bg, #1f1f1f)',
        borderBottom: '1px solid rgba(42,47,61,0.4)',
      },
    }, label);

    return React.createElement('div', {
      style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' },
    },
      visibleMeta.length > 0 && activeResultTab === 'all'
        ? sectionLabel(`Sites — ${metadataResults.length}`)
        : null,
      ...visibleMeta.map((r, i) => this.renderMetadataResult(r, i)),
      hiddenMeta > 0
        ? React.createElement('div', {
            style: { padding: '6px 12px', fontSize: 11, color: '#0ECAD4', cursor: 'pointer', background: 'var(--nxai-code-bg, #1f1f1f)', borderBottom: '1px solid rgba(42,47,61,0.4)' },
          }, `+ ${hiddenMeta} more sites`)
        : null,
      showDivider
        ? sectionLabel(`Content — ${contentResults.length}`)
        : null,
      ...visibleContent.map((r, i) => this.renderContentResult(r, i)),
      !hasAny
        ? React.createElement('div', {
            style: {
              padding: 32, textAlign: 'center' as const,
              color: 'var(--nxai-card-sub, #6b7280)', fontSize: 12,
            },
          }, 'No results found')
        : null,
    );
  }

  render(): React.ReactNode {
    const { query, searching, response, mode } = this.state;
    const { indexedCount, totalSites } = this.props;
    const metaCount    = response?.metadataResults.length ?? 0;
    const contentCount = response?.contentResults.length ?? 0;
    const hasResults   = !!response;

    const SUGGESTIONS = ['customer feedback', 'Elementor', 'PHP 7.4', 'pricing page'];

    return React.createElement('div', { style: { padding: '20px 24px' } },

      // Search box
      React.createElement('div', {
        style: { position: 'relative' as const, maxWidth: 640, marginBottom: 10 },
      },
        React.createElement('span', {
          style: {
            position: 'absolute' as const, left: 14, top: '50%',
            transform: 'translateY(-50%)', fontSize: 16,
            color: 'var(--nxai-card-sub, #6b7280)', pointerEvents: 'none',
          },
        }, '⌕'),
        React.createElement('input', {
          type: 'text', value: query,
          placeholder: `Search across ${totalSites} sites…`,
          onChange: (e: any) => this.setState({ query: e.target.value }),
          onKeyDown: (e: any) => { if (e.key === 'Enter') this.handleSearch(); },
          style: {
            width: '100%',
            background: 'var(--nxai-code-bg, #1f1f1f)',
            border: '1px solid var(--nxai-card-border, #30363d)',
            borderRadius: 10, color: 'inherit',
            padding: '11px 42px 11px 44px',
            fontSize: 14, outline: 'none', fontFamily: 'inherit',
          },
        }),
        React.createElement('span', {
          style: {
            position: 'absolute' as const, right: 12, top: '50%',
            transform: 'translateY(-50%)', fontSize: 10, color: '#444',
            background: '#252525', borderRadius: 4, padding: '2px 5px',
            fontFamily: 'monospace',
          },
        }, '↵'),
      ),

      // Mode pills
      this.renderModePills(),

      // Suggestions when empty
      !hasResults && !searching
        ? React.createElement('div', {
            style: { marginBottom: 20, fontSize: 11, color: '#444' },
          },
            'Try: ',
            ...SUGGESTIONS.map((s, i) =>
              React.createElement('span', {
                key: s,
                onClick: () => this.setState({ query: s }, () => this.handleSearch()),
                style: { color: '#0ECAD4', cursor: 'pointer', marginLeft: i === 0 ? 0 : 6 },
              }, s + (i < SUGGESTIONS.length - 1 ? ' ·' : '')),
            ),
          )
        : null,

      // Loading
      searching
        ? React.createElement('div', {
            style: {
              textAlign: 'center' as const, padding: '40px 0',
              color: 'var(--nxai-card-sub, #6b7280)', fontSize: 12,
            },
          }, 'Searching…')
        : null,

      // Results
      hasResults && !searching
        ? React.createElement('div', null,
            this.renderResultTabs(metaCount, contentCount),
            this.renderResults(),
            indexedCount < totalSites
              ? React.createElement('div', {
                  style: {
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
                    padding: '8px 10px',
                    background: 'rgba(245,158,11,0.06)',
                    border: '1px solid rgba(245,158,11,0.15)',
                    borderRadius: 6, fontSize: 11, color: '#c8a870',
                  },
                },
                'ℹ',
                ` ${totalSites - indexedCount} sites not yet indexed — content search covers ${indexedCount}/${totalSites}`,
              )
              : null,
          )
        : null,
    );
  }
}
