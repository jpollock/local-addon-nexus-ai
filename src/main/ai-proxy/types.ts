/**
 * AI Proxy Server types — OpenAI-compatible API format
 */

export interface AiProxyConnectionInfo {
  url: string;
  port: number;
  authToken: string;
  models: string[];
  toolCapableModels: string[];
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completion Request
// ---------------------------------------------------------------------------

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
}

/** Content part used in the array form of message content (OpenAI newer format) */
export interface OpenAIContentPart {
  type: 'text' | 'image_url' | string;
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** string (legacy) or array of content parts (newer OpenAI format) */
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string (OpenAI format)
  };
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completion Response
// ---------------------------------------------------------------------------

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length';
}

// ---------------------------------------------------------------------------
// OpenAI Models Response
// ---------------------------------------------------------------------------

export interface OpenAIModelsResponse {
  object: 'list';
  data: OpenAIModelEntry[];
}

export interface OpenAIModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  /** Extension: whether this model supports native tool calling */
  toolCapable?: boolean;
}

// ---------------------------------------------------------------------------
// OpenAI Embedding Request/Response
// ---------------------------------------------------------------------------

export interface OpenAIEmbeddingRequest {
  model?: string;
  input: string | string[];
}

export interface OpenAIEmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Ollama API types (for translation)
// ---------------------------------------------------------------------------

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>; // Object (Ollama format — NOT JSON string)
  };
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ---------------------------------------------------------------------------
// Tool mode header
// ---------------------------------------------------------------------------

export type ToolMode = 'passthrough' | 'inject' | 'agentic';
