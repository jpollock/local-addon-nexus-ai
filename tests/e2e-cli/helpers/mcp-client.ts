/**
 * NexusMcpClient — lightweight MCP client for chat e2e tests.
 *
 * Reads the connection info file that McpServer writes on startup, then
 * provides helpers to list tools and call them against the live MCP server
 * running inside Local. Supports both Anthropic and Google Gemini providers.
 *
 * Requires: Local must be running with the Nexus AI addon active.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';

interface ConnectionInfo {
  url: string;
  authToken: string;
  port: number;
  tools: string[];
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function getConnectionInfoPath(): string {
  const platform = os.platform();
  let dataDir: string;
  if (platform === 'darwin') {
    dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  } else if (platform === 'win32') {
    dataDir = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
  } else {
    dataDir = path.join(os.homedir(), '.config', 'Local');
  }
  return path.join(dataDir, 'nexus-ai-mcp-connection-info.json');
}

export function loadConnectionInfo(): ConnectionInfo | null {
  const filePath = getConnectionInfoPath();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConnectionInfo;
  } catch {
    return null;
  }
}

export class NexusMcpClient {
  private readonly url: string;
  private readonly authToken: string;

  constructor(info: ConnectionInfo) {
    this.url = info.url;
    this.authToken = info.authToken;
  }

  private async jsonRpc(method: string, params?: unknown): Promise<unknown> {
    const res = await fetch(`${this.url}/mcp/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    if (!res.ok) {
      throw new Error(`MCP request failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);
    return json.result;
  }

  /** List all tools in Anthropic SDK format. */
  async listToolsForAnthropic(): Promise<Anthropic.Messages.Tool[]> {
    const result = await this.jsonRpc('tools/list') as { tools: McpToolDef[] };
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      input_schema: t.inputSchema as Anthropic.Messages.Tool['input_schema'],
    }));
  }

  /** List all tools in Gemini FunctionDeclaration format (strips unsupported JSON Schema keys). */
  async listToolsForGemini(): Promise<FunctionDeclaration[]> {
    const result = await this.jsonRpc('tools/list') as { tools: McpToolDef[] };
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      parameters: sanitizeSchemaForGemini(t.inputSchema) as any,
    }));
  }

  /** Call a tool by name with the given arguments. Returns the text content. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.jsonRpc('tools/call', { name, arguments: args }) as McpToolResult;
    return result.content.map((c) => c.text).join('\n');
  }
}

// ---------------------------------------------------------------------------
// JSON Schema sanitiser (Gemini rejects additionalProperties etc.)
// ---------------------------------------------------------------------------

const GEMINI_SCHEMA_BLOCKLIST = new Set([
  'additionalProperties', '$schema', '$id', '$ref', '$defs', 'definitions',
  'allOf', 'anyOf', 'oneOf', 'not', 'patternProperties', 'dependencies',
  'if', 'then', 'else', 'contentEncoding', 'contentMediaType',
]);

function sanitizeSchemaForGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_BLOCKLIST.has(k)) out[k] = sanitizeSchemaForGemini(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

export interface AgentRunResult {
  /** All tool calls made, in order */
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
  /** Final text response from the AI */
  finalText: string;
  /** Full message history */
  messages: Anthropic.Messages.MessageParam[];
}

/**
 * Run a single-turn agent conversation:
 *   1. Send the user message to Claude with all Nexus MCP tools available
 *   2. For each tool_use block, call the real MCP server and return the result
 *   3. Repeat until Claude sends a final text response
 *   4. Return the tool call log and final text
 */
export async function runAgentConversation(
  client: Anthropic,
  mcpClient: NexusMcpClient,
  userMessage: string,
  options: {
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
    /** Pass a previous result's .messages to continue a multi-turn conversation. */
    priorMessages?: Anthropic.Messages.MessageParam[];
  } = {},
): Promise<AgentRunResult> {
  const {
    model = 'claude-haiku-4-5-20251001',
    systemPrompt = 'You are a helpful assistant for managing WordPress sites in Local by WP Engine. Use the provided tools to fulfill requests. Be concise.',
    maxIterations = 10,
    priorMessages = [],
  } = options;

  const tools = await mcpClient.listToolsForAnthropic();
  const messages: Anthropic.Messages.MessageParam[] = [
    ...priorMessages,
    { role: 'user', content: userMessage },
  ];

  const toolCalls: AgentRunResult['toolCalls'] = [];

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    // Append assistant message
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { toolCalls, finalText, messages };
    }

    if (response.stop_reason !== 'tool_use') {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    // Execute all tool_use blocks and collect results
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const input = block.input as Record<string, unknown>;
      let result: string;
      let isError = false;
      try {
        result = await mcpClient.callTool(block.name, input);
      } catch (err) {
        result = `Error: ${(err as Error).message}`;
        isError = true;
      }

      toolCalls.push({ name: block.name, input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result, is_error: isError });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`Agent did not finish within ${maxIterations} iterations`);
}

// ---------------------------------------------------------------------------
// Google Gemini agent loop
// ---------------------------------------------------------------------------

export interface GeminiAgentRunResult {
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>;
  finalText: string;
}

/**
 * Run a single-turn agent conversation with Google Gemini.
 *
 * Uses generateContent directly (not the Chat wrapper) so we control the
 * full contents array — avoiding the strict turn-ordering errors the Chat
 * session raises when we re-inject function responses as continuation turns.
 *
 * Conversation structure Gemini expects:
 *   user(text) → model(functionCall) → user(functionResponse) → model(text)
 */
export async function runAgentConversationGoogle(
  genai: GoogleGenAI,
  mcpClient: NexusMcpClient,
  userMessage: string,
  options: {
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
  } = {},
): Promise<GeminiAgentRunResult> {
  const {
    model = 'gemini-2.5-pro',
    systemPrompt = 'You are a helpful assistant for managing WordPress sites in Local by WP Engine. Use the provided tools to fulfill requests. Be concise.',
    maxIterations = 10,
  } = options;

  const tools = await mcpClient.listToolsForGemini();
  const toolCalls: GeminiAgentRunResult['toolCalls'] = [];

  // Build the contents array ourselves — full control over turn ordering
  const contents: any[] = [
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await genai.models.generateContent({
      model,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: tools }],
      },
      contents,
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Collect function calls
    const fnCalls = parts.filter((p: any) => p.functionCall);
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text as string);

    // Add the model's response to the conversation
    contents.push({ role: 'model', parts });

    if (fnCalls.length === 0) {
      // No function calls — final text answer
      return { toolCalls, finalText: textParts.join('\n') };
    }

    // Execute each function call and collect responses
    const fnResponseParts: any[] = [];
    for (const part of fnCalls) {
      const { name, args } = part.functionCall as { name: string; args: Record<string, unknown> };
      let result: string;
      try {
        result = await mcpClient.callTool(name, args ?? {});
      } catch (err) {
        result = `Error: ${(err as Error).message}`;
      }
      toolCalls.push({ name, input: args ?? {}, result });
      fnResponseParts.push({
        functionResponse: { name, response: { result } },
      });
    }

    // Append function responses as the next user turn
    contents.push({ role: 'user', parts: fnResponseParts });
  }

  throw new Error(`Gemini agent did not finish within ${maxIterations} iterations`);
}
