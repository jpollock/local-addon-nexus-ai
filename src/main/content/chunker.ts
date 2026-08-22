/**
 * Post → chunk → document, for every indexing path.
 *
 * LIFTED VERBATIM from `ContentPipeline`'s private `chunkPosts` /
 * `makeDocShell` / `splitSentences` (WP-62). It is shared rather than copied
 * deliberately: the remote path had no chunking at all
 * (`// Simple approach: one document per post (no chunking for now)`), so
 * every remote post longer than the embedding model's context window was cut
 * off at the tokenizer — partially present, which is worse than absent
 * because it still returns results. Copying the local chunker into the two
 * remote services would have been the one-fact-two-sources defect committed
 * on purpose, and the two copies would diverge on the first tuning change.
 *
 * The parity tests in `tests/unit/content/chunker-parity.test.ts` are what
 * make the lift safe: they drive the same posts through this module and
 * assert the local and remote callers produce the same document set.
 */

import { VectorDocument, ExtractedPost } from '../../common/types';
import { CHUNK_MAX_WORDS } from '../../common/constants';

export interface PostChunk {
  doc: Omit<VectorDocument, 'vector'>;
  textForEmbedding: string;
}

/**
 * Build the searchable text for a post: cleaned content plus its public
 * custom fields, rendered as readable label/value lines.
 *
 * The field rendering is what makes ACF data findable — `trail_length: 4.2
 * miles` becomes `Trail length: 4.2 miles.` and embeds as prose. The remote
 * extractor collected no meta at all before WP-62, so this half of the text
 * was empty for every WP Engine and external post.
 */
export function buildSearchableText(post: ExtractedPost): string {
  let text = post.cleanedContent || post.title;

  if (post.customFields && Object.keys(post.customFields).length > 0) {
    const fieldLines: string[] = [];
    for (const [key, value] of Object.entries(post.customFields)) {
      if (value && typeof value === 'string' && value.trim()) {
        // Format field name for readability: "trail_length" → "Trail length"
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        fieldLines.push(`${label}: ${value}`);
      }
    }
    if (fieldLines.length > 0) {
      text += '\n\n' + fieldLines.join('. ') + '.';
    }
  }

  return text;
}

/** Split on sentence-ending punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.filter(Boolean);
}

export function makeDocShell(
  siteId: string,
  post: ExtractedPost,
  chunkIndex: number,
  content: string,
  extraMetadata?: Record<string, unknown>,
): Omit<VectorDocument, 'vector'> {
  // Chunk 0 keeps the unsuffixed id every previous indexing run wrote, so a
  // re-index overwrites rather than orphaning the old single-document row.
  const id = chunkIndex === 0
    ? `wp_${siteId}_${post.id}`
    : `wp_${siteId}_${post.id}_chunk_${chunkIndex}`;

  return {
    id,
    siteId,
    title: post.title,
    content,
    postType: post.postType,
    postId: post.id,
    chunkIndex,
    metadata: JSON.stringify({
      excerpt: post.excerpt,
      author: post.author,
      date: post.date,
      categories: post.categories,
      tags: post.tags,
      customFields: post.customFields ?? {},
      ...(extraMetadata ?? {}),
    }),
    indexedAt: Date.now(),
    post_date_gmt: '',
    post_modified_gmt: '',
    doc_url: '',
  };
}

/**
 * Split posts into chunks suitable for embedding.
 * Short posts become a single chunk; long posts are split at sentence
 * boundaries around CHUNK_MAX_WORDS words.
 *
 * `extraMetadata` is merged into each document's metadata JSON. The remote
 * callers use it to carry `source: 'wpe' | 'external'`, which must never be
 * dropped or crossed — `ExternalContentIndexService`'s own suite pins it.
 */
export function chunkPosts(
  siteId: string,
  posts: ExtractedPost[],
  extraMetadata?: Record<string, unknown>,
): PostChunk[] {
  const chunks: PostChunk[] = [];

  for (const post of posts) {
    const text = buildSearchableText(post);
    const words = text.split(/\s+/).filter(Boolean);

    if (words.length <= CHUNK_MAX_WORDS) {
      chunks.push({
        doc: makeDocShell(siteId, post, 0, text, extraMetadata),
        textForEmbedding: `${post.title}. ${text}`,
      });
      continue;
    }

    const sentences = splitSentences(text);
    let currentChunk: string[] = [];
    let currentWordCount = 0;
    let chunkIndex = 0;

    for (const sentence of sentences) {
      const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;

      if (currentWordCount + sentenceWords > CHUNK_MAX_WORDS && currentChunk.length > 0) {
        const chunkText = currentChunk.join(' ');
        chunks.push({
          doc: makeDocShell(siteId, post, chunkIndex, chunkText, extraMetadata),
          textForEmbedding: `${post.title}. ${chunkText}`,
        });
        chunkIndex++;
        currentChunk = [];
        currentWordCount = 0;
      }

      currentChunk.push(sentence);
      currentWordCount += sentenceWords;
    }

    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join(' ');
      chunks.push({
        doc: makeDocShell(siteId, post, chunkIndex, chunkText, extraMetadata),
        textForEmbedding: `${post.title}. ${chunkText}`,
      });
    }
  }

  return chunks;
}
