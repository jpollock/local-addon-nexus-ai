import { NavItemInjector } from './NavItemInjector';
import { NexusOverview } from './components/NexusOverview';
import { NexusPreferences } from './components/NexusPreferences';
import { SiteNexusSection } from './components/SiteNexusSection';
import { SidebarSearchPanel } from './components/SidebarSearchPanel';
import { IPC_CHANNELS } from '../common/constants';

export default function renderer(context: any): void {
  console.log('[Nexus AI] Renderer initializing...');
  const { React, hooks, ReactRouter } = context;
  const { Route, NavLink } = ReactRouter;
  const electron = context.electron || (window as any).electron;
  console.log('[Nexus AI] React, hooks, electron loaded');

  // Try to get TextButton from Local's components
  let TextButton: any = null;
  try {
    // @ts-ignore
    const localComponents = require('@getflywheel/local-components');
    TextButton = localComponents.TextButton;
    if (TextButton) {
      console.log('[Nexus AI] Successfully loaded TextButton from @getflywheel/local-components');
    } else {
      console.warn('[Nexus AI] TextButton is undefined in @getflywheel/local-components');
    }
  } catch (err) {
    console.warn('[Nexus AI] Could not load @getflywheel/local-components:', err);
  }

  // Nexus AI nav item in vertical sidebar (DOM injection)
  try {
    console.log('[Nexus AI] Initializing NavItemInjector...');
    const navInjector = new NavItemInjector();
    navInjector.initialize();
    console.log('[Nexus AI] NavItemInjector initialized');
  } catch (err) {
    console.error('[Nexus AI] NavItemInjector failed:', err);
  }

  // Feature 1: Nexus AI Overview route
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/nexus',
      render: () => React.createElement(NexusOverview, { NavLink, electron }),
    }),
  );

  // Feature 2: Addon preferences page
  hooks.addFilter('preferencesMenuItems', (items: any[]) => {
    return [...items, {
      path: '/nexus-ai',
      displayName: 'Nexus AI',
      sections: (props: any) => React.createElement(NexusPreferences, { ...props, electron }),
      onApply: async () => { /* Settings saved inline on change */ },
    }];
  });

  // Feature 3: Per-site Nexus AI section on site overview
  hooks.addFilter('SiteInfoOverview_Addon_Section', (sections: any[], site: any) => {
    return [...sections, {
      title: 'Nexus AI',
      component: React.createElement(SiteNexusSection, { site, electron, TextButton }),
    }];
  });

  // Feature 4: Sidebar Search Panel (AI Site Finder)
  // Add search button to sidebar header and keyboard shortcut (Cmd+K / Ctrl+K)
  let searchContainerInstance: SidebarSearchContainer | null = null;

  class SidebarSearchContainer extends React.Component<any, { isOpen: boolean; hasLLM: boolean }> {
    state = { isOpen: false, hasLLM: false };

    componentDidMount() {
      searchContainerInstance = this;

      // Check if LLM is configured
      electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS).then((settings: any) => {
        this.setState({ hasLLM: !!settings?.aiProvider });
      });

      // Register keyboard shortcut
      document.addEventListener('keydown', this.handleKeyDown);
    }

    componentWillUnmount() {
      document.removeEventListener('keydown', this.handleKeyDown);
      searchContainerInstance = null;
    }

    handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggleSearch();
      }
    };

    toggleSearch = () => {
      this.setState({ isOpen: !this.state.isOpen });
    };

    render() {
      return React.createElement(SidebarSearchPanel, {
        electron,
        isOpen: this.state.isOpen,
        onClose: () => this.setState({ isOpen: false }),
        hasLLM: this.state.hasLLM,
      });
    }
  }

  // Mount search panel container to body
  const container = document.createElement('div');
  container.id = 'nexus-sidebar-search';
  document.body.appendChild(container);

  // Use old React API (Local uses React 16, not 18)
  const ReactDOM = require('react-dom');
  ReactDOM.render(React.createElement(SidebarSearchContainer), container);

  // Inject search button into Local's sidebar toolbar
  const injectSearchButton = () => {
    console.log('[Nexus AI] Attempting to inject search button...');

    // Target the SitesSidebarToolbar component
    const toolbar = document.querySelector('[class*="SitesSidebar_Toolbar"]');

    if (!toolbar) {
      console.warn('[Nexus AI] Could not find SitesSidebar_Toolbar');
      return false;
    }

    // Check if button already exists
    if (toolbar.querySelector('#nexus-search-btn')) {
      console.log('[Nexus AI] Search button already exists');
      return true;
    }

    console.log('[Nexus AI] Found toolbar, injecting button');

    const searchButton = document.createElement('button');
    searchButton.id = 'nexus-search-btn';
    searchButton.title = 'AI Site Finder (Cmd+K / Ctrl+K)';

    // SVG magnifying glass icon matching Local's icon style
    searchButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M10 10L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `;

    searchButton.style.cssText = `
      background: none;
      border: none;
      color: #7e7e7e;
      cursor: pointer;
      padding: 0;
      margin: 0 8px 0 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      transition: color 0.2s;
      flex-shrink: 0;
    `;

    searchButton.addEventListener('mouseenter', () => {
      // Use theme-aware hover color
      searchButton.style.color = 'var(--color-text-primary, #111827)';
    });

    // Store reference to button for state checks
    (window as any).nexusSearchButton = searchButton;

    searchButton.addEventListener('mouseleave', () => {
      // Restore color based on filter state
      searchButton.style.color = (window as any).nexusFilterActive ? '#51BB7B' : '#7e7e7e';
    });

    searchButton.addEventListener('click', () => {
      console.log('[Nexus AI] Search button clicked');

      if ((window as any).nexusFilterActive) {
        // Filter is active - clear it (turns icon gray)
        console.log('[Nexus AI] Clearing filter via icon click');
        electron.ipcRenderer.invoke(IPC_CHANNELS.SIDEBAR_FILTER, { siteIds: [] });
      } else {
        // No filter - open search panel
        if (searchContainerInstance) {
          searchContainerInstance.toggleSearch();
        }
      }
    });

    // Insert before the first child (clock icon) so it appears on the left
    toolbar.insertBefore(searchButton, toolbar.firstChild);
    console.log('[Nexus AI] Search button injected successfully');
    return true;
  };

  // Use MutationObserver to keep search button injected (don't disconnect)
  // Button can disappear when navigating away from Sites and back
  const observer = new MutationObserver(() => {
    // Check if button exists
    const button = document.querySelector('#nexus-search-btn');
    const toolbar = document.querySelector('[class*="SitesSidebar_Toolbar"]');

    // Re-inject if toolbar exists but button is missing
    if (toolbar && !button) {
      injectSearchButton();
    }
  });

  // Start observing (never disconnect)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also try immediately and with delays
  setTimeout(injectSearchButton, 100);
  setTimeout(injectSearchButton, 500);
  setTimeout(injectSearchButton, 1000);
  setTimeout(injectSearchButton, 2000);

  // Filter sites list based on search results using CSS
  let activeStyleTag: HTMLStyleElement | null = null;

  const applySiteFilter = (siteIds: string[]) => {
    // Remove old style tag
    if (activeStyleTag) {
      activeStyleTag.remove();
      activeStyleTag = null;
    }

    const filterActive = siteIds.length > 0;

    // Store filter state globally for button click handler
    (window as any).nexusFilterActive = filterActive;
    (window as any).nexusFilterCount = siteIds.length;

    // Update search button color and badge to indicate filter state
    const searchBtn = document.querySelector('#nexus-search-btn') as HTMLElement;
    if (searchBtn) {
      searchBtn.style.color = filterActive ? '#51BB7B' : '#7e7e7e';
      searchBtn.title = filterActive
        ? `Filter active: ${siteIds.length} site${siteIds.length === 1 ? '' : 's'} (click to clear)`
        : 'AI Site Finder (Cmd+K / Ctrl+K)';

      // Add/update count badge
      let badge = searchBtn.querySelector('.nexus-filter-badge') as HTMLElement;
      if (filterActive) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nexus-filter-badge';
          badge.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            background: #51BB7B;
            color: #fff;
            font-size: 9px;
            font-weight: 600;
            padding: 2px 4px;
            border-radius: 8px;
            min-width: 14px;
            text-align: center;
            line-height: 1;
            pointer-events: none;
          `;
          searchBtn.style.position = 'relative';
          searchBtn.appendChild(badge);
        }
        badge.textContent = siteIds.length > 99 ? '99+' : String(siteIds.length);
      } else if (badge) {
        badge.remove();
      }
    }

    if (filterActive) {
      // Create CSS to hide all sites except the filtered ones
      const styleTag = document.createElement('style');
      styleTag.id = 'nexus-site-filter';

      // Hide all sites by default
      let css = '[data-site-id] { display: none !important; }\n';

      // Show only filtered sites
      siteIds.forEach(id => {
        // Check if it's a WPE site (starts with "wpe-") - use flex for those
        if (id.startsWith('wpe-')) {
          css += `[data-site-id="${id}"] { display: flex !important; }\n`;
        } else {
          css += `[data-site-id="${id}"] { display: block !important; }\n`;
        }
      });

      styleTag.textContent = css;
      document.head.appendChild(styleTag);
      activeStyleTag = styleTag;

      console.log('[Nexus AI] Applied filter to', siteIds.length, 'sites');
    } else {
      console.log('[Nexus AI] Filter cleared - showing all sites');
    }
  };

  // Listen for filter updates from search panel
  const applyFilterHandler = (_event: any, siteIds: string[]) => {
    applySiteFilter(siteIds);
    // Trigger badge re-injection after filter is applied
    setTimeout(() => {
      const event = new CustomEvent('nexus:badges-refresh');
      document.dispatchEvent(event);
    }, 100);
  };

  const clearFilterHandler = () => {
    applySiteFilter([]);

    // Trigger badge re-injection after filter is cleared
    setTimeout(() => {
      const event = new CustomEvent('nexus:badges-refresh');
      document.dispatchEvent(event);
    }, 100);
  };

  electron.ipcRenderer.on('nexus:apply-sidebar-filter', applyFilterHandler);
  electron.ipcRenderer.on('nexus:clear-sidebar-filter', clearFilterHandler);

  // Cleanup listeners on unload
  window.addEventListener('beforeunload', () => {
    electron.ipcRenderer.removeListener('nexus:apply-sidebar-filter', applyFilterHandler);
    electron.ipcRenderer.removeListener('nexus:clear-sidebar-filter', clearFilterHandler);
  });

}
