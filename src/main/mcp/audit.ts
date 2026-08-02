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
  'accesskey',
  'access_key',
  'credential',
  'privatekey',
  'private_key',
  'authorization',
  'bearer',
  'signature',
];

/**
 * Words that are sensitive as a whole token but dangerous as a substring:
 * `'author'.includes('auth')` and `'monkey'.includes('key')` are both true, and
 * plugin `author` / `monkey`-ish fields are ordinary audit content. Keys are
 * tokenized (camelCase + separators) before matching against this set.
 *
 * `key` / `keys` / `certificate` / `cert` are DELIBERATELY ABSENT.
 *
 * Tokenizing `key` inverted the log's meaning rather than protecting anything:
 * `nexus_update_settings {key: 'wpeOperationPermissions.wpcli.production',
 * value: 'true'}` recorded `key: "[REDACTED]", value: "true"` — the setting
 * *name* destroyed and the value kept, which is exactly backwards. It also
 * redacted SSH **public** keys (`{label, publicKey}`) and `{sshKeyId}`, where
 * "which key was authorized or revoked" is the entire forensic point of the
 * entry. A public certificate is not a secret for the same reason.
 *
 * Nothing is given up: the names that genuinely signal a secret (`api_key`,
 * `private_key`, `secret_key`, `access_key`, `apiKey`) still match via
 * SENSITIVE_SUBSTRINGS, and value-shape masking below still masks `{key:
 * 'sk-abc…'}` on its shape. Only names that merely *contain* the word `key`
 * now survive.
 */
const SENSITIVE_TOKENS = new Set([
  'pass',
  'passwd',
  'password',
  'pwd',
  'auth',
  'authorization',
  'bearer',
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
  // OpenAI / Anthropic / Stripe style vendor prefixes. `_` as well as `-`:
  // Stripe restricted and publishable keys are `rk_live_…` / `pk_live_…`, which
  // the `-`-only form missed entirely.
  /\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{12,}/g,
  // `key-` prefixed vendor keys. The tail must be ONE unbroken alphanumeric run
  // containing a digit, so an ordinary kebab slug (`key-value-store-manager`)
  // cannot match while `key-0a1b2c3d4e5f…` does.
  /\bkey-(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{12,}\b/g,
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

/**
 * `password=hunter2`, `--api-key: 'sk...'`, `token => "..."` inside a string.
 * `pass` is last in the alternation so `--user_pass=x` matches while
 * `--password=x` still binds to the longer, more specific branch.
 */
const INLINE_ASSIGNMENT =
  /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|pass)['"]?\s*(?:=>|[=:])\s*)(['"]?)([^\s'",;)&]{4,})\2/gi;

/**
 * PHP's `define()` separates the constant name from its value with a COMMA, so
 * INLINE_ASSIGNMENT — which anchors on `=`, `:` or `=>` — never matched it.
 * This is not a theoretical gap: every WP-CLI module embeds raw `result.stdout`
 * in its error string (`eval.ts`, `core-update.ts`, `option-get.ts`, ~20 more)
 * and `resolvers.ts` falls back to `result.stdout || result.stderr`, so a
 * failed `wp config list` wrote wp-config.php's DB password and every auth salt
 * to disk verbatim.
 *
 * The constant NAME is preserved on purpose — knowing *which* constant was
 * touched is the forensic value; only the literal is the secret.
 */
const DEFINE_ASSIGNMENT =
  /(define\(\s*['"][A-Z_]*(?:PASSWORD|PASSWD|KEY|SALT|SECRET|TOKEN)[A-Z_]*['"]\s*,\s*)(['"])([^'"]+)\2/g;

/** `scheme://user:password@host` connection strings in raw tool output. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]{3,})@/gi;

/**
 * An unbroken alphanumeric run of OPAQUE_RUN_MIN+ characters.
 *
 * This threshold used to be 40, chosen so that only hashes matched. The
 * security pass measured the consequence: ten of ten realistic credentials in
 * the 16–36 character band were written to disk verbatim — an 18-char MySQL
 * root password, a 20-char base64 Basic auth blob, a 30-char SendGrid-shaped
 * key, a 32-char Twilio auth token, a 36-char session cookie. 40 was not a
 * security boundary, it was a boundary around SHA-1.
 *
 * The charset is deliberately alphanumeric ONLY. Earlier drafts included `/`
 * and `+` for base64; that made `/opt/homebrew/Cellar/node/22` a single 27-char
 * "opaque run" and brought the Local PHP binary path to within one character of
 * being masked. Separators are what keep paths, slugs, URLs, serialized PHP and
 * table output safely fragmented, so none of them may be in the charset. A long
 * base64 blob still trips this — its alphanumeric stretches are far longer
 * than 20 — it just does so chunk by chunk.
 */
const OPAQUE_RUN_MIN = 20;
const OPAQUE_ALNUM_RUN = new RegExp(String.raw`\b[A-Za-z0-9]{${OPAQUE_RUN_MIN},}={0,2}`, 'g');

/**
 * Guard for OPAQUE_ALNUM_RUN. Requires both letter and digit (a 20-char
 * all-alphabetic run is a word, a 20-char all-numeric run is an id), plus a
 * floor on distinct characters so degenerate runs (`aaaaaaaaaaaaaaaaaaa1`)
 * are not mistaken for credentials. Every credential in the measured corpus
 * clears 8 distinct characters comfortably; hex has 16 by construction.
 */
function looksOpaque(run: string): boolean {
  if (!/[A-Za-z]/.test(run) || !/[0-9]/.test(run)) return false;
  return new Set(run).size >= 8;
}

/**
 * A password-shaped token: 16+ characters, no whitespace, containing ALL FOUR
 * character classes — lower, upper, digit and a "hard" symbol.
 *
 * Requiring all four is what keeps ordinary content out. Paths, kebab slugs,
 * serialized PHP, table output, version strings and prose reach three classes
 * at most. This is the only rule that catches `S3cur3P@ssw0rd2026`, which no
 * alphanumeric-run rule can see: the `@` splits it into a 7-char and a 10-char
 * fragment.
 *
 * Charset excludes `/ \ : ; , ' " < > ? [ ] { } | % &` — these are precisely
 * the separators that fragment file paths, URLs, JSON, serialized PHP,
 * percent-encoding and query strings into harmless pieces.
 *
 * The REQUIRED symbol set is narrower still: `_`, `-`, `.` and `=` are ordinary
 * separators in identifiers, slugs, versions and assignments, so they do not
 * count toward the fourth class. A password whose only symbol is `-` is missed;
 * that is the deliberate cost of not masking every hyphenated mixed-case name.
 */
const MIXED_SYMBOL_TOKEN = /[A-Za-z0-9!@#$^*()_+=.-]{16,}/g;
const HARD_SYMBOL = /[!@#$^*()+]/;
/** `Jeremy.Pollock2@example.com` clears all four classes but is not a secret. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

function looksLikePassword(run: string): boolean {
  if (!/[a-z]/.test(run)) return false;
  if (!/[A-Z]/.test(run)) return false;
  if (!/[0-9]/.test(run)) return false;
  if (!HARD_SYMBOL.test(run)) return false;
  if (EMAIL_SHAPE.test(run)) return false;
  return true;
}

export const REDACTED = '[REDACTED]';

/**
 * Mask credential-shaped substrings inside an arbitrary string. Never throws.
 *
 * Deliberately does NOT truncate. A 2000-char cap was tried and reverted: a
 * 5000-character `wp_eval` payload was stored as 2023 characters, which is
 * forensic loss on exactly the parameter this masking exists to make safe to
 * keep. File size is bounded by rotation, not by mangling individual entries.
 */
export function maskSecretsInString(value: string): string {
  let out = value;
  try {
    for (const re of SECRET_VALUE_PATTERNS) {
      out = out.replace(re, REDACTED);
    }
    out = out.replace(DEFINE_ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`);
    out = out.replace(INLINE_ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`);
    out = out.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
    out = out.replace(MIXED_SYMBOL_TOKEN, (m: string) => (looksLikePassword(m) ? REDACTED : m));
    out = out.replace(OPAQUE_ALNUM_RUN, (m: string) => (looksOpaque(m) ? REDACTED : m));
  } catch {
    return REDACTED; // a pathological input must not break the audit path
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redaction — recursive walk
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Redaction — argv awareness
// ---------------------------------------------------------------------------

/**
 * wp-config constant names that carry a secret. `isSensitiveKey` catches
 * `DB_PASSWORD` and `AUTH_KEY` (via `password` / `auth`), but not `NONCE_KEY`
 * or `LOGGED_IN_KEY` — and `key` is no longer a sensitive token by itself (see
 * SENSITIVE_TOKENS). An ALL-CAPS constant ending in `_KEY` / `_SALT` is
 * unambiguous in a way that a bare `key` parameter is not, so it is safe to
 * match here without reintroducing the "setting name destroyed" problem.
 */
const CONFIG_CONSTANT_SECRET = /^[A-Z][A-Z0-9_]*_(?:KEY|SALT|PASSWORD|PASSWD|PASS|SECRET|TOKEN)$/;

/** mysql-style attached short flag: `-pSuperSecret99`. `-uroot` is not one. */
const ATTACHED_PASSWORD_FLAG = /^(-p)(?!-)(.+)$/;

/**
 * Does this argv element name a secret carried by the FOLLOWING element?
 *
 * Covers both the separated flag form (`--user_pass Hunter2` — two elements,
 * no `=` for INLINE_ASSIGNMENT to bind to) and the positional command shapes
 * (`config set DB_PASSWORD <value>`, `option update stripe_secret_key <value>`,
 * `user update 1 --user_pass <value>`), because in all of them the credential
 * is the element immediately after its name.
 */
function introducesSecret(token: string): boolean {
  const bare = token.replace(/^-{1,2}/, '');
  if (!bare) return false;
  if (CONFIG_CONSTANT_SECRET.test(bare)) return true;
  return isSensitiveKey(bare);
}

/**
 * Walk an array with argv awareness.
 *
 * Element-wise masking is structurally blind to WP-CLI's real shape: masking
 * `--user_pass=x` but writing `["config","set","DB_PASSWORD","Pr0dDbP4ssw0rd"]`
 * verbatim was a measured leak, as were `AUTH_KEY` salts (which forge auth
 * cookies), `option update stripe_secret_key sk_live_…`, and
 * `db cli -- -uroot -pSuperSecret99`. The name and the value are simply
 * different array elements, so the value must be masked by POSITION.
 */
function redactArray(arr: unknown[], seen: WeakSet<object>): unknown[] {
  const out: unknown[] = new Array(arr.length);
  let maskNext = false;

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];

    if (typeof item !== 'string') {
      maskNext = false;
      out[i] = redactValue(String(i), item, seen);
      continue;
    }

    // A flag never *is* the value of the preceding flag; `--user_pass --porcelain`
    // means the password was omitted, not that `--porcelain` is the password.
    if (maskNext && !item.startsWith('-')) {
      out[i] = REDACTED;
      maskNext = false;
      continue;
    }

    maskNext = introducesSecret(item);

    const attached = ATTACHED_PASSWORD_FLAG.exec(item);
    if (attached) {
      // Keep the flag: "a password was passed to mysql" is the forensic fact.
      out[i] = `${attached[1]}${REDACTED}`;
      continue;
    }

    out[i] = maskSecretsInString(item);
  }

  return out;
}

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
      return redactArray(value, seen);
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
        // Uniformity: `params` and `error` are masked here so a new call site
        // cannot leak by forgetting. `toolName` was the one string field that
        // was spread through unchanged, which made that guarantee true for two
        // of three fields rather than all of them.
        toolName: maskSecretsInString(String(entry.toolName ?? '')),
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
