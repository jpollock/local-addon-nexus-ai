/**
 * AiProxyServer — OpenAI-compatible HTTP proxy backed by Ollama
 *
 * Provides /v1/chat/completions, /v1/models, /v1/embeddings, /health.
 * Supports tool calling: passthrough, inject (MCP tools), and agentic modes.
 */
import * as http from 'http';
import * as crypto from 'crypto';
import { OLLAMA_BASE_URL } from '../../common/constants';
import { apiRequest, streamingRequest } from '../chat/providers/http-utils';
import type {
  AiProxyConnectionInfo,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChoice,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAITool,
  OpenAIModelsResponse,
  OpenAIModelEntry,
  OpenAIEmbeddingRequest,
  OpenAIEmbeddingResponse,
  OllamaChatResponse,
  OllamaMessage,
  ToolMode,
} from './types';
import { convertMcpToolsToOpenAI } from './tool-converter';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface AiProxyServerOptions {
  logger: Logger;
  port?: number;
  authToken?: string;
  embeddingService?: {
    embed(text: string): Promise<Float32Array>;
  };
  toolRegistry?: ToolRegistry;
  nexusServices?: NexusServices;
}

/** Token bucket rate limiter */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  constructor(private maxTokens: number, private refillRate: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

const MAX_BODY_SIZE = 1_048_576; // 1MB

export class AiProxyServer {
  private server: http.Server | null = null;
  private logger: Logger;
  private port: number;
  private authToken: string;
  private running = false;
  private rateLimiter = new RateLimiter(60, 1); // 60 req/min, refill 1/sec
  private toolCapabilityCache = new Map<string, boolean>();
  private embeddingService: AiProxyServerOptions['embeddingService'];
  private toolRegistry?: ToolRegistry;
  private nexusServices?: NexusServices;

  constructor(options: AiProxyServerOptions) {
    this.logger = options.logger;
    this.port = options.port ?? 0;
    this.authToken = options.authToken ?? crypto.randomBytes(32).toString('hex');
    this.embeddingService = options.embeddingService;
    this.toolRegistry = options.toolRegistry;
    this.nexusServices = options.nexusServices;
  }

  async start(): Promise<AiProxyConnectionInfo> {
    if (this.running) throw new Error('AiProxyServer already running');

    if (this.port === 0) {
      this.port = await this.findAvailablePort();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(this.port, '127.0.0.1', async () => {
        this.running = true;
        this.logger.info(`[AiProxy] Server listening on http://127.0.0.1:${this.port}`);

        try {
          const info = await this.buildConnectionInfo();
          resolve(info);
        } catch {
          resolve({
            url: `http://127.0.0.1:${this.port}`,
            port: this.port,
            authToken: this.authToken,
            models: [],
            toolCapableModels: [],
          });
        }
      });

      this.server.on('error', (err) => {
        this.running = false;
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.running = false;
      return;
    }
    return new Promise((resolve) => {
      // Force-close keep-alive connections so close() callback fires immediately
      this.server!.closeAllConnections();
      this.server!.close(() => {
        this.server = null;
        this.running = false;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getConnectionInfo(): AiProxyConnectionInfo | null {
    if (!this.running) return null;
    // Return cached info synchronously — models may be stale but that's fine for config
    return {
      url: `http://127.0.0.1:${this.port}`,
      port: this.port,
      authToken: this.authToken,
      models: [],
      toolCapableModels: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Request Router
  // ---------------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Nexus-Tools');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Wrap async route handling to catch errors
    this.routeRequest(req, res).catch((err) => {
      this.logger.error('[AiProxy] Unhandled route error:', (err as Error).message);
      if (!res.headersSent) {
        this.json(res, 500, { error: { message: 'Internal server error', type: 'server_error' } });
      }
    });
  }

  private async routeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // Health — no auth required
    if (url === '/health' && req.method === 'GET') {
      await this.handleHealth(res);
      return;
    }

    // All other endpoints require auth
    if (!this.validateAuth(req)) {
      this.json(res, 401, { error: { message: 'Unauthorized', type: 'auth_error' } });
      return;
    }

    // Rate limiting
    if (!this.rateLimiter.tryConsume()) {
      this.json(res, 429, { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } });
      return;
    }

    if (url === '/v1/chat/completions' && req.method === 'POST') {
      const body = await this.readBodyAsync(req, res);
      if (body !== null) await this.handleChatCompletions(body, req, res);
    } else if (url === '/v1/models' && req.method === 'GET') {
      await this.handleModels(res);
    } else if (url === '/v1/embeddings' && req.method === 'POST') {
      const body = await this.readBodyAsync(req, res);
      if (body !== null) await this.handleEmbeddings(body, res);
    } else {
      this.json(res, 404, { error: { message: 'Not found', type: 'not_found' } });
    }
  }

  // ---------------------------------------------------------------------------
  // /health
  // ---------------------------------------------------------------------------

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const ollamaAvailable = await this.isOllamaAvailable();
    this.json(res, 200, {
      status: 'ok',
      ollama: ollamaAvailable,
      port: this.port,
    });
  }

  // ---------------------------------------------------------------------------
  // /v1/models
  // ---------------------------------------------------------------------------

  private async handleModels(res: http.ServerResponse): Promise<void> {
    try {
      const response = await apiRequest({ url: `${OLLAMA_BASE_URL}/api/tags`, method: 'GET' });
      const data = JSON.parse(response);
      const models: OpenAIModelEntry[] = [];

      for (const m of data.models ?? []) {
        const toolCapable = await this.checkToolSupport(m.name);
        models.push({
          id: m.name,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'ollama',
          toolCapable,
        });
      }

      const result: OpenAIModelsResponse = { object: 'list', data: models };
      this.json(res, 200, result);
    } catch {
      this.json(res, 503, { error: { message: 'Ollama not available', type: 'service_unavailable' } });
    }
  }

  // ---------------------------------------------------------------------------
  // /v1/chat/completions
  // ---------------------------------------------------------------------------

  private async handleChatCompletions(
    body: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let request: OpenAIChatRequest;
    try {
      request = JSON.parse(body);
    } catch {
      this.json(res, 400, { error: { message: 'Invalid JSON', type: 'invalid_request' } });
      return;
    }

    if (!request.model || !request.messages) {
      this.json(res, 400, { error: { message: 'Missing model or messages', type: 'invalid_request' } });
      return;
    }

    // Check Ollama availability
    if (!(await this.isOllamaAvailable())) {
      this.json(res, 503, { error: { message: 'Ollama not available', type: 'service_unavailable' } });
      return;
    }

    // Parse tool mode from header
    const toolMode = this.parseToolMode(req);

    // Inject/agentic: merge MCP tools with request tools
    if (toolMode !== 'passthrough' && this.toolRegistry && this.nexusServices) {
      const mcpTools = convertMcpToolsToOpenAI(this.toolRegistry, this.nexusServices, {
        excludeDestructive: true,
      });

      // Merge: WordPress tools first, then MCP tools, cap at 20
      const wpTools = request.tools ?? [];
      const merged = [...wpTools, ...mcpTools].slice(0, 20);
      request.tools = merged;
    }

    const hasTools = request.tools && request.tools.length > 0;
    const wantsStream = request.stream === true && !hasTools;

    if (wantsStream) {
      await this.handleStreamingChat(request, res);
    } else if (toolMode === 'agentic' && this.toolRegistry && this.nexusServices) {
      await this.handleAgenticChat(request, res);
    } else {
      await this.handleNonStreamingChat(request, res);
    }
  }

  /**
   * Non-streaming chat — used when tools are present or stream=false.
   * Translates between OpenAI and Ollama formats, handling tool_calls.
   */
  private async handleNonStreamingChat(
    request: OpenAIChatRequest,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      // Convert OpenAI messages to Ollama format
      const ollamaMessages = this.toOllamaMessages(request.messages);

      // Build Ollama request
      const ollamaBody: any = {
        model: request.model,
        messages: ollamaMessages,
        stream: false,
      };

      // Forward tools if present (formats are identical)
      if (request.tools && request.tools.length > 0) {
        const toolCapable = await this.checkToolSupport(request.model);
        if (toolCapable) {
          ollamaBody.tools = request.tools;
        }
        // If not tool-capable, tools are silently dropped — model won't understand them
      }

      if (request.temperature !== undefined) ollamaBody.options = { ...ollamaBody.options, temperature: request.temperature };
      if (request.top_p !== undefined) ollamaBody.options = { ...ollamaBody.options, top_p: request.top_p };

      const response = await apiRequest({
        url: `${OLLAMA_BASE_URL}/api/chat`,
        method: 'POST',
        body: JSON.stringify(ollamaBody),
        timeoutMs: 120_000,
      });

      const ollamaResponse: OllamaChatResponse = JSON.parse(response);

      // Translate to OpenAI format
      const openaiResponse = this.toOpenAIResponse(request.model, ollamaResponse);
      this.json(res, 200, openaiResponse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[AiProxy] Chat completion error:', msg);
      this.json(res, 500, { error: { message: msg, type: 'server_error' } });
    }
  }

  /**
   * Streaming chat — used when no tools and stream=true.
   * Forwards Ollama streaming response as OpenAI SSE events.
   */
  private async handleStreamingChat(
    request: OpenAIChatRequest,
    res: http.ServerResponse,
  ): Promise<void> {
    const ollamaMessages = this.toOllamaMessages(request.messages);

    const ollamaBody: any = {
      model: request.model,
      messages: ollamaMessages,
      stream: true,
    };

    if (request.temperature !== undefined) ollamaBody.options = { ...ollamaBody.options, temperature: request.temperature };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const responseId = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);

    try {
      const stream = streamingRequest({
        url: `${OLLAMA_BASE_URL}/api/chat`,
        body: JSON.stringify(ollamaBody),
      });

      for await (const line of stream) {
        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        if (data.message?.content) {
          const chunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model: request.model,
            choices: [{
              index: 0,
              delta: { content: data.message.content },
              finish_reason: null,
            }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (data.done) {
          const doneChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model: request.model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop',
            }],
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[AiProxy] Streaming error:', msg);
      // Try to send error if response not finished
      try {
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {
        res.end();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // /v1/embeddings
  // ---------------------------------------------------------------------------

  private async handleEmbeddings(body: string, res: http.ServerResponse): Promise<void> {
    if (!this.embeddingService) {
      this.json(res, 503, { error: { message: 'Embedding service not available', type: 'service_unavailable' } });
      return;
    }

    let request: OpenAIEmbeddingRequest;
    try {
      request = JSON.parse(body);
    } catch {
      this.json(res, 400, { error: { message: 'Invalid JSON', type: 'invalid_request' } });
      return;
    }

    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    if (inputs.length === 0) {
      this.json(res, 400, { error: { message: 'Input is required', type: 'invalid_request' } });
      return;
    }

    try {
      const data = [];
      let totalTokens = 0;

      for (let i = 0; i < inputs.length; i++) {
        const embedding = await this.embeddingService.embed(inputs[i]);
        data.push({
          object: 'embedding' as const,
          embedding: Array.from(embedding),
          index: i,
        });
        // Rough token estimate: ~4 chars per token
        totalTokens += Math.ceil(inputs[i].length / 4);
      }

      const result: OpenAIEmbeddingResponse = {
        object: 'list',
        data,
        model: 'all-MiniLM-L6-v2',
        usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
      };

      this.json(res, 200, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.json(res, 500, { error: { message: msg, type: 'server_error' } });
    }
  }

  // ---------------------------------------------------------------------------
  // Format Translation: OpenAI <-> Ollama
  // ---------------------------------------------------------------------------

  /**
   * Convert OpenAI messages to Ollama format.
   * Key difference: tool role messages and assistant tool_calls.
   */
  private toOllamaMessages(messages: OpenAIMessage[]): OllamaMessage[] {
    return messages.map((m) => {
      // Normalize content: newer OpenAI format sends array of content parts.
      // Flatten to string by extracting text parts.
      let content: string;
      if (Array.isArray(m.content)) {
        content = m.content
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text!)
          .join('\n');
      } else {
        content = m.content ?? '';
      }

      const msg: OllamaMessage = {
        role: m.role,
        content,
      };

      // Convert assistant tool_calls: OpenAI uses JSON string arguments, Ollama uses objects
      if (m.role === 'assistant' && m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments,
          },
        }));
      }

      return msg;
    });
  }

  /**
   * Convert Ollama response to OpenAI chat completion format.
   * Key difference: Ollama tool_calls arguments are objects, OpenAI expects JSON strings.
   */
  private toOpenAIResponse(model: string, ollamaRes: OllamaChatResponse): OpenAIChatResponse {
    const message: OpenAIMessage = {
      role: 'assistant',
      content: ollamaRes.message.content || null,
    };

    let finishReason: OpenAIChoice['finish_reason'] = 'stop';

    if (ollamaRes.message.tool_calls?.length) {
      finishReason = 'tool_calls';
      message.tool_calls = ollamaRes.message.tool_calls.map((tc, i) => ({
        id: `call_${crypto.randomBytes(8).toString('hex')}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          // Ollama returns arguments as object — OpenAI expects JSON string
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
        },
      }));
    }

    return {
      id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: ollamaRes.prompt_eval_count ?? 0,
        completion_tokens: ollamaRes.eval_count ?? 0,
        total_tokens: (ollamaRes.prompt_eval_count ?? 0) + (ollamaRes.eval_count ?? 0),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Agentic Mode
  // ---------------------------------------------------------------------------

  private static readonly MAX_AGENTIC_ROUNDS = 5;
  private static readonly TOOL_TIMEOUT_MS = 30_000;
  private static readonly MAX_TOOL_RESULT_SIZE = 4096;

  /**
   * Agentic chat — execute MCP tool calls server-side, loop until done.
   * WordPress tool calls are returned to the caller without execution.
   */
  private async handleAgenticChat(
    request: OpenAIChatRequest,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const messages = [...request.messages];
      const mcpToolNames = new Set(
        this.toolRegistry
          ? convertMcpToolsToOpenAI(this.toolRegistry, this.nexusServices!, { excludeDestructive: true })
              .map((t) => t.function.name)
          : [],
      );

      for (let round = 0; round < AiProxyServer.MAX_AGENTIC_ROUNDS; round++) {
        const ollamaMessages = this.toOllamaMessages(messages);
        const ollamaBody: any = {
          model: request.model,
          messages: ollamaMessages,
          stream: false,
        };

        if (request.tools?.length) {
          const toolCapable = await this.checkToolSupport(request.model);
          if (toolCapable) ollamaBody.tools = request.tools;
        }

        const response = await apiRequest({
          url: `${OLLAMA_BASE_URL}/api/chat`,
          method: 'POST',
          body: JSON.stringify(ollamaBody),
          timeoutMs: 120_000,
        });

        const ollamaRes: OllamaChatResponse = JSON.parse(response);

        // No tool calls — return final response
        if (!ollamaRes.message.tool_calls?.length) {
          this.json(res, 200, this.toOpenAIResponse(request.model, ollamaRes));
          return;
        }

        // Check if any tool calls are for WordPress (non-MCP) tools
        const wpToolCalls = ollamaRes.message.tool_calls.filter(
          (tc) => !mcpToolNames.has(tc.function.name),
        );

        // If there are WordPress tool calls, return them to the caller
        if (wpToolCalls.length > 0) {
          this.json(res, 200, this.toOpenAIResponse(request.model, ollamaRes));
          return;
        }

        // All tool calls are MCP tools — execute server-side
        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: ollamaRes.message.content || null,
          tool_calls: ollamaRes.message.tool_calls.map((tc, i) => ({
            id: `call_${crypto.randomBytes(8).toString('hex')}`,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
            },
          })),
        };
        messages.push(assistantMsg);

        // Execute each MCP tool call
        for (const tc of assistantMsg.tool_calls!) {
          const toolName = tc.function.name;
          const args = JSON.parse(tc.function.arguments);

          let resultText: string;
          try {
            const result = await Promise.race([
              this.toolRegistry!.call(toolName, args, this.nexusServices!),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Tool execution timed out')), AiProxyServer.TOOL_TIMEOUT_MS),
              ),
            ]);
            resultText = result.content.map((c) => c.text).join('\n');
          } catch (err) {
            resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          // Truncate large results
          if (resultText.length > AiProxyServer.MAX_TOOL_RESULT_SIZE) {
            resultText = resultText.slice(0, AiProxyServer.MAX_TOOL_RESULT_SIZE) + '\n... (truncated)';
          }

          messages.push({
            role: 'tool',
            content: resultText,
            tool_call_id: tc.id,
          });
        }
      }

      // Max rounds exceeded — return last response with a note
      const finalOllamaMessages = this.toOllamaMessages(messages);
      const finalResponse = await apiRequest({
        url: `${OLLAMA_BASE_URL}/api/chat`,
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: finalOllamaMessages,
          stream: false,
        }),
        timeoutMs: 120_000,
      });
      const finalOllamaRes: OllamaChatResponse = JSON.parse(finalResponse);
      this.json(res, 200, this.toOpenAIResponse(request.model, finalOllamaRes));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[AiProxy] Agentic chat error:', msg);
      this.json(res, 500, { error: { message: msg, type: 'server_error' } });
    }
  }

  // ---------------------------------------------------------------------------
  // Ollama Helpers
  // ---------------------------------------------------------------------------

  private async isOllamaAvailable(): Promise<boolean> {
    try {
      await apiRequest({ url: `${OLLAMA_BASE_URL}/api/tags`, method: 'GET', timeoutMs: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if an Ollama model supports tool calling by inspecting its template.
   * Reuses the same approach as OllamaProvider.checkToolSupport.
   */
  async checkToolSupport(model: string): Promise<boolean> {
    if (this.toolCapabilityCache.has(model)) {
      return this.toolCapabilityCache.get(model)!;
    }

    try {
      const response = await apiRequest({
        url: `${OLLAMA_BASE_URL}/api/show`,
        method: 'POST',
        body: JSON.stringify({ name: model }),
      });
      const data = JSON.parse(response);
      const template = (data.template ?? '') as string;
      const hasToolSupport = template.includes('.Tools') || template.includes('.ToolCalls');
      this.toolCapabilityCache.set(model, hasToolSupport);
      return hasToolSupport;
    } catch {
      this.toolCapabilityCache.set(model, false);
      return false;
    }
  }

  private async buildConnectionInfo(): Promise<AiProxyConnectionInfo> {
    const models: string[] = [];
    const toolCapableModels: string[] = [];

    try {
      const response = await apiRequest({ url: `${OLLAMA_BASE_URL}/api/tags`, method: 'GET' });
      const data = JSON.parse(response);
      for (const m of data.models ?? []) {
        models.push(m.name);
        if (await this.checkToolSupport(m.name)) {
          toolCapableModels.push(m.name);
        }
      }
    } catch {
      // Ollama not available — proceed with empty lists
    }

    return {
      url: `http://127.0.0.1:${this.port}`,
      port: this.port,
      authToken: this.authToken,
      models,
      toolCapableModels,
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP Utilities
  // ---------------------------------------------------------------------------

  private parseToolMode(req: http.IncomingMessage): ToolMode {
    const header = req.headers['x-nexus-tools'] as string | undefined;
    if (header === 'inject' || header === 'agentic') return header;
    return 'passthrough';
  }

  private validateAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') return false;
    if (!token) return false;
    if (token.length !== this.authToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.authToken));
  }

  private json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Read request body with size limit. Returns null if body exceeds limit (response already sent).
   */
  private readBodyAsync(req: http.IncomingMessage, res: http.ServerResponse): Promise<string | null> {
    return new Promise((resolve) => {
      let body = '';
      let size = 0;
      let aborted = false;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE && !aborted) {
          aborted = true;
          this.json(res, 413, { error: { message: 'Request body too large', type: 'invalid_request' } });
          req.destroy();
          resolve(null);
          return;
        }
        body += chunk.toString();
      });

      req.on('end', () => {
        if (!aborted) resolve(body);
      });

      req.on('error', () => {
        if (!aborted) resolve(null);
      });
    });
  }

  private async findAvailablePort(): Promise<number> {
    // Use range 13100-13199 (above HttpEventInterface's 13000-13100)
    const startPort = 13100;
    const endPort = 13199;

    for (let port = startPort; port <= endPort; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available port in range ${startPort}-${endPort}`);
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = http.createServer();
      tester.once('error', () => resolve(false));
      tester.listen(port, '127.0.0.1', () => {
        tester.close(() => resolve(true));
      });
    });
  }
}
