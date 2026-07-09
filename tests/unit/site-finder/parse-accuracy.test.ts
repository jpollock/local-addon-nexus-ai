/**
 * Tier 1 — Site Finder parse accuracy tests
 *
 * Tests that:
 * 1. SiteFinderFiltersSchema accepts all P0–P3 filter fields
 * 2. The AI system prompt contains correct examples for each filter
 * 3. The empty-filter guard rejects queries that would return all sites
 *
 * These are the FAILING BASELINE — implement features to make them pass.
 */

import { SiteFinderFiltersSchema } from '../../../src/common/schemas';
import { buildSiteFinderSystemPrompt } from '../../../src/main/ai/site-finder-prompt';

// ---------------------------------------------------------------------------
// Schema validation — new filter fields
// ---------------------------------------------------------------------------

describe('SiteFinderFiltersSchema — P0 filters', () => {
  test('accepts recentPostDays', () => {
    const result = SiteFinderFiltersSchema.safeParse({ recentPostDays: 30 });
    expect(result.success).toBe(true);
  });

  test('rejectsnegative recentPostDays', () => {
    const result = SiteFinderFiltersSchema.safeParse({ recentPostDays: -1 });
    expect(result.success).toBe(false);
  });
});

describe('SiteFinderFiltersSchema — P1 filters', () => {
  test('accepts phpEolOnly', () => {
    const result = SiteFinderFiltersSchema.safeParse({ phpEolOnly: true });
    expect(result.success).toBe(true);
  });

  test('accepts wpVersionOlderThan', () => {
    const result = SiteFinderFiltersSchema.safeParse({ wpVersionOlderThan: '7.0' });
    expect(result.success).toBe(true);
  });

  test('accepts maxPostCount', () => {
    const result = SiteFinderFiltersSchema.safeParse({ maxPostCount: 10 });
    expect(result.success).toBe(true);
  });

  test('accepts maxUserCount', () => {
    const result = SiteFinderFiltersSchema.safeParse({ maxUserCount: 5 });
    expect(result.success).toBe(true);
  });

  test('accepts pluginVersion with slug and olderThan', () => {
    const result = SiteFinderFiltersSchema.safeParse({
      pluginVersion: { slug: 'advanced-custom-fields', olderThan: '6.3.0' },
    });
    expect(result.success).toBe(true);
  });

  test('rejects pluginVersion missing olderThan', () => {
    const result = SiteFinderFiltersSchema.safeParse({
      pluginVersion: { slug: 'advanced-custom-fields' },
    });
    expect(result.success).toBe(false);
  });
});

describe('SiteFinderFiltersSchema — P2 settings-based filters', () => {
  test('accepts commentsDisabled', () => {
    const result = SiteFinderFiltersSchema.safeParse({ commentsDisabled: true });
    expect(result.success).toBe(true);
  });

  test('accepts hiddenFromSearch', () => {
    const result = SiteFinderFiltersSchema.safeParse({ hiddenFromSearch: true });
    expect(result.success).toBe(true);
  });

  test('accepts selfRegistrationOpen', () => {
    const result = SiteFinderFiltersSchema.safeParse({ selfRegistrationOpen: true });
    expect(result.success).toBe(true);
  });

  test('accepts staticFrontPage', () => {
    const result = SiteFinderFiltersSchema.safeParse({ staticFrontPage: true });
    expect(result.success).toBe(true);
  });

  test('accepts plainPermalinks', () => {
    const result = SiteFinderFiltersSchema.safeParse({ plainPermalinks: true });
    expect(result.success).toBe(true);
  });
});

describe('SiteFinderFiltersSchema — P3 structural filters', () => {
  test('accepts source filter', () => {
    const result = SiteFinderFiltersSchema.safeParse({ source: 'wpe' });
    expect(result.success).toBe(true);
  });

  test('accepts wpeEnvironment filter', () => {
    const result = SiteFinderFiltersSchema.safeParse({ wpeEnvironment: 'production' });
    expect(result.success).toBe(true);
  });

  test('rejects invalid wpeEnvironment', () => {
    const result = SiteFinderFiltersSchema.safeParse({ wpeEnvironment: 'invalid' });
    expect(result.success).toBe(false);
  });

  test('accepts minAdminCount', () => {
    const result = SiteFinderFiltersSchema.safeParse({ minAdminCount: 3 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AI system prompt — new examples present
// ---------------------------------------------------------------------------

describe('AI system prompt — contains examples for new filters', () => {
  const prompt = buildSiteFinderSystemPrompt();

  test('contains recentPostDays example', () => {
    expect(prompt).toContain('recentPostDays');
  });

  test('contains phpEolOnly example', () => {
    expect(prompt).toContain('phpEolOnly');
  });

  test('contains wpVersionOlderThan example', () => {
    expect(prompt).toContain('wpVersionOlderThan');
  });

  test('contains hiddenFromSearch or commentsDisabled example', () => {
    expect(prompt).toMatch(/hiddenFromSearch|commentsDisabled/);
  });

  test('maps "sites updated in last N days" to recentPostDays', () => {
    expect(prompt).toContain('recentPostDays');
    // The prompt must not redirect this to stalePostDays (opposite direction)
    expect(prompt).not.toContain('"sites updated in last" → { "stalePostDays"');
  });

  test('maps "end-of-life PHP" to phpEolOnly', () => {
    expect(prompt).toContain('phpEolOnly');
  });
});

// ---------------------------------------------------------------------------
// Empty-filter guard — should never return all sites
// ---------------------------------------------------------------------------

describe('empty-filter guard regression', () => {
  test('SiteFinderFiltersSchema with no fields is valid (filter object exists but empty)', () => {
    const result = SiteFinderFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    // The hasFilter guard in the handler prevents this from returning all sites
    // This test just confirms the schema accepts {}; the guard is tested in integration
  });

  test('SiteFinderFiltersSchema with all-undefined fields parses to an object', () => {
    const result = SiteFinderFiltersSchema.safeParse({
      plugins: undefined,
      themes: undefined,
      phpVersions: undefined,
    });
    expect(result.success).toBe(true);
  });
});
