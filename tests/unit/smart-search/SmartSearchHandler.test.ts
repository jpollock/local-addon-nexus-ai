import { IncomingMessage, ServerResponse } from 'http';
import { SmartSearchHandler } from '../../../src/main/smart-search/SmartSearchHandler';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';
import { TrackerStore } from '../../../src/main/smart-search/TrackerStore';
import Database from 'better-sqlite3';

function mockReq(body: object, siteId = 'site1'): IncomingMessage {
  const req = {
    headers: { 'x-nexus-site-id': siteId },
    on: jest.fn((event: string, cb: any) => {
      if (event === 'data') cb(JSON.stringify(body));
      if (event === 'end') cb();
      return req;
    }),
  } as unknown as IncomingMessage;
  return req;
}

function mockRes(): { res: ServerResponse; getBody: () => any } {
  let body = '';
  const res = {
    writeHead: jest.fn(),
    end: jest.fn((data: string) => { body = data; }),
    setHeader: jest.fn(),
  } as unknown as ServerResponse;
  return { res, getBody: () => JSON.parse(body) };
}

const mockVectorStore = {
  upsert: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  search: jest.fn().mockResolvedValue([]),
  lookupById: jest.fn().mockResolvedValue(null),
} as unknown as VectorStore;

const mockEmbedding = {
  isReady: jest.fn().mockReturnValue(true),
  embed: jest.fn().mockResolvedValue(new Float32Array(384)),
  embedBatch: jest.fn().mockResolvedValue([new Float32Array(384)]),
} as unknown as EmbeddingService;

let db: InstanceType<typeof Database>;
let synonymStore: SynonymStore;
let semanticConfig: SemanticConfig;
let trackerStore: TrackerStore;
let handler: SmartSearchHandler;

beforeEach(() => {
  db = new Database(':memory:');
  synonymStore = new SynonymStore(db);
  synonymStore.initialize();
  semanticConfig = new SemanticConfig(db);
  semanticConfig.initialize();
  trackerStore = new TrackerStore(db);
  trackerStore.initialize();
  jest.clearAllMocks();
  handler = new SmartSearchHandler(mockVectorStore, mockEmbedding, synonymStore, semanticConfig, trackerStore);
});

afterEach(() => db.close());

describe('SmartSearchHandler — write path', () => {
  it('handles index mutation and calls vectorStore.upsert', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success code } }',
      variables: {
        input: {
          id: 'post:1',
          data: { post_title: 'Hello', post_content: 'World', post_type: 'post', post_date_gmt: '2024-01-01T00:00:00', post_modified_gmt: '2024-01-01T00:00:00', post_url: 'https://example.com/hello' },
        },
      },
    }), res);
    expect(mockVectorStore.upsert).toHaveBeenCalledTimes(1);
    const body = getBody();
    expect(body.data.index.success).toBe(true);
    expect(body.data.index.code).toBe('200');
  });

  it('handles bulkIndex mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation BulkIndex($docs: [DocumentInput!], $meta: MetaInput) { bulkIndex(input: { documents: $docs meta: $meta }) { code } }',
      variables: {
        docs: [
          { id: 'post:1', data: { post_title: 'One', post_content: 'A', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' } },
          { id: 'post:2', data: { post_title: 'Two', post_content: 'B', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' } },
        ],
      },
    }), res);
    expect(mockVectorStore.upsert).toHaveBeenCalledTimes(1);
    expect(getBody().data.bulkIndex.code).toBe('200');
  });

  it('handles delete mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation DeleteRecord($id: ID!, $meta: MetaInput) { delete(id: $id, meta: $meta) { success code } }',
      variables: { id: 'post:1' },
    }), res);
    expect(mockVectorStore.delete).toHaveBeenCalledWith('site1', ['post:1']);
    expect(getBody().data.delete.success).toBe(true);
  });

  it('handles deleteAll mutation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation DeleteAllRecords($meta: MetaInput) { deleteAll(meta: $meta) { success code } }',
      variables: {},
    }), res);
    expect(mockVectorStore.delete).toHaveBeenCalledWith('site1', ['__all__']);
    expect(getBody().data.deleteAll.success).toBe(true);
  });

  it('returns error envelope for unknown operation', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({ query: '{ unknownOp { id } }', variables: {} }), res);
    expect(getBody().errors).toBeDefined();
  });
});

describe('SmartSearchHandler — capabilities', () => {
  it('returns all capability strings', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query GetCapabilities { capabilities }',
      variables: {},
    }), res);
    const caps = getBody().data.capabilities;
    expect(caps).toContain('SEARCH');
    expect(caps).toContain('HYBRID_SEARCH');
    expect(caps).toContain('SIMILARITY_SEARCH');
    expect(caps).toContain('RECOMMENDATIONS');
    expect(caps).toContain('VECTOR_DB');
  });
});

describe('SmartSearchHandler — find', () => {
  it('calls vectorStore.search and returns shaped response', async () => {
    (mockVectorStore.search as jest.Mock).mockResolvedValueOnce([
      { id: 'post:1', score: 0.8, title: 'Hello', content: 'World', postType: 'post', postId: 1, metadata: '{"post_title":"Hello","post_type":"post"}' },
    ]);
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
      variables: { query: 'hello', limit: 5, offset: 0 },
    }), res);
    expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
    const body = getBody();
    expect(body.data.find.total).toBe(1);
    expect(body.data.find.documents[0].id).toBe('post:1');
    expect(body.data.find.documents[0].score).toBeCloseTo(0.8);
  });

  it('returns empty results when vectorStore returns nothing', async () => {
    (mockVectorStore.search as jest.Mock).mockResolvedValueOnce([]);
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
      variables: { query: 'nothing', limit: 5, offset: 0 },
    }), res);
    expect(getBody().data.find.total).toBe(0);
    expect(getBody().data.find.documents).toHaveLength(0);
  });
});

describe('SmartSearchHandler — synonyms', () => {
  it('saves a synonym rule and lists it back', async () => {
    const { res: saveRes, getBody: getSaveBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { config { synonyms { saveRule(synonyms: "laptop, notebook") { success rule { id synonyms } } } } }',
      variables: { synonyms: 'laptop, notebook' },
    }), saveRes);
    expect(getSaveBody().data.config.synonyms.saveRule.success).toBe(true);
    const ruleId = getSaveBody().data.config.synonyms.saveRule.rule.id;

    const { res: listRes, getBody: getListBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { synonyms { rules { total rules { id synonyms } } } } }',
      variables: {},
    }), listRes);
    const rules = getListBody().data.config.synonyms.rules;
    expect(rules.total).toBe(1);
    expect(rules.rules[0].synonyms).toBe('laptop, notebook');
    expect(rules.rules[0].id).toBe(ruleId);
  });

  it('deletes all synonym rules', async () => {
    synonymStore.saveRule('site1', 'a, b');
    synonymStore.saveRule('site1', 'c, d');

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { config { synonyms { deleteAllRules } } }',
      variables: {},
    }), res);
    expect(getBody().data.config.synonyms.deleteAllRules).toBe(true);
    expect(synonymStore.getRules('site1')).toHaveLength(0);
  });
});

describe('SmartSearchHandler — semanticConfig', () => {
  it('sets and retrieves semantic search field configuration', async () => {
    const { res: setRes, getBody: getSetBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation ConfigSemantic { config { semanticSearch(fields: ["post_title"]) { fields type } } }',
      variables: { fields: ['post_title'] },
    }), setRes);
    expect(getSetBody().data.config.semanticSearch.fields).toEqual(['post_title']);
    expect(getSetBody().data.config.semanticSearch.type).toBe('BASIC');

    const { res: getRes, getBody: getGetBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { semanticSearch { fields type } } }',
      variables: {},
    }), getRes);
    expect(getGetBody().data.config.semanticSearch.fields).toEqual(['post_title']);
  });

  it('returns default config when nothing set', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { semanticSearch { fields type } } }',
      variables: {},
    }), res);
    expect(getBody().data.config.semanticSearch.fields).toEqual(['post_title', 'post_content']);
  });
});

describe('SmartSearchHandler — tracker', () => {
  it('handles trackPageView', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackPageView(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:1' } },
    }), res);
    expect(getBody().data.tracker.trackPageView.success).toBe(true);
  });

  it('handles trackSearch', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackSearch(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { search: { query: 'hello', results: [{}, {}] } } },
    }), res);
    expect(getBody().data.tracker.trackSearch.success).toBe(true);
    const terms = trackerStore.getSearchTerms('site1', 10);
    expect(terms[0].term).toBe('hello');
    expect(terms[0].numberOfSearches).toBe(1);
  });

  it('handles trackSearchClick', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:1', position: 2 } },
    }), res);
    expect(getBody().data.tracker.trackSearchClick.success).toBe(true);
    const trending = trackerStore.getTrendingDocuments('site1', 5);
    expect(trending[0].docID).toBe('post:1');
  });
});

describe('SmartSearchHandler — recommendations', () => {
  it('returns trendingDocuments from tracker data', async () => {
    trackerStore.trackSearchClick('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42', position: 1 });
    trackerStore.trackSearchClick('site1', { sessionId: 's2', userId: 'u2', documentId: 'post:42', position: 1 });

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { recommendations(count: 5) { trendingDocuments(from: "2024-01-01" to: "2099-01-01") { docID count } } }',
      variables: { count: 5 },
    }), res);
    const trending = getBody().data.recommendations.trendingDocuments;
    expect(trending[0].docID).toBe('post:42');
    expect(trending[0].count).toBe(2);
  });

  it('returns empty relatedDocuments when doc not found', async () => {
    (mockVectorStore as any).lookupById = jest.fn().mockResolvedValue(null);

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { recommendations(count: 5) { relatedDocuments(docID: "post:999") { docID score } } }',
      variables: { count: 5, docID: 'post:999' },
    }), res);
    expect(getBody().data.recommendations.relatedDocuments).toHaveLength(0);
  });
});

describe('SmartSearchHandler — insights', () => {
  it('returns search terms and no-result terms from tracker', async () => {
    trackerStore.trackSearch('site1', { sessionId: 's1', userId: 'u1', query: 'road trip', resultCount: 5 });
    trackerStore.trackSearch('site1', { sessionId: 's2', userId: 'u2', query: 'xyzzy', resultCount: 0 });

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { insights { searchTerms { term numberOfSearches } searchTermsNoResults { term numberOfSearches } } }',
      variables: { top: 10 },
    }), res);
    const body = getBody().data.insights;
    expect(body.searchTerms[0].term).toBe('road trip');
    expect(body.searchTermsNoResults[0].term).toBe('xyzzy');
  });
});
