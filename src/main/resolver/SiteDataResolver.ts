import type { DataProvenance, ResolvedData, ResolvedPluginInfo } from '../../common/types';
import { WordPressOrgClient } from './WordPressOrgClient';
import * as fs from 'fs';
import * as path from 'path';

interface SiteDataResolverDeps {
  siteData: { getSites(): Record<string, any> };
  localServices: {
    getAllSiteStatuses(): Record<string, string>;
    getPlugins(siteId: string): Promise<any[]>;
    wpCliRun(siteId: string, args: string[]): Promise<{ success: boolean; stdout?: string }>;
  } | null;
  metadataCache: { get(siteId: string): any | null } | null;
  indexRegistry: { get(siteId: string): any | null } | null;
}

export class SiteDataResolver {
  constructor(private deps: SiteDataResolverDeps) {}

  async getPlugins(siteId: string): Promise<ResolvedData<ResolvedPluginInfo[]>> {
    const statuses = this.deps.localServices?.getAllSiteStatuses?.() ?? {};

    if (statuses[siteId] === 'running' && this.deps.localServices) {
      try {
        const raw = await this.deps.localServices.getPlugins(siteId);
        return {
          data: raw.map(p => ({
            name: p.name ?? p.title ?? '',
            slug: p.name ?? '',
            version: p.version ?? 'unknown',
            status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
          })),
          provenance: { level: 'live', source: 'WP-CLI', ageSeconds: 0, caveat: null },
        };
      } catch { /* fall through */ }
    }

    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.plugins?.length > 0) {
      const ageSeconds = meta.lastUpdated ? Math.floor((Date.now() - meta.lastUpdated) / 1000) : null;
      return {
        data: meta.plugins.map((p: any) => ({
          name: p.title ?? p.name ?? '',
          slug: p.name ?? '',
          version: p.version ?? 'unknown',
          status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
        })),
        provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds, caveat: 'Start site for real-time plugin data' },
      };
    }

    const entry = this.deps.indexRegistry?.get?.(siteId);
    if (entry?.structure?.plugins?.length > 0) {
      const ageSeconds = entry.lastIndexed ? Math.floor((Date.now() - entry.lastIndexed) / 1000) : null;
      return {
        data: entry.structure.plugins.map((p: any) => ({
          name: p.name ?? '',
          slug: p.slug ?? p.name ?? '',
          version: p.version ?? 'unknown',
          status: (p.isActive ? 'active' : 'inactive') as 'active' | 'inactive',
        })),
        provenance: { level: 'searchable', source: 'IndexRegistry', ageSeconds, caveat: 'Data from last content index. Start site for real-time plugin data.' },
      };
    }

    return {
      data: [],
      provenance: { level: 'scanned', source: 'none', ageSeconds: null, caveat: 'No plugin data available. Start site at least once to populate the data cache.' },
    };
  }

  async getPluginsWithUpdateCheck(siteId: string): Promise<ResolvedData<ResolvedPluginInfo[]>> {
    const statuses = this.deps.localServices?.getAllSiteStatuses?.() ?? {};

    if (statuses[siteId] === 'running' && this.deps.localServices) {
      try {
        const [pluginsResult, updateResult] = await Promise.allSettled([
          this.deps.localServices.getPlugins(siteId),
          this.deps.localServices.wpCliRun(siteId, ['plugin', 'update', '--all', '--dry-run', '--format=json']),
        ]);

        if (pluginsResult.status === 'fulfilled') {
          const updateMap = new Map<string, string>();
          if (updateResult.status === 'fulfilled' && updateResult.value.success) {
            try {
              const updates = JSON.parse(updateResult.value.stdout ?? '[]') as Array<{ name: string; update_version: string }>;
              for (const u of updates) { updateMap.set(u.name, u.update_version); }
            } catch { /* parse failed */ }
          }
          return {
            data: pluginsResult.value.map(p => ({
              name: p.name ?? p.title ?? '',
              slug: p.name ?? '',
              version: p.version ?? 'unknown',
              status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
              updateAvailable: updateMap.get(p.name ?? '') ?? null,
            })),
            provenance: { level: 'live', source: 'WP-CLI', ageSeconds: 0, caveat: null },
          };
        }
      } catch { /* fall through */ }
    }

    const cachedResult = await this.getPlugins(siteId);
    if (cachedResult.data.length === 0) return cachedResult;

    const wpOrgUpdates = await WordPressOrgClient.checkUpdates(
      cachedResult.data.map(p => ({ slug: p.slug, version: p.version })),
    );

    const ageStr = this.formatAge(cachedResult.provenance.ageSeconds);
    return {
      data: cachedResult.data.map(p => ({
        ...p,
        updateAvailable: wpOrgUpdates.get(p.slug) ?? null,
      })),
      provenance: {
        ...cachedResult.provenance,
        source: `${cachedResult.provenance.source} + WordPress.org API`,
        caveat: `Plugin list from cache (${ageStr}). Update availability checked live via WordPress.org. Start site to apply updates.`,
      },
    };
  }

  async getWpVersion(siteId: string): Promise<ResolvedData<string | null>> {
    const site = this.deps.siteData.getSites()[siteId] as any;

    if (site?.path) {
      const versionFile = path.join(site.path, 'app', 'public', 'wp-includes', 'version.php');
      try {
        const content = fs.readFileSync(versionFile, 'utf8');
        const match = content.match(/\$wp_version\s*=\s*'([^']+)'/);
        if (match) {
          return { data: match[1], provenance: { level: 'scanned', source: 'wp-includes/version.php', ageSeconds: 0, caveat: null } };
        }
      } catch { /* file not accessible */ }
    }

    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.wpVersion) {
      const ageSeconds = meta.lastUpdated ? Math.floor((Date.now() - meta.lastUpdated) / 1000) : null;
      return { data: meta.wpVersion, provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds, caveat: null } };
    }

    return { data: null, provenance: { level: 'scanned', source: 'none', ageSeconds: null, caveat: 'Start site once to cache WordPress version' } };
  }

  async getPhpVersion(siteId: string): Promise<ResolvedData<string | null>> {
    const site = this.deps.siteData.getSites()[siteId] as any;

    const phpFromSite = site?.phpVersion ?? site?.php?.version ?? null;
    if (phpFromSite) {
      return { data: phpFromSite, provenance: { level: 'scanned', source: 'Local site config', ageSeconds: 0, caveat: null } };
    }

    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.phpVersion) {
      const ageSeconds = meta.lastUpdated ? Math.floor((Date.now() - meta.lastUpdated) / 1000) : null;
      return { data: meta.phpVersion, provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds, caveat: null } };
    }

    return { data: null, provenance: { level: 'scanned', source: 'none', ageSeconds: null, caveat: null } };
  }

  static fromServices(services: any): SiteDataResolver {
    return new SiteDataResolver({
      siteData: services.siteData,
      localServices: services.localServices ?? null,
      metadataCache: services.metadataCache ?? null,
      indexRegistry: services.indexRegistry ?? null,
    });
  }

  formatAge(ageSeconds: number | null): string {
    if (ageSeconds === null) return 'unknown age';
    if (ageSeconds < 5)  return 'just now';
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
    if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
    return `${Math.floor(ageSeconds / 86400)}d ago`;
  }

  static levelEmoji(level: DataProvenance['level']): string {
    return ({ live: '🟢', configured: '🟡', searchable: '🔵', 'external-api': '🌐', scanned: '⚪' } as Record<string, string>)[level] ?? '⚪';
  }
}
