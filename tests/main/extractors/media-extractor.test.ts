import { extractMedia } from '../../../src/main/content/extractors/MediaExtractor';

function createMockConnection(
  attachments: any[],
  metaRows: any[] = [],
) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce([attachments]) // post query
      .mockResolvedValueOnce([metaRows]),   // meta query
  } as any;
}

describe('MediaExtractor', () => {
  test('extracts image attachments with metadata', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 10,
          post_title: 'Hero Banner',
          post_content: 'Main hero image for the homepage',
          post_excerpt: 'Hero banner caption',
          post_date: '2024-01-15',
          post_author: '1',
          post_mime_type: 'image/jpeg',
        },
      ],
      [
        { post_id: 10, meta_value: 'A beautiful sunset over mountains' },
      ],
    );

    const result = await extractMedia(conn, 'wp_');

    expect(result).toHaveLength(1);
    expect(result[0].postType).toBe('attachment');
    expect(result[0].title).toBe('Hero Banner');
    expect(result[0].cleanedContent).toContain('Image: Hero Banner');
    expect(result[0].cleanedContent).toContain('Alt text: A beautiful sunset over mountains');
    expect(result[0].cleanedContent).toContain('Caption: Hero banner caption');
    expect(result[0].customFields._wp_attachment_image_alt).toBe('A beautiful sunset over mountains');
  });

  test('filters out camera-default titles', async () => {
    const conn = createMockConnection([
      {
        ID: 20,
        post_title: 'IMG_1234',
        post_content: '',
        post_excerpt: '',
        post_date: '2024-01-15',
        post_author: '1',
        post_mime_type: 'image/jpeg',
      },
    ]);

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(0);
  });

  test('filters out DSC-prefixed titles', async () => {
    const conn = createMockConnection([
      {
        ID: 21,
        post_title: 'DSC_5678',
        post_content: '',
        post_excerpt: '',
        post_date: '2024-01-15',
        post_author: '1',
        post_mime_type: 'image/png',
      },
    ]);

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(0);
  });

  test('filters out Screenshot titles', async () => {
    const conn = createMockConnection([
      {
        ID: 22,
        post_title: 'Screenshot 2024-01-15',
        post_content: '',
        post_excerpt: '',
        post_date: '2024-01-15',
        post_author: '1',
        post_mime_type: 'image/png',
      },
    ]);

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(0);
  });

  test('filters out purely numeric titles', async () => {
    const conn = createMockConnection([
      {
        ID: 23,
        post_title: '12345',
        post_content: '',
        post_excerpt: '',
        post_date: '2024-01-15',
        post_author: '1',
        post_mime_type: 'image/jpeg',
      },
    ]);

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(0);
  });

  test('filters out images with no alt, caption, or description', async () => {
    const conn = createMockConnection([
      {
        ID: 24,
        post_title: 'Untitled Image',
        post_content: '',
        post_excerpt: '',
        post_date: '2024-01-15',
        post_author: '1',
        post_mime_type: 'image/jpeg',
      },
    ]);

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(0);
  });

  test('keeps images with alt text even if title seems generic', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 25,
          post_title: 'product-photo',
          post_content: '',
          post_excerpt: '',
          post_date: '2024-01-15',
          post_author: '1',
          post_mime_type: 'image/jpeg',
        },
      ],
      [
        { post_id: 25, meta_value: 'Red sweater on display' },
      ],
    );

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(1);
    expect(result[0].cleanedContent).toContain('Alt text: Red sweater on display');
  });

  test('handles empty database', async () => {
    const conn = {
      query: jest.fn().mockResolvedValueOnce([[]]),
    } as any;

    const result = await extractMedia(conn, 'wp_');
    expect(result).toEqual([]);
  });

  test('includes caption in cleaned content', async () => {
    const conn = createMockConnection(
      [
        {
          ID: 30,
          post_title: 'Team Photo',
          post_content: '',
          post_excerpt: '<em>Our amazing team at the retreat</em>',
          post_date: '2024-06-01',
          post_author: '1',
          post_mime_type: 'image/jpeg',
        },
      ],
      [],
    );

    const result = await extractMedia(conn, 'wp_');
    expect(result).toHaveLength(1);
    // Caption HTML should be cleaned
    expect(result[0].cleanedContent).toContain('Caption: Our amazing team at the retreat');
  });
});
