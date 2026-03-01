import type { LocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import type { SiteDataAccessor } from '../../../src/main/mcp/types';

export interface StubBridgeConfig {
  /** Whether CAPI is available */
  capiAvailable?: boolean;
  /** Override site statuses: siteId -> status */
  siteStatuses?: Record<string, string>;
  /** Default status for sites not in siteStatuses */
  defaultStatus?: string;
}

/**
 * Creates a configurable stub LocalServicesBridge for integration tests.
 * All methods are functional but don't interact with real Local services.
 */
export function createStubBridge(
  siteData: SiteDataAccessor,
  config: StubBridgeConfig = {},
): LocalServicesBridge {
  const {
    capiAvailable = false,
    siteStatuses = {},
    defaultStatus = 'running',
  } = config;

  return {
    async startSite(_siteId: string) { /* stub */ },
    async stopSite(_siteId: string) { /* stub */ },
    async restartSite(_siteId: string) { /* stub */ },

    getSiteStatus(siteId: string): string {
      return siteStatuses[siteId] ?? defaultStatus;
    },

    getAllSiteStatuses(): Record<string, string> {
      const sites = siteData.getSites();
      const result: Record<string, string> = {};
      for (const id of Object.keys(sites)) {
        result[id] = siteStatuses[id] ?? defaultStatus;
      }
      return result;
    },

    async createSite(opts: any) {
      return {
        id: `stub-${Date.now()}`,
        name: opts.name,
        domain: `${opts.name.toLowerCase().replace(/\s+/g, '-')}.local`,
      };
    },

    async deleteSite(_siteId: string, _trashFiles: boolean) { /* stub */ },

    async cloneSite(_siteId: string, newName: string) {
      return { id: `stub-clone-${Date.now()}`, name: newName };
    },

    async exportSite(_siteId: string, _outputPath: string) {
      return '/tmp/stub-export.zip';
    },

    async wpCliRun(_siteId: string, args: string[]) {
      return { stdout: `[stub] wp ${args.join(' ')}`, stderr: '', code: 0 };
    },

    async wpCliRunJson<T = unknown>() {
      return [] as unknown as T;
    },

    async getPlugins() {
      return [
        { name: 'Hello Dolly', slug: 'hello-dolly', version: '1.7.2', isActive: true, description: 'A greeting plugin' },
        { name: 'Akismet', slug: 'akismet', version: '5.3', isActive: false, description: 'Spam protection' },
      ];
    },

    async getThemes() {
      return [
        { name: 'Twenty Twenty-Four', slug: 'twentytwentyfour', version: '1.0', isActive: true, isChildTheme: false },
      ];
    },

    async getWpVersion() { return '6.4'; },
    async getOption(_siteId: string, option: string) { return option === 'blogname' ? 'Test Site' : null; },
    async dumpDatabase(siteId: string) { return `/tmp/${siteId}-dump.sql`; },

    async capiGetAccounts() { return []; },
    async capiGetInstalls() { return []; },
    async capiGetInstall() { return null; },
    async capiCreateBackup() { return { status: 'stub' }; },
    async capiPurgeCache() { return { status: 'stub' }; },
    isCAPIAvailable() { return capiAvailable; },

    async trustCert() { /* stub */ },
    async getAvailablePhpVersions() { return ['8.1', '8.2', '8.3']; },
    resolveSiteObject(id: string) { return siteData.getSite(id); },
  } as unknown as LocalServicesBridge;
}
