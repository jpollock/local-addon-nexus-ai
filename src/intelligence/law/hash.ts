/**
 * Document canonicalisation and content hashing (WP-20a).
 *
 * A capability grant pins its runbook by content hash (WP-20 design note §2,
 * §6(b)): the capability was granted against the document a human reviewed, and
 * a mismatch is an INTEGRITY failure — refused on both actor classes, never
 * softened into a staleness warning (P4's doctrinal refinement: ADR-7 governs
 * age, not authority). A pin is only worth having if anyone can recompute it,
 * so the input is defined here, once, and nowhere else.
 *
 * THE HASH INPUT, exactly:
 *
 *   1. The file read as UTF-8, WHOLE — the `---` fences, the frontmatter and
 *      the prose body. Not the body alone. For these runbooks the obligations
 *      that make a procedure a procedure — checkpoints, aborts, communication —
 *      live IN the frontmatter, so a body-only pin would let the reviewed
 *      contract be rewritten without the hash noticing.
 *   2. Line endings normalised: `\r\n` and a lone `\r` become `\n`. Nothing
 *      else — no trimming, no BOM handling, no Unicode normalisation. A
 *      checkout with `core.autocrlf` must produce the pin the grant was issued
 *      against (§9-20a pin: "hash stable across CRLF/LF").
 *   3. sha256 over the UTF-8 bytes of that text, lowercase hex, prefixed
 *      `sha256:` so the algorithm travels with the value.
 *
 * `canonicalByteLength` measures that same canonical text, which is why the
 * runbook ceiling is platform-independent for the same reason the hash is.
 */
import { createHash } from 'crypto';

/** The exact text that is hashed and measured: the whole document, LF line endings. */
export function canonicalDocumentText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

/** `sha256:<hex>` over `canonicalDocumentText(raw)`. */
export function documentHash(raw: string): string {
  return `sha256:${createHash('sha256').update(canonicalDocumentText(raw), 'utf8').digest('hex')}`;
}

/** Byte length of `canonicalDocumentText(raw)` — what the runbook ceiling measures. */
export function canonicalByteLength(raw: string): number {
  return Buffer.byteLength(canonicalDocumentText(raw), 'utf8');
}
