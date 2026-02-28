import * as http from 'http';
import { discoverRestApi } from '../../../src/main/content/extractors/RestApiScanner';

let mockServer: http.Server;
let serverPort: number;

function startMockServer(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer(handler);
    mockServer.listen(0, () => {
      const addr = mockServer.address() as { port: number };
      serverPort = addr.port;
      resolve(serverPort);
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (mockServer) {
      mockServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

afterEach(async () => {
  await stopMockServer();
});

describe('RestApiScanner', () => {
  test('parses valid wp-json response', async () => {
    const port = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        namespaces: ['wp/v2', 'oembed/1.0', 'wc/v3', 'acf/v3'],
        routes: {
          '/': {},
          '/wp/v2/posts': {},
          '/wp/v2/pages': {},
          '/wc/v3/products': {},
        },
      }));
    });

    const result = await discoverRestApi(`localhost:${port}`);

    expect(result).not.toBeNull();
    expect(result!.namespaces).toEqual(['wp/v2', 'oembed/1.0', 'wc/v3', 'acf/v3']);
    expect(result!.routeCount).toBe(4);
  });

  test('identifies custom namespaces', async () => {
    const port = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        namespaces: ['wp/v2', 'oembed/1.0', 'wp-site-health/v1', 'wc/v3', 'jetpack/v4'],
        routes: {},
      }));
    });

    const result = await discoverRestApi(`localhost:${port}`);

    expect(result!.customNamespaces).toEqual(['wc/v3', 'jetpack/v4']);
  });

  test('returns null on network error', async () => {
    // Connect to a port that nothing is listening on
    const result = await discoverRestApi('localhost:1');

    expect(result).toBeNull();
  });

  test('returns null on non-JSON response', async () => {
    const port = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Not JSON</body></html>');
    });

    const result = await discoverRestApi(`localhost:${port}`);

    expect(result).toBeNull();
  });

  test('returns null on non-200 status', async () => {
    const port = await startMockServer((req, res) => {
      res.writeHead(404);
      res.end('Not found');
    });

    const result = await discoverRestApi(`localhost:${port}`);

    expect(result).toBeNull();
  });

  test('handles missing namespaces field', async () => {
    const port = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Test Site' }));
    });

    const result = await discoverRestApi(`localhost:${port}`);

    expect(result).not.toBeNull();
    expect(result!.namespaces).toEqual([]);
    expect(result!.routeCount).toBe(0);
    expect(result!.customNamespaces).toEqual([]);
  });
});
