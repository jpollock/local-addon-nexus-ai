/**
 * Unit tests for WebhookEmitter
 */

import * as http from 'http';
import { AddressInfo } from 'net';
import { WebhookEmitter, WebhookConfig, WebhookEventType } from '../../../src/main/webhooks/WebhookEmitter';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Start a minimal HTTP server that records received requests.
 * Returns the server, its base URL, and an accessor for captured payloads.
 */
function startTestServer(): Promise<{
  url: string;
  lastRequest: () => { headers: http.IncomingHttpHeaders; body: string } | null;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    let captured: { headers: http.IncomingHttpHeaders; body: string } | null = null;

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        captured = { headers: req.headers, body };
        res.writeHead(200);
        res.end('ok');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        lastRequest: () => captured,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });

    server.on('error', reject);
  });
}

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookEmitter', () => {
  // 1. emit() sends POST to the correct URL
  it('sends a POST request to the configured URL with correct payload', async () => {
    const server = await startTestServer();

    try {
      const webhook: WebhookConfig = {
        id: 'test-1',
        url: server.url,
        events: ['site.indexed'],
      };

      const emitter = new WebhookEmitter(() => [webhook], makeLogger());
      await emitter.emit('site.indexed', { siteId: 'abc', documentCount: 42 });

      const req = server.lastRequest();
      expect(req).not.toBeNull();

      const body = JSON.parse(req!.body);
      expect(body.event).toBe('site.indexed');
      expect(body.data.siteId).toBe('abc');
      expect(body.data.documentCount).toBe(42);
      expect(typeof body.timestamp).toBe('string');
    } finally {
      await server.close();
    }
  });

  // 2. HMAC signature is correct when secret is configured
  it('includes a correct X-Nexus-Signature header when secret is set', async () => {
    const server = await startTestServer();

    try {
      const secret = 'supersecret';
      const webhook: WebhookConfig = {
        id: 'test-sig',
        url: server.url,
        secret,
        events: ['backup.created'],
      };

      const emitter = new WebhookEmitter(() => [webhook], makeLogger());
      await emitter.emit('backup.created', { installId: 'my-install', backupId: 'bk-1' });

      const req = server.lastRequest();
      expect(req).not.toBeNull();

      const signature = req!.headers['x-nexus-signature'] as string;
      expect(signature).toBeDefined();
      expect(signature.startsWith('sha256=')).toBe(true);

      // Verify the HMAC ourselves
      const expectedHmac = crypto
        .createHmac('sha256', secret)
        .update(req!.body, 'utf8')
        .digest('hex');
      expect(signature).toBe(`sha256=${expectedHmac}`);
    } finally {
      await server.close();
    }
  });

  // 3. emit() does not throw when URL is unreachable
  it('does not throw when the destination URL is unreachable', async () => {
    const webhook: WebhookConfig = {
      id: 'test-unreachable',
      url: 'http://127.0.0.1:1', // Nothing listening on port 1
      events: ['wpe.sync.failed'],
    };

    const logger = makeLogger();
    const emitter = new WebhookEmitter(() => [webhook], logger);

    // Must not throw
    await expect(
      emitter.emit('wpe.sync.failed', { error: 'connection refused' }),
    ).resolves.toBeUndefined();

    // Warning should be logged
    expect(logger.warn).toHaveBeenCalled();
  });

  // 4. Events not subscribed to are not delivered
  it('does not send a request when the event is not in the webhook event list', async () => {
    const server = await startTestServer();

    try {
      const webhook: WebhookConfig = {
        id: 'test-filter',
        url: server.url,
        events: ['backup.created'], // NOT site.indexed
      };

      const emitter = new WebhookEmitter(() => [webhook], makeLogger());
      await emitter.emit('site.indexed', { siteId: 'xyz' });

      // Server should have received nothing
      expect(server.lastRequest()).toBeNull();
    } finally {
      await server.close();
    }
  });

  // 5. No secret → no signature header
  it('omits the X-Nexus-Signature header when no secret is configured', async () => {
    const server = await startTestServer();

    try {
      const webhook: WebhookConfig = {
        id: 'test-no-secret',
        url: server.url,
        events: ['site.health.degraded'],
      };

      const emitter = new WebhookEmitter(() => [webhook], makeLogger());
      await emitter.emit('site.health.degraded', { siteId: 'a', score: 40 });

      const req = server.lastRequest();
      expect(req).not.toBeNull();
      expect(req!.headers['x-nexus-signature']).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  // 6. Multiple webhooks subscribed to same event — all receive it
  it('delivers the event to all webhooks subscribed to that event type', async () => {
    const server1 = await startTestServer();
    const server2 = await startTestServer();

    try {
      const webhooks: WebhookConfig[] = [
        { id: 'w1', url: server1.url, events: ['plugin.update.available'] },
        { id: 'w2', url: server2.url, events: ['plugin.update.available'] },
      ];

      const emitter = new WebhookEmitter(() => webhooks, makeLogger());
      await emitter.emit('plugin.update.available', { plugin: 'woocommerce' });

      expect(server1.lastRequest()).not.toBeNull();
      expect(server2.lastRequest()).not.toBeNull();
    } finally {
      await server1.close();
      await server2.close();
    }
  });
});
