/**
 * Security tests for remote WP-CLI execution
 */
import { isBlockedCommand } from '../../../src/main/mcp/modules/wp-cli/remote-exec';

describe('Remote WP-CLI Security', () => {
  describe('isBlockedCommand', () => {
    it('should block eval commands', () => {
      expect(isBlockedCommand(['eval', 'echo "test"'])).toBe('eval');
      // eval-file starts with 'eval' so it matches the first blocked command
      expect(isBlockedCommand(['eval-file', 'test.php'])).toBe('eval');
    });

    it('should block shell commands', () => {
      expect(isBlockedCommand(['shell'])).toBe('shell');
    });

    it('should block direct database access', () => {
      expect(isBlockedCommand(['db', 'query', 'SELECT * FROM wp_users'])).toBe('db query');
      expect(isBlockedCommand(['db', 'cli'])).toBe('db cli');
    });

    it('should allow whitelisted plugin commands', () => {
      expect(isBlockedCommand(['plugin', 'list'])).toBeNull();
      expect(isBlockedCommand(['plugin', 'install', 'akismet'])).toBeNull();
      expect(isBlockedCommand(['plugin', 'activate', 'akismet'])).toBeNull();
      expect(isBlockedCommand(['plugin', 'deactivate', 'akismet'])).toBeNull();
      expect(isBlockedCommand(['plugin', 'update', 'akismet'])).toBeNull();
    });

    it('should allow whitelisted theme commands', () => {
      expect(isBlockedCommand(['theme', 'list'])).toBeNull();
    });

    it('should allow whitelisted core commands', () => {
      expect(isBlockedCommand(['core', 'version'])).toBeNull();
    });

    it('should allow whitelisted user commands', () => {
      expect(isBlockedCommand(['user', 'list'])).toBeNull();
    });

    it('should allow whitelisted option commands', () => {
      expect(isBlockedCommand(['option', 'get', 'siteurl'])).toBeNull();
    });

    it('should allow whitelisted site health commands', () => {
      expect(isBlockedCommand(['site', 'health'])).toBeNull();
    });

    it('should block non-whitelisted commands', () => {
      const result = isBlockedCommand(['post', 'create']);
      expect(result).toContain('post create');
      expect(result).toContain('not allowed');
    });

    it('should block config commands', () => {
      const result = isBlockedCommand(['config', 'set']);
      expect(result).toContain('not allowed');
    });

    it('should block cache commands', () => {
      const result = isBlockedCommand(['cache', 'flush']);
      expect(result).toContain('not allowed');
    });

    it('should be case-insensitive for blocklist', () => {
      expect(isBlockedCommand(['EVAL', 'echo "test"'])).toBe('eval');
      expect(isBlockedCommand(['Eval', 'echo "test"'])).toBe('eval');
    });

    it('should be case-insensitive for whitelist', () => {
      expect(isBlockedCommand(['PLUGIN', 'LIST'])).toBeNull();
      expect(isBlockedCommand(['Plugin', 'List'])).toBeNull();
    });

    it('should handle command injection attempts', () => {
      // These would be caught by slug validation in preflight, but test here too
      const result1 = isBlockedCommand(['plugin', 'install', 'test; rm -rf /']);
      const result2 = isBlockedCommand(['plugin', 'install', 'test && cat /etc/passwd']);

      // These should still be allowed (slug validation will catch the malicious payload)
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });
});
