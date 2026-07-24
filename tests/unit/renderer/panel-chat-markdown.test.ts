import { renderMarkdown } from '../../../src/renderer/components/DockedPanel/PanelChat';

describe('renderMarkdown', () => {
  it('converts bold to <strong>', () => {
    const html = renderMarkdown('**hello**');
    expect(html).toContain('<strong>hello</strong>');
  });

  it('converts backtick code to <code>', () => {
    const html = renderMarkdown('`npm install`');
    expect(html).toContain('<code>npm install</code>');
  });

  it('converts fenced code block to <pre><code>', () => {
    const html = renderMarkdown('```\nconsole.log("hi")\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code>');
  });

  it('strips <script> tags', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips <iframe> tags', () => {
    const html = renderMarkdown('<iframe src="evil.com"></iframe>');
    expect(html).not.toContain('<iframe>');
  });

  it('converts bullet list to <ul><li>', () => {
    const html = renderMarkdown('- foo\n- bar');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>foo</li>');
    expect(html).toContain('<li>bar</li>');
  });
});
