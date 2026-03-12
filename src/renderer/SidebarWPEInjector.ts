/**
 * Sidebar WPE Injector
 *
 * Injects WPE sites into Local's Sites sidebar and adds badges to all sites.
 *
 * Strategy:
 * 1. Fetch WPE sites from backend
 * 2. Inject WPE site items into sidebar DOM (after local sites)
 * 3. Add badges to ALL sites (local + WPE) showing: WP version, PHP version, WPE status, index status
 * 4. Handle clicks on WPE sites → navigate to /main/site-info-wpe/{installId}
 *
 * Uses MutationObserver to detect sidebar changes and re-inject as needed.
 */

import { IPC_CHANNELS } from '../common/constants';

const STYLE_ID = 'nexus-wpe-sidebar-styles';
const WPE_SECTION_ID = 'nexus-wpe-sites-section';

interface BadgeConfig {
  type: 'wpe-connected' | 'wpe-remote' | 'wp' | 'php' | 'indexed-yes' | 'indexed-no';
  text: string;
  title?: string;
}

export class SidebarWPEInjector {
  private electron: any;
  private observer: MutationObserver | null = null;
  private injected: boolean = false;
  private wpeSites: any[] = [];
  private localSites: any[] = [];
  private accounts: any[] = [];
  private indexedSiteIds: Set<string> = new Set();
  private isCollapsed: boolean = false;
  private expandedAccounts: Set<string> = new Set();
  private expandedSites: Set<string> = new Set();

  constructor(electron: any) {
    this.electron = electron;
  }

  async initialize(): Promise<void> {
    console.log('[SidebarWPEInjector] Initializing...');

    try {
      await this.loadData();
      this.injectStyles();
      this.tryInject();
      this.startObserver();

      // Listen for badge refresh requests (e.g., after search filter changes)
      document.addEventListener('nexus:badges-refresh', () => {
        console.log('[SidebarWPEInjector] Badge refresh requested - removing all badges first');
        // Remove all existing badges before re-injecting
        document.querySelectorAll('.nexus-badge').forEach(badge => badge.remove());
        this.tryInject();
      });

      // Refresh data periodically
      setInterval(() => this.loadData(), 30000); // Every 30 seconds
      console.log('[SidebarWPEInjector] Initialization complete');
    } catch (error) {
      console.error('[SidebarWPEInjector] Initialization failed:', error);
      // Continue anyway - don't block the renderer
    }
  }

  private async loadData(): Promise<void> {
    try {
      console.log('[SidebarWPEInjector] Loading data...');

      // Fetch local sites
      console.log('[SidebarWPEInjector] Fetching local sites...');
      const localSitesResult = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SITES);
      this.localSites = localSitesResult || [];
      console.log('[SidebarWPEInjector] Local sites loaded:', this.localSites.length);

      // Fetch WPE accounts
      console.log('[SidebarWPEInjector] Fetching WPE accounts...');
      const accountsResult = await this.electron.ipcRenderer.invoke('capi:get-accounts');
      this.accounts = accountsResult || [];
      console.log('[SidebarWPEInjector] WPE accounts loaded:', this.accounts.length);

      // Fetch WPE sites
      console.log('[SidebarWPEInjector] Fetching WPE sites...');
      const wpeSitesResult = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES);
      this.wpeSites = wpeSitesResult?.sites || [];
      console.log('[SidebarWPEInjector] WPE sites loaded:', this.wpeSites.length);

      // Fetch index status
      console.log('[SidebarWPEInjector] Fetching index status...');
      const indexEntries = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_FLEET_STATUS);
      // GET_FLEET_STATUS returns an array of IndexEntry objects directly
      this.indexedSiteIds = new Set((indexEntries || []).map((e: any) => e.siteId));
      console.log('[SidebarWPEInjector] Index status loaded:', this.indexedSiteIds.size);

      // Auto-expand first account on initial load
      if (this.accounts.length > 0 && this.expandedAccounts.size === 0) {
        this.expandedAccounts.add(this.accounts[0].id);
      }

      console.log('[SidebarWPEInjector] Data load complete');

      // Re-inject if already injected
      if (this.injected) {
        this.tryInject();
      }
    } catch (error) {
      console.error('[SidebarWPEInjector] Failed to load data:', error);
      throw error; // Re-throw to be caught by initialize()
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Separator line before WPE sites section */
      .nexus-wpe-separator {
        height: 1px;
        background-color: var(--color-neutral-20, rgba(0, 0, 0, 0.1));
        margin: 8px 0;
      }

      /* Header wrapper hover effect */
      .nexus-wpe-header-wrapper:hover {
        opacity: 0.8;
      }

      /* Badge styles - matching SidebarBadgeManager pattern */
      .nexus-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 14px;
        padding: 0 4px;
        margin-left: 4px;
        border-radius: 3px;
        font-size: 8px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0.5px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .nexus-badge-wpe-connected {
        background-color: #0ECAD4;
        color: #fff;
      }

      .nexus-badge-wpe-remote {
        background-color: #0ECAD4;
        color: #fff;
      }

      .nexus-badge-wp,
      .nexus-badge-php {
        background-color: #6b7280;
        color: #fff;
      }

      .nexus-badge-indexed-yes {
        background-color: #10b981;
        color: #fff;
      }

      .nexus-badge-indexed-no {
        background-color: #6b7280;
        color: #fff;
      }

      /* WPE site link styling */
      .nexus-wpe-site-link {
        text-decoration: none !important;
        display: flex;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        border-left: 3px solid transparent;
        transition: border-left-color 0.15s;
        color: inherit !important;
        width: 100%;
        box-sizing: border-box;
      }

      /* Remove link color styling */
      .nexus-wpe-site-link:visited,
      .nexus-wpe-site-link:link,
      .nexus-wpe-site-link:active {
        color: inherit !important;
      }

      /* Simple hover - just show the border accent */
      .nexus-wpe-site-link:hover {
        border-left-color: #0ECAD4;
      }

      .nexus-wpe-site-link:hover .TID_SiteListSite_Span_SiteName {
        color: inherit !important;
      }

      /* Cloud icon for WPE sites */
      .nexus-wpe-cloud-icon {
        font-size: 10px;
        margin-right: 6px;
        opacity: 0.6;
      }

      /* Tree view styles */
      .nexus-tree-account-row:hover,
      .nexus-tree-site-row:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .nexus-tree-install-link {
        transition: background 0.15s ease;
      }

      .nexus-tree-install-link:visited,
      .nexus-tree-install-link:link,
      .nexus-tree-install-link:active {
        color: rgba(255, 255, 255, 0.75) !important;
      }
    `;
    document.head.appendChild(style);
  }

  private tryInject(): void {
    this.addBadgesToLocalSites();
    this.injectWPESites();
  }

  /**
   * Add badges to existing local sites in the sidebar
   */
  private addBadgesToLocalSites(): void {
    // Find all site items in Local's sidebar
    // Local uses [data-site-id] attribute for each site
    const siteElements = document.querySelectorAll('[data-site-id]');

    console.log('[SidebarWPEInjector] Found', siteElements.length, 'site elements with [data-site-id]');

    let badgedCount = 0;
    siteElements.forEach((element) => {
      const siteId = element.getAttribute('data-site-id');
      if (!siteId || siteId.startsWith('wpe-')) return; // Skip WPE sites (we'll handle those separately)

      // Find the site data
      const site = this.localSites.find(s => s.id === siteId);
      if (!site) return;

      // Check if badges already exist - don't re-add to prevent infinite observer loop
      if (element.querySelector('.nexus-badge')) return;

      // Find the site name element (per Local's SiteListSite component)
      const nameElement = element.querySelector('.TID_SiteListSite_Span_SiteName');
      const parentElement = nameElement?.parentElement;

      if (!nameElement || !parentElement) return;

      // Build badges
      const badges = this.buildBadgesForLocalSite(site);

      // Inject badges as SIBLINGS after the name span (not as children)
      // Insert in reverse order so they appear in the correct order
      badges.reverse().forEach(badge => {
        const badgeEl = document.createElement('span');
        badgeEl.className = `nexus-badge nexus-badge-${badge.type}`;
        badgeEl.textContent = badge.text;
        if (badge.title) badgeEl.title = badge.title;

        // Insert as sibling after name element
        parentElement.insertBefore(badgeEl, nameElement.nextSibling);
      });

      badgedCount++;
    });

    console.log('[SidebarWPEInjector] Added badges to', badgedCount, 'local sites');
  }

  /**
   * Extract base site name from install name
   * E.g., "acflikebutton-prod" → "acflikebutton"
   */
  private extractSiteName(installName: string, environment: string): string {
    const envSuffixes = ['-prod', '-production', '-stg', '-staging', '-dev', '-development'];

    for (const suffix of envSuffixes) {
      if (installName.endsWith(suffix)) {
        return installName.slice(0, -suffix.length);
      }
    }

    if (environment !== 'production') {
      const regex = new RegExp(`[-_]?${environment}$`, 'i');
      const match = installName.match(regex);
      if (match) {
        return installName.slice(0, match.index);
      }
    }

    return installName;
  }

  /**
   * Build tree structure: Account → Site → Install[]
   */
  private buildTree() {
    const tree = new Map<string, Map<string, any[]>>();

    // Group sites by account
    const sitesByAccount = new Map<string, any[]>();
    this.wpeSites.forEach((site) => {
      const accountId = site.account_id || site.accountId || 'unknown';
      if (!sitesByAccount.has(accountId)) {
        sitesByAccount.set(accountId, []);
      }
      sitesByAccount.get(accountId)!.push(site);
    });

    // Build tree for each account
    this.accounts.forEach((account) => {
      const accountSites = sitesByAccount.get(account.id) || [];

      // Group installs by site name
      const installsBySiteName = new Map<string, any[]>();
      accountSites.forEach((install) => {
        const siteName = this.extractSiteName(install.name, install.environment || 'production');
        if (!installsBySiteName.has(siteName)) {
          installsBySiteName.set(siteName, []);
        }
        installsBySiteName.get(siteName)!.push(install);
      });

      tree.set(account.id, installsBySiteName);
    });

    return tree;
  }

  /**
   * Inject WPE sites into the sidebar (grouped tree view)
   */
  private injectWPESites(): void {
    console.log('[SidebarWPEInjector] injectWPESites() called, wpeSites.length:', this.wpeSites.length);

    if (this.wpeSites.length === 0 || this.accounts.length === 0) {
      console.log('[SidebarWPEInjector] No WPE sites/accounts to inject');
      return;
    }

    const siteListNav = document.getElementById('SiteList');
    if (!siteListNav) {
      console.warn('[SidebarWPEInjector] Could not find #SiteList nav element');
      return;
    }

    // Remove existing WPE section
    const existingSection = document.getElementById(WPE_SECTION_ID);
    if (existingSection) {
      existingSection.remove();
    }

    // Build tree structure
    const tree = this.buildTree();

    // Create WPE sites section
    const wpeSection = document.createElement('div');
    wpeSection.id = WPE_SECTION_ID;

    // Add separator
    const separator = document.createElement('div');
    separator.className = 'nexus-wpe-separator';
    wpeSection.appendChild(separator);

    // Main header
    const headerWrapper = document.createElement('div');
    headerWrapper.className = 'nexus-wpe-header-wrapper';
    headerWrapper.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 12px 8px 12px;
      cursor: pointer;
      user-select: none;
    `;

    const headerText = document.createElement('div');
    headerText.className = 'SiteListGroupHeader_Name';
    headerText.style.padding = '0';
    headerText.textContent = `WP Engine Sites (${this.accounts.length} accounts)`;

    const collapseIcon = document.createElement('span');
    collapseIcon.className = 'nexus-wpe-collapse-icon';
    collapseIcon.textContent = this.isCollapsed ? '›' : '⌄';
    collapseIcon.style.cssText = `font-size: 14px; opacity: 0.6;`;

    headerWrapper.appendChild(headerText);
    headerWrapper.appendChild(collapseIcon);
    wpeSection.appendChild(headerWrapper);

    // Tree container
    const treeContainer = document.createElement('div');
    treeContainer.className = 'nexus-wpe-tree-container';
    treeContainer.style.display = this.isCollapsed ? 'none' : 'block';

    // Render each account
    this.accounts.forEach((account) => {
      const sitesMap = tree.get(account.id);
      if (!sitesMap || sitesMap.size === 0) return;

      const totalInstalls = Array.from(sitesMap.values()).reduce((sum, installs) => sum + installs.length, 0);

      // Account row
      const accountRow = this.createAccountRow(account, sitesMap.size, totalInstalls);
      treeContainer.appendChild(accountRow);

      // Sites under this account (if expanded)
      if (this.expandedAccounts.has(account.id)) {
        sitesMap.forEach((installs, siteName) => {
          const siteRow = this.createSiteRow(siteName, installs, account.id);
          treeContainer.appendChild(siteRow);

          // Installs under this site (if expanded)
          const siteKey = `${account.id}:${siteName}`;
          if (this.expandedSites.has(siteKey)) {
            installs.forEach((install) => {
              const installRow = this.createInstallRow(install);
              treeContainer.appendChild(installRow);
            });
          }
        });
      }
    });

    wpeSection.appendChild(treeContainer);

    // Toggle main section
    headerWrapper.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      treeContainer.style.display = this.isCollapsed ? 'none' : 'block';
      collapseIcon.textContent = this.isCollapsed ? '›' : '⌄';
    });

    siteListNav.appendChild(wpeSection);
    this.injected = true;

    console.log('[SidebarWPEInjector] Injected tree with', this.accounts.length, 'accounts');
  }

  /**
   * Create account row (level 1 of tree)
   */
  private createAccountRow(account: any, siteCount: number, installCount: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'nexus-tree-account-row';
    row.style.cssText = `
      display: flex;
      align-items: center;
      padding: 6px 12px 6px 24px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
    `;

    const isExpanded = this.expandedAccounts.has(account.id);
    const icon = document.createElement('span');
    icon.textContent = isExpanded ? '▼' : '▶';
    icon.style.cssText = `margin-right: 6px; font-size: 10px; opacity: 0.7;`;

    const name = document.createElement('span');
    name.textContent = account.name;
    name.style.fontWeight = '500';

    const meta = document.createElement('span');
    meta.textContent = ` (${siteCount} sites, ${installCount} installs)`;
    meta.style.cssText = `margin-left: 4px; opacity: 0.6; font-size: 12px;`;

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener('click', () => {
      if (this.expandedAccounts.has(account.id)) {
        this.expandedAccounts.delete(account.id);
      } else {
        this.expandedAccounts.add(account.id);
      }
      this.tryInject();
    });

    return row;
  }

  /**
   * Create site row (level 2 of tree)
   */
  private createSiteRow(siteName: string, installs: any[], accountId: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'nexus-tree-site-row';
    row.style.cssText = `
      display: flex;
      align-items: center;
      padding: 5px 12px 5px 40px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.85);
    `;

    const siteKey = `${accountId}:${siteName}`;
    const isExpanded = this.expandedSites.has(siteKey);
    const icon = document.createElement('span');
    icon.textContent = isExpanded ? '▼' : '▶';
    icon.style.cssText = `margin-right: 6px; font-size: 9px; opacity: 0.6;`;

    const name = document.createElement('span');
    name.textContent = siteName;

    const meta = document.createElement('span');
    meta.textContent = ` (${installs.length} env${installs.length === 1 ? '' : 's'})`;
    meta.style.cssText = `margin-left: 4px; opacity: 0.5; font-size: 11px;`;

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(meta);

    row.addEventListener('click', () => {
      if (this.expandedSites.has(siteKey)) {
        this.expandedSites.delete(siteKey);
      } else {
        this.expandedSites.add(siteKey);
      }
      this.tryInject();
    });

    return row;
  }

  /**
   * Create install row (level 3 of tree - actual sites)
   */
  private createInstallRow(install: any): HTMLElement {
    const link = document.createElement('a');
    link.className = 'nexus-tree-install-link';
    link.style.cssText = `
      display: flex;
      align-items: center;
      padding: 4px 12px 4px 56px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.75);
      text-decoration: none;
      cursor: pointer;
      gap: 6px;
    `;

    const siteId = install.id || `wpe-${install.remote_install_id}`;
    link.setAttribute('data-site-id', siteId);

    // Environment name
    const env = document.createElement('span');
    env.textContent = install.environment || 'production';
    env.style.flexShrink = '0';

    link.appendChild(env);

    // Badges
    const badges = this.buildBadgesForWPESite(install);
    badges.forEach((badge, index) => {
      const badgeEl = document.createElement('span');
      badgeEl.className = `nexus-badge nexus-badge-${badge.type}`;
      badgeEl.textContent = badge.text;
      if (badge.title) badgeEl.title = badge.title;
      if (index === 0) badgeEl.style.marginLeft = 'auto';
      link.appendChild(badgeEl);
    });

    // Click handler
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const installId = install.id || install.remote_install_id || install.install_id;
      window.location.hash = `#/main/site-info-wpe/${installId}`;
    });

    // Hover effect
    link.addEventListener('mouseenter', () => {
      link.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    link.addEventListener('mouseleave', () => {
      link.style.background = '';
    });

    return link;
  }

  /**
   * Create a WPE site item element matching Local's native structure
   * (DEPRECATED - kept for backwards compatibility but not used in tree view)
   */
  private createWPESiteItem(site: any): HTMLElement {
    // Main link element (matches Local's NavLink structure)
    const link = document.createElement('a');
    link.className = 'nexus-wpe-site-link';

    const siteId = site.id || `wpe-${site.remote_install_id}`;
    link.setAttribute('data-site-id', siteId);
    link.setAttribute('data-site-name', site.name);

    // Cloud icon prefix (simple, minimal)
    const cloudIcon = document.createElement('span');
    cloudIcon.className = 'nexus-wpe-cloud-icon';
    cloudIcon.textContent = '☁️';
    cloudIcon.title = 'Remote WP Engine site';
    cloudIcon.style.flexShrink = '0'; // Don't allow icon to shrink

    // Site name span - use Local's class, let it handle theming
    const nameSpan = document.createElement('span');
    nameSpan.className = 'TID_SiteListSite_Span_SiteName';
    nameSpan.textContent = site.name || site.install_name || 'Unknown Site';
    nameSpan.style.flexShrink = '0'; // Don't allow name to shrink
    nameSpan.style.flexGrow = '0'; // Don't allow name to grow

    // Assemble: cloud + name
    link.appendChild(cloudIcon);
    link.appendChild(nameSpan);

    // Add badges to the right side (append to link container)
    const badges = this.buildBadgesForWPESite(site);
    badges.forEach((badge, index) => {
      const badgeEl = document.createElement('span');
      badgeEl.className = `nexus-badge nexus-badge-${badge.type}`;
      badgeEl.textContent = badge.text;
      if (badge.title) badgeEl.title = badge.title;

      // First badge gets auto margin to push to right
      if (index === 0) {
        badgeEl.style.marginLeft = 'auto';
      }

      link.appendChild(badgeEl);
    });

    // Click handler → navigate to WPE site info
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const installId = site.id?.replace(/^wpe-/, '') || site.remote_install_id;
      window.location.hash = `#/main/site-info-wpe/${installId}`;
    });

    // Right-click → Pull to Local
    link.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const installId = site.id?.replace(/^wpe-/, '') || site.remote_install_id;

      if (confirm(`Pull "${site.name}" from WP Engine to Local?\n\nThis will create a new local site and download all files and database.`)) {
        this.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_PULL_TO_LOCAL, { installId })
          .then((result: any) => {
            if (result.success) {
              alert(`✓ Pull initiated!\n\nSite: ${result.siteName}\n\nCheck Local for progress.`);
            } else {
              alert(`✗ Failed: ${result.error || result.message}`);
            }
          })
          .catch((error: any) => {
            alert(`✗ Error: ${error.message}`);
          });
      }
    });

    return link;
  }

  /**
   * Build badges for a local site
   */
  private buildBadgesForLocalSite(site: any): BadgeConfig[] {
    const badges: BadgeConfig[] = [];

    // WPE Connection Badge (highest priority)
    if (site.isWpe && site.wpeInstallId) {
      badges.push({
        type: 'wpe-connected',
        text: 'WPE',
        title: 'Connected to WP Engine',
      });
    }

    // WP Version Badge
    if (site.wpVersion) {
      badges.push({
        type: 'wp',
        text: site.wpVersion,
        title: `WordPress ${site.wpVersion}`,
      });
    }

    // PHP Version Badge
    if (site.phpVersion) {
      badges.push({
        type: 'php',
        text: site.phpVersion,
        title: `PHP ${site.phpVersion}`,
      });
    }

    // Index Status Badge
    const isIndexed = this.indexedSiteIds.has(site.id);
    badges.push({
      type: isIndexed ? 'indexed-yes' : 'indexed-no',
      text: isIndexed ? '✓' : '○',
      title: isIndexed ? 'Indexed' : 'Not indexed',
    });

    return badges;
  }

  /**
   * Build badges for a WPE site
   */
  private buildBadgesForWPESite(site: any): BadgeConfig[] {
    const badges: BadgeConfig[] = [];

    // No WPE badge needed - section header already indicates these are WPE sites

    // WP Version Badge
    if (site.wp_version) {
      badges.push({
        type: 'wp',
        text: site.wp_version,
        title: `WordPress ${site.wp_version}`,
      });
    }

    // PHP Badge - not available for WPE sites (omit)

    // Index Status Badge (if indexed via remote sync)
    // site.id should be in format "wpe-{installId}"
    const siteId = site.id || `wpe-${site.remote_install_id}`;
    const isIndexed = this.indexedSiteIds.has(siteId);
    badges.push({
      type: isIndexed ? 'indexed-yes' : 'indexed-no',
      text: isIndexed ? '✓' : '○',
      title: isIndexed ? 'Indexed' : 'Not indexed',
    });

    return badges;
  }

  /**
   * Start observing for sidebar changes
   */
  private startObserver(): void {
    if (this.observer) return;

    // Debounce the observer to prevent infinite loops
    let timeout: NodeJS.Timeout | null = null;

    this.observer = new MutationObserver(() => {
      if (timeout) clearTimeout(timeout);

      timeout = setTimeout(() => {
        // Check if WPE section disappeared and needs re-injection
        const wpeSection = document.getElementById(WPE_SECTION_ID);
        if (!wpeSection && this.wpeSites.length > 0) {
          console.log('[SidebarWPEInjector] WPE section disappeared, re-injecting');
          this.injected = false;
          this.injectWPESites();
        }

        // Check if local site badges need to be added (for newly rendered sites)
        this.addBadgesToLocalSites();
      }, 100); // 100ms debounce
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    document.getElementById(WPE_SECTION_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    // Remove all badges
    document.querySelectorAll('.nexus-badge').forEach(el => el.remove());
  }
}
