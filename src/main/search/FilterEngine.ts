/**
 * FilterEngine - Evaluates smart filters across the fleet of WordPress sites.
 *
 * Provides pre-computed filter counts and site matching for the
 * fleet discovery UI (security, maintenance, activity, health categories).
 */

export interface SmartFilter {
  id: string;
  category: 'security' | 'maintenance' | 'activity' | 'health';
  label: string;
  description: string;
  count: number;
  severity: 'info' | 'warning' | 'error';
}

interface FilterEngineDeps {
  graphService: any;
  indexRegistry: any;
  siteDataBridge: any;
}

interface FilterDefinition {
  id: string;
  category: SmartFilter['category'];
  label: string;
  description: string;
  severity: SmartFilter['severity'];
  method: () => Promise<string[]>;
}

export class FilterEngine {
  private graphService: any;
  private indexRegistry: any;
  private siteDataBridge: any;
  private filterDefinitions: FilterDefinition[];

  constructor(deps: FilterEngineDeps) {
    this.graphService = deps.graphService;
    this.indexRegistry = deps.indexRegistry;
    this.siteDataBridge = deps.siteDataBridge;

    this.filterDefinitions = [
      {
        id: 'security-updates',
        category: 'security',
        label: 'Potential Security Updates',
        description: 'Sites with many plugins that may need security updates',
        severity: 'warning',
        method: () => this.filterSecurityUpdates(),
      },
      {
        id: 'outdated-php',
        category: 'security',
        label: 'Outdated PHP',
        description: 'Sites running PHP versions older than 8.0',
        severity: 'error',
        method: () => this.filterOutdatedPHP(),
      },
      {
        id: 'no-ssl',
        category: 'security',
        label: 'No SSL',
        description: 'Sites without HTTPS configured',
        severity: 'warning',
        method: () => this.filterNoSSL(),
      },
      {
        id: 'not-indexed',
        category: 'maintenance',
        label: 'Not Indexed',
        description: 'Sites not indexed or indexed more than 7 days ago',
        severity: 'warning',
        method: () => this.filterNotIndexed(),
      },
      {
        id: 'large-db',
        category: 'maintenance',
        label: 'Large Database',
        description: 'Sites with large databases',
        severity: 'info',
        method: () => this.filterLargeDB(),
      },
      {
        id: 'low-disk',
        category: 'maintenance',
        label: 'Low Disk Space',
        description: 'Sites with low available disk space',
        severity: 'warning',
        method: () => this.filterLowDisk(),
      },
      {
        id: 'no-events',
        category: 'activity',
        label: 'No Recent Activity',
        description: 'Sites with no events in the last 7 days',
        severity: 'warning',
        method: () => this.filterNoEvents(),
      },
      {
        id: 'low-health',
        category: 'health',
        label: 'Low Health Score',
        description: 'Sites with critically low health scores',
        severity: 'error',
        method: () => this.filterLowHealth(),
      },
    ];
  }

  /**
   * Returns all smart filters with their current counts.
   */
  async getFilterCounts(): Promise<SmartFilter[]> {
    const results: SmartFilter[] = [];

    for (const def of this.filterDefinitions) {
      try {
        const siteIds = await def.method();
        results.push({
          id: def.id,
          category: def.category,
          label: def.label,
          description: def.description,
          count: siteIds.length,
          severity: def.severity,
        });
      } catch {
        results.push({
          id: def.id,
          category: def.category,
          label: def.label,
          description: def.description,
          count: 0,
          severity: def.severity,
        });
      }
    }

    return results;
  }

  /**
   * Returns site IDs matching the given filter.
   */
  async applyFilter(filterId: string): Promise<string[]> {
    const def = this.filterDefinitions.find((d) => d.id === filterId);
    if (!def) {
      throw new Error(`Unknown filter ID: ${filterId}`);
    }
    return def.method();
  }

  /**
   * Sites with >10 plugins (simplified heuristic for potential security updates).
   */
  private async filterSecurityUpdates(): Promise<string[]> {
    const sites = this.getSiteEntries();
    const matched: string[] = [];

    for (const [siteId] of sites) {
      try {
        const plugins = await this.graphService.listPlugins(siteId);
        if (Array.isArray(plugins) && plugins.length > 10) {
          matched.push(siteId);
        }
      } catch {
        // Skip sites that fail
      }
    }

    return matched;
  }

  /**
   * Sites running PHP < 8.0.
   */
  private async filterOutdatedPHP(): Promise<string[]> {
    const sites = this.getSiteEntries();
    const matched: string[] = [];

    for (const [siteId, site] of sites) {
      try {
        const version = site.phpVersion;
        if (version && this.compareVersions(version, '8.0') < 0) {
          matched.push(siteId);
        }
      } catch {
        // Skip sites that fail
      }
    }

    return matched;
  }

  /**
   * Sites where domain doesn't start with 'https'.
   */
  private async filterNoSSL(): Promise<string[]> {
    const sites = this.getSiteEntries();
    const matched: string[] = [];

    for (const [siteId, site] of sites) {
      try {
        const domain = site.domain;
        if (domain && !domain.startsWith('https')) {
          matched.push(siteId);
        }
      } catch {
        // Skip sites that fail
      }
    }

    return matched;
  }

  /**
   * Sites not in indexRegistry or indexed more than 7 days ago.
   */
  private async filterNotIndexed(): Promise<string[]> {
    const sites = this.getSiteEntries();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const matched: string[] = [];

    for (const [siteId] of sites) {
      try {
        const entry = this.indexRegistry.get(siteId);
        if (!entry) {
          matched.push(siteId);
        } else if (entry.lastIndexed && entry.lastIndexed < sevenDaysAgo) {
          matched.push(siteId);
        }
      } catch {
        // Skip sites that fail
      }
    }

    return matched;
  }

  /**
   * Placeholder - no easy way to check DB size yet.
   */
  private async filterLargeDB(): Promise<string[]> {
    return [];
  }

  /**
   * Placeholder - no easy way to check disk space yet.
   */
  private async filterLowDisk(): Promise<string[]> {
    return [];
  }

  /**
   * Sites with no events in the last 7 days.
   */
  private async filterNoEvents(): Promise<string[]> {
    const sites = this.getSiteEntries();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const matched: string[] = [];

    for (const [siteId] of sites) {
      try {
        const events = await this.graphService.getRecentEvents({
          siteId,
          since: sevenDaysAgo,
        });
        if (!Array.isArray(events) || events.length === 0) {
          matched.push(siteId);
        }
      } catch {
        // Skip sites that fail
      }
    }

    return matched;
  }

  /**
   * Placeholder - needs HealthScoreCalculator integration later.
   */
  private async filterLowHealth(): Promise<string[]> {
    return [];
  }

  /**
   * Get site entries as [siteId, siteData] pairs.
   */
  private getSiteEntries(): Array<[string, any]> {
    const sitesRecord = this.siteDataBridge.getSites();
    return Object.entries(sitesRecord);
  }

  /**
   * Simple version comparison. Returns negative if a < b, 0 if equal, positive if a > b.
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) {
        return numA - numB;
      }
    }

    return 0;
  }
}
