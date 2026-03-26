/**
 * Input Validators
 *
 * Additional validation utilities beyond Zod schemas.
 * Used for sanitizing inputs to prevent injection attacks.
 */

/**
 * Sanitize WP-CLI arguments to prevent command injection.
 *
 * Only allows safe characters: alphanumeric, dash, underscore, dot, slash, @, colon
 * Throws if argument contains shell metacharacters.
 */
export function sanitizeWpCliArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new Error(`WP-CLI argument must be a string, got ${typeof arg}`);
  }

  // Allow: a-z A-Z 0-9 - _ . / @ :
  // Block: ; | & $ ` ' " \ ( ) { } [ ] < > * ? ~ ! # % ^ space
  const safePattern = /^[a-zA-Z0-9_\-\.\/\@\:]+$/;

  if (!safePattern.test(arg)) {
    throw new Error(
      `Unsafe WP-CLI argument: "${arg}". Only alphanumeric, dash, underscore, dot, slash, @, and colon allowed.`,
    );
  }

  return arg;
}

/**
 * Sanitize an array of WP-CLI arguments.
 */
export function sanitizeWpCliArgs(args: string[]): string[] {
  return args.map(sanitizeWpCliArg);
}

/**
 * Validate that a path is safe (doesn't escape directory).
 *
 * Blocks: ../, absolute paths, special characters
 */
export function validateSafePath(path: string): string {
  if (typeof path !== 'string') {
    throw new Error(`Path must be a string, got ${typeof path}`);
  }

  // Block parent directory traversal
  if (path.includes('../') || path.includes('..\\')) {
    throw new Error(`Path contains parent directory traversal: "${path}"`);
  }

  // Block absolute paths
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`Absolute paths not allowed: "${path}"`);
  }

  // Block null bytes (directory traversal technique)
  if (path.includes('\0')) {
    throw new Error(`Path contains null byte: "${path}"`);
  }

  return path;
}

/**
 * Validate email address format.
 */
export function validateEmail(email: string): string {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    throw new Error(`Invalid email format: "${email}"`);
  }

  return email;
}

/**
 * Validate URL format and protocol.
 *
 * Only allows http:// and https://
 */
export function validateUrl(url: string, allowedProtocols: string[] = ['http:', 'https:']): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`Invalid URL format: "${url}"`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `Invalid URL protocol: "${parsed.protocol}". Allowed: ${allowedProtocols.join(', ')}`,
    );
  }

  return url;
}

/**
 * Validate that value is within numeric range.
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  name = 'value',
): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${name} must be a number, got ${typeof value}`);
  }

  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got ${value}`);
  }

  return value;
}

/**
 * Validate that string length is within range.
 */
export function validateLength(
  str: string,
  min: number,
  max: number,
  name = 'string',
): string {
  if (typeof str !== 'string') {
    throw new Error(`${name} must be a string, got ${typeof str}`);
  }

  if (str.length < min || str.length > max) {
    throw new Error(`${name} length must be between ${min} and ${max}, got ${str.length}`);
  }

  return str;
}
