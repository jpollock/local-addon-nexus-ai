/**
 * Nav Item Injector
 *
 * Injects a "Fleet" navigation item into Local's vertical nav sidebar.
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
 * We inject our item before the filler (drag region) so it appears
 * after the built-in nav items but above the bottom section.
 *
 * Navigation: Local uses HashHistory, so setting window.location.hash
 * triggers React Router navigation without a page reload.
 */

const NAV_ITEM_ID = 'nexus-ai-fleet-nav';
const STYLE_ID = 'nexus-ai-fleet-nav-styles';

// Dashboard/gauge SVG icon — distinct from the waffle (3x3 dots) at bottom of nav
const FLEET_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
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
      #${NAV_ITEM_ID} {
        text-align: center;
      }
      #${NAV_ITEM_ID} a {
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
      #${NAV_ITEM_ID} a:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      #${NAV_ITEM_ID} a:hover svg {
        transform: scale(1.05);
      }
      #${NAV_ITEM_ID} a.__Active {
        background: rgba(0, 0, 0, 0.2);
      }
      #${NAV_ITEM_ID} svg {
        width: 38px;
        height: 38px;
        color: rgba(255, 255, 255, 0.7);
        transition: transform 0.1s ease;
      }
      #${NAV_ITEM_ID} a:hover svg,
      #${NAV_ITEM_ID} a.__Active svg {
        color: #fff;
      }
    `;
    document.head.appendChild(style);
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
    if (document.getElementById(NAV_ITEM_ID)) {
      this.injected = true;
      return;
    }

    // Create nav item container
    const wrapper = document.createElement('div');
    wrapper.id = NAV_ITEM_ID;

    const link = document.createElement('a');
    link.href = '#/main/fleet-overview';
    link.title = 'Nexus AI';
    link.innerHTML = FLEET_SVG;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '#/main/fleet-overview';
      this.updateActiveState();
    });

    wrapper.appendChild(link);
    nav.insertBefore(wrapper, fillerEl);
    this.injected = true;

    // Update active state on hash changes
    window.addEventListener('hashchange', () => this.updateActiveState());
    this.updateActiveState();
  }

  private updateActiveState(): void {
    const link = document.querySelector(`#${NAV_ITEM_ID} a`);
    if (!link) return;

    const isActive = window.location.hash.includes('/main/fleet-overview');
    link.classList.toggle('__Active', isActive);
  }

  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      if (this.injected && !document.getElementById(NAV_ITEM_ID)) {
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
    document.getElementById(NAV_ITEM_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }
}
