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
    maxWidth: '80%',
    wordBreak: 'break-word' as const,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: '#2c313a',
    color: '#e4e7ec',
    borderRadius: '2px 12px 12px 12px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: '90%',
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
  thinkingDots: {
    color: '#868d98',
    fontSize: 18,
    letterSpacing: 3,
    alignSelf: 'flex-start',
    padding: '4px 14px',
  },
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
    this.actionListener = (_event: any, sessionId: string, data: { sessionId: string; actionCount: number }) => {
      if (sessionId !== this.state.activeSessionId) return;
      // Keep local actionCount in sync so persistSession writes the correct value.
      this.setState((s) => ({ actionCount: s.actionCount + 1 }));
      // Trigger sidebar badge refresh — onSessionSaved with empty args is the signal
      this.props.onSessionSaved({} as any, []);
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
    if (prevProps.sessionId !== this.props.sessionId && this.props.sessionId) {
      this.setState({ activeSessionId: this.props.sessionId });
      this.loadSession(this.props.sessionId);
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
      this.setState((s) => {
        const msgs = s.messages.map((m) => {
          if (m.id !== streamingId) return m;
          const toolCalls = [
            ...(m.toolCalls ?? []),
            {
              id: event.id,
              name: event.name,
              args: '',
              status: 'awaiting_approval' as const,
            },
          ];
          return { ...m, toolCalls };
        });
        return { messages: msgs };
      });
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

    this.props.onSessionSaved(session, chatMessages);
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_SAVE, {
      session,
      messages: chatMessages,
    });
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
      .filter((tc) => tc.status === 'awaiting_approval')
      .map((tc) =>
        React.createElement(ActionCard, {
          key: tc.id,
          title: tc.name,
          effect: `Tool: ${tc.name}`,
          destructive: false,
          onConfirm: () => {
            this.handleApprove(tc.id);
            try { track(this.props.electron.ipcRenderer, 'nexus_panel_action_confirmed', { destructive: false }); } catch (_) {}
            this.inputRef.current?.focus();
          },
          onCancel: () => { this.handleCancel(tc.id); this.inputRef.current?.focus(); },
        }),
      );

    return React.createElement(
      'div',
      { key: msg.id },
      React.createElement('div', { style: bubbleStyle }, msg.content || (msg.streaming ? '…' : '')),
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
        streaming && !messages.some((m) => m.streaming && m.content)
          ? React.createElement('div', { style: styles.thinkingDots }, '···')
          : null,
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
        React.createElement('span', null, '· Confirm required for actions'),
      ),
    );
  }
}
