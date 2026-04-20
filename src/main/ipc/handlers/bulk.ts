/**
 * Bulk Operation IPC Handlers
 *
 * Handles all bulk and fleet-wide operations: BULK_EXECUTE, BULK_STATUS,
 * BULK_CANCEL, BULK_LIST, and fleet shortcuts (SETUP_AI_FLEET, INDEX_ALL_FLEET,
 * SETUP_AI_ALL_AUTO, INDEX_ALL_AUTO, SYNC_GRAPH_ALL, FLEET_REFRESH_QUICK,
 * FLEET_HEALTH_CHECK_ALL, FLEET_PLUGIN_UPDATE_ALL).
 */
import { IPC_CHANNELS, STORAGE_KEYS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';
import type { IpcHandlerDeps } from '../../types/ipc-handler-deps';
import type { BulkOperationManager } from '../../bulk/BulkOperationManager';
import type { AuditLogger } from '../../audit/AuditLogger';
import {
  validateInput,
  BulkOperationRequestSchema,
  BulkOperationIdSchema,
  FleetOperationOptionsSchema,
} from '../../../common/schemas';
import { safeHandle } from '../safe-handle';

/** Extra runtime objects created in registerIpcHandlers, passed down here. */
export interface BulkHandlerContext {
  bulkOpManager: BulkOperationManager;
  auditLogger: AuditLogger;
  /** Builds a siteId→name map — call at op creation time. */
  buildSiteNames(ids?: string[]): Record<string, string>;
}

export function registerBulkHandlers(deps: IpcHandlerDeps, ctx: BulkHandlerContext): void {
  const { siteData, localServicesBridge, registryStorage, localLogger } = deps;
  const { bulkOpManager, auditLogger, buildSiteNames } = ctx;

  // ---------------------------------------------------------------------------
  // Core bulk operations
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.BULK_EXECUTE, async (_event: any, request: any) => {
    const startTime = Date.now();
    try {
      const validated = validateInput(BulkOperationRequestSchema, request);

      auditLogger.log({
        operation: `bulk_${validated.type}`,
        target: `${validated.siteIds.length} sites`,
        targetType: 'bulk_operation',
        result: 'started',
        params: { type: validated.type, siteCount: validated.siteIds.length },
        durationMs: 0,
      });

      const opId = await bulkOpManager.execute(validated);

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] bulk:execute failed:', (err as Error).message);
      auditLogger.logFailure(
        'bulk_execute',
        'multiple',
        'bulk_operation',
        (err as Error).message,
        request,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_STATUS, async (_event: any, opId: string) => {
    try {
      const validated = validateInput(BulkOperationIdSchema, opId);
      const status = bulkOpManager.getStatus(validated);
      return status ? { success: true, ...status } : { success: false, error: 'Operation not found' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_CANCEL, async (_event: any, opId: string) => {
    try {
      const validated = validateInput(BulkOperationIdSchema, opId);
      return { success: bulkOpManager.cancel(validated) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_LIST, async () => {
    return { success: true, operations: bulkOpManager.listAll() };
  });

  // ---------------------------------------------------------------------------
  // Fleet shortcuts — running sites only (no auto-start)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.SETUP_AI_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      const validated = validateInput(FleetOperationOptionsSchema, options);

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      const targetIds = validated?.siteIds
        ?? Object.keys(allSites).filter((id) => statuses[id] === 'running');

      if (targetIds.length === 0) {
        return { success: true, opId: null, message: 'No running sites to set up' };
      }

      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;

      const opId = bulkOpManager.execute({
        type: 'setup-ai',
        siteIds: targetIds,
        siteNames: buildSiteNames(targetIds),
        options: { provider: settings?.aiProvider },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] setup-ai-fleet failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.INDEX_ALL_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      const validated = validateInput(FleetOperationOptionsSchema, options);

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      const targetIds = validated?.siteIds
        ?? Object.keys(allSites).filter((id) => statuses[id] === 'running');

      if (targetIds.length === 0) {
        return { success: true, opId: null, message: 'No running sites to index' };
      }

      const opId = bulkOpManager.execute({
        type: 'reindex',
        siteIds: targetIds,
        siteNames: buildSiteNames(targetIds),
        options: {},
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] index-all-fleet failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // Auto-start/stop fleet operations — all sites (including halted)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.SETUP_AI_ALL_AUTO, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: true, opId: null, message: 'No sites to setup' };
      }

      const opId = bulkOpManager.execute({
        type: 'setup-ai',
        siteIds: allSiteIds,
        siteNames: buildSiteNames(allSiteIds),
        options: { autoStartStop: true },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] setup-ai-all-auto failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.INDEX_ALL_AUTO, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: true, opId: null, message: 'No sites to index' };
      }

      const opId = bulkOpManager.execute({
        type: 'reindex',
        siteIds: allSiteIds,
        siteNames: buildSiteNames(allSiteIds),
        options: { autoStartStop: true },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] index-all-auto failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SYNC_GRAPH_ALL, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: false, error: 'No sites to sync.' };
      }

      const opId = bulkOpManager.execute({
        type: 'sync-graph',
        siteIds: allSiteIds,
        siteNames: buildSiteNames(allSiteIds),
        options: { autoStartStop: true },
      });

      return { success: true, opId, count: allSiteIds.length };
    } catch (err) {
      localLogger.error('[NexusAI] sync-graph-all failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Quick fleet refresh — filesystem scan for halted, WP-CLI for running (no auto-start)
  safeHandle(IPC_CHANNELS.FLEET_REFRESH_QUICK, async (_event: any) => {
    try {
      const result = await deps.nexusServices?.registry?.call('nexus_fleet_refresh', {}, deps.nexusServices, 'cli');
      const text = result?.content?.[0]?.text ?? '';
      return { success: !result?.isError, message: text };
    } catch (err) {
      localLogger.error('[NexusAI] fleet-refresh-quick failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.FLEET_HEALTH_CHECK_ALL, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);
      if (allSiteIds.length === 0) return { success: true, opId: null, message: 'No sites found' };

      const opId = bulkOpManager.execute({
        type: 'health-refresh',
        siteIds: allSiteIds,
        siteNames: buildSiteNames(allSiteIds),
        options: { autoStartStop: true },
      });

      return { success: true, opId, count: allSiteIds.length };
    } catch (err) {
      localLogger.error('[NexusAI] fleet-health-check-all failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.FLEET_PLUGIN_UPDATE_ALL, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);
      if (allSiteIds.length === 0) return { success: true, opId: null, message: 'No sites found' };

      const opId = bulkOpManager.execute({
        type: 'plugin-update',
        siteIds: allSiteIds,
        siteNames: buildSiteNames(allSiteIds),
        options: { autoStartStop: true },
      });

      return { success: true, opId, count: allSiteIds.length };
    } catch (err) {
      localLogger.error('[NexusAI] fleet-plugin-update-all failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });
}
