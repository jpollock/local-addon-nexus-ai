import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { ChatSession } from '../../../common/types';

interface Props {
  electron: any;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

interface State {
  sessions: ChatSession[];
  search: string;
  loading: boolean;
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: '#1a1e24',
    borderRight: '1px solid #2c313a',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid #2c313a',
  },
  searchInput: {
    flex: 1,
    background: '#23272f',
    border: '1px solid #2c313a',
    borderRadius: 4,
    color: '#e4e7ec',
    fontSize: 12,
    padding: '4px 8px',
    outline: 'none',
  },
  newBtn: {
    background: '#29b6cf',
    border: 'none',
    borderRadius: 4,
    color: '#05262e',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '3px 8px',
    fontWeight: 700,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  row: (active: boolean) => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: active ? '#29b6cf22' : 'transparent',
    borderLeft: active ? '2px solid #29b6cf' : '2px solid transparent',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  }),
  rowTitle: {
    color: '#e4e7ec',
    fontSize: 12,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowMeta: {
    color: '#868d98',
    fontSize: 11,
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  actionBadge: {
    color: '#5fd2e5',
    fontSize: 10,
    fontWeight: 600,
  },
  expiryBadge: {
    color: '#e0a94b',
    fontSize: 10,
  },
  empty: {
    color: '#868d98',
    fontSize: 12,
    padding: '24px 12px',
    textAlign: 'center' as const,
  },
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function daysUntilExpiry(expiresAt: number): number {
  return Math.ceil((expiresAt - Date.now()) / 86400000);
}

export class SessionsSidebar extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { sessions: [], search: '', loading: false };
    this.handleSearch = this.handleSearch.bind(this);
    this.handleDelete = this.handleDelete.bind(this);
  }

  componentDidMount() {
    this.loadSessions();
  }

  async loadSessions() {
    this.setState({ loading: true });
    try {
      const sessions = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_LIST);
      this.setState({ sessions, loading: false });
    } catch {
      this.setState({ loading: false });
    }
  }

  async handleDelete(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_DELETE, { sessionId });
    this.loadSessions();
  }

  handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ search: e.target.value });
  }

  render() {
    const { activeSessionId, onSelectSession, onNewSession } = this.props;
    const { sessions, search, loading } = this.state;

    const filtered = search
      ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
      : sessions;

    return React.createElement(
      'div',
      { style: styles.root },
      React.createElement(
        'div',
        { style: styles.toolbar },
        React.createElement('input', {
          style: styles.searchInput,
          placeholder: 'Search chats…',
          value: search,
          onChange: this.handleSearch,
        }),
        React.createElement(
          'button',
          { style: styles.newBtn, onClick: onNewSession, title: 'New chat' },
          '+',
        ),
      ),
      React.createElement(
        'div',
        { style: styles.list },
        loading
          ? React.createElement('div', { style: styles.empty }, 'Loading…')
          : filtered.length === 0
          ? React.createElement('div', { style: styles.empty }, 'No chats yet')
          : filtered.map((session) => {
              const isActive = session.id === activeSessionId;
              const daysLeft = session.expiresAt ? daysUntilExpiry(session.expiresAt) : null;
              const showExpiry = daysLeft !== null && !session.pinned && daysLeft <= 7;

              return React.createElement(
                'div',
                {
                  key: session.id,
                  style: styles.row(isActive),
                  onClick: () => onSelectSession(session.id),
                },
                React.createElement('div', { style: styles.rowTitle }, session.title),
                React.createElement(
                  'div',
                  { style: styles.rowMeta },
                  React.createElement('span', null, relativeTime(session.updatedAt)),
                  session.actionCount > 0
                    ? React.createElement(
                        'span',
                        { style: styles.actionBadge },
                        `${session.actionCount} actions`,
                      )
                    : null,
                  showExpiry
                    ? React.createElement(
                        'span',
                        { style: styles.expiryBadge },
                        `expires in ${daysLeft}d`,
                      )
                    : null,
                ),
              );
            }),
      ),
    );
  }
}
