import type { IVectorStore } from '../vector-store/IVectorStore';
import { EmbeddingService } from '../embeddings/EmbeddingService';
import { MySQLExtractor, SiteConnectionInfo } from './MySQLExtractor';
import { FileScanner } from './FileScanner';
import { IndexRegistry } from './IndexRegistry';
import { VectorDocument, IndexResult, ExtractedPost, ExtractionCoverage } from '../../common/types';
import { chunkPosts } from './chunker';
import { discoverRestApi } from './extractors/RestApiScanner';
import { recordPipelineRun } from '../intelligence-host/pipelineRunProducer';
import type { PipelineTrigger } from '../../intelligence';

export type IndexStatus =
  | { state: 'idle' }
  | { state: 'indexing'; progress: number; message: string }
  | { state: 'indexed'; lastIndexed: number; documentCount: number }
  | { state: 'error'; error: string; lastAttempt: number };

export interface ContentPipelineDeps {
  vectorStore: IVectorStore;
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
/**
 * The local path reads the whole `wp_posts` population in one SQL statement
 * with no LIMIT and joins `wp_postmeta` for every public custom field, so its
 * coverage is complete by construction. Recording it explicitly is what lets
 * `get_index_status` distinguish "complete" from "not recorded" — an entry
 * with NO coverage predates the tracking, and its document count is a floor.
 */
const LOCAL_COVERAGE: ExtractionCoverage = {
  pageSize: 0,
  pagesFetched: 1,
  rowsReturned: -1,
  complete: true,
  customFields: 'collected',
};

export class ContentPipeline {
  private deps: ContentPipelineDeps;
  private statusMap = new Map<string, IndexStatus>();
  private activeSites = new Set<string>(); // Track sites being indexed

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

  /**
   * Cancel any in-progress indexing for a site.
   * Used by siteDeleted hook to prevent "Site not found" errors.
   */
  async cancelSite(siteId: string): Promise<void> {
    if (!this.activeSites.has(siteId)) {
      return; // Not currently indexing
    }

    this.activeSites.delete(siteId);
    console.info(`[ContentPipeline] Canceled indexing for site: ${siteId}`);
  }

  private buildCancelledResult(siteId: string, startTime: number): IndexResult {
    return {
      siteId,
      documentsIndexed: 0,
      chunksIndexed: 0,
      durationMs: Date.now() - startTime,
      errors: ['Indexing cancelled'],
    };
  }

  /**
   * Index one local site, recording the run in the intelligence ledger
   * (plan 2026-08-23). This wrapper is the local-L3 pipeline chokepoint: every
   * caller — the bulk manager, the lifecycle hook, the resolvers — lands here,
   * so one record covers them all. The record is derived from the REAL
   * IndexResult after the fact (WP-67's rule: the registry and the report must
   * never disagree about the same run), and recording never throws.
   */
  async indexSite(info: SiteConnectionInfo, trigger: PipelineTrigger = 'adhoc'): Promise<IndexResult> {
    const startedAt = Date.now();
    try {
      const result = await this.indexSiteInner(info);
      const cancelled = result.errors.length === 1 && result.errors[0] === 'Indexing cancelled';
      recordPipelineRun({
        layer: 'l3', trigger,
        outcome: cancelled ? 'skip' : result.errors.length > 0 ? 'fail' : 'ok',
        ...(cancelled
          ? { reason: 'cancelled' }
          : result.errors.length > 0
            ? { reason: result.errors.join('; ') }
            : {}),
        startedAt, finishedAt: Date.now(),
        site: { kind: 'local', localSiteId: info.siteId },
      });
      return result;
    } catch (err: any) {
      recordPipelineRun({
        layer: 'l3', trigger, outcome: 'fail',
        reason: err?.message ?? String(err),
        startedAt, finishedAt: Date.now(),
        site: { kind: 'local', localSiteId: info.siteId },
      });
      throw err;
    }
  }

  private async indexSiteInner(info: SiteConnectionInfo): Promise<IndexResult> {
    // Add to active set at start
    this.activeSites.add(info.siteId);

    const { vectorStore, embeddingService, mysqlExtractor, fileScanner, indexRegistry } = this.deps;
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // Check if cancelled before expensive operations
      if (!this.activeSites.has(info.siteId)) {
        return this.buildCancelledResult(info.siteId, startTime);
      }

      this.setStatus(info.siteId, { state: 'indexing', progress: 0, message: 'Scanning site structure...' });

      // 1. File scan (always works — filesystem only)
      let structure = null;
      try {
        structure = await fileScanner.scan(info.sitePath);
      } catch (err) {
        errors.push(`FileScanner: ${(err as Error).message}`);
      }

      // Check cancellation after file scan
      if (!this.activeSites.has(info.siteId)) {
        return this.buildCancelledResult(info.siteId, startTime);
      }

      // 2. MySQL extraction (requires running site)
      let posts: ExtractedPost[] = [];
      if (mysqlExtractor.isAvailable(info)) {
        this.setStatus(info.siteId, { state: 'indexing', progress: 10, message: 'Extracting content from database...' });

        // Check cancellation before expensive MySQL work
        if (!this.activeSites.has(info.siteId)) {
          return this.buildCancelledResult(info.siteId, startTime);
        }

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
          coverage: { ...LOCAL_COVERAGE, rowsReturned: 0 },
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
      const chunks = chunkPosts(info.siteId, posts);

      // 4. Embed in batches
      this.setStatus(info.siteId, { state: 'indexing', progress: 40, message: `Generating embeddings for ${chunks.length} chunks...` });
      const EMBED_BATCH_SIZE = 16;
      const embeddedDocs: VectorDocument[] = [];

      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        // Check cancellation during embedding loop
        if (!this.activeSites.has(info.siteId)) {
          return this.buildCancelledResult(info.siteId, startTime);
        }

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
        coverage: { ...LOCAL_COVERAGE, rowsReturned: posts.length },
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
    } finally {
      // Remove from active set at end
      this.activeSites.delete(info.siteId);
    }
  }

  async reindexSite(info: SiteConnectionInfo, trigger: PipelineTrigger = 'adhoc'): Promise<IndexResult> {
    // Drop existing data, then re-index. The drop is part of the run: a throw
    // here is a failed run and is recorded as one, not silently untracked.
    try {
      await this.deps.vectorStore.dropSite(info.siteId);
    } catch (err: any) {
      recordPipelineRun({
        layer: 'l3', trigger, outcome: 'fail',
        reason: `dropSite: ${err?.message ?? String(err)}`,
        startedAt: Date.now(), finishedAt: Date.now(),
        site: { kind: 'local', localSiteId: info.siteId },
      });
      throw err;
    }
    return this.indexSite(info, trigger);
  }

  /**
   * Index a settings document for the site so settings are searchable via vector/content search.
   * Uses postId=0 as a sentinel (real WordPress post IDs start at 1).
   * Safe to call after indexSite completes — upserts so it's idempotent.
   */
  async indexSettingsDocument(siteId: string, siteName: string, settings: Record<string, string | number | undefined | null>): Promise<void> {
    const { vectorStore, embeddingService } = this.deps;
    try {
      const label = (k: string, v: string | number | undefined | null): string => {
        if (v == null || v === '') return '';
        const labels: Record<string, string> = {
          blogname: `Site title: ${v}`,
          blogdescription: `Tagline: ${v}`,
          blogpublic: v === '1' ? 'Visible to search engines' : 'Hidden from search engines (discourage indexing)',
          show_on_front: v === 'page' ? 'Front page displays a static page' : 'Front page displays latest posts',
          posts_per_page: `Blog shows ${v} posts per page`,
          default_comment_status: `Comments ${v === 'open' ? 'enabled' : 'disabled'} by default`,
          permalink_structure: `Permalink structure: ${v}`,
          timezone_string: `Timezone: ${v}`,
          users_can_register: v === '1' ? 'Anyone can register as a user' : 'User registration disabled',
          default_role: `Default user role: ${v}`,
          WPLANG: `Site language: ${v}`,
        };
        return labels[k] ?? `${k}: ${v}`;
      };
      const lines = Object.entries(settings)
        .map(([k, v]) => label(k, v))
        .filter(Boolean);
      if (lines.length === 0) return;

      const content = `WordPress settings for ${siteName}.\n${lines.join('. ')}.`;
      const vector = await embeddingService.embed(content);
      await vectorStore.upsert(siteId, [{
        id: `${siteId}_settings`,
        siteId,
        title: `${siteName} — Site Settings`,
        content,
        postType: 'site-settings',
        postId: 0,
        chunkIndex: 0,
        vector,
        metadata: JSON.stringify({ source: 'wp-options' }),
        indexedAt: Date.now(),
        post_date_gmt: '',
        post_modified_gmt: new Date().toISOString(),
        doc_url: '',
      }]);
    } catch { /* non-fatal — settings indexing is best-effort */ }
  }

  async removeSite(siteId: string): Promise<void> {
    await this.deps.vectorStore.dropSite(siteId);
    this.deps.indexRegistry.remove(siteId);
    this.statusMap.delete(siteId);
  }

  /**
   * chunkPosts / makeDocShell / splitSentences used to live here as private
   * methods. WP-62 lifted them to `./chunker` unchanged so the two remote
   * indexing paths could use the SAME chunker rather than a copy — the remote
   * path had no chunking at all, and a copy would have diverged on the first
   * tuning change. `tests/unit/content/chunker-parity.test.ts` pins the local
   * and remote callers to one document set.
   */

  private setStatus(siteId: string, status: IndexStatus): void {
    this.statusMap.set(siteId, status);
    this.deps.onStatusChange?.(siteId, status);
  }
}
