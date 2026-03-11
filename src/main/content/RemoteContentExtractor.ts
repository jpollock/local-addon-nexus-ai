/**
 * RemoteContentExtractor - Extracts content from WPE sites via WP-CLI
 *
 * Uses localServices.remoteWpCliRun() to execute WP-CLI commands on remote WPE installs.
 * Extracts posts/pages for vector indexing.
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
   * Extract content from a WPE install via remote WP-CLI
   */
  async extract(installName: string): Promise<ExtractedContent> {
    const posts: ExtractedPost[] = [];

    try {
      this.logger.info(`[RemoteContentExtractor] Starting content extraction for ${installName}...`);

      // Get list of post types
      this.logger.info(`[RemoteContentExtractor] Step 1: Getting post types...`);
      const postTypes = await this.getPostTypes(installName);
      this.logger.info(`[RemoteContentExtractor] Got post types:`, postTypes);

      const indexableTypes = postTypes.filter(
        (type: string) => !EXCLUDED_POST_TYPES.includes(type)
      );

      this.logger.info(`[RemoteContentExtractor] Found ${indexableTypes.length} indexable post types: ${indexableTypes.join(', ')}`);

      // Extract posts for each post type
      for (const postType of indexableTypes) {
        this.logger.info(`[RemoteContentExtractor] Step 2: Extracting posts for type: ${postType}...`);
        const typePosts = await this.extractPostType(installName, postType);
        this.logger.info(`[RemoteContentExtractor] Extracted ${typePosts.length} posts for type: ${postType}`);
        posts.push(...typePosts);
      }

      this.logger.info(`[RemoteContentExtractor] Extracted ${posts.length} total posts from ${installName}`);

      return {
        posts,
        siteInfo: {
          name: installName,
          url: `${installName}.wpengine.com`,
          wpVersion: '',
        },
        extractedAt: Date.now(),
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[RemoteContentExtractor] Failed to extract from ${installName}:`, errorMsg, errorStack);
      throw error;
    }
  }

  /**
   * Get list of post types via WP-CLI
   */
  private async getPostTypes(installName: string): Promise<string[]> {
    try {
      const result = await this.localServices.remoteWpCliRun(installName, [
        'post-type',
        'list',
        '--field=name',
        '--format=json',
      ]);

      if (result.success && result.stdout) {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed : [];
      }

      // Fallback to common types
      this.logger.warn(`[RemoteContentExtractor] Failed to get post types, using defaults`);
      return ['post', 'page'];
    } catch (error) {
      this.logger.warn(`[RemoteContentExtractor] Failed to get post types, using defaults:`, error);
      return ['post', 'page'];
    }
  }

  /**
   * Extract posts of a specific type
   */
  private async extractPostType(installName: string, postType: string): Promise<ExtractedPost[]> {
    const posts: ExtractedPost[] = [];

    try {
      this.logger.info(`[RemoteContentExtractor] Getting post list for type: ${postType}...`);

      // Get list of post IDs
      const listResult = await this.localServices.remoteWpCliRun(installName, [
        'post',
        'list',
        `--post_type=${postType}`,
        '--post_status=publish',
        '--fields=ID,post_title',
        '--format=json',
      ]);

      this.logger.info(`[RemoteContentExtractor] Post list result:`, listResult);

      if (!listResult.success || !listResult.stdout) {
        this.logger.warn(`[RemoteContentExtractor] No posts found for type ${postType}`);
        return posts;
      }

      const postList = JSON.parse(listResult.stdout);
      this.logger.info(`[RemoteContentExtractor] Parsed ${Array.isArray(postList) ? postList.length : 0} posts`);

      if (!Array.isArray(postList) || postList.length === 0) {
        return posts;
      }

      this.logger.info(`[RemoteContentExtractor] Found ${postList.length} ${postType} posts in ${installName}`);

      // Extract content for each post (limit to 100 posts per type to avoid overwhelming)
      const limit = Math.min(postList.length, 100);
      for (let i = 0; i < limit; i++) {
        const postMeta = postList[i];

        try {
          const post = await this.extractPost(installName, postMeta.ID);
          if (post) {
            posts.push(post);
          }
        } catch (error) {
          this.logger.warn(`[RemoteContentExtractor] Failed to extract post ${postMeta.ID}:`, error);
        }
      }

      if (postList.length > limit) {
        this.logger.info(`[RemoteContentExtractor] Limited to ${limit} of ${postList.length} ${postType} posts`);
      }

      return posts;
    } catch (error) {
      this.logger.error(`[RemoteContentExtractor] Failed to extract ${postType}:`, error);
      return posts;
    }
  }

  /**
   * Extract a single post via WP-CLI
   */
  private async extractPost(installName: string, postId: number): Promise<ExtractedPost | null> {
    try {
      const result = await this.localServices.remoteWpCliRun(installName, [
        'post',
        'get',
        postId.toString(),
        '--format=json',
      ]);

      if (!result.success || !result.stdout) {
        return null;
      }

      const postData = JSON.parse(result.stdout);

      // Clean HTML content
      const cleanContent = postData.post_content
        ? cleanWordPressContent(postData.post_content)
        : '';

      return {
        id: postData.ID,
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
      };
    } catch (error) {
      this.logger.warn(`[RemoteContentExtractor] Failed to parse post ${postId}:`, error);
      return null;
    }
  }
}
