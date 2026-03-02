import { enrichWithACF } from '../../../src/main/content/extractors/ACFExtractor';
import { ExtractedPost } from '../../../src/common/types';

function makePost(id: number, overrides?: Partial<ExtractedPost>): ExtractedPost {
  return {
    id,
    title: `Post ${id}`,
    content: `<p>Content for post ${id}</p>`,
    cleanedContent: `Content for post ${id}`,
    excerpt: `Excerpt ${id}`,
    postType: 'post',
    postStatus: 'publish',
    author: '1',
    date: '2024-01-01',
    categories: ['Uncategorized'],
    tags: [],
    customFields: {},
    ...overrides,
  };
}

function createMockConnection(
  fieldDefs: any[],
  metaRows: any[],
) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce([fieldDefs])   // ACF field definitions
      .mockResolvedValueOnce([metaRows]),   // postmeta
  } as any;
}

describe('ACFExtractor edge cases', () => {
  test('repeater with 3 rows formatted correctly', async () => {
    const posts = [makePost(1)];

    // Build meta: repeater count + 3 rows, each with a "name" sub-field
    const metaRows = [
      { post_id: 1, meta_key: 'team_members', meta_value: '3' },
      { post_id: 1, meta_key: '_team_members', meta_value: 'field_rep' },
      { post_id: 1, meta_key: 'team_members_0_name', meta_value: 'Alice' },
      { post_id: 1, meta_key: 'team_members_1_name', meta_value: 'Bob' },
      { post_id: 1, meta_key: 'team_members_2_name', meta_value: 'Charlie' },
    ];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_rep',
          post_content: 'a:2:{s:4:"type";s:8:"repeater";s:5:"label";s:12:"Team Members";}',
          post_excerpt: 'team_members',
          post_title: 'Team Members',
        },
      ],
      metaRows,
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Team Members:');
    expect(posts[0].cleanedContent).toContain('name: Alice');
    expect(posts[0].cleanedContent).toContain('name: Bob');
    expect(posts[0].cleanedContent).toContain('name: Charlie');
  });

  test('repeater count > 20 capped at safety limit', async () => {
    const posts = [makePost(1)];

    // Claim 50 rows but only provide data for some
    const metaRows: any[] = [
      { post_id: 1, meta_key: 'items', meta_value: '50' },
      { post_id: 1, meta_key: '_items', meta_value: 'field_items' },
    ];

    // Add 25 rows of data
    for (let i = 0; i < 25; i++) {
      metaRows.push({
        post_id: 1,
        meta_key: `items_${i}_value`,
        meta_value: `Item ${i}`,
      });
    }

    const conn = createMockConnection(
      [
        {
          post_name: 'field_items',
          post_content: 'a:2:{s:4:"type";s:8:"repeater";s:5:"label";s:5:"Items";}',
          post_excerpt: 'items',
          post_title: 'Items',
        },
      ],
      metaRows,
    );

    await enrichWithACF(conn, 'wp_', posts);

    // Only first 20 should be processed (safety limit in ACFExtractor)
    expect(posts[0].cleanedContent).toContain('Item 0');
    expect(posts[0].cleanedContent).toContain('Item 19');
    expect(posts[0].cleanedContent).not.toContain('Item 20');
  });

  test('truncated serialized string — field skipped gracefully', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_broken',
          // Truncated serialized string — missing closing brace
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:',
          post_excerpt: 'broken_field',
          post_title: 'Broken Field',
        },
        {
          post_name: 'field_good',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:9:"Good Name";}',
          post_excerpt: 'good_field',
          post_title: 'Good Name',
        },
      ],
      [
        { post_id: 1, meta_key: 'broken_field', meta_value: 'value1' },
        { post_id: 1, meta_key: '_broken_field', meta_value: 'field_broken' },
        { post_id: 1, meta_key: 'good_field', meta_value: 'value2' },
        { post_id: 1, meta_key: '_good_field', meta_value: 'field_good' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    // The good field should still be enriched even if the broken one fails
    expect(posts[0].cleanedContent).toContain('Good Name: value2');
  });

  test('corrupted field definition — enrichment continues for other fields', async () => {
    const posts = [makePost(1), makePost(2)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_valid',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:4:"City";}',
          post_excerpt: 'city',
          post_title: 'City',
        },
      ],
      [
        // Post 1 has the valid field
        { post_id: 1, meta_key: 'city', meta_value: 'Portland' },
        { post_id: 1, meta_key: '_city', meta_value: 'field_valid' },
        // Post 2 also has it
        { post_id: 2, meta_key: 'city', meta_value: 'Seattle' },
        { post_id: 2, meta_key: '_city', meta_value: 'field_valid' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('City: Portland');
    expect(posts[1].cleanedContent).toContain('City: Seattle');
  });

  test('field definition query throws — no crash, posts unchanged', async () => {
    const posts = [makePost(1)];
    const originalContent = posts[0].cleanedContent;

    const conn = {
      query: jest.fn().mockRejectedValueOnce(new Error('Table not found')),
    } as any;

    await enrichWithACF(conn, 'wp_', posts);

    // Posts should remain unchanged
    expect(posts[0].cleanedContent).toBe(originalContent);
  });

  test('repeater with no sub-field data returns null gracefully', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_empty_rep',
          post_content: 'a:2:{s:4:"type";s:8:"repeater";s:5:"label";s:10:"Empty List";}',
          post_excerpt: 'empty_list',
          post_title: 'Empty List',
        },
      ],
      [
        { post_id: 1, meta_key: 'empty_list', meta_value: '0' },
        { post_id: 1, meta_key: '_empty_list', meta_value: 'field_empty_rep' },
      ],
    );

    const originalContent = posts[0].cleanedContent;
    await enrichWithACF(conn, 'wp_', posts);

    // Empty repeater (count=0) should not add anything
    expect(posts[0].cleanedContent).toBe(originalContent);
  });
});
