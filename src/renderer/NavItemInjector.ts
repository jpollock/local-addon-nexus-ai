/**
 * Nav Item Injector
 *
 * Injects THREE navigation items into Local's vertical nav sidebar:
 * 1. Fleet (power user site management)
 * 2. Content (indexed content browser)
 * 3. Nexus AI (addon dashboard)
 *
 * Uses MutationObserver since there's no hook for the vertical nav.
 *
 * DOM structure from Local's MainVerticalNav.tsx + VerticalNav.tsx:
 * <nav id="Sidebar" aria-label="Local Task Sidebar" class="...VerticalNav...">
 *   {login tab}
 *   {local sites}       ← VerticalNavItem with NavLink
 *   {connect}           ← VerticalNavItem with NavLink
 *   {blueprints}        ← VerticalNavItem with NavLink
 *   {addons}            ← VerticalNavItem with NavLink
 *   {support}           ← VerticalNavItem with NavLink
 *   {filler/drag}       ← div with VerticalNavItem_DragRegion class (flex-grow: 1)
 *   {product drawer}    ← VerticalNavItem with button
 *   {add site}          ← VerticalNavItem with NavLink (round white button)
 * </nav>
 *
 * We inject our items before the filler (drag region) so they appear
 * after the built-in nav items but above the bottom section.
 *
 * Navigation: Local uses HashHistory, so setting window.location.hash
 * triggers React Router navigation without a page reload.
 */

const FLEET_NAV_ITEM_ID = 'nexus-ai-fleet-nav';
const CONTENT_NAV_ITEM_ID = 'nexus-ai-content-nav';
const NEXUS_NAV_ITEM_ID = 'nexus-ai-overview-nav';
const STYLE_ID = 'nexus-ai-nav-styles';

// Grid/table icon for Fleet (power user table view)
const FLEET_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/>
  <rect x="13" y="3" width="7" height="7" rx="1" fill="currentColor"/>
  <rect x="3" y="13" width="7" height="7" rx="1" fill="currentColor"/>
  <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor"/>
</svg>`;

// Document with search icon for Content Browser
const CONTENT_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" fill="currentColor"/>
  <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="14.5" cy="14.5" r="3" fill="#2E3440" stroke="currentColor" stroke-width="1.5"/>
  <path d="M16.5 16.5l2.5 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// Dashboard/gauge SVG icon for Nexus AI
const NEXUS_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/>
  <path d="M12 6c-3.31 0-6 2.69-6 6h2c0-2.21 1.79-4 4-4s4 1.79 4 4h2c0-3.31-2.69-6-6-6z" fill="currentColor"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
  <path d="M12 12l3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export class NavItemInjector {
  private observer: MutationObserver | null = null;
  private injected: boolean = false;

  initialize(): void {
    this.injectStyles();
    this.tryInject();
    this.startObserver();
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${FLEET_NAV_ITEM_ID},
      #${CONTENT_NAV_ITEM_ID},
      #${NEXUS_NAV_ITEM_ID} {
        text-align: center;
      }
      #${FLEET_NAV_ITEM_ID} a,
      #${CONTENT_NAV_ITEM_ID} a,
      #${NEXUS_NAV_ITEM_ID} a {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        margin: 7px 10px;
        border-radius: 4px;
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        transition: background-color 0.1s ease;
      }
      #${FLEET_NAV_ITEM_ID} a:hover,
      #${CONTENT_NAV_ITEM_ID} a:hover,
      #${NEXUS_NAV_ITEM_ID} a:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      #${FLEET_NAV_ITEM_ID} a:hover svg,
      #${CONTENT_NAV_ITEM_ID} a:hover svg,
      #${NEXUS_NAV_ITEM_ID} a:hover svg {
        transform: scale(1.05);
      }
      #${FLEET_NAV_ITEM_ID} a.__Active,
      #${CONTENT_NAV_ITEM_ID} a.__Active,
      #${NEXUS_NAV_ITEM_ID} a.__Active {
        background: rgba(0, 0, 0, 0.2);
      }
      #${FLEET_NAV_ITEM_ID} svg,
      #${CONTENT_NAV_ITEM_ID} svg,
      #${NEXUS_NAV_ITEM_ID} svg {
        width: 38px;
        height: 38px;
        color: rgba(255, 255, 255, 0.7);
        transition: transform 0.1s ease;
      }
      #${FLEET_NAV_ITEM_ID} a:hover svg,
      #${FLEET_NAV_ITEM_ID} a.__Active svg,
      #${CONTENT_NAV_ITEM_ID} a:hover svg,
      #${CONTENT_NAV_ITEM_ID} a.__Active svg,
      #${NEXUS_NAV_ITEM_ID} a:hover svg,
      #${NEXUS_NAV_ITEM_ID} a.__Active svg {
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  private createNavItem(id: string, route: string, title: string, svg: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.id = id;

    const link = document.createElement('a');
    link.href = `#${route}`;
    link.title = title;
    link.innerHTML = svg;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = `#${route}`;
      this.updateActiveState();
    });

    wrapper.appendChild(link);
    return wrapper;
  }

  private tryInject(): void {
    if (this.injected) return;

    const nav = document.getElementById('Sidebar');
    if (!nav) return;

    // Find the filler/drag region — it's the div that has flex-grow and acts as spacer
    // It's a direct child div that's NOT a tooltip/navitem wrapper
    const children = Array.from(nav.children);
    let fillerEl: Element | null = null;

    for (const child of children) {
      // The drag region div has no tooltip wrapper and no NavLink — it's a bare div
      // with a class containing "DragRegion"
      if (child.tagName === 'DIV' && child.className.includes('DragRegion')) {
        fillerEl = child;
        break;
      }
    }

    if (!fillerEl) return;

    // Check if already injected
    if (document.getElementById(FLEET_NAV_ITEM_ID) ||
        document.getElementById(CONTENT_NAV_ITEM_ID) ||
        document.getElementById(NEXUS_NAV_ITEM_ID)) {
      this.injected = true;
      return;
    }

    // Create Fleet nav item (first)
    const fleetItem = this.createNavItem(
      FLEET_NAV_ITEM_ID,
      '/main/fleet',
      'Fleet',
      FLEET_SVG
    );

    // Create Content nav item (second)
    const contentItem = this.createNavItem(
      CONTENT_NAV_ITEM_ID,
      '/main/content',
      'Content',
      CONTENT_SVG
    );

    // Create Nexus AI nav item (third)
    const nexusItem = this.createNavItem(
      NEXUS_NAV_ITEM_ID,
      '/main/nexus',
      'Nexus AI',
      NEXUS_SVG
    );

    // Insert all items before the filler
    nav.insertBefore(fleetItem, fillerEl);
    nav.insertBefore(contentItem, fillerEl);
    nav.insertBefore(nexusItem, fillerEl);
    this.injected = true;

    // Update active state on hash changes
    window.addEventListener('hashchange', () => this.updateActiveState());
    this.updateActiveState();
  }

  private updateActiveState(): void {
    const fleetLink = document.querySelector(`#${FLEET_NAV_ITEM_ID} a`);
    const contentLink = document.querySelector(`#${CONTENT_NAV_ITEM_ID} a`);
    const nexusLink = document.querySelector(`#${NEXUS_NAV_ITEM_ID} a`);

    if (fleetLink) {
      const isFleetActive = window.location.hash.includes('/main/fleet');
      fleetLink.classList.toggle('__Active', isFleetActive);
    }

    if (contentLink) {
      const isContentActive = window.location.hash.includes('/main/content');
      contentLink.classList.toggle('__Active', isContentActive);
    }

    if (nexusLink) {
      const isNexusActive = window.location.hash.includes('/main/nexus');
      nexusLink.classList.toggle('__Active', isNexusActive);
    }
  }

  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      const fleetExists = document.getElementById(FLEET_NAV_ITEM_ID);
      const contentExists = document.getElementById(CONTENT_NAV_ITEM_ID);
      const nexusExists = document.getElementById(NEXUS_NAV_ITEM_ID);

      if (this.injected && (!fleetExists || !contentExists || !nexusExists)) {
        this.injected = false;
      }
      if (!this.injected) {
        this.tryInject();
      }
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
    document.getElementById(FLEET_NAV_ITEM_ID)?.remove();
    document.getElementById(CONTENT_NAV_ITEM_ID)?.remove();
    document.getElementById(NEXUS_NAV_ITEM_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }
}
