import * as http from 'http';
import * as https from 'https';

// ---------------------------------------------------------------------------
// Streaming HTTP Utilities
// ---------------------------------------------------------------------------

export interface StreamingRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Streaming HTTP request that yields raw data lines.
 * Handles both SSE (`data: ...`) and newline-delimited JSON formats.
 */
export async function* streamingRequest(
  options: StreamingRequestOptions,
): AsyncGenerator<string> {
  const { url, method = 'POST', headers = {}, body, signal, timeoutMs = 120_000 } = options;
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        timeout: timeoutMs,
      },
      resolve,
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    if (body) req.write(body);
    req.end();
  });

  if (response.statusCode && response.statusCode >= 400) {
    let errorBody = '';
    for await (const chunk of response) {
      errorBody += chunk.toString();
    }
    throw new Error(`HTTP ${response.statusCode}: ${errorBody.slice(0, 500)}`);
  }

  let buffer = '';
  for await (const chunk of response) {
    if (signal?.aborted) break;

    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === ':') continue;

      // SSE format: data: ...
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        yield data;
      } else if (trimmed.startsWith('{')) {
        // Newline-delimited JSON
        yield trimmed;
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      if (data !== '[DONE]') yield data;
    } else if (trimmed.startsWith('{')) {
      yield trimmed;
    }
  }
}

/**
 * Non-streaming HTTP request for validation and model listing.
 */
export async function apiRequest(options: StreamingRequestOptions): Promise<string> {
  const { url, method = 'GET', headers = {}, body, timeoutMs = 30_000 } = options;
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}
