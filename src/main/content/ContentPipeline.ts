import { VectorStore } from '../vector-store/VectorStore';
import { EmbeddingService } from '../embeddings/EmbeddingService';
import { MySQLExtractor, SiteConnectionInfo } from './MySQLExtractor';
import { FileScanner } from './FileScanner';
import { IndexRegistry } from './IndexRegistry';
import { VectorDocument, IndexResult, ExtractedPost } from '../../common/types';
import { CHUNK_MAX_WORDS } from '../../common/constants';
import { discoverRestApi } from './extractors/RestApiScanner';

export type IndexStatus =
  | { state: 'idle' }
  | { state: 'indexing'; progress: number; message: string }
  | { state: 'indexed'; lastIndexed: number; documentCount: number }
  | { state: 'error'; error: string; lastAttempt: number };

export interface ContentPipelineDeps {
  vectorStore: VectorStore;
  embeddingService: EmbeddingService;
  mysqlExtractor: MySQLExtractor;
  fileScanner: FileScanner;
  indexRegistry: IndexRegistry;
  /** Optional callback to broadcast status to renderer */
  onStatusChange?: (siteId: string, status: IndexStatus) => void;
}

/**
 * Orchestrates the full content pipeline:
 *   extract → chunk → embed → index
 */
export class ContentPipeline {
  private deps: ContentPipelineDeps;
  private statusMap = new Map<string, IndexStatus>();

  constructor(deps: ContentPipelineDeps) {
    this.deps = deps;
  }

  /** Set or replace the status change callback after construction. */
  setStatusCallback(cb: (siteId: string, status: IndexStatus) => void): void {
    this.deps = { ...this.deps, onStatusChange: cb };
  }

  getStatus(siteId: string): IndexStatus {
    return this.statusMap.get(siteId) ?? { state: 'idle' };
  }

  async indexSite(info: SiteConnectionInfo): Promise<IndexResult> {
    const { vectorStore, embeddingService, mysqlExtractor, fileScanner, indexRegistry } = this.deps;
    const startTime = Date.now();
    const errors: string[] = [];

    this.setStatus(info.siteId, { state: 'indexing', progress: 0, message: 'Scanning site structure...' });

    // 1. File scan (always works — filesystem only)
    let structure = null;
    try {
      structure = await fileScanner.scan(info.sitePath);
    } catch (err) {
      errors.push(`FileScanner: ${(err as Error).message}`);
    }

    // 2. MySQL extraction (requires running site)
    let posts: ExtractedPost[] = [];
    if (mysqlExtractor.isAvailable(info)) {
      this.setStatus(info.siteId, { state: 'indexing', progress: 10, message: 'Extracting content from database...' });
      try {
        const extracted = await mysqlExtractor.extract(info, structure);
        posts = extracted.posts;

        // Merge custom tables into structure
        if (extracted.customTables && structure) {
          structure.customTables = extracted.customTables;
        }

        // Merge DB-backed active detection into structure
        if (structure && extracted.activeThemeSlug) {
          for (const theme of structure.themes) {
            theme.isActive = theme.slug === extracted.activeThemeSlug;
          }
        }
        if (structure && extracted.activePluginSlugs) {
          const activeSlugs = new Set(extracted.activePluginSlugs);
          for (const plugin of structure.plugins) {
            plugin.isActive = activeSlugs.has(plugin.slug);
          }
        }

        // Merge new structure fields
        if (structure) {
          if (extracted.users) structure.users = extracted.users;
          if (extracted.permalinks) structure.permalinks = extracted.permalinks;
          if (extracted.health) structure.health = extracted.health;
        }

        // Collect sub-extractor warnings
        if (extracted.warnings) {
          errors.push(...extracted.warnings);
        }
      } catch (err) {
        errors.push(`MySQLExtractor: ${(err as Error).message}`);
      }
    } else {
      errors.push('MySQL not available — site may not be running');
    }

    // REST API discovery (requires running site with domain)
    if (structure && info.domain) {
      try {
        const restApi = await discoverRestApi(info.domain);
        if (restApi) structure.restApi = restApi;
      } catch (err) {
        errors.push(`RestApiScanner: ${(err as Error).message}`);
      }
    }

    if (posts.length === 0) {
      const result: IndexResult = {
        siteId: info.siteId,
        documentsIndexed: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - startTime,
        errors,
      };

      indexRegistry.update(info.siteId, {
        siteName: info.siteName,
        lastIndexed: Date.now(),
        documentCount: 0,
        chunkCount: 0,
        durationMs: result.durationMs,
        structure,
        state: errors.length > 0 ? 'error' : 'indexed',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      });

      this.setStatus(info.siteId, errors.length > 0
        ? { state: 'error', error: errors.join('; '), lastAttempt: Date.now() }
        : { state: 'indexed', lastIndexed: Date.now(), documentCount: 0 });

      return result;
    }

    // 3. Chunk
    this.setStatus(info.siteId, { state: 'indexing', progress: 30, message: `Chunking ${posts.length} posts...` });
    const chunks = this.chunkPosts(info.siteId, posts);

    // 4. Embed in batches
    this.setStatus(info.siteId, { state: 'indexing', progress: 40, message: `Generating embeddings for ${chunks.length} chunks...` });
    const EMBED_BATCH_SIZE = 16;
    const embeddedDocs: VectorDocument[] = [];

    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map((c) => c.textForEmbedding);

      try {
        const vectors = await embeddingService.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          embeddedDocs.push({
            ...batch[j].doc,
            vector: vectors[j],
          });
        }
      } catch (err) {
        errors.push(`Embedding batch ${i}: ${(err as Error).message}`);
      }

      const progress = 40 + Math.round((i / chunks.length) * 50);
      this.setStatus(info.siteId, {
        state: 'indexing',
        progress,
        message: `Embedding... ${Math.min(i + EMBED_BATCH_SIZE, chunks.length)}/${chunks.length}`,
      });
    }

    // 5. Upsert into VectorStore
    this.setStatus(info.siteId, { state: 'indexing', progress: 90, message: 'Saving to vector database...' });
    try {
      await vectorStore.upsert(info.siteId, embeddedDocs);
    } catch (err) {
      errors.push(`VectorStore upsert: ${(err as Error).message}`);
    }

    // 6. Update registry
    const durationMs = Date.now() - startTime;
    const uniquePostIds = new Set(embeddedDocs.map((d) => d.postId));

    indexRegistry.update(info.siteId, {
      siteName: info.siteName,
      lastIndexed: Date.now(),
      documentCount: uniquePostIds.size,
      chunkCount: embeddedDocs.length,
      durationMs,
      structure,
      state: errors.length > 0 ? 'error' : 'indexed',
      error: errors.length > 0 ? errors.join('; ') : undefined,
    });

    const finalStatus: IndexStatus = errors.length > 0
      ? { state: 'error', error: errors.join('; '), lastAttempt: Date.now() }
      : { state: 'indexed', lastIndexed: Date.now(), documentCount: uniquePostIds.size };

    this.setStatus(info.siteId, finalStatus);

    return {
      siteId: info.siteId,
      documentsIndexed: uniquePostIds.size,
      chunksIndexed: embeddedDocs.length,
      durationMs,
      errors,
    };
  }

  async reindexSite(info: SiteConnectionInfo): Promise<IndexResult> {
    // Drop existing data, then re-index
    await this.deps.vectorStore.dropSite(info.siteId);
    return this.indexSite(info);
  }

  async removeSite(siteId: string): Promise<void> {
    await this.deps.vectorStore.dropSite(siteId);
    this.deps.indexRegistry.remove(siteId);
    this.statusMap.delete(siteId);
  }

  /**
   * Split posts into chunks suitable for embedding.
   * Short posts become a single chunk; long posts are split at sentence
   * boundaries around CHUNK_MAX_WORDS words.
   */
  private chunkPosts(
    siteId: string,
    posts: ExtractedPost[],
  ): Array<{ doc: Omit<VectorDocument, 'vector'>; textForEmbedding: string }> {
    const chunks: Array<{ doc: Omit<VectorDocument, 'vector'>; textForEmbedding: string }> = [];

    for (const post of posts) {
      const text = post.cleanedContent || post.title;
      const words = text.split(/\s+/).filter(Boolean);

      if (words.length <= CHUNK_MAX_WORDS) {
        // Single chunk
        chunks.push({
          doc: this.makeDocShell(siteId, post, 0, text),
          textForEmbedding: `${post.title}. ${text}`,
        });
      } else {
        // Split into chunks at sentence boundaries
        const sentences = this.splitSentences(text);
        let currentChunk: string[] = [];
        let currentWordCount = 0;
        let chunkIndex = 0;

        for (const sentence of sentences) {
          const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;

          if (currentWordCount + sentenceWords > CHUNK_MAX_WORDS && currentChunk.length > 0) {
            // Emit current chunk
            const chunkText = currentChunk.join(' ');
            chunks.push({
              doc: this.makeDocShell(siteId, post, chunkIndex, chunkText),
              textForEmbedding: `${post.title}. ${chunkText}`,
            });
            chunkIndex++;
            currentChunk = [];
            currentWordCount = 0;
          }

          currentChunk.push(sentence);
          currentWordCount += sentenceWords;
        }

        // Final chunk
        if (currentChunk.length > 0) {
          const chunkText = currentChunk.join(' ');
          chunks.push({
            doc: this.makeDocShell(siteId, post, chunkIndex, chunkText),
            textForEmbedding: `${post.title}. ${chunkText}`,
          });
        }
      }
    }

    return chunks;
  }

  private makeDocShell(
    siteId: string,
    post: ExtractedPost,
    chunkIndex: number,
    content: string,
  ): Omit<VectorDocument, 'vector'> {
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
      }),
      indexedAt: Date.now(),
      post_date_gmt: '',
      post_modified_gmt: '',
      doc_url: '',
    };
  }

  private splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace
    const raw = text.split(/(?<=[.!?])\s+/);
    return raw.filter(Boolean);
  }

  private setStatus(siteId: string, status: IndexStatus): void {
    this.statusMap.set(siteId, status);
    this.deps.onStatusChange?.(siteId, status);
  }
}
