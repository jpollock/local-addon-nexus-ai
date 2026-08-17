import { ToolRegistry } from '../../tool-registry';
import { findSitesWithPluginHandler } from './find-sites-with-plugin';
import { findSitesWithThemeHandler } from './find-sites-with-theme';
import { findOutdatedSitesHandler } from './find-outdated-sites';
import { verifySiteLiveHandler } from './verify-site-live';
import { compareSitesHandler } from './compare-sites';
import { fleetSummaryHandler } from './fleet-summary';
import { detectDriftHandler } from './detect-drift';
import { pairingProposalsHandler } from './pairing-proposals';
import { intelligenceHealthHandler } from './intelligence-health';
import { whereAmIHandler } from './where-am-i';

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
  registry.register(verifySiteLiveHandler);
  registry.register(compareSitesHandler);
  registry.register(detectDriftHandler);
  registry.register(pairingProposalsHandler);
  registry.register(intelligenceHealthHandler);
  registry.register(whereAmIHandler);
}
