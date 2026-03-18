/**
 * Saved Queries Panel Component (Sprint 2)
 *
 * Displays and manages saved search queries.
 * Features:
 * - List of saved queries with name, last run, result count
 * - Run, pin/unpin, and delete actions per query
 * - Create new query form
 * - Pinned queries shown first
 * - Empty state when no queries
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  filters: any;
  createdAt: number;
  lastRun: number | null;
  resultCount: number;
  pinned: boolean;
}

interface SavedQueriesPanelProps {
  electron: any;
  onQueryRun?: (queryId: string, filters: any) => void;
}

interface SavedQueriesPanelState {
  queries: SavedQuery[];
  loading: boolean;
  error: string | null;
  showCreateForm: boolean;
  newQueryName: string;
}

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
};

const newButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-text)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const queryListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const queryItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
};

const queryInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const queryNameStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const queryMetaStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginTop: '2px',
};

const queryActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexShrink: 0,
};

const actionBtnStyle = (variant: 'default' | 'danger'): React.CSSProperties => ({
  padding: '4px 8px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: variant === 'danger' ? '#ef444420' : 'var(--nxai-card-border, #e5e7eb)',
  color: variant === 'danger' ? '#ef4444' : 'var(--nxai-card-text)',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
});

const pinIconStyle = (pinned: boolean): React.CSSProperties => ({
  padding: '4px 8px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: pinned ? '#f59e0b20' : 'var(--nxai-card-border, #e5e7eb)',
  color: pinned ? '#f59e0b' : 'var(--nxai-card-sub, #6b7280)',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
});

const createFormStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '12px',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  backgroundColor: 'transparent',
  outline: 'none',
};

const submitBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '#3b82f6',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  padding: '20px',
  border: '1px solid #ef4444',
  borderRadius: '6px',
  backgroundColor: '#ef444410',
  color: 'var(--color-error, #ef4444)',
  fontSize: '13px',
};

/**
 * SavedQueriesPanel Component
 */
export class SavedQueriesPanel extends React.Component<SavedQueriesPanelProps, SavedQueriesPanelState> {
  private _mounted = false;

  state: SavedQueriesPanelState = {
    queries: [],
    loading: true,
    error: null,
    showCreateForm: false,
    newQueryName: '',
  };

  componentDidMount(): void {
    this._mounted = true;
    this.fetchQueries();
  }

  componentWillUnmount(): void {
    this._mounted = false;
  }

  fetchQueries = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.QUERIES_LIST,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          queries: result.queries || [],
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load queries',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({
        error: err.message || 'Failed to load queries',
        loading: false,
      });
    }
  };

  handleRun = async (query: SavedQuery): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.QUERIES_RUN,
        query.id,
      );

      if (!this._mounted) return;

      if (result.success && this.props.onQueryRun) {
        this.props.onQueryRun(query.id, query.filters);
      }

      // Update lastRun in local state
      this.setState(prev => ({
        queries: prev.queries.map(q =>
          q.id === query.id ? { ...q, lastRun: Date.now(), resultCount: result.resultCount || q.resultCount } : q,
        ),
      }));
    } catch (err: any) {
      // Silently handle
    }
  };

  handlePin = async (query: SavedQuery): Promise<void> => {
    const newPinned = !query.pinned;

    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.QUERIES_UPDATE,
        query.id,
        { pinned: newPinned },
      );

      if (!this._mounted) return;

      this.setState(prev => ({
        queries: prev.queries.map(q =>
          q.id === query.id ? { ...q, pinned: newPinned } : q,
        ),
      }));
    } catch (err: any) {
      // Silently handle
    }
  };

  handleDelete = async (queryId: string): Promise<void> => {
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.QUERIES_DELETE,
        queryId,
      );

      if (!this._mounted) return;

      this.setState(prev => ({
        queries: prev.queries.filter(q => q.id !== queryId),
      }));
    } catch (err: any) {
      // Silently handle
    }
  };

  handleCreate = async (): Promise<void> => {
    const { newQueryName } = this.state;
    if (!newQueryName.trim()) return;

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.QUERIES_CREATE,
        { name: newQueryName.trim(), filters: {} },
      );

      if (!this._mounted) return;

      if (result.success && result.query) {
        this.setState(prev => ({
          queries: [...prev.queries, result.query],
          showCreateForm: false,
          newQueryName: '',
        }));
      }
    } catch (err: any) {
      // Silently handle
    }
  };

  formatLastRun(timestamp: number | null): string {
    if (!timestamp) return 'Never run';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  getSortedQueries(): SavedQuery[] {
    return [...this.state.queries].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }

  renderCreateForm(): React.ReactNode {
    return React.createElement(
      'div',
      { style: createFormStyle },
      React.createElement('input', {
        style: inputStyle,
        type: 'text',
        placeholder: 'Query name...',
        value: this.state.newQueryName,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ newQueryName: e.target.value }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter') this.handleCreate();
          if (e.key === 'Escape') this.setState({ showCreateForm: false, newQueryName: '' });
        },
      }),
      React.createElement(
        'button',
        { style: submitBtnStyle, onClick: () => this.handleCreate() },
        'Save',
      ),
      React.createElement(
        'button',
        { style: cancelBtnStyle, onClick: () => this.setState({ showCreateForm: false, newQueryName: '' }) },
        'Cancel',
      ),
    );
  }

  renderQuery(query: SavedQuery): React.ReactNode {
    return React.createElement(
      'div',
      { key: query.id, style: queryItemStyle },
      React.createElement(
        'div',
        { style: queryInfoStyle },
        React.createElement('div', { style: queryNameStyle }, query.pinned ? `* ${query.name}` : query.name),
        React.createElement(
          'div',
          { style: queryMetaStyle },
          `${this.formatLastRun(query.lastRun)} | ${query.resultCount} result${query.resultCount === 1 ? '' : 's'}`,
        ),
      ),
      React.createElement(
        'div',
        { style: queryActionsStyle },
        React.createElement(
          'button',
          { style: actionBtnStyle('default'), onClick: () => this.handleRun(query) },
          'Run',
        ),
        React.createElement(
          'button',
          { style: pinIconStyle(query.pinned), onClick: () => this.handlePin(query) },
          query.pinned ? 'Unpin' : 'Pin',
        ),
        React.createElement(
          'button',
          { style: actionBtnStyle('danger'), onClick: () => this.handleDelete(query.id) },
          'Delete',
        ),
      ),
    );
  }

  renderEmptyState(): React.ReactNode {
    return React.createElement('div', { style: emptyStateStyle }, 'No saved queries yet');
  }

  renderLoading(): React.ReactNode {
    return React.createElement('div', { style: loadingStyle }, 'Loading queries...');
  }

  renderError(): React.ReactNode {
    return React.createElement('div', { style: errorStyle }, `Error: ${this.state.error}`);
  }

  render(): React.ReactNode {
    const { loading, error, showCreateForm } = this.state;
    const queries = this.getSortedQueries();

    let content: React.ReactNode;
    if (loading) {
      content = this.renderLoading();
    } else if (error) {
      content = this.renderError();
    } else if (queries.length === 0 && !showCreateForm) {
      content = this.renderEmptyState();
    } else {
      content = React.createElement(
        'div',
        { style: queryListStyle },
        queries.map(q => this.renderQuery(q)),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement(
        'div',
        { style: titleRowStyle },
        React.createElement('div', { style: titleStyle }, 'Saved Queries'),
        React.createElement(
          'button',
          {
            style: newButtonStyle,
            onClick: () => this.setState({ showCreateForm: !showCreateForm }),
          },
          showCreateForm ? 'Cancel' : '+ New Query',
        ),
      ),
      showCreateForm ? this.renderCreateForm() : null,
      content,
    );
  }
}
