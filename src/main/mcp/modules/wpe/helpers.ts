import { McpToolResult, NexusServices } from '../../types';

export function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function requireCAPI(services: NexusServices): boolean {
  return !!services.localServices?.isCAPIAvailable();
}

export function requireLocalServices(services: NexusServices): boolean {
  return !!services.localServices;
}

/**
 * Returns a stale-data warning string if the WPE sync is older than the
 * configured threshold, or empty string if fresh. Appends to tool responses.
 */
export async function staleSyncWarning(services: NexusServices): Promise<string> {
  try {
    const graphService = (services as any).graphService;
    if (!graphService?.getDb) return '';
    const db = graphService.getDb();
    if (!db) return '';

    // Use MAX(last_sync_at) — when the most recent sync ran, not the oldest record
    const row = db.prepare('SELECT MAX(last_sync_at) as latest FROM sites WHERE source = ?').get('wpe') as { latest: number | null } | undefined;
    if (!row?.latest) return '';

    const registryStorage = (services as any).registryStorage;
    const settings = registryStorage?.get?.('nexus_settings') as { wpeSyncIntervalHours?: number } | null;
    const thresholdHours = settings?.wpeSyncIntervalHours ?? 8;

    const ageMs = Date.now() - row.latest;
    const ageHours = Math.round(ageMs / 3600000);

    if (ageMs > thresholdHours * 3600000) {
      return `\n\n> ⚠️ WPE sync data is ${ageHours}h old (threshold: ${thresholdHours}h). Run \`wpe_sync_sites\` or wait for the next auto-sync for fresh data.`;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Handles errors from Local's CAPI client.
 * ResponseError with status 401/403 means the OAuth token has expired —
 * return an actionable message so the agent knows to call wpe_login.
 */
export function capiError(err: any): McpToolResult {
  const msg: string = err?.message ?? String(err);
  const isAuth = msg.toLowerCase().includes('response returned an error code') ||
    msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized');

  if (isAuth) {
    return error(
      'WP Engine authentication has expired. Call wpe_login to re-authenticate, ' +
      'then retry this tool.',
    );
  }

  // Try to surface the CAPI response body for 400 errors — these usually contain
  // a useful validation message (e.g. "name already taken", "invalid characters")
  const bodyDetail = err?.responseJson?.message ?? err?.body?.message ?? err?.data?.message ?? null;
  const status = err?.status ?? err?.statusCode ?? null;

  if (status === 400 && bodyDetail) {
    return error(`WP Engine API error (400): ${bodyDetail}`);
  }

  return error(`WP Engine API error: ${msg}${bodyDetail ? ` — ${bodyDetail}` : ''}`);
}
