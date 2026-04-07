import { McpToolResult, NexusServices } from '../../types';

export function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function requireCAPI(services: NexusServices): boolean {
  return !!services.localServices?.isCAPIAvailable();
}

export function requireLocalServices(services: NexusServices): boolean {
  return !!services.localServices;
}

/**
 * Handles errors from Local's CAPI client.
 * ResponseError with status 401/403 means the OAuth token has expired —
 * return an actionable message so the agent knows to call wpe_login.
 */
export function capiError(err: any): McpToolResult {
  const msg: string = err?.message ?? String(err);
  const isAuth = msg.toLowerCase().includes('response returned an error code') ||
    msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized');

  if (isAuth) {
    return error(
      'WP Engine authentication has expired. Call wpe_login to re-authenticate, ' +
      'then retry this tool.',
    );
  }
  return error(`WP Engine API error: ${msg}`);
}
