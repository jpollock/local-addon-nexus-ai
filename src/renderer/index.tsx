import { SidebarBadgeManager } from './SidebarBadgeManager';
import { NavItemInjector } from './NavItemInjector';
import { SiteHeaderBadge } from './components/SiteHeaderBadge';
import { FleetOverview } from './components/FleetOverview';
import { FleetBreadcrumb } from './components/FleetBreadcrumb';

export default function renderer(context: any): void {
  const { React, hooks, ReactRouter } = context;
  const { Route, NavLink } = ReactRouter;
  const electron = context.electron || (window as any).electron;

  // Feature 1a: Sidebar WPE badges (DOM injection)
  const manager = new SidebarBadgeManager(electron);
  manager.initialize();

  // Fleet nav item in vertical sidebar (DOM injection)
  const navInjector = new NavItemInjector();
  navInjector.initialize();

  // Feature 1b: Header WPE badge
  hooks.addContent('SiteInfo_Top_TopRight', (site: any, siteStatus: string) =>
    React.createElement(SiteHeaderBadge, { site, siteStatus }),
  );

  // Feature 2: Fleet Overview route
  hooks.addContent('routes[main]', () =>
    React.createElement(Route, {
      path: '/main/fleet-overview',
      render: () => React.createElement(FleetOverview, { NavLink, electron }),
    }),
  );

  // Feature 3: Fleet breadcrumb on site overview pages
  hooks.addContent('SiteInfoOverview:Before', () =>
    React.createElement(FleetBreadcrumb, { NavLink }),
  );
}
