/**
 * Field catalog — domain-agnostic inference of a site's indexed custom fields.
 *
 * Given the per-post customFields (postmeta the indexer captured), summarize,
 * per post type, which structured fields exist and their shape (number range,
 * enum values, boolean, array, or free text) plus coverage. An AI agent uses
 * this to map a natural-language constraint ("easy", "under $20", "in X") to a
 * concrete metadataFilters entry — without the addon knowing any domain terms.
 */

export type FieldType = 'number' | 'boolean' | 'enum' | 'array' | 'text' | 'date' | 'version';

export interface FieldInfo {
  field: string;
  type: FieldType;
  /** number of posts (of this type) with a non-empty value for this field */
  coverage: number;
  /** total posts of this type (denominator for coverage) */
  total: number;
  min?: number;
  max?: number;
  /** range bounds for date/version fields, in their own string forms */
  minValue?: string;
  maxValue?: string;
  /** distinct values for enum fields (sorted, capped) */
  values?: string[];
  /** one example value for text fields */
  sample?: string;
}

export interface PostTypeCatalog {
  postType: string;
  postCount: number;
  fields: FieldInfo[];
}

/** Max distinct string values before a field is treated as free text rather than an enum. */
const ENUM_MAX = 12;
/** PHP-serialized array marker, e.g. a:3:{i:0;s:6:"Summer";...} */
const PHP_ARRAY_RE = /^a:\d+:\{/;
/** ISO-8601 date shape — mirrors metadata-filters.ts, which orders these lexicographically. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\S*)?$/;
/** Dotted-numeric shape ("3.1", "2.10", "1.2.3") — mirrors metadata-filters.ts. */
const DOTTED_RE = /^\d+(\.\d+)+$/;

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
/**
 * ACF repeater sub-row keys, e.g. `itinerary_0_day`, `certifications_2_certification`.
 * These are per-row internals (not directly filterable) and their values can be large
 * prose blocks — exclude them from the catalog. The parent repeater key (e.g. `itinerary`,
 * which holds the row count) is kept.
 */
const REPEATER_SUBFIELD_RE = /_\d+_/;

interface PostInput {
  postType: string;
  customFields: Record<string, unknown>;
}

function inferField(field: string, rawValues: string[], total: number): FieldInfo {
  const values = rawValues.filter((v) => v !== '' && v != null);
  const coverage = values.length;

  // PHP-serialized arrays (ACF repeaters/relationships/checkboxes) → 'array'
  if (values.length > 0 && values.every((v) => PHP_ARRAY_RE.test(v))) {
    return { field, type: 'array', coverage, total };
  }

  const distinct = Array.from(new Set(values));

  // boolean: only 0/1 present
  if (distinct.length > 0 && distinct.every((v) => v === '0' || v === '1')) {
    return { field, type: 'boolean', coverage, total };
  }

  // date (D25): every value is ISO-8601-shaped. Typed BEFORE number so a
  // date is never offered as text — ISO strings order correctly, and the
  // filter layer compares them lexicographically.
  if (values.length > 0 && values.every((v) => ISO_DATE_RE.test(v))) {
    const sorted = [...values].sort();
    return { field, type: 'date', coverage, total, minValue: sorted[0], maxValue: sorted[sorted.length - 1] };
  }

  // version (D24): every value is dotted-numeric AND at least one would be
  // damaged by numeric coercion — multiple dots ("1.2.3" is not a number) or
  // information loss ("2.10" → 2.1, which sorts below 2.9). Typed BEFORE
  // number so callers are never offered numeric operators that misorder.
  // A field of faithful one-dot decimals ("1.5", "19.99") stays number.
  if (
    values.length > 0 &&
    values.every((v) => DOTTED_RE.test(v)) &&
    values.some((v) => v.indexOf('.') !== v.lastIndexOf('.') || String(Number(v)) !== v)
  ) {
    const sorted = [...values].sort(segmentCompare);
    return { field, type: 'version', coverage, total, minValue: sorted[0], maxValue: sorted[sorted.length - 1] };
  }

  // number: every non-empty value parses as a finite number
  if (values.length > 0 && values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)))) {
    const nums = values.map(Number);
    return { field, type: 'number', coverage, total, min: Math.min(...nums), max: Math.max(...nums) };
  }

  // enum: few distinct string values
  if (distinct.length > 0 && distinct.length <= ENUM_MAX) {
    return { field, type: 'enum', coverage, total, values: distinct.sort() };
  }

  // free text
  return { field, type: 'text', coverage, total, sample: values[0] };
}

/**
 * Build a per-post-type catalog of indexed custom fields.
 * `posts` MUST be deduped to one entry per post (not per chunk) so coverage
 * counts reflect posts, not chunks.
 */
export function buildFieldCatalog(posts: PostInput[]): PostTypeCatalog[] {
  const byType = new Map<string, PostInput[]>();
  for (const p of posts) {
    const list = byType.get(p.postType) ?? [];
    list.push(p);
    byType.set(p.postType, list);
  }

  const catalogs: PostTypeCatalog[] = [];
  for (const [postType, group] of byType) {
    // collect every field name seen across this post type (excluding ACF repeater sub-rows)
    const fieldNames = new Set<string>();
    for (const p of group) {
      for (const k of Object.keys(p.customFields ?? {})) {
        if (REPEATER_SUBFIELD_RE.test(k)) continue;
        fieldNames.add(k);
      }
    }

    const fields: FieldInfo[] = [];
    for (const name of fieldNames) {
      const rawValues = group.map((p) => {
        const v = (p.customFields ?? {})[name];
        return v == null ? '' : String(v);
      });
      const info = inferField(name, rawValues, group.length);
      if (info.coverage > 0) fields.push(info);
    }

    // stable, useful ordering: numbers/enums/booleans first (filterable), then array/text
    const rank = (t: FieldType) => (t === 'number' ? 0 : t === 'enum' ? 1 : t === 'boolean' ? 2 : t === 'array' ? 3 : 4);
    fields.sort((a, b) => rank(a.type) - rank(b.type) || a.field.localeCompare(b.field));

    catalogs.push({ postType, postCount: group.length, fields });
  }

  // most-populated post types first
  catalogs.sort((a, b) => b.postCount - a.postCount);
  return catalogs;
}

/** Render a catalog as compact, agent-readable text. */
export function formatFieldCatalog(siteName: string, catalogs: PostTypeCatalog[]): string {
  const lines: string[] = [`Indexed structured fields for "${siteName}":`, ''];
  for (const c of catalogs) {
    const filterable = c.fields.filter(
      (f) => f.type === 'number' || f.type === 'enum' || f.type === 'boolean' || f.type === 'date' || f.type === 'version',
    );
    if (filterable.length === 0 && c.fields.length === 0) {
      lines.push(`${c.postType} (${c.postCount}): no structured custom fields`);
      lines.push('');
      continue;
    }
    lines.push(`${c.postType} (${c.postCount} posts):`);
    for (const f of c.fields) {
      let desc: string;
      switch (f.type) {
        case 'number': desc = `number ${f.min}–${f.max}`; break;
        case 'date': desc = `date ${f.minValue}–${f.maxValue} (ISO — lt/gte compare chronologically)`; break;
        case 'version': desc = `version ${f.minValue}–${f.maxValue} (compared segment-wise: 2.10 > 2.9)`; break;
        case 'enum': desc = `enum [${(f.values ?? []).join(', ')}]`; break;
        case 'boolean': desc = 'boolean (0/1)'; break;
        case 'array': desc = 'array (multi-value; use contains or search text)'; break;
        default: desc = `text (e.g. "${f.sample}")`; break;
      }
      lines.push(`  - ${f.field}: ${desc} (${f.coverage}/${f.total})`);
    }
    lines.push('');
  }
  lines.push(
    'To filter: call search_site_content with searchMode:"hybrid", postType, and ' +
    'metadataFilters:[{field,op,value}] where op ∈ eq|ne|lt|lte|gt|gte|contains ' +
    '(ordering ops work on number, date and version fields; use contains for ' +
    'array/text — an ordering op on a text field is an error, not an empty result).',
  );
  return lines.join('\n');
}
