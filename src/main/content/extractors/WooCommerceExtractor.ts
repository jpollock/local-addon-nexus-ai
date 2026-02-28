import * as mysql from 'mysql2/promise';
import { ExtractedPost } from '../../../common/types';
import { cleanWordPressContent } from '../html-cleaner';

/** WooCommerce meta keys that the base fetchPostMeta filters out (underscore-prefixed) */
const PRODUCT_META_KEYS = [
  '_price',
  '_regular_price',
  '_sale_price',
  '_sku',
  '_stock_status',
  '_product_type',
  '_virtual',
  '_downloadable',
  '_weight',
];

/**
 * Extract WooCommerce products with commerce-specific metadata for semantic search.
 * Returns enriched ExtractedPost[] with price, SKU, stock, categories, and attributes.
 */
export async function extractProducts(
  conn: mysql.Connection,
  prefix: string,
): Promise<ExtractedPost[]> {
  // Fetch published products
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ID, post_title, post_content, post_excerpt, post_date, post_author
     FROM ${prefix}posts
     WHERE post_type = 'product'
       AND post_status = 'publish'
     ORDER BY post_date DESC`,
  );

  if (rows.length === 0) return [];

  const postIds = rows.map((r) => r.ID as number);
  const placeholders = postIds.map(() => '?').join(', ');

  // Fetch product meta (underscore-prefixed keys the base extractor skips)
  const metaKeyList = PRODUCT_META_KEYS.map((k) => `'${k}'`).join(', ');
  const [metaRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT post_id, meta_key, meta_value
     FROM ${prefix}postmeta
     WHERE post_id IN (${placeholders})
       AND meta_key IN (${metaKeyList})`,
    postIds,
  );

  const metaMap = new Map<number, Record<string, string>>();
  for (const row of metaRows) {
    const pid = row.post_id as number;
    if (!metaMap.has(pid)) metaMap.set(pid, {});
    metaMap.get(pid)![row.meta_key as string] = String(row.meta_value ?? '');
  }

  // Fetch taxonomies: product_cat, product_tag, and product attributes (pa_*)
  const [taxRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT t.name, tt.taxonomy, tr.object_id
     FROM ${prefix}terms t
     JOIN ${prefix}term_taxonomy tt ON t.term_id = tt.term_id
     JOIN ${prefix}term_relationships tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
     WHERE tr.object_id IN (${placeholders})
       AND (tt.taxonomy = 'product_cat'
            OR tt.taxonomy = 'product_tag'
            OR tt.taxonomy LIKE 'pa\\_%')`,
    postIds,
  );

  const taxMap = new Map<number, { categories: string[]; tags: string[]; attributes: Record<string, string[]> }>();
  for (const row of taxRows) {
    const pid = row.object_id as number;
    if (!taxMap.has(pid)) taxMap.set(pid, { categories: [], tags: [], attributes: {} });
    const entry = taxMap.get(pid)!;
    const taxonomy = row.taxonomy as string;
    const name = row.name as string;

    if (taxonomy === 'product_cat') {
      entry.categories.push(name);
    } else if (taxonomy === 'product_tag') {
      entry.tags.push(name);
    } else if (taxonomy.startsWith('pa_')) {
      const attrName = taxonomy.slice(3).replace(/_/g, ' ');
      if (!entry.attributes[attrName]) entry.attributes[attrName] = [];
      entry.attributes[attrName].push(name);
    }
  }

  return rows.map((row) => {
    const id = row.ID as number;
    const title = (row.post_title as string) ?? '';
    const rawContent = (row.post_content as string) ?? '';
    const excerpt = (row.post_excerpt as string) ?? '';
    const meta = metaMap.get(id) ?? {};
    const tax = taxMap.get(id) ?? { categories: [], tags: [], attributes: {} };

    const productType = meta._product_type || 'simple';
    const price = meta._price || meta._regular_price || '';
    const regularPrice = meta._regular_price || '';
    const salePrice = meta._sale_price || '';
    const sku = meta._sku || '';
    const stockStatus = (meta._stock_status || 'instock').replace(/_/g, ' ');

    // Build semantic-search-optimized content
    const parts: string[] = [title];

    // Product type and price
    const priceStr = salePrice && regularPrice && salePrice !== regularPrice
      ? `$${salePrice} (was $${regularPrice})`
      : price ? `$${price}` : '';
    if (priceStr) {
      parts.push(`${productType} product priced at ${priceStr}`);
    } else {
      parts.push(`${productType} product`);
    }

    // Description
    const cleanedDesc = cleanWordPressContent(excerpt || rawContent);
    if (cleanedDesc) parts.push(cleanedDesc);

    // SKU and stock
    if (sku) parts.push(`SKU: ${sku}`);
    parts.push(`Stock: ${stockStatus}`);

    // Categories
    if (tax.categories.length > 0) {
      parts.push(`Categories: ${tax.categories.join(', ')}`);
    }

    // Attributes
    const attrEntries = Object.entries(tax.attributes);
    if (attrEntries.length > 0) {
      const attrStr = attrEntries
        .map(([key, vals]) => `${key}: ${vals.join(', ')}`)
        .join(', ');
      parts.push(`Attributes: ${attrStr}`);
    }

    const cleanedContent = parts.join('. ');

    // Custom fields for structured retrieval
    const customFields: Record<string, string> = {};
    if (price) customFields._price = price;
    if (sku) customFields._sku = sku;
    if (meta._stock_status) customFields._stock_status = meta._stock_status;
    customFields._product_type = productType;
    if (salePrice) customFields._sale_price = salePrice;

    return {
      id,
      title,
      content: rawContent,
      cleanedContent,
      excerpt,
      postType: 'product',
      postStatus: 'publish',
      author: String(row.post_author ?? ''),
      date: row.post_date ? String(row.post_date) : '',
      categories: tax.categories,
      tags: tax.tags,
      customFields,
    };
  });
}
