/**
 * REST API route: plugins
 *
 * GET /api/v1/fleet/plugins?minSites=N&search=...  — all plugins across fleet
 */

import type { NexusServices } from '../../types/nexus-services';

export interface PluginEntry {
  slug: string;
  title: string | null;
  activeOnCount: number;
  installedOnCount: number;
  activeSites: string[];
}

export async function handleFleetPlugins(
  minSites: number,
  search: string | undefined,
  services: NexusServices,
): Promise<{ data: PluginEntry[]; sitesWithFullData: number; totalSites: number }> {
  const { twinService } = services;

  if (!twinService) {
    return { data: [], sitesWithFullData: 0, totalSites: 0 };
  }

  const twins = twinService.getAll() ?? [];

  const pluginMap = new Map<string, PluginEntry>();

  for (const twin of twins) {
    // Process plugins with status metadata
    if (twin.plugins?.length) {
      for (const plugin of twin.plugins) {
        const slug = plugin.name as string;
        if (!pluginMap.has(slug)) {
          pluginMap.set(slug, {
            slug,
            title: plugin.title ?? null,
            activeOnCount: 0,
            installedOnCount: 0,
            activeSites: [],
          });
        }
        const entry = pluginMap.get(slug)!;
        if (plugin.title && !entry.title) entry.title = plugin.title;
        entry.installedOnCount++;
        if (plugin.status === 'active') {
          entry.activeOnCount++;
          if (!entry.activeSites.includes(twin.siteName)) {
            entry.activeSites.push(twin.siteName);
          }
        }
      }
    }

    // Filesystem-only installed plugins
    if (twin.installedPlugins?.length) {
      for (const slug of twin.installedPlugins as string[]) {
        if (!twin.plugins?.some((p: any) => p.name === slug)) {
          if (!pluginMap.has(slug)) {
            pluginMap.set(slug, { slug, title: null, activeOnCount: 0, installedOnCount: 0, activeSites: [] });
          }
          pluginMap.get(slug)!.installedOnCount++;
        }
      }
    }
  }

  let plugins = Array.from(pluginMap.values());

  // Apply search filter
  if (search) {
    const q = search.toLowerCase();
    plugins = plugins.filter(
      (p) => p.slug.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q),
    );
  }

  // Apply minSites filter
  plugins = plugins.filter((p) => p.activeOnCount >= minSites);

  // Sort by activeOnCount desc
  plugins.sort((a, b) => b.activeOnCount - a.activeOnCount);

  const sitesWithFullData = twins.filter(
    (t: any) => t.completeness === 'metadata' || t.completeness === 'indexed',
  ).length;

  return { data: plugins, sitesWithFullData, totalSites: twins.length };
}
