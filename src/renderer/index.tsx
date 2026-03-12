// import { SidebarBadgeManager } from './SidebarBadgeManager'; // DEPRECATED - replaced by SidebarWPEInjector
import { SidebarWPEInjector } from './SidebarWPEInjector';
import { NavItemInjector } from './NavItemInjector';
import { SiteHeaderBadge } from './components/SiteHeaderBadge';
import { Fleet } from './components/Fleet';
import { NexusOverview } from './components/NexusOverview';
import { ContentBrowser } from './components/ContentBrowser';
import { NexusPreferences } from './components/NexusPreferences';
import { SiteNexusSection } from './components/SiteNexusSection';
import { SidebarSearchPanel } from './components/SidebarSearchPanel';
import { ChatPanel } from './components/ChatPanel';
import { SiteInfoWPE } from './components/SiteInfoWPE';
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

  // Feature 1a: Sidebar WPE badges (DOM injection) - DEPRECATED
  // NOTE: Disabled in favor of SidebarWPEInjector which handles all badges
  // try {
  //   console.log('[Nexus AI] Initializing SidebarBadgeManager...');
  //   const manager = new SidebarBadgeManager(electron);
  //   manager.initialize();
  //   console.log('[Nexus AI] SidebarBadgeManager initialized');
  // } catch (err) {
  //   console.error('[Nexus AI] SidebarBadgeManager failed:', err);
  // }

  // Feature 1b: Sidebar WPE sites + enhanced badges (DOM injection)
  try {
    console.log('[Nexus AI] Initializing SidebarWPEInjector...');
    const wpeInjector = new SidebarWPEInjector(electron);
    // Run initialization asynchronously (don't block renderer)
    wpeInjector.initialize().catch((err: Error) => {
      console.error('[Nexus AI] SidebarWPEInjector async init failed:', err);
    });
    console.log('[Nexus AI] SidebarWPEInjector started (async)');
  } catch (err) {
    console.error('[Nexus AI] SidebarWPEInjector failed:', err);
  }

  // Fleet nav item in vertical sidebar (DOM injection)
  try {
    console.log('[Nexus AI] Initializing NavItemInjector...');
    const navInjector = new NavItemInjector();
    navInjector.initialize();
    console.log('[Nexus AI] NavItemInjector initialized');
  } catch (err) {
    console.error('[Nexus AI] NavItemInjector failed:', err);
  }

  // Feature 1b: Header WPE badge
  hooks.addContent('SiteInfo_Top_TopRight', (site: any, siteStatus: string) =>
    React.createElement(SiteHeaderBadge, { site, siteStatus }),
  );

  // Feature 2: Nexus AI Overview route
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/nexus',
      render: () => React.createElement(NexusOverview, { NavLink, electron }),
    }),
  );

  // Feature 3: Fleet Management route (power user interface)
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/fleet',
      render: () => React.createElement(Fleet, { electron }),
    }),
  );

  // Feature 3a: Content Browser route (indexed content search)
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/content',
      render: () => React.createElement(ContentBrowser, { electron }),
    }),
  );

  // Feature 3b: WPE Site Info route (for remote WPE sites)
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/site-info-wpe/:installId',
      render: (props: any) => React.createElement(SiteInfoWPE, {
        electron,
        installId: props.match.params.installId,
      }),
    }),
  );

  // Feature 4: Addon preferences page
  hooks.addFilter('preferencesMenuItems', (items: any[]) => {
    return [...items, {
      path: '/nexus-ai',
      displayName: 'Nexus AI',
      sections: () => React.createElement(NexusPreferences, { electron }),
      onApply: async () => { /* Settings saved inline on change */ },
    }];
  });

  // Feature 5: Per-site Nexus AI section on site overview
  hooks.addFilter('SiteInfoOverview_Addon_Section', (sections: any[], site: any) => {
    return [...sections, {
      title: 'Nexus AI',
      component: React.createElement(SiteNexusSection, { site, electron, TextButton }),
    }];
  });

  // Feature 6: Sidebar Search Panel
  // Add search button to sidebar header and keyboard shortcut (Cmd+K / Ctrl+K)
  let searchContainerInstance: SidebarSearchContainer | null = null;

  class SidebarSearchContainer extends React.Component<any, { isOpen: boolean; hasLLM: boolean }> {
    state = { isOpen: false, hasLLM: false };

    componentDidMount() {
      searchContainerInstance = this;

      // Check if LLM is configured
      electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS).then((settings: any) => {
        this.setState({ hasLLM: !!settings?.chatProvider });
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
      searchButton.style.color = '#fff';
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

  // Use MutationObserver to wait for sidebar to load
  const observer = new MutationObserver(() => {
    if (injectSearchButton()) {
      observer.disconnect();
    }
  });

  // Start observing
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

    // Update search button color to indicate filter state
    const searchBtn = document.querySelector('#nexus-search-btn') as HTMLElement;
    if (searchBtn) {
      searchBtn.style.color = filterActive ? '#51BB7B' : '#7e7e7e';
      searchBtn.title = filterActive
        ? 'Clear filter (show all sites)'
        : 'AI Site Finder (Cmd+K / Ctrl+K)';
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
  electron.ipcRenderer.on('nexus:apply-sidebar-filter', (_event: any, siteIds: string[]) => {
    applySiteFilter(siteIds);
    // Trigger badge re-injection after filter is applied
    setTimeout(() => {
      const event = new CustomEvent('nexus:badges-refresh');
      document.dispatchEvent(event);
    }, 100);
  });

  // Clear filter when search closes
  electron.ipcRenderer.on('nexus:clear-sidebar-filter', () => {
    applySiteFilter([]);
    // Trigger badge re-injection after filter is cleared
    setTimeout(() => {
      const event = new CustomEvent('nexus:badges-refresh');
      document.dispatchEvent(event);
    }, 100);
  });

  // Feature 7: Global Chat Panel
  // Slide-out AI chat accessible from anywhere (Cmd+J / Ctrl+J)
  let chatPanelInstance: ChatPanelContainer | null = null;

  class ChatPanelContainer extends React.Component<any, { isOpen: boolean }> {
    state = { isOpen: false };

    componentDidMount() {
      chatPanelInstance = this;

      // Register keyboard shortcut (Cmd+J / Ctrl+J)
      document.addEventListener('keydown', this.handleKeyDown);
    }

    componentWillUnmount() {
      document.removeEventListener('keydown', this.handleKeyDown);
      chatPanelInstance = null;
    }

    handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+J / Ctrl+J - toggle chat panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        this.toggleChat();
      }
    };

    toggleChat = () => {
      this.setState({ isOpen: !this.state.isOpen });
    };

    render() {
      return React.createElement(ChatPanel, {
        electron,
        isOpen: this.state.isOpen,
        onClose: () => this.setState({ isOpen: false }),
      });
    }
  }

  // Mount chat panel container to body
  const chatContainer = document.createElement('div');
  chatContainer.id = 'nexus-chat-panel';
  document.body.appendChild(chatContainer);

  ReactDOM.render(React.createElement(ChatPanelContainer), chatContainer);

  // Inject floating chat button (bottom-right corner)
  const injectChatButton = () => {
    console.log('[Nexus AI] Attempting to inject floating chat button...');

    // Check if button already exists
    if (document.querySelector('#nexus-chat-btn')) {
      console.log('[Nexus AI] Chat button already exists');
      return true;
    }

    console.log('[Nexus AI] Injecting chat button');

    const chatButton = document.createElement('button');
    chatButton.id = 'nexus-chat-btn';
    chatButton.title = 'Open AI Chat (Cmd+J / Ctrl+J)';

    // Chat bubble icon
    chatButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
        <circle cx="8" cy="11" r="1.5" fill="#fff"/>
        <circle cx="12" cy="11" r="1.5" fill="#fff"/>
        <circle cx="16" cy="11" r="1.5" fill="#fff"/>
      </svg>
    `;

    chatButton.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #51bb7b;
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(81, 187, 123, 0.4);
      transition: transform 0.2s, box-shadow 0.2s;
      z-index: 99998;
    `;

    chatButton.addEventListener('mouseenter', () => {
      chatButton.style.transform = 'scale(1.05)';
      chatButton.style.boxShadow = '0 6px 16px rgba(81, 187, 123, 0.5)';
    });

    chatButton.addEventListener('mouseleave', () => {
      chatButton.style.transform = 'scale(1)';
      chatButton.style.boxShadow = '0 4px 12px rgba(81, 187, 123, 0.4)';
    });

    chatButton.addEventListener('click', () => {
      console.log('[Nexus AI] Chat button clicked');
      if (chatPanelInstance) {
        chatPanelInstance.toggleChat();
      }
    });

    document.body.appendChild(chatButton);
    console.log('[Nexus AI] Chat button injected successfully');
    return true;
  };

  // Inject immediately and with delays
  setTimeout(injectChatButton, 100);
  setTimeout(injectChatButton, 500);
  setTimeout(injectChatButton, 1000);
}
