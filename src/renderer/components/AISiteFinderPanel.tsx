/**
 * AI Site Finder Panel Component
 *
 * Natural language site discovery powered by LLM.
 * Features:
 * - Text input for natural language queries
 * - Clickable example queries
 * - Follow-up clarification questions (max 2 rounds)
 * - Shows interpreted filters before executing
 * - Falls back to manual filters if LLM unavailable
 *
 * Class-based -- Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface AISiteFinderPanelProps {
  electron: any;
  onFilterApply?: (siteIds: string[]) => void;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AISiteFinderPanelState {
  query: string;
  conversation: ConversationMessage[];
  loading: boolean;
  error: string | null;
  interpretedFilters: InterpretedFilters | null;
  resultsCount: number | null;
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

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '8px',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '16px',
  fontStyle: 'italic',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '14px',
  color: 'var(--nxai-card-text)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: '44px',
  resize: 'vertical',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginTop: '12px',
};

const searchButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#3b82f6',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const clearButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-text)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const examplesContainerStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
};

const exampleLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '8px',
};

const exampleItemStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#3b82f6',
  cursor: 'pointer',
  padding: '6px 0',
  textDecoration: 'none',
};

const conversationStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: 'var(--nxai-code-bg, #f3f4f6)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
};

const messageStyle = (role: 'user' | 'assistant'): React.CSSProperties => ({
  padding: '8px 12px',
  marginBottom: '8px',
  borderRadius: '6px',
  backgroundColor: role === 'user' ? '#e0f2fe' : '#fef3c7',
  fontSize: '13px',
  color: role === 'user' ? '#0c4a6e' : '#78350f', // Dark text on light backgrounds
});

const filtersDisplayStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: '#f0fdf4',
  border: '1px solid #86efac',
};

const filterItemStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#15803d',
  padding: '4px 0',
};

const resultsStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '8px 12px',
  borderRadius: '6px',
  backgroundColor: '#3b82f610',
  border: '1px solid #3b82f640',
  color: '#3b82f6',
  fontSize: '12px',
  fontWeight: 600,
  textAlign: 'center',
};

const errorStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: '#fef2f2',
  border: '1px solid #fca5a5',
  color: 'var(--color-error, #dc2626)',
  fontSize: '13px',
};

const EXAMPLE_QUERIES = [
  "WP 6.8.1 with ACF and content about cars",
  "WooCommerce sites on old PHP",
  "sites with security vulnerabilities",
  "staging environments with recent posts about ecommerce",
];

/**
 * AISiteFinderPanel Component
 */
export class AISiteFinderPanel extends React.Component<AISiteFinderPanelProps, AISiteFinderPanelState> {
  private _mounted = false;

  state: AISiteFinderPanelState = {
    query: '',
    conversation: [],
    loading: false,
    error: null,
    interpretedFilters: null,
    resultsCount: null,
  };

  componentDidMount(): void {
    this._mounted = true;
  }

  componentWillUnmount(): void {
    this._mounted = false;
  }

  handleSearch = async (): Promise<void> => {
    if (!this.state.query.trim() || this.state.loading) return;

    // Max 3 messages total (initial + 2 follow-ups)
    if (this.state.conversation.length >= 3) {
      this.setState({
        error: 'Too many clarification rounds. Please try a clearer query or use manual filters.',
      });
      return;
    }

    this.setState({ loading: true, error: null });

    const newConversation: ConversationMessage[] = [
      ...this.state.conversation,
      { role: 'user', content: this.state.query },
    ];

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_AI_PARSE,
        {
          conversation: newConversation,
        },
      );

      if (!this._mounted) return;

      if (!result.success) {
        this.setState({
          loading: false,
          error: result.error || 'AI parsing failed. Try manual filters.',
        });
        return;
      }

      // Check if we need clarification
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

      // We have filters! Execute search
      console.log('[AISiteFinder] Parsed filters:', JSON.stringify(result.filters, null, 2));

      this.setState({
        interpretedFilters: result.filters,
        conversation: newConversation,
        loading: false,
      });

      // Execute actual search
      await this.executeSearch(result.filters);
    } catch (err) {
      if (!this._mounted) return;
      this.setState({
        loading: false,
        error: 'Search failed. Try manual filters.',
      });
    }
  };

  executeSearch = async (filters: InterpretedFilters): Promise<void> => {
    try {
      const payload = {
        searchText: filters.searchText || '',
        plugins: filters.plugins || [],
        themes: filters.themes || [],
        phpVersions: filters.phpVersions || [],
        wpVersions: filters.wpVersions || [],
        contentQuery: filters.contentQuery || '',
      };
      console.log('[AISiteFinder] Executing search with:', JSON.stringify(payload, null, 2));

      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_APPLY,
        payload,
      );

      if (!this._mounted) return;

      console.log('[AISiteFinder] Search result:', result);

      this.setState({
        resultsCount: result.success ? (result.siteIds?.length || 0) : null,
      });

      if (result.success && this.props.onFilterApply) {
        this.props.onFilterApply(result.siteIds || []);
      }
    } catch {
      if (!this._mounted) return;
      this.setState({ error: 'Failed to execute search' });
    }
  };

  handleClear = (): void => {
    this.setState({
      query: '',
      conversation: [],
      interpretedFilters: null,
      resultsCount: null,
      error: null,
    });

    if (this.props.onFilterApply) {
      this.props.onFilterApply([]);
    }
  };

  handleExampleClick = (example: string): void => {
    this.setState({ query: example });
  };

  renderConversation(): React.ReactNode {
    if (this.state.conversation.length === 0) return null;

    return React.createElement(
      'div',
      { style: conversationStyle },
      this.state.conversation.map((msg, idx) =>
        React.createElement(
          'div',
          { key: idx, style: messageStyle(msg.role) },
          React.createElement('strong', null, msg.role === 'user' ? 'You: ' : 'AI: '),
          msg.content,
        ),
      ),
    );
  }

  renderInterpretedFilters(): React.ReactNode {
    const { interpretedFilters } = this.state;
    if (!interpretedFilters) return null;

    const items: string[] = [];
    if (interpretedFilters.wpVersions?.length) {
      items.push(`WordPress: ${interpretedFilters.wpVersions.join(', ')}`);
    }
    if (interpretedFilters.phpVersions?.length) {
      items.push(`PHP: ${interpretedFilters.phpVersions.join(', ')}`);
    }
    if (interpretedFilters.plugins?.length) {
      items.push(`Plugins: ${interpretedFilters.plugins.join(', ')}`);
    }
    if (interpretedFilters.themes?.length) {
      items.push(`Themes: ${interpretedFilters.themes.join(', ')}`);
    }
    if (interpretedFilters.contentQuery) {
      items.push(`Content: "${interpretedFilters.contentQuery}"`);
    }
    if (interpretedFilters.searchText) {
      items.push(`Search: "${interpretedFilters.searchText}"`);
    }

    if (items.length === 0) return null;

    return React.createElement(
      'div',
      { style: filtersDisplayStyle },
      React.createElement('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, '🔍 Searching for:'),
      items.map((item, idx) =>
        React.createElement('div', { key: idx, style: filterItemStyle }, `✓ ${item}`),
      ),
    );
  }

  render(): React.ReactNode {
    const { query, loading, error, resultsCount } = this.state;

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, '🤖 AI Site Finder'),
      React.createElement('div', { style: subtitleStyle }, 'Describe the sites you\'re looking for in plain English'),

      // Main input
      React.createElement('textarea', {
        style: inputStyle,
        placeholder: 'e.g., "Find WP 6.8.1 sites with ACF and posts about cars"',
        value: query,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
          this.setState({ query: e.target.value }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            this.handleSearch();
          }
        },
        disabled: loading,
        rows: 2,
      }),

      // Buttons
      React.createElement(
        'div',
        { style: buttonRowStyle },
        React.createElement(
          'button',
          {
            style: { ...searchButtonStyle, opacity: loading ? 0.6 : 1 },
            onClick: this.handleSearch,
            disabled: loading || !query.trim(),
          },
          loading ? 'Thinking...' : 'Search',
        ),
        React.createElement(
          'button',
          {
            style: clearButtonStyle,
            onClick: this.handleClear,
          },
          'Clear',
        ),
      ),

      // Conversation history
      this.renderConversation(),

      // Interpreted filters
      this.renderInterpretedFilters(),

      // Error
      error
        ? React.createElement('div', { style: errorStyle }, error)
        : null,

      // Results count
      resultsCount !== null
        ? React.createElement(
            'div',
            { style: resultsStyle },
            `Found ${resultsCount} site${resultsCount === 1 ? '' : 's'}`,
          )
        : null,

      // Example queries (only show if no conversation yet)
      this.state.conversation.length === 0
        ? React.createElement(
            'div',
            { style: examplesContainerStyle },
            React.createElement('div', { style: exampleLabelStyle }, '💡 Try these examples:'),
            EXAMPLE_QUERIES.map((example, idx) =>
              React.createElement(
                'div',
                {
                  key: idx,
                  style: exampleItemStyle,
                  onClick: () => this.handleExampleClick(example),
                },
                `• ${example}`,
              ),
            ),
          )
        : null,
    );
  }
}
