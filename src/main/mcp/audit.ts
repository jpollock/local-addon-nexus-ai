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
 * The same positional problem as argv arrays, but for a command that arrives as
 * ONE space-separated STRING rather than a pre-split array.
 *
 * `SentinelExecutor` is the live example: `nexus:sentinel:execute` receives
 * `["wp config set DB_PASSWORD Pr0dDbP4ssw0rd"]` — an array of whole command
 * lines, so element-wise argv masking has nothing to bind to. Echoed command
 * lines in raw tool output have the same shape.
 *
 * Anchored on literal WP-CLI subcommands rather than on "a sensitive word
 * followed by a token", because the latter mangles prose: "reset your password
 * now" would lose the word after `password`.
 *
 * ARITY MATTERS. `user meta update|add` takes the USER first:
 * `wp user meta update <user> <key> <value>`. The original pattern expected
 * `user meta update <key> <value>`, so the numeric user id failed the
 * `[A-Za-z_]` name class and the branch never fired at all —
 * `wp user meta update 1 api_token abc123def456` was written verbatim. The
 * `\S+` before the name consumes the user id / login / email.
 *
 * The VALUE alternation accepts a quoted string before falling back to a bare
 * token. `\S+` alone stopped at the first space, so
 * `config set DB_PASSWORD "P@ss word with spaces"` masked only `"P@ss` and
 * wrote ` word with spaces"` to disk. Quoted forms are tried first; the whole
 * quoted token (quotes included) is what gets replaced.
 */
const COMMAND_NAME_VALUE =
  /\b((?:config\s+set|option\s+(?:update|add|set)|user\s+meta\s+(?:update|add)\s+\S+)\s+)([A-Za-z_][A-Za-z0-9_.-]*)(\s+)(?:"[^"]*"|'[^']*'|\S+)/g;

/** `--user_pass hunter2` — flag and value separated by a space, so no `=`. */
const SEPARATED_SECRET_FLAG =
  /(--(?:user[_-]?pass(?:word)?|pass(?:word)?|api[_-]?key|access[_-]?key|auth[_-]?token|secret|token)\s+)(?!-)(\S+)/gi;

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
 * A legal WP Engine install name: lowercase alphanumerics and hyphens, capped
 * at 20 characters by `create-install.ts` (which rejects 21+), so exactly 20 is
 * legal and reachable.
 *
 * `looksOpaque` masks any 20+ character alphanumeric run carrying a letter, a
 * digit and 8+ distinct characters — which a hyphen-free 20-character install
 * name such as `acmeprod2026staging1` satisfies exactly. That landed on
 * `target` / `install_name`: the one field identifying WHICH production install
 * was operated on. An entry reading `target: "[REDACTED]"` records that
 * something was deleted but not what.
 */
const LEGAL_INSTALL_NAME = /^[a-z0-9][a-z0-9-]{0,19}$/;

export interface MaskOptions {
  /**
   * This value identifies the resource that was operated on (`target`,
   * `install_name`). When the WHOLE value is a legal install name, the generic
   * opaque-alphanumeric-run rule is skipped for it.
   *
   * Deliberately narrow. Every other rule still runs, including the vendor
   * prefixes (`sk_`, `key-`, `AKIA…`) that can also appear in the
   * `[a-z0-9-]` charset, and a value that is NOT a legal install name — the
   * 40-char `install-0123456789abcdef…` shape — is masked as before.
   */
  identityField?: boolean;
}

/**
 * Mask credential-shaped substrings inside an arbitrary string. Never throws.
 *
 * Deliberately does NOT truncate. A 2000-char cap was tried and reverted: a
 * 5000-character `wp_eval` payload was stored as 2023 characters, which is
 * forensic loss on exactly the parameter this masking exists to make safe to
 * keep. File size is bounded by rotation, not by mangling individual entries.
 */
export function maskSecretsInString(value: string, opts?: MaskOptions): string {
  let out = value;
  const keepIdentity = opts?.identityField === true && LEGAL_INSTALL_NAME.test(value);
  try {
    for (const re of SECRET_VALUE_PATTERNS) {
      out = out.replace(re, REDACTED);
    }
    out = out.replace(DEFINE_ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`);
    out = out.replace(INLINE_ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`);
    out = out.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
    out = out.replace(
      COMMAND_NAME_VALUE,
      (m: string, lead: string, name: string, gap: string) =>
        (isSensitiveKey(name) || CONFIG_CONSTANT_SECRET.test(name))
          ? `${lead}${name}${gap}${REDACTED}` // the NAME survives, the value does not
          : m,
    );
    out = out.replace(SEPARATED_SECRET_FLAG, (_m, lead: string) => `${lead}${REDACTED}`);
    out = out.replace(MIXED_SYMBOL_TOKEN, (m: string) => (looksLikePassword(m) ? REDACTED : m));
    if (!keepIdentity) {
      out = out.replace(OPAQUE_ALNUM_RUN, (m: string) => (looksOpaque(m) ? REDACTED : m));
    }
  } catch {
    return REDACTED; // a pathological input must not break the audit path
  }
  return out;
}

// ---------------------------------------------------------------------------
// Withholding — freeform command surfaces
// ---------------------------------------------------------------------------

/**
 * Parameter names whose value is EXECUTED SYNTAX the caller composes freely:
 * PHP source, a WP-CLI argv vector, a shell command line, a SQL statement.
 *
 * These are not masked, they are WITHHELD — the value never reaches disk in any
 * form. Four review rounds found four credential-exposure paths and every one
 * of them was on a surface in this list; not one was a structured tool
 * parameter. Each round's regex also shipped new defects of its own (a WP-CLI
 * arity the pattern got wrong, a quoted value whose tail was written verbatim).
 * Masking arbitrary command syntax correctly is a losing game, so the syntax is
 * no longer written.
 *
 * MATCHED BY NAME, not by tool, and applied inside the shared redaction walk —
 * the same reasoning that put `redactParams` inside `OperationAuditLog.log()`.
 * All three sinks funnel through `redactParams`, so no call site can leak by
 * forgetting, and the two dispatch chokepoints spread `...args` verbatim, which
 * means a tool-scoped list would silently miss every tool added later.
 *
 * Names are normalised (lowercased, `_`/`-` stripped), so `install_name` and
 * `installName` are one entry. Matching is EXACT rather than tokenised on
 * purpose: tokenising would withhold `statusCode`, `errorCode` and `zipCode` on
 * the strength of the token `code`.
 *
 * Deliberately NOT here — see the report for the full reasoning per surface:
 * `search`/`replace` (wp_search_replace), `title`/`content` (wp_post_*),
 * `prompt`/`system` (ask_ollama), `input` (wp_run_ability), `value`, `option`.
 * All are structured parameters or body text rather than composed syntax, and
 * value-shape plus key-name masking still runs over every one of them.
 *
 * `sql` and `script` are forward-looking: no surface uses those names today,
 * but they are the names the next such field would be given.
 */
const FREEFORM_FIELDS = new Set([
  'code',      // wp_eval — arbitrary PHP
  'command',   // nexusWpCommand argv, ipc.wp.command (WPE_DIAGNOSE) argv
  'commands',  // nexus:sentinel:execute — whole command lines, incl. raw `rm -f`
  'args',      // raw IPC request dumps carrying a WP-CLI argv
  'argv',
  'query',     // fleet_sql — arbitrary SQL executed via db.prepare()
  'sql',
  'script',
  'patch',     // nexus_update_settings — caller-composed JSON blob, opaque to
               // key-name masking because its interior keys are inside a string
]);

export function isFreeformField(key: string): boolean {
  return FREEFORM_FIELDS.has(normaliseFieldName(key));
}

export const WITHHELD_PREFIX = '[WITHHELD: freeform input';

/**
 * The replacement written in place of a withheld value.
 *
 * WITHHELD, NOT DELETED. An entry whose `command` key simply vanished reads as
 * an operation that took no arguments; the marker records that a field existed
 * and was deliberately not kept.
 *
 * Length is retained so an investigator can still tell roughly how large the
 * payload was, and element count so an argv vector is distinguishable from a
 * one-liner.
 *
 * NO CONTENT HASH. A short hash would let an investigator confirm the same
 * command ran twice, which is genuinely useful — but it is also a
 * guess-confirmation oracle against exactly the credential the withholding
 * exists to protect. The exported trail publishes both the template (the
 * `operation` name pins it to, say, `config set DB_PASSWORD <value>`) and the
 * exact character count, so a dictionary attack over an 8-hex-char digest
 * recovers a low-entropy password from an audit export. Closing that would take
 * a persistent per-installation salt, i.e. new file I/O on a path whose whole
 * contract is "never throws". Correlation is not worth either cost.
 */
export function withheldMarker(value: string | unknown[]): string {
  try {
    if (Array.isArray(value)) {
      let chars = 0;
      for (const el of value) chars += (typeof el === 'string' ? el : String(el)).length;
      return `${WITHHELD_PREFIX}, ${value.length} elements, ${chars} chars]`;
    }
    return `${WITHHELD_PREFIX}, ${value.length} chars]`;
  } catch {
    return `${WITHHELD_PREFIX}]`;
  }
}

// ---------------------------------------------------------------------------
// Redaction — identity fields
// ---------------------------------------------------------------------------

/** Normalise a parameter name for list matching: `install_name` → `installname`. */
function normaliseFieldName(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * Fields that name the resource an operation acted on. Opaque-run masking is
 * skipped for these when the whole value is a legal install name — see
 * `LEGAL_INSTALL_NAME`.
 */
const IDENTITY_FIELDS = new Set(['target', 'installname']);

/**
 * Exported so a second redactor never has to exist. `src/main/logging/eventLog.ts` masks the
 * RENDERED form of a field value (a value whose `toString()` is a secret is never seen as a
 * string by `redactParams`), and it needs the same key context this module uses to decide the
 * `target` / `install_name` carve-out. A copy of `IDENTITY_FIELDS` over there would drift from
 * this one, which is exactly what the single-owner rule for redaction exists to prevent.
 */
export function isIdentityField(key: string): boolean {
  return IDENTITY_FIELDS.has(normaliseFieldName(key));
}

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
 * Is the tail of a `-p…` element a credential rather than the rest of a flag
 * name?
 *
 * Matching `-p` plus anything turned every single-dash long flag into
 * `-p[REDACTED]`: `-path`, `-post-type` and `-p1` all lost their meaning, and
 * `-path` in particular destroys the record of WHERE a command ran.
 *
 * Two cheap discriminators, both measured against the false positives above:
 * a flag name continues as pure lowercase letters and hyphens (`ath`,
 * `ost-type`, `orcelain`), and a tail shorter than 6 characters (`1`, `ath`)
 * is not a password anyone sets.
 *
 * Accepted gap: an all-lowercase-alphabetic password attached to `-p`
 * (`-phunterhunter`) is indistinguishable from a long flag name and is not
 * masked here. The separated form (`--password hunterhunter`) still is.
 */
function looksLikeAttachedPassword(tail: string): boolean {
  if (tail.length < 6) return false;
  if (/^[a-z]+(?:-[a-z]+)*$/.test(tail)) return false;
  return true;
}

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
  // A whole command line is not a NAME, and this predicate's only job is to
  // decide whether the NEXT array element is the value belonging to this one.
  // `isSensitiveKey` is an unanchored `includes()`, so an element that merely
  // mentions a secret anywhere — `'wp config set DB_PASSWORD x'`, one line of a
  // sentinel remediation array — armed `maskNext` and destroyed the element
  // after it. Measured: the raw `rm -f /nas/content/live/…` record, the single
  // most consequential line in that array, was replaced by `[REDACTED]`.
  // Whole lines are already handled by `maskSecretsInString` element-wise.
  if (/\s/.test(bare)) return false;
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
    if (attached && looksLikeAttachedPassword(attached[2])) {
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
  // Withholding runs BEFORE any masking: the point is that this value's syntax
  // is never parsed for credentials at all, because parsing it correctly is the
  // thing that has failed four times. Objects fall through to the recursive
  // walk so a structured payload is still redacted key by key.
  if (isFreeformField(key) && (typeof value === 'string' || Array.isArray(value))) {
    return withheldMarker(value);
  }
  if (typeof value === 'string') {
    return maskSecretsInString(value, isIdentityField(key) ? { identityField: true } : undefined);
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
