import { IncomingMessage, ServerResponse } from 'http';
import type { VectorStore } from '../vector-store/VectorStore';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { SynonymStore } from './SynonymStore';
import type { SemanticConfig } from './SemanticConfig';
import type { TrackerStore } from './TrackerStore';
import { expandSynonyms, applySearchBias, applyPostProcess, computeAggregations, type FindDoc } from './find-pipeline';
import { matchesFilter } from './filter-parser';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const str = chunk.toString();
      size += Buffer.byteLength(str);
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += str;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, body: object): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function errorResponse(res: ServerResponse, message: string): void {
  jsonResponse(res, { errors: [{ message, extensions: { code: 'INTERNAL_ERROR' } }] });
}

function detectOperation(query: string, variables: Record<string, any>): string {
  if (/\bcapabilities\b/.test(query)) return 'capabilities';
  if (/\bdeleteAll\b/.test(query)) return 'deleteAll';
  if (/\bdelete\b/.test(query) && variables?.id) return 'delete';
  if (/\bbulkIndex\b/.test(query)) return 'bulkIndex';
  if (/\bindex\b/.test(query) && variables?.input) return 'index';
  if (/\bfind\b/.test(query)) return 'find';
  if (/\bsynonyms\b/.test(query)) return 'synonyms';
  if (/\bsemanticSearch\b/.test(query) && /\bconfig\b/.test(query)) return 'semanticConfig';
  if (/\btracker\b/.test(query)) return 'tracker';
  if (/\brecommendations\b/.test(query)) return 'recommendations';
  if (/\binsights\b/.test(query)) return 'insights';
  return 'unknown';
}

export class SmartSearchHandler {
  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService,
    private synonymStore: SynonymStore,
    private semanticConfig: SemanticConfig,
    private trackerStore: TrackerStore,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const { query = '', variables = {} } = body;
      const siteId = (req.headers['x-nexus-site-id'] as string) || 'default';
      const op = detectOperation(query, variables);

      switch (op) {
        case 'capabilities': return this.handleCapabilities(res);
        case 'index': return await this.handleIndex(res, siteId, variables.input);
        case 'bulkIndex': return await this.handleBulkIndex(res, siteId, variables.docs ?? variables.input?.documents ?? []);
        case 'delete': return await this.handleDelete(res, siteId, variables.id);
        case 'deleteAll': return await this.handleDeleteAll(res, siteId);
        case 'find': return await this.handleFind(res, siteId, variables);
        case 'synonyms': return this.handleSynonyms(res, siteId, query, variables);
        case 'semanticConfig': return this.handleSemanticConfig(res, siteId, query, variables);
        case 'tracker': return this.handleTracker(res, siteId, query, variables);
        case 'recommendations': return await this.handleRecommendations(res, siteId, variables);
        case 'insights': return this.handleInsights(res, siteId, variables);
        default: return errorResponse(res, `Unknown operation`);
      }
    } catch (err: any) {
      errorResponse(res, err?.message ?? 'Internal error');
    }
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  private handleCapabilities(res: ServerResponse): void {
    // Return all capabilities we support — the plugin gates features on these strings
    jsonResponse(res, {
      data: {
        capabilities: ['SEARCH', 'HYBRID_SEARCH', 'SIMILARITY_SEARCH', 'RECOMMENDATIONS', 'VECTOR_DB'],
      },
    });
  }

  // ── Write path ────────────────────────────────────────────────────────────

  private async handleIndex(res: ServerResponse, siteId: string, input: any): Promise<void> {
    if (!input?.id || !input?.data) {
      return errorResponse(res, 'index: missing input.id or input.data');
    }
    await this.upsertDocuments(siteId, [input]);
    jsonResponse(res, { data: { index: { success: true, code: '200', message: 'Document was indexed successfully', document: { id: input.id } } } });
  }

  private async handleBulkIndex(res: ServerResponse, siteId: string, docs: any[]): Promise<void> {
    if (!docs.length) {
      return jsonResponse(res, { data: { bulkIndex: { code: '200', success: true, documents: [] } } });
    }
    const invalid = docs.filter(d => !d.id || !d.data);
    if (invalid.length) {
      return errorResponse(res, `bulkIndex: ${invalid.length} document(s) missing id or data`);
    }
    await this.upsertDocuments(siteId, docs);
    jsonResponse(res, { data: { bulkIndex: { code: '200', success: true, documents: docs.map(d => ({ id: d.id })) } } });
  }

  private async handleDelete(res: ServerResponse, siteId: string, id: string): Promise<void> {
    await this.vectorStore.delete(siteId, [id]);
    jsonResponse(res, { data: { delete: { success: true, code: '200', message: 'Document deleted' } } });
  }

  private async handleDeleteAll(res: ServerResponse, siteId: string): Promise<void> {
    await this.vectorStore.delete(siteId, ['__all__']);
    jsonResponse(res, { data: { deleteAll: { success: true, code: '200', message: 'All documents deleted' } } });
  }

  private async upsertDocuments(siteId: string, inputs: any[]): Promise<void> {
    const cfg = this.semanticConfig.get(siteId);
    const texts = inputs.map(inp => {
      const data = inp.data ?? {};
      return cfg.fields.map((f: string) => data[f] ?? '').filter(Boolean).join(' ');
    });

    let vectors: Float32Array[];
    if (this.embeddingService.isReady()) {
      vectors = await this.embeddingService.embedBatch(texts);
    } else {
      vectors = texts.map(() => new Float32Array(384));
    }

    const docs = inputs.map((inp, i) => ({
      id: inp.id,
      siteId,
      title: inp.data?.post_title ?? '',
      content: texts[i],
      postType: inp.data?.post_type ?? 'post',
      postId: 0,
      chunkIndex: 0,
      vector: vectors[i],
      metadata: JSON.stringify(inp.data ?? {}),
      indexedAt: Date.now(),
      post_date_gmt: inp.data?.post_date_gmt ?? '',
      post_modified_gmt: inp.data?.post_modified_gmt ?? '',
      doc_url: inp.data?.post_url ?? '',
    }));

    await this.vectorStore.upsert(siteId, docs);
  }

  // ── Find ──────────────────────────────────────────────────────────────────

  private async handleFind(res: ServerResponse, siteId: string, vars: any): Promise<void> {
    const {
      query = '', filter, semanticSearch, limit = 10, offset = 0,
      orderBy, promotions, customResults, aggregate, timeDecay,
      includeFields, excludeFields,
    } = vars;

    const rules = this.synonymStore.getRules(siteId);
    const expanded = expandSynonyms(query, rules);
    const bias = semanticSearch?.searchBias ?? 5;
    const vectorWeight = applySearchBias(bias);
    // Note: VectorStore.search does hybrid vector+FTS internally and doesn't
    // expose per-query weighting. We use vectorWeight to gate embedding generation:
    // bias=0 → skip embedding (FTS-only), bias>0 → use semantic vector.
    // Full per-query weight blending is tracked as a future enhancement.

    let queryVector: Float32Array | undefined;
    if (vectorWeight > 0 && this.embeddingService.isReady()) {
      queryVector = await this.embeddingService.embed(expanded);
    }

    const searchLimit = limit + (promotions?.documents?.length ?? 0) + 20;
    const rawResults = await this.vectorStore.search(siteId, queryVector ?? new Float32Array(384), {
      limit: searchLimit,
      postType: undefined,
      relevanceFloor: 0, // let the plugin rank; don't pre-filter by score
    });

    let docs: FindDoc[] = rawResults.map(r => {
      let data: Record<string, any> = {};
      try { data = JSON.parse(r.metadata); } catch {}
      return { id: r.id, score: r.score, sort: [String(r.score), r.id], data };
    });

    // Apply filter
    if (filter) {
      docs = docs.filter(d => matchesFilter(d.data, filter));
    }

    // Fetch promoted docs from vector store by ID
    let promotedDocs: FindDoc[] = [];
    if (promotions?.documents?.length) {
      const promoIds = new Set<string>(promotions.documents);
      promotedDocs = docs.filter(d => promoIds.has(d.id));
    }

    // Custom results — match by exact phrase
    let customResultDocs: FindDoc[] = [];
    if (customResults?.length) {
      const qLower = query.toLowerCase();
      for (const cr of customResults) {
        if ((cr.query ?? '').toLowerCase() === qLower) {
          const crIds = new Set<string>(cr.documents ?? []);
          customResultDocs = docs.filter(d => crIds.has(d.id));
          break;
        }
      }
    }

    // Aggregate before post-process changes the set
    const aggregations = aggregate?.terms
      ? computeAggregations(docs, aggregate.terms)
      : { terms: [] };

    // Apply orderBy by date fields
    if (orderBy?.length) {
      docs.sort((a, b) => {
        for (const ob of orderBy) {
          if (ob.field !== 'post_date_gmt' && ob.field !== 'post_modified_gmt') continue;
          const aDate = new Date(a.data[ob.field] ?? 0).getTime();
          const bDate = new Date(b.data[ob.field] ?? 0).getTime();
          const cmp = ob.direction === 'asc' ? aDate - bDate : bDate - aDate;
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }

    const processed = applyPostProcess(docs, {
      promotedDocs,
      customResultDocs,
      includeFields,
      excludeFields,
      timeDecay: timeDecay ?? [],
    });

    const paginated = processed.slice(offset, offset + limit);

    jsonResponse(res, {
      data: {
        find: {
          total: processed.length,
          documents: paginated,
          aggregations,
        },
      },
    });
  }

  // ── Config: synonyms ──────────────────────────────────────────────────────

  private handleSynonyms(res: ServerResponse, siteId: string, query: string, vars: any): void {
    if (/\bdeleteAllRules\b/.test(query)) {
      this.synonymStore.deleteAllRules(siteId);
      return jsonResponse(res, { data: { config: { synonyms: { deleteAllRules: true } } } });
    }
    if (/\bdeleteRule\b/.test(query) && vars?.id) {
      this.synonymStore.deleteRule(siteId, vars.id);
      return jsonResponse(res, { data: { config: { synonyms: { deleteRule: { success: true, code: '200' } } } } });
    }
    if (/saveRule/.test(query) && vars?.synonyms !== undefined) {
      const rule = this.synonymStore.saveRule(siteId, vars.synonyms, vars.id ?? undefined);
      return jsonResponse(res, { data: { config: { synonyms: { saveRule: { success: true, code: '200', rule } } } } });
    }
    if (/\brule\b/.test(query) && vars?.id) {
      const rule = this.synonymStore.getRule(siteId, vars.id);
      return jsonResponse(res, { data: { config: { synonyms: { rule } } } });
    }
    // Default: list rules
    const total = this.synonymStore.countRules(siteId);
    const rules = this.synonymStore.getRules(siteId, { offset: vars?.offset ?? 0, limit: vars?.limit ?? 100 });
    jsonResponse(res, { data: { config: { synonyms: { rules: { total, offset: vars?.offset ?? 0, limit: vars?.limit ?? 100, rules } } } } });
  }

  // ── Config: semanticSearch ────────────────────────────────────────────────

  private handleSemanticConfig(res: ServerResponse, siteId: string, query: string, vars: any): void {
    if (/mutation/.test(query) && vars?.fields) {
      const cfg = this.semanticConfig.set(siteId, vars.fields, vars.type ?? 'BASIC');
      return jsonResponse(res, { data: { config: { semanticSearch: cfg } } });
    }
    const cfg = this.semanticConfig.get(siteId);
    jsonResponse(res, { data: { config: { semanticSearch: cfg } } });
  }

  // ── Tracker ───────────────────────────────────────────────────────────────

  private handleTracker(res: ServerResponse, siteId: string, query: string, vars: any): void {
    if (/\btrackPageView\b/.test(query) && vars?.data?.documentID) {
      this.trackerStore.trackPageView(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, documentId: vars.data.documentID });
      return jsonResponse(res, { data: { tracker: { trackPageView: { success: true, message: 'ok' } } } });
    }
    if (/\btrackSearchClick\b/.test(query) && vars?.data?.documentID) {
      this.trackerStore.trackSearchClick(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, documentId: vars.data.documentID, position: vars.data.position ?? 0 });
      return jsonResponse(res, { data: { tracker: { trackSearchClick: { success: true, message: 'ok' } } } });
    }
    if (/\btrackSearch\b/.test(query) && vars?.data?.search?.query !== undefined) {
      this.trackerStore.trackSearch(siteId, { sessionId: vars.session?.id ?? '', userId: vars.userID, query: vars.data.search.query, resultCount: vars.data.search.results?.length ?? 0 });
      return jsonResponse(res, { data: { tracker: { trackSearch: { success: true, message: 'ok' } } } });
    }
    errorResponse(res, 'tracker: unrecognized event type');
  }

  // ── Recommendations ───────────────────────────────────────────────────────

  private async handleRecommendations(res: ServerResponse, siteId: string, vars: any): Promise<void> {
    const count = vars?.count ?? 5;

    if (vars?.docID !== undefined) {
      // Look up the reference document directly by ID via a WHERE query
      // rather than a zero-vector scan that may miss it
      let refContent: string | undefined;
      try {
        // @ts-ignore — accessing private getTable to perform a direct WHERE query
        const table = await (this.vectorStore as any).getTable(siteId);
        if (table) {
          const rows = await table.query().where(`id = '${vars.docID.replace(/'/g, "\\'")}'`).limit(1).toArray();
          refContent = rows[0]?.content;
        }
      } catch { /* table may not exist */ }

      if (!refContent) {
        return jsonResponse(res, { data: { recommendations: { relatedDocuments: [] } } });
      }

      const refVec = this.embeddingService.isReady()
        ? await this.embeddingService.embed(refContent)
        : new Float32Array(384);

      const similar = await this.vectorStore.search(siteId, refVec, { limit: count + 1 });
      const related = similar
        .filter(r => r.id !== vars.docID)
        .slice(0, count)
        .map(r => ({ docID: r.id, score: r.score, source: { id: r.id, post_title: r.title } }));
      return jsonResponse(res, { data: { recommendations: { relatedDocuments: related } } });
    }

    // Trending: frequency from tracker
    const trending = this.trackerStore.getTrendingDocuments(siteId, count)
      .map(t => ({ docID: t.docID, count: t.count, source: { id: t.docID } }));
    jsonResponse(res, { data: { recommendations: { trendingDocuments: trending } } });
  }

  // ── Insights ──────────────────────────────────────────────────────────────

  private handleInsights(res: ServerResponse, siteId: string, vars: any): void {
    const top = vars?.top ?? 10;
    const searchTerms = this.trackerStore.getSearchTerms(siteId, top);
    const searchTermsNoResults = this.trackerStore.getSearchTermsNoResults(siteId, top);
    const siteAnalytics = this.trackerStore.getSiteAnalytics(siteId, top);
    jsonResponse(res, { data: { insights: { searchTerms, searchTermsNoResults, siteAnalytics } } });
  }
}
