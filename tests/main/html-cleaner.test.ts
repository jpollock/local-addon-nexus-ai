import { cleanWordPressContent } from '../../src/main/content/html-cleaner';

describe('cleanWordPressContent', () => {
  test('returns empty string for empty input', () => {
    expect(cleanWordPressContent('')).toBe('');
    expect(cleanWordPressContent(null as any)).toBe('');
    expect(cleanWordPressContent(undefined as any)).toBe('');
  });

  test('strips Gutenberg block comments', () => {
    const input = '<!-- wp:paragraph --><p>Hello world</p><!-- /wp:paragraph -->';
    expect(cleanWordPressContent(input)).toBe('Hello world');
  });

  test('strips nested Gutenberg blocks', () => {
    const input = `<!-- wp:group -->
<!-- wp:heading {"level":2} -->
<h2>Title</h2>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>Content here.</p>
<!-- /wp:paragraph -->
<!-- /wp:group -->`;
    const result = cleanWordPressContent(input);
    expect(result).toContain('Title');
    expect(result).toContain('Content here.');
    expect(result).not.toContain('wp:');
    expect(result).not.toContain('<!--');
  });

  test('strips HTML tags', () => {
    expect(cleanWordPressContent('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  test('decodes common HTML entities', () => {
    expect(cleanWordPressContent('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(cleanWordPressContent('&lt;script&gt;')).toBe('<script>');
    expect(cleanWordPressContent('&quot;quoted&quot;')).toBe('"quoted"');
    expect(cleanWordPressContent('it&rsquo;s fine')).toBe('it\u2019s fine');
  });

  test('decodes numeric HTML entities', () => {
    expect(cleanWordPressContent('&#169; 2024')).toBe('\u00A9 2024');
    expect(cleanWordPressContent('&#x2714; done')).toBe('\u2714 done');
  });

  test('collapses whitespace', () => {
    expect(cleanWordPressContent('hello    world\n\n\nfoo')).toBe('hello world foo');
  });

  test('handles realistic Gutenberg content', () => {
    const input = `<!-- wp:paragraph -->
<p>WordPress is a popular content management system. It powers over 40% of the web.</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul><!-- wp:list-item -->
<li>Easy to use</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Extensible with plugins</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Learn more at <a href="https://wordpress.org">wordpress.org</a>.</p>
<!-- /wp:paragraph -->`;

    const result = cleanWordPressContent(input);
    expect(result).toContain('WordPress is a popular content management system');
    expect(result).toContain('Easy to use');
    expect(result).toContain('Extensible with plugins');
    expect(result).toContain('Learn more at wordpress.org');
    expect(result).not.toContain('<');
    expect(result).not.toContain('<!--');
  });

  test('handles Gutenberg block with JSON attributes', () => {
    const input = '<!-- wp:image {"id":42,"sizeSlug":"large"} --><figure><img src="test.jpg"/></figure><!-- /wp:image -->';
    const result = cleanWordPressContent(input);
    expect(result).not.toContain('wp:image');
    expect(result).not.toContain('sizeSlug');
  });

  test('preserves plain text content', () => {
    expect(cleanWordPressContent('Just plain text')).toBe('Just plain text');
  });
});
