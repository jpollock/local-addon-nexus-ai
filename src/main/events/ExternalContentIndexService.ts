import type { GraphService } from './GraphService';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { IVectorStore } from '../vector-store/IVectorStore';
import type { IndexRegistry } from '../content/IndexRegistry';
import type { SiteTransport } from '../transport/types';
import { VectorDocument } from '../../common/types';
import { RemoteContentExtractor } from '../content/RemoteContentExtractor';
import { chunkPosts } from '../content/chunker';
import { vectorSiteId } from '../vector-store/vectorSiteId';

export interface ExternalContentIndexServiceOptions {
  graphService: GraphService;
  embeddingService: EmbeddingService;
  vectorStore: IVectorStore;
  indexRegistry: IndexRegistry;
  logger?: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

const BATCH_SIZE = 10; // matches WPESyncService.syncContent's existing batch size

/**
 * Extraction -> embedding -> vector storage for one external SSH host, plus the
 * fleet-wide indexAllExternalContent(). Parallel to WPESyncService.syncContent,
 * not derived from it — WPESyncService is not modified by this class.
 *
 * Deliberately does NOT piggyback a metadata refresh onto this SSH session the
 * way WP Engine's syncContent does: that trick relies on WpeRefreshScheduler's
 * ControlMaster keeping the connection warm, and external SSH deliberately has
 * no ControlMaster (see the design's Spec 4a §6). Metadata refresh for external
 * hosts is ExternalRefreshScheduler's job, on its own independent schedule.
 */
export class ExternalContentIndexService {
  private graphService: GraphService;
  private embeddingService: EmbeddingService;
  private vectorStore: IVectorStore;
  private indexRegistry: IndexRegistry;
  private logger: NonNullable<ExternalContentIndexServiceOptions['logger']>;
  private extractor: RemoteContentExtractor;

  constructor(options: ExternalContentIndexServiceOptions) {
    this.graphService = options.graphService;
    this.embeddingService = options.embeddingService;
    this.vectorStore = options.vectorStore;
    this.indexRegistry = options.indexRegistry;
    this.logger = options.logger ?? console;
    this.extractor = new RemoteContentExtractor({ logger: this.logger });
  }

  /**
   * Index one external host. Never throws — a failure marks the registry
   * state='error' and returns { documentCount: 0 }, matching this codebase's
   * convention that content indexing is optional and must not look like a crash.
   */
  async indexOne(transport: SiteTransport, siteId: string, alias: string): Promise<{ documentCount: number }> {
    const startTime = Date.now();
    try {
      const extracted = await this.extractor.extract(transport, alias);

      if (!extracted.posts || extracted.posts.length === 0) {
        this.indexRegistry.update(siteId, {
          siteId, siteName: alias, state: 'indexed',
          lastIndexed: Date.now(), documentCount: 0, chunkCount: 0,
          durationMs: Date.now() - startTime,
        });
        return { documentCount: 0 };
      }

      for (const post of extracted.posts) {
        await this.graphService.upsertContent({
          site_id: siteId,
          post_id: post.id,
          post_type: post.postType,
          title: post.title,
          status: post.postStatus,
          author_id: parseInt(post.author, 10) || null,
          created_at: new Date(post.date).getTime(),
          updated_at: Date.now(),
        });
      }

      // One chunker, shared with the local path and with WP Engine (WP-62).
      // `source: 'external'` is NEVER 'wpe' here — this is the honesty-rule
      // regression this class exists to prevent, and it now rides through
      // chunkPosts' extraMetadata onto every chunk of every post.
      const chunks = chunkPosts(siteId, extracted.posts, { source: 'external' });

      const embeddedDocs: VectorDocument[] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const vectors = await this.embeddingService.embedBatch(batch.map(c => c.textForEmbedding));
        for (let j = 0; j < batch.length; j++) {
          embeddedDocs.push({ ...batch[j].doc, vector: vectors[j] });
        }
      }

      await this.vectorStore.upsert(vectorSiteId(siteId), embeddedDocs);

      // documentCount = distinct posts, chunkCount = embedded chunks — the
      // same split the local path has always had. They were both
      // `embeddedDocs.length` while one post meant one document.
      const uniquePostIds = new Set(embeddedDocs.map(d => d.postId));
      this.indexRegistry.update(siteId, {
        siteId, siteName: alias, state: 'indexed',
        lastIndexed: Date.now(), documentCount: uniquePostIds.size, chunkCount: embeddedDocs.length,
        durationMs: Date.now() - startTime,
        coverage: extracted.coverage,
      });

      this.logger.info(
        `[ExternalContentIndexService] ${alias}: indexed ${uniquePostIds.size} documents `
        + `/ ${embeddedDocs.length} chunks`
        + (extracted.coverage && !extracted.coverage.complete
          ? ` — INCOMPLETE (${extracted.coverage.truncatedDetail ?? extracted.coverage.truncatedReason}); this is a floor, not a total`
          : '')
      );
      return { documentCount: uniquePostIds.size };
    } catch (error: any) {
      this.logger.warn(`[ExternalContentIndexService] ${alias} failed: ${error?.message ?? error}`);
      this.indexRegistry.update(siteId, { state: 'error', lastIndexed: Date.now() } as any);
      return { documentCount: 0 };
    }
  }

  /**
   * Index every active registered external host. Selection is source='external'
   * only — never merged with WPE, never touching WPESyncService's fleet method.
   */
  async indexAllExternalContent(): Promise<{ indexed: number; errors: number }> {
    const db = this.graphService.getDb?.();
    if (!db) return { indexed: 0, errors: 0 };

    const hosts = db.prepare(
      "SELECT id, name, account_id, environment FROM sites WHERE source = 'external' AND is_active = 1"
    ).all() as Array<{ id: string; name: string; account_id: string; environment: string | null }>;

    let indexed = 0;
    let errors = 0;

    for (const host of hosts) {
      try {
        const { resolveTransport } = await import('../transport');
        const target = `ssh:${host.account_id}/${host.name}@${host.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, {} as any, 'wpcli_read');
        if (transport && typeof transport === 'object' && 'content' in transport) {
          continue; // refused/unresolvable — skip, not an error
        }
        await this.indexOne(transport as SiteTransport, host.id, host.name);
        indexed++;
      } catch {
        errors++;
      }
    }

    return { indexed, errors };
  }
}
