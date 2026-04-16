import { IndexEntry } from '../../common/types';

const WARN_MS = 24 * 60 * 60 * 1000;   // 24 hours
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns a warning line for a single index entry, or empty string if data is fresh.
 *
 * < 24h  → no warning
 * > 24h  → ⚠️ warning with refresh suggestion
 * > 7d   → ❌ very stale warning
 */
export function indexFreshnessWarning(entry: IndexEntry | null): string {
  if (!entry || !entry.lastIndexed) return '';

  const ageMs = Date.now() - entry.lastIndexed;
  if (ageMs < WARN_MS) return '';

  const ageHours = Math.round(ageMs / (60 * 60 * 1000));
  const ageLabel = ageHours >= 48 ? `${Math.round(ageHours / 24)}d` : `${ageHours}h`;

  if (ageMs >= STALE_MS) {
    return `\n> ❌ Index data is ${ageLabel} old — results may be significantly out of date. Run \`reindex_site\` to refresh.`;
  }
  return `\n> ⚠️ Index data is ${ageLabel} old — results may not reflect recent changes. Run \`reindex_site\` to refresh.`;
}

/**
 * Returns a warning for a collection of entries, based on the stalest one.
 * Only warns if at least one entry exceeds the 24h threshold.
 */
export function fleetFreshnessWarning(entries: (IndexEntry | null)[]): string {
  const valid = entries.filter((e): e is IndexEntry => !!e && !!e.lastIndexed);
  if (valid.length === 0) return '';

  const stalest = valid.reduce((oldest, e) =>
    e.lastIndexed < oldest.lastIndexed ? e : oldest,
  );
  return indexFreshnessWarning(stalest);
}
