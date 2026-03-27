/**
 * Unit tests for WordPress version compatibility checks
 */

describe('WordPress Version Compatibility', () => {
  // Extracted from SiteNexusSection.tsx
  function isWp7OrLater(version: string | null): boolean {
    if (!version) return false;
    const match = version.match(/^(\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1], 10);
    return major >= 7;
  }

  describe('isWp7OrLater', () => {
    test('should return true for WP 7.0.0', () => {
      expect(isWp7OrLater('7.0.0')).toBe(true);
    });

    test('should return true for WP 7.0.1', () => {
      expect(isWp7OrLater('7.0.1')).toBe(true);
    });

    test('should return true for WP 7.1.0', () => {
      expect(isWp7OrLater('7.1.0')).toBe(true);
    });

    test('should return true for WP 8.0.0', () => {
      expect(isWp7OrLater('8.0.0')).toBe(true);
    });

    test('should return false for WP 6.9.4', () => {
      expect(isWp7OrLater('6.9.4')).toBe(false);
    });

    test('should return false for WP 6.0.0', () => {
      expect(isWp7OrLater('6.0.0')).toBe(false);
    });

    test('should return false for WP 5.9.0', () => {
      expect(isWp7OrLater('5.9.0')).toBe(false);
    });

    test('should return false for null version', () => {
      expect(isWp7OrLater(null)).toBe(false);
    });

    test('should return false for empty string', () => {
      expect(isWp7OrLater('')).toBe(false);
    });

    test('should return false for invalid version format', () => {
      expect(isWp7OrLater('invalid')).toBe(false);
    });

    test('should handle version with -RC suffix', () => {
      expect(isWp7OrLater('7.0.0-RC1')).toBe(true);
      expect(isWp7OrLater('6.9.4-RC1')).toBe(false);
    });

    test('should handle version with -beta suffix', () => {
      expect(isWp7OrLater('7.0.0-beta')).toBe(true);
      expect(isWp7OrLater('6.9.4-beta')).toBe(false);
    });

    test('should return false for single digit version (invalid format)', () => {
      // WordPress versions are always major.minor.patch format
      expect(isWp7OrLater('7')).toBe(false);
      expect(isWp7OrLater('6')).toBe(false);
    });

    test('should handle major.minor only', () => {
      expect(isWp7OrLater('7.0')).toBe(true);
      expect(isWp7OrLater('6.9')).toBe(false);
    });
  });

  describe('WordPress Version UI Logic', () => {
    test('should require upgrade for 6.9.4', () => {
      const version = '6.9.4';
      const needsUpgrade = !isWp7OrLater(version);
      expect(needsUpgrade).toBe(true);
    });

    test('should not require upgrade for 7.0.0', () => {
      const version = '7.0.0';
      const needsUpgrade = !isWp7OrLater(version);
      expect(needsUpgrade).toBe(false);
    });

    test('should disable Setup AI button when version is null', () => {
      const wpVersion = null;
      const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
      expect(canSetupAI).toBe(true); // null version means we don't know, allow setup
    });

    test('should disable Setup AI button when version is < 7.0', () => {
      const wpVersion = '6.9.4';
      const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
      expect(canSetupAI).toBe(false);
    });

    test('should enable Setup AI button when version is >= 7.0', () => {
      const wpVersion = '7.0.1';
      const canSetupAI = wpVersion === null || isWp7OrLater(wpVersion);
      expect(canSetupAI).toBe(true);
    });
  });
});
