/**
 * Post Generator for Stress Tests
 *
 * Creates large volumes of WordPress content for testing indexing
 * and search performance.
 */

import { McpClient } from '../../e2e/helpers/client';

export interface PostConfig {
  title: string;
  content: string;
  post_type?: string;
  status?: 'publish' | 'draft';
}

export class PostGenerator {
  constructor(private client: McpClient) {}

  /**
   * Create multiple posts via wp eval
   */
  async createPosts(siteName: string, count: number): Promise<number[]> {
    const postIds: number[] = [];

    // Create posts in batches of 50 to avoid timeout
    const batchSize = 50;
    for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
      const batchCount = Math.min(batchSize, count - batch * batchSize);
      const batchStart = batch * batchSize + 1;

      console.log(`[PostGenerator] Creating posts ${batchStart}-${batchStart + batchCount - 1}...`);

      // Use wp eval to create posts in bulk
      const phpCode = `
        $ids = [];
        for ($i = ${batchStart}; $i <= ${batchStart + batchCount - 1}; $i++) {
          $post_id = wp_insert_post([
            'post_title' => 'Stress Test Post ' . $i,
            'post_content' => 'This is test content for post ' . $i . '. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
            'post_status' => 'publish',
            'post_type' => 'post',
          ]);
          if (!is_wp_error($post_id)) {
            $ids[] = $post_id;
          }
        }
        echo json_encode($ids);
      `;

      try {
        const result = await this.client.callTool('wp_eval', {
          site: siteName,
          code: phpCode,
        });

        if (!result.isError) {
          const text = result.content[0]?.text || '';
          const ids = JSON.parse(text);
          postIds.push(...ids);
          console.log(`[PostGenerator] Created ${ids.length} posts`);
        } else {
          console.error(`[PostGenerator] Batch ${batch} failed:`, result.content[0]?.text);
        }
      } catch (err) {
        console.error(`[PostGenerator] Error creating batch ${batch}:`, err);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return postIds;
  }

  /**
   * Delete posts
   */
  async deletePosts(siteName: string, postIds: number[]): Promise<void> {
    console.log(`[PostGenerator] Deleting ${postIds.length} posts...`);

    // Delete in batches
    const batchSize = 50;
    for (let i = 0; i < postIds.length; i += batchSize) {
      const batch = postIds.slice(i, i + batchSize);
      const idList = batch.join(',');

      const phpCode = `
        $ids = [${idList}];
        foreach ($ids as $id) {
          wp_delete_post($id, true);
        }
        echo count($ids) . ' posts deleted';
      `;

      try {
        await this.client.callTool('wp_eval', {
          site: siteName,
          code: phpCode,
        });
      } catch (err) {
        console.error(`[PostGenerator] Error deleting batch:`, err);
      }
    }

    console.log(`[PostGenerator] Deleted ${postIds.length} posts`);
  }

  /**
   * Generate fixture post data (for testing without real DB)
   */
  static generateFixtures(count: number): PostConfig[] {
    const fixtures: PostConfig[] = [];

    for (let i = 1; i <= count; i++) {
      fixtures.push({
        title: `Stress Test Post ${i}`,
        content: `This is test content for post ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`,
        post_type: 'post',
        status: 'publish',
      });
    }

    return fixtures;
  }
}
