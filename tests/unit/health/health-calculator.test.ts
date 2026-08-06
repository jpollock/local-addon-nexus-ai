/**
 * Unit tests for HealthScoreCalculator
 */
import { HealthScoreCalculator, HealthBreakdown } from '../../../src/main/health/HealthScoreCalculator';

describe('HealthScoreCalculator', () => {
  let calculator: HealthScoreCalculator;
  let mockGraphService: {
    getRecentEvents: jest.Mock;
    getRecentContent: jest.Mock;
    listPlugins: jest.Mock;
  };
  let mockIndexRegistry: {
    get: jest.Mock;
    listAll: jest.Mock;
  };
  let mockSiteDataBridge: {
    getSite: jest.Mock;
  };

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    mockGraphService = {
      getRecentEvents: jest.fn().mockResolvedValue([]),
      getRecentContent: jest.fn().mockResolvedValue([]),
      listPlugins: jest.fn().mockResolvedValue([]),
    };
    mockIndexRegistry = {
      get: jest.fn().mockReturnValue(undefined),
      listAll: jest.fn().mockReturnValue([]),
    };
    mockSiteDataBridge = {
      getSite: jest.fn().mockReturnValue(null),
    };

    calculator = new HealthScoreCalculator({
      graphService: mockGraphService,
      indexRegistry: mockIndexRegistry,
      siteDataBridge: mockSiteDataBridge,
    });
  });

  // -------------------------------------------------------------------------
  // 1. calculateScore returns valid HealthBreakdown
  // -------------------------------------------------------------------------
  it('should return a valid HealthBreakdown with all required fields', async () => {
    const result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });

    expect(result).toHaveProperty('overall');
    expect(result).toHaveProperty('factors');
    expect(result).toHaveProperty('factorsEvaluated');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('issuesByCategory');
    expect(result).toHaveProperty('recommendations');
    expect(result.factors).toHaveProperty('security');
    expect(result.factors).toHaveProperty('performance');
    expect(result.factors).toHaveProperty('maintenance');
    expect(result.factors).toHaveProperty('activity');
    expect(result.factors).toHaveProperty('stability');
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.issuesByCategory)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Security: SSL detection (https domain = higher score)
  // -------------------------------------------------------------------------
  it('should score security higher when domain uses HTTPS', async () => {
    const httpsResult = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });
    const httpResult = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'http://example.com',
    });

    expect(httpsResult.factors.security).toBeGreaterThan(httpResult.factors.security);
  });

  // -------------------------------------------------------------------------
  // 3. Security: PHP version scoring (8.1+ best, 7.x lower)
  // -------------------------------------------------------------------------
  it('should score security higher for PHP 8.1+ than PHP 7.x', async () => {
    const php81Result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });
    const php74Result = await calculator.calculateScore('site-1', {
      phpVersion: '7.4.0',
      domain: 'https://example.com',
    });

    expect(php81Result.factors.security).toBeGreaterThan(php74Result.factors.security);
  });

  // -------------------------------------------------------------------------
  // 4. Security: Security plugin detection
  // -------------------------------------------------------------------------
  it('should score security higher when a security plugin is installed', async () => {
    mockGraphService.listPlugins
      .mockResolvedValueOnce([{ slug: 'wordfence', name: 'Wordfence Security' }])
      .mockResolvedValueOnce([{ slug: 'hello-dolly', name: 'Hello Dolly' }]);

    const withSecurity = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });
    const withoutSecurity = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });

    expect(withSecurity.factors.security).toBeGreaterThan(withoutSecurity.factors.security);
  });

  // -------------------------------------------------------------------------
  // 5. Performance: PHP version impact
  // -------------------------------------------------------------------------
  it('should score performance higher for PHP 8.2+ than PHP 7.x', async () => {
    const php82Result = await calculator.calculateScore('site-1', {
      phpVersion: '8.2.0',
      domain: 'https://example.com',
    });
    const php73Result = await calculator.calculateScore('site-1', {
      phpVersion: '7.3.0',
      domain: 'https://example.com',
    });

    expect(php82Result.factors.performance).toBeGreaterThan(php73Result.factors.performance);
  });

  // -------------------------------------------------------------------------
  // 6. Performance: Caching plugin detection
  // -------------------------------------------------------------------------
  it('should score performance higher when a caching plugin is installed', async () => {
    mockGraphService.listPlugins
      .mockResolvedValueOnce([{ slug: 'redis-object-cache', name: 'Redis Object Cache' }])
      .mockResolvedValueOnce([]);

    const withCache = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });
    const withoutCache = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });

    expect(withCache.factors.performance).toBeGreaterThan(withoutCache.factors.performance);
  });

  // -------------------------------------------------------------------------
  // 7. Maintenance: Index freshness scoring
  // -------------------------------------------------------------------------
  it('should score maintenance higher for recently indexed sites', async () => {
    // Recently indexed (1 hour ago)
    mockIndexRegistry.get
      .mockReturnValueOnce({
        lastIndexed: Date.now() - 60 * 60 * 1000,
        state: 'indexed',
      })
      // Old index (14 days ago)
      .mockReturnValueOnce({
        lastIndexed: Date.now() - 14 * ONE_DAY_MS,
        state: 'indexed',
      })
      // Never indexed
      .mockReturnValueOnce(undefined);

    const recentResult = await calculator.calculateScore('site-1', { phpVersion: '8.1.0' });
    const oldResult = await calculator.calculateScore('site-2', { phpVersion: '8.1.0' });
    const neverResult = await calculator.calculateScore('site-3', { phpVersion: '8.1.0' });

    expect(recentResult.factors.maintenance).toBeGreaterThan(oldResult.factors.maintenance);
    expect(oldResult.factors.maintenance).toBeGreaterThan(neverResult.factors.maintenance);
    expect(neverResult.factors.maintenance).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 8. Activity: Recent events boost score
  // -------------------------------------------------------------------------
  it('should score activity higher when recent events exist', async () => {
    mockGraphService.getRecentEvents.mockResolvedValue([
      { created_at: Date.now() - 60 * 60 * 1000 }, // 1 hour ago
    ]);
    mockGraphService.getRecentContent.mockResolvedValue([
      { title: 'Post 1' },
      { title: 'Post 2' },
      { title: 'Post 3' },
      { title: 'Post 4' },
      { title: 'Post 5' },
    ]);

    const result = await calculator.calculateScore('site-1', { phpVersion: '8.1.0' });

    expect(result.factors.activity).toBe(100);
  });

  // -------------------------------------------------------------------------
  // 9. Activity: No events = lower score
  // -------------------------------------------------------------------------
  it('should score activity lower when no events or content exist', async () => {
    mockGraphService.getRecentEvents.mockResolvedValue([]);
    mockGraphService.getRecentContent.mockResolvedValue([]);

    const result = await calculator.calculateScore('site-1', { phpVersion: '8.1.0' });

    expect(result.factors.activity).toBe(0);
    expect(result.issues).toContain('No site events found');
    expect(result.issues).toContain('No content updated in the last 30 days');
  });

  // -------------------------------------------------------------------------
  // 10. Stability: No failed events = perfect
  // -------------------------------------------------------------------------
  it('should give perfect stability score when no failed events exist', async () => {
    // Default mock returns empty array for getRecentEvents
    const result = await calculator.calculateScore('site-1', { phpVersion: '8.1.0' });

    expect(result.factors.stability).toBe(100);
  });

  // -------------------------------------------------------------------------
  // 11. Stability: Many failed events = low score
  // -------------------------------------------------------------------------
  it('should give low stability score when many failed events exist', async () => {
    const failedEvents = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      status: 'failed',
      created_at: Date.now() - i * ONE_DAY_MS,
    }));

    // First call is for activity (non-failed), second is for stability (failed)
    mockGraphService.getRecentEvents.mockImplementation(async (options: any) => {
      if (options?.status === 'failed') {
        return failedEvents;
      }
      return [];
    });

    const result = await calculator.calculateScore('site-1', { phpVersion: '8.1.0' });

    expect(result.factors.stability).toBe(10);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('failed events')]),
    );
  });

  // -------------------------------------------------------------------------
  // 12. Weighted average calculation is correct
  // -------------------------------------------------------------------------
  it('should calculate overall score as weighted average of factors', async () => {
    // Set up a scenario with known scores
    mockGraphService.listPlugins.mockResolvedValue([
      { slug: 'wordfence', name: 'Wordfence' },
    ]);
    mockIndexRegistry.get.mockReturnValue({
      lastIndexed: Date.now() - 30 * 60 * 1000, // 30 min ago
      state: 'indexed',
    });
    mockGraphService.getRecentEvents.mockResolvedValue([
      { created_at: Date.now() - 60 * 60 * 1000 },
    ]);
    mockGraphService.getRecentContent.mockResolvedValue([
      { title: 'Post 1' },
      { title: 'Post 2' },
      { title: 'Post 3' },
      { title: 'Post 4' },
      { title: 'Post 5' },
    ]);

    const result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'https://example.com',
    });

    const expected = Math.round(
      result.factors.security * 0.30 +
      result.factors.performance * 0.25 +
      result.factors.maintenance * 0.20 +
      result.factors.activity * 0.15 +
      result.factors.stability * 0.10,
    );

    expect(result.overall).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // 13. Recommendations generated for low-scoring factors
  // -------------------------------------------------------------------------
  it('should generate recommendations prioritized by lowest scoring factors', () => {
    const factors = {
      security: 20,
      performance: 90,
      maintenance: 10,
      activity: 80,
      stability: 95,
    };

    const recommendations = calculator.generateRecommendations(factors);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.length).toBeLessThanOrEqual(5);
    // Maintenance is lowest, so its recs should come first
    expect(recommendations[0]).toContain('index');
  });

  // -------------------------------------------------------------------------
  // 14. calculateAllScores returns scores for multiple sites
  // -------------------------------------------------------------------------
  it('should return overall scores for all requested sites', async () => {
    mockGraphService.getRecentEvents.mockResolvedValue([]);
    mockGraphService.getRecentContent.mockResolvedValue([]);

    const siteInfoMap = {
      'site-a': { phpVersion: '8.1.0', domain: 'https://a.com' },
      'site-b': { phpVersion: '7.4.0', domain: 'http://b.com' },
      'site-c': { phpVersion: '8.2.0', domain: 'https://c.com' },
    };

    const results = await calculator.calculateAllScores(
      ['site-a', 'site-b', 'site-c'],
      siteInfoMap,
    );

    expect(Object.keys(results)).toHaveLength(3);
    expect(results).toHaveProperty('site-a');
    expect(results).toHaveProperty('site-b');
    expect(results).toHaveProperty('site-c');
    expect(typeof results['site-a']).toBe('number');
    expect(typeof results['site-b']).toBe('number');
    // Better PHP + HTTPS should yield higher score
    expect(results['site-a']).toBeGreaterThan(results['site-b']);
  });

  // -------------------------------------------------------------------------
  // 15. Handles missing/null data gracefully
  // -------------------------------------------------------------------------
  it('should handle missing or null data without throwing', async () => {
    mockGraphService.listPlugins.mockRejectedValue(new Error('DB not ready'));
    mockGraphService.getRecentEvents.mockRejectedValue(new Error('DB not ready'));
    mockGraphService.getRecentContent.mockRejectedValue(new Error('DB not ready'));
    mockIndexRegistry.get.mockReturnValue(undefined);

    const result = await calculator.calculateScore('site-unknown', {});

    expect(result).toBeDefined();
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.factors.maintenance).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // issuesByCategory tests
  // -------------------------------------------------------------------------
  it('should populate issuesByCategory when sites have problems in multiple factors', async () => {
    // Mock a site with security and performance issues
    mockGraphService.listPlugins.mockResolvedValue([]); // No security or cache plugins
    mockIndexRegistry.get.mockReturnValue({ state: 'indexed', lastIndexedAt: Date.now() - ONE_DAY_MS });

    const result = await calculator.calculateScore('site-1', {
      phpVersion: '7.3.0', // Outdated
      domain: 'http://example.com', // Not HTTPS
    });

    // Verify issuesByCategory is populated with category fields
    expect(result.issuesByCategory.length).toBeGreaterThan(0);
    const securityIssues = result.issuesByCategory.filter((i) => i.category === 'security');
    expect(securityIssues.length).toBeGreaterThan(0); // Should have HTTPS and PHP issues
    expect(securityIssues.every((i) => 'message' in i && 'category' in i)).toBe(true);
  });

  it('should include issues from multiple categories when problems span factors', async () => {
    mockGraphService.listPlugins.mockResolvedValue([]); // Missing plugins
    mockIndexRegistry.get.mockReturnValue(undefined); // Not indexed

    const result = await calculator.calculateScore('site-1', {
      phpVersion: '7.4.0',
      domain: 'example.com', // No scheme
    });

    const categories = new Set(result.issuesByCategory.map((i) => i.category));
    // Should have issues from at least security, performance, and maintenance
    expect(categories.size).toBeGreaterThan(1);
    expect(categories.has('security')).toBe(true);
    expect(categories.has('maintenance')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // HTTPS check tests (siteUrl preferred, no-scheme handling)
  // -------------------------------------------------------------------------
  it('should not report HTTPS issue when siteUrl is https://', async () => {
    const result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      siteUrl: 'https://example.com/wp',
      domain: 'example.com', // no scheme
    });

    const httpsIssue = result.issues.find((i) => i.includes('HTTPS'));
    expect(httpsIssue).toBeUndefined();
  });

  it('should report HTTPS issue when siteUrl is http://', async () => {
    const result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      siteUrl: 'http://example.com/wp',
    });

    const httpsIssue = result.issues.find((i) => i.includes('HTTPS'));
    expect(httpsIssue).toBeDefined();
  });

  it('should not report HTTPS issue when neither siteUrl nor domain has a scheme', async () => {
    const result = await calculator.calculateScore('site-1', {
      phpVersion: '8.1.0',
      domain: 'example.com',
    });

    const httpsIssue = result.issues.find((i) => i.includes('HTTPS'));
    expect(httpsIssue).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Optional factors parameter tests
  // -------------------------------------------------------------------------
  it('should evaluate only the requested factors when factorsToEvaluate is partial', async () => {
    const result = await calculator.calculateScore(
      'site-1',
      { phpVersion: '8.1.0', domain: 'example.com' },
      ['security', 'performance', 'stability']
    );

    expect(result.factorsEvaluated).toEqual(['security', 'performance', 'stability']);
    // Issues should only come from evaluated factors
    const categories = new Set(result.issuesByCategory.map((i) => i.category));
    expect(categories.has('maintenance')).toBe(false);
    expect(categories.has('activity')).toBe(false);
  });

  it('should renormalize weights when evaluating a subset of factors', async () => {
    mockGraphService.listPlugins.mockResolvedValue([
      { slug: 'wordfence' }, // Security plugin
      { slug: 'wp-rocket' }, // Cache plugin
    ]);

    const resultAllFactors = await calculator.calculateScore(
      'site-1',
      { phpVersion: '8.3.0', siteUrl: 'https://example.com' }
    );

    const resultThreeFactors = await calculator.calculateScore(
      'site-1',
      { phpVersion: '8.3.0', siteUrl: 'https://example.com' },
      ['security', 'performance', 'stability']
    );

    const resultTwoFactors = await calculator.calculateScore(
      'site-1',
      { phpVersion: '8.3.0', siteUrl: 'https://example.com' },
      ['security', 'performance']
    );

    // Exact values, not an inequality. With this suite's mocks maintenance and
    // activity both score 0, so `toBeGreaterThanOrEqual` passed even with
    // renormalization removed entirely — the two totals were merely equal.
    //
    // Factor scores under these mocks: security 100 (https + PHP 8.3 + wordfence
    // + 2 plugins), performance 40 (PHP 8.3 only; wp-rocket matches neither the
    // cache nor the image-optimisation slug list), maintenance 0, activity 0,
    // stability 100 (no failed events).
    //
    //   all five → .30(100) + .25(40) + .20(0) + .15(0) + .10(100)        = 50
    //   sec/perf/stab, renormalised over 0.65 → (30 + 10 + 10) / 0.65     = 77
    //   sec/perf,      renormalised over 0.55 → (30 + 10) / 0.55          = 73
    expect(resultAllFactors.overall).toBe(50);
    expect(resultThreeFactors.overall).toBe(77);
    expect(resultTwoFactors.overall).toBe(73);
  });

  it('refuses to score an empty factor set rather than returning a number', async () => {
    await expect(
      calculator.calculateScore('site-1', { phpVersion: '8.3.0' }, [])
    ).rejects.toThrow(/not scoreable/);
  });

  // -------------------------------------------------------------------------
  // Recommendations must not name factors that were never evaluated
  // -------------------------------------------------------------------------
  describe('recommendations are scoped to the evaluated factors', () => {
    const MAINTENANCE_RECS = [
      'Re-index this site to keep search data fresh',
      'Set up automatic indexing to avoid stale data',
    ];
    const ACTIVITY_RECS = [
      'Publish or update content regularly to keep the site active',
      'Monitor site events to detect issues early',
    ];
    const STABILITY_RECS = [
      'Investigate and resolve failed events',
      'Review error logs for recurring failures',
    ];

    it('never recommends maintenance/activity/stability for a security+performance-only target', async () => {
      // A remote target: no index entry, no events, no content — so
      // maintenance and activity sit at their {score: 0} initializer and would
      // sort to the very top of an unfiltered lowest-first sort.
      const result = await calculator.calculateScore(
        'wpe-1',
        { phpVersion: '7.2.0', siteUrl: 'http://example.com' },
        ['security', 'performance'],
      );

      expect(result.factors.maintenance).toBe(0);
      expect(result.factors.activity).toBe(0);
      expect(result.factors.stability).toBe(0);

      expect(result.recommendations.length).toBeGreaterThan(0);
      for (const rec of [...MAINTENANCE_RECS, ...ACTIVITY_RECS, ...STABILITY_RECS]) {
        expect(result.recommendations).not.toContain(rec);
      }
      // Everything it does say must come from security or performance.
      const allowed = new Set([
        'Enable SSL/HTTPS for your domain',
        'Upgrade PHP to 8.1 or later',
        'Install a security plugin (e.g., Wordfence, Sucuri)',
        'Upgrade PHP to the latest stable version for better performance',
        'Install a caching plugin (e.g., Redis Object Cache, WP Super Cache)',
        'Install an image optimization plugin (e.g., Smush, EWWW, Imagify)',
      ]);
      for (const rec of result.recommendations) {
        expect(allowed.has(rec)).toBe(true);
      }
    });

    it('still recommends from the genuinely lowest-scoring factor on a full five-factor call', async () => {
      // All five evaluated. With no index entry, maintenance genuinely scores 0
      // and is genuinely the worst factor, so its advice is legitimate here.
      const result = await calculator.calculateScore('site-1', {
        phpVersion: '8.3.0',
        siteUrl: 'https://example.com',
      });

      expect(result.factorsEvaluated).toHaveLength(5);
      expect(result.recommendations).toContain(MAINTENANCE_RECS[0]);
    });

    it('generateRecommendations defaults to every key when no subset is given', () => {
      const factors = { security: 90, performance: 90, maintenance: 0, activity: 90, stability: 90 };
      const recs = calculator.generateRecommendations(factors);
      expect(recs).toContain(MAINTENANCE_RECS[0]);
    });

    it('generateRecommendations ignores factors outside the evaluated subset', () => {
      const factors = { security: 90, performance: 90, maintenance: 0, activity: 0, stability: 0 };
      const recs = calculator.generateRecommendations(factors, ['security', 'performance']);
      for (const rec of [...MAINTENANCE_RECS, ...ACTIVITY_RECS, ...STABILITY_RECS]) {
        expect(recs).not.toContain(rec);
      }
      expect(recs.length).toBeGreaterThan(0);
    });
  });
});
