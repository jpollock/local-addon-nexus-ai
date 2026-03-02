/**
 * Chat Tab — AI chat interface with streaming responses and inline tool execution.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS, CHAT_DEFAULTS } from '../../common/constants';
import type { ChatStreamEvent } from '../../common/chat-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatTabProps {
  electron: any;
}

interface UIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error' | 'awaiting_approval' | 'denied';
  result?: string;
  warning?: string;
  expanded?: boolean;
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: UIToolCall[];
  isStreaming?: boolean;
  timestamp: number;
}

interface ChatTabState {
  messages: UIMessage[];
  inputValue: string;
  isGenerating: boolean;
  sessionId: string;
  providerId: string;
  model: string;
  error: string | null;
  providerReady: boolean;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const messageListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const inputBarStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '12px 0 0',
  borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-end',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  fontSize: '14px',
  borderRadius: '8px',
  border: '1px solid var(--nxai-input-border, #d1d5db)',
  backgroundColor: 'var(--nxai-input-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  outline: 'none',
  resize: 'none',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  minHeight: '40px',
  maxHeight: '120px',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  color: 'var(--nxai-card-text, #111827)',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  backgroundColor: UI_COLORS.WPE_BRAND,
  color: '#fff',
  border: 'none',
};

const btnDangerStyle: React.CSSProperties = {
  ...btnStyle,
  backgroundColor: '#ef4444',
  color: '#fff',
  border: 'none',
};

const messageBubbleBase: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxWidth: '100%',
  userSelect: 'text',
  cursor: 'text',
};

const userBubbleStyle: React.CSSProperties = {
  ...messageBubbleBase,
  backgroundColor: 'rgba(14, 202, 212, 0.08)',
  border: `1px solid rgba(14, 202, 212, 0.2)`,
};

const assistantBubbleStyle: React.CSSProperties = {
  ...messageBubbleBase,
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
};

const toolCardStyle: React.CSSProperties = {
  margin: '8px 0',
  padding: '10px 14px',
  borderRadius: '8px',
  backgroundColor: 'var(--nxai-code-bg, #f3f4f6)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
};

const toolHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  cursor: 'pointer',
};

const toolDetailStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '8px',
  borderRadius: '6px',
  backgroundColor: 'var(--nxai-input-bg, #fff)',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '12px',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: '200px',
  overflowY: 'auto',
  userSelect: 'text',
  cursor: 'text',
};

const approvalCardStyle: React.CSSProperties = {
  margin: '8px 0',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: 'rgba(245, 158, 11, 0.08)',
  border: `1px solid ${UI_COLORS.STATUS_WARNING}`,
};

const configErrorStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '14px',
  textAlign: 'center',
  padding: '40px',
  userSelect: 'text',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ChatTab extends React.Component<ChatTabProps, ChatTabState> {
  private mounted = false;
  private messageListRef: HTMLDivElement | null = null;
  private streamListener: ((...args: any[]) => void) | null = null;

  state: ChatTabState = {
    messages: [],
    inputValue: '',
    isGenerating: false,
    sessionId: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerId: CHAT_DEFAULTS.DEFAULT_PROVIDER,
    model: '',
    error: null,
    providerReady: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.loadSettings();
    this.subscribeToStream();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.unsubscribeFromStream();
    // Stop any in-progress generation
    if (this.state.isGenerating) {
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP, this.state.sessionId);
    }
  }

  componentDidUpdate(_prevProps: ChatTabProps, prevState: ChatTabState): void {
    // Auto-scroll when new content arrives
    if (this.state.messages !== prevState.messages || this.state.isGenerating !== prevState.isGenerating) {
      this.scrollToBottom();
    }
  }

  loadSettings = async (): Promise<void> => {
    try {
      const settings = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
      if (!this.mounted) return;

      const providerId = settings?.chatProvider || CHAT_DEFAULTS.DEFAULT_PROVIDER;
      const model = settings?.chatModel || '';

      this.setState({ providerId, model }, () => {
        this.checkProviderReady();
      });
    } catch {
      // Use defaults
      this.checkProviderReady();
    }
  };

  checkProviderReady = async (): Promise<void> => {
    const { providerId, model } = this.state;

    if (!providerId) {
      this.setState({ providerReady: false, error: 'No AI provider selected. Configure one in Preferences.' });
      return;
    }

    // If no model specified, try to get default
    if (!model) {
      try {
        const models = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_MODELS, providerId);
        if (!this.mounted) return;
        if (models && models.length > 0) {
          this.setState({ model: models[0], providerReady: true, error: null });
          return;
        }
      } catch {
        // Fall through
      }

      if (providerId === 'ollama') {
        this.setState({
          providerReady: false,
          error: 'No Ollama models found. Start Ollama and pull a model: ollama pull llama3.2',
        });
      } else {
        this.setState({
          providerReady: false,
          error: 'No model selected. Configure one in Preferences.',
        });
      }
      return;
    }

    this.setState({ providerReady: true, error: null });
  };

  subscribeToStream(): void {
    this.streamListener = (_event: any, sessionId: string, event: ChatStreamEvent) => {
      if (!this.mounted || sessionId !== this.state.sessionId) return;
      this.handleStreamEvent(event);
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, this.streamListener);
  }

  unsubscribeFromStream(): void {
    if (this.streamListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, this.streamListener);
      this.streamListener = null;
    }
  }

  handleStreamEvent = (event: ChatStreamEvent): void => {
    switch (event.type) {
      case 'token':
        this.setState((prev) => {
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            messages[messages.length - 1] = { ...last, content: last.content + event.text };
          } else {
            messages.push({
              id: `msg_${Date.now()}`,
              role: 'assistant',
              content: event.text,
              isStreaming: true,
              timestamp: Date.now(),
              toolCalls: [],
            });
          }
          return { messages };
        });
        break;

      case 'tool_call_start':
      case 'tool_call_end':
        this.setState((prev) => {
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            const toolCalls = [...(last.toolCalls ?? [])];
            if (event.type === 'tool_call_start') {
              toolCalls.push({
                id: event.id,
                name: event.name,
                arguments: {},
                status: 'executing',
              });
            } else {
              const idx = toolCalls.findIndex((tc) => tc.id === event.id);
              if (idx >= 0) {
                toolCalls[idx] = { ...toolCalls[idx], arguments: event.arguments };
              } else {
                toolCalls.push({
                  id: event.id,
                  name: event.name,
                  arguments: event.arguments,
                  status: 'executing',
                });
              }
            }
            messages[messages.length - 1] = { ...last, toolCalls };
          }
          return { messages };
        });
        break;

      case 'tool_call_executing':
        this.updateToolCallStatus(event.id, 'executing');
        break;

      case 'tool_call_result':
        this.updateToolCallInMessages(event.id, {
          status: event.isError ? 'error' : 'completed',
          result: event.result,
        });
        break;

      case 'tool_call_approval_needed':
        this.updateToolCallInMessages(event.id, {
          status: 'awaiting_approval',
          warning: event.warning,
          arguments: event.arguments,
        });
        break;

      case 'done':
        this.setState((prev) => {
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            messages[messages.length - 1] = { ...last, isStreaming: false };
          }
          return { messages, isGenerating: false };
        });
        break;

      case 'error':
        this.setState((prev) => {
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            messages[messages.length - 1] = {
              ...last,
              content: last.content + `\n\n_Error: ${event.message}_`,
              isStreaming: false,
            };
          } else {
            messages.push({
              id: `msg_${Date.now()}`,
              role: 'assistant',
              content: `_Error: ${event.message}_`,
              isStreaming: false,
              timestamp: Date.now(),
            });
          }
          return { messages };
        });
        break;
    }
  };

  updateToolCallStatus(toolCallId: string, status: UIToolCall['status']): void {
    this.updateToolCallInMessages(toolCallId, { status });
  }

  updateToolCallInMessages(toolCallId: string, updates: Partial<UIToolCall>): void {
    this.setState((prev) => {
      const messages = [...prev.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.toolCalls) {
          const idx = msg.toolCalls.findIndex((tc) => tc.id === toolCallId);
          if (idx >= 0) {
            const toolCalls = [...msg.toolCalls];
            toolCalls[idx] = { ...toolCalls[idx], ...updates };
            messages[i] = { ...msg, toolCalls };
            break;
          }
        }
      }
      return { messages };
    });
  }

  scrollToBottom(): void {
    if (this.messageListRef) {
      this.messageListRef.scrollTop = this.messageListRef.scrollHeight;
    }
  }

  handleSend = (): void => {
    const { inputValue, isGenerating, providerReady, providerId, model, sessionId } = this.state;
    const trimmed = inputValue.trim();

    if (!trimmed || isGenerating || !providerReady) return;

    // Add user message to UI
    const userMsg: UIMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    this.setState(
      { messages: [...this.state.messages, userMsg], inputValue: '', isGenerating: true },
      () => {
        this.props.electron.ipcRenderer.invoke(
          IPC_CHANNELS.CHAT_SEND,
          sessionId,
          trimmed,
          providerId,
          model,
        );
      },
    );
  };

  handleStop = (): void => {
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP, this.state.sessionId);
    this.setState({ isGenerating: false });
  };

  handleClear = (): void => {
    this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_CLEAR, this.state.sessionId);
    const newSessionId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.setState({
      messages: [],
      sessionId: newSessionId,
      isGenerating: false,
    });
  };

  handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
    if (e.key === 'Escape') {
      this.handleStop();
    }
  };

  handleApproval = (toolCallId: string, approved: boolean): void => {
    const { sessionId } = this.state;
    this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.CHAT_TOOL_APPROVE,
      sessionId,
      toolCallId,
      approved,
    );

    if (!approved) {
      this.updateToolCallInMessages(toolCallId, { status: 'denied' });
    }
  };

  toggleToolExpand = (toolCallId: string): void => {
    this.setState((prev) => {
      const messages = [...prev.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.toolCalls) {
          const idx = msg.toolCalls.findIndex((tc) => tc.id === toolCallId);
          if (idx >= 0) {
            const toolCalls = [...msg.toolCalls];
            toolCalls[idx] = { ...toolCalls[idx], expanded: !toolCalls[idx].expanded };
            messages[i] = { ...msg, toolCalls };
            break;
          }
        }
      }
      return { messages };
    });
  };

  // -----------------------------------------------------------------------
  // Renders
  // -----------------------------------------------------------------------

  renderToolCall(tc: UIToolCall): React.ReactNode {
    if (tc.status === 'awaiting_approval') {
      return this.renderApprovalCard(tc);
    }

    const statusIcon = tc.status === 'completed' ? '\u2713'
      : tc.status === 'error' ? '\u2717'
      : tc.status === 'denied' ? '\u2718'
      : '\u2026';
    const statusColor = tc.status === 'completed' ? UI_COLORS.STATUS_RUNNING
      : tc.status === 'error' ? UI_COLORS.STATUS_ERROR
      : tc.status === 'denied' ? UI_COLORS.STATUS_ERROR
      : UI_COLORS.WPE_BRAND;

    return React.createElement('div', { key: tc.id, style: toolCardStyle },
      React.createElement('div', {
        style: toolHeaderStyle,
        onClick: () => this.toggleToolExpand(tc.id),
      },
        React.createElement('span', {
          style: { color: statusColor, fontWeight: 600, fontSize: '14px' },
        }, statusIcon),
        React.createElement('span', {
          style: { fontWeight: 500, color: 'var(--nxai-card-text)' },
        }, tc.name),
        React.createElement('span', {
          style: {
            fontSize: '11px',
            color: 'var(--nxai-card-sub)',
            marginLeft: 'auto',
          },
        }, tc.expanded ? '\u25B2' : '\u25BC'),
      ),

      tc.expanded ? React.createElement(React.Fragment, null,
        Object.keys(tc.arguments).length > 0
          ? React.createElement('div', { style: toolDetailStyle },
              React.createElement('div', {
                style: { fontWeight: 600, marginBottom: '4px', color: 'var(--nxai-card-sub)' },
              }, 'Arguments:'),
              JSON.stringify(tc.arguments, null, 2),
            )
          : null,
        tc.result
          ? React.createElement('div', { style: toolDetailStyle },
              React.createElement('div', {
                style: { fontWeight: 600, marginBottom: '4px', color: 'var(--nxai-card-sub)' },
              }, 'Result:'),
              tc.result.length > 2000 ? tc.result.slice(0, 2000) + '\n...(truncated)' : tc.result,
            )
          : null,
      ) : null,
    );
  }

  renderApprovalCard(tc: UIToolCall): React.ReactNode {
    return React.createElement('div', { key: tc.id, style: approvalCardStyle },
      React.createElement('div', {
        style: { fontWeight: 600, marginBottom: '6px', color: 'var(--nxai-card-text)' },
      }, `Approval required: ${tc.name}`),
      React.createElement('div', {
        style: { fontSize: '13px', color: 'var(--nxai-card-sub)', marginBottom: '8px' },
      }, tc.warning || 'This action requires your approval.'),
      Object.keys(tc.arguments).length > 0
        ? React.createElement('div', {
            style: { ...toolDetailStyle, marginBottom: '10px' },
          }, JSON.stringify(tc.arguments, null, 2))
        : null,
      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
        React.createElement('button', {
          style: btnPrimaryStyle,
          onClick: () => this.handleApproval(tc.id, true),
        }, 'Approve'),
        React.createElement('button', {
          style: btnDangerStyle,
          onClick: () => this.handleApproval(tc.id, false),
        }, 'Deny'),
      ),
    );
  }

  renderMessage(msg: UIMessage): React.ReactNode {
    const isUser = msg.role === 'user';
    const bubbleStyle = isUser ? userBubbleStyle : assistantBubbleStyle;

    return React.createElement('div', {
      key: msg.id,
      style: { display: 'flex', flexDirection: 'column' },
    },
      React.createElement('div', {
        style: {
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--nxai-card-sub)',
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        },
      }, isUser ? 'You' : 'Nexus AI'),

      React.createElement('div', { style: bubbleStyle },
        msg.content,
        msg.isStreaming
          ? React.createElement('span', {
              style: {
                display: 'inline-block',
                width: '6px',
                height: '14px',
                backgroundColor: UI_COLORS.WPE_BRAND,
                marginLeft: '2px',
                animation: 'nxai-blink 1s step-end infinite',
                verticalAlign: 'text-bottom',
              },
            })
          : null,
      ),

      // Tool calls
      msg.toolCalls?.map((tc) => this.renderToolCall(tc)) ?? null,
    );
  }

  renderInput(): React.ReactNode {
    const { inputValue, isGenerating, providerReady } = this.state;

    return React.createElement('div', { style: inputBarStyle },
      React.createElement('textarea', {
        value: inputValue,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => this.setState({ inputValue: e.target.value }),
        onKeyDown: this.handleKeyDown,
        placeholder: providerReady ? 'Ask about your WordPress sites...' : 'Configure a provider in Preferences',
        disabled: !providerReady,
        rows: 1,
        style: {
          ...inputStyle,
          opacity: providerReady ? 1 : 0.5,
        },
      }),

      isGenerating
        ? React.createElement('button', {
            style: { ...btnStyle, color: UI_COLORS.STATUS_ERROR },
            onClick: this.handleStop,
          }, 'Stop')
        : React.createElement('button', {
            style: !inputValue.trim() || !providerReady
              ? { ...btnPrimaryStyle, opacity: 0.5, cursor: 'not-allowed' }
              : btnPrimaryStyle,
            onClick: this.handleSend,
            disabled: !inputValue.trim() || !providerReady,
          }, 'Send'),

      this.state.messages.length > 0
        ? React.createElement('button', {
            style: btnStyle,
            onClick: this.handleClear,
          }, 'Clear')
        : null,
    );
  }

  renderConfigError(): React.ReactNode {
    return React.createElement('div', { style: configErrorStyle },
      React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, color: 'var(--nxai-card-text)' } },
        'AI Chat',
      ),
      React.createElement('div', null, this.state.error),
      React.createElement('div', {
        style: { fontSize: '13px', marginTop: '8px' },
      }, 'Go to Preferences \u2192 Nexus AI to set up a provider.'),
    );
  }

  renderEmptyState(): React.ReactNode {
    return React.createElement('div', { style: configErrorStyle },
      React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, color: 'var(--nxai-card-text)' } },
        'Nexus AI Chat',
      ),
      React.createElement('div', null,
        'Ask questions about your WordPress sites, manage plugins, run diagnostics, and more.',
      ),
      React.createElement('div', {
        style: { fontSize: '13px', color: 'var(--nxai-card-sub)', marginTop: '4px' },
      }, `Provider: ${this.state.providerId} \u2022 Model: ${this.state.model || 'auto'}`),
    );
  }

  render(): React.ReactNode {
    const { messages, providerReady, error } = this.state;

    // Inject blinking cursor animation
    this.injectCursorAnimation();

    return React.createElement('div', { style: containerStyle },
      !providerReady && error
        ? this.renderConfigError()
        : React.createElement(React.Fragment, null,
            React.createElement('div', {
              ref: (el: HTMLDivElement | null) => { this.messageListRef = el; },
              style: messageListStyle,
            },
              messages.length === 0 ? this.renderEmptyState() : null,
              messages.map((msg) => this.renderMessage(msg)),
            ),
            this.renderInput(),
          ),
    );
  }

  private injectCursorAnimation(): void {
    const id = 'nexus-ai-chat-cursor-animation';
    if (typeof document !== 'undefined' && !document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = `
        @keyframes nxai-blink {
          50% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }
}
