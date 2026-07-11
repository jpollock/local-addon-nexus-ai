import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { ActionCard } from './ActionCard';
import type { ChatSession, ChatMessage } from '../../../common/types';

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
    status: 'pending' | 'awaiting_approval' | 'running' | 'done' | 'error';
  }>;
}

interface Props {
  electron: any;
  sessionId: string | null;
  selectedSiteIds: string[];
  onSessionCreated: (id: string) => void;
  onSessionSaved: (session: ChatSession, messages: ChatMessage[]) => void;
}

interface State {
  messages: UIMessage[];
  input: string;
  streaming: boolean;
  streamingId: string | null;
  providerId: string;
  model: string;
  // Local copy of sessionId so CHAT_STOP/CHAT_TOOL_APPROVE always have it
  // even before the parent re-render propagates the prop update.
  activeSessionId: string | null;
  offline: boolean;
  // Tracks the DB-persisted action_count so persistSession never resets it to 0.
  actionCount: number;
  // Mirrors chatRetentionDays setting; null means keep forever.
  retentionDays: number | null;
}

const styles = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  log: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    background: '#29b6cf',
    color: '#05262e',
    borderRadius: '12px 12px 2px 12px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: 480,
    wordBreak: 'break-word' as const,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: '#2c313a',
    color: '#e4e7ec',
    borderRadius: '2px 12px 12px 12px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: 580,
    wordBreak: 'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  systemLine: {
    alignSelf: 'center',
    background: '#10262b',
    color: '#5fd2e5',
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 11,
    textAlign: 'center' as const,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    borderTop: '1px solid #2c313a',
    background: '#1a1e24',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: '#23272f',
    border: '1px solid #2c313a',
    borderRadius: 6,
    color: '#e4e7ec',
    fontSize: 13,
    padding: '8px 10px',
    resize: 'none' as const,
    outline: 'none',
    fontFamily: 'inherit',
    minHeight: 36,
    maxHeight: 120,
  },
  sendBtn: (disabled: boolean) => ({
    background: disabled ? '#2c313a' : '#29b6cf',
    border: 'none',
    borderRadius: 6,
    color: disabled ? '#868d98' : '#05262e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 18,
    padding: '0 14px',
    fontWeight: 700,
    alignSelf: 'flex-end',
    height: 36,
  }),
};

/** Fire-and-forget telemetry helper. Never throws. */
function track(ipcRenderer: any, event: string, properties: Record<string, unknown> = {}) {
  try { ipcRenderer.send(IPC_CHANNELS.TELEMETRY_TRACK, { event, properties }); } catch (_) {}
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const trimmed = text.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
  ollama: 'Ollama',
  'local-gateway': 'Gateway',
};

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

const TOOL_NAMES: Record<string, string> = {
  fleet_overview: 'Fleet Overview',
  fleet_search: 'Fleet Search',
  fleet_sql: 'Fleet SQL Query',
  fleet_health_summary: 'Fleet Health Check',
  fleet_filter: 'Fleet Filter',
  fleet_summary: 'Fleet Summary',
  nexus_list_sites: 'List Sites',
  nexus_site_audit: 'Site Audit',
  nexus_site_refresh: 'Refresh Site',
  get_site_structure: 'Get Site Structure',
  get_site_health: 'Site Health',
  wp_plugin_list: 'List Plugins',
  wp_plugin_update: 'Update Plugin',
  wp_plugin_install: 'Install Plugin',
  wp_plugin_activate: 'Activate Plugin',
  wp_plugin_deactivate: 'Deactivate Plugin',
  wp_core_update: 'Update WordPress Core',
  wp_core_version: 'Check WordPress Version',
  wp_site_health: 'Site Health Check',
  wp_eval: 'Run PHP Code',
  wp_search_replace: 'Search & Replace Database',
  local_wpe_push: 'Push to WP Engine',
  local_wpe_pull: 'Pull from WP Engine',
  local_clone_site: 'Clone Site',
  local_delete_site: 'Delete Local Site',
  local_export_site: 'Export Site',
  wpe_promote_environment: 'Promote Environment',
  wpe_delete_install: 'Delete WP Engine Install',
  wpe_delete_site: 'Delete WP Engine Site',
  clean_database_items: 'Clean Database',
  scan_database_health: 'Scan Database Health',
  reindex_site: 'Reindex Site',
  search_site_content: 'Search Site Content',
};

const TOOL_EFFECTS: Record<string, string> = {
  local_wpe_push: 'Overwrites the live WP Engine environment with local files.',
  local_wpe_pull: 'Overwrites local site with files from WP Engine.',
  local_delete_site: 'Permanently removes the local site and all its files.',
  wpe_delete_install: 'Permanently deletes a WP Engine environment and all its content.',
  wpe_delete_site: 'Permanently deletes a WP Engine site and all its installs.',
  wpe_promote_environment: 'Overwrites the destination environment with source content.',
  clean_database_items: 'Permanently removes selected database rows.',
  wp_core_update: 'Updates WordPress core files on the site.',
  wp_plugin_install: 'Installs a new plugin on the site.',
  wp_plugin_update: 'Updates plugin files on the site.',
  wp_search_replace: 'Modifies data across the entire WordPress database.',
  wp_eval: 'Executes PHP code directly on the site.',
};

function toolDisplayName(name: string): string {
  return TOOL_NAMES[name] ?? name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function toolEffect(name: string): string {
  return TOOL_EFFECTS[name] ?? `Runs ${toolDisplayName(name)} on your WordPress sites.`;
}

export class PanelChat extends React.Component<Props, State> {
  private logRef = React.createRef<HTMLDivElement>();
  private inputRef = React.createRef<HTMLTextAreaElement>();
  private streamListener: ((_event: any, sessionId: string, event: any) => void) | null = null;
  private actionListener: ((...args: any[]) => void) | null = null;
  private offlineListener: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      messages: [],
      input: '',
      streaming: false,
      streamingId: null,
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
      activeSessionId: props.sessionId,
      offline: false,
      actionCount: 0,
      retentionDays: 30,
    };
    this.handleInput = this.handleInput.bind(this);
    this.handleSend = this.handleSend.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleStop = this.handleStop.bind(this);
    this.handleApprove = this.handleApprove.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
  }

  componentDidMount() {
    this.streamListener = (_event: any, sessionId: string, event: any) => {
      // Only process events for our session
      if (sessionId !== this.state.activeSessionId) return;
      this.onStreamEvent(event);
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, this.streamListener);

    // Listen for action count updates
    this.actionListener = (_event: any, sessionId: string, _data: { sessionId: string; actionCount: number }) => {
      if (sessionId !== this.state.activeSessionId) return;
      // Keep local actionCount in sync so persistSession writes the correct value.
      this.setState((s) => ({ actionCount: s.actionCount + 1 }));
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_SESSION_ACTION_RECORDED, this.actionListener);

    // Listen for offline/online events
    this.offlineListener = () => this.setState({ offline: true });
    this.onlineListener = () => this.setState({ offline: false });
    window.addEventListener('offline', this.offlineListener);
    window.addEventListener('online', this.onlineListener);

    this.loadSettings();
    if (this.props.sessionId) {
      this.loadSession(this.props.sessionId);
    }
  }

  componentWillUnmount() {
    if (this.streamListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, this.streamListener);
      this.streamListener = null;
    }
    if (this.actionListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SESSION_ACTION_RECORDED, this.actionListener);
      this.actionListener = null;
    }
    if (this.offlineListener) window.removeEventListener('offline', this.offlineListener);
    if (this.onlineListener) window.removeEventListener('online', this.onlineListener);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.sessionId !== this.props.sessionId) {
      if (this.props.sessionId) {
        this.setState({ activeSessionId: this.props.sessionId });
        this.loadSession(this.props.sessionId);
      } else {
        // New chat — reset all message state
        this.setState({
          messages: [],
          activeSessionId: null,
          streaming: false,
          streamingId: null,
          actionCount: 0,
          input: '',
        });
      }
    }
  }

  async loadSettings() {
    try {
      const settings = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
      const providerId = settings?.aiProvider || 'anthropic';
      const model = settings?.aiModel || 'claude-sonnet-5';
      // chatRetentionDays: undefined means the setting was never saved — keep the 30-day default.
      const retentionDays = settings?.chatRetentionDays !== undefined
        ? (settings.chatRetentionDays as number | null)
        : 30;
      this.setState({ providerId, model, retentionDays });
    } catch {
      // Keep defaults
    }
  }

  async loadSession(sessionId: string) {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.CHAT_SESSION_GET,
        { sessionId },
      );
      if (!result) return;
      const messages: UIMessage[] = (result.messages ?? []).map((m: ChatMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }));
      // Restore the DB-persisted action count so persistSession never resets it to 0.
      const actionCount: number = result.session?.actionCount ?? 0;
      this.setState({ messages, actionCount });
    } catch { /* ignore */ }
  }

  onStreamEvent(event: any) {
    const { streamingId } = this.state;
    if (event.type === 'token') {
      this.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === streamingId ? { ...m, content: m.content + event.text } : m,
        ),
      }));
    } else if (event.type === 'tool_call_start') {
      // Show a non-blocking running indicator — main process executes read tools immediately.
      // Only tier-3 tools pause for approval (tool_call_approval_needed fires later).
      this.setState((s) => {
        const msgs = s.messages.map((m) => {
          if (m.id !== streamingId) return m;
          return {
            ...m,
            toolCalls: [
              ...(m.toolCalls ?? []),
              { id: event.id, name: event.name, args: '', status: 'running' as const },
            ],
          };
        });
        return { messages: msgs };
      });
    } else if (event.type === 'tool_call_approval_needed') {
      // Tier-3 destructive tool — upgrade whichever message owns this toolCall id
      this.setState((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map((tc) =>
            tc.id === event.id ? { ...tc, status: 'awaiting_approval' as const } : tc,
          ),
        })),
      }));
    } else if (event.type === 'tool_call_result') {
      // Tool finished — hide the indicator
      this.setState((s) => ({
        messages: s.messages.map((m) => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map((tc) =>
            tc.id === event.id ? { ...tc, status: 'done' as const } : tc,
          ),
        })),
      }));
    } else if (event.type === 'error') {
      this.setState((s) => ({
        streaming: false,
        streamingId: null,
        messages: [
          ...s.messages.filter((m) => m.id !== s.streamingId),
          { id: makeId(), role: 'system' as const, content: `Error: ${event.message}` },
        ],
      }));
    } else if (event.type === 'done') {
      this.setState(
        (s) => ({
          streaming: false,
          streamingId: null,
          messages: s.messages.map((m) =>
            m.id === streamingId ? { ...m, streaming: false } : m,
          ),
        }),
        () => this.persistSession(),
      );
    }
    this.scrollToBottom();
  }

  scrollToBottom() {
    const el = this.logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    this.setState({ input: e.target.value });
  }

  handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  async handleSend() {
    const { input, providerId, model } = this.state;
    if (!input.trim() || this.state.streaming) return;

    const userMsg: UIMessage = { id: makeId(), role: 'user', content: input.trim() };
    const assistantMsg: UIMessage = { id: makeId(), role: 'assistant', content: '', streaming: true };

    // Ensure session exists — generate locally if needed
    let sessionId = this.props.sessionId ?? this.state.activeSessionId;
    if (!sessionId) {
      sessionId = makeId();
      this.setState({ activeSessionId: sessionId });
      this.props.onSessionCreated(sessionId);
      try { track(this.props.electron.ipcRenderer, 'nexus_panel_session_created', {}); } catch (_) {}
    }

    this.setState(
      (s) => ({
        messages: [...s.messages, userMsg, assistantMsg],
        input: '',
        streaming: true,
        streamingId: assistantMsg.id,
      }),
      () => this.scrollToBottom(),
    );

    const siteId = this.props.selectedSiteIds[0];

    // CHAT_SEND positional args: sessionId, message, providerId, model, siteId?
    await this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.CHAT_SEND,
      sessionId,
      input.trim(),
      providerId,
      model,
      siteId,
    );
    try { track(this.props.electron.ipcRenderer, 'nexus_panel_message_sent', { siteCount: this.props.selectedSiteIds.length }); } catch (_) {}
  }

  async persistSession() {
    const { messages, activeSessionId } = this.state;
    const sessionId = activeSessionId ?? this.props.sessionId;
    if (!sessionId) return;

    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser ? truncateAtWord(firstUser.content, 60) : 'New chat';

    const { actionCount, retentionDays } = this.state;
    const session: ChatSession = {
      id: sessionId,
      title,
      scopeLabel: `${this.props.selectedSiteIds.length} site${this.props.selectedSiteIds.length !== 1 ? 's' : ''}`,
      scopeSiteIds: this.props.selectedSiteIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      actionCount,
      expiresAt: retentionDays === null ? null : Date.now() + retentionDays * 86400000,
    };

    const chatMessages: ChatMessage[] = messages
      .filter((m) => m.role !== 'system' && !m.streaming)
      .map((m) => ({
        id: m.id,
        sessionId,
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
      }));

    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_SAVE, {
      session,
      messages: chatMessages,
    });
    this.props.onSessionSaved(session, chatMessages);
  }

  handleStop() {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP, sessionId);
    }
    this.setState({ streaming: false, streamingId: null });
  }

  handleApprove(toolId: string) {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.CHAT_TOOL_APPROVE,
        sessionId,
        toolId,
        true,
      );
    }
  }

  handleCancel(toolId: string) {
    const sessionId = this.state.activeSessionId ?? this.props.sessionId;
    if (sessionId) {
      this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.CHAT_TOOL_APPROVE,
        sessionId,
        toolId,
        false,
      );
    }
    this.setState((s) => ({
      messages: [
        ...s.messages,
        { id: makeId(), role: 'system' as const, content: 'Action dismissed.' },
      ],
    }));
  }

  renderMessage(msg: UIMessage) {
    if (msg.role === 'system') {
      return React.createElement('div', { key: msg.id, style: styles.systemLine }, msg.content);
    }

    const bubbleStyle = msg.role === 'user' ? styles.userBubble : styles.assistantBubble;

    const toolCards = (msg.toolCalls ?? [])
      .filter((tc) => tc.status === 'running' || tc.status === 'awaiting_approval')
      .map((tc) => {
        if (tc.status === 'running') {
          return React.createElement(
            'div',
            {
              key: tc.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 0', color: '#868d98', fontSize: 12,
              },
            },
            React.createElement('span', { style: { color: '#5fd2e5', fontSize: 13 } }, '⚡'),
            React.createElement('span', null, tc.name),
            React.createElement('span', { style: { opacity: 0.5 } }, '…'),
          );
        }
        return React.createElement(ActionCard, {
          key: tc.id,
          title: toolDisplayName(tc.name),
          effect: toolEffect(tc.name),
          destructive: tc.name in TOOL_EFFECTS,
          onConfirm: () => {
            this.handleApprove(tc.id);
            try { track(this.props.electron.ipcRenderer, 'nexus_panel_action_confirmed', { destructive: false }); } catch (_) {}
            this.inputRef.current?.focus();
          },
          onCancel: () => { this.handleCancel(tc.id); this.inputRef.current?.focus(); },
        });
      });

    const bubbleContent = msg.content
      ? msg.content
      : msg.streaming
      ? React.createElement('span', { style: { color: '#868d98', letterSpacing: '0.15em', opacity: 0.7 } }, '· · ·')
      : '';

    return React.createElement(
      'div',
      { key: msg.id },
      React.createElement('div', { style: bubbleStyle }, bubbleContent),
      ...toolCards,
    );
  }

  render() {
    const { messages, input, streaming, offline, providerId, model } = this.state;

    const providerName = providerLabel(providerId);
    const modelName = model;

    return React.createElement(
      'div',
      { style: styles.root },
      React.createElement(
        'div',
        { ref: this.logRef, style: styles.log, 'aria-live': 'polite' },
        messages.length === 0
          ? React.createElement(
              'div',
              { style: { padding: '24px 14px', color: '#868d98', textAlign: 'center' as const, fontSize: 13 } },
              React.createElement('div', { style: { color: '#29b6cf', fontSize: 18, marginBottom: 8 } }, 'Nexus'),
              React.createElement('div', null, 'Ask anything about your WordPress sites.'),
            )
          : null,
        messages.map((m) => this.renderMessage(m)),
      ),
      offline
        ? React.createElement(
            'div',
            {
              style: {
                padding: 12,
                color: '#e0a94b',
                textAlign: 'center' as const,
                fontSize: 12,
                background: '#1a1e24',
                borderTop: '1px solid #2c313a',
              },
            },
            'No network connection — history is still available.',
          )
        : React.createElement(
            'div',
            { style: styles.inputRow },
            React.createElement('textarea', {
              ref: this.inputRef,
              style: styles.textarea,
              value: input,
              onChange: this.handleInput,
              onKeyDown: this.handleKeyDown,
              placeholder: 'Ask anything about your sites…',
              disabled: streaming,
              rows: 1,
              'aria-label': 'Chat input',
            }),
            React.createElement(
              'button',
              {
                style: styles.sendBtn(streaming || !input.trim()),
                disabled: streaming || !input.trim(),
                onClick: streaming ? this.handleStop : this.handleSend,
                'aria-label': streaming ? 'Stop generation' : 'Send message',
              },
              streaming ? '■' : '↑',
            ),
          ),
      React.createElement(
        'div',
        { style: { padding: '3px 14px 6px', color: '#868d98', fontSize: 10, display: 'flex', gap: 6, flexShrink: 0 } },
        React.createElement('span', null, `${providerName} · ${modelName}`),
        React.createElement('span', null, '· Confirm required for destructive actions'),
      ),
    );
  }
}
