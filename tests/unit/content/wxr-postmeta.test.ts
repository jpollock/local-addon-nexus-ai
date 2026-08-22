import { parseWxrPostMeta, buildWxrExportArgs } from '../../../src/main/content/wxr-postmeta';

/**
 * Shaped like the real thing. Captured from a live `wp export --stdout` run
 * against cedarvalehealt (2026-08-22): `meta_key` is escaped plain text,
 * `meta_value` is CDATA, and post content is CDATA inside
 * `<content:encoded>`.
 */
function wxr(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
${items}
</channel>
</rss>`;
}

/**
 * WordPress's own `wxr_cdata`: an internal `]]>` is escaped by closing and
 * reopening the section. A fixture that does NOT do this is a document
 * WordPress could never emit, and testing the parser against one measures
 * the fixture rather than the hazard.
 */
function cdata(text: string): string {
  return `<![CDATA[${text.split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

function item(id: number, opts: { content?: string; meta?: Array<[string, string]> } = {}): string {
  const meta = (opts.meta ?? []).map(([k, v]) =>
    `    <wp:postmeta>
      <wp:meta_key>${k}</wp:meta_key>
      <wp:meta_value>${cdata(v)}</wp:meta_value>
    </wp:postmeta>`).join('\n');
  return `  <item>
    <title>Post ${id}</title>
    <content:encoded>${cdata(opts.content ?? `Body of ${id}`)}</content:encoded>
    <wp:post_id>${id}</wp:post_id>
${meta}
  </item>`;
}

describe('parseWxrPostMeta', () => {
  it('maps post id to its public meta', () => {
    const { meta } = parseWxrPostMeta(wxr(
      item(806, { meta: [['tier', 'composite'], ['condition_focus', 'impetigo']] })
      + '\n' + item(807, { meta: [['reading_level', 'standard']] })
    ));
    expect(meta.get(806)).toEqual({ tier: 'composite', condition_focus: 'impetigo' });
    expect(meta.get(807)).toEqual({ reading_level: 'standard' });
  });

  it('drops underscore-prefixed keys, mirroring the local path\'s NOT LIKE \'\\_%\'', () => {
    // Real ACF writes both: `tier` and its `_tier` field-key sibling. The
    // local extractor filters the second in SQL; parity means filtering it
    // here rather than indexing `field_cedar_post_tier` as content.
    const { meta } = parseWxrPostMeta(wxr(
      item(806, { meta: [['tier', 'composite'], ['_tier', 'field_cedar_post_tier']] })
    ));
    expect(meta.get(806)).toEqual({ tier: 'composite' });
  });

  it('is not fooled by post CONTENT that contains the markup it parses', () => {
    // The attribution hazard this parser's CDATA tokenizer exists to prevent:
    // a post ABOUT WordPress exports legitimately contains `<item>` and
    // `<wp:postmeta>` in its body. A naive tag scan would split mid-post and
    // attribute the following meta to a post that does not exist.
    const hostile = 'Here is how a WXR item looks: <item><wp:post_id>999</wp:post_id>'
      + '<wp:postmeta><wp:meta_key>injected</wp:meta_key>'
      + '<wp:meta_value><![CDATA[gotcha]]></wp:meta_value></wp:postmeta></item>';
    expect(hostile).toContain('<item>');           // the case is built
    expect(hostile).toContain('<wp:postmeta>');    // the case is built

    const { meta, itemsSeen } = parseWxrPostMeta(wxr(
      item(806, { content: hostile, meta: [['tier', 'composite']] })
    ));

    expect(itemsSeen).toBe(1);
    expect(meta.get(999)).toBeUndefined();
    expect(meta.get(806)).toEqual({ tier: 'composite' });
    expect(JSON.stringify([...meta])).not.toContain('gotcha');
  });

  it('handles a meta value containing the CDATA terminator, the way WordPress writes it', () => {
    // WordPress escapes an internal `]]>` by closing and reopening the
    // section; the two adjacent sections must re-concatenate.
    const raw = `<?xml version="1.0"?><rss><channel>
  <item>
    <wp:post_id>1</wp:post_id>
    <wp:postmeta>
      <wp:meta_key>snippet</wp:meta_key>
      <wp:meta_value><![CDATA[before]]]]><![CDATA[>after]]></wp:meta_value>
    </wp:postmeta>
  </item>
</channel></rss>`;
    expect(parseWxrPostMeta(raw).meta.get(1)).toEqual({ snippet: 'before]]>after' });
  });

  it('decodes entities in escaped text but leaves CDATA payloads literal', () => {
    const raw = `<?xml version="1.0"?><rss><channel>
  <item>
    <wp:post_id>1</wp:post_id>
    <wp:postmeta>
      <wp:meta_key>a&amp;b</wp:meta_key>
      <wp:meta_value><![CDATA[keep &amp; literal]]></wp:meta_value>
    </wp:postmeta>
  </item>
</channel></rss>`;
    expect(parseWxrPostMeta(raw).meta.get(1)).toEqual({ 'a&b': 'keep &amp; literal' });
  });

  it('returns nothing, and does not throw, for output that is not WXR', () => {
    for (const input of ['', 'Success: All done.', '[]', '{"error":"nope"}']) {
      const r = parseWxrPostMeta(input);
      expect(r.meta.size).toBe(0);
      expect(r.itemsSeen).toBe(0);
    }
  });

  it('counts items it could not attribute rather than dropping them silently', () => {
    const raw = wxr('  <item><title>No id here</title></item>');
    const r = parseWxrPostMeta(raw);
    expect(r.itemsSeen).toBe(1);
    expect(r.itemsWithoutId).toBe(1);
    expect(r.meta.size).toBe(0);
  });

  it('reads a page of ids larger than one post, in one export call', () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    expect(ids.length).toBeGreaterThan(1); // the case is built
    const args = buildWxrExportArgs(ids);
    expect(args[0]).toBe('export');
    expect(args).toContain('--stdout');
    expect(args[2]).toBe(`--post__in=${ids.join(',')}`);
  });
});
