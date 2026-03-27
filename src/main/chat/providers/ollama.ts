import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import { OLLAMA_BASE_URL } from '../../../common/constants';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

/**
 * Max tools to send to Ollama models. Local models have limited context
 * and can't reliably handle 48 tool definitions. Prioritize by position
 * (modules register most useful tools first).
 */
const MAX_OLLAMA_TOOLS = 20;

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly requiresApiKey = false;
  readonly defaultModels = ['llama3.2', 'llama3.1', 'mistral', 'gemma2'];

  // Cache model capability checks
  private toolCapabilityCache = new Map<string, boolean>();

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || OLLAMA_BASE_URL;

    // Check if this model supports tool calling
    const supportsTools = await this.checkToolSupport(config.model, baseUrl);

    // If model doesn't support native tools, inject tool descriptions into the system prompt
    let messagesForChat = messages;
    if (!supportsTools && tools.length > 0) {
      messagesForChat = this.injectToolDescriptions(messages, tools);
    }

    // Convert messages to Ollama format
    const ollamaMessages = this.convertMessages(messagesForChat, supportsTools);

    // Limit and convert tools
    const limitedTools = supportsTools ? tools.slice(0, MAX_OLLAMA_TOOLS) : [];
    const ollamaTools = limitedTools.length > 0 ? limitedTools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })) : undefined;

    // When tools are provided, use non-streaming mode for reliable tool calling.
    // Ollama's streaming + tools is unreliable — tool_calls often don't appear in chunks.
    if (ollamaTools) {
      yield* this.nonStreamingChat(baseUrl, config.model, ollamaMessages, ollamaTools, signal);
    } else {
      yield* this.streamingChat(baseUrl, config.model, ollamaMessages, signal);
    }
  }

  /**
   * Non-streaming chat — used when tools are available for reliable tool calling.
   * Yields the response text as a single token, then any tool calls.
   */
  private async *nonStreamingChat(
    baseUrl: string,
    model: string,
    messages: any[],
    tools: any[],
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const body = JSON.stringify({
      model,
      messages,
      stream: false,
      tools,
    });

    try {
      const response = await apiRequest({
        url: `${baseUrl}/api/chat`,
        method: 'POST',
        body,
        timeoutMs: 120_000,
      });

      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }

      const data = JSON.parse(response);
      const msg = data.message;

      // Yield text content
      if (msg?.content) {
        yield { type: 'token', text: msg.content };
      }

      // Yield tool calls
      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const callId = `ollama_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const name = tc.function?.name ?? '';
          const args = tc.function?.arguments ?? {};
          yield { type: 'tool_call_start', id: callId, name };
          yield { type: 'tool_call_end', id: callId, name, arguments: args };
        }
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'done', stopReason: 'end_turn' };
      }
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Ollama error: ${(err as Error).message}` };
    }
  }

  /**
   * Streaming chat — used when no tools are involved (pure text generation).
   */
  private async *streamingChat(
    baseUrl: string,
    model: string,
    messages: any[],
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
    });

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/api/chat`,
        body,
        signal,
      });

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        if (data.message?.content) {
          yield { type: 'token', text: data.message.content };
        }

        if (data.done) {
          yield { type: 'done', stopReason: 'end_turn' };
          return;
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Ollama error: ${(err as Error).message}` };
    }
  }

  /**
   * When the model doesn't support native tool calling, append tool descriptions
   * to the system prompt so the model at least knows what's available.
   * The model won't invoke tools programmatically, but it can describe what
   * tools exist and suggest the user run them.
   */
  private injectToolDescriptions(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
  ): ChatMessage[] {
    const toolList = tools.slice(0, MAX_OLLAMA_TOOLS).map((t) =>
      `- ${t.name}: ${t.description}`
    ).join('\n');

    const toolNote = [
      '',
      'NOTE: Your model does not support native tool calling. You have access to these tools but cannot call them directly.',
      'Instead, describe what tool you WOULD call and with what arguments. The user can then run it manually.',
      'Available tools:',
      toolList,
    ].join('\n');

    return messages.map((m, i) => {
      if (i === 0 && m.role === 'system') {
        return { ...m, content: m.content + toolNote };
      }
      return m;
    });
  }

  /**
   * Convert ChatMessage[] to Ollama format.
   */
  private convertMessages(messages: ChatMessage[], supportsTools: boolean): any[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        if (supportsTools) {
          return { role: 'tool' as const, content: m.content };
        }
        return { role: 'user' as const, content: `[Tool result for ${m.toolName ?? 'tool'}]: ${m.content}` };
      }
      if (m.role === 'assistant' && m.toolCalls?.length && supportsTools) {
        return {
          role: 'assistant' as const,
          content: m.content || '',
          tool_calls: m.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || OLLAMA_BASE_URL;
    try {
      const response = await apiRequest({ url: `${baseUrl}/api/tags`, method: 'GET' });
      const data = JSON.parse(response);
      return (data.models ?? []).map((m: any) => m.name as string);
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(_apiKey: string): Promise<string | null> {
    try {
      const baseUrl = OLLAMA_BASE_URL;
      await apiRequest({ url: `${baseUrl}/api/tags`, method: 'GET' });
      return null;
    } catch {
      return 'Ollama is not running. Start it with: ollama serve';
    }
  }

  /**
   * Check if a model supports tool calling by querying Ollama's /api/show endpoint
   * and inspecting the model template for tool support markers.
   */
  private async checkToolSupport(model: string, baseUrl: string): Promise<boolean> {
    if (this.toolCapabilityCache.has(model)) {
      return this.toolCapabilityCache.get(model)!;
    }

    try {
      const response = await apiRequest({
        url: `${baseUrl}/api/show`,
        method: 'POST',
        body: JSON.stringify({ name: model }),
      });
      const data = JSON.parse(response);

      // Ollama models that support tools have {{- if .Tools }} or similar in their template
      const template = (data.template ?? '') as string;
      const hasToolSupport = template.includes('.Tools') || template.includes('.ToolCalls');

      this.toolCapabilityCache.set(model, hasToolSupport);
      return hasToolSupport;
    } catch {
      this.toolCapabilityCache.set(model, false);
      return false;
    }
  }
}
