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
