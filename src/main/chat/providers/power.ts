import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

// WP Engine Power — OpenAI-compatible AI gateway. Layer-2 (Nexus's own
// inference) provider. Auth is a portal `wpe_` Full Access key via
// `Authorization: Bearer`. The `WPEngine-Project` header is intentionally
// NOT sent: probe 2026-07-24 proved inference works without it (the key
// resolves to the account server-side). The key never leaves this process.
// See docs/planning/iw/power-l2-provider-design.md.
const POWER_BASE = 'https://api.ai.wpengine.com/v1';

export class PowerProvider implements AIProvider {
  readonly id = 'power';
  readonly displayName = 'WP Engine Power';
  readonly requiresApiKey = true;
  // Fallback only — the live list comes from listModels() -> GET /v1/models.
  // Power returns `provider/model` ids (note the slash).
  readonly defaultModels = [
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'google/gemini-2.5-flash',
  ];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || POWER_BASE;

    // Power is OpenAI-compatible — identical message/tool shapes.
    const powerMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const powerTools = tools.length > 0 ? tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })) : undefined;

    // Power is OpenAI-compatible, so forceTool maps to tool_choice the same way local-gateway.ts
    // does. Without this, generateObject's noTools path (AgentAIClient.ts) sets config.forceTool
    // but the model is left free to respond in plain text instead of calling the forced tool —
    // reproduced live as "generateObject: model did not call __output__ tool" on every specialist
    // and synthesis call once the provider was actually reachable (see 2026-08-06 401 fix).
    //
    // max_tokens is likewise required: reproduced live that the two LARGEST prompts (Pattern,
    // ~17KB, and Synthesis, which concatenates all five specialist results) kept failing with
    // "did not call __output__ tool" even after tool_choice was fixed, while the four smaller
    // specialist calls succeeded — consistent with Power applying a low default completion budget
    // when none is given, truncating the response before the forced tool call ever completes.
    // anthropic.ts sends max_tokens:4096 for the same reason (Anthropic requires it on every
    // request); Power fans out to Anthropic/OpenAI/Google backends, several of which have small
    // implicit defaults absent an explicit value.
    const body = JSON.stringify({
      model: config.model,
      messages: powerMessages,
      stream: true,
      max_tokens: 8192,
      ...(powerTools ? { tools: powerTools } : {}),
      ...(config.forceTool ? { tool_choice: { type: 'function', function: { name: config.forceTool } } } : {}),
    });

    // Token usage is not reported on this path. This adapter does yield `done` (unlike
    // local-gateway.ts, which never does), so in principle a `usage` field could be attached — but
    // Power's OpenAI-compatible stream only includes a `usage` chunk when the request opts in via
    // `stream_options: { include_usage: true }`, which the `body` above does not set, and the parser
    // below never reads `data.usage` — there is nothing to observe there by construction, not
    // "observed absent". Grepped the visible code and docs/planning/iw/power-l2-provider-design.md
    // for any documented usage/token-count shape: zero hits. Wiring a field with no evidence it
    // exists would be exactly the invented-count failure mode this system exists to avoid, so
    // `llm.call` carries no in=/out=/cost= for this provider until that shape is verified against a
    // real response.
    try {
      const stream = streamingRequest({
        url: `${baseUrl}/chat/completions`,
        // Bearer only — no WPEngine-Project header (see file header note).
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
        signal,
      });

      // Track in-progress tool calls by index
      const activeToolCalls = new Map<number, { id: string; name: string; argsBuf: string }>();

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        const delta = data.choices?.[0]?.delta;
        const finishReason = data.choices?.[0]?.finish_reason;

        if (delta?.content) {
          yield { type: 'token', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;

            if (tc.id) {
              // New tool call
              activeToolCalls.set(idx, { id: tc.id, name: tc.function?.name ?? '', argsBuf: '' });
              yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name ?? '' };
            }

            if (tc.function?.arguments) {
              const active = activeToolCalls.get(idx);
              if (active) {
                active.argsBuf += tc.function.arguments;
                yield { type: 'tool_call_args_delta', id: active.id, argsDelta: tc.function.arguments };
              }
            }
          }
        }

        if (finishReason) {
          // Finalize any pending tool calls
          for (const [, tc] of activeToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.argsBuf);
            } catch { /* empty args */ }
            yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: args };
          }
          activeToolCalls.clear();

          const stopReason = finishReason === 'tool_calls' ? 'tool_use'
            : finishReason === 'length' ? 'max_tokens'
            : 'end_turn';
          yield { type: 'done', stopReason };
          return;
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Power error: ${(err as Error).message}` };
    }
  }

  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || POWER_BASE;
    try {
      const response = await apiRequest({
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const data = JSON.parse(response);
      // NO prefix filter — Power returns `provider/model` ids across vendors.
      const models = (data.data ?? [])
        .map((m: any) => m.id as string)
        .filter((id: string) => typeof id === 'string' && id.length > 0)
        .sort();
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${POWER_BASE}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return null;
    } catch (err) {
      return `Invalid API key: ${(err as Error).message}`;
    }
  }
}
