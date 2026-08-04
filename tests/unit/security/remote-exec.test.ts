/**
 * Security tests for remote WP-CLI execution
 */
import { checkCommand, REMOTE_POLICY } from '../../../src/main/transport/policy';

describe('Remote WP-CLI Security', () => {
  describe('checkCommand with REMOTE_POLICY', () => {
    it('should block eval commands', () => {
      expect(checkCommand(['eval', 'echo "test"'], REMOTE_POLICY)).toBe('eval');
      // eval-file starts with 'eval' so it matches the first blocked command
      expect(checkCommand(['eval-file', 'test.php'], REMOTE_POLICY)).toBe('eval');
    });

    it('should block shell commands', () => {
      expect(checkCommand(['shell'], REMOTE_POLICY)).toBe('shell');
    });

    it('should block direct database access', () => {
      expect(checkCommand(['db', 'query', 'SELECT * FROM wp_users'], REMOTE_POLICY)).toBe('db query');
      expect(checkCommand(['db', 'cli'], REMOTE_POLICY)).toBe('db cli');
    });

    it('should allow plugin commands (no whitelist)', () => {
      expect(checkCommand(['plugin', 'list'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'install', 'akismet'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'activate', 'akismet'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'deactivate', 'akismet'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'update', 'akismet'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow theme commands (no whitelist)', () => {
      expect(checkCommand(['theme', 'list'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['theme', 'activate', 'twentytwentyfour'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow core commands (no whitelist)', () => {
      expect(checkCommand(['core', 'version'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['core', 'update'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow user commands (no whitelist)', () => {
      expect(checkCommand(['user', 'list'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow option commands (no whitelist)', () => {
      expect(checkCommand(['option', 'get', 'siteurl'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow site health commands (no whitelist)', () => {
      expect(checkCommand(['site', 'health'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow post commands (previously blocked by whitelist)', () => {
      expect(checkCommand(['post', 'create'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['post', 'update', '1'], REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['post', 'delete', '1'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow config commands (no whitelist)', () => {
      expect(checkCommand(['config', 'set'], REMOTE_POLICY)).toBeNull();
    });

    it('should allow cache commands (no whitelist)', () => {
      expect(checkCommand(['cache', 'flush'], REMOTE_POLICY)).toBeNull();
    });

    it('should be case-insensitive for blocklist', () => {
      expect(checkCommand(['EVAL', 'echo "test"'], REMOTE_POLICY)).toBe('eval');
      expect(checkCommand(['Eval', 'echo "test"'], REMOTE_POLICY)).toBe('eval');
    });

    it('should handle command injection attempts', () => {
      // These would be caught by slug validation in preflight, but test here too
      const result1 = checkCommand(['plugin', 'install', 'test; rm -rf /'], REMOTE_POLICY);
      const result2 = checkCommand(['plugin', 'install', 'test && cat /etc/passwd'], REMOTE_POLICY);

      // These should still be allowed (slug validation will catch the malicious payload)
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });
});
