/**
 * MCP Client for Nexus CLI
 *
 * Calls the Nexus AI MCP HTTP server directly instead of going through GraphQL.
 * Each CLI command becomes a single JSON-RPC tools/call — no bootstrapping or
 * site enumeration up front.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface McpConnectionInfo {
  url: string;
  authToken: string;
  port: number;
}

export class McpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpUnavailableError';
  }
}

function getConnectionInfoPath(): string {
  let dir: string;
  if (process.platform === 'darwin') {
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  } else if (process.platform === 'win32') {
    dir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Local',
    );
  } else {
    dir = path.join(os.homedir(), '.config', 'Local');
  }
  return path.join(dir, 'nexus-ai-mcp-connection-info.json');
}

export function loadMcpConnectionInfo(): McpConnectionInfo | null {
  try {
    return JSON.parse(fs.readFileSync(getConnectionInfoPath(), 'utf-8'));
  } catch {
    return null;
  }
}

let _rpcId = 1;

export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  options?: { timeout?: number },
): Promise<{ text: string; isError: boolean }> {
  const info = loadMcpConnectionInfo();
  if (!info) {
    throw new McpUnavailableError('Nexus AI MCP server connection info not found');
  }

  const id = _rpcId++;
  const body = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  // Short default: if MCP is up it responds in ms. 3s is generous — don't make
  // users wait 30s before falling through to GraphQL when server is unreachable.
  const timeout = options?.timeout ?? 3000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(`${info.url}/mcp/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${info.authToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`MCP server error: HTTP ${response.status}`);
  }

  const rpc = (await response.json()) as {
    error?: { message: string };
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
  };

  if (rpc.error) {
    throw new Error(rpc.error.message);
  }

  const result = rpc.result!;
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { text, isError: result.isError ?? false };
}

/**
 * Translate a CLI target string to MCP tool arguments.
 *
 *   jppblank@local           → { site: 'jppblank' }
 *   wpe:install-name         → { install_name: 'install-name' }
 *   name@production          → { install_name: 'name' }
 *   bare-name                → { site: 'bare-name' }
 */
export function targetToMcpArgs(target: string): Record<string, string> {
  if (target.endsWith('@local')) {
    return { site: target.slice(0, -'@local'.length) };
  }
  if (target.startsWith('wpe:')) {
    // wpe:account/install@env — extract just the install name
    const installPart = target.slice('wpe:'.length).split('@')[0].split('/').pop() ?? target;
    return { install_name: installPart };
  }
  const envMatch = target.match(/^(.+?)@(production|staging|development)$/);
  if (envMatch) {
    return { install_name: envMatch[1] };
  }
  // Bare name: pass as install_name so WPE resolution is attempted.
  // The MCP tool resolveTarget() will also check local sites if install_name
  // doesn't match a WPE install, so this works for both local and WPE bare names.
  return { install_name: target };
}
