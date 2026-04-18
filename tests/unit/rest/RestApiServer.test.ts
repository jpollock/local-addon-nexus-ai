/**
 * Unit tests for RestApiServer
 *
 * Tests:
 * 1. Server starts on configured port
 * 2. Unauthenticated request returns 401
 * 3. Authenticated request to unknown route returns 404
 * 4. GET /api/v1/sites returns JSON with data array
 * 5. GET /api/v1/fleet/health returns summary structure
 * 6. POST request returns 405 Method Not Allowed
 */

import * as http from 'http';
import { RestApiServer } from '../../../src/main/rest/RestApiServer';

const TEST_PORT = 14299;
const TEST_TOKEN = 'test-token-abc123';

function createMockServices(overrides: Record<string, unknown> = {}): any {
  return {
    vectorStore: {},
    embeddingService: {},
    contentPipeline: {},
    indexRegistry: {
      listAll: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null),
    },
    fileScanner: {},
    siteData: {
      getSite: jest.fn().mockReturnValue(null),
      getSites: jest.fn().mockReturnValue({}),
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    twinService: {
      getAll: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null),
    },
    healthCalculator: null,
    registry: null,
    ...overrides,
  };
}

function request(
  method: string,
  path: string,
  token?: string,
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method,
        headers,
        agent: false,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let body: any;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

describe('RestApiServer', () => {
  let server: RestApiServer;

  beforeAll(async () => {
    server = new RestApiServer({
      port: TEST_PORT,
      authToken: TEST_TOKEN,
      services: createMockServices(),
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    });
    await server.start();
  });

  afterAll(() => {
    server.stop();
  });

  test('server starts on configured port', () => {
    expect(server.getPort()).toBe(TEST_PORT);
  });

  test('unauthenticated request returns 401', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/sites');
    expect(statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('authenticated request to unknown route returns 404', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/unknown-endpoint', TEST_TOKEN);
    expect(statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  test('GET /api/v1/sites returns JSON with data array', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/sites', TEST_TOKEN);
    expect(statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('timestamp');
    expect(body.meta).toHaveProperty('version');
    expect(typeof body.meta.total).toBe('number');
  });

  test('GET /api/v1/fleet/health returns summary structure', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/fleet/health', TEST_TOKEN);
    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('totalSites');
    expect(body.data).toHaveProperty('indexedSites');
    expect(body.data).toHaveProperty('healthyCount');
    expect(body.data).toHaveProperty('warningCount');
    expect(body.data).toHaveProperty('criticalCount');
    expect(body.meta).toHaveProperty('timestamp');
  });

  test('POST request returns 405 Method Not Allowed', async () => {
    const { statusCode, body } = await request('POST', '/api/v1/sites', TEST_TOKEN);
    expect(statusCode).toBe(405);
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('RestApiServer — sites endpoint with data', () => {
  const DATA_PORT = TEST_PORT + 1;
  let server: RestApiServer;

  function requestData(method: string, path: string, token?: string): Promise<{ statusCode: number; body: any }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const req = http.request(
        { hostname: '127.0.0.1', port: DATA_PORT, path, method, headers, agent: false },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let body: any;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ statusCode: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    const services = createMockServices({
      siteData: {
        getSite: jest.fn().mockReturnValue({
          id: 'abc123', name: 'my-blog', domain: 'my-blog.local', path: '/sites/my-blog',
        }),
        getSites: jest.fn().mockReturnValue({
          abc123: { id: 'abc123', name: 'my-blog', domain: 'my-blog.local', path: '/sites/my-blog' },
        }),
      },
      twinService: {
        getAll: jest.fn().mockReturnValue([
          {
            siteId: 'abc123',
            siteName: 'my-blog',
            source: 'local',
            wpVersion: '7.0',
            phpVersion: '8.2',
            completeness: 'metadata',
            asOf: Date.now() - 12 * 60 * 1000,
          },
        ]),
        get: jest.fn().mockReturnValue({
          siteId: 'abc123',
          siteName: 'my-blog',
          source: 'local',
          wpVersion: '7.0',
          phpVersion: '8.2',
          completeness: 'metadata',
          asOf: Date.now() - 12 * 60 * 1000,
          siteUrl: 'http://my-blog.local',
          documentCount: 42,
          indexState: 'indexed',
        }),
      },
    });

    server = new RestApiServer({
      port: DATA_PORT,
      authToken: TEST_TOKEN,
      services,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    });
    await server.start();
  });

  afterAll(() => {
    server.stop();
  });

  test('GET /api/v1/sites returns site list with twin fields', async () => {
    const { statusCode, body } = await requestData('GET', '/api/v1/sites', TEST_TOKEN);
    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('abc123');
    expect(body.data[0].wpVersion).toBe('7.0');
    expect(body.data[0].twinCompleteness).toBe('metadata');
    expect(body.meta.total).toBe(1);
  });
});
