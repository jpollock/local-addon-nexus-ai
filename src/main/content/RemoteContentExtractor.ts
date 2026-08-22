/**
 * RemoteContentExtractor - Extracts content from a remote site via WP-CLI
 *
 * Consumes a `SiteTransport` (WPE, external SSH, etc.) so it works against any
 * target that can run WP-CLI remotely, not just WP Engine.
 *
 * Uses --post_type=any to get ALL published posts, regardless of post type
 * registration. This is crucial because --skip-plugins (used for safety/speed)
 * prevents custom post types from being registered, so wp post-type list
 * misses plugin-registered types like 'recipe'.
 *
 * Posts are filtered client-side against EXCLUDED_POST_TYPES.
 *
 * WP-62 — THREE THINGS THIS FUNCTION USED TO GET WRONG, ALL SILENTLY:
 *
 *  1. It issued ONE query with `--posts_per_page=200` and no offset, then
 *     logged the result as `${rawPosts.length} total`. Two live installs sat
 *     on exactly 200; one with 30,628 published posts indexed 2. A page-size
 *     query returning exactly the page size is a BOUNDARY, not a count.
 *  2. It asked for no post meta, while the local path appends every public
 *     custom field into the searchable text. That gap produced no count to be
 *     wrong, which is why nobody reported it.
 *  3. Its ordering was WP_Query's default (`date DESC`). Measured on
 *     cedarvalehealt, 200+ posts share one `post_date` to the second, so ties
 *     resolve in unspecified order and offset paging over that sort can drop
 *     and duplicate rows. Pagination pins `--orderby=ID --order=ASC`.
 *
 * The rule this now follows: any query with a limit compares its result count
 * to that limit and treats equality as TRUNCATION UNTIL PROVEN OTHERWISE.
 * Completeness is established by reading a SHORT page, never inferred from a
 * full one.
 */

import { ExtractedContent, ExtractedPost, ExtractionCoverage } from '../../common/types';
import { EXCLUDED_POST_TYPES } from '../../common/constants';
import { cleanWordPressContent } from './html-cleaner';
import { parseWxrPostMeta, buildWxrExportArgs } from './wxr-postmeta';
import type { SiteTransport } from '../transport/types';

/**
 * Rows per WP-CLI call. NOT a cap on the site — the extractor pages until it
 * reads a short page. 200 measured at 3.1 s / 545 KB against a live WP Engine
 * install, comfortably inside the single-command SSH budget.
 */
export const REMOTE_PAGE_SIZE = 200;

/**
 * A STATED ceiling, and the only one. It exists because everything downstream
 * is held in memory at once — the post array, the chunk array, and one
 * `Float32Array` per chunk — and chunking MULTIPLIES the document count, so a
 * 30,628-post install can become 100k+ chunks. When this fires the result is
 * marked incomplete with `truncatedReason: 'max-posts'` and the log says so.
 *
 * Raising it is a memory decision, not a correctness one: the silent 200 this
 * replaced was wrong because it was silent, and a larger silent number would
 * be wrong the same way.
 */
export const REMOTE_MAX_POSTS = 5000;

export interface RemoteContentExtractorOptions {
  logger?: any;
  /** Overridable for tests; production uses the module constants. */
  pageSize?: number;
  maxPosts?: number;
}

export class RemoteContentExtractor {
  private logger: any;
  private pageSize: number;
  private maxPosts: number;

  constructor(options: RemoteContentExtractorOptions) {
    this.logger = options.logger || console;
    this.pageSize = options.pageSize ?? REMOTE_PAGE_SIZE;
    this.maxPosts = options.maxPosts ?? REMOTE_MAX_POSTS;
  }

  /**
   * Extract all published content from a remote site, paging until the end of
   * the population is actually observed.
   *
   * Uses --post_type=any so plugin-registered types (e.g. 'recipe') are
   * captured even when --skip-plugins prevents their registration.
   */
  async extract(transport: SiteTransport, siteLabel: string): Promise<ExtractedContent> {
    try {
      this.logger.info(`[RemoteContentExtractor] Starting content extraction for ${siteLabel}...`);

      const { rawPosts, coverage } = await this.fetchAllPages(transport, siteLabel);

      if (rawPosts.length === 0) {
        this.logger.info(`[RemoteContentExtractor] No published posts in ${siteLabel}`);
        return this.emptyResult(siteLabel, coverage);
      }

      // Filter out excluded post types client-side
      const filtered = rawPosts.filter(
        (p: any) => p.post_type && !EXCLUDED_POST_TYPES.includes(p.post_type)
      );

      const typeBreakdown = Object.entries(
        filtered.reduce((acc: Record<string, number>, p: any) => {
          acc[p.post_type] = (acc[p.post_type] || 0) + 1;
          return acc;
        }, {})
      ).map(([t, n]) => `${t}:${n}`).join(', ');

      // "rows read", not "total": this figure is what the extractor FETCHED,
      // and whether that is the population is exactly what `coverage.complete`
      // answers. The old line said "total" of a number capped at 200.
      this.logger.info(
        `[RemoteContentExtractor] ${siteLabel}: ${rawPosts.length} rows read over `
        + `${coverage.pagesFetched} page(s) → ${filtered.length} indexable (${typeBreakdown})`
      );

      if (!coverage.complete) {
        // The precedent is ExternalSshTransport.runWpCliBatch: a partial result
        // is "honest but invisible" without a warning at the seam, and the only
        // symptom otherwise is missing rows in a database hours later.
        this.logger.warn(
          `[RemoteContentExtractor] ${siteLabel}: extraction INCOMPLETE — `
          + `${coverage.truncatedDetail ?? coverage.truncatedReason}. `
          + `The indexed document count is a floor, not a total.`
        );
      }

      const customFields = await this.fetchCustomFields(
        transport, siteLabel, filtered.map((p: any) => Number(p.ID)), coverage,
      );

      const posts: ExtractedPost[] = filtered
        .map((postData: any) => {
          const cleanContent = postData.post_content
            ? cleanWordPressContent(postData.post_content)
            : '';
          return {
            id: Number(postData.ID),
            title: postData.post_title || '',
            content: postData.post_content || '',
            cleanedContent: cleanContent,
            excerpt: postData.post_excerpt || '',
            postType: postData.post_type || 'post',
            postStatus: postData.post_status || 'publish',
            author: postData.post_author ? String(postData.post_author) : '0',
            date: postData.post_date || new Date().toISOString(),
            categories: [],
            tags: [],
            customFields: customFields.get(Number(postData.ID)) ?? {},
          } as ExtractedPost;
        })
        .filter((p: ExtractedPost) => p.cleanedContent.trim().length > 0);

      this.logger.info(`[RemoteContentExtractor] Extracted ${posts.length} posts with content from ${siteLabel}`);

      return {
        posts,
        siteInfo: { name: siteLabel, url: '', wpVersion: '' },
        extractedAt: Date.now(),
        coverage,
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RemoteContentExtractor] Failed to extract from ${siteLabel}:`, errorMsg);
      throw error;
    }
  }

  /**
   * Page through `wp post list` until a page comes back SHORT.
   *
   * A page that returns exactly `pageSize` proves nothing about the end of the
   * population, so the loop keeps going; only a short (or empty) page sets
   * `complete`. The two other exits — the stated ceiling and a failed page —
   * both leave `complete` false with a reason attached.
   */
  private async fetchAllPages(
    transport: SiteTransport,
    siteLabel: string,
  ): Promise<{ rawPosts: any[]; coverage: ExtractionCoverage }> {
    const rawPosts: any[] = [];
    let pagesFetched = 0;
    let complete = false;
    let truncatedReason: ExtractionCoverage['truncatedReason'];
    let truncatedDetail: string | undefined;

    for (let offset = 0; ; offset += this.pageSize) {
      // Load plugins AND themes so custom post types (e.g. 'recipe') are
      // registered and included when post_type=any is used. Without them, only
      // core post types appear in WP_Query results — and plenty of themes still
      // register CPTs from functions.php.
      //
      // skipThemes: false is stated explicitly because the two flags are now
      // independent (ssh-args.ts). It used to be implied: skipPlugins: false
      // zeroed both. Dropping it would silently narrow this index.
      const result = await transport.runWpCli([
        'post',
        'list',
        '--post_type=any',
        '--post_status=publish',
        // A total order. WP_Query's default `date DESC` leaves same-second
        // ties unspecified, and offset paging over an unstable sort drops and
        // duplicates rows — measured: 200+ posts share one timestamp on a
        // real install.
        '--orderby=ID',
        '--order=ASC',
        '--fields=ID,post_title,post_content,post_excerpt,post_type,post_status,post_author,post_date',
        `--posts_per_page=${this.pageSize}`,
        `--offset=${offset}`,
        '--format=json',
      ], { skipPlugins: false, skipThemes: false });

      if (!result.success || !result.stdout) {
        if (pagesFetched === 0) {
          this.logger.warn(`[RemoteContentExtractor] No posts returned for ${siteLabel}`);
          // Nothing was read at all. That is not an empty site — it is an
          // unread one, and the two must not look alike downstream.
          truncatedReason = 'page-failed';
          truncatedDetail = `the first page failed: ${String(result.stdout ?? '').slice(0, 200) || 'no output'}`;
          break;
        }
        truncatedReason = 'page-failed';
        truncatedDetail = `page ${pagesFetched + 1} (offset ${offset}) failed after `
          + `${rawPosts.length} rows: ${String(result.stdout ?? '').slice(0, 200) || 'no output'}`;
        break;
      }

      let page: any;
      try {
        page = JSON.parse(result.stdout);
      } catch (err: any) {
        truncatedReason = 'page-failed';
        truncatedDetail = `page ${pagesFetched + 1} (offset ${offset}) returned unparseable JSON`;
        break;
      }

      if (!Array.isArray(page)) {
        truncatedReason = 'page-failed';
        truncatedDetail = `page ${pagesFetched + 1} (offset ${offset}) was not a JSON array`;
        break;
      }

      pagesFetched++;
      rawPosts.push(...page);

      if (page.length < this.pageSize) {
        // The end of the population was OBSERVED, not assumed.
        complete = true;
        break;
      }

      if (rawPosts.length >= this.maxPosts) {
        truncatedReason = 'max-posts';
        truncatedDetail = `stopped at the stated ${this.maxPosts}-post ceiling `
          + `(REMOTE_MAX_POSTS) with a full page still returning`;
        break;
      }
    }

    return {
      rawPosts,
      coverage: {
        pageSize: this.pageSize,
        pagesFetched,
        rowsReturned: rawPosts.length,
        complete,
        ...(complete ? {} : { truncatedReason, truncatedDetail }),
        customFields: 'not-attempted',
      },
    };
  }

  /**
   * Public post meta for the fetched posts, in ONE WordPress bootstrap per
   * page of ids. Mutates `coverage.customFields` so the outcome is recorded
   * whichever way it goes — an unavailable field set is stated, never an
   * empty object that reads as "this site has no custom fields".
   */
  private async fetchCustomFields(
    transport: SiteTransport,
    siteLabel: string,
    postIds: number[],
    coverage: ExtractionCoverage,
  ): Promise<Map<number, Record<string, string>>> {
    const all = new Map<number, Record<string, string>>();
    if (postIds.length === 0) {
      coverage.customFields = 'collected';
      return all;
    }

    let itemsSeen = 0;
    for (let i = 0; i < postIds.length; i += this.pageSize) {
      const batch = postIds.slice(i, i + this.pageSize);
      let result;
      try {
        result = await transport.runWpCli(
          buildWxrExportArgs(batch),
          { skipPlugins: false, skipThemes: false },
        );
      } catch (err: any) {
        coverage.customFields = 'unavailable';
        coverage.customFieldsDetail = `wp export threw: ${err?.message ?? String(err)}`;
        this.logger.warn(
          `[RemoteContentExtractor] ${siteLabel}: custom fields NOT collected — ${coverage.customFieldsDetail}`
        );
        return new Map();
      }

      if (!result.success || !result.stdout) {
        coverage.customFields = 'unavailable';
        coverage.customFieldsDetail = `wp export failed: ${String(result?.stdout ?? '').slice(0, 200) || 'no output'}`;
        this.logger.warn(
          `[RemoteContentExtractor] ${siteLabel}: custom fields NOT collected — ${coverage.customFieldsDetail}`
        );
        return new Map();
      }

      const parsed = parseWxrPostMeta(result.stdout);
      itemsSeen += parsed.itemsSeen;
      for (const [id, fields] of parsed.meta) all.set(id, fields);
    }

    if (itemsSeen === 0) {
      // The command succeeded and produced nothing this parser recognises —
      // an old WP-CLI without `--stdout`, a host that disables export, a
      // plain-text error on stdout. Say so rather than reporting zero fields.
      coverage.customFields = 'unavailable';
      coverage.customFieldsDetail = 'wp export returned no WXR items';
      this.logger.warn(
        `[RemoteContentExtractor] ${siteLabel}: custom fields NOT collected — ${coverage.customFieldsDetail}`
      );
      return new Map();
    }

    coverage.customFields = 'collected';
    this.logger.info(
      `[RemoteContentExtractor] ${siteLabel}: custom fields collected for `
      + `${all.size} of ${postIds.length} posts (${itemsSeen} WXR items read)`
    );
    return all;
  }

  private emptyResult(siteLabel: string, coverage?: ExtractionCoverage): ExtractedContent {
    return {
      posts: [],
      siteInfo: { name: siteLabel, url: '', wpVersion: '' },
      extractedAt: Date.now(),
      ...(coverage ? { coverage } : {}),
    };
  }
}
