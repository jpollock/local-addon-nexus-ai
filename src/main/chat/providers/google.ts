import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini's function-declaration schema accepts a strict subset of JSON Schema.
 * Unsupported keywords cause HTTP 400 INVALID_ARGUMENT errors. Strip them recursively.
 *
 * Removed: additionalProperties, $schema, $id, $ref, definitions, allOf, anyOf, oneOf, not,
 *          patternProperties, dependencies, if/then/else, contentEncoding, contentMediaType
 */
const GEMINI_SCHEMA_BLOCKLIST = new Set([
  'additionalProperties', '$schema', '$id', '$ref', '$defs', 'definitions',
  'allOf', 'anyOf', 'oneOf', 'not', 'patternProperties', 'dependencies',
  'if', 'then', 'else', 'contentEncoding', 'contentMediaType',
]);

function sanitizeSchemaForGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (GEMINI_SCHEMA_BLOCKLIST.has(key)) continue;
    out[key] = sanitizeSchemaForGemini(value);
  }
  return out;
}

export class GoogleProvider implements AIProvider {
  readonly id = 'google';
  readonly displayName = 'Google Gemini';
  readonly requiresApiKey = true;
  readonly defaultModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || GEMINI_BASE;

    // Extract system instruction
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Convert messages to Gemini format
    const contents = nonSystemMessages.map((m) => {
      if (m.role === 'tool') {
        // Gemini requires function responses as role:'user', not role:'function'
        return {
          role: 'user' as const,
          parts: [{
            functionResponse: {
              name: m.toolName ?? '',
              response: { result: m.content },
            },
          }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: any[] = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
        return { role: 'model' as const, parts };
      }
      return {
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      };
    });

    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeSchemaForGemini(t.parameters),
      })),
    }] : undefined;

    const toolConfig = config.forceTool && geminiTools
      ? { function_calling_config: { mode: 'ANY', allowed_function_names: [config.forceTool] } }
      : undefined;

    const body = JSON.stringify({
      contents,
      ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(toolConfig ? { tool_config: toolConfig } : {}),
    });

    // LOG: write exact request to file for debugging
    try {
      const _logFs = require('fs');
      const _logOs = require('os');
      const _logPath = require('path').join(_logOs.homedir(), 'Desktop', 'nexus-api-calls.jsonl');
      const _entry = JSON.stringify({
        timestamp: Date.now(),
        provider: 'google',
        model: config.model,
        forceTool: config.forceTool ?? null,
        toolCount: tools.length,
        schemaName: null,
        apiKeyPrefix: config.apiKey ? config.apiKey.slice(0, 8) + '...' : 'EMPTY',
        apiKeyLen: config.apiKey?.length ?? 0,
        baseUrl: config.baseUrl ?? '(direct)',
        requestBodyLen: body.length,
        requestBody: body,
        status: null,
        responseBody: null,
        responseBodyLen: 0,
        durationMs: 0,
        error: null,
      });
      _logFs.appendFileSync(_logPath, _entry + '\n');
    } catch {}

    const _startMs = Date.now();

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
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

        const candidates = data.candidates ?? [];
        for (const candidate of candidates) {
          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'token', text: part.text };
            }
            if (part.functionCall) {
              const callId = `gemini_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              yield { type: 'tool_call_start', id: callId, name: part.functionCall.name };
              yield {
                type: 'tool_call_end',
                id: callId,
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
              };
            }
          }

          const finishReason = candidate.finishReason;
          if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
            const hasFunctionCalls = parts.some((p: any) => p.functionCall);
            const stopReason = hasFunctionCalls ? 'tool_use'
              : finishReason === 'MAX_TOKENS' ? 'max_tokens'
              : 'end_turn';
            yield { type: 'done', stopReason };
            return;
          }
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      // LOG: update the last log entry with error info
      try {
        const _logFs = require('fs');
        const _logOs = require('os');
        const _logPath = require('path').join(_logOs.homedir(), 'Desktop', 'nexus-api-calls.jsonl');
        const _raw = _logFs.readFileSync(_logPath, 'utf8').trimEnd();
        const _lines = _raw.split('\n');
        const _last = JSON.parse(_lines[_lines.length - 1]);
        _last.error = (err as Error).message;
        _last.durationMs = Date.now() - _startMs;
        _lines[_lines.length - 1] = JSON.stringify(_last);
        _logFs.writeFileSync(_logPath, _lines.join('\n') + '\n');
      } catch {}
      yield { type: 'error', message: `Gemini error: ${(err as Error).message}` };
    }
  }

  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || GEMINI_BASE;
    try {
      const response = await apiRequest({
        url: `${baseUrl}/models?key=${config.apiKey}`,
      });
      const data = JSON.parse(response);
      const models = (data.models ?? [])
        .map((m: any) => (m.name as string).replace('models/', ''))
        .filter((id: string) => id.startsWith('gemini-'))
        .sort();
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${GEMINI_BASE}/models?key=${apiKey}`,
      });
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('400') || msg.includes('403')) {
        return 'Invalid API key';
      }
      return `Validation failed: ${msg}`;
    }
  }
}
