import { isPhpEol, getPhpEolDate, isWpOutdated, PLUGIN_CATEGORIES, buildWordPressSystemPrompt } from '../../../src/main/assistant/wordpress-knowledge';

test('PHP 7.4 is EOL', () => expect(isPhpEol('7.4')).toBe(true));
test('PHP 8.2 is not EOL', () => expect(isPhpEol('8.2')).toBe(false));
test('PHP 7.4 EOL date contains 2022 or 2023', () => {
  const date = getPhpEolDate('7.4');
  expect(date).toBeTruthy();
  expect(date).toMatch(/202[23]/);
});
test('PHP 5.6 is EOL', () => expect(isPhpEol('5.6')).toBe(true));
test('PHP 8.3 is not EOL', () => expect(isPhpEol('8.3')).toBe(false));
test('WP 5.9 is outdated relative to 6.9', () => expect(isWpOutdated('5.9', '6.9')).toBe(true));
test('WP 6.9 is not outdated relative to itself', () => expect(isWpOutdated('6.9', '6.9')).toBe(false));
test('form-builder category has known slugs', () => {
  expect(PLUGIN_CATEGORIES['form-builder']).toContain('contact-form-7');
  expect(PLUGIN_CATEGORIES['form-builder']).toContain('gravityforms');
});
test('page-builder category contains elementor', () => {
  expect(PLUGIN_CATEGORIES['page-builder']).toContain('elementor');
});
test('fleet system prompt includes PHP EOL and site counts', () => {
  const prompt = buildWordPressSystemPrompt({ mode: 'fleet', localSiteCount: 14, wpeSiteCount: 281, indexedCount: 97 });
  expect(prompt).toContain('PHP 7.4');
  expect(prompt).toContain('end-of-life');
  expect(prompt).toContain('14');
  expect(prompt).toContain('JSON');
});
test('site system prompt includes site name and PHP version', () => {
  const prompt = buildWordPressSystemPrompt({ mode: 'site', siteId: 'abc', siteName: 'acme-prod', phpVersion: '7.4', wpVersion: '6.9', pluginCount: 14, indexState: 'indexed' });
  expect(prompt).toContain('acme-prod');
  expect(prompt).toContain('7.4');
});
