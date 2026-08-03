/**
 * Security tests for remote WP-CLI execution
 */
import { checkCommand, MCP_REMOTE_POLICY } from '../../../src/main/transport/policy';

describe('Remote WP-CLI Security', () => {
  describe('checkCommand with MCP_REMOTE_POLICY', () => {
    it('should block eval commands', () => {
      expect(checkCommand(['eval', 'echo "test"'], MCP_REMOTE_POLICY)).toBe('eval');
      // eval-file starts with 'eval' so it matches the first blocked command
      expect(checkCommand(['eval-file', 'test.php'], MCP_REMOTE_POLICY)).toBe('eval');
    });

    it('should block shell commands', () => {
      expect(checkCommand(['shell'], MCP_REMOTE_POLICY)).toBe('shell');
    });

    it('should block direct database access', () => {
      expect(checkCommand(['db', 'query', 'SELECT * FROM wp_users'], MCP_REMOTE_POLICY)).toBe('db query');
      expect(checkCommand(['db', 'cli'], MCP_REMOTE_POLICY)).toBe('db cli');
    });

    it('should allow whitelisted plugin commands', () => {
      expect(checkCommand(['plugin', 'list'], MCP_REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'install', 'akismet'], MCP_REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'activate', 'akismet'], MCP_REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'deactivate', 'akismet'], MCP_REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['plugin', 'update', 'akismet'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should allow whitelisted theme commands', () => {
      expect(checkCommand(['theme', 'list'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should allow whitelisted core commands', () => {
      expect(checkCommand(['core', 'version'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should allow whitelisted user commands', () => {
      expect(checkCommand(['user', 'list'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should allow whitelisted option commands', () => {
      expect(checkCommand(['option', 'get', 'siteurl'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should allow whitelisted site health commands', () => {
      expect(checkCommand(['site', 'health'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should block non-whitelisted commands', () => {
      const result = checkCommand(['post', 'create'], MCP_REMOTE_POLICY);
      expect(result).toContain('post create');
      expect(result).toContain('not allowed');
    });

    it('should block config commands', () => {
      const result = checkCommand(['config', 'set'], MCP_REMOTE_POLICY);
      expect(result).toContain('not allowed');
    });

    it('should block cache commands', () => {
      const result = checkCommand(['cache', 'flush'], MCP_REMOTE_POLICY);
      expect(result).toContain('not allowed');
    });

    it('should be case-insensitive for blocklist', () => {
      expect(checkCommand(['EVAL', 'echo "test"'], MCP_REMOTE_POLICY)).toBe('eval');
      expect(checkCommand(['Eval', 'echo "test"'], MCP_REMOTE_POLICY)).toBe('eval');
    });

    it('should be case-insensitive for whitelist', () => {
      expect(checkCommand(['PLUGIN', 'LIST'], MCP_REMOTE_POLICY)).toBeNull();
      expect(checkCommand(['Plugin', 'List'], MCP_REMOTE_POLICY)).toBeNull();
    });

    it('should handle command injection attempts', () => {
      // These would be caught by slug validation in preflight, but test here too
      const result1 = checkCommand(['plugin', 'install', 'test; rm -rf /'], MCP_REMOTE_POLICY);
      const result2 = checkCommand(['plugin', 'install', 'test && cat /etc/passwd'], MCP_REMOTE_POLICY);

      // These should still be allowed (slug validation will catch the malicious payload)
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });
});
