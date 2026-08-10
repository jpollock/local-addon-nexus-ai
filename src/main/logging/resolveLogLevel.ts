import type { LogLevelName } from './eventLog';

const LEVELS: readonly LogLevelName[] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

/**
 * Validate and normalize a level string.
 *
 * Exported so per-agent overrides can route through the same validation the global level gets,
 * ensuring an unrecognised override is ignored rather than honoured as "log everything".
 */
export function asLevel(value: unknown): LogLevelName | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase() as LogLevelName;
  return LEVELS.includes(upper) ? upper : undefined;
}

/**
 * The level the event log writes at.
 *
 * Order: NEXUS_LOG_LEVEL, then the stored setting, then INFO. An unrecognised value at either
 * layer is ignored rather than honoured — a typo in an env var must not silently switch logging
 * off, which is the one failure this system cannot report.
 */
export function resolveLogLevel(
  settings: { logLevel?: string } | undefined,
  env: Record<string, string | undefined>,
): LogLevelName {
  return asLevel(env.NEXUS_LOG_LEVEL) ?? asLevel(settings?.logLevel) ?? 'INFO';
}
