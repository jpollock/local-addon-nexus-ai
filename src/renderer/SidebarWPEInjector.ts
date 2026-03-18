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
const TABS_CONTAINER_ID = 'nexus-sidebar-tabs';
const ACTIVE_TAB_KEY = 'nexus-active-sidebar-tab';

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
  private activeTab: 'local' | 'wpe' = 'local'; // Default to local
  private isWPEAuthenticated: boolean = false;

  constructor(electron: any) {
    this.electron = electron;
  }

  async initialize(): Promise<void> {
    console.log('[SidebarWPEInjector] Initializing...');

    try {
      // Restore saved tab state, but default to 'local' if nothing saved
      const savedTab = localStorage.getItem(ACTIVE_TAB_KEY);
      if (savedTab === 'wpe') {
        this.activeTab = 'wpe';
      } else {
        this.activeTab = 'local'; // Default to local
        localStorage.setItem(ACTIVE_TAB_KEY, 'local');
      }

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

      // Listen for WPE OAuth success (user just authenticated)
      this.electron.ipcRenderer.on('wpeOauth:success', async () => {
        console.log('[SidebarWPEInjector] WPE OAuth success - reloading data');
        await this.loadData();
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
      console.log('[SidebarWPEInjector] 🔵 About to invoke capi:get-accounts IPC handler...');
      try {
        const accountsResult = await this.electron.ipcRenderer.invoke('capi:get-accounts');
        console.log('[SidebarWPEInjector] ✓ capi:get-accounts responded:', accountsResult);

        // Check if result indicates auth failure
        if (accountsResult && accountsResult.error === 'UNAUTHORIZED') {
          console.log('[SidebarWPEInjector] WPE not authenticated');
          this.isWPEAuthenticated = false;
          this.accounts = [];
        } else {
          this.isWPEAuthenticated = true;
          this.accounts = accountsResult || [];
          console.log('[SidebarWPEInjector] WPE accounts loaded:', this.accounts.length);
          if (this.accounts.length > 0) {
            console.log('[SidebarWPEInjector] Sample account:', JSON.stringify(this.accounts[0]));
          }
        }
      } catch (err) {
        console.error('[SidebarWPEInjector] ❌ Failed to invoke capi:get-accounts:', err);
        this.isWPEAuthenticated = false;
        this.accounts = [];
      }

      // Fetch WPE sites
      console.log('[SidebarWPEInjector] Fetching WPE sites...');
      const wpeSitesResult = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES);
      this.wpeSites = wpeSitesResult?.sites || [];
      console.log('[SidebarWPEInjector] WPE sites loaded:', this.wpeSites.length);
      if (this.wpeSites.length > 0) {
        console.log('[SidebarWPEInjector] Sample WPE site:', JSON.stringify(this.wpeSites[0]).slice(0, 300));
      }

      // Fetch index status
      console.log('[SidebarWPEInjector] Fetching index status...');
      const indexEntries = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_FLEET_STATUS);
      // GET_FLEET_STATUS returns an array of IndexEntry objects directly
      this.indexedSiteIds = new Set((indexEntries || []).map((e: any) => e.siteId));
      console.log('[SidebarWPEInjector] Index status loaded:', this.indexedSiteIds.size);

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
        background-color: var(--color-border, var(--color-neutral-20, rgba(0, 0, 0, 0.1)));
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

      /* Account divider (matches Local's group dividers) */
      .nexus-account-divider {
        height: 1px;
        background-color: var(--color-border, rgba(0, 0, 0, 0.1));
        margin: 12px 0 8px 0;
      }

      /* Account header (matches Local's group header) */
      .nexus-account-header {
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary, #111);
        user-select: none;
        cursor: default;
      }

      .nexus-account-meta {
        margin-left: 6px;
        opacity: 0.5;
        font-size: 11px;
        font-weight: 400;
        color: var(--color-text-secondary, #6b7280);
      }

      /* Site name row (non-interactive sub-header) */
      .nexus-site-name-row {
        padding: 6px 16px 6px 28px;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary, #6b7280);
        user-select: none;
        cursor: default;
      }

      /* Environment row (clickable, matches Local's site items) */
      .nexus-env-link {
        display: flex;
        align-items: center;
        padding: 5px 16px 5px 44px;
        font-size: 12px;
        color: var(--color-text-secondary, #6b7280);
        text-decoration: none;
        cursor: pointer;
        transition: background 0.15s ease;
        gap: 6px;
        border-left: 3px solid transparent;
      }

      .nexus-env-link:visited,
      .nexus-env-link:link,
      .nexus-env-link:active {
        color: var(--color-text-secondary, #6b7280) !important;
      }

      .nexus-env-link:hover {
        background: var(--color-background-hover, rgba(0, 0, 0, 0.05));
        border-left-color: #0ECAD4;
      }

      .nexus-env-arrow {
        opacity: 0.4;
        margin-right: 4px;
      }

      /* Hide native "Local sites" header and its parent container */
      [class*="SiteList_Header"],
      [class*="SitesPane_Header"],
      [class*="SitesSidebar_Title"] {
        display: none !important;
      }

      /* Hide the container div that holds the title */
      div:has(> h1[class*="SitesSidebar_Title"]) {
        display: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Hide native tab elements (the "Local" label) */
      [role="tablist"],
      [class*="Tabs_TabList"],
      [class*="SitesSidebar"] [role="tab"]:not(.nexus-sidebar-tab) {
        display: none !important;
      }

      /* Hide any native tab containers */
      div:has(> [role="tablist"]) {
        display: none !important;
      }

      /* Style the moved toolbar to fit in our tabs */
      .nexus-tabs-right [class*="SitesSidebar_Toolbar"] {
        display: flex !important;
        gap: 4px !important;
        padding: 0 !important;
        margin: 0 !important;
        margin-bottom: -2px !important;
        margin-right: 8px !important;
        background: transparent !important;
        border: none !important;
        flex-shrink: 0 !important;
      }

      /* Make toolbar buttons match our styling */
      .nexus-tabs-right [class*="SitesSidebar_Toolbar"] button {
        margin: 0 !important;
        padding: 6px !important;
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        flex-shrink: 0 !important;
      }

      /* Ensure WPE sync button doesn't overlap and is hidden by default */
      .nexus-wpe-sync-btn {
        margin-left: 4px !important;
        flex-shrink: 0 !important;
      }

      /* Hide sync button explicitly when not needed */
      .nexus-wpe-sync-btn[style*="display: none"] {
        display: none !important;
      }

      /* Sidebar tabs */
      .nexus-sidebar-tabs {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 16px 16px 0 16px;
        border-bottom: 2px solid var(--color-border, #e5e7eb);
        background: var(--color-background-primary, #fff);
        position: relative;
        z-index: 10;
      }

      .nexus-tabs-left {
        display: flex;
        gap: 0;
        flex: 1;
      }

      .nexus-tabs-right {
        display: flex;
        gap: 4px;
        margin-left: auto;
        align-items: center;
        padding-right: 4px;
      }

      .nexus-sidebar-tab {
        padding: 8px 20px 12px 20px;
        border: none;
        border-bottom: 3px solid transparent;
        background: transparent;
        color: var(--color-text-secondary, #6b7280);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer !important;
        pointer-events: auto !important;
        user-select: none;
        -webkit-user-select: none;
        transition: all 0.2s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        margin-bottom: -2px;
        white-space: nowrap;
        position: relative;
        z-index: 11;
        outline: none;
      }

      .nexus-sidebar-tab * {
        pointer-events: none;
        user-select: none;
      }

      .nexus-sidebar-tab:hover:not(.active) {
        color: var(--color-text-primary, #111);
        border-bottom-color: var(--color-border, #d1d5db);
      }

      .nexus-sidebar-tab.active {
        color: var(--color-brand-primary, #51bb7b);
        border-bottom-color: var(--color-brand-primary, #51bb7b);
      }

      .nexus-sidebar-tab .count {
        opacity: 0.6;
        font-size: 12px;
        font-weight: 500;
        margin-left: 4px;
      }

      .nexus-sidebar-tab.active .count {
        opacity: 0.8;
      }

      /* Tab action buttons */
      .nexus-tab-action {
        background: none !important;
        border: none !important;
        color: var(--color-text-secondary, #6b7280) !important;
        cursor: pointer !important;
        padding: 6px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 4px !important;
        transition: all 0.15s !important;
        margin-bottom: -2px !important;
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        flex-shrink: 0 !important;
      }

      .nexus-tab-action:hover {
        color: var(--color-text-primary, #111) !important;
        background: var(--color-background-hover, rgba(0, 0, 0, 0.05)) !important;
      }

      .nexus-tab-action svg {
        width: 16px !important;
        height: 16px !important;
      }

      /* Preserve the icon styling from native buttons */
      .nexus-tab-action path {
        fill: currentColor !important;
      }

      /* Empty state for WPE tab */
      .nexus-wpe-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        text-align: center;
        min-height: 400px;
      }

      .nexus-wpe-empty-icon {
        width: 120px;
        height: 120px;
        margin-bottom: 24px;
        opacity: 0.6;
      }

      .nexus-wpe-empty-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--color-text-primary, #111);
        margin-bottom: 12px;
      }

      .nexus-wpe-empty-description {
        font-size: 14px;
        color: var(--color-text-secondary, #6b7280);
        line-height: 1.6;
        max-width: 400px;
        margin-bottom: 24px;
      }

      .nexus-wpe-connect-btn {
        background: var(--color-brand-primary, #51bb7b);
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .nexus-wpe-connect-btn:hover {
        background: var(--color-brand-primary-hover, #47a86d);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(81, 187, 123, 0.3);
      }

      .nexus-wpe-connect-btn:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  private tryInject(): void {
    this.injectTabs();
    this.addBadgesToLocalSites();
    this.injectWPESites();
    this.updateVisibility();
  }

  /**
   * Switch between tabs without re-injecting everything
   */
  private switchTab(): void {
    // Update tab button states
    document.querySelectorAll('.nexus-sidebar-tab').forEach((tab, index) => {
      const isActive = (index === 0 && this.activeTab === 'local') || (index === 1 && this.activeTab === 'wpe');
      if (isActive) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    // Update WPE sync button visibility
    const wpeSyncBtn = document.querySelector('.nexus-wpe-sync-btn') as HTMLElement;
    if (wpeSyncBtn) {
      wpeSyncBtn.style.display = this.activeTab === 'wpe' ? 'flex' : 'none';
    }

    // Update content visibility
    this.updateVisibility();
  }

  /**
   * Inject tabs at the top of the sidebar
   */
  private injectTabs(): void {
    // Check if tabs already exist
    const existingTabs = document.getElementById(TABS_CONTAINER_ID);
    if (existingTabs) {
      console.log('[SidebarWPEInjector] Tabs already exist, skipping injection');
      return;
    }

    // Find the Sites sidebar - try multiple possible containers
    const sidebarContainer = document.querySelector('[class*="SitesSidebar_Container"]')
                          || document.querySelector('[class*="SitesPane"]')
                          || document.getElementById('SiteList')?.parentElement;

    if (!sidebarContainer) {
      console.warn('[SidebarWPEInjector] Could not find sidebar container');
      return;
    }

    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.id = TABS_CONTAINER_ID;
    tabsContainer.className = 'nexus-sidebar-tabs';

    // Left side - tabs
    const tabsLeft = document.createElement('div');
    tabsLeft.className = 'nexus-tabs-left';

    // Local tab
    const localTab = document.createElement('button');
    localTab.className = `nexus-sidebar-tab ${this.activeTab === 'local' ? 'active' : ''}`;
    localTab.innerHTML = `Local<span class="count">${this.localSites.length}</span>`;
    localTab.setAttribute('role', 'tab');
    localTab.setAttribute('aria-selected', this.activeTab === 'local' ? 'true' : 'false');
    localTab.setAttribute('type', 'button'); // Prevent form submission
    localTab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[SidebarWPEInjector] Local tab clicked');
      this.activeTab = 'local';
      localStorage.setItem(ACTIVE_TAB_KEY, 'local');
      this.switchTab();
    });

    // WPE tab
    const wpeTab = document.createElement('button');
    wpeTab.className = `nexus-sidebar-tab ${this.activeTab === 'wpe' ? 'active' : ''}`;
    wpeTab.innerHTML = `WP Engine<span class="count">${this.wpeSites.length}</span>`;
    wpeTab.setAttribute('role', 'tab');
    wpeTab.setAttribute('aria-selected', this.activeTab === 'wpe' ? 'true' : 'false');
    wpeTab.setAttribute('type', 'button'); // Prevent form submission
    wpeTab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[SidebarWPEInjector] WPE tab clicked');
      this.activeTab = 'wpe';
      localStorage.setItem(ACTIVE_TAB_KEY, 'wpe');
      this.switchTab();
    });

    tabsLeft.appendChild(localTab);
    tabsLeft.appendChild(wpeTab);

    // Right side - actions
    const tabsRight = document.createElement('div');
    tabsRight.className = 'nexus-tabs-right';

    // Find and move the native toolbar into our tabs ONCE (preserves event handlers)
    const toolbar = document.querySelector('[class*="SitesSidebar_Toolbar"]:not([data-moved])');
    if (toolbar) {
      // Mark as moved to prevent re-moving on re-inject
      toolbar.setAttribute('data-moved', 'true');
      // Move (not clone) the toolbar to preserve React event handlers
      tabsRight.appendChild(toolbar);
      console.log('[SidebarWPEInjector] Moved toolbar into tabs');
    } else {
      // Toolbar already moved, find it and re-append
      const movedToolbar = document.querySelector('[class*="SidesSidebar_Toolbar"][data-moved]');
      if (movedToolbar) {
        tabsRight.appendChild(movedToolbar);
        console.log('[SidebarWPEInjector] Re-appended existing toolbar');
      }
    }

    // Now inject the sync button INSIDE the toolbar (only if not already there)
    const toolbarEl = document.querySelector('[class*="SitesSidebar_Toolbar"][data-moved]') as HTMLElement;
    if (toolbarEl && !toolbarEl.querySelector('.nexus-wpe-sync-btn')) {
      const syncButton = document.createElement('button');
      syncButton.className = 'nexus-tab-action nexus-wpe-sync-btn';
      syncButton.title = 'Sync WPE sites';
      syncButton.style.cssText = `
        display: ${this.activeTab === 'wpe' ? 'flex' : 'none'} !important;
      `;
      syncButton.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" fill="currentColor"/>
        </svg>
      `;
      syncButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        syncButton.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 16c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm0-14c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6z" opacity="0.3"/><path d="M8 0c4.4 0 8 3.6 8 8h-2c0-3.3-2.7-6-6-6V0z"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></path></svg>`;
        await this.loadData();
        // Don't re-inject, just update the data
        syncButton.innerHTML = `
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" fill="currentColor"/>
          </svg>
        `;
      });

      // Insert as FIRST child of toolbar (before search/sort/collapse)
      toolbarEl.insertBefore(syncButton, toolbarEl.firstChild);
      console.log('[SidebarWPEInjector] Injected sync button into toolbar as first child');
    }

    tabsContainer.appendChild(tabsLeft);
    tabsContainer.appendChild(tabsRight);

    // Insert tabs at the very top of the sidebar container
    sidebarContainer.insertBefore(tabsContainer, sidebarContainer.firstChild);
    console.log('[SidebarWPEInjector] Tabs injected at top of sidebar');
  }

  /**
   * Update visibility of local vs WPE sites based on active tab
   */
  private updateVisibility(): void {
    const siteListNav = document.getElementById('SiteList');
    if (!siteListNav) return;

    console.log('[SidebarWPEInjector] updateVisibility - activeTab:', this.activeTab);

    // Find all local site elements and groups
    const localSiteElements = document.querySelectorAll('[data-site-id]:not([data-site-id^="wpe-"])');
    const localGroups = siteListNav.querySelectorAll('[class*="SiteListGroup"]');

    // Find WPE section
    const wpeSection = document.getElementById(WPE_SECTION_ID);

    // Update WPE-specific sync button visibility
    const wpeSyncBtn = document.querySelector('.nexus-wpe-sync-btn') as HTMLElement;
    if (wpeSyncBtn) {
      const shouldShow = this.activeTab === 'wpe';
      wpeSyncBtn.style.display = shouldShow ? 'flex' : 'none';
      console.log('[SidebarWPEInjector] Sync button display:', wpeSyncBtn.style.display);
    }

    if (this.activeTab === 'local') {
      // Show local sites and groups, hide WPE section
      localSiteElements.forEach(el => {
        (el as HTMLElement).style.display = '';
      });
      localGroups.forEach(el => {
        (el as HTMLElement).style.display = '';
      });
      if (wpeSection) {
        wpeSection.style.display = 'none';
      }
    } else {
      // Hide local sites and groups, show WPE section
      localSiteElements.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
      localGroups.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
      if (wpeSection) {
        wpeSection.style.display = 'block';
      }
    }
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
   * Inject empty state when WPE is not authenticated
   */
  private injectWPEEmptyState(): void {
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

    // Create WPE sites section with empty state
    const wpeSection = document.createElement('div');
    wpeSection.id = WPE_SECTION_ID;
    wpeSection.style.cssText = 'padding-top: 4px;';

    // Empty state container
    const emptyState = document.createElement('div');
    emptyState.className = 'nexus-wpe-empty-state';

    // Icon (using WPE cloud SVG)
    const icon = document.createElement('div');
    icon.className = 'nexus-wpe-empty-icon';
    icon.innerHTML = `
      <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60 20C37.91 20 20 37.91 20 60C20 82.09 37.91 100 60 100C82.09 100 100 82.09 100 60C100 37.91 82.09 20 60 20ZM60 90C43.43 90 30 76.57 30 60C30 43.43 43.43 30 60 30C76.57 30 90 43.43 90 60C90 76.57 76.57 90 60 90Z" fill="currentColor" opacity="0.2"/>
        <path d="M85 50H75C75 41.72 68.28 35 60 35V25C73.81 25 85 36.19 85 50Z" fill="#0ECAD4"/>
      </svg>
    `;

    // Title
    const title = document.createElement('div');
    title.className = 'nexus-wpe-empty-title';
    title.textContent = 'Connect to get started!';

    // Description
    const description = document.createElement('div');
    description.className = 'nexus-wpe-empty-description';
    description.textContent = 'Connect to WP Engine to view and manage your remote WordPress sites directly from Local.';

    // Connect button
    const connectBtn = document.createElement('button');
    connectBtn.className = 'nexus-wpe-connect-btn';
    connectBtn.textContent = 'Connect to WP Engine';
    connectBtn.addEventListener('click', () => {
      // Navigate to Settings → Connected accounts
      window.location.hash = '#/settings/connect';
    });

    emptyState.appendChild(icon);
    emptyState.appendChild(title);
    emptyState.appendChild(description);
    emptyState.appendChild(connectBtn);

    wpeSection.appendChild(emptyState);
    siteListNav.appendChild(wpeSection);

    this.injected = true;
    console.log('[SidebarWPEInjector] Injected WPE empty state');
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
    this.wpeSites.forEach((site, index) => {
      const accountId = site.account_id || site.accountId || 'unknown';
      if (index === 0) {
        console.log('[SidebarWPEInjector] Sample site data:', JSON.stringify(site).slice(0, 200));
      }
      if (!sitesByAccount.has(accountId)) {
        sitesByAccount.set(accountId, []);
      }
      sitesByAccount.get(accountId)!.push(site);
    });

    console.log('[SidebarWPEInjector] Grouped sites by account:', sitesByAccount.size, 'accounts');
    console.log('[SidebarWPEInjector] Account IDs in sites:', Array.from(sitesByAccount.keys()));
    console.log('[SidebarWPEInjector] Loaded account IDs:', this.accounts.map(a => a.id));

    // Build tree for each account
    this.accounts.forEach((account) => {
      const accountSites = sitesByAccount.get(account.id) || [];
      console.log('[SidebarWPEInjector] Account', account.name, 'has', accountSites.length, 'sites');

      // Group installs by site name
      const installsBySiteName = new Map<string, any[]>();
      accountSites.forEach((install) => {
        const siteName = this.extractSiteName(install.name, install.environment || 'production');
        if (!installsBySiteName.has(siteName)) {
          installsBySiteName.set(siteName, []);
        }
        installsBySiteName.get(siteName)!.push(install);
      });

      console.log('[SidebarWPEInjector] Account', account.name, 'grouped into', installsBySiteName.size, 'unique sites');
      tree.set(account.id, installsBySiteName);
    });

    return tree;
  }

  /**
   * Inject WPE sites into the sidebar (flat list matching Local's UX)
   */
  private injectWPESites(): void {
    console.log('[SidebarWPEInjector] injectWPESites() called');
    console.log('[SidebarWPEInjector] wpeSites.length:', this.wpeSites.length);
    console.log('[SidebarWPEInjector] accounts.length:', this.accounts.length);
    console.log('[SidebarWPEInjector] isWPEAuthenticated:', this.isWPEAuthenticated);

    // Show empty state if not authenticated
    if (!this.isWPEAuthenticated) {
      console.log('[SidebarWPEInjector] Showing WPE auth empty state');
      this.injectWPEEmptyState();
      return;
    }

    if (this.wpeSites.length === 0 || this.accounts.length === 0) {
      console.log('[SidebarWPEInjector] No WPE sites/accounts to inject - wpeSites:', this.wpeSites.length, 'accounts:', this.accounts.length);
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
      console.log('[SidebarWPEInjector] Removing existing WPE section');
      existingSection.remove();
    }

    // Build tree structure
    console.log('[SidebarWPEInjector] Building tree structure...');
    const tree = this.buildTree();
    console.log('[SidebarWPEInjector] Tree built with', tree.size, 'accounts');

    // Create WPE sites section
    const wpeSection = document.createElement('div');
    wpeSection.id = WPE_SECTION_ID;
    wpeSection.style.cssText = `
      padding-top: 4px;
    `;

    // Render each account with all its sites (always visible, no collapse)
    let accountsRendered = 0;
    this.accounts.forEach((account, accountIndex) => {
      const sitesMap = tree.get(account.id);
      if (!sitesMap || sitesMap.size === 0) {
        console.log('[SidebarWPEInjector] Skipping account', account.name, '- no sites');
        return;
      }

      const totalInstalls = Array.from(sitesMap.values()).reduce((sum, installs) => sum + installs.length, 0);

      // Divider before account (except first)
      if (accountIndex > 0) {
        const divider = document.createElement('div');
        divider.className = 'nexus-account-divider';
        wpeSection.appendChild(divider);
      }

      // Account header (non-interactive)
      const accountHeader = this.createAccountHeader(account, sitesMap.size, totalInstalls);
      wpeSection.appendChild(accountHeader);
      accountsRendered++;

      // All sites under this account (always visible)
      sitesMap.forEach((installs, siteName) => {
        // Site name row (non-interactive)
        const siteNameRow = this.createSiteNameRow(siteName);
        wpeSection.appendChild(siteNameRow);

        // All environments under this site (always visible)
        installs.forEach((install) => {
          const envRow = this.createEnvironmentRow(install);
          wpeSection.appendChild(envRow);
        });
      });
    });

    console.log('[SidebarWPEInjector] WPE section children:', wpeSection.childElementCount);
    console.log('[SidebarWPEInjector] Accounts rendered:', accountsRendered);

    siteListNav.appendChild(wpeSection);
    this.injected = true;

    console.log('[SidebarWPEInjector] WPE section appended to DOM');
    console.log('[SidebarWPEInjector] Injected flat list with', this.accounts.length, 'accounts');
  }

  /**
   * Create account header (non-interactive, matches Local's group header)
   */
  private createAccountHeader(account: any, siteCount: number, installCount: number): HTMLElement {
    const header = document.createElement('div');
    header.className = 'nexus-account-header';

    const name = document.createElement('span');
    name.textContent = account.name;

    const meta = document.createElement('span');
    meta.className = 'nexus-account-meta';
    meta.textContent = `(${siteCount} sites, ${installCount} envs)`;

    header.appendChild(name);
    header.appendChild(meta);

    return header;
  }

  /**
   * Create site name row (non-interactive sub-header)
   */
  private createSiteNameRow(siteName: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'nexus-site-name-row';
    row.textContent = siteName;

    return row;
  }

  /**
   * Create environment row (clickable link with arrow, matches Local's site items)
   */
  private createEnvironmentRow(install: any): HTMLElement {
    const link = document.createElement('a');
    link.className = 'nexus-env-link';

    const siteId = install.id || `wpe-${install.remote_install_id}`;
    link.setAttribute('data-site-id', siteId);

    // Arrow prefix
    const arrow = document.createElement('span');
    arrow.className = 'nexus-env-arrow';
    arrow.textContent = '→';
    link.appendChild(arrow);

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
        // Check if tabs disappeared and need re-injection
        const tabs = document.getElementById(TABS_CONTAINER_ID);
        if (!tabs) {
          console.log('[SidebarWPEInjector] Tabs disappeared, re-injecting');
          this.tryInject();
          return;
        }

        // Check if WPE section disappeared and needs re-injection
        const wpeSection = document.getElementById(WPE_SECTION_ID);
        if (!wpeSection && this.wpeSites.length > 0 && this.activeTab === 'wpe') {
          console.log('[SidebarWPEInjector] WPE section disappeared, re-injecting');
          this.injected = false;
          this.injectWPESites();
        }

        // Check if local site badges need to be added (for newly rendered sites)
        this.addBadgesToLocalSites();

        // Update visibility in case DOM changed
        this.updateVisibility();
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
    document.getElementById(TABS_CONTAINER_ID)?.remove();
    document.getElementById(WPE_SECTION_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    // Remove all badges
    document.querySelectorAll('.nexus-badge').forEach(el => el.remove());

    // Restore local sites and groups visibility
    const localSiteElements = document.querySelectorAll('[data-site-id]:not([data-site-id^="wpe-"])');
    localSiteElements.forEach(el => {
      (el as HTMLElement).style.display = '';
    });

    const siteListNav = document.getElementById('SiteList');
    if (siteListNav) {
      const localGroups = siteListNav.querySelectorAll('[class*="SiteListGroup"]');
      localGroups.forEach(el => {
        (el as HTMLElement).style.display = '';
      });
    }
  }
}
