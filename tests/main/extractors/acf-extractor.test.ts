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

describe('ACFExtractor', () => {
  test('enriches posts with text ACF fields', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_abc123',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:10:"First Name";}',
          post_excerpt: 'first_name',
          post_title: 'First Name',
        },
      ],
      [
        { post_id: 1, meta_key: 'first_name', meta_value: 'Alice' },
        { post_id: 1, meta_key: '_first_name', meta_value: 'field_abc123' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Custom Fields: First Name: Alice');
    expect(posts[0].customFields.first_name).toBe('Alice');
  });

  test('handles multiple ACF fields on a post', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_111',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:5:"Color";}',
          post_excerpt: 'color',
          post_title: 'Color',
        },
        {
          post_name: 'field_222',
          post_content: 'a:2:{s:4:"type";s:6:"number";s:5:"label";s:5:"Price";}',
          post_excerpt: 'price',
          post_title: 'Price',
        },
      ],
      [
        { post_id: 1, meta_key: 'color', meta_value: 'Red' },
        { post_id: 1, meta_key: '_color', meta_value: 'field_111' },
        { post_id: 1, meta_key: 'price', meta_value: '29.99' },
        { post_id: 1, meta_key: '_price', meta_value: 'field_222' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Color: Red');
    expect(posts[0].cleanedContent).toContain('Price: 29.99');
  });

  test('handles true_false fields', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_tf',
          post_content: 'a:2:{s:4:"type";s:10:"true_false";s:5:"label";s:8:"Featured";}',
          post_excerpt: 'featured',
          post_title: 'Featured',
        },
      ],
      [
        { post_id: 1, meta_key: 'featured', meta_value: '1' },
        { post_id: 1, meta_key: '_featured', meta_value: 'field_tf' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Featured: Yes');
  });

  test('handles wysiwyg fields by stripping HTML', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_wys',
          post_content: 'a:2:{s:4:"type";s:7:"wysiwyg";s:5:"label";s:4:"Body";}',
          post_excerpt: 'body',
          post_title: 'Body',
        },
      ],
      [
        { post_id: 1, meta_key: 'body', meta_value: '<p>Hello <strong>world</strong></p>' },
        { post_id: 1, meta_key: '_body', meta_value: 'field_wys' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Body: Hello world');
    expect(posts[0].cleanedContent).not.toContain('<');
  });

  test('handles select fields with serialized arrays', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_sel',
          post_content: 'a:2:{s:4:"type";s:8:"checkbox";s:5:"label";s:7:"Options";}',
          post_excerpt: 'options',
          post_title: 'Options',
        },
      ],
      [
        { post_id: 1, meta_key: 'options', meta_value: 'a:2:{i:0;s:3:"foo";i:1;s:3:"bar";}' },
        { post_id: 1, meta_key: '_options', meta_value: 'field_sel' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Options: foo, bar');
  });

  test('handles image/file fields', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_img',
          post_content: 'a:2:{s:4:"type";s:5:"image";s:5:"label";s:5:"Photo";}',
          post_excerpt: 'photo',
          post_title: 'Photo',
        },
      ],
      [
        { post_id: 1, meta_key: 'photo', meta_value: '42' },
        { post_id: 1, meta_key: '_photo', meta_value: 'field_img' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Photo: (attachment #42)');
  });

  test('skips posts without ACF fields', async () => {
    const posts = [makePost(1), makePost(2)];
    const originalContent = posts[1].cleanedContent;

    const conn = createMockConnection(
      [
        {
          post_name: 'field_abc',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:4:"Name";}',
          post_excerpt: 'name',
          post_title: 'Name',
        },
      ],
      [
        // Only post 1 has ACF fields
        { post_id: 1, meta_key: 'name', meta_value: 'Test' },
        { post_id: 1, meta_key: '_name', meta_value: 'field_abc' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Custom Fields:');
    expect(posts[1].cleanedContent).toBe(originalContent);
  });

  test('handles empty posts array', async () => {
    const conn = { query: jest.fn() } as any;
    const posts: ExtractedPost[] = [];

    await enrichWithACF(conn, 'wp_', posts);

    expect(conn.query).not.toHaveBeenCalled();
  });

  test('handles no ACF field definitions', async () => {
    const posts = [makePost(1)];
    const originalContent = posts[0].cleanedContent;

    const conn = createMockConnection([], []);

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toBe(originalContent);
  });

  test('handles date_picker fields', async () => {
    const posts = [makePost(1)];

    const conn = createMockConnection(
      [
        {
          post_name: 'field_date',
          post_content: 'a:2:{s:4:"type";s:11:"date_picker";s:5:"label";s:10:"Event Date";}',
          post_excerpt: 'event_date',
          post_title: 'Event Date',
        },
      ],
      [
        { post_id: 1, meta_key: 'event_date', meta_value: '20240315' },
        { post_id: 1, meta_key: '_event_date', meta_value: 'field_date' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    expect(posts[0].cleanedContent).toContain('Event Date: 20240315');
  });

  test('skips empty field values', async () => {
    const posts = [makePost(1)];
    const originalContent = posts[0].cleanedContent;

    const conn = createMockConnection(
      [
        {
          post_name: 'field_empty',
          post_content: 'a:2:{s:4:"type";s:4:"text";s:5:"label";s:5:"Notes";}',
          post_excerpt: 'notes',
          post_title: 'Notes',
        },
      ],
      [
        { post_id: 1, meta_key: 'notes', meta_value: '' },
        { post_id: 1, meta_key: '_notes', meta_value: 'field_empty' },
      ],
    );

    await enrichWithACF(conn, 'wp_', posts);

    // Empty values should not add "Custom Fields:" section
    expect(posts[0].cleanedContent).toBe(originalContent);
  });
});
