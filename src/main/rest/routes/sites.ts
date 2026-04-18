/**
 * REST API route: sites
 *
 * GET /api/v1/sites         — list all sites (local + WPE) with twin completeness
 * GET /api/v1/sites/:id     — single site detail
 */

import type { NexusServices } from '../../types/nexus-services';

function formatTwinAge(asOf: number | null): string {
  if (asOf === null) return 'unknown';
  const ms = Date.now() - asOf;
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildSiteSummary(twin: any, localSite: any): Record<string, unknown> {
  // Determine status from Local site data if available
  let status = 'unknown';
  if (localSite?.status) {
    status = localSite.status;
  } else if (twin?.source === 'wpe') {
    status = 'remote';
  }

  return {
    id: twin.siteId,
    name: twin.siteName,
    type: twin.source ?? 'local',
    status,
    wpVersion: twin.wpVersion ?? null,
    phpVersion: twin.phpVersion ?? null,
    twinCompleteness: twin.completeness ?? 'none',
    twinAge: formatTwinAge(twin.asOf ?? null),
  };
}

export async function handleSitesList(
  services: NexusServices,
): Promise<{ data: unknown[]; total: number }> {
  const { twinService, siteData } = services;
  const allLocalSites = siteData.getSites();

  if (!twinService) {
    // Fallback: return basic site info without twin data
    const sites = Object.values(allLocalSites).map((s: any) => ({
      id: s.id,
      name: s.name,
      type: 'local',
      status: (s as any).status ?? 'unknown',
      wpVersion: null,
      phpVersion: null,
      twinCompleteness: 'none',
      twinAge: 'unknown',
    }));
    return { data: sites, total: sites.length };
  }

  const twins = twinService.getAll() ?? [];
  const data = twins.map((twin: any) => {
    const localSite = allLocalSites[twin.siteId] as any;
    return buildSiteSummary(twin, localSite);
  });

  return { data, total: data.length };
}

export async function handleSiteDetail(
  siteId: string,
  services: NexusServices,
): Promise<Record<string, unknown> | null> {
  const { twinService, siteData } = services;
  const allLocalSites = siteData.getSites();
  const localSite = allLocalSites[siteId] as any;

  if (!twinService) {
    if (!localSite) return null;
    return {
      id: localSite.id,
      name: localSite.name,
      type: 'local',
      status: localSite.status ?? 'unknown',
      wpVersion: null,
      phpVersion: null,
      twinCompleteness: 'none',
      twinAge: 'unknown',
    };
  }

  const twin = twinService.get(siteId);
  if (!twin) return null;

  return {
    ...buildSiteSummary(twin, localSite),
    siteUrl: twin.siteUrl ?? null,
    adminEmail: twin.adminEmail ?? null,
    activeTheme: twin.activeTheme ?? null,
    mysqlVersion: twin.mysqlVersion ?? null,
    documentCount: twin.documentCount ?? 0,
    chunkCount: twin.chunkCount ?? 0,
    indexState: twin.indexState ?? 'never',
    lastIndexed: twin.lastIndexed ?? null,
    postCount: twin.postCount ?? null,
    activePluginCount: twin.plugins?.filter((p: any) => p.status === 'active').length ?? null,
    installedPluginCount: twin.plugins?.length ?? null,
    wpeInstallId: twin.wpeInstallId ?? null,
    wpeDomain: twin.wpeDomain ?? null,
  };
}
