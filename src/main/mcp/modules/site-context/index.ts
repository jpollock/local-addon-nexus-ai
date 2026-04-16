import { ToolRegistry } from '../../tool-registry';
import { getSiteStructureHandler } from './get-site-structure';
import { getIndexStatusHandler } from './get-index-status';
import { listIndexedSitesHandler } from './list-indexed-sites';
import { reindexSiteHandler } from './reindex-site';
import { refreshSiteHandler } from './refresh-site';
import { fleetRefreshHandler } from './fleet-refresh';
import { siteStatusHandler } from './site-status';
import { getSiteTwinHandler } from './get-site-twin';
import { getFleetTwinsHandler } from './get-fleet-twins';

/**
 * Site-context module — structured site intelligence tools.
 * Always available (no prerequisites).
 */
export function registerSiteContextTools(registry: ToolRegistry): void {
  registry.register(getSiteStructureHandler);
  registry.register(getIndexStatusHandler);
  registry.register(listIndexedSitesHandler);
  registry.register(reindexSiteHandler);
  registry.register(refreshSiteHandler);
  registry.register(fleetRefreshHandler);
  registry.register(siteStatusHandler);
  registry.register(getSiteTwinHandler);
  registry.register(getFleetTwinsHandler);
}
