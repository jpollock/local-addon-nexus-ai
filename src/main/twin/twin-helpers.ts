import type { IndexEntry } from '../../common/types';
import type { SiteDigitalTwin } from './SiteDigitalTwin';

// ---------------------------------------------------------------------------
// Staleness thresholds
// ---------------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function formatAge(ageMs: number): string {
  const hours = Math.floor(ageMs / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ageMs / DAY_MS);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Returns a staleness warning string for an IndexEntry, or null if < 1h old
 * and not in error/stale state.
 *
 * Thresholds:
 *   < 1h          → null (silent)
 *   1–24h         → inline note
 *   > 24h         → ⚠️ warning + reindex suggestion
 *   > 7d or stale → ❌ very stale warning
 *   error state   → ❌ error message
 */
export function indexFreshnessWarning(indexEntry: IndexEntry): string | null {
  if (indexEntry.state === 'error') {
    return '❌ Index is in error state — results may be incomplete. Run `reindex_site` to fix.';
  }

  const ageMs = Date.now() - indexEntry.lastIndexed;

  if (ageMs > WEEK_MS || indexEntry.state === 'stale') {
    return `❌ Index is very stale (${formatAge(ageMs)}) — content may be significantly out of date. Run \`reindex_site\` to refresh.`;
  }

  if (ageMs > DAY_MS) {
    return `⚠️ Index data is stale (${formatAge(ageMs)}) — results may not reflect recent changes. Run \`reindex_site\` to refresh.`;
  }

  if (ageMs > HOUR_MS) {
    return `Index last updated ${formatAge(ageMs)}.`;
  }

  return null;
}

/**
 * Returns a staleness warning string for a SiteDigitalTwin, or null if < 1h
 * old. Uses twin.asOf (the oldest populated field timestamp).
 *
 * Thresholds match indexFreshnessWarning.
 */
export function twinFreshnessWarning(twin: SiteDigitalTwin): string | null {
  if (twin.asOf === null) {
    return '❌ No twin data available — run `nexus_site_refresh` to populate.';
  }

  const ageMs = Date.now() - twin.asOf;

  if (ageMs > WEEK_MS) {
    return `❌ Twin data is very stale (${formatAge(ageMs)}) — run \`nexus_site_refresh\` to update.`;
  }

  if (ageMs > DAY_MS) {
    return `⚠️ Twin data is stale (${formatAge(ageMs)}) — results may not reflect recent changes. Run \`nexus_site_refresh\` to refresh.`;
  }

  if (ageMs > HOUR_MS) {
    return `Twin data from ${formatAge(ageMs)}.`;
  }

  return null;
}

/**
 * Builds a parenthetical data-source annotation for a result line.
 *
 *   source — where the data came from: 'live', 'twin', 'index', 'cache', etc.
 *   ageMs  — how old the data is in milliseconds (0 for live)
 *
 * Examples:
 *   dataSourceLine('live', 0)        → '(live ✅)'
 *   dataSourceLine('twin', 2h)       → '(twin: 2h ago)'
 *   dataSourceLine('twin', 25h)      → '(twin: ⚠️ 1d ago)'
 *   dataSourceLine('index', 8d)      → '(index: ❌ 8d ago)'
 */
export function dataSourceLine(source: string, ageMs: number): string {
  if (source === 'live' && ageMs === 0) {
    return '(live ✅)';
  }

  if (ageMs > WEEK_MS) {
    return `(${source}: ❌ ${formatAge(ageMs)})`;
  }

  if (ageMs > DAY_MS) {
    return `(${source}: ⚠️ ${formatAge(ageMs)})`;
  }

  if (ageMs > HOUR_MS) {
    return `(${source}: ${formatAge(ageMs)})`;
  }

  if (ageMs === 0) {
    return `(${source} ✅)`;
  }

  return `(${source}: <1h ago ✅)`;
}

/**
 * Returns a staleness warning for the stalest entry in a collection, or null
 * if all entries are fresh (or the list is empty).
 */
export function fleetFreshnessWarning(entries: (IndexEntry | null)[]): string | null {
  const valid = entries.filter((e): e is IndexEntry => !!e && !!e.lastIndexed);
  if (valid.length === 0) return null;

  const stalest = valid.reduce((oldest, e) =>
    e.lastIndexed < oldest.lastIndexed ? e : oldest,
  );
  return indexFreshnessWarning(stalest);
}
