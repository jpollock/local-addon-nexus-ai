/**
 * Automated WPE → Local Pull Service
 *
 * Fully automates the process of pulling a WPE site to Local:
 * 1. Validates WPE authentication
 * 2. Ensures SSH key is registered with CAPI
 * 3. Creates local site
 * 4. Links to WPE environment
 * 5. Triggers pull operation (database + files)
 *
 * Handles all pre-flight checks and provides detailed error messages.
 */

import * as path from 'path';
import * as os from 'os';

interface PullToLocalArgs {
  installId: string;
  installName?: string; // Optional: will fetch from CAPI if not provided
  includeSql?: boolean; // Default: true
  environment?: 'production' | 'staging' | 'development'; // Default: production
}

interface PullResult {
  success: boolean;
  siteId?: string;
  siteName?: string;
  error?: string;
  errorCode?: 'WPE_AUTH_REQUIRED' | 'SSH_KEY_SETUP_REQUIRED' | 'INSTALL_NOT_FOUND' | 'SITE_EXISTS' | 'PULL_FAILED' | 'UNKNOWN';
  message?: string;
}

export class WpeAutoPullService {
  private services: any;

  constructor(services: any) {
    this.services = services;
  }

  /**
   * Safe service accessor (matches LocalServicesBridge pattern)
   */
  private svc(name: string): any {
    try {
      return this.services[name];
    } catch {
      return null;
    }
  }

  /**
   * Main entry point: Pull a WPE install to Local with full automation
   */
  async pullToLocal(args: PullToLocalArgs): Promise<PullResult> {
    const { installId, includeSql = true, environment = 'production' } = args;

    try {
      // Step 0: Pre-flight checks
      console.log('[WpeAutoPull] Starting pre-flight checks...');
      await this.validateAuthentication();
      await this.ensureSSHKeyRegistered();

      // Step 1: Get WPE install details
      console.log(`[WpeAutoPull] Fetching install details for ${installId}...`);
      const installDetails = await this.getInstallDetails(installId, args.installName);

      if (!installDetails) {
        return {
          success: false,
          errorCode: 'INSTALL_NOT_FOUND',
          message: `Install ${installId} not found in your WPE account`,
        };
      }

      const { installName, wpeSiteId, wpePrimaryDomain, installEnvironment } = installDetails;

      // Step 2: Check if site already exists locally
      const existingSite = this.findLocalSiteByName(installName);
      if (existingSite) {
        return {
          success: false,
          errorCode: 'SITE_EXISTS',
          message: `Site "${installName}" already exists locally (ID: ${existingSite.id})`,
          siteId: existingSite.id,
          siteName: installName,
        };
      }

      // Step 3: Create local site
      console.log(`[WpeAutoPull] Creating local site: ${installName}...`);
      const newSite = await this.createLocalSite(installName);

      // Step 4: Start the site (required for pull to work)
      console.log(`[WpeAutoPull] Starting site ${newSite.id}...`);
      await this.startSite(newSite.id);

      // Wait for site to be fully running
      await this.waitForSiteStatus(newSite.id, 'running', 30000);

      // Step 5: Link to WPE environment
      console.log(`[WpeAutoPull] Linking to WPE: ${installName} (${installEnvironment})...`);
      this.linkSiteToWpe(newSite.id, {
        wpeSiteId,
        environment: installEnvironment,
        installName,
        installId,
        primaryDomain: wpePrimaryDomain,
      });

      // Step 6: Trigger pull operation
      console.log(`[WpeAutoPull] Starting pull operation...`);
      await this.executePull({
        localSiteId: newSite.id,
        wpengineInstallName: installName,
        wpengineInstallId: installId,
        wpengineSiteId: wpeSiteId,
        wpenginePrimaryDomain: wpePrimaryDomain,
        includeSql,
      });

      console.log(`[WpeAutoPull] Pull completed successfully for ${installName}`);

      return {
        success: true,
        siteId: newSite.id,
        siteName: installName,
        message: `Successfully pulled ${installName} from WP Engine`,
      };

    } catch (error: any) {
      console.error('[WpeAutoPull] Pull failed:', error);

      // Map known errors to user-friendly messages
      if (error.errorCode) {
        return {
          success: false,
          errorCode: error.errorCode,
          message: error.message,
        };
      }

      return {
        success: false,
        errorCode: 'UNKNOWN',
        error: error.message,
        message: `Pull failed: ${error.message}`,
      };
    }
  }

  /**
   * Step 0a: Validate WPE authentication
   */
  private async validateAuthentication(): Promise<void> {
    const capi = this.svc('capi');

    if (!capi) {
      throw this.createError(
        'WPE_AUTH_REQUIRED',
        'WP Engine service not available. Please restart Local.',
      );
    }

    try {
      // Try to get current user - this will fail if not authenticated
      const currentUser = await capi.getCurrentUser();

      if (!currentUser || !currentUser.id) {
        throw this.createError(
          'WPE_AUTH_REQUIRED',
          'Not authenticated with WP Engine. Please sign in: Local → Connect → WP Engine',
        );
      }

      console.log(`[WpeAutoPull] Authenticated as: ${currentUser.email || currentUser.id}`);
    } catch (error: any) {
      if (error.errorCode === 'WPE_AUTH_REQUIRED') throw error;

      // CAPI errors usually mean not authenticated or token expired
      throw this.createError(
        'WPE_AUTH_REQUIRED',
        `WP Engine authentication failed: ${error.message}. Please sign in via Local → Connect → WP Engine`,
      );
    }
  }

  /**
   * Step 0b: Ensure SSH key exists and is registered with CAPI
   */
  private async ensureSSHKeyRegistered(): Promise<void> {
    const sshKey = this.svc('sshKey');
    const capi = this.svc('capi');

    try {
      // Check if local SSH key exists
      const fingerprint = await sshKey.getSSHKeyFingerprint();

      if (!fingerprint) {
        console.log('[WpeAutoPull] No SSH key found, generating new key...');

        // Generate new SSH key
        const hostname = os.hostname();
        await sshKey.generateSSHKey(`Local Connect for ${hostname}`.substring(0, 60));

        // Get the newly generated key
        const publicKey = await sshKey.getSSHPublicKey();

        if (!publicKey) {
          throw new Error('Failed to generate SSH key');
        }

        // Register with CAPI
        console.log('[WpeAutoPull] Registering SSH key with WP Engine...');
        await capi.createSshKey(publicKey);

        // Wait for CAPI propagation
        await this.sleep(2000);

        console.log('[WpeAutoPull] SSH key registered successfully');
        return;
      }

      // Key exists - check if registered with CAPI
      console.log('[WpeAutoPull] Checking SSH key registration...');
      const registeredKeys = await capi.listSshKeys();
      const isRegistered = registeredKeys?.some((key: any) => key.fingerprint === fingerprint);

      if (!isRegistered) {
        console.log('[WpeAutoPull] SSH key not registered, uploading to WPE...');

        const publicKey = await sshKey.getSSHPublicKey();

        if (!publicKey) {
          throw new Error('SSH key exists but could not read public key');
        }

        await capi.createSshKey(publicKey);

        // Wait for CAPI propagation
        await this.sleep(2000);

        console.log('[WpeAutoPull] SSH key registered successfully');
      } else {
        console.log('[WpeAutoPull] SSH key already registered');
      }

    } catch (error: any) {
      // Check if error is due to duplicate key (already registered)
      if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
        console.log('[WpeAutoPull] SSH key already registered (duplicate error ignored)');
        return;
      }

      throw this.createError(
        'SSH_KEY_SETUP_REQUIRED',
        `SSH key setup failed: ${error.message}. Try doing one manual pull in Local first.`,
      );
    }
  }

  /**
   * Step 1: Get WPE install details from CAPI
   */
  private async getInstallDetails(installId: string, providedName?: string) {
    const capi = this.svc('capi');

    try {
      const install = await capi.getInstall(installId);

      if (!install) {
        return null;
      }

      return {
        installName: providedName || install.name,
        installId: install.id,
        wpeSiteId: install.site?.id || install.siteId,
        wpePrimaryDomain: install.primaryDomain || install.cname || `${install.name}.wpengine.com`,
        installEnvironment: install.environment || 'production',
      };
    } catch (error: any) {
      console.error('[WpeAutoPull] Failed to fetch install:', error);
      return null;
    }
  }

  /**
   * Step 2: Check if site already exists locally
   */
  private findLocalSiteByName(name: string): any | null {
    const siteData = this.svc('siteData');
    const sites = siteData.getSites();

    for (const site of Object.values(sites)) {
      if ((site as any).name === name) {
        return site;
      }
    }

    return null;
  }

  /**
   * Step 3: Create local site
   */
  private async createLocalSite(name: string): Promise<any> {
    const addSite = this.svc('addSite');

    try {
      // Use Local's addSite service to create the site
      const site = await addSite.addSite({
        newSiteInfo: {
          siteName: name,
          siteDomain: `${name}.local`,
          sitePath: path.join(
            os.homedir(),
            'Local Sites',
            name,
          ),
        },
        // Use default services (latest PHP, nginx, MySQL)
        goToSite: false,
        installWP: true,
        wpCredentials: {
          adminUsername: 'admin',
          adminPassword: 'admin',
          adminEmail: 'admin@localhost.local',
        },
      });

      console.log(`[WpeAutoPull] Created site: ${site.id}`);
      return site;

    } catch (error: any) {
      throw new Error(`Failed to create local site: ${error.message}`);
    }
  }

  /**
   * Step 4: Start the site
   */
  private async startSite(siteId: string): Promise<void> {
    const siteProcessManager = this.svc('siteProcessManager');
    const siteData = this.svc('siteData');
    const site = siteData.getSite(siteId);

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    try {
      await siteProcessManager.start(site);
    } catch (error: any) {
      throw new Error(`Failed to start site: ${error.message}`);
    }
  }

  /**
   * Wait for site to reach a specific status
   */
  private async waitForSiteStatus(siteId: string, targetStatus: string, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    const siteProcessManager = this.svc('siteProcessManager');
    const siteData = this.svc('siteData');

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const site = siteData.getSite(siteId);
        
        if (!site) {
          reject(new Error(`Site ${siteId} not found`));
          return;
        }

        // Get status using the same method as LocalServicesBridge
        const status = siteProcessManager.getSiteStatus(site);
        
        console.log(`[WpeAutoPull] Checking site status: ${status} (waiting for ${targetStatus})`);

        if (status === targetStatus) {
          console.log(`[WpeAutoPull] Site ${siteId} reached status: ${targetStatus}`);
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for site to reach status: ${targetStatus}. Current status: ${status}`));
          return;
        }

        setTimeout(checkStatus, 1000);
      };

      checkStatus();
    });
  }

  /**
   * Step 5: Link site to WPE environment
   */
  private linkSiteToWpe(siteId: string, wpeDetails: {
    wpeSiteId: string;
    environment: string;
    installName: string;
    installId: string;
    primaryDomain: string;
  }): void {
    const siteData = this.svc('siteData');

    siteData.updateSite(siteId, {
      hostConnections: [{
        hostId: 'wpe',
        remoteSiteId: wpeDetails.wpeSiteId,
        remoteSiteEnv: wpeDetails.environment,
        // Store additional metadata for future use
        installName: wpeDetails.installName,
        installId: wpeDetails.installId,
        primaryDomain: wpeDetails.primaryDomain,
      }],
    });

    console.log(`[WpeAutoPull] Linked site ${siteId} to WPE: ${wpeDetails.installName} (${wpeDetails.environment})`);
  }

  /**
   * Step 6: Execute pull operation using Local's WPEPullService
   */
  private async executePull(args: {
    localSiteId: string;
    wpengineInstallName: string;
    wpengineInstallId: string;
    wpengineSiteId: string;
    wpenginePrimaryDomain: string;
    includeSql: boolean;
  }): Promise<void> {
    const wpePull = this.svc('wpePull');

    try {
      // Call Local's native pull service
      await wpePull.pull({
        localSiteId: args.localSiteId,
        wpengineInstallName: args.wpengineInstallName,
        wpengineInstallId: args.wpengineInstallId,
        wpengineSiteId: args.wpengineSiteId,
        wpenginePrimaryDomain: args.wpenginePrimaryDomain,
        includeSql: args.includeSql,
        requiresProvisioning: false, // Already provisioned
      });

    } catch (error: any) {
      throw this.createError(
        'PULL_FAILED',
        `Pull operation failed: ${error.message}`,
      );
    }
  }

  /**
   * Helper: Create error with code
   */
  private createError(code: string, message: string): Error {
    const error = new Error(message) as any;
    error.errorCode = code;
    return error;
  }

  /**
   * Helper: Sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
