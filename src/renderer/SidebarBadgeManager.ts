/**
 * Sidebar Badge Manager
 *
 * Injects "WPE" badges into the sidebar site list for WP Engine-connected sites.
 * Uses MutationObserver since there's no per-site hook available in Local.
 *
 * DOM structure from Local's SiteListSite.tsx:
 * <NavLink data-site-id="abc123" data-site-name="mysite">
 *   {status icon}
 *   <span class="TID_SiteListSite_Span_SiteName">mysite</span>
 *   {lastStarted}
 * </NavLink>
 *
 * Ported from local-addon-laravel SidebarBadgeManager pattern.
 */
import { IPC_CHANNELS, UI_COLORS } from '../common/constants';

const BADGE_CLASS = 'nexus-ai-wpe-badge';
const BADGE_DATA_ATTR = 'data-nexus-wpe-badge';
const STYLE_ID = 'nexus-ai-wpe-sidebar-styles';

export class SidebarBadgeManager {
  private observer: MutationObserver | null = null;
  private wpeSiteIds: Set<string> = new Set();
  private electron: any;
  private isInitialized: boolean = false;
  private pendingRefresh: number | null = null;

  constructor(electron: any) {
    this.electron = electron;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.injectStyles();
    await this.refreshWpeSites();
    this.injectBadges();
    this.startObserver();
  }

  private async refreshWpeSites(): Promise<void> {
    try {
      const result = await this.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_WPE_SITE_IDS);
      if (result?.success && result.siteIds) {
        this.wpeSiteIds = new Set(result.siteIds);
      }
    } catch (error) {
      console.error('[NexusAI] Failed to fetch WPE sites:', error);
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BADGE_CLASS} {
        width: auto;
        height: 14px;
        padding: 0 4px;
        background-color: ${UI_COLORS.WPE_BRAND};
        color: #fff;
        font-size: 8px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        flex-shrink: 0;
        margin-left: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0.5px;
      }
    `;
    document.head.appendChild(style);
  }

  private injectBadges(): void {
    const siteElements = document.querySelectorAll('[data-site-id]');

    siteElements.forEach((element) => {
      const siteId = element.getAttribute('data-site-id');
      if (!siteId) return;

      const isWpe = this.wpeSiteIds.has(siteId);
      const hasBadge = element.querySelector(`.${BADGE_CLASS}`) !== null;

      if (isWpe && !hasBadge) {
        const nameSpan = element.querySelector('.TID_SiteListSite_Span_SiteName');
        if (nameSpan) {
          const badge = document.createElement('div');
          badge.className = BADGE_CLASS;
          badge.setAttribute(BADGE_DATA_ATTR, 'true');
          badge.textContent = 'WPE';
          badge.title = 'WP Engine Connected';
          nameSpan.parentElement?.insertBefore(badge, nameSpan.nextSibling);
        }
      } else if (!isWpe && hasBadge) {
        const badge = element.querySelector(`.${BADGE_CLASS}`);
        badge?.remove();
      }
    });
  }

  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      if (this.pendingRefresh !== null) {
        cancelAnimationFrame(this.pendingRefresh);
      }
      this.pendingRefresh = requestAnimationFrame(() => {
        this.injectBadges();
        this.pendingRefresh = null;
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async refresh(): Promise<void> {
    try {
      await this.refreshWpeSites();
      this.injectBadges();
    } catch (error) {
      console.error('[NexusAI] Badge refresh failed:', error);
    }
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pendingRefresh !== null) {
      cancelAnimationFrame(this.pendingRefresh);
      this.pendingRefresh = null;
    }
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
    document.getElementById(STYLE_ID)?.remove();
  }
}
