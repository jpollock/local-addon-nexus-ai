/**
 * Simple version comparison utilities for WordPress ecosystem versions.
 * Splits on '.', compares segments numerically. No full semver (pre-release tags
 * are rare in WP/PHP).
 */

/** Parse version string into numeric segments. Non-numeric parts become 0. */
function parseSegments(version: string): number[] {
  return version.split('.').map((s) => {
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  });
}

/**
 * Compare two version strings.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const segsA = parseSegments(a);
  const segsB = parseSegments(b);
  const len = Math.max(segsA.length, segsB.length);

  for (let i = 0; i < len; i++) {
    const va = segsA[i] ?? 0;
    const vb = segsB[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Returns true if `version` is older (lower) than `reference`. */
export function isOlderThan(version: string, reference: string): boolean {
  return compareVersions(version, reference) < 0;
}

/** Group items by their version string. Entries sorted newest-first. */
export function groupByVersion<T>(
  items: T[],
  getVersion: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const v = getVersion(item);
    const list = map.get(v);
    if (list) {
      list.push(item);
    } else {
      map.set(v, [item]);
    }
  }

  // Sort keys newest-first
  const sorted = new Map<string, T[]>();
  const keys = Array.from(map.keys()).sort((a, b) => compareVersions(b, a));
  for (const k of keys) {
    sorted.set(k, map.get(k)!);
  }
  return sorted;
}
