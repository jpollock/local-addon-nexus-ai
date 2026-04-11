/**
 * CredentialSyncBroadcaster
 *
 * When a user saves or changes an API key in NexusPreferences, this service
 * immediately syncs the key to all running WordPress 7.0+ sites. Without this,
 * keys only sync on next site start (via the lifecycle hook).
 */
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { RegistryStorage } from '../content/IndexRegistry';
import type { SiteDataAccessor } from '../mcp/types';
import { autoSyncCredentials } from '../mcp/modules/wp-connector/auto-sync';
import { STORAGE_KEYS } from '../../common/constants';

export interface CredentialSyncResult {
  siteId: string;
  siteName: string;
  success: boolean;
  providers: string[];
  error?: string;
}

export interface SiteSyncStatus {
  lastSync: number | null;
  providers: string[];
  success: boolean;
  error?: string;
}

interface CredentialSyncBroadcasterDeps {
  localServices: LocalServicesBridge;
  registryStorage: RegistryStorage;
  siteData: SiteDataAccessor;
  logger: { info(...args: unknown[]): void; error(...args: unknown[]): void };
}

export class CredentialSyncBroadcaster {
  private localServices: LocalServicesBridge;
  private registryStorage: RegistryStorage;
  private siteData: SiteDataAccessor;
  private logger: CredentialSyncBroadcasterDeps['logger'];
  private syncStatusMap = new Map<string, SiteSyncStatus>();

  constructor(deps: CredentialSyncBroadcasterDeps) {
    this.localServices = deps.localServices;
    this.registryStorage = deps.registryStorage;
    this.siteData = deps.siteData;
    this.logger = deps.logger;
  }

  /**
   * Sync credentials to all running sites configured for the given provider.
   * Fires in parallel, isolates per-site errors.
   */
  async broadcastKeyChange(providerId: string): Promise<CredentialSyncResult[]> {
    const runningSites = this.getRunningSites();
    if (runningSites.length === 0) return [];

    // Only sync sites configured to use this provider directly (not via Local Gateway)
    const siteConfigs = (this.registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
    const affectedSites = runningSites.filter(site => {
      const cfg = siteConfigs[site.id];
      return cfg?.provider === providerId && !cfg?.useLocalGateway;
    });

    if (affectedSites.length === 0) {
      this.logger.info(`[NexusAI] No running sites use provider ${providerId} — skipping broadcast`);
      return [];
    }

    this.logger.info(`[NexusAI] Broadcasting ${providerId} key change to ${affectedSites.length} site(s)`);

    const results = await Promise.all(
      affectedSites.map((site) => this.syncToSite(site.id, site.name)),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    this.logger.info(`[NexusAI] Credential broadcast complete: ${succeeded} succeeded, ${failed} failed`);

    return results;
  }

  /**
   * Sync all configured keys to a single site.
   */
  async syncAllKeysToSite(siteId: string): Promise<CredentialSyncResult> {
    const site = this.siteData.getSite(siteId);
    if (!site) {
      return { siteId, siteName: 'unknown', success: false, providers: [], error: 'Site not found' };
    }
    return this.syncToSite(site.id, site.name);
  }

  /**
   * Get current sync status for all tracked sites.
   */
  getSyncStatus(): Record<string, SiteSyncStatus> {
    const result: Record<string, SiteSyncStatus> = {};
    for (const [id, status] of this.syncStatusMap) {
      result[id] = status;
    }
    return result;
  }

  private async syncToSite(siteId: string, siteName: string): Promise<CredentialSyncResult> {
    try {
      await autoSyncCredentials(
        siteId,
        siteName,
        this.localServices,
        this.registryStorage,
        this.logger,
      );

      const providers = this.getConfiguredProviders();
      this.syncStatusMap.set(siteId, {
        lastSync: Date.now(),
        providers,
        success: true,
      });

      return { siteId, siteName, success: true, providers };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.syncStatusMap.set(siteId, {
        lastSync: Date.now(),
        providers: [],
        success: false,
        error,
      });

      this.logger.error(`[NexusAI] Credential sync failed for "${siteName}":`, error);
      return { siteId, siteName, success: false, providers: [], error };
    }
  }

  private getRunningSites(): Array<{ id: string; name: string }> {
    const allSites = this.siteData.getSites();
    const statuses = this.localServices.getAllSiteStatuses();
    const running: Array<{ id: string; name: string }> = [];

    for (const [id, site] of Object.entries(allSites)) {
      const status = statuses[id];
      if (status === 'running') {
        running.push({ id, name: site.name });
      }
    }

    return running;
  }

  private getConfiguredProviders(): string[] {
    const storedKeys = (this.registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
    return Object.keys(storedKeys).filter((k) => storedKeys[k]);
  }
}
