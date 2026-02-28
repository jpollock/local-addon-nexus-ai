import { SiteDataAccessor, LocalSiteInfo } from './types';

/**
 * Resolves a user-provided site reference (name, ID, or domain) to a site.
 *
 * Resolution order:
 *   1. Exact site ID match
 *   2. Exact name match (case-insensitive)
 *   3. Partial name match (substring, case-insensitive)
 *   4. Domain match (case-insensitive)
 */
export function resolveSite(
  query: string,
  siteData: SiteDataAccessor,
): LocalSiteInfo | null {
  if (!query) return null;

  // 1. Exact ID match
  const byId = siteData.getSite(query);
  if (byId) return byId;

  const sites = Object.values(siteData.getSites());
  const q = query.toLowerCase();

  // 2. Exact name match
  const byName = sites.find((s) => s.name.toLowerCase() === q);
  if (byName) return byName;

  // 3. Partial name match
  const partial = sites.find((s) => s.name.toLowerCase().includes(q));
  if (partial) return partial;

  // 4. Domain match
  const byDomain = sites.find((s) => s.domain?.toLowerCase() === q);
  if (byDomain) return byDomain;

  return null;
}
