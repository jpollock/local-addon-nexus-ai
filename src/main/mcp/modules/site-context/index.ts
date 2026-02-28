import { ToolRegistry } from '../../tool-registry';
import { getSiteStructureHandler } from './get-site-structure';
import { getIndexStatusHandler } from './get-index-status';
import { listIndexedSitesHandler } from './list-indexed-sites';
import { reindexSiteHandler } from './reindex-site';

/**
 * Site-context module — structured site intelligence tools.
 * Always available (no prerequisites).
 */
export function registerSiteContextTools(registry: ToolRegistry): void {
  registry.register(getSiteStructureHandler);
  registry.register(getIndexStatusHandler);
  registry.register(listIndexedSitesHandler);
  registry.register(reindexSiteHandler);
}
