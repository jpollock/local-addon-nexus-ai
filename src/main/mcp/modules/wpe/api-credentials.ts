/**
 * WP Engine API Credentials Management
 *
 * Allows users to store WP Engine API credentials (username/password) for basic auth.
 * This is required for backup creation, as the backup endpoint doesn't support OAuth.
 */

import { McpToolHandler, McpToolResult, NexusServices } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// ---------------------------------------------------------------------------
// wpe_set_api_credentials
// ---------------------------------------------------------------------------

export const setApiCredentialsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_set_api_credentials',
    description: 'Store WP Engine API credentials for basic authentication. Required for backup creation since the backup endpoint does not support OAuth. Credentials are stored encrypted.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'WP Engine API username (found in WP Engine User Portal)'
        },
        password: {
          type: 'string',
          description: 'WP Engine API password'
        },
      },
      required: ['username', 'password'],
    },
    isAvailable: (_services: NexusServices) => true,
  },

  async execute(args, services: NexusServices): Promise<McpToolResult> {
    try {
      const username = args.username as string;
      const password = args.password as string;

      if (!username || !password) {
        return error('Both username and password are required.');
      }

      await services.localServices!.wpeSetApiCredentials(username, password);

      return ok(
        '✅ WP Engine API credentials stored securely.\n\n' +
        'Backup creation will now use basic authentication.\n' +
        'To disable: run wpe_clear_api_credentials'
      );
    } catch (err: any) {
      return error(`Failed to store credentials: ${err.message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// wpe_clear_api_credentials
// ---------------------------------------------------------------------------

export const clearApiCredentialsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_clear_api_credentials',
    description: 'Remove stored WP Engine API credentials. After clearing, backup creation will attempt to use OAuth (which will fail).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (_services: NexusServices) => true,
  },

  async execute(_args, services: NexusServices): Promise<McpToolResult> {
    try {
      await services.localServices!.wpeClearApiCredentials();

      return ok(
        '✅ WP Engine API credentials cleared.\n\n' +
        'Backup creation will no longer work (OAuth not supported by WP Engine).\n' +
        'To re-enable: run wpe_set_api_credentials'
      );
    } catch (err: any) {
      return error(`Failed to clear credentials: ${err.message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// wpe_credentials_status
// ---------------------------------------------------------------------------

export const credentialsStatusHandler: McpToolHandler = {
  definition: {
    name: 'wpe_credentials_status',
    description: 'Check if WP Engine API credentials are configured for basic authentication.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (_services: NexusServices) => true,
  },

  async execute(_args, services: NexusServices): Promise<McpToolResult> {
    try {
      const status = await services.localServices!.wpeGetApiCredentialsStatus();

      if (status.configured) {
        return ok(
          '✅ WP Engine API credentials are configured.\n\n' +
          `Username: ${status.username}\n` +
          'Backup creation will use basic authentication.\n\n' +
          'To update: run wpe_set_api_credentials\n' +
          'To remove: run wpe_clear_api_credentials'
        );
      } else {
        return ok(
          '❌ WP Engine API credentials are NOT configured.\n\n' +
          'Backup creation will fail (OAuth not supported by WP Engine).\n\n' +
          'To enable backup creation:\n' +
          '1. Get your API credentials from https://my.wpengine.com\n' +
          '2. Run: wpe_set_api_credentials'
        );
      }
    } catch (err: any) {
      return error(`Failed to check credentials status: ${err.message}`);
    }
  },
};
