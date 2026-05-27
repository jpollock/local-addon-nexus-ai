/**
 * WPE Sync IPC Handlers
 *
 * Handles all WPE site synchronization operations: WPE_SYNC_ALL, WPE_SYNC_STOP,
 * WPE_SYNC_STATUS, WPE_SYNC_STATS, WPE_CAPI_SYNC, WPE_SYNC_SINGLE,
 * WPE_GET_SYNCED_SITES, WPE_GET_SITE_DETAILS, WPE_DIAGNOSE_SITE, WPE_REMOVE_SITE.
 */
import { IPC_CHANNELS, STORAGE_KEYS } from '../../../common/constants';
import type { IpcHandlerDeps } from '../../types/ipc-handler-deps';
import type { AuditLogger } from '../../audit/AuditLogger';
import {
  validateInput,
  WpeSyncAllSchema,
  WpeSyncSingleSchema,
  WpeInstallIdSchema,
  WpeRemoveSiteSchema,
} from '../../../common/schemas';
import { safeHandle } from '../safe-handle';

/** Extra runtime objects created in registerIpcHandlers, passed down here. */
export interface WpeSyncHandlerContext {
  auditLogger: AuditLogger;
  emitNexusState?: (patch: Record<string, unknown>) => void;
}

export function registerWpeSyncHandlers(deps: IpcHandlerDeps, ctx: WpeSyncHandlerContext): void {
  const { localServicesBridge, graphService, registryStorage, localLogger } = deps;
  const { auditLogger, emitNexusState } = ctx;

  // =========================================================================
  // WPE Site Sync Handlers (Phase 1)
  // =========================================================================

  /**
   * Sync all WPE sites from wp-nexus MCP
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_ALL, async (_event: any, options?: { limit?: number }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      localLogger.warn?.('[NexusAI] WPE sync service not initialized');
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const validated = validateInput(WpeSyncAllSchema, options);

      const limit = validated?.limit;
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeAccountFilter?: string[] | null } | null;
      const accountFilter = settings?.wpeAccountFilter ?? null;
      // Manual sync always force-refreshes all installs (staleThresholdHours=0)
      // Incremental staleness is only for scheduled/auto syncs
      localLogger.info(`[NexusAI] Starting WPE site sync (force)${limit ? ` (limit: ${limit})` : ''}${accountFilter ? ` (${accountFilter.length} accounts)` : ''}...`);
      emitNexusState?.({ wpeSyncProgress: { active: true, current: 0, total: 0, currentSite: '', phase: 'metadata' } });
      let result;
      try {
        result = await deps.wpeSyncService?.syncAllWPESites(limit, 0, accountFilter);
      } finally {
        emitNexusState?.({ wpeSyncProgress: null });
      }
      localLogger.info(`[NexusAI] WPE sync completed: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`);

      auditLogger.logSuccess(
        'wpe_sync_all',
        'all_installs',
        'wpe_install',
        { synced: result.synced, failed: result.failed, limit },
        Date.now() - startTime,
      );

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      localLogger.error('[NexusAI] WPE sync failed:', errorMsg, errorStack);
      auditLogger.logFailure(
        'wpe_sync_all',
        'all_installs',
        'wpe_install',
        errorMsg,
        options || {},
        Date.now() - startTime,
      );
      return { success: false, error: errorMsg };
    }
  });

  /**
   * Get current sync progress
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_STATUS, async () => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const progress = deps.wpeSyncService.getProgress();
      return { success: true, progress };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_SYNC_STOP, () => {
    if (!deps.wpeSyncService) return { success: false, error: 'Sync service not available' };
    deps.wpeSyncService?.stopSync();
    return { success: true };
  });

  /**
   * Get WPE sync summary stats from graph DB for dashboard display
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_STATS, async () => {
    try {
      const db = graphService.getDb();
      if (!db) return { success: true, stats: null };

      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeSyncIntervalHours?: number } | null;
      const thresholdHours = settings?.wpeSyncIntervalHours ?? 8;
      const cutoff = Date.now() - thresholdHours * 60 * 60 * 1000;

      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN wp_version IS NOT NULL THEN 1 ELSE 0 END) as has_wp_version,
          SUM(CASE WHEN php_version IS NOT NULL THEN 1 ELSE 0 END) as has_php_version,
          MAX(last_sync_at) as last_sync_at,
          SUM(CASE WHEN last_sync_at >= ? THEN 1 ELSE 0 END) as fresh_count,
          SUM(CASE WHEN last_sync_at IS NULL OR last_sync_at < ? THEN 1 ELSE 0 END) as stale_count
        FROM sites WHERE source = 'wpe'
      `).get(cutoff, cutoff) as {
        total: number; has_wp_version: number; has_php_version: number;
        last_sync_at: number | null; fresh_count: number; stale_count: number;
      } | undefined;

      return { success: true, stats: row ?? null, thresholdHours };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_CAPI_SYNC, async () => {
    if (!deps.wpeSyncService) return { success: false, error: 'Sync service not available' };
    try {
      const result = await deps.wpeSyncService.syncFromCAPI();
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get list of synced WPE sites
   */
  safeHandle(IPC_CHANNELS.WPE_GET_SYNCED_SITES, async () => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const sites = await deps.wpeSyncService.getSyncedWPESites();

      // Enrich sites with account_id from CAPI if available
      let wpeAuthError = false;
      if (localServicesBridge.isCAPIAvailable()) {
        try {
          const installs = await localServicesBridge.capiGetInstalls() as any[];
          const installMap = new Map(installs.map((i: any) => [i.id, i.account?.id]));

          sites.forEach((site: any) => {
            const accountId = installMap.get(site.remote_install_id);
            if (accountId) {
              site.account_id = accountId;
            }
          });
        } catch (err) {
          const status = (err as any)?.response?.status;
          if (status === 401 || status === 403) {
            wpeAuthError = true;
          } else {
            localLogger.warn?.('[NexusAI] Failed to enrich sites with account_id:', String(err));
          }
        }
      }

      return { success: true, sites, wpeAuthError };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get synced WPE sites:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Get details for a specific WPE site
   */
  safeHandle(IPC_CHANNELS.WPE_GET_SITE_DETAILS, async (_event: any, installId: string) => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const validated = validateInput(WpeInstallIdSchema, installId);

      const sites = await deps.wpeSyncService.getSyncedWPESites();
      // installId could be:
      // - Full ID: "wpe-myinstprod"
      // - Stripped ID: "myinstprod"
      // - Install ID: "myinstprod"
      const site = sites.find((s: any) =>
        s.id === validated ||
        s.id === `wpe-${validated}` ||
        s.remote_install_id === validated ||
        s.install_id === validated
      );

      if (!site) {
        localLogger.warn?.(`[NexusAI] WPE site not found: ${validated}. Available sites:`, sites.map((s: any) => s.id));
        return { success: false, error: `Site not found: ${validated}` };
      }

      return { success: true, site };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get WPE site details:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Re-sync a single WPE site
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_SINGLE, async (_event: any, params: { installId: string }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const validated = validateInput(WpeSyncSingleSchema, params);
      let installId = validated.installId;

      // If looks like a name (not a UUID), resolve to UUID via graph
      const isUuid = /^[0-9a-f-]{36}$/i.test(installId);
      if (!isUuid) {
        const db = graphService.getDb();
        if (db) {
          const row = db.prepare(
            "SELECT remote_install_id FROM sites WHERE source='wpe' AND name=? LIMIT 1"
          ).get(installId) as { remote_install_id: string } | undefined;
          if (row?.remote_install_id) {
            installId = row.remote_install_id;
          } else {
            return { success: false, error: `Install "${installId}" not found in graph. Run Sync All first.` };
          }
        }
      }

      await deps.wpeSyncService?.syncSingleSite(installId);

      auditLogger.logSuccess(
        'wpe_sync_single',
        installId,
        'wpe_install',
        {},
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Re-synced WPE site: ${installId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to re-sync WPE site:', (err as Error).message);
      auditLogger.logFailure(
        'wpe_sync_single',
        params?.installId || 'unknown',
        'wpe_install',
        (err as Error).message,
        params,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Run diagnostics on a WPE site
   */
  safeHandle(IPC_CHANNELS.WPE_DIAGNOSE_SITE, async (_event: any, installId: string) => {
    try {
      // Validate input
      const validated = validateInput(WpeInstallIdSchema, installId);

      // TODO: Call wpe_diagnose_site MCP tool when available
      // For now, return placeholder diagnostics
      const diagnostics = {
        sslStatus: 'active',
        backupStatus: 'recent',
        diskUsage: { used: 2.5, limit: 10, percentage: 25 },
        bandwidthUsage: { used: 150, limit: 500, percentage: 30 },
        cacheStatus: 'enabled',
        phpVersion: '8.1',
      };

      void validated; // used for validation only
      return { success: true, diagnostics };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to diagnose WPE site:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Remove a WPE site from the graph
   */
  safeHandle(IPC_CHANNELS.WPE_REMOVE_SITE, async (_event: any, params: { installId: string }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const validated = validateInput(WpeRemoveSiteSchema, params);
      const installId = validated.installId;

      await deps.wpeSyncService.removeWPESite(installId);

      auditLogger.logSuccess(
        'wpe_remove_site',
        installId,
        'wpe_install',
        {},
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Removed WPE site: ${installId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to remove WPE site:', (err as Error).message);
      auditLogger.logFailure(
        'wpe_remove_site',
        params?.installId || 'unknown',
        'wpe_install',
        (err as Error).message,
        params,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  // ── WPE content indexing — standalone (no metadata sync) ──────────────────
  // Indexes all active WPE installs via SSH WP-CLI → embeds → stores in vector DB.
  safeHandle(IPC_CHANNELS.INDEX_ALL_FLEET, async () => {
    try {
      if (!deps.wpeSyncService) {
        return { success: false, error: 'WPE sync service not available' };
      }
      const result = await deps.wpeSyncService.indexAllWpeContent();
      localLogger.info(`[NexusAI] INDEX_ALL_FLEET complete: ${result.indexed} indexed, ${result.errors} errors`);
      return { success: true, indexed: result.indexed, errors: result.errors };
    } catch (err) {
      localLogger.error('[NexusAI] INDEX_ALL_FLEET failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });
}
