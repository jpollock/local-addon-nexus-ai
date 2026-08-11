/**
 * Local-timezone date in YYYY-MM-DD format, for display.
 *
 * Mirrors `localDay` in `src/main/logging/eventLog.ts`. The two are separate because main and
 * renderer do not share a bundle. Both carry the same guard: `en-CA` does not render YYYY-MM-DD
 * on a runtime built without full ICU, and an invalid Date yields the literal "Invalid Date".
 * The regex check defends against both, falling back to date components.
 */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * The log's day boundary, in the reader's own timezone.
 *
 * `en-CA` renders `YYYY-MM-DD`. The regex guard is not decoration: on a runtime built without
 * full ICU the locale falls back to `en-US` and yields `8/9/2026`, whose `/` is a path
 * separator, and an invalid Date yields the literal `Invalid Date`, whose space would land in a
 * filename. Both fall back to local date components, and an unusable clock to `unknown`.
 */
export function localDay(at: Date): string {
  if (!Number.isFinite(at.getTime())) return 'unknown';
  const day = at.toLocaleDateString('en-CA');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
