/**
 * HttpEventInterface - HTTP server for receiving WordPress events
 */
import * as http from 'http';
import * as crypto from 'crypto';
import { EventProcessor } from './EventProcessor';
import { WordPressEvent, EventType } from './types';
import { AIGatewayRoutes } from '../ai-gateway/AIGatewayRoutes';
import type { RegistryStorage } from '../content/IndexRegistry';
import { IPC_CHANNELS } from '../../common/constants';

const EVENT_TYPES: EventType[] = [
  'post_created',
  'post_updated',
  'post_deleted',
  'plugin_installed',
  'plugin_activated',
  'plugin_deactivated',
  'plugin_updated',
  'plugin_deleted',
  'theme_installed',
  'theme_activated',
  'theme_deleted',
  'user_created',
  'user_updated',
  'user_deleted',
  'site_initialized',
];

export interface HttpEventInterfaceOptions {
  eventProcessor: EventProcessor;
  logger: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
    warn: (msg: string) => void;
    debug: (msg: string) => void;
  };
  storage: RegistryStorage;
  port?: number;
  authToken?: string;
}

export interface ConnectionInfo {
  url: string;
  port: number;
  authToken: string;
}

export class HttpEventInterface {
  private server: http.Server | null = null;
  private eventProcessor: EventProcessor;
  private logger: any;
  private port: number;
  private authToken: string;
  private running = false;
  private aiGatewayRoutes: AIGatewayRoutes;

  constructor(options: HttpEventInterfaceOptions) {
    this.eventProcessor = options.eventProcessor;
    this.logger = options.logger;
    this.port = options.port ?? 0;
    this.authToken = options.authToken ?? this.generateToken();

    // Initialize AI Gateway routes
    this.aiGatewayRoutes = new AIGatewayRoutes({
      storage: options.storage,
      logger: options.logger,
      onUsageRecorded: () => {
        // Push a lightweight notification to the renderer so the dashboard refreshes
        try {
          const { BrowserWindow } = require('electron');
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC_CHANNELS.AI_GATEWAY_USAGE_UPDATED);
            }
          }
        } catch {
          // Non-fatal — dashboard will pick it up on next manual refresh
        }
      },
    });
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async start(): Promise<ConnectionInfo> {
    if (this.running) {
      throw new Error('HttpEventInterface already running');
    }

    // Find available port if not specified
    if (this.port === 0) {
      this.port = await this.findAvailablePort();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(this.port, '127.0.0.1', () => {
        this.running = true;
        const info = this.getConnectionInfo();
        this.logger.info(`[HttpEventInterface] Server listening on http://127.0.0.1:${this.port}`);
        resolve(info);
      });

      this.server.on('error', (err) => {
        this.running = false;
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.running = false;
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.running = false;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      url: `http://127.0.0.1:${this.port}`,
      port: this.port,
      authToken: this.authToken,
    };
  }

  private async findAvailablePort(): Promise<number> {
    const startPort = 13000;
    const endPort = 13100;

    for (let port = startPort; port <= endPort; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }

    throw new Error(`No available port in range ${startPort}-${endPort}`);
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = http.createServer();
      tester.once('error', () => resolve(false));
      tester.listen(port, '127.0.0.1', () => {
        tester.close(() => resolve(true));
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-WP-Site-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    // Health check - no auth required
    if (url === '/health' && req.method === 'GET') {
      this.handleHealth(req, res);
      return;
    }

    // AI Gateway routes handle their own auth via X-Auth-Token (not Bearer).
    // Must be checked before the Bearer auth gate below.
    if (url.startsWith('/ai-gateway/v1/')) {
      this.handleAIGatewayRoute(url, req, res);
      return;
    }

    // All other authenticated routes require Bearer token
    if (!this.validateAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (url === '/wp-events' && req.method === 'POST') {
      this.handleEventPost(req, res);
    } else if (url === '/wp-events/stats' && req.method === 'GET') {
      this.handleStatsGet(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleAIGatewayRoute(url: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    if (url === '/ai-gateway/v1/chat/completions' && req.method === 'POST') {
      this.aiGatewayRoutes.handleChatCompletions(req, res).catch((err) => {
        this.logger.error('[HttpEventInterface] AI Gateway chat error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
      });
    } else if (url === '/ai-gateway/v1/images/generations' && req.method === 'POST') {
      this.aiGatewayRoutes.handleImageGenerations(req, res).catch((err) => {
        this.logger.error('[HttpEventInterface] AI Gateway image error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
      });
    } else if (url === '/ai-gateway/v1/models' && req.method === 'GET') {
      this.aiGatewayRoutes.handleModels(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private validateAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') return false;
    if (!token) return false;

    return this.safeCompare(token, this.authToken);
  }

  private handleHealth(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: this.port }));
  }

  private handleEventPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    const MAX_BODY_SIZE = 1_048_576; // 1MB
    let bodySize = 0;
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
      body += chunk.toString();
    });

    req.on('end', async () => {
      if (aborted) return;
      try {
        const event = JSON.parse(body) as WordPressEvent;

        // Validate event
        const validation = this.validateEvent(event);
        if (!validation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: validation.error }));
          return;
        }

        // Enqueue event (acknowledge-before-process)
        const eventId = await this.eventProcessor.enqueue(event);

        // Respond immediately
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          event_id: eventId,
          message: 'Event queued for processing',
        }));

        // Trigger async processing (fire-and-forget)
        setImmediate(() => {
          this.eventProcessor.processAll().catch((err) => {
            this.logger.error('[HttpEventInterface] Background processing error:', err);
          });
        });
      } catch (error) {
        this.logger.error('[HttpEventInterface] Error handling event:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }

  private async handleStatsGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const stats = await this.eventProcessor.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (error) {
      this.logger.error('[HttpEventInterface] Error getting stats:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private validateEvent(event: any): { valid: boolean; error?: string } {
    if (!event.site_id) {
      return { valid: false, error: 'Missing required field: site_id' };
    }

    if (!event.event_type) {
      return { valid: false, error: 'Missing required field: event_type' };
    }

    if (!EVENT_TYPES.includes(event.event_type)) {
      return { valid: false, error: `Invalid event_type: ${event.event_type}` };
    }

    if (!event.payload) {
      return { valid: false, error: 'Missing required field: payload' };
    }

    // Validate payload contents based on event type
    if (event.event_type.startsWith('post_')) {
      if (!event.payload.post_id) {
        return { valid: false, error: 'Missing required payload field: post_id' };
      }
      if (event.event_type === 'post_created' || event.event_type === 'post_updated') {
        if (!event.payload.title) {
          return { valid: false, error: 'Missing required payload field: title' };
        }
      }
    }

    if (event.event_type.startsWith('plugin_')) {
      if (!event.payload.slug) {
        return { valid: false, error: 'Missing required payload field: slug' };
      }
      if (event.event_type === 'plugin_activated' || event.event_type === 'plugin_deactivated' || event.event_type === 'plugin_updated') {
        if (!event.payload.name) {
          return { valid: false, error: 'Missing required payload field: name' };
        }
      }
    }

    const TIMESTAMP_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour
    if (typeof event.timestamp === 'number') {
      if (Math.abs(Date.now() - event.timestamp) > TIMESTAMP_TOLERANCE_MS) {
        return { valid: false, error: 'Event timestamp out of range' };
      }
    } else {
      // Always use server time — never trust caller-supplied timestamp
      event.timestamp = Date.now();
    }

    return { valid: true };
  }
}
