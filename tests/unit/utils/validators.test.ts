/**
 * Tests for Input Validators
 */
import {
  sanitizeWpCliArg,
  sanitizeWpCliArgs,
  validateSafePath,
  validateEmail,
  validateUrl,
  validateRange,
  validateLength,
} from '../../../src/main/utils/validators';

describe('Input Validators', () => {
  describe('sanitizeWpCliArg', () => {
    it('should allow safe arguments', () => {
      expect(sanitizeWpCliArg('akismet')).toBe('akismet');
      expect(sanitizeWpCliArg('plugin-name')).toBe('plugin-name');
      expect(sanitizeWpCliArg('file.php')).toBe('file.php');
      expect(sanitizeWpCliArg('path/to/file')).toBe('path/to/file');
      expect(sanitizeWpCliArg('user@example.com')).toBe('user@example.com');
      expect(sanitizeWpCliArg('port:3000')).toBe('port:3000');
    });

    it('should block shell metacharacters', () => {
      expect(() => sanitizeWpCliArg('plugin; rm -rf /')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin | cat /etc/passwd')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin && evil')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin`command`')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg("plugin'test'")).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin$VAR')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin (test)')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin<input')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin>output')).toThrow('Unsafe WP-CLI argument');
      expect(() => sanitizeWpCliArg('plugin*glob')).toThrow('Unsafe WP-CLI argument');
    });

    it('should block spaces', () => {
      expect(() => sanitizeWpCliArg('plugin name')).toThrow('Unsafe WP-CLI argument');
    });

    it('should handle non-string input', () => {
      expect(() => sanitizeWpCliArg(123 as any)).toThrow('must be a string');
      expect(() => sanitizeWpCliArg(null as any)).toThrow('must be a string');
    });
  });

  describe('sanitizeWpCliArgs', () => {
    it('should sanitize array of arguments', () => {
      const args = ['plugin', 'install', 'akismet'];
      expect(sanitizeWpCliArgs(args)).toEqual(args);
    });

    it('should throw if any argument is unsafe', () => {
      const args = ['plugin', 'install', 'akismet; rm -rf /'];
      expect(() => sanitizeWpCliArgs(args)).toThrow('Unsafe WP-CLI argument');
    });
  });

  describe('validateSafePath', () => {
    it('should allow safe paths', () => {
      expect(validateSafePath('file.txt')).toBe('file.txt');
      expect(validateSafePath('dir/file.txt')).toBe('dir/file.txt');
      expect(validateSafePath('path/to/file.txt')).toBe('path/to/file.txt');
    });

    it('should block parent directory traversal', () => {
      expect(() => validateSafePath('../etc/passwd')).toThrow('parent directory traversal');
      expect(() => validateSafePath('dir/../../etc/passwd')).toThrow('parent directory traversal');
      expect(() => validateSafePath('..\\windows\\system32')).toThrow('parent directory traversal');
    });

    it('should block absolute paths', () => {
      expect(() => validateSafePath('/etc/passwd')).toThrow('Absolute paths not allowed');
      expect(() => validateSafePath('C:\\Windows\\System32')).toThrow('Absolute paths not allowed');
    });

    it('should block null bytes', () => {
      expect(() => validateSafePath('file\0.txt')).toThrow('null byte');
    });

    it('should handle non-string input', () => {
      expect(() => validateSafePath(123 as any)).toThrow('must be a string');
    });
  });

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('user@example.com')).toBe('user@example.com');
      expect(validateEmail('test.user@example.co.uk')).toBe('test.user@example.co.uk');
      expect(validateEmail('user+tag@example.com')).toBe('user+tag@example.com');
    });

    it('should reject invalid emails', () => {
      expect(() => validateEmail('not-an-email')).toThrow('Invalid email format');
      expect(() => validateEmail('@example.com')).toThrow('Invalid email format');
      expect(() => validateEmail('user@')).toThrow('Invalid email format');
      expect(() => validateEmail('user @example.com')).toThrow('Invalid email format');
    });
  });

  describe('validateUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateUrl('http://example.com')).toBe('http://example.com');
      expect(validateUrl('https://example.com/path')).toBe('https://example.com/path');
      expect(validateUrl('https://example.com:8080/path?query=value')).toBe(
        'https://example.com:8080/path?query=value',
      );
    });

    it('should reject invalid URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL format');
      expect(() => validateUrl('http://')).toThrow('Invalid URL format');
    });

    it('should reject disallowed protocols', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow('Invalid URL protocol');
      expect(() => validateUrl('file:///etc/passwd')).toThrow('Invalid URL protocol');
      expect(() => validateUrl('javascript:alert(1)')).toThrow('Invalid URL protocol');
    });

    it('should allow custom protocols', () => {
      expect(validateUrl('ftp://example.com', ['ftp:'])).toBe('ftp://example.com');
    });
  });

  describe('validateRange', () => {
    it('should accept values in range', () => {
      expect(validateRange(5, 0, 10)).toBe(5);
      expect(validateRange(0, 0, 10)).toBe(0);
      expect(validateRange(10, 0, 10)).toBe(10);
    });

    it('should reject values out of range', () => {
      expect(() => validateRange(-1, 0, 10)).toThrow('must be between 0 and 10');
      expect(() => validateRange(11, 0, 10)).toThrow('must be between 0 and 10');
    });

    it('should reject non-numbers', () => {
      expect(() => validateRange('5' as any, 0, 10)).toThrow('must be a number');
      expect(() => validateRange(NaN, 0, 10)).toThrow('must be a number');
    });
  });

  describe('validateLength', () => {
    it('should accept strings within length range', () => {
      expect(validateLength('hello', 1, 10)).toBe('hello');
      expect(validateLength('a', 1, 10)).toBe('a');
      expect(validateLength('1234567890', 1, 10)).toBe('1234567890');
    });

    it('should reject strings outside length range', () => {
      expect(() => validateLength('', 1, 10)).toThrow('length must be between 1 and 10');
      expect(() => validateLength('12345678901', 1, 10)).toThrow('length must be between 1 and 10');
    });

    it('should reject non-strings', () => {
      expect(() => validateLength(123 as any, 1, 10)).toThrow('must be a string');
    });
  });
});
