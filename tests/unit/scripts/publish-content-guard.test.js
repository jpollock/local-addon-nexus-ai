'use strict';

const {
  findForbiddenPublishContent,
  FORBIDDEN_CONTENT,
} = require('../../../scripts/publish-guard-core');

describe('findForbiddenPublishContent', () => {
  it('catches an IW tool name compiled into a bundle', () => {
    const hits = findForbiddenPublishContent([
      { path: 'lib/main.js', content: 'registry.register({name:"iw_search_kb"})' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('lib/main.js');
    expect(hits[0].label).toMatch(/Intelligent Web/);
  });

  it('catches the Power inference endpoint', () => {
    const hits = findForbiddenPublishContent([
      { path: 'lib/main.js', content: 'const B="https://api.ai.wpengine.com/v1"' },
    ]);
    expect(hits.map((h) => h.label)).toContain('WP Engine Power inference endpoint');
  });

  it('catches the product names that ship as tool descriptions', () => {
    const hits = findForbiddenPublishContent([
      { path: 'lib/main.js', content: 'WP Engine Intelligent Web (Hub Plugin) connection status' },
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  // Must-survive corpus: these are ordinary English and legitimate identifiers
  // that are live in this codebase. A guard that fires on them gets disabled by
  // the next engineer, which is worse than no guard.
  it.each([
    ['powered by', 'AI-powered site discovery'],
    ['powerful tier label', "{ id: 'gpt-4o', tier: 'powerful' }"],
    ['the word superpowers', 'WordPress site management with AI superpowers'],
    ['an unrelated iw substring', 'const kiwi = 1; // kiwifruit'],
    ['a normal wpengine host', 'https://my.wpengine.com/installs'],
  ])('does not fire on %s', (_label, content) => {
    expect(findForbiddenPublishContent([{ path: 'lib/main.js', content }])).toEqual([]);
  });

  it('is stateless across calls (no /g regex lastIndex bug)', () => {
    const files = [{ path: 'lib/main.js', content: 'api.ai.wpengine.com' }];
    expect(findForbiddenPublishContent(files)).toHaveLength(1);
    expect(findForbiddenPublishContent(files)).toHaveLength(1);
  });

  it('exports non-global patterns only', () => {
    for (const rule of FORBIDDEN_CONTENT) {
      expect(rule.pattern.global).toBe(false);
    }
  });

  it('returns [] for a non-array argument rather than throwing', () => {
    expect(findForbiddenPublishContent(null)).toEqual([]);
  });
});
