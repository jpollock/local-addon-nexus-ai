/**
 * Unified Search Panel Component (Sprint 2)
 *
 * Cross-site search with debounced input, content type filters,
 * pagination, and result display with type icons.
 *
 * Class-based -- Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface UnifiedSearchPanelProps {
  electron: any;
  onResultClick?: (result: any) => void;
}

interface UnifiedSearchPanelState {
  query: string;
  results: any[];
  loading: boolean;
  error: string | null;
  totalResults: number;
  showAdvanced: boolean;
  contentTypeFilters: string[];
  vectorSearch: boolean;
  currentPage: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const CONTENT_TYPES = [
  { key: 'post', label: 'Posts', icon: '\uD83D\uDCC4' },
  { key: 'plugin', label: 'Plugins', icon: '\uD83D\uDD0C' },
  { key: 'theme', label: 'Themes', icon: '\uD83C\uDFA8' },
  { key: 'user', label: 'Users', icon: '\uD83D\uDC64' },
] as const;

const TYPE_ICON_MAP: Record<string, string> = {
  post: '\uD83D\uDCC4',
  plugin: '\uD83D\uDD0C',
  theme: '\uD83C\uDFA8',
  user: '\uD83D\uDC64',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '16px',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #ddd)',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  color: 'var(--nxai-card-text, #000)',
};

const advancedToggleStyle: React.CSSProperties = {
  marginTop: '8px',
  background: 'none',
  border: 'none',
  color: UI_COLORS.WPE_BRAND,
  fontSize: '12px',
  cursor: 'pointer',
  padding: '4px 0',
  fontWeight: 600,
};

const advancedSectionStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: 'var(--nxai-card-border, #f3f4f6)',
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  cursor: 'pointer',
  color: 'var(--nxai-card-text)',
};

const resultsListStyle: React.CSSProperties = {
  marginTop: '16px',
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const resultItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '12px 0',
  borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
  cursor: 'pointer',
};

const resultIconStyle: React.CSSProperties = {
  fontSize: '20px',
  flexShrink: 0,
  width: '28px',
  textAlign: 'center',
};

const resultBodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const resultTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  marginBottom: '4px',
};

const resultMetaStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '4px',
};

const typeBadgeStyle = (type: string): React.CSSProperties => {
  const colors: Record<string, string> = {
    post: '#3b82f6',
    plugin: '#8b5cf6',
    theme: '#ec4899',
    user: '#f59e0b',
  };
  const bg = colors[type] || '#6b7280';
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: bg,
  };
};

const scoreBadgeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

const resultExcerptStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  lineHeight: '1.4',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  padding: '12px',
  border: `1px solid ${UI_COLORS.STATUS_ERROR}`,
  borderRadius: '6px',
  backgroundColor: `${UI_COLORS.STATUS_ERROR}10`,
  color: UI_COLORS.STATUS_ERROR,
  fontSize: '13px',
  marginTop: '12px',
};

const loadMoreButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px',
  marginTop: '12px',
  borderRadius: '6px',
  border: `1px solid ${UI_COLORS.WPE_BRAND}`,
  backgroundColor: 'transparent',
  color: UI_COLORS.WPE_BRAND,
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'center',
};

const resultCountStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginTop: '12px',
  marginBottom: '4px',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class UnifiedSearchPanel extends React.Component<
  UnifiedSearchPanelProps,
  UnifiedSearchPanelState
> {
  _mounted = false;
  _searchTimeout: ReturnType<typeof setTimeout> | null = null;

  state: UnifiedSearchPanelState = {
    query: '',
    results: [],
    loading: false,
    error: null,
    totalResults: 0,
    showAdvanced: false,
    contentTypeFilters: [],
    currentPage: 0,
    vectorSearch: true,
  };

  componentDidMount(): void {
    this._mounted = true;
  }

  componentWillUnmount(): void {
    this._mounted = false;
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
      this._searchTimeout = null;
    }
  }

  // -----------------------------------------------------------------------
  // Search logic
  // -----------------------------------------------------------------------

  handleSearchChange = (e: any): void => {
    const query = e.target.value;
    this.setState({ query, currentPage: 0 });

    if (this._searchTimeout) clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => {
      this.performSearch();
    }, 300);
  };

  performSearch = async (): Promise<void> => {
    const { query, contentTypeFilters } = this.state;
    if (!query.trim()) {
      this.setState({ results: [], totalResults: 0, loading: false });
      return;
    }

    this.setState({ loading: true, error: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SEARCH_UNIFIED,
        query,
        {
          contentTypes:
            contentTypeFilters.length > 0 ? contentTypeFilters : undefined,
        },
        { limit: PAGE_SIZE, offset: 0, vectorSearch: this.state.vectorSearch },
      );
      if (this._mounted && result.success !== false) {
        this.setState({
          results: result.results || [],
          totalResults: result.total || 0,
          loading: false,
          currentPage: 0,
        });
      } else if (this._mounted && result.success === false) {
        this.setState({
          error: result.error || 'Search failed',
          loading: false,
        });
      }
    } catch (err: any) {
      if (this._mounted) {
        this.setState({ error: err.message, loading: false });
      }
    }
  };

  loadMore = async (): Promise<void> => {
    const { query, contentTypeFilters, results, currentPage } = this.state;
    const nextPage = currentPage + 1;
    const offset = nextPage * PAGE_SIZE;

    this.setState({ loading: true, error: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SEARCH_UNIFIED,
        query,
        {
          contentTypes:
            contentTypeFilters.length > 0 ? contentTypeFilters : undefined,
        },
        { limit: PAGE_SIZE, offset, vectorSearch: this.state.vectorSearch },
      );
      if (this._mounted && result.success !== false) {
        this.setState({
          results: [...results, ...(result.results || [])],
          totalResults: result.total || 0,
          loading: false,
          currentPage: nextPage,
        });
      }
    } catch (err: any) {
      if (this._mounted) {
        this.setState({ error: err.message, loading: false });
      }
    }
  };

  // -----------------------------------------------------------------------
  // Filter logic
  // -----------------------------------------------------------------------

  toggleFilter = (filterKey: string): void => {
    this.setState(
      (prev) => {
        const filters = prev.contentTypeFilters.includes(filterKey)
          ? prev.contentTypeFilters.filter((f) => f !== filterKey)
          : [...prev.contentTypeFilters, filterKey];
        return { contentTypeFilters: filters, currentPage: 0 };
      },
      () => {
        if (this.state.query.trim()) {
          if (this._searchTimeout) clearTimeout(this._searchTimeout);
          this._searchTimeout = setTimeout(() => {
            this.performSearch();
          }, 300);
        }
      },
    );
  };

  toggleAdvanced = (): void => {
    this.setState((prev) => ({ showAdvanced: !prev.showAdvanced }));
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

renderSearchInput(): React.ReactNode {
    return React.createElement(
      'div',
      null,
      React.createElement('input', {
        type: 'text',
        placeholder: 'Search across all sites...',
        value: this.state.query,
        onChange: this.handleSearchChange,
        style: searchInputStyle,
        'data-testid': 'search-input',
      }),
      // Vector search toggle
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          marginTop: '8px',
          gap: '8px',
        },
      },
        React.createElement('input', {
          type: 'checkbox',
          id: 'vector-search-toggle',
          checked: this.state.vectorSearch,
          onChange: (e: any) => {
            this.setState({ vectorSearch: e.target.checked }, () => {
              // Re-run search if there's a query
              if (this.state.query.trim()) {
                this.performSearch();
              }
            });
          },
          style: { cursor: 'pointer' },
        }),
        React.createElement('label', {
          htmlFor: 'vector-search-toggle',
          style: {
            fontSize: '13px',
            cursor: 'pointer',
            color: 'var(--nxai-card-sub)',
          },
        },
          'Vector Search ',
          React.createElement('span', {
            style: {
              fontSize: '11px',
              opacity: 0.7,
            },
          }, '(semantic content matching)')
        ),
      ),
    );
  }

  renderAdvancedFilters(): React.ReactNode {
    const { showAdvanced, contentTypeFilters } = this.state;

    return React.createElement(
      'div',
      null,
      React.createElement(
        'button',
        {
          style: advancedToggleStyle,
          onClick: this.toggleAdvanced,
          'data-testid': 'advanced-toggle',
        },
        showAdvanced ? 'Hide Filters' : 'Show Filters',
      ),
      showAdvanced
        ? React.createElement(
            'div',
            { style: advancedSectionStyle, 'data-testid': 'advanced-filters' },
            ...CONTENT_TYPES.map((ct) =>
              React.createElement(
                'label',
                { key: ct.key, style: checkboxLabelStyle },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: contentTypeFilters.includes(ct.key),
                  onChange: () => this.toggleFilter(ct.key),
                  'data-testid': `filter-${ct.key}`,
                }),
                `${ct.icon} ${ct.label}`,
              ),
            ),
          )
        : null,
    );
  }

  renderResultItem(result: any, index: number): React.ReactNode {
    const icon = TYPE_ICON_MAP[result.type] || '\uD83D\uDCC4';
    const score =
      result.score != null ? Math.round(result.score * 100) : null;

    return React.createElement(
      'li',
      {
        key: result.id || index,
        style: resultItemStyle,
        onClick: () => this.props.onResultClick && this.props.onResultClick(result),
        'data-testid': `result-item-${index}`,
      },
      React.createElement('span', { style: resultIconStyle }, icon),
      React.createElement(
        'div',
        { style: resultBodyStyle },
        React.createElement(
          'div',
          { style: resultTitleStyle },
          result.title || 'Untitled',
        ),
        React.createElement(
          'div',
          { style: resultMetaStyle },
          React.createElement(
            'span',
            { style: typeBadgeStyle(result.type || 'post') },
            result.type || 'post',
          ),
          result.siteName
            ? React.createElement('span', null, result.siteName)
            : null,
          score != null
            ? React.createElement(
                'span',
                { style: scoreBadgeStyle },
                `${score}% match`,
              )
            : null,
        ),
        result.excerpt
          ? React.createElement(
              'div',
              { style: resultExcerptStyle },
              result.excerpt,
            )
          : null,
      ),
    );
  }

  renderLoadingState(): React.ReactNode {
    return React.createElement(
      'div',
      { style: loadingStyle, 'data-testid': 'loading-state' },
      'Searching...',
    );
  }

  renderEmptyState(): React.ReactNode {
    const { query } = this.state;
    const message = query.trim()
      ? 'No results found'
      : 'Search across all sites';

    return React.createElement(
      'div',
      { style: emptyStateStyle, 'data-testid': 'empty-state' },
      message,
    );
  }

  renderErrorState(): React.ReactNode {
    const { error } = this.state;
    return React.createElement(
      'div',
      { style: errorStyle, 'data-testid': 'error-state' },
      `Error: ${error}`,
    );
  }

  renderPagination(): React.ReactNode {
    const { results, totalResults, loading } = this.state;
    if (results.length >= totalResults || results.length === 0) return null;

    return React.createElement(
      'button',
      {
        style: loadMoreButtonStyle,
        onClick: this.loadMore,
        disabled: loading,
        'data-testid': 'load-more',
      },
      loading ? 'Loading...' : `Load More (${results.length} of ${totalResults})`,
    );
  }

  renderResults(): React.ReactNode {
    const { results, loading, error, query, totalResults } = this.state;

    if (error) return this.renderErrorState();
    if (loading && results.length === 0) return this.renderLoadingState();
    if (results.length === 0) return this.renderEmptyState();

    return React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { style: resultCountStyle },
        `${totalResults} result${totalResults === 1 ? '' : 's'} for "${query}"`,
      ),
      React.createElement(
        'ul',
        { style: resultsListStyle, 'data-testid': 'results-list' },
        ...results.map((r: any, i: number) => this.renderResultItem(r, i)),
      ),
      this.renderPagination(),
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  render(): React.ReactNode {
    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Search'),
      this.renderSearchInput(),
      this.renderAdvancedFilters(),
      this.renderResults(),
    );
  }
}
