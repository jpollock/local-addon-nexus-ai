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
test('WP_KNOWLEDGE includes WP 7.0 as current stable — regression guard against hallucination', () => {
  const prompt = buildWordPressSystemPrompt({ mode: 'fleet', localSiteCount: 1, wpeSiteCount: 0, indexedCount: 1 });
  expect(prompt).toContain('WordPress 7.0');
  expect(prompt).toContain('Current stable');
  // The prompt tells the model not to flag 7.0 as a problem
  expect(prompt).toContain('do NOT flag as unrecognized');
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

// PHP unknown — context-aware message tests
test('site prompt with null PHP and full scanDepth says "running" not "start the site"', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: '7.0', scanDepth: 'full', indexState: 'indexed',
  });
  expect(prompt).toContain('site is running');
  expect(prompt).not.toMatch(/start the site to determine/i);
});

test('site prompt with siteStatus=running says "running" not "start the site"', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: '7.0', siteStatus: 'running', indexState: 'indexed',
  });
  expect(prompt).toContain('RUNNING');
  expect(prompt).toContain('site is running');
  expect(prompt).not.toMatch(/start the site to determine/i);
});

test('site prompt with siteStatus=halted says "start the site"', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: '7.0', siteStatus: 'halted', indexState: 'not_indexed',
  });
  expect(prompt).toContain('HALTED');
  expect(prompt).toContain('start the site to determine');
});

test('site prompt with null PHP and filesystem scanDepth says "start the site"', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: '7.0', scanDepth: 'filesystem', indexState: 'not_indexed',
  });
  expect(prompt).toContain('start the site to determine');
});

test('site prompt with null PHP and no scanDepth (halted, no data) says "start the site"', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: null, scanDepth: undefined, indexState: 'not_indexed',
  });
  expect(prompt).toContain('start the site to determine');
});

test('site prompt with known PHP version does not include PHP-unknown guidance', () => {
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: '8.2', wpVersion: '7.0', scanDepth: 'full', indexState: 'indexed',
  });
  expect(prompt).toContain('8.2');
  // The PHP line should not contain any "unknown" fallback text
  expect(prompt).not.toContain('could not be determined');
  expect(prompt).not.toContain('start the site to determine version');
});

test('JSON format example does not contain hardcoded "start site for details"', () => {
  // Regression guard: the format example previously trained the model to say
  // "start site for details" even when the site was already running.
  const prompt = buildWordPressSystemPrompt({
    mode: 'site', siteId: 'abc', siteName: 'mysite',
    phpVersion: null, wpVersion: '7.0', scanDepth: 'full', indexState: 'indexed',
  }, false); // agentMode=false includes the JSON format section
  expect(prompt).not.toContain('PHP version unknown (start site for details)');
});
