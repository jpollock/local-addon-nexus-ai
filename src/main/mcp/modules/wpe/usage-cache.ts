/**
 * In-memory cache for WPE usage API responses.
 *
 * TTL strategy:
 *   - Current month  → 1 hour  (data trickles in throughout the day)
 *   - Past months    → 24 hours (data is immutable; TTL just bounds memory)
 *
 * The cache lives in the main process, so it is shared by both the MCP tools
 * and the GraphQL resolvers that back CLI commands.
 */

interface CacheEntry {
  data: unknown;
  cachedAt: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const CURRENT_MONTH_TTL_MS = 60 * 60 * 1000;   // 1 hour
const PAST_MONTH_TTL_MS    = 24 * 60 * 60 * 1000; // 24 hours

export function makeUsageCacheKey(
  type: 'install' | 'account',
  id: string,
  firstDate: string,
  lastDate: string,
): string {
  return `${type}:${id}:${firstDate}:${lastDate}`;
}

export function getUsageCached(key: string): { data: unknown; cachedAt: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, cachedAt: entry.cachedAt };
}

export function setUsageCached(
  key: string,
  data: unknown,
  isCurrentMonth: boolean,
): void {
  const ttl = isCurrentMonth ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS;
  cache.set(key, { data, cachedAt: Date.now(), expiresAt: Date.now() + ttl });
}

/**
 * Returns true when the given date range overlaps the current calendar month.
 * Used to decide which TTL to apply.
 */
export function isCurrentMonthRange(firstDate: string, lastDate: string): boolean {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return firstDate.startsWith(prefix) || lastDate.startsWith(prefix);
}

/**
 * Build first_date / last_date strings for the target month.
 * monthOffset 0 = current month, 1 = last month, etc.
 */
export function buildDateRange(monthOffset: number): { firstDate: string; lastDate: string } {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const firstDate = target.toISOString().split('T')[0];
  const lastDate = new Date(target.getFullYear(), target.getMonth() + 1, 0)
    .toISOString()
    .split('T')[0];
  return { firstDate, lastDate };
}
