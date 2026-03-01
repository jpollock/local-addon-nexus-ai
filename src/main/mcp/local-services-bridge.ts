/**
 * Typed facade over Local's raw service container.
 *
 * Each method wraps a service container call with error handling and
 * site object resolution. Easily mockable for testing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WpCliResult {
  stdout: string | null;
  success: boolean;
}

export interface WpPlugin {
  name: string;
  title: string;
  version: string;
  status: string;
  file?: string;
}

export interface WpTheme {
  name: string;
  title: string;
  version: string;
  status: string;
}

export interface CreateSiteOpts {
  name: string;
  phpVersion?: string;
  webServer?: string;
}

export interface LocalServicesBridge {
  // Site Process Management
  startSite(siteId: string): Promise<void>;
  stopSite(siteId: string): Promise<void>;
  restartSite(siteId: string): Promise<void>;
  getSiteStatus(siteId: string): string;
  getAllSiteStatuses(): Record<string, string>;

  // Site CRUD
  createSite(opts: CreateSiteOpts): Promise<{ id: string; name: string; domain: string }>;
  deleteSite(siteId: string, trashFiles: boolean): Promise<void>;
  cloneSite(siteId: string, newName: string): Promise<{ id: string; name: string }>;
  exportSite(siteId: string, outputPath: string): Promise<string>;

  // WP-CLI
  wpCliRun(siteId: string, args: string[]): Promise<WpCliResult>;
  getPlugins(siteId: string): Promise<WpPlugin[]>;
  getThemes(siteId: string): Promise<WpTheme[]>;
  getWpVersion(siteId: string): Promise<string | null>;
  getOption(siteId: string, option: string): Promise<string | null>;

  // Database
  dumpDatabase(siteId: string, destination?: string): Promise<string>;

  // CAPI (WP Engine)
  capiGetAccounts(): Promise<unknown>;
  capiGetInstalls(): Promise<unknown>;
  capiGetInstall(installId: string): Promise<unknown>;
  capiCreateBackup(installId: string, description: string): Promise<unknown>;
  capiPurgeCache(installId: string): Promise<unknown>;
  isCAPIAvailable(): boolean;

  // SSL
  trustCert(siteId: string): Promise<void>;

  // Lightning Services
  getAvailablePhpVersions(): Promise<string[]>;

  // Full site object (for advanced operations)
  resolveSiteObject(siteId: string): unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createLocalServicesBridge(serviceContainer: any): LocalServicesBridge {
  const {
    siteData,
    siteProcessManager,
    wpCli,
    addSite,
    deleteSite: deleteSiteService,
    cloneSite: cloneSiteService,
    exportSite: exportSiteService,
    siteDatabase,
    x509CertService,
    lightningServices,
  } = serviceContainer;

  // Internal helpers to get CAPI — may not exist in all installs
  const capi = serviceContainer.capi ?? null;

  function requireSite(siteId: string): any {
    const site = siteData.getSite(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }
    return site;
  }

  return {
    // --- Site Process Management ---

    async startSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await siteProcessManager.start(site);
    },

    async stopSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await siteProcessManager.stop(site);
    },

    async restartSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await siteProcessManager.restart(site);
    },

    getSiteStatus(siteId: string): string {
      const site = requireSite(siteId);
      return siteProcessManager.getSiteStatus(site) ?? 'unknown';
    },

    getAllSiteStatuses(): Record<string, string> {
      return siteProcessManager.getSiteStatuses();
    },

    // --- Site CRUD ---

    async createSite(opts: CreateSiteOpts): Promise<{ id: string; name: string; domain: string }> {
      const newSiteInfo: any = {
        siteName: opts.name,
        siteDomain: `${opts.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.local`,
      };
      if (opts.phpVersion) newSiteInfo.phpVersion = opts.phpVersion;
      if (opts.webServer) newSiteInfo.webServer = opts.webServer;

      const site = await addSite.addSite({
        newSiteInfo,
        wpCredentials: {
          adminUsername: 'admin',
          adminPassword: 'admin',
          adminEmail: 'admin@localhost.local',
        },
        goToSite: false,
        installWP: true,
      });

      return { id: site.id, name: site.name, domain: site.domain };
    },

    async deleteSite(siteId: string, trashFiles: boolean): Promise<void> {
      const site = requireSite(siteId);
      await deleteSiteService.deleteSite({ site, trashFiles, updateHosts: true });
    },

    async cloneSite(siteId: string, newName: string): Promise<{ id: string; name: string }> {
      const site = requireSite(siteId);
      const cloned = await cloneSiteService.cloneSite({ site, newSiteName: newName });
      return { id: cloned.id, name: cloned.name };
    },

    async exportSite(siteId: string, outputPath: string): Promise<string> {
      const site = requireSite(siteId);
      if (exportSiteService?.exportSite) {
        return await exportSiteService.exportSite({ site, outputPath });
      }
      throw new Error('Export service not available');
    },

    // --- WP-CLI ---

    async wpCliRun(siteId: string, args: string[]): Promise<WpCliResult> {
      const site = requireSite(siteId);
      try {
        const stdout = await wpCli.run(site, args);
        return { stdout, success: true };
      } catch (err) {
        return {
          stdout: err instanceof Error ? err.message : String(err),
          success: false,
        };
      }
    },

    async getPlugins(siteId: string): Promise<WpPlugin[]> {
      const site = requireSite(siteId);
      const plugins = await wpCli.getPlugins(site);
      return plugins ?? [];
    },

    async getThemes(siteId: string): Promise<WpTheme[]> {
      const site = requireSite(siteId);
      const themes = await wpCli.getThemes(site);
      return themes ?? [];
    },

    async getWpVersion(siteId: string): Promise<string | null> {
      const site = requireSite(siteId);
      return wpCli.getWpVersion(site);
    },

    async getOption(siteId: string, option: string): Promise<string | null> {
      const site = requireSite(siteId);
      return wpCli.getOption(site, option);
    },

    // --- Database ---

    async dumpDatabase(siteId: string, destination?: string): Promise<string> {
      const site = requireSite(siteId);
      return siteDatabase.dump(site, destination);
    },

    // --- CAPI (WP Engine) ---

    capiGetAccounts: async () => {
      if (!capi) throw new Error('CAPI not available');
      return capi.getAccountList();
    },

    capiGetInstalls: async () => {
      if (!capi) throw new Error('CAPI not available');
      return capi.getInstallList();
    },

    capiGetInstall: async (installId: string) => {
      if (!capi) throw new Error('CAPI not available');
      return capi.getInstall(installId);
    },

    capiCreateBackup: async (installId: string, description: string) => {
      if (!capi) throw new Error('CAPI not available');
      return capi.createBackup(installId, description);
    },

    capiPurgeCache: async (installId: string) => {
      if (!capi) throw new Error('CAPI not available');
      return capi.purgeCache(installId, 'all');
    },

    isCAPIAvailable(): boolean {
      return capi !== null;
    },

    // --- SSL ---

    async trustCert(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      if (x509CertService?.trustCert) {
        await x509CertService.trustCert(site);
      } else {
        throw new Error('SSL certificate service not available');
      }
    },

    // --- Lightning Services ---

    async getAvailablePhpVersions(): Promise<string[]> {
      if (!lightningServices?.getAvailableServices) return [];
      const services = await lightningServices.getAvailableServices('php');
      if (Array.isArray(services)) {
        return services.map((s: any) => s.version ?? s.name ?? String(s));
      }
      return [];
    },

    // --- Raw access ---

    resolveSiteObject(siteId: string): unknown {
      return requireSite(siteId);
    },
  };
}
