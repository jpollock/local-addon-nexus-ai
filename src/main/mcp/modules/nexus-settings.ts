/**
 * Nexus Settings MCP Tools
 *
 * Read and update Nexus AI settings from MCP / CLI workflows.
 * Useful for scripting, e2e tests, and CI pipelines that need to configure
 * access control or provider settings without opening the GUI.
 */

import type { McpToolHandler, McpToolResult } from '../types';
import type { ToolRegistry } from '../tool-registry';
import { STORAGE_KEYS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';
import { applySettingsUpdate } from '../../../common/settings-update';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSettings(services: any): NexusSettings {
  return ((services.registryStorage?.get(STORAGE_KEYS.SETTINGS)) ?? {}) as NexusSettings;
}

function writeSettings(services: any, settings: NexusSettings): void {
  services.registryStorage?.set(STORAGE_KEYS.SETTINGS, settings);
}

/** Get a value at a dotted key path. Returns undefined if path doesn't exist. */
function getByPath(obj: Record<string, any>, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => acc?.[key], obj);
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string): McpToolResult {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

// ---------------------------------------------------------------------------
// nexus_get_settings
// ---------------------------------------------------------------------------

const getSettingsTool: McpToolHandler = {
  definition: {
    name: 'nexus_get_settings',
    description: 'Get the current Nexus AI settings. Pass key= (dotted path) to read a specific field, e.g. "wpeOperationPermissions.wpcli.production". Omit key to return all settings.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Dotted-path key to read, e.g. "wpeOperationPermissions.push.production". Omit for all settings.',
        },
      },
      required: [],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const settings = readSettings(services);
    const key = args.key as string | undefined;

    if (key) {
      const value = getByPath(settings as any, key);
      if (value === undefined) {
        return err(`Key "${key}" not found in settings.`);
      }
      return ok(JSON.stringify({ key, value }, null, 2));
    }

    return ok(JSON.stringify(settings, null, 2));
  },
};

// ---------------------------------------------------------------------------
// nexus_update_settings
// ---------------------------------------------------------------------------

const updateSettingsTool: McpToolHandler = {
  definition: {
    name: 'nexus_update_settings',
    description: [
      'Update Nexus AI settings. Two modes:',
      '  key + value: set a single dotted-path field, e.g. key="wpeSyncIntervalHours" value="4"',
      '  patch: merge a JSON object into the current settings, e.g. patch=\'{"autoIndex":true}\'',
      'Values are parsed as JSON (booleans, numbers, objects) or treated as strings.',
      'Unknown keys and wrong-typed values are rejected. Permission-gate settings',
      '(remoteOperationPermissions, wpeOperationPermissions, site exceptions) are NOT settable',
      'from this tool — change them in the Nexus AI Settings UI (Remote Access & Permissions).',
      'Returns the updated settings on success.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Dotted-path key to set, e.g. "wpeOperationPermissions.wpcli.production"',
        },
        value: {
          type: 'string',
          description: 'Value to set. Parsed as JSON (true/false/number/object) or treated as string.',
        },
        patch: {
          type: 'string',
          description: 'JSON object to shallow-merge into settings. Use for updating multiple fields at once.',
        },
      },
      required: [],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    // Route through the shared, validated chokepoint. allowPermissionKeys is false here: this
    // tool is reachable by a prompt-injected chat/agent model, which must never be able to flip
    // the remote write-gate (remoteOperationPermissions / site exceptions). Those are settable
    // only from the human Settings UI (IPC). See src/common/settings-update.ts.
    const current = readSettings(services) as unknown as Record<string, unknown>;
    const result = applySettingsUpdate(
      current,
      {
        key: args.key as string | undefined,
        value: args.value as string | undefined,
        patch: args.patch as string | undefined,
      },
      { allowPermissionKeys: false },
    );

    if (!result.ok) {
      return err(result.error);
    }

    writeSettings(services, result.settings as unknown as NexusSettings);
    return ok(JSON.stringify({ success: true, settings: result.settings }, null, 2));
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNexusSettingsTools(registry: ToolRegistry): void {
  registry.register(getSettingsTool);
  registry.register(updateSettingsTool);
}
