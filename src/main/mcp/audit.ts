import * as fs from 'fs';
import * as path from 'path';
import type { SafetyTier } from './safety';
import { rotateIfNeeded, DEFAULT_MAX_BYTES, DEFAULT_KEEP } from '../logging/rotate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  tier: SafetyTier;
  params: Record<string, unknown>;
  confirmed: boolean | null;
  result: 'success' | 'error' | 'confirmation_required';
  error?: string;
  duration_ms: number;
}

export interface AuditLogger {
  log(entry: AuditEntry): void;
  getEntries(): AuditEntry[];
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redaction — key-name based
// ---------------------------------------------------------------------------

/**
 * Substrings that are unambiguous anywhere inside a key name. These are long
 * enough that an accidental match on an ordinary field is implausible.
 */
const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'privatekey',
  'private_key',
  'certificate',
  'authorization',
  'bearer',
  'signature',
];

/**
 * Words that are sensitive as a whole token but dangerous as a substring:
 * `'author'.includes('auth')` and `'monkey'.includes('key')` are both true, and
 * plugin `author` / `monkey`-ish fields are ordinary audit content. Keys are
 * tokenized (camelCase + separators) before matching against this set.
 */
const SENSITIVE_TOKENS = new Set([
  'pass',
  'passwd',
  'password',
  'pwd',
  'auth',
  'authorization',
  'bearer',
  'key',
  'keys',
  'apikey',
  'token',
  'secret',
  'salt',
  'cookie',
  'cookies',
  'session',
  'credential',
  'credentials',
  'signature',
  'sig',
  'certificate',
  'cert',
]);

/** Split `sshKeyId` / `db_pass` / `API-KEY` into lowercase word tokens. */
function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_SUBSTRINGS.some((p) => lower.includes(p))) return true;
  return tokenizeKey(key).some((t) => SENSITIVE_TOKENS.has(t));
}

// ---------------------------------------------------------------------------
// Redaction — value shape based
// ---------------------------------------------------------------------------

/**
 * Key-name matching structurally cannot protect payloads that *are* code or
 * free text: `wp_eval`'s argument is literally named `code`, and a failed
 * WP-CLI / CAPI call puts raw tool output in `error`. Both routinely embed
 * credentials. These patterns mask by value shape regardless of key name.
 *
 * Bias: match only shapes that are recognisably credentials. A false positive
 * costs one masked string in an audit entry; a false negative writes a live
 * key to disk.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // PEM blocks (private keys, certificates) — always multi-line, never prose.
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
  // OpenAI / Anthropic style: sk-, sk-proj-, sk-ant-api03-...
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  // GitHub personal access tokens and the classic ghp_/gho_/ghu_/ghs_/ghr_ set.
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API key.
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Slack tokens.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // `Authorization: Bearer <token>` headers echoed into error output.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

/** `password=hunter2`, `--api-key: 'sk...'`, `token => "..."` inside a string. */
const INLINE_ASSIGNMENT =
  /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token)['"]?\s*(?:=>|[=:])\s*)(['"]?)([^\s'",;)&]{4,})\2/gi;

/** `scheme://user:password@host` connection strings in raw tool output. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]{3,})@/gi;

/**
 * A 40+ character unbroken alphanumeric run containing both letters and
 * digits. Ordinary prose, slugs and paths break on separators long before 40
 * characters; opaque tokens and hashes do not.
 */
const LONG_OPAQUE_RUN = /\b[A-Za-z0-9+/]{40,}={0,2}/g;

/** Strings longer than this are truncated in audit entries. */
export const MAX_AUDIT_STRING_LENGTH = 2000;

export const REDACTED = '[REDACTED]';

/**
 * Mask credential-shaped substrings inside an arbitrary string, then bound its
 * length. Never throws.
 */
export function maskSecretsInString(value: string): string {
  let out = value;
  try {
    for (const re of SECRET_VALUE_PATTERNS) {
      out = out.replace(re, REDACTED);
    }
    out = out.replace(INLINE_ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`);
    out = out.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
    out = out.replace(LONG_OPAQUE_RUN, (m: string) =>
      /[A-Za-z]/.test(m) && /[0-9]/.test(m) ? REDACTED : m,
    );
    if (out.length > MAX_AUDIT_STRING_LENGTH) {
      const dropped = out.length - MAX_AUDIT_STRING_LENGTH;
      out = `${out.slice(0, MAX_AUDIT_STRING_LENGTH)}…[truncated ${dropped} chars]`;
    }
  } catch {
    return REDACTED; // a pathological input must not break the audit path
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redaction — recursive walk
// ---------------------------------------------------------------------------

function redactValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return maskSecretsInString(value);
  }
  if (value !== null && typeof value === 'object') {
    // Agent-supplied args can be cyclic; unguarded recursion would blow the
    // stack inside a path whose whole contract is "never throws".
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.map((item, i) => redactValue(String(i), item, seen));
    }
    return redactObject(value as Record<string, unknown>, seen);
  }
  return value;
}

function redactObject(
  params: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    redacted[k] = redactValue(k, v, seen);
  }
  return redacted;
}

export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>();
  if (params !== null && typeof params === 'object') seen.add(params);
  return redactObject(params, seen);
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export function createAuditLogger(
  logPath?: string,
  opts?: { maxBytes?: number; keep?: number },
): AuditLogger {
  const entries: AuditEntry[] = [];
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = opts?.keep ?? DEFAULT_KEEP;

  return {
    log(entry: AuditEntry): void {
      const redacted: AuditEntry = {
        ...entry,
        params: redactParams(entry.params ?? {}),
        ...(entry.error !== undefined ? { error: maskSecretsInString(String(entry.error)) } : {}),
      };
      entries.push(redacted);
    },

    getEntries(): AuditEntry[] {
      return [...entries];
    },

    async flush(): Promise<void> {
      if (!logPath || entries.length === 0) return;
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // This file is the higher-volume of the two audit files (all three tiers,
      // every dispatch surface, full params). Without this it is the only
      // durable writer in the addon with no size cap.
      rotateIfNeeded(logPath, maxBytes, keep);
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(logPath, lines, { encoding: 'utf-8', mode: 0o600 });
      entries.length = 0;
    },
  };
}
