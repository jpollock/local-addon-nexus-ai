/**
 * Format translator for AI Gateway
 * Converts between OpenAI Chat Completions format and Anthropic Messages API
 */

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessage,
} from './types';

/**
 * Translate OpenAI Chat Completions request to Anthropic Messages API format
 */
export function translateToAnthropic(
  openAIRequest: OpenAIChatCompletionRequest,
): AnthropicMessagesRequest {
  // Extract system message if present
  let systemMessage: string | undefined;
  const messages: AnthropicMessage[] = [];

  for (const msg of openAIRequest.messages) {
    if (msg.role === 'system') {
      // Anthropic puts system messages in a separate field
      systemMessage = msg.content;
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  // Anthropic requires max_tokens
  const maxTokens = openAIRequest.max_tokens ?? 4096;

  const anthropicRequest: AnthropicMessagesRequest = {
    model: openAIRequest.model,
    messages,
    max_tokens: maxTokens,
  };

  if (systemMessage) {
    anthropicRequest.system = systemMessage;
  }

  if (openAIRequest.temperature !== undefined) {
    anthropicRequest.temperature = openAIRequest.temperature;
  }

  if (openAIRequest.top_p !== undefined) {
    anthropicRequest.top_p = openAIRequest.top_p;
  }

  if (openAIRequest.stop && openAIRequest.stop.length > 0) {
    anthropicRequest.stop_sequences = openAIRequest.stop;
  }

  return anthropicRequest;
}

/**
 * Translate Anthropic Messages API response to OpenAI Chat Completions format
 */
export function translateFromAnthropic(
  anthropicResponse: AnthropicMessagesResponse,
): OpenAIChatCompletionResponse {
  // Combine all text content blocks into a single message
  const content = anthropicResponse.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Map stop_reason
  let finishReason: 'stop' | 'length' | 'content_filter';
  if (anthropicResponse.stop_reason === 'end_turn') {
    finishReason = 'stop';
  } else if (anthropicResponse.stop_reason === 'max_tokens') {
    finishReason = 'length';
  } else if (anthropicResponse.stop_reason === 'stop_sequence') {
    finishReason = 'stop';
  } else {
    finishReason = 'stop'; // Default
  }

  const openAIResponse: OpenAIChatCompletionResponse = {
    id: anthropicResponse.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage.input_tokens,
      completion_tokens: anthropicResponse.usage.output_tokens,
      total_tokens:
        anthropicResponse.usage.input_tokens + anthropicResponse.usage.output_tokens,
    },
  };

  return openAIResponse;
}
