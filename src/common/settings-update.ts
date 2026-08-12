/**
 * Shared settings-update chokepoint.
 *
 * Before this existed, three writers set Nexus settings with divergent (or absent) validation:
 *   - the MCP tool `nexus_update_settings` (mcp/modules/nexus-settings.ts) — no validation,
 *   - the GraphQL resolver `nexusUpdateSettings` (graphql/resolvers.ts) — no validation,
 *   - the IPC handler (ipc-handlers.ts) — the only one that validated.
 * The two unvalidated paths are reachable by a model: the MCP tool from the in-app chat/agent
 * model directly, and the GraphQL resolver from the `nexus settings set` CLI (any AI with shell
 * access). Either could deep-merge `remoteOperationPermissions.delete.production = true` and turn
 * off the production write-gate. This module is the single validated entry point every writer
 * now routes through — "one router, one policy" for settings.
 *
 * Two protections:
 *   1. Schema validation — the change is validated against UpdateSettingsSchema (strict), so
 *      unknown keys and wrong-typed values are rejected on every path, not just the IPC one.
 *   2. Permission-key gating — the security-critical keys that make up the remote write-gate are
 *      writable ONLY when the caller passes `allowPermissionKeys: true`. Only the human Settings
 *      UI (IPC) passes it; the MCP and GraphQL/CLI paths do not. This mirrors the repo's
 *      TRUST_EXTERNAL_HOST_KEY boundary: a shared-token GraphQL/CLI path is not a real trust
 *      boundary, so the gate that governs production writes is not settable from it.
 */

import { UpdateSettingsSchema } from './schemas';

/**
 * Top-level settings keys that define the remote operation write-gate (and per-site overrides
 * of it). Changing any of these can loosen what may be written to a production install, so they
 * are settable only through the human Settings UI (IPC), never a model/AI-reachable surface.
 * `wpeAllowedEnvironments` is legacy/dead but permission-shaped, so it is fenced too.
 */
export const PERMISSION_CRITICAL_KEYS: ReadonlySet<string> = new Set([
  'remoteOperationPermissions',
  'wpeOperationPermissions',
  'remoteSiteExceptions',
  'wpeSiteExceptions',
  'wpeAllowedEnvironments',
]);

export interface SettingsUpdateInput {
  /** Dotted-path key to set (e.g. "autoIndex" or "wpeSyncIntervalHours"). Pair with `value`. */
  key?: string;
  /** Raw string value for `key`; parsed as JSON (true/false/number/object) or kept as string. */
  value?: string;
  /** JSON object string to merge into settings (each top-level key deep-merged, not replaced). */
  patch?: string;
}

export interface SettingsUpdateOptions {
  /**
   * True only for the trusted human Settings UI (IPC). When false, any attempt to change a
   * PERMISSION_CRITICAL_KEYS entry is refused.
   */
  allowPermissionKeys: boolean;
}

export type SettingsUpdateResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse a raw string value to a JS primitive/object, matching the historical CLI/MCP behavior. */
export function parseSettingValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  try { return JSON.parse(raw); } catch { /* fall through to string */ }
  return raw;
}

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

/**
 * Apply a settings change to `current`, returning the merged settings or a validation error.
 * Pure: does not read or write storage. Callers persist `result.settings` on `ok: true`.
 */
export function applySettingsUpdate(
  current: Record<string, unknown>,
  input: SettingsUpdateInput,
  opts: SettingsUpdateOptions,
): SettingsUpdateResult {
  const { key, value, patch } = input;

  if (!key && !patch) {
    return { ok: false, error: 'Provide either key+value to set a specific field, or patch with a JSON object to merge.' };
  }

  let merged: Record<string, any> = { ...current };
  let changedTopKeys: string[];

  if (patch) {
    let patchObj: Record<string, any>;
    try {
      patchObj = JSON.parse(patch);
    } catch {
      return { ok: false, error: `patch is not valid JSON: ${patch}` };
    }
    if (patchObj === null || typeof patchObj !== 'object' || Array.isArray(patchObj)) {
      return { ok: false, error: 'patch must be a JSON object.' };
    }
    changedTopKeys = Object.keys(patchObj);
    for (const [k, v] of Object.entries(patchObj)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
          merged[k] !== null && typeof merged[k] === 'object' && !Array.isArray(merged[k])) {
        merged = { ...merged, [k]: { ...merged[k], ...v } };
      } else {
        merged = { ...merged, [k]: v };
      }
    }
  } else {
    // key mode
    if (value === undefined) {
      return { ok: false, error: 'Provide value= when using key=.' };
    }
    const topKey = key!.split('.')[0];
    changedTopKeys = [topKey];
    merged = setByPath(merged, key!, parseSettingValue(value));
  }

  // Permission-key gate — refuse any change to a write-gate key unless the caller is trusted.
  if (!opts.allowPermissionKeys) {
    const blocked = changedTopKeys.find(k => PERMISSION_CRITICAL_KEYS.has(k));
    if (blocked) {
      return {
        ok: false,
        error: `Refusing to change permission-gate setting "${blocked}" from this surface. ` +
          `Remote operation permissions and site exceptions are settable only from the Nexus AI ` +
          `Settings UI (Remote Access & Permissions), not from an MCP/agent tool or the CLI.`,
      };
    }
  }

  // Schema validation — validate only the changed top-level keys against the strict schema, so
  // pre-existing legacy keys already in `current` do not cause a false rejection, but any new
  // unknown key or wrong-typed value in this change is rejected.
  const delta: Record<string, unknown> = {};
  for (const k of changedTopKeys) delta[k] = merged[k];
  const parsed = UpdateSettingsSchema.safeParse(delta);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.join('.') || changedTopKeys.join(', ');
    return { ok: false, error: `Invalid settings update at "${path}": ${first?.message ?? 'validation failed'}` };
  }

  return { ok: true, settings: merged };
}
