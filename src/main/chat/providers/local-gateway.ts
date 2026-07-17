import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';

/**
 * Local AI Gateway provider — routes agent AI calls through the Nexus gateway,
 * which handles credential injection. Same trust model as per-site WP AI capabilities.
 *
 * config.baseUrl  = gateway base URL (e.g. http://127.0.0.1:13000)
 * config.apiKey   = gateway auth token (X-Auth-Token header)
 * config.model    = forwarded to the gateway for model selection
 */
export class LocalGatewayProvider implements AIProvider {
  readonly id = 'local-gateway';
  readonly displayName = 'Local AI Gateway';
  readonly requiresApiKey = false;
  readonly defaultModels: string[] = [];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl;
    const authToken = config.apiKey;

    if (!baseUrl || !authToken) {
      yield { type: 'error', message: 'Local AI Gateway: gateway URL or auth token not configured.' };
      return;
    }

    const endpoint = `${baseUrl}/ai-gateway/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: config.model ?? 'default',
      messages: messages.map(m => {
        if (m.role === 'tool') {
          return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? 'unknown' };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: m.content ?? null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }

    if (config.forceTool) {
      body.tool_choice = { type: 'function', function: { name: config.forceTool } };
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: any) {
      yield { type: 'error', message: `Local AI Gateway: request failed — ${err.message}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      yield { type: 'error', message: `Local AI Gateway: HTTP ${response.status} — ${text.slice(0, 200)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', message: 'Local AI Gateway: no response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCallId = '';
    let currentToolName = '';
    let currentToolArgs = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: 'token', text: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                // New tool call starting
                if (currentToolCallId) {
                  try {
                    yield { type: 'tool_call_end', id: currentToolCallId, name: currentToolName, arguments: JSON.parse(currentToolArgs || '{}') };
                  } catch {
                    yield { type: 'tool_call_end', id: currentToolCallId, name: currentToolName, arguments: {} };
                  }
                }
                currentToolCallId = tc.id;
                currentToolName = tc.function?.name ?? '';
                currentToolArgs = tc.function?.arguments ?? '';
              } else if (tc.function?.arguments) {
                currentToolArgs += tc.function.arguments;
              }
            }
          }
        }
      }

      // Flush any pending tool call
      if (currentToolCallId) {
        try {
          yield { type: 'tool_call_end', id: currentToolCallId, name: currentToolName, arguments: JSON.parse(currentToolArgs || '{}') };
        } catch {
          yield { type: 'tool_call_end', id: currentToolCallId, name: currentToolName, arguments: {} };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(_config: ChatProviderConfig): Promise<string[]> {
    return [];
  }

  async validateKey(_apiKey: string): Promise<string | null> {
    return null; // gateway manages its own auth
  }
}
