/**
 * RemoteContentExtractor - Extracts content from WPE sites via WP-CLI
 *
 * Uses --post_type=any to get ALL published posts in a single SSH call,
 * regardless of post type registration. This is crucial because --skip-plugins
 * (used for safety/speed) prevents custom post types from being registered,
 * so wp post-type list misses plugin-registered types like 'recipe'.
 *
 * Posts are filtered client-side against EXCLUDED_POST_TYPES.
 */

import { ExtractedContent, ExtractedPost } from '../../common/types';
import { EXCLUDED_POST_TYPES } from '../../common/constants';
import { cleanWordPressContent } from './html-cleaner';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';

export interface RemoteContentExtractorOptions {
  localServices: LocalServicesBridge;
  logger?: any;
}

export class RemoteContentExtractor {
  private localServices: LocalServicesBridge;
  private logger: any;

  constructor(options: RemoteContentExtractorOptions) {
    this.localServices = options.localServices;
    this.logger = options.logger || console;
  }

  /**
   * Extract all published content from a WPE install in a single SSH call.
   * Uses --post_type=any so plugin-registered types (e.g. 'recipe') are
   * captured even when --skip-plugins prevents their registration.
   */
  async extract(installName: string): Promise<ExtractedContent> {
    try {
      this.logger.info(`[RemoteContentExtractor] Starting content extraction for ${installName}...`);

      const result = await this.localServices.remoteWpCliRun(installName, [
        'post',
        'list',
        '--post_type=any',
        '--post_status=publish',
        '--fields=ID,post_title,post_content,post_excerpt,post_type,post_status,post_author,post_date',
        '--posts_per_page=200',
        '--format=json',
      ]);

      if (!result.success || !result.stdout) {
        this.logger.warn(`[RemoteContentExtractor] No posts returned for ${installName}`);
        return this.emptyResult(installName);
      }

      const rawPosts = JSON.parse(result.stdout);
      if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
        this.logger.info(`[RemoteContentExtractor] No published posts in ${installName}`);
        return this.emptyResult(installName);
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

      this.logger.info(
        `[RemoteContentExtractor] ${installName}: ${rawPosts.length} total → ${filtered.length} indexable (${typeBreakdown})`
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
            customFields: {},
          } as ExtractedPost;
        })
        .filter((p: ExtractedPost) => p.cleanedContent.trim().length > 0);

      this.logger.info(`[RemoteContentExtractor] Extracted ${posts.length} posts with content from ${installName}`);

      return {
        posts,
        siteInfo: { name: installName, url: `${installName}.wpengine.com`, wpVersion: '' },
        extractedAt: Date.now(),
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RemoteContentExtractor] Failed to extract from ${installName}:`, errorMsg);
      throw error;
    }
  }

  private emptyResult(installName: string): ExtractedContent {
    return {
      posts: [],
      siteInfo: { name: installName, url: `${installName}.wpengine.com`, wpVersion: '' },
      extractedAt: Date.now(),
    };
  }
}
