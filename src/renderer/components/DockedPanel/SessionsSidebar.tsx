import React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import type { ChatSession } from '../../../common/types';

interface Props {
  electron: any;
  activeSessionId: string | null;
  version?: number;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

interface State {
  sessions: ChatSession[];
  search: string;
  loading: boolean;
  hoveredId: string | null;
  renamingId: string | null;
  renameValue: string;
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: 'var(--nxai-card-bg)',
    borderRight: `1px solid var(--nxai-card-border)`,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: `1px solid var(--nxai-card-border)`,
  },
  searchInput: {
    flex: 1,
    background: 'var(--nxai-input-bg)',
    border: `1px solid var(--nxai-card-border)`,
    borderRadius: 4,
    color: 'var(--nxai-card-text)',
    fontSize: 12,
    padding: '4px 8px',
    outline: 'none',
  },
  newBtn: {
    background: UI_COLORS.WPE_BRAND,
    border: 'none',
    borderRadius: 4,
    color: UI_COLORS.NEXUS_MARK,
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
    background: active ? 'rgba(14, 202, 212, 0.13)' : 'transparent',
    borderLeft: active ? `2px solid ${UI_COLORS.WPE_BRAND}` : '2px solid transparent',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  }),
  rowTitle: {
    color: 'var(--nxai-card-text)',
    fontSize: 12,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowMeta: {
    color: 'var(--nxai-card-sub)',
    fontSize: 11,
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  actionBadge: {
    color: UI_COLORS.WPE_BRAND,
    fontSize: 10,
    fontWeight: 600,
  },
  expiryBadge: {
    color: 'var(--nxai-warn-text)',
    fontSize: 10,
  },
  empty: {
    color: 'var(--nxai-card-sub)',
    fontSize: 12,
    padding: '24px 12px',
    textAlign: 'center' as const,
  },
  hoverControls: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  renameInput: {
    background: 'var(--nxai-input-bg)',
    border: `1px solid ${UI_COLORS.WPE_BRAND}`,
    borderRadius: 3,
    color: 'var(--nxai-card-text)',
    fontSize: 12,
    padding: '2px 6px',
    outline: 'none',
    width: '100%',
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
  private clearListener: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { sessions: [], search: '', loading: false, hoveredId: null, renamingId: null, renameValue: '' };
    this.handleSearch = this.handleSearch.bind(this);
    this.handleDelete = this.handleDelete.bind(this);
    this.handlePin = this.handlePin.bind(this);
    this.handleStartRename = this.handleStartRename.bind(this);
    this.handleRenameCommit = this.handleRenameCommit.bind(this);
  }

  componentDidMount() {
    // Listen for chat-all-cleared (fired when user deletes all history via Settings)
    this.clearListener = () => {
      // Clear sessions list immediately so stale sessions don't linger
      this.setState({ sessions: [] });
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_ALL_CLEARED, this.clearListener);

    this.loadSessions();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.version !== this.props.version) {
      this.loadSessions();
    }
  }

  componentWillUnmount() {
    if (this.clearListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_ALL_CLEARED, this.clearListener);
      this.clearListener = null;
    }
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

  async handlePin(e: React.MouseEvent, session: ChatSession) {
    e.stopPropagation();
    const updated = {
      ...session,
      pinned: !session.pinned,
      expiresAt: session.pinned ? Date.now() + 30 * 86400000 : null,
    };
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_SAVE, { session: updated, messages: [] });
    this.loadSessions();
  }

  handleStartRename(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const session = this.state.sessions.find((s) => s.id === id);
    this.setState({ renamingId: id, renameValue: session ? session.title : '' });
  }

  async handleRenameCommit(session: ChatSession) {
    const { renameValue } = this.state;
    const updated = { ...session, title: renameValue };
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_SAVE, { session: updated, messages: [] });
    this.setState({ renamingId: null, renameValue: '' });
    this.loadSessions();
  }

  render() {
    const { activeSessionId, onSelectSession, onNewSession } = this.props;
    const { sessions, search, loading, hoveredId, renamingId, renameValue } = this.state;

    const smallIconBtn: React.CSSProperties = {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--nxai-card-sub)',
      padding: '2px 4px',
      fontSize: 11,
    };

    const filtered = search
      ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
      : sessions;

    // Pinned sessions appear first
    const sorted = [...filtered].sort((a, b) => {
      if (a.pinned === b.pinned) return 0;
      return a.pinned ? -1 : 1;
    });

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
        { style: styles.list, 'data-nexus-sessions': true },
        loading
          ? React.createElement('div', { style: styles.empty }, 'Loading…')
          : sorted.length === 0
          ? React.createElement('div', { style: styles.empty }, 'No chats yet')
          : sorted.map((session) => {
              const isActive = session.id === activeSessionId;
              const isHovered = hoveredId === session.id;
              const isRenaming = renamingId === session.id;
              const daysLeft = session.expiresAt ? daysUntilExpiry(session.expiresAt) : null;
              const showExpiry = daysLeft !== null && !session.pinned && daysLeft <= 7;

              return React.createElement(
                'div',
                {
                  key: session.id,
                  style: styles.row(isActive),
                  onClick: () => !isRenaming && onSelectSession(session.id),
                  onMouseEnter: () => this.setState({ hoveredId: session.id }),
                  onMouseLeave: () => this.setState({ hoveredId: null }),
                },
                isRenaming
                  ? React.createElement('input', {
                      style: styles.renameInput,
                      value: renameValue,
                      autoFocus: true,
                      onClick: (e: React.MouseEvent) => e.stopPropagation(),
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                        this.setState({ renameValue: e.target.value }),
                      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          this.handleRenameCommit(session);
                        } else if (e.key === 'Escape') {
                          this.setState({ renamingId: null, renameValue: '' });
                        }
                      },
                    })
                  : React.createElement('div', { style: styles.rowTitle }, session.pinned ? `📌 ${session.title}` : session.title),
                React.createElement(
                  'div',
                  { style: styles.rowMeta },
                  React.createElement('span', null, relativeTime(session.updatedAt)),
                  session.actionCount > 0
                    ? React.createElement(
                        'span',
                        {
                          style: { ...styles.actionBadge, cursor: 'pointer', textDecoration: 'underline' },
                          onClick: (e: React.MouseEvent) => {
                            e.stopPropagation();
                            // Notifies Activity tab to filter by session; receiver needs adding
                            // to EventTimeline once it carries session_id.
                            this.props.electron.ipcRenderer.send(IPC_CHANNELS.ACTIVITY_FILTER, {
                              sessionId: session.id,
                              sessionTitle: session.title,
                            });
                          },
                        },
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
                isHovered && !isRenaming
                  ? React.createElement(
                      'div',
                      { style: styles.hoverControls },
                      React.createElement(
                        'button',
                        { style: smallIconBtn, onClick: (e: React.MouseEvent) => this.handlePin(e, session) },
                        session.pinned ? '📌' : '📍',
                      ),
                      React.createElement(
                        'button',
                        { style: smallIconBtn, onClick: (e: React.MouseEvent) => this.handleStartRename(e, session.id) },
                        '✏',
                      ),
                      React.createElement(
                        'button',
                        {
                          style: { ...smallIconBtn, color: 'var(--nxai-danger-text)' },
                          onClick: (e: React.MouseEvent) => this.handleDelete(e, session.id),
                        },
                        '✕',
                      ),
                    )
                  : null,
              );
            }),
      ),
    );
  }
}
