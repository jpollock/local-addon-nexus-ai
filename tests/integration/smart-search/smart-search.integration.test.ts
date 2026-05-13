/**
 * @jest-environment ./tests/environments/onnx-environment.js
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import Database from 'better-sqlite3';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import { SmartSearchHandler } from '../../../src/main/smart-search/SmartSearchHandler';
import { SynonymStore } from '../../../src/main/smart-search/SynonymStore';
import { SemanticConfig } from '../../../src/main/smart-search/SemanticConfig';
import { TrackerStore } from '../../../src/main/smart-search/TrackerStore';
import { IncomingMessage, ServerResponse } from 'http';

const SITE_ID = 'integration-test-site';
const MODEL_DIR = path.join(__dirname, '../../../models/all-MiniLM-L6-v2-quantized');
const hasModel = fs.existsSync(path.join(MODEL_DIR, 'model.onnx'));

// Helper: call handler in-process without real HTTP
async function callHandler(handler: SmartSearchHandler, body: object, siteId = SITE_ID): Promise<any> {
  return new Promise((resolve) => {
    let responseBody = '';
    const req = {
      headers: { 'x-nexus-site-id': siteId },
      on: jest.fn((event: string, cb: any) => {
        if (event === 'data') setTimeout(() => cb(JSON.stringify(body)), 0);
        if (event === 'end') setTimeout(() => cb(), 0);
        return req;
      }),
    } as unknown as IncomingMessage;
    const res = {
      writeHead: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn((data: string) => { responseBody = data; resolve(JSON.parse(data)); }),
    } as unknown as ServerResponse;
    handler.handle(req, res);
  });
}

let tmpDir: string;
let vectorStore: VectorStore;
let embeddingService: EmbeddingService;
let db: InstanceType<typeof Database>;
let handler: SmartSearchHandler;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ss-int-'));
  vectorStore = new VectorStore(path.join(tmpDir, 'vectors'));
  await vectorStore.initialize();

  embeddingService = new EmbeddingService(MODEL_DIR);
  if (hasModel) {
    await embeddingService.initialize();
  }

  db = new Database(path.join(tmpDir, 'graph.db'));
  const synonymStore = new SynonymStore(db);
  synonymStore.initialize();
  const semanticConfig = new SemanticConfig(db);
  semanticConfig.initialize();
  const trackerStore = new TrackerStore(db);
  trackerStore.initialize();

  handler = new SmartSearchHandler(vectorStore, embeddingService, synonymStore, semanticConfig, trackerStore);
}, 30000);

afterAll(async () => {
  db?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Smart Search integration', () => {
  describe('index → find round-trip', () => {
    it('indexes a document and finds it by keyword', async () => {
      const indexResp = await callHandler(handler, {
        query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success code } }',
        variables: {
          input: {
            id: 'post:1',
            data: {
              post_title: 'WordPress performance tips',
              post_content: 'Caching makes sites faster. Use a CDN.',
              post_type: 'post',
              post_date_gmt: '2024-06-01T00:00:00',
              post_modified_gmt: '2024-06-01T00:00:00',
              post_url: 'https://example.com/performance',
            },
          },
        },
      });
      expect(indexResp.data.index.success).toBe(true);
      expect(indexResp.data.index.code).toBe('200');

      const findResp = await callHandler(handler, {
        query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
        variables: { query: 'performance', limit: 5, offset: 0 },
      });
      expect(findResp.data.find.total).toBeGreaterThan(0);
      expect(findResp.data.find.documents[0].id).toBe('post:1');
    });
  });

  describe('deleteAll → find returns empty', () => {
    it('clears all documents and find returns zero results', async () => {
      // Ensure there's at least one doc
      await callHandler(handler, {
        query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success } }',
        variables: {
          input: {
            id: 'post:temp',
            data: { post_title: 'Temp', post_content: 'Temp content', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' },
          },
        },
      });

      await callHandler(handler, {
        query: 'mutation DeleteAllRecords { deleteAll { success code } }',
        variables: {},
      });

      const findResp = await callHandler(handler, {
        query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
        variables: { query: 'performance', limit: 5, offset: 0 },
      });
      expect(findResp.data.find.total).toBe(0);
    });
  });

  describe('synonym round-trip', () => {
    it('finds a document using a configured synonym', async () => {
      // Re-index a doc (deleted in previous test)
      await callHandler(handler, {
        query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success } }',
        variables: {
          input: {
            id: 'post:2',
            data: { post_title: 'Notebook review', post_content: 'The best notebook for coding and writing', post_type: 'post', post_date_gmt: '', post_modified_gmt: '', post_url: '' },
          },
        },
      });

      // Save synonym rule
      const saveResp = await callHandler(handler, {
        query: 'mutation { config { synonyms { saveRule(synonyms: "laptop, notebook") { success rule { id } } } } }',
        variables: { synonyms: 'laptop, notebook' },
      });
      expect(saveResp.data.config.synonyms.saveRule.success).toBe(true);

      // Search with synonym — "laptop" should find "notebook" document
      const findResp = await callHandler(handler, {
        query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
        variables: { query: 'laptop', limit: 5, offset: 0 },
      });
      expect(findResp.data.find.total).toBeGreaterThan(0);
      expect(findResp.data.find.documents.some((d: any) => d.id === 'post:2')).toBe(true);
    });
  });

  describe('tracker → trendingDocuments round-trip', () => {
    it('tracks clicks and returns trending documents', async () => {
      // Track two clicks on post:2
      await callHandler(handler, {
        query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success } } }',
        variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:2', position: 1 } },
      });
      await callHandler(handler, {
        query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success } } }',
        variables: { session: { id: 's2' }, userID: 'u2', data: { documentID: 'post:2', position: 1 } },
      });

      const recResp = await callHandler(handler, {
        query: 'query { recommendations(count: 5) { trendingDocuments(from: "2024-01-01" to: "2099-01-01") { docID count } } }',
        variables: { count: 5 },
      });
      const trending = recResp.data.recommendations.trendingDocuments;
      expect(trending.length).toBeGreaterThan(0);
      expect(trending[0].docID).toBe('post:2');
      expect(trending[0].count).toBe(2);
    });
  });

  describe('typo tolerance (relevance floor = 0)', () => {
    it('finds content matching a misspelled query via semantic similarity', async () => {
      if (!hasModel) {
        console.log('Skipping typo test — ONNX model not present (semantic similarity unavailable)');
        return;
      }

      await callHandler(handler, {
        query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success } }',
        variables: {
          input: {
            id: 'post:road-test',
            data: {
              post_title: 'Road trip planning guide',
              post_content: 'Everything you need to know for planning the perfect road trip across America.',
              post_type: 'post',
              post_date_gmt: '2024-01-01T00:00:00',
              post_modified_gmt: '2024-01-01T00:00:00',
              post_url: 'http://example.com/road-trip',
            },
          },
        },
      });

      // "roade" is a 1-char typo for "road" — semantic embedding should still match
      const findResp = await callHandler(handler, {
        query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
        variables: { query: 'roade', limit: 5, offset: 0 },
      });

      expect(findResp.data.find.total).toBeGreaterThan(0);
      expect(findResp.data.find.documents.some((d: any) => d.id === 'post:road-test')).toBe(true);
      // Verify score is non-zero but low (typo match, not exact)
      const roadDoc = findResp.data.find.documents.find((d: any) => d.id === 'post:road-test');
      expect(roadDoc.score).toBeGreaterThan(0);
      expect(roadDoc.score).toBeLessThan(0.5);
    });
  });
});
