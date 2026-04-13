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
  /** Timeout in ms. Default: 120000 (2 min). Use higher for slow operations like plugin update. */
  timeoutMs?: number;
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
  updateSite(siteId: string, updates: Record<string, any>): void;
  importSite(zipPath: string, siteName?: string): Promise<{ id: string; name: string }>;

  // Blueprints
  getBlueprints?(): Promise<Array<{ id: string; name: string; description?: string; createdAt?: string }>>;
  saveBlueprint?(siteId: string, opts: { name: string; description?: string }): Promise<{ id: string }>;

  // WPE Connect
  listModifications?(args: {
    localSiteId: string;
    wpengineInstallName: string;
    wpengineInstallId: string;
    wpengineSiteId: string;
    wpenginePrimaryDomain: string;
    direction: 'push' | 'pull';
  }): Promise<Array<{ path: string; instruction: string }>>;
  getSyncHistory?(siteId: string): Promise<Array<{
    direction: 'push' | 'pull';
    remoteInstallName?: string;
    environment?: string;
    status?: string;
    timestamp: number;
  }>>;

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
  capiGetSites(): Promise<unknown>;
  capiGetInstalls(): Promise<unknown>;
  capiGetInstall(installId: string): Promise<unknown>;
  capiCreateBackup(installId: string, description: string, notificationEmails?: string[]): Promise<unknown>;
  capiDirect(path: string, method?: string, body?: unknown): Promise<unknown>;
  capiPurgeCache(installId: string): Promise<unknown>;
  isCAPIAvailable(): boolean;
  isWPEAuthenticated(): boolean;
  wpeAuthenticate(): Promise<{ email?: string } | null>;
  wpeLogout(): Promise<void>;
  wpeGetUserInfo(): Promise<{ email?: string; accountName?: string } | null>;
  getWpeUserId(): string | null;
  wpeSetApiCredentials(username: string, password: string): Promise<void>;
  wpeClearApiCredentials(): Promise<void>;
  wpeGetApiCredentialsStatus(): Promise<{ configured: boolean; username?: string }>;

  // SSL
  trustCert(siteId: string): Promise<void>;

  // Lightning Services
  getAvailablePhpVersions(): Promise<string[]>;

  // Site Groups (Local native)
  getSiteGroups(): Array<{ id: string; name: string; siteIds: string[]; index: number }>;
  createSiteGroup(name: string, siteIds?: string[]): { id: string; name: string; siteIds: string[]; index: number };
  deleteSiteGroup(groupId: string): void;
  renameSiteGroup(groupId: string, name: string): { id: string; name: string; siteIds: string[]; index: number };
  moveSitesToGroup(siteIds: string[], groupId: string): void;
  removeSitesFromGroups(siteIds: string[]): void;

  // Full site object (for advanced operations)
  resolveSiteObject(siteId: string): unknown;

  // Remote WP-CLI (via SSH to WP Engine)
  remoteWpCliRun(installName: string, args: string[], opts?: { skipPlugins?: boolean }): Promise<WpCliResult>;
  resolveWpeInstall(siteId: string): Promise<WpeInstallInfo | null>;
  isSSHKeyAvailable(): boolean;

  // WPE Sync (Pull/Push)
  wpePull?: {
    pull(args: {
      includeSql?: boolean;
      wpengineInstallName: string;
      wpengineInstallId: string;
      wpengineSiteId: string;
      wpenginePrimaryDomain: string;
      localSiteId: string;
      environment?: string;
      files?: string[];
      isMagicSync?: boolean;
    }): Promise<void>;
  };
  wpePush?: {
    push(args: {
      includeSql?: boolean;
      wpengineInstallName: string;
      wpengineInstallId: string;
      wpengineSiteId: string;
      wpenginePrimaryDomain: string;
      localSiteId: string;
      environment?: string;
      files?: string[];
      isMagicSync?: boolean;
    }): Promise<void>;
  };
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
      if (!exportService?.exportSite) {
        throw new Error('Export service not available');
      }

      // Expand ~ to home directory (Node does not do this automatically)
      const expandedPath = outputPath.startsWith('~')
        ? path.join(os.homedir(), outputPath.slice(1))
        : outputPath;

      // Create the parent directory if it doesn't exist
      // Use path.dirname() — expandedPath is the full file path, not a directory
      try {
        fs.mkdirSync(path.dirname(expandedPath), { recursive: true });
      } catch { /* ignore if already exists */ }

      // filter='' causes picomatch to fail on empty string pattern.
      // Pass a valid but no-op pattern so ignoredPatterns.split(',') produces
      // ['__noop__'] — a glob that matches nothing in a WP install.

      // ExportSiteService.exportSite() returns Promise<void>, not the path.
      const exportPath = expandedPath.replace(/\.zip$/i, '') + '.zip';

      // Fire the export (this is async and uses a worker process)
      await exportService.exportSite({ site, outputPath: expandedPath, filter: '__noop__' });

      // Return the path where the export will be saved
      return exportPath;
    },

    updateSite(siteId: string, updates: Record<string, any>): void {
      const siteData = svc('siteData');
      if (!siteData?.updateSite) {
        throw new Error('Site update service not available');
      }
      siteData.updateSite(siteId, updates);
    },

    async importSite(zipPath: string, siteName?: string): Promise<{ id: string; name: string }> {
      const importService = svc('importSite');
      if (!importService?.run) {
        throw new Error('Import site service not available');
      }

      const derivedName = siteName || path.basename(zipPath, '.zip').replace(/[^a-zA-Z0-9-_]/g, '-');

      const importSettings = {
        importType: 'localExport',
        zipPath: zipPath,
        siteName: derivedName,
      };

      const result = await importService.run(importSettings);
      return { id: result.id || '', name: result.name || derivedName };
    },

    // --- Blueprints ---

    getBlueprints() {
      const blueprints = svc('blueprints');
      if (!blueprints?.getBlueprints) {
        return Promise.resolve(undefined);
      }
      return blueprints.getBlueprints();
    },

    saveBlueprint(siteId: string, opts: { name: string; description?: string }) {
      const site = requireSite(siteId);
      const blueprints = svc('blueprints');
      if (!blueprints?.saveBlueprint) {
        return Promise.resolve(undefined);
      }
      // filter: '__noop__' avoids the ignoredPatterns.split('') → picomatch('') crash
      // that occurs when filter is undefined or empty string (same bug as local_export_site)
      return blueprints.saveBlueprint({ siteId: site.id, name: opts.name, filter: '__noop__' });
    },

    // --- WPE Connect ---

    listModifications(args: {
      localSiteId: string;
      wpengineInstallName: string;
      wpengineInstallId: string;
      wpengineSiteId: string;
      wpenginePrimaryDomain: string;
      direction: 'push' | 'pull';
    }) {
      const wpeConnectBase = svc('wpeConnectBase');
      if (!wpeConnectBase?.listModifications) {
        return Promise.resolve(undefined);
      }
      return wpeConnectBase.listModifications({
        connectArgs: {
          wpengineInstallName: args.wpengineInstallName,
          wpengineInstallId: args.wpengineInstallId,
          wpengineSiteId: args.wpengineSiteId,
          wpenginePrimaryDomain: args.wpenginePrimaryDomain,
          localSiteId: args.localSiteId,
        },
        direction: args.direction,
      });
    },

    getSyncHistory(siteId: string) {
      const connectHistory = svc('connectHistory');
      if (!connectHistory?.getEvents) {
        return Promise.resolve(undefined);
      }
      return connectHistory.getEvents(siteId);
    },

    // --- WP-CLI ---

    async wpCliRun(siteId: string, args: string[], opts?: WpCliRunOpts): Promise<WpCliResult> {
      const site = requireSite(siteId);
      const timeoutMs = opts?.timeoutMs ?? 120000; // 2 min default; plugin updates can be slow
      try {
        const runPromise = svc('wpCli').run(site, args, opts);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`WP-CLI timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        );
        const stdout = await Promise.race([runPromise, timeoutPromise]);
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

    capiDirect: async (path: string, method = 'GET', body?: unknown) => {
      const wpeOAuth = svc('wpeOAuth');
      if (!wpeOAuth) throw new Error('WPE OAuth service not available');
      const token = await wpeOAuth.getAccessToken();
      if (!token) throw new Error('Not authenticated with WP Engine. Run: nexus wpe login');
      const url = `https://api.wpengineapi.com/v1${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`CAPI ${method} ${path} failed: HTTP ${res.status}`);
      return res.json();
    },

    capiGetAccounts: async () => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.getAccountList();
    },

    capiGetSites: async () => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.getSiteList();
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

    capiCreateBackup: async (installId: string, description: string, notificationEmails?: string[]) => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');

      // Check if basic auth credentials are configured
      const userData = svc('userData');
      let credentials: { username?: string; password?: string } | null = null;

      if (userData) {
        try {
          credentials = await userData.get('wpeApiCredentials');
        } catch {
          // Ignore errors reading credentials
        }
      }

      // If credentials exist, use basic auth instead of OAuth
      if (credentials?.username && credentials?.password) {
        const url = `https://api.wpengineapi.com/v1/installs/${installId}/backups`;
        const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

        const emails = notificationEmails && notificationEmails.length > 0
          ? notificationEmails
          : ['no-reply@wpengine.com'];

        const requestBody = {
          description,
          notification_emails: emails,  // WP Engine REST API expects snake_case, not camelCase
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Backup creation failed: HTTP ${res.status} - ${errorText}`);
        }

        return res.json();
      }

      // Use OAuth via the CAPI client
      try {
        return await capi.createBackup(installId, description);
      } catch (err: any) {
        if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
          throw new Error(
            'Backup creation failed: WP Engine returned 401 Unauthorized. ' +
            'Your OAuth session may have expired — run: nexus wpe login\n' +
            'Or store API credentials as a fallback: wpe_set_api_credentials'
          );
        }
        throw err;
      }
    },

    capiPurgeCache: async (installId: string) => {
      const capi = svc('capi');
      if (!capi) throw new Error('CAPI not available');
      return capi.purgeCache(installId, 'all');
    },

    isCAPIAvailable(): boolean {
      return !!svc('capi');
    },

    isWPEAuthenticated(): boolean {
      const wpeOAuth = svc('wpeOAuth');
      if (!wpeOAuth) return false;

      // Load stored token into memory first — _accessToken is null after restart
      // even when valid credentials exist in userData.
      try { (wpeOAuth as any)._loadFromUserData?.(); } catch { /* non-fatal */ }

      return !!(wpeOAuth as any)._accessToken;
    },

    async wpeAuthenticate(): Promise<{ email?: string } | null> {
      const wpeOAuth = svc('wpeOAuth');
      if (!wpeOAuth) throw new Error('WPE OAuth service not available');

      // Authenticate - this triggers OAuth flow
      await wpeOAuth.authenticate();

      // After auth, tokens should already be in memory from _storeTokens()
      // Don't call _loadFromUserData() - it can fail if userData encryption is broken

      const userInfo = await svc('capi')?._getUserInfo?.();
      return { email: userInfo?.wpeEmail ?? userInfo?.email ?? undefined };
    },

    async wpeLogout(): Promise<void> {
      const wpeOAuth = svc('wpeOAuth');
      if (!wpeOAuth) throw new Error('WPE OAuth service not available');
      await wpeOAuth.clearTokens();
    },

    async wpeGetUserInfo(): Promise<{ email?: string; accountName?: string } | null> {
      const wpeOAuth = svc('wpeOAuth');
      if (!wpeOAuth) return null;
      // Only check in-memory token - do NOT access userData (causes decryption crashes)
      const hasToken = !!(wpeOAuth as any)._accessToken;
      if (!hasToken) return null;
      // Try to get user info — _getUserInfo is private but accessible at runtime
      try {
        const userInfo = await svc('capi')?._getUserInfo?.();
        return {
          email: userInfo?.wpeEmail ?? userInfo?.email ?? undefined,
          accountName: userInfo?.accountName ?? undefined,
        };
      } catch {
        // Authenticated but couldn't get user details — still return something
        return { email: undefined, accountName: undefined };
      }
    },

    getWpeUserId(): string | null {
      // Do NOT access userData - it causes decryption crashes
      // User ID is not available from in-memory tokens, so return null
      // This is acceptable - userId is only used for hostConnections metadata
      return null;
    },

    // --- WPE API Credentials (for basic auth fallback) ---

    async wpeSetApiCredentials(username: string, password: string): Promise<void> {
      const userData = svc('userData');
      if (!userData) throw new Error('User data service not available');

      await userData.set({
        name: 'wpeApiCredentials',
        data: { username, password },
        encrypted: true,
      });
    },

    async wpeClearApiCredentials(): Promise<void> {
      const userData = svc('userData');
      if (!userData) throw new Error('User data service not available');

      // Local's userData has no delete — overwrite with null to clear
      await userData.set({ name: 'wpeApiCredentials', data: null, encrypted: false });
    },

    async wpeGetApiCredentialsStatus(): Promise<{ configured: boolean; username?: string }> {
      const userData = svc('userData');
      if (!userData) return { configured: false };

      try {
        const creds = await userData.get('wpeApiCredentials');
        if (creds?.username && creds?.password) {
          return { configured: true, username: creds.username };
        }
        return { configured: false };
      } catch {
        return { configured: false };
      }
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

    // --- Site Groups (Local native — via SitesOrganizationService) ---

    getSiteGroups(): Array<{ id: string; name: string; siteIds: string[]; index: number }> {
      const org = svc('sitesOrganization');
      if (!org?.getSiteGroups) return [];
      const groups = org.getSiteGroups();
      return (groups ?? []).map((g: any) => ({
        id: g.id,
        name: g.name,
        siteIds: g.siteIds ?? [],
        index: g.index ?? 0,
      }));
    },

    createSiteGroup(name: string, siteIds?: string[]): { id: string; name: string; siteIds: string[]; index: number } {
      const org = svc('sitesOrganization');
      if (!org?.createSiteGroup) throw new Error('Site groups not available');
      const g = org.createSiteGroup(name, siteIds);
      return { id: g.id, name: g.name, siteIds: g.siteIds ?? [], index: g.index ?? 0 };
    },

    deleteSiteGroup(groupId: string): void {
      const org = svc('sitesOrganization');
      if (!org?.deleteSiteGroup) throw new Error('Site groups not available');
      org.deleteSiteGroup(groupId);
    },

    renameSiteGroup(groupId: string, name: string): { id: string; name: string; siteIds: string[]; index: number } {
      const org = svc('sitesOrganization');
      if (!org?.renameSiteGroup) throw new Error('Site groups not available');
      const g = org.renameSiteGroup(groupId, name);
      return { id: g.id, name: g.name, siteIds: g.siteIds ?? [], index: g.index ?? 0 };
    },

    moveSitesToGroup(siteIds: string[], groupId: string): void {
      const org = svc('sitesOrganization');
      if (!org?.moveSitesToGroup) throw new Error('Site groups not available');
      org.moveSitesToGroup(siteIds, groupId, true);
    },

    removeSitesFromGroups(siteIds: string[]): void {
      const org = svc('sitesOrganization');
      if (!org?.deleteSitesFromGroups) throw new Error('Site groups not available');
      org.deleteSitesFromGroups(siteIds, true);
    },

    // --- Raw access ---

    resolveSiteObject(siteId: string): unknown {
      return requireSite(siteId);
    },

    // --- Remote WP-CLI (via SSH to WP Engine) ---

    async remoteWpCliRun(installName: string, args: string[], opts?: { skipPlugins?: boolean }): Promise<WpCliResult> {
      // Shell-escape each argument to prevent command injection
      const escapeShellArg = (arg: string): string => {
        // Replace single quotes with '\'' (close quote, escaped quote, open quote)
        // This is the safest way to escape for SSH which uses sh/bash
        return `'${arg.replace(/'/g, "'\\''")}'`;
      };

      // Build WP-CLI command — skip plugins/themes by default for speed/safety,
      // but allow content extraction to load plugins (needed for custom post types)
      const skipFlags = opts?.skipPlugins === false ? '' : '--skip-plugins --skip-themes';
      const escapedArgs = args.map(escapeShellArg);
      const wpCommand = `wp ${skipFlags} ${escapedArgs.join(' ')}`.trim();

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
        // ControlMaster: reuse SSH connections to reduce overhead
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPath=/tmp/ssh-nexus-%C',
        '-o', 'ControlPersist=30s',
        '-i', sshKeyPath,
        `${username}@${host}`,
        wpCommand,
      ];

      return new Promise<WpCliResult>((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn('ssh', sshArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          // 35s: WPE SSH cold-start variance is 13-30s depending on server load,
          // DB size, and PHP process warmth. Subsequent calls via ControlMaster
          // complete in 1-3s. Truly unreachable sites fail immediately with DNS
          // error regardless of timeout.
          timeout: 35000,
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

    // --- WPE Sync (Pull/Push) ---
    // These are optional services provided by Local

    get wpePull() {
      return svc('wpePull') ?? undefined;
    },

    get wpePush() {
      return svc('wpePush') ?? undefined;
    },
  };
}
