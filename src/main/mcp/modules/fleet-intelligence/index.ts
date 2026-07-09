import type { ToolRegistry } from '../../tool-registry';
import { fleetHealthSummaryHandler } from './fleet-health-summary';
import { getSiteHealthHandler } from './get-site-health';
import { fleetSearchHandler } from './fleet-search';
import { fleetFilterHandler } from './fleet-filter';
import { bulkReindexHandler } from './bulk-reindex';
import { bulkPluginUpdateHandler } from './bulk-plugin-update';
import { listSiteGroupsHandler } from './list-site-groups';
import { manageSiteGroupHandler } from './manage-site-group';
import { fleetSummaryHandler } from './fleet-summary';
import { fleetPluginsHandler } from './fleet-plugins';
import { fleetSqlHandler } from './fleet-sql';
import { fleetOverviewHandler } from './fleet-overview';

export function registerFleetIntelligenceTools(registry: ToolRegistry): void {
  registry.register(fleetHealthSummaryHandler);
  registry.register(getSiteHealthHandler);
  registry.register(fleetSearchHandler);
  registry.register(fleetFilterHandler);
  registry.register(bulkReindexHandler);
  registry.register(bulkPluginUpdateHandler);
  registry.register(listSiteGroupsHandler);
  registry.register(manageSiteGroupHandler);
  registry.register(fleetSummaryHandler);
  registry.register(fleetPluginsHandler);
  registry.register(fleetSqlHandler);
  registry.register(fleetOverviewHandler);
}
