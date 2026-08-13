/**
 * Parse the NEXUS_TELEMETRY environment variable into an explicit override.
 *
 * Returns:
 *   - `false`     → the user opted out
 *   - `true`      → the user opted in
 *   - `undefined` → not set / unrecognized: the caller should fall through to
 *                   its CI check and the on-disk config.
 *
 * Historically only `'0'` and `'1'` were honored, so `NEXUS_TELEMETRY=false`
 * (the spelling most people reach for) was a silent no-op that left telemetry
 * ON. Accept the common truthy/falsey spellings, case-insensitively. Anything
 * unrecognized returns `undefined` rather than guessing — an unknown value must
 * never be read as consent.
 *
 * Shared by the main process (`telemetry/telemetry-config.ts`) and the CLI
 * (`cli/utils/telemetry.ts`), which live in separate bundles; the CLI already
 * imports from `src/common`, so a single helper keeps the two parsers from
 * drifting the way they had (both hand-rolled `=== '0'` / `=== '1'`).
 */
export function parseTelemetryEnvFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '') return undefined;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(v)) return false;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(v)) return true;
  return undefined;
}
