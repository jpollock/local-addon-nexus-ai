import type { MetadataFilter } from '../../common/types';

/**
 * Apply generic metadata filters to a document's custom fields.
 * Returns true only if ALL filters pass (AND semantics).
 * Missing field → fail-closed (returns false) for every op.
 * 'contains' = case-insensitive substring.
 *
 * Ordering (`lt`/`lte`/`gt`/`gte`) — D24/D25: type is detected per value
 * pair, because naive numeric coercion produced two silent wrongs:
 *  - an ISO date ("2025-05-15") never parses as a number, so every ordering
 *    op matched NOTHING — an empty set indistinguishable from "nothing is
 *    stale" (D25). ISO dates order correctly as strings, so they compare
 *    lexicographically.
 *  - a version string ("2.10") coerced to 2.1 and sorted below 2.9 (D24).
 *    A dotted value is treated as a version — compared segment-wise — when
 *    it has two or more dots, or when numeric coercion would LOSE
 *    information (String(Number("2.10")) !== "2.10"). Faithful one-dot
 *    decimals ("1.5", "1.25") stay numeric, so prices and ratings still
 *    order arithmetically.
 *
 * An ordering op whose FILTER value is none of number / ISO date / dotted
 * version throws UnorderableFilterError — a filter that cannot work must say
 * so, not silently match nothing. A DOC value that cannot be ordered against
 * an orderable filter fails closed for that document, as before (mixed
 * corpora stay queryable).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\S*)?$/;
const DOTTED_RE = /^\d+(\.\d+)+$/;
const ORDERING_OPS = new Set(['lt', 'lte', 'gt', 'gte']);

export class UnorderableFilterError extends Error {
  constructor(
    public readonly field: string,
    public readonly op: string,
    public readonly value: string,
  ) {
    super(
      `Ordering operator "${op}" cannot be applied to field "${field}": filter value ` +
        `"${value}" is neither a number, an ISO date (YYYY-MM-DD), nor a dotted version. ` +
        `Use eq or contains, or supply an orderable value.`,
    );
    this.name = 'UnorderableFilterError';
  }
}

/** Numeric coercion of this dotted string loses information ("2.10" → 2.1). */
function isLossyDotted(s: string): boolean {
  return DOTTED_RE.test(s) && String(Number(s)) !== s;
}

function hasMultiDots(s: string): boolean {
  return DOTTED_RE.test(s) && s.indexOf('.') !== s.lastIndexOf('.');
}

function segmentCompare(a: string, b: string): number {
  const sa = a.split('.').map(Number);
  const sb = b.split('.').map(Number);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const d = (sa[i] ?? 0) - (sb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** -1 | 0 | 1, or null when the doc value cannot be ordered against the filter value. */
function orderedCompare(docStr: string, filtStr: string): number | null {
  if (ISO_DATE_RE.test(filtStr)) {
    if (!ISO_DATE_RE.test(docStr)) return null;
    return docStr < filtStr ? -1 : docStr > filtStr ? 1 : 0;
  }
  const versionPair =
    DOTTED_RE.test(docStr) &&
    DOTTED_RE.test(filtStr) &&
    (hasMultiDots(docStr) || hasMultiDots(filtStr) || isLossyDotted(docStr) || isLossyDotted(filtStr));
  if (versionPair) return segmentCompare(docStr, filtStr);

  const numDoc = Number(docStr);
  const numFilt = Number(filtStr);
  if (docStr.trim() !== '' && Number.isFinite(numDoc) && Number.isFinite(numFilt)) {
    return numDoc < numFilt ? -1 : numDoc > numFilt ? 1 : 0;
  }
  return null;
}

export function applyMetadataFilters(
  custom: Record<string, unknown>,
  filters: MetadataFilter[],
): boolean {
  for (const f of filters) {
    if (!(f.field in custom)) return false; // fail-closed
    const rawStr = String(custom[f.field]);
    const filtStr = String(f.value);
    let ok: boolean;

    if (ORDERING_OPS.has(f.op)) {
      const filterOrderable =
        ISO_DATE_RE.test(filtStr) ||
        DOTTED_RE.test(filtStr) ||
        (filtStr.trim() !== '' && Number.isFinite(Number(filtStr)));
      if (!filterOrderable) throw new UnorderableFilterError(f.field, f.op, filtStr);
      const c = orderedCompare(rawStr, filtStr);
      ok =
        c !== null &&
        ((f.op === 'lt' && c < 0) ||
          (f.op === 'lte' && c <= 0) ||
          (f.op === 'gt' && c > 0) ||
          (f.op === 'gte' && c >= 0));
    } else if (f.op === 'eq' || f.op === 'ne') {
      // Numeric equality only when coercion is faithful on both sides —
      // "2.10" eq "2.1" must NOT be true (D24's equality face).
      const numDoc = Number(rawStr);
      const numFilt = Number(filtStr);
      const bothNumeric =
        rawStr.trim() !== '' &&
        Number.isFinite(numDoc) &&
        Number.isFinite(numFilt) &&
        !isLossyDotted(rawStr) &&
        !isLossyDotted(filtStr);
      const eq = bothNumeric ? numDoc === numFilt : rawStr === filtStr;
      ok = f.op === 'eq' ? eq : !eq;
    } else if (f.op === 'contains') {
      ok = rawStr.toLowerCase().includes(filtStr.toLowerCase());
    } else {
      ok = false;
    }
    if (!ok) return false;
  }
  return true;
}
