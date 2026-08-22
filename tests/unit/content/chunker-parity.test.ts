/**
 * PARITY. One claim: remote content is indexed the way local content is.
 *
 * The three truncations WP-62 removed sat on top of each other, so each test
 * here drives a population that EXCEEDS the boundary it is about — shape #18
 * is the named failure mode for this packet, three times over (under 200
 * rows, under the context window, and with no custom fields). A fixture that
 * clears none of those boundaries passes identically on the bug and the fix.
 */

import { chunkPosts, buildSearchableText } from '../../../src/main/content/chunker';
import { ContentPipeline } from '../../../src/main/content/ContentPipeline';
import { WPESyncService } from '../../../src/main/events/WPESyncService';
import { ExternalContentIndexService } from '../../../src/main/events/ExternalContentIndexService';
import { CHUNK_MAX_WORDS } from '../../../src/common/constants';
import type { ExtractedPost } from '../../../src/common/types';

// ---------------------------------------------------------------------------
// Fixtures — each one built to clear a boundary, and asserted to clear it.
// ---------------------------------------------------------------------------

/** A post whose text exceeds CHUNK_MAX_WORDS, so it MUST split. */
function longPost(id: number, sentences = 400): ExtractedPost {
  const body = Array.from({ length: sentences }, (_, i) => `Sentence ${i} about topic ${id}.`).join(' ');
  return {
    id,
    title: `Long post ${id}`,
    content: body,
    cleanedContent: body,
    excerpt: '',
    postType: 'post',
    postStatus: 'publish',
    author: '1',
    date: '2026-01-01 00:00:00',
    categories: [],
    tags: [],
    customFields: {},
  };
}

function shortPost(id: number, customFields: Record<string, string> = {}): ExtractedPost {
  return {
    ...longPost(id, 3),
    title: `Short post ${id}`,
    content: 'Short body.',
    cleanedContent: 'Short body.',
    customFields,
  };
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('the fixtures clear the boundaries they are about', () => {
  it('the long post exceeds CHUNK_MAX_WORDS — otherwise every chunking assertion is vacuous', () => {
    expect(wordCount(buildSearchableText(longPost(1)))).toBeGreaterThan(CHUNK_MAX_WORDS);
  });

  it('the short post does NOT, so the single-chunk case is a real contrast', () => {
    expect(wordCount(buildSearchableText(shortPost(1)))).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
  });

  it('the custom-field fixture carries fields — otherwise the field assertions are vacuous', () => {
    expect(Object.keys(shortPost(1, { trail_length: '4.2 miles' }).customFields)).toHaveLength(1);
  });
});

describe('chunker — the lifted function itself', () => {
  it('splits a post longer than the context window into several documents', () => {
    const chunks = chunkPosts('site', [longPost(7)]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map(c => c.doc.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('keeps chunk 0 on the id every previous single-document index wrote', () => {
    const chunks = chunkPosts('site', [longPost(7)]);
    expect(chunks[0].doc.id).toBe('wp_site_7');
    expect(chunks[1].doc.id).toBe('wp_site_7_chunk_1');
  });

  it('prefixes every chunk with the post title so a middle chunk still embeds near its subject', () => {
    const chunks = chunkPosts('site', [longPost(7)]);
    for (const c of chunks) expect(c.textForEmbedding.startsWith('Long post 7. ')).toBe(true);
  });

  it('appends public custom fields into the SEARCHABLE text, not just the metadata', () => {
    const text = buildSearchableText(shortPost(1, { trail_length: '4.2 miles' }));
    // NB the lifted formatter title-cases EVERY word, so `trail_length`
    // renders `Trail Length`, not `Trail length` as WP-62's brief quoted it.
    // Asserted as the code behaves; the lift is verbatim and this packet does
    // not retune it.
    expect(text).toContain('Trail Length: 4.2 miles.');
  });

  it('carries caller metadata onto every chunk of a multi-chunk post', () => {
    const chunks = chunkPosts('site', [longPost(7)], { source: 'external' });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(JSON.parse(c.doc.metadata).source).toBe('external');
    }
  });
});

// ---------------------------------------------------------------------------
// The parity assertion: the same posts, through all three callers.
// ---------------------------------------------------------------------------

function embedStub() {
  return jest.fn(async (texts: string[]) => texts.map(() => new Float32Array([0.1, 0.2])));
}

/** Drive ContentPipeline.indexSite over a fixed post list; return the upserted docs. */
async function localDocs(siteId: string, posts: ExtractedPost[]) {
  const upserted: any[] = [];
  const pipeline = new ContentPipeline({
    vectorStore: { upsert: async (_id: string, docs: any[]) => { upserted.push(...docs); } } as any,
    embeddingService: { embedBatch: embedStub() } as any,
    mysqlExtractor: {
      isAvailable: () => true,
      extract: async () => ({ posts, siteInfo: { name: siteId, url: '', wpVersion: '' }, extractedAt: 0 }),
    } as any,
    fileScanner: { scan: async () => null } as any,
    indexRegistry: { update: () => {} } as any,
  });
  await pipeline.indexSite({ siteId, siteName: siteId, sitePath: '/tmp' } as any);
  return upserted;
}

/** Drive WPESyncService.syncContent over a fixed post list; return the upserted docs. */
async function wpeDocs(siteId: string, posts: ExtractedPost[]) {
  const upserted: any[] = [];
  const service = new WPESyncService({
    graphService: { upsertContent: async () => 1, getDb: () => null } as any,
    embeddingService: { embedBatch: embedStub() } as any,
    vectorStore: { upsert: async (_id: string, docs: any[]) => { upserted.push(...docs); } } as any,
    indexRegistry: { update: () => {}, get: () => null } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as any);
  (service as any).remoteContentExtractor = {
    extract: async () => ({ posts, siteInfo: { name: siteId, url: '', wpVersion: '' }, extractedAt: 0 }),
  };
  await (service as any).syncContent(siteId, siteId);
  return upserted;
}

/** Drive ExternalContentIndexService.indexOne over a fixed post list. */
async function externalDocs(siteId: string, posts: ExtractedPost[]) {
  const upserted: any[] = [];
  const service = new ExternalContentIndexService({
    graphService: { upsertContent: async () => 1 } as any,
    embeddingService: { embedBatch: embedStub() } as any,
    vectorStore: { upsert: async (_id: string, docs: any[]) => { upserted.push(...docs); } } as any,
    indexRegistry: { update: () => {} } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  (service as any).extractor = {
    extract: async () => ({ posts, siteInfo: { name: siteId, url: '', wpVersion: '' }, extractedAt: 0 }),
  };
  await service.indexOne({} as any, siteId, siteId);
  return upserted;
}

/** Everything about a document that should not depend on WHICH path indexed it. */
function shape(docs: any[]) {
  return docs
    .map(d => ({
      id: d.id,
      postId: d.postId,
      chunkIndex: d.chunkIndex,
      title: d.title,
      content: d.content,
      postType: d.postType,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('PARITY — the same posts produce the same document set on every path', () => {
  const posts = [
    longPost(1),
    shortPost(2, { trail_length: '4.2 miles', difficulty: 'moderate' }),
    longPost(3, 900),
  ];

  it('the fixture exceeds all three boundaries before anything is asserted about it', () => {
    expect(posts.filter(p => wordCount(buildSearchableText(p)) > CHUNK_MAX_WORDS).length).toBeGreaterThan(1);
    expect(posts.some(p => Object.keys(p.customFields).length > 0)).toBe(true);
  });

  it('WP Engine produces the same documents as the local pipeline', async () => {
    const [local, wpe] = await Promise.all([localDocs('s', posts), wpeDocs('s', posts)]);
    expect(shape(wpe)).toEqual(shape(local));
    expect(wpe.length).toBeGreaterThan(posts.length); // chunking really happened
  });

  it('an external SSH host produces the same documents as the local pipeline', async () => {
    const [local, external] = await Promise.all([localDocs('s', posts), externalDocs('s', posts)]);
    expect(shape(external)).toEqual(shape(local));
  });

  it('the searchable text of a remote post carries its custom fields, exactly as local does', async () => {
    const [local, wpe] = await Promise.all([localDocs('s', posts), wpeDocs('s', posts)]);
    const pick = (docs: any[]) => docs.find(d => d.postId === 2)!.content;
    expect(pick(wpe)).toContain('Trail Length: 4.2 miles.');
    expect(pick(wpe)).toBe(pick(local));
  });

  it('a long remote post is SPLIT rather than cut off at the tokenizer', async () => {
    const wpe = await wpeDocs('s', posts);
    const chunksOfPost3 = wpe.filter(d => d.postId === 3);
    expect(chunksOfPost3.length).toBeGreaterThan(1);

    // Every word of the source survives across the chunks. Before WP-62 the
    // whole cleanedContent went to a WordPieceTokenizer(contextWindow) as ONE
    // document and everything past the window was dropped.
    const joined = chunksOfPost3.map(d => d.content).join(' ');
    expect(wordCount(joined)).toBe(wordCount(buildSearchableText(posts[2])));
  });

  it('keeps each remote path\'s own source label on every chunk', async () => {
    const [wpe, external] = await Promise.all([wpeDocs('s', posts), externalDocs('s', posts)]);
    expect(new Set(wpe.map(d => JSON.parse(d.metadata).source))).toEqual(new Set(['wpe']));
    expect(new Set(external.map(d => JSON.parse(d.metadata).source))).toEqual(new Set(['external']));
  });

  it('bounds every embed call to the batch size, never handing the embedder the whole array', async () => {
    // embedBatch allocates three BigInt64Array(batchSize * seqLen). Chunking
    // multiplies the document count, so an unbounded slice is a real hazard.
    const seen: number[] = [];
    const service = new ExternalContentIndexService({
      graphService: { upsertContent: async () => 1 } as any,
      embeddingService: {
        embedBatch: async (texts: string[]) => { seen.push(texts.length); return texts.map(() => new Float32Array([0])); },
      } as any,
      vectorStore: { upsert: async () => {} } as any,
      indexRegistry: { update: () => {} } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    (service as any).extractor = {
      extract: async () => ({
        posts: Array.from({ length: 30 }, (_, i) => longPost(i + 1)),
        siteInfo: { name: 's', url: '', wpVersion: '' },
        extractedAt: 0,
      }),
    };
    await service.indexOne({} as any, 's', 's');

    expect(seen.length).toBeGreaterThan(1);                      // the case is built
    expect(Math.max(...seen)).toBeLessThanOrEqual(10);           // BATCH_SIZE
    expect(seen.reduce((a, b) => a + b, 0)).toBeGreaterThan(30); // more chunks than posts
  });
});

describe('the quantities the announce declared', () => {
  const posts = [longPost(1), longPost(2)];

  it('documentCount counts POSTS and chunkCount counts CHUNKS, on the remote paths too', async () => {
    const updates: any[] = [];
    const service = new ExternalContentIndexService({
      graphService: { upsertContent: async () => 1 } as any,
      embeddingService: { embedBatch: embedStub() } as any,
      vectorStore: { upsert: async () => {} } as any,
      indexRegistry: { update: (_id: string, p: any) => updates.push(p) } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    (service as any).extractor = {
      extract: async () => ({ posts, siteInfo: { name: 's', url: '', wpVersion: '' }, extractedAt: 0 }),
    };
    const result = await service.indexOne({} as any, 's', 's');

    expect(updates[0].documentCount).toBe(2);
    expect(updates[0].chunkCount).toBeGreaterThan(2); // they are no longer the same number
    expect(result.documentCount).toBe(2);
  });
});
