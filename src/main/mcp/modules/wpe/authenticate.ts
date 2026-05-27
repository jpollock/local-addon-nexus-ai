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
    description: 'Check whether the current WP Engine OAuth session is valid. Validates the token against the live API — returns authenticated user details if valid, or an error if the session has expired. Run this before any wpe_* operation if you are unsure whether auth is current. Re-authenticate with wpe_login if this returns an error.',
    inputSchema: { type: 'object' as const, properties: {} },
    isAvailable: (_services: NexusServices) => true,
  },
  async execute(_args: unknown, services: NexusServices): Promise<McpToolResult> {
    let gqlEmail: string | null = null;

    // Try Local GraphQL first — the wpeStatus field exists in Local 10+.
    // Older Local builds don't have it; we fall through to the CAPI check.
    try {
      const data = await localGql<{
        wpeStatus: { authenticated: boolean; email?: string; accountId?: string; accountName?: string };
      }>('query { wpeStatus { authenticated email accountId accountName } }', 10000);

      const { authenticated, email } = data.wpeStatus;

      if (!authenticated || !email) {
        return {
          content: [{ type: 'text', text: '⚫ Not authenticated with WP Engine. Call wpe_login to connect.' }],
        };
      }
      gqlEmail = email;
    } catch {
      // wpeStatus field absent (older Local) or timeout — fall back to CAPI below.
    }

    // Validate session is active with a live CAPI call. This works regardless
    // of whether the GraphQL query above succeeded.
    if (!services.localServices) {
      return {
        content: [{ type: 'text', text: '⚫ Local services unavailable. Is Local running?' }],
        isError: true,
      };
    }

    try {
      const accounts = await services.localServices.capiGetAccounts() as any[];
      const count = Array.isArray(accounts) ? accounts.length : 0;
      const suffix = gqlEmail ? ` as ${gqlEmail}` : '';
      return {
        content: [{
          type: 'text',
          text: `✅ Authenticated with WP Engine${suffix}. ${count} account${count !== 1 ? 's' : ''} accessible.`,
        }],
      };
    } catch {
      const suffix = gqlEmail ? ` for ${gqlEmail}` : '';
      return {
        content: [{
          type: 'text',
          text: `⚠️ WP Engine token expired${suffix}. Call wpe_login to re-authenticate.`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// wpe_login
// ---------------------------------------------------------------------------

export const wpeLoginHandler = {
  definition: {
    name: 'wpe_login',
    description: 'Authenticate with WP Engine via OAuth — opens a browser window for the user to log in. The user must complete login in their browser; this tool waits up to 2 minutes. Run wpe_status first to check if already authenticated. After successful login, all wpe_* tools will work. Authentication persists across sessions until the token expires or wpe_logout is called.',
    inputSchema: { type: 'object' as const, properties: {} },
    isAvailable: (_services: NexusServices) => true,
  },
  async execute(_args: unknown, services: NexusServices): Promise<McpToolResult> {
    try {
      // CRITICAL FIX: Use services.localServices.wpeAuthenticate() instead of Local's GraphQL
      // This ensures the SAME wpeOAuth instance that CAPI uses gets the new tokens
      if (!services.localServices) {
        throw new Error('Local services not available');
      }

      const result = await services.localServices.wpeAuthenticate();
      if (!result?.email) {
        return {
          content: [{ type: 'text', text: `❌ WPE authentication failed: No email returned` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: `✅ Authenticated with WP Engine as ${result.email}` }],
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
    description: 'Log out of WP Engine by revoking the current OAuth session. After logout, all wpe_* API calls will fail until wpe_login is called again. Use when switching accounts or when prompted to re-authenticate after a permission change.',
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
