const { findForbiddenPublishFiles } = require('../../../scripts/publish-guard-core');

describe('findForbiddenPublishFiles (P0-4 npm-publish guard)', () => {
  it('flags ACF PRO paths anywhere in the publish set (top-level and lib/)', () => {
    const paths = [
      'lib/index.js',
      'wp-plugins/advanced-custom-fields-pro/acf.php',
      'lib/wp-plugins/advanced-custom-fields-pro/pro/updates.php',
    ];
    expect(findForbiddenPublishFiles(paths)).toEqual([
      'wp-plugins/advanced-custom-fields-pro/acf.php',
      'lib/wp-plugins/advanced-custom-fields-pro/pro/updates.php',
    ]);
  });

  it('matches a whole path segment, not a substring — a similarly named file is not flagged', () => {
    const paths = [
      'wp-plugins/ai/ai.php',
      'wp-plugins/nexus-ai-connector/nexus-ai-connector.php',
      'docs/advanced-custom-fields-pro.md',
    ];
    expect(findForbiddenPublishFiles(paths)).toEqual([]);
  });

  it('handles Windows-style separators', () => {
    expect(findForbiddenPublishFiles(['lib\\wp-plugins\\advanced-custom-fields-pro\\acf.php'])).toHaveLength(1);
  });

  it('returns empty for empty or undefined input', () => {
    expect(findForbiddenPublishFiles([])).toEqual([]);
    expect(findForbiddenPublishFiles(undefined)).toEqual([]);
  });
});
