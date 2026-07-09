import { buildFleetContext, buildSiteContext, parseQueryPlan } from '../../../src/main/assistant/AssistantService';

const mockSiteData = {
  getSites: () => ({
    'site-1': { id: 'site-1', name: 'acme', phpVersion: '7.4' },
    'site-2': { id: 'site-2', name: 'news', phpVersion: '8.2' },
  }),
};

const mockMetadataCache = {
  get: (id: string) => id === 'site-1'
    ? { wpVersion: '6.9', plugins: [{ name: 'elementor', status: 'active' }, { name: 'woo', status: 'active' }], pluginCount: 2 }
    : null,
};

const mockIndexRegistry = {
  listAll: () => [{ siteId: 'site-1', state: 'indexed', documentCount: 42 }],
};

const mockGraphService = {
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => ({ count: 281 }),
      all: () => [{ count: 281 }],
    }),
  }),
};

test('buildFleetContext returns mode=fleet', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  expect(ctx.mode).toBe('fleet');
});

test('buildFleetContext counts local sites correctly', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  expect(ctx.localSiteCount).toBe(2);
});

test('buildFleetContext counts indexed sites', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  expect(ctx.indexedCount).toBe(1);
});

test('buildFleetContext generates PHP EOL insight for site-1 (PHP 7.4)', () => {
  const ctx = buildFleetContext(mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any, mockGraphService as any);
  const phpInsight = ctx.fleetInsights?.find((i: any) => i.title.toLowerCase().includes('php'));
  expect(phpInsight).toBeDefined();
  expect(phpInsight?.kind).toBe('warning');
});

test('buildSiteContext returns mode=site with correct siteId', () => {
  const ctx = buildSiteContext('site-1', mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any);
  expect(ctx.mode).toBe('site');
  expect(ctx.siteId).toBe('site-1');
});

test('buildSiteContext includes plugin version in activePlugins when version is available', () => {
  const cacheWithVersions = {
    get: (id: string) => id === 'site-1'
      ? {
          wpVersion: '7.0', scanDepth: 'full',
          plugins: [
            { name: 'woocommerce', title: 'WooCommerce', version: '8.5.2', status: 'active' },
            { name: 'elementor', title: 'Elementor', version: '3.21.0', status: 'active' },
            { name: 'inactive-plugin', title: 'Inactive', version: '1.0', status: 'inactive' },
          ],
        }
      : null,
  };
  const ctx = buildSiteContext('site-1', mockSiteData as any, cacheWithVersions as any, mockIndexRegistry as any);
  expect(ctx.activePlugins).toBeDefined();
  expect(ctx.activePlugins!.some(p => p.includes('WooCommerce (8.5.2)'))).toBe(true);
  expect(ctx.activePlugins!.some(p => p.includes('Elementor (3.21.0)'))).toBe(true);
  // Inactive plugins excluded
  expect(ctx.activePlugins!.some(p => p.includes('Inactive'))).toBe(false);
});

test('buildSiteContext omits version parenthetical when version is missing', () => {
  const cacheNoVersion = {
    get: (id: string) => id === 'site-1'
      ? { wpVersion: '7.0', scanDepth: 'full', plugins: [{ name: 'acf', title: 'ACF', status: 'active' }] }
      : null,
  };
  const ctx = buildSiteContext('site-1', mockSiteData as any, cacheNoVersion as any, mockIndexRegistry as any);
  expect(ctx.activePlugins).toBeDefined();
  expect(ctx.activePlugins![0]).toBe('ACF');
  expect(ctx.activePlugins![0]).not.toContain('(');
});

test('buildSiteContext falls back to site.phpVersion when cache has none', () => {
  // site-1 has phpVersion '7.4' in the site object; the cache mock has no phpVersion field
  const ctx = buildSiteContext('site-1', mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any);
  expect(ctx.phpVersion).toBe('7.4');
});

test('buildSiteContext prefers meta.phpVersion over site.phpVersion', () => {
  // WP-CLI result (meta) should win over Local static site object — it reflects actual running PHP
  const cacheWithPhp = {
    get: (id: string) => id === 'site-1'
      ? { wpVersion: '7.0', phpVersion: '8.3.1', plugins: [], scanDepth: 'full' }
      : null,
  };
  const ctx = buildSiteContext('site-1', mockSiteData as any, cacheWithPhp as any, mockIndexRegistry as any);
  // meta says 8.3.1, site object says 7.4 — meta wins
  expect(ctx.phpVersion).toBe('8.3.1');
});

test('buildSiteContext returns null phpVersion when both site and cache have none', () => {
  const siteDataNoPhp = { getSites: () => ({ 'site-1': { id: 'site-1', name: 'acme', phpVersion: null } }) };
  const cacheNoPhp = { get: () => ({ wpVersion: '7.0', plugins: [], scanDepth: 'full' }) };
  const ctx = buildSiteContext('site-1', siteDataNoPhp as any, cacheNoPhp as any, mockIndexRegistry as any);
  expect(ctx.phpVersion).toBeNull();
});

test('buildSiteContext reads indexState from indexRegistry', () => {
  const ctx = buildSiteContext('site-1', mockSiteData as any, mockMetadataCache as any, mockIndexRegistry as any);
  expect(ctx.indexState).toBe('indexed');
  expect(ctx.documentCount).toBe(42);
});

test('parseQueryPlan extracts intent and summary from valid JSON', () => {
  const json = '{"intent":"fleet-filter","summary":"Found 2 sites on PHP 7.4","sites":[{"name":"acme","meta":"PHP 7.4","tag":"EOL","tagKind":"warn","source":"local"}],"actions":[]}';
  const plan = parseQueryPlan(json);
  expect(plan.intent).toBe('fleet-filter');
  expect(plan.summary).toBe('Found 2 sites on PHP 7.4');
  expect(plan.sites).toHaveLength(1);
});

test('parseQueryPlan handles JSON wrapped in markdown code block', () => {
  const json = '```json\n{"intent":"explanation","summary":"Here is my answer"}\n```';
  const plan = parseQueryPlan(json);
  expect(plan.intent).toBe('explanation');
  expect(plan.summary).toBe('Here is my answer');
});

test('parseQueryPlan returns explanation intent for malformed JSON', () => {
  const plan = parseQueryPlan('not json at all {broken');
  expect(plan.intent).toBe('explanation');
  expect(typeof plan.summary).toBe('string');
  expect(plan.summary.length).toBeGreaterThan(0);
});
