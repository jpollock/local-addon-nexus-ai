/**
 * Typed facade over Local's raw service container.
 *
 * Each method wraps a service container call with error handling and
 * site object resolution. Easily mockable for testing.
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';

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

export interface WpCliRunOpts {
  /** When false, plugins are loaded during WP-CLI execution. Default: true (skip). */
  skipPlugins?: boolean;
  /** When false, themes are loaded during WP-CLI execution. Default: true (skip). */
  skipThemes?: boolean;
}

export interface CreateSiteOpts {
  name: string;
  phpVersion?: string;
  webServer?: string;
}

export interface WpeInstallInfo {
  installName: string;
  installId: string;
  remoteSiteId: string;
  primaryDomain: string;
  environment?: string;
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
  wpCliRun(siteId: string, args: string[], opts?: WpCliRunOpts): Promise<WpCliResult>;
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

  // Remote WP-CLI (via SSH to WP Engine)
  remoteWpCliRun(installName: string, args: string[]): Promise<WpCliResult>;
  resolveWpeInstall(siteId: string): Promise<WpeInstallInfo | null>;
  isSSHKeyAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createLocalServicesBridge(serviceContainer: any): LocalServicesBridge {
  // Access services lazily via helper to avoid Awilix resolution errors
  // for services that may not exist in every Local build.
  function svc(name: string): any {
    try {
      return serviceContainer[name];
    } catch {
      return null;
    }
  }

  function requireSite(siteId: string): any {
    const site = svc('siteData').getSite(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }
    return site;
  }

  return {
    // --- Site Process Management ---

    async startSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await svc('siteProcessManager').start(site);
    },

    async stopSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await svc('siteProcessManager').stop(site);
    },

    async restartSite(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      await svc('siteProcessManager').restart(site);
    },

    getSiteStatus(siteId: string): string {
      const site = requireSite(siteId);
      return svc('siteProcessManager').getSiteStatus(site) ?? 'unknown';
    },

    getAllSiteStatuses(): Record<string, string> {
      return svc('siteProcessManager').getSiteStatuses();
    },

    // --- Site CRUD ---

    async createSite(opts: CreateSiteOpts): Promise<{ id: string; name: string; domain: string }> {
      // Resolve the default sites directory (e.g. ~/Local Sites/)
      const defaultSettings = {
        sitesPath: '~/Local Sites/',
        ...(svc('userData')?.get?.('settings-new-site-defaults', {}) ?? {}),
      };
      const sitesPath = defaultSettings.sitesPath.replace(/^~/, os.homedir());

      // Format site nicename: strip special chars, replace spaces with dashes, lowercase
      const niceName = opts.name
        .replace(/[^a-z0-9\s-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

      const siteDomain = `${niceName}.local`;
      const sitePath = path.join(sitesPath, niceName);

      const newSiteInfo: any = {
        siteName: opts.name,
        siteDomain,
        sitePath,
      };
      if (opts.phpVersion) newSiteInfo.phpVersion = opts.phpVersion;
      if (opts.webServer) newSiteInfo.webServer = opts.webServer;

      const site = await svc('addSite').addSite({
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
      await svc('deleteSite').deleteSite({ site, trashFiles, updateHosts: true });
    },

    async cloneSite(siteId: string, newName: string): Promise<{ id: string; name: string }> {
      const site = requireSite(siteId);
      const cloned = await svc('cloneSite').cloneSite({ site, newSiteName: newName });
      return { id: cloned.id, name: cloned.name };
    },

    async exportSite(siteId: string, outputPath: string): Promise<string> {
      const site = requireSite(siteId);
      const exportService = svc('exportSite');
      if (exportService?.exportSite) {
        return await exportService.exportSite({ site, outputPath });
      }
      throw new Error('Export service not available');
    },

    // --- WP-CLI ---

    async wpCliRun(siteId: string, args: string[], opts?: WpCliRunOpts): Promise<WpCliResult> {
      const site = requireSite(siteId);
      try {
        const stdout = await svc('wpCli').run(site, args, opts);
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
      const plugins = await svc('wpCli').getPlugins(site);
      return plugins ?? [];
    },

    async getThemes(siteId: string): Promise<WpTheme[]> {
      const site = requireSite(siteId);
      const themes = await svc('wpCli').getThemes(site);
      return themes ?? [];
    },

    async getWpVersion(siteId: string): Promise<string | null> {
      const site = requireSite(siteId);
      return svc('wpCli').getWpVersion(site);
    },

    async getOption(siteId: string, option: string): Promise<string | null> {
      const site = requireSite(siteId);
      return svc('wpCli').getOption(site, option);
    },

    // --- Database ---

    async dumpDatabase(siteId: string, destination?: string): Promise<string> {
      const site = requireSite(siteId);
      return svc('siteDatabase').dump(site, destination);
    },

    // --- CAPI (WP Engine) ---

    capiGetAccounts: async () => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.getAccountList();
    },

    capiGetInstalls: async () => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.getInstallList();
    },

    capiGetInstall: async (installId: string) => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.getInstall(installId);
    },

    capiCreateBackup: async (installId: string, description: string) => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.createBackup(installId, description);
    },

    capiPurgeCache: async (installId: string) => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.purgeCache(installId, 'all');
    },

    isCAPIAvailable(): boolean {
      return !!svc('capi');
    },

    // --- SSL ---

    async trustCert(siteId: string): Promise<void> {
      const site = requireSite(siteId);
      const certService = svc('x509CertService');
      if (certService?.trustCert) {
        await certService.trustCert(site);
      } else {
        throw new Error('SSL certificate service not available');
      }
    },

    // --- Lightning Services ---

    async getAvailablePhpVersions(): Promise<string[]> {
      const ls = svc('lightningServices');
      if (!ls?.getAvailableServices) return [];
      const services = await ls.getAvailableServices('php');
      if (Array.isArray(services)) {
        return services.map((s: any) => s.version ?? s.name ?? String(s));
      }
      return [];
    },

    // --- Raw access ---

    resolveSiteObject(siteId: string): unknown {
      return requireSite(siteId);
    },

    // --- Remote WP-CLI (via SSH to WP Engine) ---

    async remoteWpCliRun(installName: string, args: string[]): Promise<WpCliResult> {
      // Shell-escape each argument to prevent command injection
      const escapeShellArg = (arg: string): string => {
        // Replace single quotes with '\'' (close quote, escaped quote, open quote)
        // This is the safest way to escape for SSH which uses sh/bash
        return `'${arg.replace(/'/g, "'\\''")}'`;
      };

      // Build WP-CLI command with individually escaped arguments
      const escapedArgs = args.map(escapeShellArg);
      const wpCommand = `wp --skip-plugins --skip-themes ${escapedArgs.join(' ')}`;

      // SSH key path: {userDataPath}/ssh/wpe-connect
      const userDataPath = (process as any).electronPaths?.userDataPath
        ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local');
      const sshKeyPath = path.join(userDataPath, 'ssh', 'wpe-connect');

      const username = `local+ssh+${installName}`;
      const host = `${installName}.ssh.wpengine.net`;

      const sshArgs = [
        '-F', '/dev/null',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=120',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-i', sshKeyPath,
        `${username}@${host}`,
        wpCommand,
      ];

      return new Promise<WpCliResult>((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn('ssh', sshArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000,
        });

        proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', (code: number | null) => {
          if (code === 0) {
            resolve({ stdout, success: true });
          } else {
            resolve({ stdout: stderr || `SSH exited with code ${code}`, success: false });
          }
        });

        proc.on('error', (err: Error) => {
          resolve({ stdout: err.message, success: false });
        });
      });
    },

    async resolveWpeInstall(siteId: string): Promise<WpeInstallInfo | null> {
      const site = requireSite(siteId) as any;

      // Find WPE host connection
      const connections = site.hostConnections;
      if (!connections) return null;

      // hostConnections can be an object keyed by ID or an array
      const connList = Array.isArray(connections) ? connections : Object.values(connections);
      const wpeConn = (connList as any[]).find(
        (c: any) => c.hostId === 'wpe' || c.accountId,
      );
      if (!wpeConn) return null;

      const remoteSiteId = wpeConn.remoteSiteId;
      if (!remoteSiteId) return null;

      // Resolve install name via CAPI
      const capi = svc('capi');
      if (!capi) return null;

      try {
        const installs = await capi.getInstallList();
        if (!installs) return null;

        const match = (installs as any[]).find(
          (i: any) =>
            i.site?.id === remoteSiteId &&
            (!wpeConn.remoteSiteEnv || i.environment === wpeConn.remoteSiteEnv),
        );

        if (!match) return null;

        return {
          installName: match.name,
          installId: match.id,
          remoteSiteId,
          primaryDomain: match.primaryDomain ?? match.cname ?? `${match.name}.wpengine.com`,
          environment: match.environment ?? wpeConn.remoteSiteEnv,
        };
      } catch {
        return null;
      }
    },

    isSSHKeyAvailable(): boolean {
      const userDataPath = (process as any).electronPaths?.userDataPath
        ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local');
      const sshKeyPath = path.join(userDataPath, 'ssh', 'wpe-connect');
      return fs.existsSync(sshKeyPath);
    },
  };
}
