/**
 * Tests for credential redaction utilities
 */
import {
  redactCredentials,
  redactCredentialsFromObject,
  safeJsonStringify,
} from '../../../src/main/mcp/security/credential-redaction';

describe('Credential Redaction', () => {
  describe('redactCredentials', () => {
    it('should redact OpenAI API keys', () => {
      const text = 'Using key: sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Using key: sk-***REDACTED***');
      expect(redacted).not.toContain('sk-123456');
    });

    it('should redact Anthropic API keys', () => {
      const text = 'Error: sk-ant-api03_abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Error: sk-ant-***REDACTED***');
    });

    it('should redact Google API keys', () => {
      // Google API keys are 39 chars: AIza + 35 chars
      const text = 'Google key: AIzaSyD1234567890abcdefghijklmnopqrstuv';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Google key: AIza***REDACTED***');
    });

    it('should redact passwords in key=value format', () => {
      const text = 'Config: password="mySecretPassword123"';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Config: password="***REDACTED***"');
      expect(redacted).not.toContain('mySecret');
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer abc123def456ghi789jkl012mno345';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Authorization: Bearer ***REDACTED***');
    });

    it('should redact database connection strings', () => {
      const text = 'mysql://user:mypassword@localhost:3306/database';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('mysql://user:***REDACTED***@localhost:3306/database');
      expect(redacted).not.toContain('mypassword');
    });

    it('should redact JWT tokens', () => {
      const text = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const redacted = redactCredentials(text);
      expect(redacted).toBe('Token: eyJ***.eyJ***.***REDACTED***');
    });

    it('should not modify non-sensitive text', () => {
      const text = 'This is a normal log message without credentials';
      const redacted = redactCredentials(text);
      expect(redacted).toBe(text);
    });

    it('should handle empty strings', () => {
      expect(redactCredentials('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(redactCredentials(null as any)).toBe(null);
      expect(redactCredentials(undefined as any)).toBe(undefined);
    });
  });

  describe('redactCredentialsFromObject', () => {
    it('should redact string values in objects', () => {
      const obj = {
        message: 'Error with key: sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL',
        status: 'failed',
      };
      const redacted = redactCredentialsFromObject(obj) as any;
      expect(redacted.message).toBe('Error with key: sk-***REDACTED***');
      expect(redacted.status).toBe('failed');
    });

    it('should redact sensitive field names', () => {
      const obj = {
        apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL',
        username: 'admin',
        password: 'secret123',
      };
      const redacted = redactCredentialsFromObject(obj) as any;
      expect(redacted.apiKey).toBe('***REDACTED***');
      expect(redacted.password).toBe('***REDACTED***');
      expect(redacted.username).toBe('admin');
    });

    it('should recursively redact nested objects', () => {
      const obj = {
        user: {
          name: 'admin',
          token: 'Bearer abc123def456ghi789jkl012mno345',
        },
        config: {
          api_key: 'sk-test123',
        },
      };
      const redacted = redactCredentialsFromObject(obj) as any;
      expect(redacted.user.name).toBe('admin');
      expect(redacted.user.token).toBe('***REDACTED***');
      expect(redacted.config.api_key).toBe('***REDACTED***');
    });

    it('should handle arrays', () => {
      const obj = {
        logs: [
          'Normal log',
          'Error: sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL',
        ],
      };
      const redacted = redactCredentialsFromObject(obj) as any;
      expect(redacted.logs[0]).toBe('Normal log');
      expect(redacted.logs[1]).toBe('Error: sk-***REDACTED***');
    });

    it('should preserve non-object types', () => {
      expect(redactCredentialsFromObject(null)).toBe(null);
      expect(redactCredentialsFromObject(undefined)).toBe(undefined);
      expect(redactCredentialsFromObject(123)).toBe(123);
      expect(redactCredentialsFromObject(true)).toBe(true);
    });
  });

  describe('safeJsonStringify', () => {
    it('should stringify with redaction', () => {
      const obj = {
        message: 'Error',
        apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL',
      };
      const json = safeJsonStringify(obj);
      const parsed = JSON.parse(json);
      expect(parsed.apiKey).toBe('***REDACTED***');
      expect(parsed.message).toBe('Error');
    });

    it('should handle circular references', () => {
      const obj: any = { name: 'test' };
      obj.self = obj;
      const result = safeJsonStringify(obj);
      expect(result).toBe('[Object with circular references - cannot stringify]');
    });

    it('should use custom indent', () => {
      const obj = { key: 'value' };
      const json = safeJsonStringify(obj, 4);
      expect(json).toContain('    '); // 4-space indent
    });
  });
});
