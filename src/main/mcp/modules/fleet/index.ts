import { ToolRegistry } from '../../tool-registry';
import { findSitesWithPluginHandler } from './find-sites-with-plugin';
import { findSitesWithThemeHandler } from './find-sites-with-theme';
import { findOutdatedSitesHandler } from './find-outdated-sites';
import { compareSitesHandler } from './compare-sites';
import { fleetSummaryHandler } from './fleet-summary';
import { detectDriftHandler } from './detect-drift';

/**
 * Fleet module — cross-site aggregation and comparison tools.
 * Operates on IndexRegistry's persisted structure data.
 * No vector store or embeddings needed. Works even when sites are stopped.
 */
export function registerFleetTools(registry: ToolRegistry): void {
  registry.register(fleetSummaryHandler);
  registry.register(findSitesWithPluginHandler);
  registry.register(findSitesWithThemeHandler);
  registry.register(findOutdatedSitesHandler);
  registry.register(compareSitesHandler);
  registry.register(detectDriftHandler);
}
