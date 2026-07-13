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
}
