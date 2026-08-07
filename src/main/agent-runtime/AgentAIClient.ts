import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from '../chat/providers/types';
import type { ChatMessage, ToolCallRequest, ProviderStreamEvent } from '../../common/chat-types';
import type { AIClient } from '../agent-sdk/types';
import { AgentAILoopError } from '../agent-sdk/types';
import type { NexusToolProvider } from './NexusToolProvider';

interface StreamResult {
  content: string;
  toolCalls: ToolCallRequest[];
}

/**
 * Some models wrap their __output__ tool-call arguments in a `result` key instead of returning
 * schema fields flat; some don't. Reproduced live: a synthesizer call returned
 * `{ verdict: 'high-risk', result: { attackSummary: '...', ... } }` — verdict as a SIBLING of
 * result, everything else inside it. The old `raw?.result ?? raw` unwrap is all-or-nothing: since
 * `result` was truthy, the whole return value became `raw.result`, silently dropping `verdict`
 * ("[Tier 2 Synthesis] NitroPack Production: undefined — ..." in the log — attackSummary present,
 * verdict gone). Spreading both, with `result`'s fields taking precedence on overlap, covers the
 * fully-wrapped, fully-flat, and split shapes without needing to know which one a given model uses.
 */
function unwrapOutputArguments(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const nested = raw.result;
  if (nested && typeof nested === 'object') {
    return { ...raw, ...(nested as Record<string, unknown>) };
  }
  return raw;
}

async function collectStream(gen: AsyncGenerator<ProviderStreamEvent>): Promise<StreamResult> {
  let content = '';
  const toolCalls: ToolCallRequest[] = [];

  for await (const event of gen) {
    if (event.type === 'token') {
      content += event.text;
    } else if (event.type === 'tool_call_end') {
      toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
    } else if (event.type === 'error') {
      throw new Error(`Provider error: ${event.message}`);
    }
  }

  return { content, toolCalls };
}

export class AgentAIClient implements AIClient {
  private provider: AIProvider;
  private config: ChatProviderConfig;
  private toolProvider: NexusToolProvider;
  /** Direct provider (bypasses gateway) — used for generateObject forced-tool calls */
  private directProvider?: AIProvider;
  private directConfig?: ChatProviderConfig;

  constructor(provider: AIProvider, config: ChatProviderConfig, toolProvider: NexusToolProvider, directProvider?: AIProvider, directConfig?: ChatProviderConfig) {
    this.provider = provider;
    this.directProvider = directProvider;
    this.directConfig = directConfig;
    this.config = config;
    this.toolProvider = toolProvider;
  }

  async run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string> {
    const maxTurns = opts?.maxTurns ?? 10;
    const config: ChatProviderConfig = opts?.model
      ? { ...this.config, model: opts.model }
      : this.config;

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    const tools: ProviderToolDefinition[] = this.toolProvider.getProviderToolDefinitions();
    // TODO: thread an AbortSignal from AgentRunner's timeout Promise.race so that
    // in-flight HTTP requests are cancelled when the agent times out.
    // Use a never-aborted signal for now so providers don't throw on signal.aborted.
    const signal = new AbortController().signal;

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await collectStream(this.provider.streamChat(messages, tools, config, signal));

      if (response.toolCalls.length === 0) {
        return response.content;
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const result = await this.toolProvider.invoke(call.name, call.arguments);
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: call.id,
        });
      }
    }

    throw new AgentAILoopError(maxTurns);
  }

  async generateObject<T>(opts: {
    prompt: string;
    system?: string;
    schema: Record<string, unknown>;
    schemaName?: string;
    noTools?: boolean;
  }): Promise<T> {
    const { prompt, system, schema, schemaName = 'output' } = opts;

    // Inject a synthetic tool whose schema IS the desired output.
    // Instruct the model to call it — the arguments become our typed result.
    const outputTool: ProviderToolDefinition = {
      name: '__output__',
      description: `Call this tool with the structured result. Schema name: ${schemaName}`,
      parameters: schema,
    };

    // For noTools calls (specialist analysis): use forced tool invocation.
    // The test script proved that tool_choice='any' with __output__ works reliably
    // across Google and Anthropic. JSON-in-text was unreliable because the model
    // returns text even when asked for JSON.
    if (opts.noTools) {
      const systemMsg = system ?? 'Analyze the provided data and call the __output__ tool with your structured findings.';
      const messages: ChatMessage[] = [{ role: 'user', content: `${systemMsg}\n\n${prompt}` }];
      // Route through normal provider (gateway or direct) with forceTool so gateway translates
      // to tool_config (Google) or tool_choice (Anthropic). Do NOT bypass gateway — the actual
      // API key lives there when useLocalGateway=true.
      const forcedConfig = { ...this.config, forceTool: '__output__' };
      const signal = new AbortController().signal;
      const response = await collectStream(this.provider.streamChat(messages, [outputTool], forcedConfig, signal));
      const outputCall = response.toolCalls.find(c => c.name === '__output__');
      if (outputCall) {
        return unwrapOutputArguments(outputCall.arguments) as T;
      }
      // Fallback: model responded in text despite forced tool — try to parse JSON
      const text = response.content?.trim() ?? '';
      const jsonMatch = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim().match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]) as T; } catch {}
      }
      throw new Error('generateObject: model did not call __output__ tool');
    }

    const systemMsg = system
      ? `${system}\n\nYou MUST call the __output__ tool with your response. Do not reply in plain text.`
      : 'You MUST call the __output__ tool with your response. Do not reply in plain text.';

    const messages: ChatMessage[] = [
      { role: 'user', content: `${systemMsg}\n\n${prompt}` },
    ];

    const tools: ProviderToolDefinition[] = [outputTool, ...this.toolProvider.getProviderToolDefinitions()];
    const signal = new AbortController().signal;

    for (let turn = 0; turn < 5; turn++) {
      const response = await collectStream(this.provider.streamChat(messages, tools, this.config, signal));

      const outputCall = response.toolCalls.find(c => c.name === '__output__');
      if (outputCall) {
        return unwrapOutputArguments(outputCall.arguments) as T;
      }

      if (response.toolCalls.length === 0) {
        const text = response.content?.trim() ?? '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { return JSON.parse(jsonMatch[0]) as T; } catch {}
        }
        throw new Error('generateObject: model did not call __output__ tool');
      }

      // Handle non-output tool calls normally (e.g. fleet_sql during analysis)
      messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const result = await this.toolProvider.invoke(call.name, call.arguments);
        messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: call.id });
      }
    }

    throw new Error('generateObject: model did not call __output__ tool after 5 turns');
  }
}
