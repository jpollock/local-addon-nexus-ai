import type { ChatMessage, ChatStreamEvent, ToolCallRequest } from '../../common/chat-types';
import { CHAT_DEFAULTS, IPC_CHANNELS } from '../../common/constants';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import { getToolSafety } from '../mcp/safety';
import { resolveSite } from '../mcp/site-resolver';
import type { SiteStructure } from '../../common/types';
import { getProvider } from './providers/index';
import type { ChatProviderConfig } from './providers/types';
import { adaptToolsForChat } from './tool-adapter';

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

interface ChatSession {
  id: string;
  messages: ChatMessage[];
  abortController: AbortController;
  pendingApprovals: Map<string, {
    resolve: (approved: boolean) => void;
    toolName: string;
    args: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Chat Service
// ---------------------------------------------------------------------------

export interface ChatServiceDeps {
  registry: ToolRegistry;
  services: NexusServices;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export class ChatService {
  private sessions = new Map<string, ChatSession>();
  private readonly registry: ToolRegistry;
  private readonly services: NexusServices;
  private readonly sendToRenderer: (channel: string, ...args: unknown[]) => void;

  constructor(deps: ChatServiceDeps) {
    this.registry = deps.registry;
    this.services = deps.services;
    this.sendToRenderer = deps.sendToRenderer;
  }

  /**
   * Entry point from IPC. Starts or continues a chat session.
   */
  async sendMessage(
    sessionId: string,
    userMessage: string,
    providerConfig: { providerId: string; model: string; apiKey?: string },
    siteId?: string,
  ): Promise<void> {
    const provider = getProvider(providerConfig.providerId);
    if (!provider) {
      this.emit(sessionId, { type: 'error', message: `Unknown provider: ${providerConfig.providerId}` });
      return;
    }

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        abortController: new AbortController(),
        pendingApprovals: new Map(),
      };

      // Build system prompt
      const systemPrompt = await this.buildSystemPrompt(siteId);
      session.messages.push({ role: 'system', content: systemPrompt });
      this.sessions.set(sessionId, session);
    } else {
      // Reset abort controller for new turn
      session.abortController = new AbortController();
    }

    // Add user message
    session.messages.push({ role: 'user', content: userMessage });

    const config: ChatProviderConfig = {
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
    };

    await this.runAgentLoop(session, providerConfig.providerId, config);
  }

  /**
   * Agent loop: stream → collect tool calls → execute → continue.
   * Max iterations prevent infinite loops.
   */
  private async runAgentLoop(
    session: ChatSession,
    providerId: string,
    config: ChatProviderConfig,
  ): Promise<void> {
    const provider = getProvider(providerId);
    if (!provider) return;

    for (let iteration = 0; iteration < CHAT_DEFAULTS.MAX_AGENT_ITERATIONS; iteration++) {
      if (session.abortController.signal.aborted) break;

      const tools = adaptToolsForChat(this.registry, this.services);

      // Stream the LLM response
      let assistantContent = '';
      const toolCalls: ToolCallRequest[] = [];

      try {
        const stream = provider.streamChat(
          session.messages,
          tools,
          config,
          session.abortController.signal,
        );

        let stopReason: string = 'end_turn';

        for await (const event of stream) {
          if (session.abortController.signal.aborted) break;

          // Forward provider events to renderer
          if (event.type === 'token') {
            assistantContent += event.text;
            this.emit(sessionId(session), event);
          } else if (event.type === 'tool_call_start' || event.type === 'tool_call_args_delta') {
            this.emit(sessionId(session), event);
          } else if (event.type === 'tool_call_end') {
            toolCalls.push({
              id: event.id,
              name: event.name,
              arguments: event.arguments,
            });
            this.emit(sessionId(session), event);
          } else if (event.type === 'done') {
            stopReason = event.stopReason;
          } else if (event.type === 'error') {
            this.emit(sessionId(session), event);
            this.emit(sessionId(session), { type: 'done', stopReason: 'error' });
            return;
          }
        }

        // Record assistant message
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: assistantContent,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        session.messages.push(assistantMsg);

        // If no tool calls, we're done
        if (stopReason !== 'tool_use' || toolCalls.length === 0) {
          this.emit(sessionId(session), { type: 'done', stopReason: stopReason as any });
          return;
        }

        // Execute tool calls and add results to messages
        for (const tc of toolCalls) {
          if (session.abortController.signal.aborted) break;

          const result = await this.executeToolCall(session, tc);

          // Add tool result message
          session.messages.push({
            role: 'tool',
            content: result.text,
            toolCallId: tc.id,
            toolName: tc.name,
          });
        }

        // Continue loop — LLM will see tool results and respond
      } catch (err) {
        if (!session.abortController.signal.aborted) {
          this.emit(sessionId(session), {
            type: 'error',
            message: `Chat error: ${(err as Error).message}`,
          });
        }
        this.emit(sessionId(session), { type: 'done', stopReason: 'error' });
        return;
      }
    }

    // Max iterations reached
    this.emit(sessionId(session), {
      type: 'error',
      message: 'Maximum tool call iterations reached. Stopping.',
    });
    this.emit(sessionId(session), { type: 'done', stopReason: 'end_turn' });
  }

  /**
   * Execute a single tool call with safety-tier awareness.
   */
  private async executeToolCall(
    session: ChatSession,
    toolCall: ToolCallRequest,
  ): Promise<{ text: string; isError?: boolean }> {
    const safety = getToolSafety(toolCall.name);

    // Tier 3: requires UI approval
    if (safety.tier === 3) {
      this.emit(sessionId(session), {
        type: 'tool_call_approval_needed',
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        warning: safety.confirmationMessage ?? 'This action may have significant consequences.',
      });

      const approved = await this.waitForApproval(session, toolCall.id, toolCall.name, toolCall.arguments);

      if (!approved) {
        const denialText = `Tool "${toolCall.name}" was denied by user.`;
        this.emit(sessionId(session), {
          type: 'tool_call_result',
          id: toolCall.id,
          name: toolCall.name,
          result: denialText,
          isError: false,
        });
        return { text: denialText };
      }

      // User approved - execute directly via registry (no confirmation token needed)
      // ChatService handles safety at the UI layer, registry is now a dumb router
      this.emit(sessionId(session), {
        type: 'tool_call_executing',
        id: toolCall.id,
        name: toolCall.name,
      });

      const result = await this.registry.call(toolCall.name, toolCall.arguments, this.services);
      const text = result.content.map((c) => c.text).join('\n');

      this.emit(sessionId(session), {
        type: 'tool_call_result',
        id: toolCall.id,
        name: toolCall.name,
        result: text,
        isError: result.isError,
      });

      return { text, isError: result.isError };
    }

    // Tier 1 & 2: execute directly
    this.emit(sessionId(session), {
      type: 'tool_call_executing',
      id: toolCall.id,
      name: toolCall.name,
    });

    const result = await this.registry.call(toolCall.name, toolCall.arguments, this.services);
    const text = result.content.map((c) => c.text).join('\n');

    this.emit(sessionId(session), {
      type: 'tool_call_result',
      id: toolCall.id,
      name: toolCall.name,
      result: text,
      isError: result.isError,
    });

    return { text, isError: result.isError };
  }

  /**
   * Wait for user approval of a tier 3 tool call.
   */
  private waitForApproval(
    session: ChatSession,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      session.pendingApprovals.set(toolCallId, { resolve, toolName, args });
    });
  }

  /**
   * Resolve a pending tier 3 approval (called from IPC handler).
   */
  resolveApproval(sessionId: string, toolCallId: string, approved: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pending = session.pendingApprovals.get(toolCallId);
    if (pending) {
      pending.resolve(approved);
      session.pendingApprovals.delete(toolCallId);
    }
  }

  /**
   * Stop generation for a session.
   */
  stopGeneration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      // Reject all pending approvals
      for (const [, pending] of session.pendingApprovals) {
        pending.resolve(false);
      }
      session.pendingApprovals.clear();
    }
  }

  /**
   * Clear a session's conversation history.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Build the system prompt with optional site context.
   */
  private async buildSystemPrompt(siteId?: string): Promise<string> {
    const lines = [
      'You are Nexus AI, a WordPress site management assistant built into the Local development environment.',
      'You have access to tools for managing WordPress sites, checking plugin status, running WP-CLI commands, and more.',
      'Be concise and helpful. When using tools, explain what you are doing.',
      '',
      'IMPORTANT: Always use your tools to get real data. Never fabricate or guess site names, plugin lists, version numbers, or other information.',
      'If asked about sites, call local_list_sites first. If asked about plugins, call wp_plugin_list with the site name.',
      'If asked about WordPress versions, call wp_core_version. If you cannot answer using your available tools, say so.',
      '',
      'Fleet management tools:',
      '- fleet_health_summary: Get health scores for all indexed sites',
      '- get_site_health: Get detailed health breakdown for a specific site',
      '- fleet_search: Search across all indexed site content',
      '- fleet_filter: Apply smart filters (e.g., outdated-php, no-ssl) across the fleet',
      '- bulk_reindex: Reindex multiple sites at once (pass an array of site_ids)',
      '- bulk_plugin_update: Update a plugin across multiple sites',
      '- list_site_groups: List all site groups',
      '- manage_site_group: Create, rename, delete groups or move sites between groups',
      '',
      'When asked to reindex sites, use the bulk_reindex tool with site IDs from local_list_sites.',
      'Never suggest manual WP-CLI commands when a tool exists for the task.',
    ];

    if (siteId) {
      const site = resolveSite(siteId, this.services.siteData);
      if (site) {
        let structure: SiteStructure | null = null;
        const indexEntry = this.services.indexRegistry.get(site.id);
        if (indexEntry?.structure) {
          structure = indexEntry.structure;
        } else {
          try {
            structure = await this.services.fileScanner.scan(site.path);
          } catch {
            // Site may not be running
          }
        }

        lines.push('');
        lines.push(`Current site: ${site.name}${site.domain ? ` (${site.domain})` : ''}`);

        if (structure) {
          const activeTheme = structure.themes.find((t) => t.isActive);
          const activePlugins = structure.plugins.filter((p) => p.isActive);
          lines.push(`WordPress: ${structure.wpVersion} | PHP: ${structure.phpVersion}`);
          lines.push(`Active theme: ${activeTheme?.name ?? 'unknown'}`);
          lines.push(`Active plugins: ${activePlugins.map((p) => p.name).join(', ') || 'none'}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Emit a stream event to the renderer for a specific session.
   */
  private emit(sessionId: string, event: ChatStreamEvent): void {
    this.sendToRenderer(IPC_CHANNELS.CHAT_STREAM, sessionId, event);
  }
}

function sessionId(session: ChatSession): string {
  return session.id;
}
