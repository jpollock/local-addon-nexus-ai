/**
 * RestApiServer
 *
 * Read-only REST API server exposed from the Electron main process.
 * Uses Node's built-in `http` module — no external dependencies.
 *
 * Default port: 14200
 * Auth: Bearer token (Authorization header)
 *
 * Endpoints:
 *   GET /api/v1/sites             — all sites with twin completeness
 *   GET /api/v1/sites/:id         — single site detail
 *   GET /api/v1/fleet/health      — fleet health summary
 *   GET /api/v1/search?q=...      — semantic search results
 *   GET /api/v1/fleet/plugins     — plugin inventory with site counts
 */

import * as http from 'http';
import type { NexusServices } from '../types/nexus-services';
import { handleSitesList, handleSiteDetail } from './routes/sites';
import { handleFleetHealth } from './routes/fleet';
import { handleSearch } from './routes/search';
import { handleFleetPlugins } from './routes/plugins';

export interface RestApiServerOptions {
  /** Port to listen on. Default: 14200 */
  port: number;
  /** Bearer token for authentication */
  authToken: string;
  services: NexusServices;
  logger: any;
}

const REST_API_VERSION = '1.0';

function jsonOk(res: http.ServerResponse, data: unknown, extra?: Record<string, unknown>): void {
  const body = JSON.stringify({
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: REST_API_VERSION,
      ...extra,
    },
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  const body = JSON.stringify({ error: { code, message } });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export class RestApiServer {
  private server: http.Server | null = null;
  private options: RestApiServerOptions;

  constructor(options: RestApiServerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );

      this.server.on('error', (err) => {
        this.options.logger.error('[NexusAI REST] Server error:', err.message);
        reject(err);
      });

      this.server.listen(this.options.port, '127.0.0.1', () => {
        this.options.logger.info(
          `[NexusAI REST] API server listening on http://127.0.0.1:${this.options.port}`,
        );
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.closeAllConnections?.();
      this.server.close();
      this.server = null;
    }
  }

  getPort(): number {
    return this.options.port;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only GET allowed
    if (req.method !== 'GET') {
      jsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.');
      return;
    }

    // Authenticate
    const auth = req.headers['authorization'] ?? '';
    const expected = `Bearer ${this.options.authToken}`;
    if (auth !== expected) {
      jsonError(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization: Bearer <token> header.');
      return;
    }

    // Parse URL
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.options.port}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    this.route(pathname, url, res).catch((err) => {
      this.options.logger.error('[NexusAI REST] Unhandled route error:', err?.message ?? err);
      jsonError(res, 500, 'INTERNAL_ERROR', 'An internal error occurred.');
    });
  }

  private async route(
    pathname: string,
    url: URL,
    res: http.ServerResponse,
  ): Promise<void> {
    const { services } = this.options;

    // GET /api/v1/sites
    if (pathname === '/api/v1/sites') {
      const { data, total } = await handleSitesList(services);
      jsonOk(res, data, { total });
      return;
    }

    // GET /api/v1/sites/:id
    const siteMatch = pathname.match(/^\/api\/v1\/sites\/([^/]+)$/);
    if (siteMatch) {
      const siteId = decodeURIComponent(siteMatch[1]);
      const site = await handleSiteDetail(siteId, services);
      if (!site) {
        jsonError(res, 404, 'NOT_FOUND', `Site "${siteId}" not found.`);
        return;
      }
      jsonOk(res, site);
      return;
    }

    // GET /api/v1/fleet/health
    if (pathname === '/api/v1/fleet/health') {
      const summary = await handleFleetHealth(services);
      jsonOk(res, summary);
      return;
    }

    // GET /api/v1/search?q=...&limit=...
    if (pathname === '/api/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

      if (!q.trim()) {
        jsonError(res, 400, 'BAD_REQUEST', 'Query parameter "q" is required.');
        return;
      }

      const results = await handleSearch(q, limit, services);
      jsonOk(res, results, { query: q, limit });
      return;
    }

    // GET /api/v1/fleet/plugins?minSites=N&search=...
    if (pathname === '/api/v1/fleet/plugins') {
      const minSitesParam = url.searchParams.get('minSites');
      const minSites = minSitesParam ? Math.max(parseInt(minSitesParam, 10) || 1, 1) : 1;
      const search = url.searchParams.get('search') ?? undefined;

      const { data, sitesWithFullData, totalSites } = await handleFleetPlugins(
        minSites,
        search,
        services,
      );
      jsonOk(res, data, { totalSites, sitesWithFullData });
      return;
    }

    jsonError(res, 404, 'NOT_FOUND', `No endpoint at ${pathname}`);
  }
}
