import type { MetadataFilter } from '../../common/types';

/**
 * Apply generic metadata filters to a document's custom fields.
 * Returns true only if ALL filters pass (AND semantics).
 * Missing field → fail-closed (returns false) for every op.
 * Numeric comparison when BOTH the doc value and filter value parse as finite numbers; else string comparison.
 * 'contains' = case-insensitive substring.
 */
export function applyMetadataFilters(
  custom: Record<string, unknown>,
  filters: MetadataFilter[],
): boolean {
  for (const f of filters) {
    if (!(f.field in custom)) return false; // fail-closed
    const raw = custom[f.field];
    const rawStr = String(raw);
    const numDoc = Number(rawStr);
    const numFilter = Number(f.value);
    const bothNumeric = rawStr.trim() !== '' && Number.isFinite(numDoc) && Number.isFinite(numFilter);
    let ok: boolean;
    switch (f.op) {
      case 'eq':
        ok = bothNumeric ? numDoc === numFilter : rawStr === String(f.value);
        break;
      case 'ne':
        ok = bothNumeric ? numDoc !== numFilter : rawStr !== String(f.value);
        break;
      case 'lt':
        ok = bothNumeric && numDoc < numFilter;
        break;
      case 'lte':
        ok = bothNumeric && numDoc <= numFilter;
        break;
      case 'gt':
        ok = bothNumeric && numDoc > numFilter;
        break;
      case 'gte':
        ok = bothNumeric && numDoc >= numFilter;
        break;
      case 'contains':
        ok = rawStr.toLowerCase().includes(String(f.value).toLowerCase());
        break;
      default:
        ok = false;
    }
    if (!ok) return false;
  }
  return true;
}
