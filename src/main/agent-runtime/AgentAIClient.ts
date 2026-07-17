import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from '../chat/providers/types';
import type { ChatMessage, ToolCallRequest, ProviderStreamEvent } from '../../common/chat-types';
import type { AIClient } from '../agent-sdk/types';
import { AgentAILoopError } from '../agent-sdk/types';
import type { NexusToolProvider } from './NexusToolProvider';

interface StreamResult {
  content: string;
  toolCalls: ToolCallRequest[];
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

  constructor(provider: AIProvider, config: ChatProviderConfig, toolProvider: NexusToolProvider) {
    this.provider = provider;
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

    // For noTools calls (specialist analysis), use JSON-in-text strategy — more reliable
    // than tool-use across all models, especially for complex schemas.
    if (opts.noTools) {
      const schemaStr = JSON.stringify(schema, null, 2);
      const instruction = system
        ? `${system}\n\nRespond ONLY with a valid JSON object matching this schema. No explanation, no markdown, just JSON.\nSchema:\n${schemaStr}`
        : `Respond ONLY with a valid JSON object matching this schema. No explanation, no markdown, just JSON.\nSchema:\n${schemaStr}`;
      const messages: ChatMessage[] = [{ role: 'user', content: `${instruction}\n\n${prompt}` }];
      const signal = new AbortController().signal;
      const response = await collectStream(this.provider.streamChat(messages, [], this.config, signal));
      const text = response.content?.trim() ?? '';
      // Strip markdown code fences if present
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]) as T; } catch (e) {
          throw new Error(`generateObject: model returned invalid JSON: ${(e as Error).message}`);
        }
      }
      throw new Error('generateObject: model did not return a JSON object');
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
        const raw = outputCall.arguments;
        return (raw?.result ?? raw) as T;
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
