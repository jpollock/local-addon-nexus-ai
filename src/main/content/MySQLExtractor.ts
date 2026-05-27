import * as mysql from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ExtractedContent, ExtractedPost, SiteStructure } from '../../common/types';
import { EXCLUDED_POST_TYPES } from '../../common/constants';
import { cleanWordPressContent } from './html-cleaner';
import { extractProducts } from './extractors/WooCommerceExtractor';
import { enrichWithACF } from './extractors/ACFExtractor';
import { extractMedia } from './extractors/MediaExtractor';
import { discoverCustomTables } from './extractors/CustomTableDiscovery';
import { extractSiteStructureData, StructureData } from './extractors/StructureExtractor';

/**
 * Resolves MySQL connection config for a Local site.
 *
 * Local sites expose MySQL over a Unix socket at:
 *   ~/Library/Application Support/Local/run/{siteId}/mysql/mysqld.sock
 *
 * Credentials default to root/root, database "local".
 * These can be overridden by reading wp-config.php if needed.
 */
export interface SiteConnectionInfo {
  siteId: string;
  siteName: string;
  sitePath: string;          // e.g. /Users/.../Local Sites/mysite
  domain?: string;           // e.g. 'mysite.local'
}

function getSocketPath(siteId: string): string {
  const localAppData = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Local',
  );
  return path.join(localAppData, 'run', siteId, 'mysql', 'mysqld.sock');
}

function readWpConfigValue(wpConfigPath: string, constant: string): string | null {
  try {
    const content = fs.readFileSync(wpConfigPath, 'utf-8');
    // Match: define( 'DB_NAME', 'local' );
    const re = new RegExp(`define\\s*\\(\\s*['"]${constant}['"]\\s*,\\s*['"](.*?)['"]\\s*\\)`, 'i');
    const match = content.match(re);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getTablePrefix(wpConfigPath: string): string {
  try {
    const content = fs.readFileSync(wpConfigPath, 'utf-8');
    // Match: $table_prefix = 'wp_';
    const match = content.match(/\$table_prefix\s*=\s*['"](.*?)['"]/);
    return match ? match[1] : 'wp_';
  } catch {
    return 'wp_';
  }
}

/**
 * Retry wrapper for mysql.createConnection — MySQL socket may not be ready
 * for up to 10 seconds after siteStarted fires on slow machines.
 */
export async function connectWithRetry<T>(
  connectFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await connectFn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

export class MySQLExtractor {
  /**
   * Check whether the site's MySQL socket exists (site must be running).
   */
  isAvailable(info: SiteConnectionInfo): boolean {
    const sock = getSocketPath(info.siteId);
    return fs.existsSync(sock);
  }

  /**
   * Extract published content from a running Local site's MySQL database.
   * When `structure` is provided, conditionally runs sub-extractors for
   * WooCommerce products, ACF fields, media attachments, and custom tables.
   */
  async extract(info: SiteConnectionInfo, structure?: SiteStructure | null): Promise<ExtractedContent> {
    const socketPath = getSocketPath(info.siteId);
    const wpConfigPath = path.join(info.sitePath, 'app', 'public', 'wp-config.php');

    const dbName = readWpConfigValue(wpConfigPath, 'DB_NAME') ?? 'local';
    const dbUser = readWpConfigValue(wpConfigPath, 'DB_USER') ?? 'root';
    const dbPassword = readWpConfigValue(wpConfigPath, 'DB_PASSWORD') ?? 'root';
    const prefix = getTablePrefix(wpConfigPath);

    const connection = await connectWithRetry(
      () => mysql.createConnection({
        socketPath,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      }),
      3,
      2000,
    );

    try {
      const warnings: string[] = [];

      // When WooCommerce is detected, skip products from base query
      // so WooCommerceExtractor can provide enriched versions
      const skipPostTypes = structure?.hasWooCommerce ? ['product'] : [];

      const posts = await this.extractPosts(connection, prefix, skipPostTypes);
      const siteInfo = await this.extractSiteInfo(connection, prefix, info.siteName);

      // --- Sub-extractors (each wrapped in try/catch — non-fatal) ---

      // WooCommerce products (enriched with price, SKU, categories, attributes)
      if (structure?.hasWooCommerce) {
        try {
          const products = await extractProducts(connection, prefix);
          posts.push(...products);
        } catch (err) {
          warnings.push(`WooCommerceExtractor: ${(err as Error).message}`);
        }
      }

      // ACF custom fields (enriches posts in-place)
      if (structure?.hasACF) {
        try {
          await enrichWithACF(connection, prefix, posts);
        } catch (err) {
          warnings.push(`ACFExtractor: ${(err as Error).message}`);
        }
      }

      // Media attachments (always — lightweight, self-filtering)
      try {
        const media = await extractMedia(connection, prefix);
        posts.push(...media);
      } catch (err) {
        warnings.push(`MediaExtractor: ${(err as Error).message}`);
      }

      // Custom table discovery (structure-only metadata)
      let customTables;
      try {
        customTables = await discoverCustomTables(connection, prefix);
      } catch (err) {
        warnings.push(`CustomTableDiscovery: ${(err as Error).message}`);
      }

      // Structure enrichment (active theme/plugins, users, permalinks, health)
      let structureData: StructureData | undefined;
      try {
        structureData = await extractSiteStructureData(connection, prefix);
      } catch (err) {
        warnings.push(`StructureExtractor: ${(err as Error).message}`);
      }

      return {
        posts,
        siteInfo,
        extractedAt: Date.now(),
        customTables,
        warnings: warnings.length > 0 ? warnings : undefined,
        activeThemeSlug: structureData?.activeThemeSlug,
        activePluginSlugs: structureData?.activePluginSlugs,
        users: structureData?.users,
        permalinks: structureData?.permalinks,
        health: structureData?.health,
      };
    } finally {
      await connection.end();
    }
  }

  private async extractPosts(
    conn: mysql.Connection,
    prefix: string,
    skipPostTypes: string[] = [],
  ): Promise<ExtractedPost[]> {
    // Discover publishable post types
    const allExcluded = [...EXCLUDED_POST_TYPES, ...skipPostTypes];
    const excludeList = allExcluded.map((t) => `'${t}'`).join(', ');
    const [postTypeRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT post_type FROM ${prefix}posts
       WHERE post_status = 'publish' AND post_type NOT IN (${excludeList})`,
    );
    const postTypes = postTypeRows.map((r) => r.post_type as string);

    if (postTypes.length === 0) return [];

    const typeList = postTypes.map((t) => `'${t}'`).join(', ');

    // Fetch published posts
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT ID, post_title, post_content, post_excerpt, post_type,
              post_status, post_date, post_author
       FROM ${prefix}posts
       WHERE post_status = 'publish' AND post_type IN (${typeList})
       ORDER BY post_date DESC`,
    );

    if (rows.length === 0) return [];

    const postIds = rows.map((r) => r.ID as number);

    // Fetch metadata
    const metaMap = await this.fetchPostMeta(conn, prefix, postIds);

    // Fetch taxonomies (categories & tags)
    const taxMap = await this.fetchTaxonomies(conn, prefix, postIds);

    return rows.map((row) => {
      const id = row.ID as number;
      const rawContent = (row.post_content as string) ?? '';

      return {
        id,
        title: (row.post_title as string) ?? '',
        content: rawContent,
        cleanedContent: cleanWordPressContent(rawContent),
        excerpt: (row.post_excerpt as string) ?? '',
        postType: (row.post_type as string) ?? 'post',
        postStatus: (row.post_status as string) ?? 'publish',
        author: String(row.post_author ?? ''),
        date: row.post_date ? String(row.post_date) : '',
        categories: taxMap.get(id)?.categories ?? [],
        tags: taxMap.get(id)?.tags ?? [],
        customFields: metaMap.get(id) ?? {},
      };
    });
  }

  private async fetchPostMeta(
    conn: mysql.Connection,
    prefix: string,
    postIds: number[],
  ): Promise<Map<number, Record<string, string>>> {
    const map = new Map<number, Record<string, string>>();
    if (postIds.length === 0) return map;

    const placeholders = postIds.map(() => '?').join(', ');
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT post_id, meta_key, meta_value
       FROM ${prefix}postmeta
       WHERE post_id IN (${placeholders})
         AND meta_key NOT LIKE '\\_%'`,
      postIds,
    );

    for (const row of rows) {
      const pid = row.post_id as number;
      if (!map.has(pid)) map.set(pid, {});
      map.get(pid)![row.meta_key as string] = String(row.meta_value ?? '');
    }

    return map;
  }

  private async fetchTaxonomies(
    conn: mysql.Connection,
    prefix: string,
    postIds: number[],
  ): Promise<Map<number, { categories: string[]; tags: string[] }>> {
    const map = new Map<number, { categories: string[]; tags: string[] }>();
    if (postIds.length === 0) return map;

    const placeholders = postIds.map(() => '?').join(', ');
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT t.name, tt.taxonomy, tr.object_id
       FROM ${prefix}terms t
       JOIN ${prefix}term_taxonomy tt ON t.term_id = tt.term_id
       JOIN ${prefix}term_relationships tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
       WHERE tr.object_id IN (${placeholders})`,
      postIds,
    );

    for (const row of rows) {
      const pid = row.object_id as number;
      if (!map.has(pid)) map.set(pid, { categories: [], tags: [] });
      const entry = map.get(pid)!;
      const taxonomy = row.taxonomy as string;
      const name = row.name as string;

      if (taxonomy === 'category') {
        entry.categories.push(name);
      } else if (taxonomy === 'post_tag') {
        entry.tags.push(name);
      }
    }

    return map;
  }

  private async extractSiteInfo(
    conn: mysql.Connection,
    prefix: string,
    fallbackName: string,
  ): Promise<{ name: string; url: string; wpVersion: string }> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT option_name, option_value
       FROM ${prefix}options
       WHERE option_name IN ('siteurl', 'blogname', 'blogdescription', 'db_version')`,
    );

    const options: Record<string, string> = {};
    for (const row of rows) {
      options[row.option_name as string] = row.option_value as string;
    }

    return {
      name: options.blogname ?? fallbackName,
      url: options.siteurl ?? '',
      wpVersion: options.db_version ?? '',
    };
  }
}
