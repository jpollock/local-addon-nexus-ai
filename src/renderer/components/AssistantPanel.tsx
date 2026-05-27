/**
 * AssistantPanel — Shared AI assistant conversation UI.
 *
 * Used in three surfaces:
 *   1. SidebarSearchPanel (fleet, panel width)
 *   2. NexusOverview Ask tab (fleet, full width)
 *   3. NexusSiteTab (site, split-view right column)
 *
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import { renderMarkdown } from '../utils/markdown';
import type { QueryPlan, AssistantContext, FleetInsight } from '../../common/types';

// Allowlist of IPC channels the assistant is permitted to invoke via action buttons.
// Prevents LLM-controlled arbitrary IPC invocation (prompt injection risk).
const ALLOWED_ASSISTANT_IPC = new Set<string>([
  IPC_CHANNELS.INDEX_SITE,
  IPC_CHANNELS.INDEX_ALL_AUTO,
  IPC_CHANNELS.SIDEBAR_FILTER,
  IPC_CHANNELS.START_SITE,
  IPC_CHANNELS.STOP_SITE,
  IPC_CHANNELS.REFRESH_SITE_METADATA,
  IPC_CHANNELS.WPE_SYNC_ALL,
  IPC_CHANNELS.NAVIGATE_TO_PREFERENCES,
]);

export interface AssistantPanelProps {
  electron: any;
  mode: 'fleet' | 'site';
  siteId?: string;
  siteName?: string;
  layout?: 'panel' | 'full';
  suggestions?: string[];
  onSiteFilter?: (siteNames: string[]) => void;
}

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: QueryPlan;
  isTyping?: boolean;
}

interface AssistantPanelState {
  messages: AssistantMessage[];
  input: string;
  context: AssistantContext | null;
  sending: boolean;
  contextExpanded: boolean;
}

export class AssistantPanel extends React.Component<AssistantPanelProps, AssistantPanelState> {
  private mounted = false;
  private msgListRef: HTMLDivElement | null = null;

  state: AssistantPanelState = {
    messages: [],
    input: '',
    context: null,
    sending: false,
    contextExpanded: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadContext();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadContext(): Promise<void> {
    const ctx: AssistantContext | null = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.ASSISTANT_CONTEXT, { mode: this.props.mode, siteId: this.props.siteId })
      .catch(() => null);
    if (this.mounted) this.setState({ context: ctx });
  }

  /** Build a compact site twin block to inject as context into the first message. */
  buildContextBlock(): string {
    const ctx = this.state.context;
    if (!ctx || ctx.mode !== 'site') return '';
    const lines: string[] = [`[SITE CONTEXT for ${ctx.siteName}]`];
    if (ctx.wpVersion) lines.push(`WordPress: ${ctx.wpVersion}`);
    if (ctx.phpVersion) lines.push(`PHP: ${ctx.phpVersion}`);
    if (ctx.activePlugins && ctx.activePlugins.length > 0) {
      lines.push(`Active plugins (${ctx.pluginCount}): ${ctx.activePlugins.join(', ')}`);
    } else if (ctx.installedPluginCount != null && ctx.scanDepth === 'filesystem') {
      lines.push(`Installed plugins: ${ctx.installedPluginCount} (site halted, active status unknown)`);
    } else {
      lines.push(`Active plugins: ${ctx.pluginCount ?? 0}`);
    }
    if (ctx.activeTheme) lines.push(`Theme: ${ctx.activeTheme}`);
    if (ctx.postCount != null) lines.push(`Posts: ${ctx.postCount}`);
    if (ctx.userCount != null) lines.push(`Users: ${ctx.userCount}`);
    if (ctx.indexState === 'indexed') lines.push(`Content indexed: ${ctx.documentCount ?? 0} docs`);
    if (ctx.linkedWpeInstall) lines.push(`Linked WPE: ${ctx.linkedWpeInstall}`);
    lines.push('[/SITE CONTEXT]');
    return lines.join('\n');
  }

  handleSend = async (textOverride?: string): Promise<void> => {
    const text = (textOverride ?? this.state.input).trim();
    if (!text || this.state.sending) return;

    const userMsg: AssistantMessage = { id: Date.now().toString(), role: 'user', content: text };
    const typingMsg: AssistantMessage = { id: 'typing', role: 'assistant', content: '', isTyping: true };

    // Capture message history BEFORE setState to avoid race with async state flush
    const historySnapshot = this.state.messages
      .filter(m => !m.isTyping)
      .map(m => ({ role: m.role, content: m.content }));

    this.setState(
      prev => ({ messages: [...prev.messages, userMsg, typingMsg], input: '', sending: true }),
      () => this.scrollToBottom(),
    );

    const history = [...historySnapshot, { role: 'user' as const, content: text }];

    const res = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.ASSISTANT_QUERY, { messages: history, mode: this.props.mode, siteId: this.props.siteId })
      .catch(() => ({ success: false, plan: { intent: 'explanation', summary: 'Request failed. Please try again.', needsClarification: false } }));

    if (!this.mounted) return;

    const aiMsg: AssistantMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: res.plan?.summary ?? '',
      plan: res.plan,
    };

    this.setState(
      prev => ({ messages: [...prev.messages.filter(m => m.id !== 'typing'), aiMsg], sending: false }),
      () => this.scrollToBottom(),
    );

    if (res.plan?.intent === 'fleet-filter' && res.plan.sites && this.props.onSiteFilter) {
      this.props.onSiteFilter((res.plan.sites as any[]).map((s: any) => s.name));
    }
  };

  scrollToBottom(): void {
    if (this.msgListRef) this.msgListRef.scrollTop = this.msgListRef.scrollHeight;
  }

  renderInsightCard(insight: FleetInsight): React.ReactNode {
    return React.createElement('div', {
      key: insight.title,
      style: { background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 },
    },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 4 } }, '💡 Insight'),
      React.createElement('div', { style: { fontSize: 12, color: '#fde68a', lineHeight: 1.5, marginBottom: 8 } }, insight.detail),
      insight.ipcChannel && ALLOWED_ASSISTANT_IPC.has(insight.ipcChannel)
        ? React.createElement('button', {
            onClick: () => this.props.electron.ipcRenderer.invoke(insight.ipcChannel!, insight.ipcPayload).catch(() => {}),
            style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'rgba(14,202,212,.15)', color: '#0ECAD4', border: '1px solid rgba(14,202,212,.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
          }, 'Show me')
        : null,
    );
  }

  renderSiteRow(site: NonNullable<QueryPlan['sites']>[0], i: number): React.ReactNode {
    const tagColors: Record<string, string> = { warn: '#f87171', ok: '#51BB7B', info: '#0ECAD4' };
    const tagBgs: Record<string, string> = { warn: 'rgba(239,68,68,.1)', ok: 'rgba(81,187,123,.1)', info: 'rgba(14,202,212,.1)' };
    const dotColor = site.source === 'wpe' ? '#0ECAD4' : '#51BB7B';
    const tagKind = site.tagKind ?? 'info';

    return React.createElement('div', {
      key: `${site.name}-${i}`,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid rgba(42,47,61,.4)', fontSize: 12 },
    },
      React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
      React.createElement('span', { style: { flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, site.name),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', flexShrink: 0 } }, site.meta),
      site.tag ? React.createElement('span', {
        style: { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: tagBgs[tagKind] ?? tagBgs.info, color: tagColors[tagKind] ?? tagColors.info, border: `1px solid ${tagColors[tagKind] ?? tagColors.info}30`, flexShrink: 0 },
      }, site.tag) : null,
    );
  }

  renderContentRow(r: NonNullable<QueryPlan['contentResults']>[0], i: number): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${i}`,
      style: { padding: '8px 12px', borderBottom: '1px solid rgba(42,47,61,.4)' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } },
        React.createElement('span', { style: { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(81,187,123,.08)', color: '#51BB7B', border: '1px solid rgba(81,187,123,.15)' } }, 'content'),
        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, r.siteName),
        React.createElement('span', { style: { fontSize: 10, color: '#555', marginLeft: 'auto' } }, r.score.toFixed(2)),
      ),
      React.createElement('div', { style: { fontSize: 12, fontWeight: 500, marginBottom: 2 } }, r.title),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.4 } }, r.excerpt),
    );
  }

  renderResponseCard(msg: AssistantMessage): React.ReactNode {
    const plan = msg.plan;
    if (!plan) return null;

    const hasSites = plan.sites && plan.sites.length > 0;
    const hasContent = plan.contentResults && plan.contentResults.length > 0;
    const hasBorder = hasSites || hasContent;

    return React.createElement('div', {
      style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' },
    },
      React.createElement('div', {
        style: { padding: '10px 12px', fontSize: 12, lineHeight: 1.6, borderBottom: hasBorder ? '1px solid var(--nxai-card-border, #30363d)' : 'none', userSelect: 'text' as const, cursor: 'text' },
      }, renderMarkdown(plan.summary)),
      hasSites ? plan.sites!.map((s, i) => this.renderSiteRow(s, i)) : null,
      hasContent ? plan.contentResults!.map((r, i) => this.renderContentRow(r, i)) : null,
      plan.needsClarification && plan.clarificationQuestion
        ? React.createElement('div', { style: { padding: '8px 12px', fontSize: 12, color: '#fbbf24', fontStyle: 'italic' } }, plan.clarificationQuestion)
        : null,
      // Only render actions that are in the allowlist. Skip site-dependent actions
      // (those with an ipcChannel) when there are no results to act on.
      (() => {
        if (!plan.actions || plan.actions.length === 0) return null;
        const hasResults = (plan.sites?.length ?? 0) > 0 || (plan.contentResults?.length ?? 0) > 0;
        const visibleActions = plan.actions.filter(a => {
          if (!a.ipcChannel) return true; // label-only actions always show
          if (!ALLOWED_ASSISTANT_IPC.has(a.ipcChannel)) return false; // blocked
          // Site-dependent actions only make sense when there are results
          const isSiteAction = a.ipcChannel === IPC_CHANNELS.SIDEBAR_FILTER ||
            a.ipcChannel === IPC_CHANNELS.INDEX_SITE ||
            a.ipcChannel === IPC_CHANNELS.INDEX_ALL_AUTO;
          return !isSiteAction || hasResults;
        });
        if (visibleActions.length === 0) return null;
        return React.createElement('div', {
          style: { padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' as const, background: 'rgba(255,255,255,.02)' },
        },
          ...visibleActions.map(a =>
            React.createElement('button', {
              key: a.label,
              onClick: a.ipcChannel
                ? () => this.props.electron.ipcRenderer.invoke(a.ipcChannel!, a.ipcPayload).catch(() => {})
                : undefined,
              style: {
                fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 600, border: 'none',
                background: a.kind === 'primary' ? '#0ECAD4' : 'rgba(107,114,128,.1)',
                color: a.kind === 'primary' ? '#000' : 'var(--nxai-card-sub, #6b7280)',
              },
            }, a.label),
          ),
        );
      })(),
    );
  }

  renderMessage(msg: AssistantMessage): React.ReactNode {
    if (msg.isTyping) {
      return React.createElement('div', {
        key: 'typing',
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' },
      },
        React.createElement('span', { style: { color: '#0ECAD4', fontWeight: 700, fontSize: 11 } }, '✦'),
        React.createElement('span', null, 'thinking…'),
      );
    }

    if (msg.role === 'user') {
      return React.createElement('div', { key: msg.id, style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('div', {
          style: { maxWidth: '85%', background: 'rgba(14,202,212,.1)', border: '1px solid rgba(14,202,212,.2)', borderRadius: '10px 10px 2px 10px', padding: '8px 12px', fontSize: 12, userSelect: 'text' as const, cursor: 'text' },
        }, msg.content),
      );
    }

    return React.createElement('div', { key: msg.id, style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 700, color: '#0ECAD4', display: 'flex', alignItems: 'center', gap: 4 } }, '✦ Nexus AI'),
      msg.plan ? this.renderResponseCard(msg) : React.createElement('div', { style: { fontSize: 12, userSelect: 'text' as const, cursor: 'text' } }, renderMarkdown(msg.content)),
    );
  }

  renderContextCard(): React.ReactNode {
    const ctx = this.state.context;
    if (!ctx || ctx.mode !== 'site') return null;
    const { contextExpanded } = this.state;

    const summary = [
      ctx.wpVersion ? `WP ${ctx.wpVersion}` : null,
      ctx.phpVersion ? `PHP ${ctx.phpVersion}` : null,
      ctx.pluginCount != null ? `${ctx.pluginCount} plugin${ctx.pluginCount !== 1 ? 's' : ''}` : null,
      ctx.indexState === 'indexed' ? `${ctx.documentCount ?? 0} docs` : null,
    ].filter(Boolean).join(' · ');

    return React.createElement('div', {
      style: {
        margin: '8px 12px 0',
        border: '1px solid var(--nxai-card-border, #30363d)',
        borderRadius: 8,
        fontSize: 11,
        overflow: 'hidden',
        flexShrink: 0,
      },
    },
      // Header row (always visible)
      React.createElement('div', {
        onClick: () => this.setState(p => ({ contextExpanded: !p.contextExpanded })),
        style: {
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', cursor: 'pointer',
          background: 'var(--nxai-code-bg, #1f1f1f)',
        },
      },
        React.createElement('span', { style: { color: '#0ECAD4', fontSize: 10 } }, '📋'),
        React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)', flex: 1 } }, summary || 'Site context loaded'),
        React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)', fontSize: 10 } }, contextExpanded ? '▲' : '▼'),
      ),

      // Expanded detail
      contextExpanded
        ? React.createElement('div', {
            style: { padding: '8px 10px', background: 'var(--nxai-card-bg, #21262d)', display: 'flex', flexDirection: 'column' as const, gap: 3 },
          },
            ...[
              ctx.wpVersion && `WordPress: ${ctx.wpVersion}`,
              ctx.phpVersion && `PHP: ${ctx.phpVersion}`,
              ctx.activePlugins && ctx.activePlugins.length > 0
                ? `Active plugins: ${ctx.activePlugins.join(', ')}`
                : ctx.scanDepth === 'filesystem'
                ? `Plugins: ${ctx.installedPluginCount ?? 0} installed (start site to see active)`
                : `Active plugins: ${ctx.pluginCount ?? 0}`,
              ctx.activeTheme && `Theme: ${ctx.activeTheme}`,
              ctx.postCount != null && `Posts: ${ctx.postCount}`,
              ctx.userCount != null && `Users: ${ctx.userCount}`,
              ctx.linkedWpeInstall && `WPE: ${ctx.linkedWpeInstall}`,
              ctx.indexState === 'indexed'
                ? `Indexed: ${ctx.documentCount ?? 0} docs`
                : 'Content: not indexed',
            ].filter(Boolean).map((line, i) =>
              React.createElement('div', {
                key: i,
                style: { color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.5 },
              }, line as string),
            ),
          )
        : null,
    );
  }

  render(): React.ReactNode {
    const { suggestions = [], mode } = this.props;
    const { messages, input, context, sending } = this.state;

    const defaultSuggestions = mode === 'fleet'
      ? ['oldest PHP sites', 'sites with page builders', 'what needs updating?', 'Find recipe content']
      : ['Any issues to fix?', 'Which plugins have updates?', 'Compare with staging', 'Search this site\'s content'];
    const chips = suggestions.length > 0 ? suggestions : defaultSuggestions;
    const placeholder = mode === 'fleet'
      ? 'Ask about your fleet…'
      : `Ask about ${this.props.siteName ?? 'this site'}…`;

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' } },

      // Site context card (site mode only, always visible)
      mode === 'site' ? this.renderContextCard() : null,

      // Suggestion chips (only when no messages yet)
      messages.length === 0
        ? React.createElement('div', {
            style: { padding: '10px 12px', borderBottom: '1px solid var(--nxai-card-border, #30363d)', display: 'flex', flexWrap: 'wrap' as const, gap: 6, flexShrink: 0 },
          },
            ...chips.map(chip =>
              React.createElement('button', {
                key: chip,
                onClick: () => this.handleSend(chip),
                style: { fontSize: 11, padding: '4px 10px', borderRadius: 14, border: '1px solid var(--nxai-card-border, #30363d)', color: 'var(--nxai-card-sub, #6b7280)', cursor: 'pointer', background: 'var(--nxai-card-bg, #21262d)', fontFamily: 'inherit' },
              }, chip),
            ),
          )
        : null,

      // Message list
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column' as const, gap: 12 },
        ref: (el: any) => { this.msgListRef = el; },
      },
        // Proactive insights (first open, fleet mode)
        messages.length === 0 && context?.fleetInsights && context.fleetInsights.length > 0
          ? context.fleetInsights.map(i => this.renderInsightCard(i))
          : null,
        ...messages.map(m => this.renderMessage(m)),
      ),

      // Input bar
      React.createElement('div', { style: { padding: '10px 12px', borderTop: '1px solid var(--nxai-card-border, #30363d)', flexShrink: 0 } },
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          React.createElement('textarea', {
            value: input,
            placeholder,
            rows: 1,
            disabled: sending,
            onChange: (e: any) => this.setState({ input: e.target.value }),
            onKeyDown: (e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); } },
            style: {
              flex: 1, background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)',
              borderRadius: 8, color: 'inherit', padding: '8px 12px', fontSize: 12, outline: 'none',
              fontFamily: 'inherit', resize: 'none' as const, opacity: sending ? 0.5 : 1,
            },
          }),
          React.createElement('button', {
            onClick: () => this.handleSend(),
            disabled: sending || !input.trim(),
            style: {
              width: 32, height: 32, borderRadius: 6, background: '#0ECAD4', color: '#000', border: 'none',
              cursor: sending || !input.trim() ? 'not-allowed' : 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              opacity: sending || !input.trim() ? 0.4 : 1,
            },
          }, '↑'),
        ),
      ),
    );
  }
}
