import * as mysql from 'mysql2/promise';
import { ExtractedPost } from '../../../common/types';
import { cleanWordPressContent } from '../html-cleaner';

/** Patterns for low-value attachment titles (camera defaults, screenshots, etc.) */
const LOW_VALUE_TITLE_RE = /^(IMG_\d+|DSC_\d+|DSCN?\d+|Screenshot.*|\d+|P\d+|IMAG\d+|Photo\s+\d+)$/i;

/**
 * Extract image attachments with meaningful metadata for semantic search.
 * Filters out low-value attachments that lack alt text, captions, and descriptions.
 */
export async function extractMedia(
  conn: mysql.Connection,
  prefix: string,
): Promise<ExtractedPost[]> {
  // Fetch image attachments
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ID, post_title, post_content, post_excerpt, post_date, post_author, post_mime_type
     FROM ${prefix}posts
     WHERE post_type = 'attachment'
       AND post_mime_type LIKE 'image/%'
       AND post_status IN ('publish', 'inherit')
     ORDER BY post_date DESC`,
  );

  if (rows.length === 0) return [];

  const postIds = rows.map((r) => r.ID as number);

  // Fetch alt text from postmeta
  const placeholders = postIds.map(() => '?').join(', ');
  const [metaRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT post_id, meta_value
     FROM ${prefix}postmeta
     WHERE post_id IN (${placeholders})
       AND meta_key = '_wp_attachment_image_alt'`,
    postIds,
  );

  const altTextMap = new Map<number, string>();
  for (const row of metaRows) {
    altTextMap.set(row.post_id as number, String(row.meta_value ?? ''));
  }

  const posts: ExtractedPost[] = [];

  for (const row of rows) {
    const id = row.ID as number;
    const title = (row.post_title as string) ?? '';
    const caption = (row.post_excerpt as string) ?? '';
    const description = (row.post_content as string) ?? '';
    const altText = altTextMap.get(id) ?? '';

    // Filter out low-value attachments
    const isLowValueTitle = LOW_VALUE_TITLE_RE.test(title);
    const hasNoMeaningfulContent = !altText.trim() && !caption.trim() && !description.trim();

    if (isLowValueTitle || hasNoMeaningfulContent) continue;

    // Build content string for semantic search
    const parts: string[] = [`Image: ${title}`];
    if (altText) parts.push(`Alt text: ${altText}`);
    if (caption) parts.push(`Caption: ${cleanWordPressContent(caption)}`);
    if (description) parts.push(cleanWordPressContent(description));

    const cleanedContent = parts.join('. ');

    posts.push({
      id,
      title,
      content: description,
      cleanedContent,
      excerpt: caption,
      postType: 'attachment',
      postStatus: 'inherit',
      author: String(row.post_author ?? ''),
      date: row.post_date ? String(row.post_date) : '',
      categories: [],
      tags: [],
      customFields: {
        _wp_attachment_image_alt: altText,
        post_mime_type: (row.post_mime_type as string) ?? '',
      },
    });
  }

  return posts;
}
