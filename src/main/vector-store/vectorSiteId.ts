import * as crypto from 'crypto';

/**
 * sqlite-vec table names can't contain anything outside `^[a-zA-Z0-9_-]+$`
 * (SqliteVecStore.validateSiteId). Real site ids can contain `:` (every id,
 * `wpe:<alias>` style prefixes) and `/` (external multi-site ids,
 * `ssh:<alias>/<site>` — see externalSiteStore.ts's externalSiteId, which
 * must NOT change; it is the real id everywhere except this boundary).
 *
 * A character-class replace alone creates real collisions: `ssh:a/b-c` and
 * `ssh:a-b/c` both sanitize to `ssh_a_b_c`. A short stable hash of the
 * ORIGINAL id is appended so two different ids can never produce the same
 * table name, without needing a cross-row uniqueness check at write time.
 *
 * Local and WPE ids (`mmWgjXGRS`, `wpe-<uuid>`) already satisfy the regex, so
 * for them `sanitized === id` and the hash-suffixed form is still applied —
 * this is safe (just a longer, still-valid table name) and keeps the function
 * uniform rather than branching on "did this id need sanitizing".
 */
export function vectorSiteId(siteId: string): string {
  const sanitized = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('sha256').update(siteId).digest('hex').slice(0, 8);
  return `${sanitized}_${hash}`;
}
