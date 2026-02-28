import * as mysql from 'mysql2/promise';
import { ExtractedPost } from '../../../common/types';
import { phpUnserialize } from './php-unserialize';

interface AcfFieldDef {
  key: string;   // field_xxx
  label: string;
  type: string;
  name: string;  // field name used in postmeta
}

/**
 * Enrich extracted posts with ACF custom field values.
 * Mutates posts in-place by appending to cleanedContent and adding to customFields.
 */
export async function enrichWithACF(
  conn: mysql.Connection,
  prefix: string,
  posts: ExtractedPost[],
): Promise<void> {
  if (posts.length === 0) return;

  // Load ACF field definitions
  const fieldDefs = await loadFieldDefinitions(conn, prefix);
  if (fieldDefs.size === 0) return;

  const postIds = posts.map((p) => p.id);
  const placeholders = postIds.map(() => '?').join(', ');

  // Fetch all postmeta for these posts (need both value and field key reference)
  const [metaRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT post_id, meta_key, meta_value
     FROM ${prefix}postmeta
     WHERE post_id IN (${placeholders})`,
    postIds,
  );

  // Build a map: postId → { metaKey → metaValue }
  const metaMap = new Map<number, Map<string, string>>();
  for (const row of metaRows) {
    const pid = row.post_id as number;
    if (!metaMap.has(pid)) metaMap.set(pid, new Map());
    metaMap.get(pid)!.set(row.meta_key as string, String(row.meta_value ?? ''));
  }

  // For each post, identify ACF fields and enrich
  for (const post of posts) {
    const meta = metaMap.get(post.id);
    if (!meta) continue;

    const acfValues: Array<{ label: string; value: string }> = [];

    for (const [metaKey, metaValue] of meta) {
      // ACF stores field references as _fieldname → field_key
      if (metaKey.startsWith('_')) continue;

      // Check if this meta has a corresponding ACF reference
      const fieldKeyRef = meta.get(`_${metaKey}`);
      if (!fieldKeyRef) continue;

      const fieldDef = fieldDefs.get(fieldKeyRef);
      if (!fieldDef) continue;

      const displayValue = formatFieldValue(fieldDef.type, metaValue, meta, metaKey);
      if (!displayValue) continue;

      acfValues.push({ label: fieldDef.label, value: displayValue });
      post.customFields[metaKey] = metaValue;
    }

    if (acfValues.length > 0) {
      const acfStr = acfValues
        .map(({ label, value }) => `${label}: ${value}`)
        .join(', ');
      post.cleanedContent += ` Custom Fields: ${acfStr}`;
    }
  }
}

async function loadFieldDefinitions(
  conn: mysql.Connection,
  prefix: string,
): Promise<Map<string, AcfFieldDef>> {
  const map = new Map<string, AcfFieldDef>();

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT post_name, post_content, post_excerpt, post_title
       FROM ${prefix}posts
       WHERE post_type = 'acf-field'`,
    );

    for (const row of rows) {
      const key = row.post_name as string; // e.g. field_abc123
      const config = phpUnserialize((row.post_content as string) ?? '') as Record<string, unknown> | null;

      const fieldType = (config?.type as string) ?? 'text';
      const label = (row.post_title as string) ?? key;
      const name = (row.post_excerpt as string) ?? key;

      map.set(key, { key, label, type: fieldType, name });
    }
  } catch {
    // ACF field definitions not available — not fatal
  }

  return map;
}

function formatFieldValue(
  fieldType: string,
  rawValue: string,
  allMeta: Map<string, string>,
  metaKey: string,
): string | null {
  if (!rawValue && rawValue !== '0') return null;

  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'range':
    case 'email':
    case 'url':
      return rawValue;

    case 'wysiwyg': {
      // Strip HTML tags for plain text
      return rawValue.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    }

    case 'select':
    case 'checkbox':
    case 'radio':
    case 'button_group': {
      // May be serialized array for multi-select
      const parsed = phpUnserialize(rawValue);
      if (Array.isArray(parsed)) return parsed.join(', ');
      return rawValue;
    }

    case 'true_false':
      return rawValue === '1' ? 'Yes' : 'No';

    case 'date_picker':
    case 'date_time_picker':
    case 'time_picker':
      return rawValue;

    case 'image':
    case 'file':
      // Value is typically an attachment ID — just note it exists
      return rawValue ? `(attachment #${rawValue})` : null;

    case 'post_object':
    case 'relationship':
    case 'page_link':
      // Value is a post ID or serialized array of post IDs
      return rawValue ? `(post #${rawValue})` : null;

    case 'repeater': {
      return formatRepeater(allMeta, metaKey);
    }

    case 'group': {
      return formatGroup(allMeta, metaKey);
    }

    case 'flexible_content': {
      return formatFlexibleContent(allMeta, metaKey);
    }

    case 'color_picker':
      return rawValue;

    case 'google_map':
    case 'link':
      return rawValue;

    default:
      return rawValue;
  }
}

function formatRepeater(allMeta: Map<string, string>, baseKey: string): string | null {
  const count = parseInt(allMeta.get(baseKey) ?? '0', 10);
  if (!count || isNaN(count)) return null;

  const items: string[] = [];
  for (let i = 0; i < count && i < 20; i++) {
    // Collect sub-fields for this row: baseKey_i_subfieldName
    const rowPrefix = `${baseKey}_${i}_`;
    const subFields: string[] = [];

    for (const [key, value] of allMeta) {
      if (key.startsWith(rowPrefix) && !key.startsWith('_')) {
        const subName = key.slice(rowPrefix.length);
        if (!subName.startsWith('_') && value) {
          subFields.push(`${subName}: ${value}`);
        }
      }
    }

    if (subFields.length > 0) {
      items.push(`[${subFields.join(', ')}]`);
    }
  }

  return items.length > 0 ? items.join('; ') : null;
}

function formatGroup(allMeta: Map<string, string>, baseKey: string): string | null {
  const groupPrefix = `${baseKey}_`;
  const subFields: string[] = [];

  for (const [key, value] of allMeta) {
    if (key.startsWith(groupPrefix) && !key.startsWith('_')) {
      const subName = key.slice(groupPrefix.length);
      if (!subName.startsWith('_') && value) {
        subFields.push(`${subName}: ${value}`);
      }
    }
  }

  return subFields.length > 0 ? subFields.join(', ') : null;
}

function formatFlexibleContent(allMeta: Map<string, string>, baseKey: string): string | null {
  const count = parseInt(allMeta.get(baseKey) ?? '0', 10);
  if (!count || isNaN(count)) return null;

  const layouts: string[] = [];
  for (let i = 0; i < count && i < 20; i++) {
    const layoutKey = `${baseKey}_${i}_`;
    const subFields: string[] = [];

    for (const [key, value] of allMeta) {
      if (key.startsWith(layoutKey) && !key.startsWith('_')) {
        const subName = key.slice(layoutKey.length);
        if (!subName.startsWith('_') && value) {
          subFields.push(`${subName}: ${value}`);
        }
      }
    }

    if (subFields.length > 0) {
      layouts.push(`[${subFields.join(', ')}]`);
    }
  }

  return layouts.length > 0 ? layouts.join('; ') : null;
}
