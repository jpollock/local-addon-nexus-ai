/**
 * HealthScoreCalculator
 *
 * Calculates site health scores (0-100) based on weighted factors:
 * - Security (30%): SSL, PHP version, security plugins, plugin count
 * - Performance (25%): PHP version, caching plugins, image optimization
 * - Maintenance (20%): Index freshness, indexing state
 * - Activity (15%): Recent events, content freshness
 * - Stability (10%): Failed event count
 */

export interface HealthBreakdown {
  overall: number;
  factors: {
    security: number;
    performance: number;
    maintenance: number;
    activity: number;
    stability: number;
  };
  issues: string[];
  recommendations: string[];
}

interface FactorResult {
  score: number;
  issues: string[];
}

interface HealthDeps {
  graphService: any;
  indexRegistry: any;
  siteDataBridge: any;
}

const WEIGHTS = {
  security: 0.30,
  performance: 0.25,
  maintenance: 0.20,
  activity: 0.15,
  stability: 0.10,
} as const;

const SECURITY_PLUGIN_SLUGS = ['wordfence', 'sucuri', 'ithemes-security'];
const CACHE_PLUGIN_SLUGS = ['redis', 'memcached', 'cache'];
const IMAGE_OPT_PLUGIN_SLUGS = ['smush', 'ewww', 'imagify'];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export class HealthScoreCalculator {
  private graphService: any;
  private indexRegistry: any;
  private siteDataBridge: any;

  constructor(deps: HealthDeps) {
    this.graphService = deps.graphService;
    this.indexRegistry = deps.indexRegistry;
    this.siteDataBridge = deps.siteDataBridge;
  }

  /**
   * Calculate a full health breakdown for a single site.
   */
  async calculateScore(
    siteId: string,
    siteInfo: { phpVersion?: string; domain?: string },
  ): Promise<HealthBreakdown> {
    // Fetch plugins once and share across factor checks
    let plugins: Array<{ slug: string; name: string }> = [];
    try {
      plugins = await this.graphService.listPlugins(siteId) ?? [];
    } catch {
      // If we can't fetch plugins, proceed with empty list
    }

    const [security, performance, maintenance, activity, stability] = await Promise.all([
      this.calculateSecurity(siteInfo, plugins),
      this.calculatePerformance(siteInfo, plugins),
      this.calculateMaintenance(siteId),
      this.calculateActivity(siteId),
      this.calculateStability(siteId),
    ]);

    const factors = {
      security: security.score,
      performance: performance.score,
      maintenance: maintenance.score,
      activity: activity.score,
      stability: stability.score,
    };

    const overall = Math.round(
      factors.security * WEIGHTS.security +
      factors.performance * WEIGHTS.performance +
      factors.maintenance * WEIGHTS.maintenance +
      factors.activity * WEIGHTS.activity +
      factors.stability * WEIGHTS.stability,
    );

    const issues = [
      ...security.issues,
      ...performance.issues,
      ...maintenance.issues,
      ...activity.issues,
      ...stability.issues,
    ];

    const recommendations = this.generateRecommendations(factors);

    return { overall, factors, issues, recommendations };
  }

  /**
   * Calculate overall scores for multiple sites.
   */
  async calculateAllScores(
    siteIds: string[],
    siteInfoMap: Record<string, { phpVersion?: string; domain?: string }>,
  ): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    await Promise.all(
      siteIds.map(async (siteId) => {
        try {
          const info = siteInfoMap[siteId] ?? {};
          const breakdown = await this.calculateScore(siteId, info);
          results[siteId] = breakdown.overall;
        } catch {
          results[siteId] = 0;
        }
      }),
    );

    return results;
  }

  /**
   * Generate top 5 actionable recommendations based on lowest-scoring factors.
   */
  generateRecommendations(
    factors: Record<string, number>,
  ): string[] {
    const recommendationMap: Record<string, string[]> = {
      security: [
        'Enable SSL/HTTPS for your domain',
        'Upgrade PHP to 8.1 or later',
        'Install a security plugin (e.g., Wordfence, Sucuri)',
      ],
      performance: [
        'Upgrade PHP to the latest stable version for better performance',
        'Install a caching plugin (e.g., Redis Object Cache, WP Super Cache)',
        'Install an image optimization plugin (e.g., Smush, EWWW, Imagify)',
      ],
      maintenance: [
        'Re-index this site to keep search data fresh',
        'Set up automatic indexing to avoid stale data',
      ],
      activity: [
        'Publish or update content regularly to keep the site active',
        'Monitor site events to detect issues early',
      ],
      stability: [
        'Investigate and resolve failed events',
        'Review error logs for recurring failures',
      ],
    };

    // Sort factors from lowest to highest score
    const sorted = Object.entries(factors)
      .sort(([, a], [, b]) => a - b);

    const recommendations: string[] = [];
    for (const [factor] of sorted) {
      const recs = recommendationMap[factor];
      if (recs) {
        for (const rec of recs) {
          if (recommendations.length >= 5) break;
          recommendations.push(rec);
        }
      }
      if (recommendations.length >= 5) break;
    }

    return recommendations;
  }

  // ---------------------------------------------------------------------------
  // Private factor calculations
  // ---------------------------------------------------------------------------

  private async calculateSecurity(
    siteInfo: { phpVersion?: string; domain?: string },
    plugins: Array<{ slug: string }>,
  ): Promise<FactorResult> {
    let score = 0;
    const issues: string[] = [];

    // SSL check (25 points)
    if (siteInfo.domain && siteInfo.domain.startsWith('https')) {
      score += 25;
    } else {
      issues.push('Site is not using HTTPS');
    }

    // PHP version check (25 points)
    const phpScore = this.scorePhpVersion(siteInfo.phpVersion);
    score += phpScore.score;
    if (phpScore.issue) {
      issues.push(phpScore.issue);
    }

    // Security plugin check (25 points)
    const hasSecurityPlugin = plugins.some((p) =>
      SECURITY_PLUGIN_SLUGS.some((slug) => p.slug?.includes(slug)),
    );
    if (hasSecurityPlugin) {
      score += 25;
    } else {
      issues.push('No security plugin detected');
    }

    // Plugin hygiene - fewer plugins is better (25 points)
    const pluginCount = plugins.length;
    if (pluginCount <= 10) {
      score += 25;
    } else if (pluginCount <= 20) {
      score += 15;
    } else {
      score += 5;
      issues.push(`High plugin count (${pluginCount}) increases attack surface`);
    }

    return { score: Math.min(100, Math.max(0, score)), issues };
  }

  private async calculatePerformance(
    siteInfo: { phpVersion?: string },
    plugins: Array<{ slug: string }>,
  ): Promise<FactorResult> {
    let score = 0;
    const issues: string[] = [];

    // PHP version (40 points)
    const phpScore = this.scorePhpVersionPerformance(siteInfo.phpVersion);
    score += phpScore.score;
    if (phpScore.issue) {
      issues.push(phpScore.issue);
    }

    // Caching plugin (30 points)
    const hasCachePlugin = plugins.some((p) =>
      CACHE_PLUGIN_SLUGS.some((slug) => p.slug?.includes(slug)),
    );
    if (hasCachePlugin) {
      score += 30;
    } else {
      issues.push('No caching plugin detected');
    }

    // Image optimization plugin (30 points)
    const hasImageOpt = plugins.some((p) =>
      IMAGE_OPT_PLUGIN_SLUGS.some((slug) => p.slug?.includes(slug)),
    );
    if (hasImageOpt) {
      score += 30;
    } else {
      issues.push('No image optimization plugin detected');
    }

    return { score: Math.min(100, Math.max(0, score)), issues };
  }

  private async calculateMaintenance(siteId: string): Promise<FactorResult> {
    let score = 0;
    const issues: string[] = [];

    const entry = this.indexRegistry.get(siteId);

    if (!entry) {
      issues.push('Site has never been indexed');
      return { score: 0, issues };
    }

    // Index state check (30 points)
    if (entry.state === 'indexed') {
      score += 30;
    } else if (entry.state === 'indexing') {
      score += 20;
    } else if (entry.state === 'stale') {
      score += 10;
      issues.push('Site index is marked as stale');
    } else {
      issues.push('Site index is in error state');
    }

    // Index freshness (70 points)
    if (entry.lastIndexed) {
      const age = Date.now() - entry.lastIndexed;
      if (age < ONE_DAY_MS) {
        score += 70;
      } else if (age < SEVEN_DAYS_MS) {
        score += 50;
      } else {
        score += 20;
        issues.push('Site index is more than 7 days old');
      }
    } else {
      issues.push('Site has no index timestamp');
    }

    return { score: Math.min(100, Math.max(0, score)), issues };
  }

  private async calculateActivity(siteId: string): Promise<FactorResult> {
    let score = 0;
    const issues: string[] = [];

    // Recent events check (50 points)
    try {
      const events = await this.graphService.getRecentEvents({ siteId, limit: 1 });
      if (events && events.length > 0) {
        const latestEvent = events[0];
        const eventAge = Date.now() - (latestEvent.created_at ?? latestEvent.createdAt ?? 0);
        if (eventAge < ONE_DAY_MS) {
          score += 50;
        } else if (eventAge < SEVEN_DAYS_MS) {
          score += 35;
        } else {
          score += 15;
          issues.push('No recent site events in the last 7 days');
        }
      } else {
        issues.push('No site events found');
      }
    } catch {
      issues.push('Unable to retrieve site events');
    }

    // Content freshness check (50 points)
    try {
      const recentContent = await this.graphService.getRecentContent(siteId, 30);
      if (recentContent && recentContent.length > 0) {
        if (recentContent.length >= 5) {
          score += 50;
        } else {
          score += 30;
        }
      } else {
        issues.push('No content updated in the last 30 days');
      }
    } catch {
      issues.push('Unable to retrieve content data');
    }

    return { score: Math.min(100, Math.max(0, score)), issues };
  }

  private async calculateStability(siteId: string): Promise<FactorResult> {
    let score = 100;
    const issues: string[] = [];

    try {
      const failedEvents = await this.graphService.getRecentEvents({
        siteId,
        status: 'failed',
        limit: 10,
      });

      const failedCount = failedEvents?.length ?? 0;
      if (failedCount === 0) {
        // Perfect score
      } else if (failedCount <= 2) {
        score = 70;
        issues.push(`${failedCount} failed event(s) detected`);
      } else if (failedCount <= 5) {
        score = 40;
        issues.push(`${failedCount} failed events detected`);
      } else {
        score = 10;
        issues.push(`High number of failed events (${failedCount})`);
      }
    } catch {
      score = 50;
      issues.push('Unable to check event stability');
    }

    return { score, issues };
  }

  // ---------------------------------------------------------------------------
  // PHP version scoring helpers
  // ---------------------------------------------------------------------------

  private scorePhpVersion(version?: string): { score: number; issue?: string } {
    if (!version) {
      return { score: 5, issue: 'PHP version unknown' };
    }

    const major = this.parseMajorMinor(version);
    if (!major) {
      return { score: 5, issue: 'Unable to parse PHP version' };
    }

    if (major.major >= 8 && major.minor >= 1) {
      return { score: 25 };
    }
    if (major.major >= 8) {
      return { score: 20 };
    }
    if (major.major >= 7 && major.minor >= 4) {
      return { score: 10, issue: 'PHP 7.4 is outdated; upgrade to PHP 8.1+' };
    }
    return { score: 5, issue: `PHP ${version} is outdated and may have security vulnerabilities` };
  }

  private scorePhpVersionPerformance(version?: string): { score: number; issue?: string } {
    if (!version) {
      return { score: 10, issue: 'PHP version unknown' };
    }

    const major = this.parseMajorMinor(version);
    if (!major) {
      return { score: 10, issue: 'Unable to parse PHP version' };
    }

    if (major.major >= 8 && major.minor >= 2) {
      return { score: 40 };
    }
    if (major.major >= 8 && major.minor >= 1) {
      return { score: 35 };
    }
    if (major.major >= 8) {
      return { score: 30 };
    }
    if (major.major >= 7) {
      return { score: 15, issue: 'PHP 7.x has lower performance than PHP 8.x' };
    }
    return { score: 5, issue: `PHP ${version} has significantly lower performance` };
  }

  private parseMajorMinor(version: string): { major: number; minor: number } | null {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (!match) return null;
    return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
  }
}
