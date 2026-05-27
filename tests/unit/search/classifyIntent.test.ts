import { classifyIntent } from '../../../src/main/search/classifyIntent';

describe('classifyIntent', () => {
  test.each([
    ['sites with Elementor', 'both'],
    ['which sites have WooCommerce', 'both'],
    ['running PHP 7.4', 'both'],
    ['on WP 6.9', 'both'],
    ['plugin installed', 'both'],
    ['theme active', 'both'],
    ['version 3.2', 'both'],
  ])('"%s" → %s (metadata signal present)', (query, expected) => {
    expect(classifyIntent(query)).toBe(expected);
  });

  test.each([
    ['customer onboarding flow', 'content'],
    ['pricing strategy', 'content'],
    ['getting started guide', 'content'],
    ['welcome email series', 'content'],
  ])('"%s" → content (no metadata signal)', (query, expected) => {
    expect(classifyIntent(query)).toBe(expected);
  });
});
