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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSettings(services: any): NexusSettings {
  return ((services.registryStorage?.get(STORAGE_KEYS.SETTINGS)) ?? {}) as NexusSettings;
}

function writeSettings(services: any, settings: NexusSettings): void {
  services.registryStorage?.set(STORAGE_KEYS.SETTINGS, settings);
}

/** Set a value at a dotted key path on an object (immutably). */
function setByPath(obj: Record<string, any>, path: string, value: unknown): Record<string, any> {
  const keys = path.split('.');
  const result = { ...obj };
  let cur: Record<string, any> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] !== null && typeof cur[keys[i]] === 'object'
      ? { ...cur[keys[i]] }
      : {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return result;
}

/** Get a value at a dotted key path. Returns undefined if path doesn't exist. */
function getByPath(obj: Record<string, any>, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => acc?.[key], obj);
}

/** Parse a CLI string value to a JS primitive. */
function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  try { return JSON.parse(raw); } catch { /* fallthrough */ }
  return raw;
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
      '  key + value: set a single dotted-path field, e.g. key="wpeOperationPermissions.wpcli.production" value="false"',
      '  patch: merge a JSON object into the current settings, e.g. patch=\'{"wpeOperationPermissions":{"push":{"production":true}}}\'',
      'Values are parsed as JSON (booleans, numbers, objects) or treated as strings.',
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
    const key = args.key as string | undefined;
    const rawValue = args.value as string | undefined;
    const patchStr = args.patch as string | undefined;

    if (!key && !patchStr) {
      return err('Provide either key+value to set a specific field, or patch with a JSON object to merge.');
    }

    let current = readSettings(services) as Record<string, any>;

    if (patchStr) {
      let patch: Record<string, any>;
      try { patch = JSON.parse(patchStr); } catch {
        return err(`patch is not valid JSON: ${patchStr}`);
      }
      // Deep merge at top level (each top-level key is merged, not replaced)
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
            current[k] !== null && typeof current[k] === 'object' && !Array.isArray(current[k])) {
          current = { ...current, [k]: { ...current[k], ...v } };
        } else {
          current = { ...current, [k]: v };
        }
      }
    } else if (key) {
      if (rawValue === undefined) {
        return err('Provide value= when using key=.');
      }
      const parsed = parseValue(rawValue);
      current = setByPath(current, key, parsed) as Record<string, any>;
    }

    writeSettings(services, current as NexusSettings);
    return ok(JSON.stringify({ success: true, settings: current }, null, 2));
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNexusSettingsTools(registry: ToolRegistry): void {
  registry.register(getSettingsTool);
  registry.register(updateSettingsTool);
}
