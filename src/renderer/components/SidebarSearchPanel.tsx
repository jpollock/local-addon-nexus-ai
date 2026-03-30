/**
 * Sidebar Search Panel Component
 *
 * Slide-out search overlay for Local's native sidebar.
 * Features AI-powered and manual site search with bulk actions.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface SidebarSearchPanelProps {
  electron: any;
  isOpen: boolean;
  onClose: () => void;
  hasLLM: boolean;
}

interface LocalSiteResult {
  id: string;
  name: string;
  type: 'local';
}

interface WpeSiteResult {
  id: string;
  name: string;
  domain: string;
  installId: string;
  type: 'wpe';
}

interface SidebarSearchPanelState {
  aiMode: boolean;
  query: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  loading: boolean;
  error: string | null;
  interpretedFilters: InterpretedFilters | null;
  resultsCount: number | null;
  localResults: LocalSiteResult[];
  wpeResults: WpeSiteResult[];
  expandedWpeId: string | null;
  // Manual filters
  searchText: string;
  selectedPlugins: string[];
  selectedThemes: string[];
  selectedPhpVersions: string[];
  selectedWpVersions: string[];
  availablePlugins: string[];
  availableThemes: string[];
  availablePhpVersions: string[];
  availableWpVersions: string[];
  loadingOptions: boolean;
}

interface InterpretedFilters {
  plugins?: string[];
  themes?: string[];
  phpVersions?: string[];
  wpVersions?: string[];
  contentQuery?: string;
  searchText?: string;
}

// -- Styles --

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 9999,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'stretch',
};

const panelStyle: React.CSSProperties = {
  width: '450px',
  backgroundColor: '#2d2d2d',
  boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.3)',
  display: 'flex',
  flexDirection: 'column',
  animation: 'slideInRight 0.2s ease-out',
};

const headerStyle: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid #3d3d3d',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#ffffff',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#999',
  fontSize: '24px',
  cursor: 'pointer',
  padding: 0,
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '24px',
};

const toggleContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '20px',
  justifyContent: 'center',
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#999',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: '6px',
  border: '1px solid #3d3d3d',
  fontSize: '14px',
  color: '#ffffff',
  backgroundColor: '#1d1d1d',
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: '44px',
  resize: 'vertical',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#51BB7B',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: 'transparent',
  border: '1px solid #3d3d3d',
  color: '#999',
};

const exampleStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#51BB7B',
  cursor: 'pointer',
  padding: '6px 0',
};

const filtersDisplayStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: '#1d3d1d',
  border: '1px solid #2d5d2d',
};

const filterItemStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#7dd87d',
  padding: '4px 0',
};


const EXAMPLE_QUERIES = [
  "WP 6.8 with ACF",
  "WooCommerce sites on old PHP",
  "sites with Akismet",
];

/**
 * SidebarSearchPanel Component
 */
export class SidebarSearchPanel extends React.Component<SidebarSearchPanelProps, SidebarSearchPanelState> {
  private mounted = false;

  state: SidebarSearchPanelState = {
    aiMode: true,
    query: '',
    conversation: [],
    loading: false,
    error: null,
    interpretedFilters: null,
    resultsCount: null,
    localResults: [],
    wpeResults: [],
    expandedWpeId: null,
    searchText: '',
    selectedPlugins: [],
    selectedThemes: [],
    selectedPhpVersions: [],
    selectedWpVersions: [],
    availablePlugins: [],
    availableThemes: [],
    availablePhpVersions: [],
    availableWpVersions: [],
    loadingOptions: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchFilterOptions();
    // Add keyboard listener for Escape
    document.addEventListener('keydown', this.handleKeyDown);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.props.isOpen) {
      this.props.onClose();
    }
  };

  fetchFilterOptions = async (): Promise<void> => {
    this.setState({ loadingOptions: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_GET_OPTIONS,
      );
      if (!this.mounted) return;
      if (result.success) {
        this.setState({
          availablePlugins: result.plugins || [],
          availableThemes: result.themes || [],
          availablePhpVersions: result.phpVersions || [],
          availableWpVersions: result.wpVersions || [],
          loadingOptions: false,
        });
      } else {
        this.setState({ loadingOptions: false });
      }
    } catch {
      if (!this.mounted) return;
      this.setState({ loadingOptions: false });
    }
  };

  handleAISearch = async (): Promise<void> => {
    if (!this.state.query.trim() || this.state.loading) return;

    // Max 3 messages
    if (this.state.conversation.length >= 3) {
      this.setState({ error: 'Too many rounds. Try a clearer query.' });
      return;
    }

    this.setState({ loading: true, error: null });

    const newConversation = [
      ...this.state.conversation,
      { role: 'user' as const, content: this.state.query },
    ];

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_AI_PARSE,
        { conversation: newConversation },
      );

      if (!this.mounted) return;

      if (!result.success) {
        this.setState({ loading: false, error: result.error });
        return;
      }

      if (result.needsClarification && result.question) {
        this.setState({
          conversation: [
            ...newConversation,
            { role: 'assistant', content: result.question },
          ],
          query: '',
          loading: false,
        });
        return;
      }

      // Execute search
      this.setState({
        interpretedFilters: result.filters,
        conversation: newConversation,
        loading: false,
      });

      await this.executeSearch(result.filters);
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false, error: 'Search failed' });
    }
  };

  handleManualSearch = async (): Promise<void> => {
    this.setState({ loading: true, error: null });

    try {
      const filters = {
        searchText: this.state.searchText,
        plugins: this.state.selectedPlugins,
        themes: this.state.selectedThemes,
        phpVersions: this.state.selectedPhpVersions,
        wpVersions: this.state.selectedWpVersions,
      };

      await this.executeSearch(filters);
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false, error: 'Search failed' });
    }
  };

  executeSearch = async (filters: any): Promise<void> => {
    const result = await this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.SITE_FINDER_APPLY,
      filters,
    );

    if (!this.mounted) return;

    if (result.success) {
      const localResults: LocalSiteResult[] = result.local || [];
      const wpeResults: WpeSiteResult[] = result.wpe || [];
      this.setState({
        resultsCount: localResults.length + wpeResults.length,
        localResults,
        wpeResults,
        loading: false,
      });
    } else {
      this.setState({ loading: false, error: 'Search failed' });
    }
  };

  handleClear = (): void => {
    this.setState({
      query: '',
      conversation: [],
      interpretedFilters: null,
      resultsCount: null,
      localResults: [],
      wpeResults: [],
      expandedWpeId: null,
      error: null,
      searchText: '',
      selectedPlugins: [],
      selectedThemes: [],
      selectedPhpVersions: [],
      selectedWpVersions: [],
    });
  };

  handleToggleWpeSite = (id: string): void => {
    this.setState(prev => ({
      expandedWpeId: prev.expandedWpeId === id ? null : id,
    }));
  };

  handleNavigateToSite = (siteId: string): void => {
    this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE,
      { siteId },
    );
    this.props.onClose();
  };

  handlePullToLocal = (site: WpeSiteResult): void => {
    this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.WPE_PULL_TO_LOCAL,
      { installId: site.installId, installName: site.name },
    );
  };


  renderAIMode(): React.ReactNode {
    const { query, loading, conversation, interpretedFilters, error } = this.state;

    return React.createElement('div', null,
      // Input
      React.createElement('textarea', {
        style: inputStyle,
        placeholder: 'e.g., "WP 6.8 with ACF and posts about cars"',
        value: query,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
          this.setState({ query: e.target.value }),
        rows: 2,
        disabled: loading,
      }),

      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        React.createElement('button', {
          style: { ...buttonStyle, opacity: loading ? 0.6 : 1 },
          onClick: this.handleAISearch,
          disabled: loading || !query.trim(),
        }, loading ? 'Thinking...' : 'Search'),
        React.createElement('button', {
          style: secondaryButtonStyle,
          onClick: this.handleClear,
        }, 'Clear'),
      ),

      // Conversation
      conversation.length > 0 ? React.createElement('div', {
        style: { marginTop: '16px', padding: '12px', backgroundColor: '#1d1d1d', borderRadius: '6px' },
      },
        conversation.map((msg, idx) =>
          React.createElement('div', {
            key: idx,
            style: {
              padding: '8px',
              marginBottom: '8px',
              borderRadius: '4px',
              backgroundColor: msg.role === 'user' ? '#1d2d3d' : '#3d2d1d',
              fontSize: '12px',
              color: '#ffffff',
            },
          },
            React.createElement('strong', null, msg.role === 'user' ? 'You: ' : 'AI: '),
            msg.content,
          ),
        ),
      ) : null,

      // Interpreted filters
      interpretedFilters ? this.renderInterpretedFilters(interpretedFilters) : null,

      // Error
      error ? React.createElement('div', {
        style: { marginTop: '12px', padding: '12px', backgroundColor: '#3d1d1d', borderRadius: '6px', color: '#ff6b6b', fontSize: '12px' },
      }, error) : null,

      // Examples
      conversation.length === 0 ? React.createElement('div', {
        style: { marginTop: '16px' },
      },
        React.createElement('div', { style: { fontSize: '11px', color: '#666', marginBottom: '8px' } }, '💡 Try these:'),
        EXAMPLE_QUERIES.map((ex, idx) =>
          React.createElement('div', {
            key: idx,
            style: exampleStyle,
            onClick: () => this.setState({ query: ex }),
          }, `• ${ex}`),
        ),
      ) : null,
    );
  }

  renderManualMode(): React.ReactNode {
    const { loadingOptions, searchText, selectedPlugins, selectedPhpVersions, selectedWpVersions, availablePlugins, availablePhpVersions, availableWpVersions, loading } = this.state;

    if (loadingOptions) {
      return React.createElement('div', { style: { fontSize: '12px', color: '#999', padding: '20px', textAlign: 'center' } },
        'Loading filter options...',
      );
    }

    const selectStyle: React.CSSProperties = {
      width: '100%',
      padding: '8px 12px',
      borderRadius: '6px',
      border: '1px solid #3d3d3d',
      fontSize: '13px',
      color: '#ffffff',
      backgroundColor: '#1d1d1d',
      outline: 'none',
      boxSizing: 'border-box',
      minHeight: '80px',
    };

    const labelStyle: React.CSSProperties = {
      fontSize: '11px',
      fontWeight: 600,
      color: '#999',
      marginBottom: '6px',
      display: 'block',
    };

    const formGroupStyle: React.CSSProperties = {
      marginBottom: '16px',
    };

    return React.createElement('div', null,
      // Search text
      React.createElement('div', { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'Site Name or Domain'),
        React.createElement('input', {
          style: inputStyle,
          type: 'text',
          placeholder: 'Search by name or domain...',
          value: searchText,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            this.setState({ searchText: e.target.value }),
          disabled: loading,
        }),
      ),

      // Plugins
      React.createElement('div', { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'Plugins (hold Cmd/Ctrl for multiple)'),
        React.createElement('select', {
          style: selectStyle,
          multiple: true,
          value: selectedPlugins,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
            this.setState({ selectedPlugins: selected });
          },
          disabled: loading,
        },
          availablePlugins.length === 0
            ? React.createElement('option', { disabled: true }, 'No plugins found - run "Refresh Site Finder Data" first')
            : availablePlugins.map(plugin =>
                React.createElement('option', { key: plugin, value: plugin }, plugin),
              ),
        ),
      ),

      // PHP Versions
      React.createElement('div', { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'PHP Version (hold Cmd/Ctrl for multiple)'),
        React.createElement('select', {
          style: selectStyle,
          multiple: true,
          value: selectedPhpVersions,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
            this.setState({ selectedPhpVersions: selected });
          },
          disabled: loading,
        },
          availablePhpVersions.map(version =>
            React.createElement('option', { key: version, value: version }, version),
          ),
        ),
      ),

      // WP Versions
      React.createElement('div', { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'WordPress Version (hold Cmd/Ctrl for multiple)'),
        React.createElement('select', {
          style: selectStyle,
          multiple: true,
          value: selectedWpVersions,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
            this.setState({ selectedWpVersions: selected });
          },
          disabled: loading,
        },
          availableWpVersions.length === 0
            ? React.createElement('option', { disabled: true }, 'No WP versions found - run "Refresh Site Finder Data" first')
            : availableWpVersions.map(version =>
                React.createElement('option', { key: version, value: version }, version),
              ),
        ),
      ),

      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '20px' } },
        React.createElement('button', {
          style: { ...buttonStyle, flex: 1, opacity: loading ? 0.6 : 1 },
          onClick: this.handleManualSearch,
          disabled: loading,
        }, loading ? 'Searching...' : 'Search'),
        React.createElement('button', {
          style: { ...secondaryButtonStyle, flex: 1 },
          onClick: this.handleClear,
        }, 'Clear'),
      ),
    );
  }

  renderInterpretedFilters(filters: InterpretedFilters): React.ReactNode {
    const items: string[] = [];
    if (filters.wpVersions?.length) items.push(`WP: ${filters.wpVersions.join(', ')}`);
    if (filters.phpVersions?.length) items.push(`PHP: ${filters.phpVersions.join(', ')}`);
    if (filters.plugins?.length) items.push(`Plugins: ${filters.plugins.join(', ')}`);
    if (filters.themes?.length) items.push(`Themes: ${filters.themes.join(', ')}`);
    if (filters.contentQuery) items.push(`Content: "${filters.contentQuery}"`);

    if (items.length === 0) return null;

    return React.createElement('div', { style: filtersDisplayStyle },
      React.createElement('div', { style: { fontSize: '11px', fontWeight: 600, color: '#7dd87d', marginBottom: '6px' } }, '🔍 Searching for:'),
      items.map((item, idx) =>
        React.createElement('div', { key: idx, style: filterItemStyle }, `✓ ${item}`),
      ),
    );
  }

  renderResultsList(): React.ReactNode {
    const { resultsCount, localResults, wpeResults, expandedWpeId } = this.state;
    if (resultsCount === null) return null;

    if (resultsCount === 0) {
      return React.createElement('div', {
        style: {
          marginTop: '20px', padding: '12px', borderRadius: '6px',
          backgroundColor: '#3d1d1d', border: '1px solid #5d2d2d',
          textAlign: 'center' as const, fontSize: '13px', color: '#d87d7d',
        },
      }, '⚠️ No matching sites found');
    }

    const sectionHeaderStyle: React.CSSProperties = {
      fontSize: '11px', fontWeight: 600, color: '#999',
      textTransform: 'uppercase' as const, letterSpacing: '0.08em',
      padding: '12px 0 6px',
    };

    const siteRowStyle: React.CSSProperties = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px', borderRadius: '5px', cursor: 'pointer',
      backgroundColor: '#1d1d1d', border: '1px solid #2d2d2d',
      marginBottom: '4px',
    };

    const siteNameStyle: React.CSSProperties = {
      fontSize: '13px', color: '#ffffff', fontWeight: 500,
    };

    const pillStyle: React.CSSProperties = {
      fontSize: '10px', color: '#51BB7B', backgroundColor: 'rgba(81,187,123,0.12)',
      border: '1px solid rgba(81,187,123,0.25)', borderRadius: '10px',
      padding: '2px 7px',
    };

    const expandedPanelStyle: React.CSSProperties = {
      backgroundColor: '#161616', border: '1px solid #2d2d2d', borderTop: 'none',
      borderRadius: '0 0 5px 5px', padding: '10px 12px', marginBottom: '4px',
      marginTop: '-4px',
    };

    const actionBtnStyle: React.CSSProperties = {
      fontSize: '11px', padding: '5px 10px', borderRadius: '4px', border: 'none',
      cursor: 'pointer', fontWeight: 600,
    };

    return React.createElement('div', { style: { marginTop: '20px' } },

      // Summary line
      React.createElement('div', {
        style: { fontSize: '12px', color: '#7dd87d', marginBottom: '4px', fontWeight: 600 },
      }, `✓ Found ${resultsCount} site${resultsCount === 1 ? '' : 's'} (${localResults.length} local, ${wpeResults.length} WPE)`),

      // LOCAL SITES
      localResults.length > 0 ? React.createElement('div', null,
        React.createElement('div', { style: sectionHeaderStyle }, `📍 Local Sites (${localResults.length})`),
        localResults.map((site: LocalSiteResult) =>
          React.createElement('div', {
            key: site.id,
            style: { ...siteRowStyle, cursor: 'pointer' },
            onClick: () => this.handleNavigateToSite(site.id),
            title: 'Click to open site',
          },
            React.createElement('span', { style: siteNameStyle }, site.name),
            React.createElement('span', { style: pillStyle }, 'Open →'),
          ),
        ),
      ) : null,

      // WPE SITES
      wpeResults.length > 0 ? React.createElement('div', null,
        React.createElement('div', { style: sectionHeaderStyle }, `🌐 WPE Sites (${wpeResults.length})`),
        wpeResults.map((site: WpeSiteResult) => {
          const isExpanded = expandedWpeId === site.id;
          return React.createElement('div', { key: site.id },
            // Row
            React.createElement('div', {
              style: {
                ...siteRowStyle,
                borderRadius: isExpanded ? '5px 5px 0 0' : '5px',
                borderBottom: isExpanded ? 'none' : '1px solid #2d2d2d',
              },
              onClick: () => this.handleToggleWpeSite(site.id),
            },
              React.createElement('div', null,
                React.createElement('span', {
                  style: { fontSize: '11px', color: '#666', marginRight: '6px' },
                }, isExpanded ? '▼' : '▶'),
                React.createElement('span', { style: siteNameStyle }, site.name),
              ),
              React.createElement('span', {
                style: { fontSize: '11px', color: '#666' },
              }, site.domain),
            ),
            // Expanded panel
            isExpanded ? React.createElement('div', { style: expandedPanelStyle },
              React.createElement('div', {
                style: { fontSize: '11px', color: '#666', marginBottom: '8px', fontFamily: 'monospace' },
              }, site.installId),
              React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                React.createElement('button', {
                  style: { ...actionBtnStyle, backgroundColor: '#51BB7B', color: '#fff' },
                  onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handlePullToLocal(site); },
                  title: 'Pull this WPE site to Local',
                }, '⬇ Pull to Local'),
                React.createElement('button', {
                  style: { ...actionBtnStyle, backgroundColor: '#2d2d2d', color: '#ccc', border: '1px solid #3d3d3d' },
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    this.props.electron.shell?.openExternal(`https://my.wpengine.com/installs/${site.installId}`);
                  },
                  title: 'Open in WP Engine dashboard',
                }, '🌍 View on WPE'),
              ),
            ) : null,
          );
        }),
      ) : null,
    );
  }

  render(): React.ReactNode {
    if (!this.props.isOpen) return null;

    const { aiMode } = this.state;
    const { hasLLM } = this.props;

    return React.createElement('div', {
      style: overlayStyle,
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) this.props.onClose();
      },
    },
      React.createElement('div', { style: panelStyle },
        // Header
        React.createElement('div', { style: headerStyle },
          React.createElement('h2', { style: titleStyle }, '🔍 Site Finder'),
          React.createElement('button', {
            style: closeButtonStyle,
            onClick: this.props.onClose,
          }, '×'),
        ),

        // Content
        React.createElement('div', { style: contentStyle },
          // Toggle (only if LLM available)
          hasLLM ? React.createElement('div', { style: toggleContainerStyle },
            React.createElement('span', { style: toggleLabelStyle }, 'Manual'),
            React.createElement('label', {
              style: {
                position: 'relative',
                display: 'inline-block',
                width: '48px',
                height: '24px',
                cursor: 'pointer',
              },
            },
              React.createElement('input', {
                type: 'checkbox',
                checked: aiMode,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  this.setState({ aiMode: e.target.checked }),
                style: { display: 'none' },
              }),
              React.createElement('span', {
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: aiMode ? '#51BB7B' : '#3d3d3d',
                  borderRadius: '24px',
                  transition: 'background-color 0.3s',
                },
              }),
              React.createElement('span', {
                style: {
                  position: 'absolute',
                  top: '2px',
                  left: aiMode ? '26px' : '2px',
                  width: '20px',
                  height: '20px',
                  backgroundColor: '#fff',
                  borderRadius: '50%',
                  transition: 'left 0.3s',
                },
              }),
            ),
            React.createElement('span', { style: toggleLabelStyle }, 'AI'),
          ) : null,

          // Mode content
          aiMode ? this.renderAIMode() : this.renderManualMode(),

          // Results list (Local + WPE sites)
          this.renderResultsList(),
        ),
      ),
    );
  }
}
