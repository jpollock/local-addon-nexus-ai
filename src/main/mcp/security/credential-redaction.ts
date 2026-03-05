/**
 * Credential Redaction Utilities
 *
 * Sanitizes log output to prevent exposure of sensitive credentials including:
 * - API keys (OpenAI, Anthropic, Google, generic)
 * - Passwords
 * - Authentication tokens
 * - Bearer tokens
 * - SSH keys
 * - Database credentials
 */

// Redaction patterns for common credential formats
const REDACTION_PATTERNS = [
  // OpenAI API keys: sk-... (48+ chars)
  { pattern: /sk-[a-zA-Z0-9]{48,}/g, replacement: 'sk-***REDACTED***' },

  // Anthropic API keys: sk-ant-api... (longer format)
  { pattern: /sk-ant-api[a-zA-Z0-9_-]{40,}/g, replacement: 'sk-ant-***REDACTED***' },

  // Google API keys: AIza... (39 chars)
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replacement: 'AIza***REDACTED***' },

  // Generic API keys in key=value format
  { pattern: /(api[_-]?key['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },

  // Passwords in key=value format
  { pattern: /(password['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },
  { pattern: /(passwd['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },
  { pattern: /(pwd['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },

  // Tokens in key=value format
  { pattern: /(token['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },
  { pattern: /(auth['"]?\s*[:=]\s*['"])([^'"]+)(['"])/gi, replacement: '$1***REDACTED***$3' },

  // Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/gi, replacement: 'Bearer ***REDACTED***' },
  { pattern: /(Authorization:\s*Bearer\s+)[a-zA-Z0-9_-]{20,}/gi, replacement: '$1***REDACTED***' },

  // SSH private keys (BEGIN/END blocks)
  { pattern: /-----BEGIN ([A-Z ]+PRIVATE KEY)-----.+?-----END \1-----/gs, replacement: '-----BEGIN $1-----\n***REDACTED***\n-----END $1-----' },

  // Database connection strings
  { pattern: /(mysql:\/\/|postgres:\/\/|mongodb:\/\/)([^:]+):([^@]+)@/gi, replacement: '$1$2:***REDACTED***@' },

  // JWT tokens (three base64 segments separated by dots)
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: 'eyJ***.eyJ***.***REDACTED***' },
];

/**
 * Redacts sensitive credentials from a text string.
 * Safe to use on any log output - won't modify non-sensitive data.
 *
 * @param text - Text that may contain sensitive credentials
 * @returns Sanitized text with credentials redacted
 */
export function redactCredentials(text: string): string {
  if (!text) return text;

  let redacted = text;

  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }

  return redacted;
}

/**
 * Redacts credentials from an object by recursively processing all string values.
 * Creates a deep copy - does not modify the original object.
 *
 * @param obj - Object that may contain sensitive data
 * @returns New object with credentials redacted
 */
export function redactCredentialsFromObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactCredentials(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactCredentialsFromObject);
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Redact keys that are commonly sensitive
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('auth')
      ) {
        redacted[key] = '***REDACTED***';
      } else {
        redacted[key] = redactCredentialsFromObject(value);
      }
    }

    return redacted;
  }

  return obj;
}

/**
 * Safely formats an object for logging with credential redaction.
 * Useful for debugging while ensuring sensitive data never appears in logs.
 *
 * @param obj - Object to format for logging
 * @param indent - Indentation for pretty printing (default: 2 spaces)
 * @returns JSON string with credentials redacted
 */
export function safeJsonStringify(obj: unknown, indent = 2): string {
  try {
    const redacted = redactCredentialsFromObject(obj);
    return JSON.stringify(redacted, null, indent);
  } catch (err) {
    return '[Object with circular references - cannot stringify]';
  }
}

/**
 * List of field names that should always be redacted in logs.
 * Use with structured logging to automatically redact these fields.
 */
export const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwd',
  'pwd',
  'apiKey',
  'api_key',
  'token',
  'secret',
  'privateKey',
  'private_key',
  'authorization',
  'auth',
  'credentials',
  'bearer',
];
