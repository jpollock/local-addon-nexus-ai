/**
 * Nav Item Injector
 *
 * Injects "Nexus AI" navigation item into Local's vertical sidebar.
 *
 * Uses MutationObserver since there's no hook for the vertical nav.
 *
 * Navigation: Local uses HashHistory, so setting window.location.hash
 * triggers React Router navigation without a page reload.
 */

import { nexusMarkSvg } from './utils/nexusMark';

const NEXUS_NAV_ITEM_ID = 'nexus-ai-overview-nav';
const STYLE_ID = 'nexus-ai-nav-styles';

/**
 * The rendered size, kept in sync with the `svg { width/height }` rule below — the CSS
 * overrides whatever the markup declares, and the two disagreeing is how the ring-minimum
 * rule would get bypassed without anyone noticing.
 */
const NAV_ICON_SIZE = 38;

/**
 * The Nexus mark, from the same geometry the docked panel draws. This slot used to carry
 * an unrelated gauge dial — a circle, an arc and a needle — so Local's nav and the panel
 * were showing different marks for the same product. Neither read the SVG assets.
 */
const NEXUS_SVG = nexusMarkSvg(NAV_ICON_SIZE);

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
      #${NEXUS_NAV_ITEM_ID} {
        text-align: center;
      }
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
      #${NEXUS_NAV_ITEM_ID} a:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      #${NEXUS_NAV_ITEM_ID} a:hover svg {
        transform: scale(1.05);
      }
      #${NEXUS_NAV_ITEM_ID} a.__Active {
        background: rgba(0, 0, 0, 0.2);
      }
      #${NEXUS_NAV_ITEM_ID} svg {
        width: ${NAV_ICON_SIZE}px;
        height: ${NAV_ICON_SIZE}px;
        /* The mark is drawn in currentColor, so this is what makes it dimmed-white on
           Local's green nav, and full white on hover/active below. */
        color: rgba(255, 255, 255, 0.7);
        transition: transform 0.1s ease;
      }
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

    // Find the filler/drag region
    const children = Array.from(nav.children);
    let fillerEl: Element | null = null;

    for (const child of children) {
      if (child.tagName === 'DIV' && child.className.includes('DragRegion')) {
        fillerEl = child;
        break;
      }
    }

    if (!fillerEl) return;

    // Check if already injected
    if (document.getElementById(NEXUS_NAV_ITEM_ID)) {
      this.injected = true;
      return;
    }

    // Create Nexus AI nav item
    const nexusItem = this.createNavItem(
      NEXUS_NAV_ITEM_ID,
      '/main/nexus',
      'Nexus AI',
      NEXUS_SVG
    );

    // Insert before the filler
    nav.insertBefore(nexusItem, fillerEl);
    this.injected = true;

    // Update active state on hash changes
    window.addEventListener('hashchange', () => this.updateActiveState());
    this.updateActiveState();
  }

  private updateActiveState(): void {
    const nexusLink = document.querySelector(`#${NEXUS_NAV_ITEM_ID} a`);

    if (nexusLink) {
      const isNexusActive = window.location.hash.includes('/main/nexus');
      nexusLink.classList.toggle('__Active', isNexusActive);
    }
  }

  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      const nexusExists = document.getElementById(NEXUS_NAV_ITEM_ID);

      if (this.injected && !nexusExists) {
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
    document.getElementById(NEXUS_NAV_ITEM_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }
}
