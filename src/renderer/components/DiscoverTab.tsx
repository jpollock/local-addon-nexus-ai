/**
 * DiscoverTab — First-run experience and comparison search.
 *
 * State machine:
 *   'fresh'    — no sites indexed, show index prompt
 *   'indexing' — indexing in progress, show per-site progress
 *   'ready'    — sites indexed, show comparison search
 *
 * Class-based, React.createElement only — no JSX, no hooks (Local React).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { injectThemeVars } from '../utils/theme';

interface IndexEntry {
  siteId: string;
  siteName: string;
  state: 'indexed' | 'indexing' | 'pending' | 'error';
  documentCount?: number;
}

interface DiscoverTabProps {
  electron: any;
  sites: Array<{ id: string; name: string; status: string }>;
  indexEntries: IndexEntry[];
  settings: NexusSettings;
  onSettingsChange: (s: NexusSettings) => void;
}

interface SearchResult {
  id: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  score: number;
  siteId: string;
  siteName: string;
}

interface DiscoverTabState {
  viewState: 'fresh' | 'indexing' | 'ready';
  indexEntries: IndexEntry[];
  query: string;
  searching: boolean;
  keywordResults: SearchResult[];
  semanticResults: SearchResult[];
  hasSearched: boolean;
  mcpExpanded: boolean;
  furtherVisible: boolean;
}

export class DiscoverTab extends React.Component<DiscoverTabProps, DiscoverTabState> {
  private mounted = false;

  state: DiscoverTabState = {
    viewState: 'fresh',
    indexEntries: [],
    query: '',
    searching: false,
    keywordResults: [],
    semanticResults: [],
    hasSearched: false,
    mcpExpanded: false,
    furtherVisible: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.deriveViewState();
    const prog = this.props.settings.discoverProgress;
    if (prog?.hasSearched) {
      this.setState({ hasSearched: true });
    }
    if (prog?.hasMcpDone) {
      this.setState({ furtherVisible: true });
    }
  }

  componentDidUpdate(prevProps: DiscoverTabProps): void {
    if (prevProps.indexEntries !== this.props.indexEntries) {
      this.deriveViewState();
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  deriveViewState(): void {
    const { indexEntries } = this.props;
    const indexed = indexEntries.filter((e) => e.state === 'indexed');
    const indexing = indexEntries.filter((e) => e.state === 'indexing');

    let viewState: DiscoverTabState['viewState'];
    if (indexed.length > 0) {
      viewState = 'ready';
    } else if (indexing.length > 0) {
      viewState = 'indexing';
    } else {
      viewState = 'fresh';
    }

    // Never revert from 'indexing' to 'fresh' — the user triggered indexing
    // and props just haven't caught up yet. Only advance: indexing → ready.
    if (this.state.viewState === 'indexing' && viewState === 'fresh') return;

    if (this.mounted) this.setState({ viewState, indexEntries });
  }

  handleStartIndexing = async (): Promise<void> => {
    this.setState({ viewState: 'indexing' });
    const ipc = this.props.electron.ipcRenderer;
    for (const site of this.props.sites) {
      const entry = this.props.indexEntries.find((e) => e.siteId === site.id);
      if (!entry || entry.state !== 'indexed') {
        ipc.invoke(IPC_CHANNELS.INDEX_SITE, { siteId: site.id, force: false }).catch(() => {});
      }
    }
  };

  handleSearch = async (query: string): Promise<void> => {
    const q = query.trim();
    if (!q) return;

    const hadSearched = this.state.hasSearched;  // capture BEFORE await

    this.setState({ query: q, searching: true, keywordResults: [], semanticResults: [] });

    const ipc = this.props.electron.ipcRenderer;
    const [kwRes, semRes] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.SEARCH_KEYWORD, q, 10).catch(() => ({ results: [] })),
      ipc.invoke(IPC_CHANNELS.SEARCH, q, undefined, 10).catch(() => ({ results: [] })),
    ]);

    if (!this.mounted) return;

    this.setState({
      searching: false,
      keywordResults: kwRes.results ?? [],
      semanticResults: semRes.results ?? [],
      hasSearched: true,
    });

    if (!hadSearched) {
      const next = { ...this.props.settings, discoverProgress: { ...this.props.settings.discoverProgress, hasSearched: true } };
      this.props.onSettingsChange(next);
    }
  };

  handleMcpDone = (): void => {
    this.setState({ furtherVisible: true, mcpExpanded: false });
    const next = { ...this.props.settings, discoverProgress: { ...this.props.settings.discoverProgress, hasMcpDone: true } };
    this.props.onSettingsChange(next);
  };

  renderFresh(): React.ReactNode {
    return React.createElement('div', {
      style: { maxWidth: 520, margin: '48px auto', textAlign: 'center' as const },
    },
      React.createElement('div', {
        style: { width: 56, height: 56, borderRadius: 16, background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 20px' },
      }, '🔍'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Search across all your sites'),
      React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', lineHeight: 1.6, marginBottom: 24 } },
        'Nexus indexes your WordPress content and lets you search semantically — finding relevant pages even when they don\'t use your exact words.',
      ),
      React.createElement('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(81,187,123,0.08)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#51BB7B', marginBottom: 28 },
      }, '✓ No API key required — works out of the box'),
      React.createElement('br'),
      this.props.sites.length === 0
        ? React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)' } }, 'No local WordPress sites found. Create a site in Local first.')
        : React.createElement('button', {
            onClick: this.handleStartIndexing,
            style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
          }, '⚡ Index my sites now'),
    );
  }

  renderIndexing(): React.ReactNode {
    const { sites } = this.props;
    const { indexEntries } = this.state;
    const indexed = indexEntries.filter((e) => e.state === 'indexed').length;
    const total = sites.length;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return React.createElement('div', {
      style: { maxWidth: 520, margin: '40px auto', textAlign: 'center' as const },
    },
      React.createElement('div', { style: { fontSize: 24, marginBottom: 16 } }, '⚡'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Indexing your sites…'),
      React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, 'Reading content from your WordPress sites.'),
      React.createElement('div', { style: { background: '#222', borderRadius: 4, height: 4, maxWidth: 400, margin: '0 auto 8px', overflow: 'hidden' } },
        React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #0ECAD4, #51BB7B)', borderRadius: 4, transition: 'width 0.5s' } }),
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, `${indexed} of ${total} sites indexed`),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'left' as const },
      },
        ...sites.map((site) => {
          const entry = indexEntries.find((e) => e.siteId === site.id);
          const st = entry?.state ?? 'pending';
          const dotColor = st === 'indexed' ? '#51BB7B' : st === 'indexing' ? '#0ECAD4' : '#333';
          const label = st === 'indexed' ? `${entry?.documentCount ?? '?'} pages` : st === 'indexing' ? 'indexing…' : 'waiting';
          return React.createElement('div', {
            key: site.id,
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--nxai-card-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 6, fontSize: 12 },
          },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
            React.createElement('span', { style: { flex: 1, color: 'var(--nxai-card-text)' } }, site.name),
            React.createElement('span', { style: { fontSize: 10, color: st === 'indexed' ? '#51BB7B' : 'var(--nxai-card-sub)' } }, label),
          );
        }),
      ),
    );
  }

  renderReady(): React.ReactNode {
    const { query, searching, keywordResults, semanticResults, hasSearched, mcpExpanded, furtherVisible } = this.state;
    const { indexEntries } = this.props;
    const indexedCount = indexEntries.filter((e) => e.state === 'indexed').length;
    const totalDocs = indexEntries.reduce((s, e) => s + (e.documentCount ?? 0), 0);

    const SUGGESTIONS = ['customer feedback', 'content strategy', 'onboarding flow', 'product launch'];
    const cardSub: React.CSSProperties = { fontSize: 11, color: 'var(--nxai-card-sub)' };
    const delta = semanticResults.length - keywordResults.length;

    return React.createElement('div', null,

      // Header
      React.createElement('div', { style: { textAlign: 'center' as const, marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 6 } }, 'Search your sites'),
        React.createElement('p', { style: { ...cardSub } }, 'Keyword search finds exact matches. Semantic search understands meaning.'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--nxai-card-sub)' } },
          React.createElement('span', null, `${indexedCount} sites indexed`),
          React.createElement('span', null, '·'),
          React.createElement('span', null, `${totalDocs.toLocaleString()} pages`),
          React.createElement('span', null, '·'),
          React.createElement('span', { style: { background: 'rgba(81,187,123,0.08)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 20, padding: '2px 8px', color: '#51BB7B', fontSize: 10 } }, 'No API key needed'),
        ),
      ),

      // Search bar
      React.createElement('div', { style: { position: 'relative' as const, maxWidth: 620, margin: '0 auto 8px' } },
        React.createElement('span', { style: { position: 'absolute' as const, left: 15, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--nxai-card-sub)', pointerEvents: 'none' } }, '⌕'),
        React.createElement('input', {
          type: 'text',
          value: query,
          placeholder: 'Try: customer feedback, content strategy, onboarding…',
          onChange: (e: any) => this.setState({ query: e.target.value }),
          onKeyDown: (e: any) => { if (e.key === 'Enter' && query.trim()) this.handleSearch(query); },
          style: { width: '100%', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 10, color: 'inherit', padding: '12px 48px 12px 46px', fontSize: 15, outline: 'none', fontFamily: 'inherit' },
        }),
        React.createElement('span', { style: { position: 'absolute' as const, right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#444', background: '#252525', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' } }, '↵'),
      ),

      // Suggestion chips
      React.createElement('div', { style: { textAlign: 'center' as const, marginBottom: 24, fontSize: 11, color: '#333' } },
        'Try: ',
        ...SUGGESTIONS.map((s, i) =>
          React.createElement('span', {
            key: s,
            onClick: () => this.handleSearch(s),
            style: { color: '#0ECAD4', cursor: 'pointer', marginLeft: i === 0 ? 0 : 6 },
          }, s + (i < SUGGESTIONS.length - 1 ? ' ·' : '')),
        ),
      ),

      // Empty state
      !hasSearched && !searching
        ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '48px 0', color: '#333' } },
            React.createElement('div', { style: { fontSize: 32, marginBottom: 12, opacity: 0.2 } }, '⌕'),
            React.createElement('div', { style: { fontSize: 14, color: '#444' } }, 'Type a query to search across all your sites'),
            React.createElement('div', { style: { fontSize: 11, color: '#333', marginTop: 4 } }, 'Semantic search finds related content even without exact keyword matches'),
          )
        : null,

      // Loading
      searching
        ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '40px 0', color: '#444', fontSize: 12 } }, 'Searching…')
        : null,

      // Results
      hasSearched && !searching
        ? React.createElement('div', null,
            delta > 0
              ? React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 16px', background: 'rgba(81,187,123,0.06)', border: '1px solid rgba(81,187,123,0.15)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#51BB7B' },
                }, `✦ Semantic found ${delta} additional result${delta !== 1 ? 's' : ''} — related content keyword search missed`)
              : null,
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
              // Keyword column
              React.createElement('div', null,
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: '8px 8px 0 0' } },
                  React.createElement('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, 'Keyword search'),
                  React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(156,163,175,0.12)', color: '#9ca3af' } }, `${keywordResults.length} result${keywordResults.length !== 1 ? 's' : ''}`),
                ),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', padding: '0 14px 8px', background: 'var(--nxai-code-bg)', borderLeft: '1px solid var(--nxai-card-border)', borderRight: '1px solid var(--nxai-card-border)' } }, 'Exact word matches only'),
                keywordResults.length === 0
                  ? React.createElement('div', { style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 28, textAlign: 'center' as const, color: '#333', fontSize: 12, fontStyle: 'italic' } }, 'No exact matches found')
                  : React.createElement('div', null, ...keywordResults.map((r, i) => this.renderResultCard(r, i, false))),
              ),
              // Semantic column
              React.createElement('div', null,
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: '8px 8px 0 0' } },
                  React.createElement('span', { style: { fontSize: 12, fontWeight: 600, flex: 1 } }, 'Semantic search'),
                  React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: semanticResults.length > keywordResults.length ? 'rgba(81,187,123,0.12)' : 'rgba(14,202,212,0.12)', color: semanticResults.length > keywordResults.length ? '#51BB7B' : '#0ECAD4' } }, `${semanticResults.length} result${semanticResults.length !== 1 ? 's' : ''}`),
                ),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', padding: '0 14px 8px', background: 'var(--nxai-code-bg)', borderLeft: '1px solid var(--nxai-card-border)', borderRight: '1px solid var(--nxai-card-border)' } }, 'Meaning-based — finds related ideas'),
                semanticResults.length === 0
                  ? React.createElement('div', { style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 28, textAlign: 'center' as const, color: '#333', fontSize: 12, fontStyle: 'italic' } }, 'No results found')
                  : React.createElement('div', null, ...semanticResults.map((r, i) => {
                      const isSemanticOnly = !keywordResults.find((k) => k.postId === r.postId);
                      return this.renderResultCard(r, i, isSemanticOnly);
                    })),
              ),
            ),
          )
        : null,

      // MCP card (after first search)
      hasSearched ? this.renderMcpCard() : null,

      // Further steps
      furtherVisible ? this.renderFurtherSteps() : null,
    );
  }

  renderResultCard(r: SearchResult, index: number, isSemanticOnly: boolean): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${r.postId}-${index}`,
      style: { background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderTop: 'none', padding: '11px 14px', ...(index === 9 ? { borderRadius: '0 0 8px 8px' } : {}) },
    },
      React.createElement('div', { style: { fontSize: 10, color: 'var(--nxai-card-sub)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 } },
        React.createElement('div', { style: { width: 5, height: 5, borderRadius: '50%', background: isSemanticOnly ? '#0ECAD4' : '#9ca3af' } }),
        r.siteName,
        isSemanticOnly ? React.createElement('span', { style: { fontSize: 9, background: 'rgba(14,202,212,0.1)', color: '#0ECAD4', borderRadius: 3, padding: '1px 4px' } }, 'semantic only') : null,
      ),
      React.createElement('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 4, lineHeight: 1.4 } }, r.title),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', lineHeight: 1.5 } },
        r.content.slice(0, 120) + (r.content.length > 120 ? '…' : ''),
      ),
    );
  }

  renderMcpCard(): React.ReactNode {
    const { mcpExpanded } = this.state;
    const mcpConfig = `{
  "mcpServers": {
    "nexus": {
      "command": "nexus",
      "args": ["mcp", "start"]
    }
  }
}`;

    return React.createElement('div', { style: { border: '1px solid var(--nxai-card-border)', borderRadius: 10, overflow: 'hidden', marginTop: 24 } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--nxai-code-bg)', cursor: 'pointer' },
        onClick: () => this.setState((prev) => ({ mcpExpanded: !prev.mcpExpanded })),
      },
        React.createElement('div', { style: { width: 36, height: 36, borderRadius: 10, background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 } }, '🤖'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, 'Let Claude search your sites'),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginTop: 2 } }, 'Connect to Claude Desktop, Cursor, or any MCP client — then ask natural-language questions about your content.'),
        ),
        React.createElement('span', { style: { color: 'var(--nxai-card-sub)', fontSize: 12, transform: mcpExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' } }, '▶'),
      ),
      mcpExpanded ? React.createElement('div', { style: { padding: 16, background: '#161616', borderTop: '1px solid var(--nxai-card-border)' } },
        ...([
          ['Open Claude Desktop', 'Settings → Developer → Edit Config'],
          ['Add Nexus as an MCP server', null],
          ['Restart Claude Desktop and try', '"Search my sites for anything about customer onboarding"'],
        ] as [string, string | null][]).map(([title, sub], i) =>
          React.createElement('div', { key: i, style: { display: 'flex', gap: 12, marginBottom: 12 } },
            React.createElement('div', { style: { width: 22, height: 22, borderRadius: '50%', background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', color: '#0ECAD4', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 } }, String(i + 1)),
            React.createElement('div', { style: { fontSize: 12, color: '#aaa', lineHeight: 1.5 } },
              React.createElement('strong', { style: { color: '#e0e0e0' } }, title),
              sub ? React.createElement('div', { style: { color: '#0ECAD4', fontStyle: 'italic', marginTop: 2 } }, sub) : null,
              i === 1 ? React.createElement('pre', {
                style: { background: '#0d0d0d', border: '1px solid var(--nxai-card-border)', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#aaa', margin: '8px 0', overflowX: 'auto' as const, whiteSpace: 'pre' as const },
              }, mcpConfig) : null,
            ),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', { onClick: this.handleMcpDone, style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 12, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' } }, 'Done — what\'s next?'),
          React.createElement('button', { onClick: () => this.setState({ mcpExpanded: false }), style: { background: 'none', color: 'var(--nxai-card-sub)', fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--nxai-card-border)', cursor: 'pointer', fontFamily: 'inherit' } }, 'Maybe later'),
        ),
      ) : null,
    );
  }

  renderFurtherSteps(): React.ReactNode {
    const steps = [
      { icon: '⚡', title: 'Enable Smart Search on a site', sub: 'Upgrade a site\'s WordPress search to use your indexed content.', chip: 'Free' },
      { icon: '🔑', title: 'Add an AI provider key', sub: 'Unlock Site Finder, AI writing tools, and the WordPress AI toolkit.', chip: 'Optional' },
      { icon: '☁', title: 'Connect WP Engine', sub: 'Index and search your remote WPE sites, manage your full fleet.', chip: 'Optional' },
    ];

    return React.createElement('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--nxai-card-sub)', marginBottom: 4 } }, 'Keep going'),
      ...steps.map((s, i) =>
        React.createElement('div', {
          key: i,
          style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--nxai-code-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 8, cursor: 'pointer', opacity: i === 0 ? 1 : 0.6 },
        },
          React.createElement('span', { style: { fontSize: 18 } }, s.icon),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500 } }, s.title),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginTop: 2 } }, s.sub),
          ),
          React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, background: i === 0 ? 'rgba(14,202,212,0.08)' : 'transparent', color: i === 0 ? '#0ECAD4' : 'var(--nxai-card-sub)', border: i === 0 ? '1px solid rgba(14,202,212,0.15)' : 'none' } }, s.chip),
        ),
      ),
    );
  }

  render(): React.ReactNode {
    const { viewState } = this.state;
    return React.createElement('div', { style: { padding: '24px' } },
      viewState === 'fresh'    ? this.renderFresh()    : null,
      viewState === 'indexing' ? this.renderIndexing() : null,
      viewState === 'ready'    ? this.renderReady()    : null,
    );
  }
}
