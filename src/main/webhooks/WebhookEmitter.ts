/**
 * WebhookEmitter
 *
 * Delivers HTTP POST payloads to user-configured webhook endpoints when
 * key Nexus AI events occur. Supports optional HMAC-SHA256 signatures for
 * request verification.
 *
 * Design:
 * - Fire-and-forget with a 5-second timeout per delivery attempt.
 * - Never throws — all delivery errors are logged, not propagated.
 * - Filters events so each webhook only receives subscribed event types.
 */

import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | 'site.indexed'
  | 'site.health.degraded'
  | 'wpe.sync.failed'
  | 'backup.created'
  | 'plugin.update.available';

export interface WebhookConfig {
  id: string;         // UUID assigned on creation
  url: string;
  secret?: string;    // Optional HMAC-SHA256 secret
  events: WebhookEventType[];
  /** ISO timestamp of last delivery attempt */
  lastDeliveryAt?: string;
  /** HTTP status code of last delivery; null if never delivered */
  lastDeliveryStatus?: number | null;
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;  // ISO 8601
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

/**
 * Compute `sha256=<hex>` HMAC using the provided secret and body string.
 */
function computeSignature(secret: string, body: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// HTTP delivery
// ---------------------------------------------------------------------------

const DELIVERY_TIMEOUT_MS = 5000;

function deliverPayload(
  url: string,
  body: string,
  signature?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options: http.RequestOptions = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'NexusAI-Webhook/1.0',
        ...(signature ? { 'X-Nexus-Signature': signature } : {}),
      },
    };

    const timer = setTimeout(() => {
      req.destroy(new Error('Webhook delivery timed out'));
    }, DELIVERY_TIMEOUT_MS);

    const req = transport.request(options, (res) => {
      clearTimeout(timer);
      // Drain response body to avoid socket hang
      res.resume();
      resolve(res.statusCode ?? 0);
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// WebhookEmitter
// ---------------------------------------------------------------------------

export class WebhookEmitter {
  private logger: { warn: (...a: any[]) => void; info: (...a: any[]) => void };

  constructor(
    private getWebhooks: () => WebhookConfig[],
    logger?: { warn: (...a: any[]) => void; info: (...a: any[]) => void },
  ) {
    this.logger = logger ?? { warn: console.warn, info: console.log };
  }

  /**
   * Emit an event to all subscribed webhook endpoints.
   *
   * Fire-and-forget: resolves immediately after dispatching; delivery runs
   * in the background. Never throws.
   */
  async emit(event: WebhookEventType, data: Record<string, unknown>): Promise<void> {
    const webhooks = this.getWebhooks().filter((wh) => wh.events.includes(event));

    if (webhooks.length === 0) return;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);

    // Deliver in parallel — each delivery is independent
    await Promise.allSettled(
      webhooks.map(async (wh) => {
        try {
          const signature = wh.secret ? computeSignature(wh.secret, body) : undefined;
          const status = await deliverPayload(wh.url, body, signature);
          this.logger.info(
            `[WebhookEmitter] Delivered "${event}" to ${wh.url.substring(0, 50)} — HTTP ${status}`,
          );
        } catch (err) {
          this.logger.warn(
            `[WebhookEmitter] Failed to deliver "${event}" to ${wh.url.substring(0, 50)}:`,
            (err as Error).message,
          );
        }
      }),
    );
  }
}
