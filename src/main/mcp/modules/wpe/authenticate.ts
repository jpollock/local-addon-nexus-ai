/**
 * WPE Authentication MCP Tools
 *
 * Calls Local's built-in GraphQL server (not our addon's GraphQL) to trigger
 * the WPE OAuth flow — same approach used by local-addon-cli-mcp.
 * The graphql-connection-info.json file provides the URL and auth token.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { NexusServices, McpToolResult } from '../../types';

// ---------------------------------------------------------------------------
// Local GraphQL helper
// ---------------------------------------------------------------------------

interface LocalGqlInfo {
  url: string;
  authToken: string;
}

function getLocalGqlInfo(): LocalGqlInfo | null {
  const dataDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'Local')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'graphql-connection-info.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function localGql<T>(query: string, timeoutMs = 120000): Promise<T> {
  const info = getLocalGqlInfo();
  if (!info) throw new Error('Cannot connect to Local. Is Local running?');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${info.authToken}`,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    const json = await res.json() as { data?: T; errors?: any[] };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// wpe_status
// ---------------------------------------------------------------------------

export const wpeStatusHandler = {
  definition: {
    name: 'wpe_status',
    description: 'Check WP Engine authentication status. Returns whether the user is authenticated and their email address.',
    inputSchema: { type: 'object' as const, properties: {} },
    isAvailable: (_services: NexusServices) => true,
  },
  async execute(_args: unknown, _services: NexusServices): Promise<McpToolResult> {
    try {
      const data = await localGql<{
        wpeStatus: { authenticated: boolean; email?: string; accountId?: string; accountName?: string };
      }>('query { wpeStatus { authenticated email accountId accountName } }', 10000);

      const { authenticated, email, accountName } = data.wpeStatus;
      if (authenticated && email) {
        const name = accountName || null;
        return {
          content: [{
            type: 'text',
            text: `✅ Authenticated with WP Engine${name ? ` (${name})` : ''} as ${email}`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: '⚫ Not authenticated with WP Engine. Use wpe_login to connect.',
        }],
      };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error checking WPE status: ${err.message}` }], isError: true };
    }
  },
};

// ---------------------------------------------------------------------------
// wpe_login
// ---------------------------------------------------------------------------

export const wpeLoginHandler = {
  definition: {
    name: 'wpe_login',
    description: 'Authenticate with WP Engine. Opens a browser window for OAuth login. The user must complete the login in their browser. This may take up to 2 minutes.',
    inputSchema: { type: 'object' as const, properties: {} },
    isAvailable: (_services: NexusServices) => true,
  },
  async execute(_args: unknown, _services: NexusServices): Promise<McpToolResult> {
    try {
      const data = await localGql<{
        wpeAuthenticate: { success: boolean; email: string; message: string; error: string | null };
      }>('mutation { wpeAuthenticate { success email message error } }', 120000);

      const { success, email, error } = data.wpeAuthenticate;
      if (!success) {
        return {
          content: [{ type: 'text', text: `❌ WPE authentication failed: ${error || 'Unknown error'}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `✅ Authenticated with WP Engine as ${email}` }],
      };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error during WPE login: ${err.message}` }], isError: true };
    }
  },
};

// ---------------------------------------------------------------------------
// wpe_logout
// ---------------------------------------------------------------------------

export const wpeLogoutHandler = {
  definition: {
    name: 'wpe_logout',
    description: 'Log out of WP Engine.',
    inputSchema: { type: 'object' as const, properties: {} },
    isAvailable: (_services: NexusServices) => true,
  },
  async execute(_args: unknown, _services: NexusServices): Promise<McpToolResult> {
    try {
      const data = await localGql<{
        wpeLogout: { success: boolean; error: string | null };
      }>('mutation { wpeLogout { success error } }', 10000);

      if (!data.wpeLogout.success) {
        return {
          content: [{ type: 'text', text: `❌ WPE logout failed: ${data.wpeLogout.error || 'Unknown error'}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: '✅ Logged out of WP Engine' }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error during WPE logout: ${err.message}` }], isError: true };
    }
  },
};
