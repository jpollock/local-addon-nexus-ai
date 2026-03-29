import { ToolRegistry } from '../../tool-registry';
import { scanDatabaseHealthHandler } from './scan-handler';
import { getDatabaseRecommendationsHandler } from './recommendations-handler';
import { cleanDatabaseItemsHandler } from './clean-handler';

/**
 * Database Scanner module — registers 3 MCP tools:
 * - scan_database_health (Tier 1)
 * - get_database_recommendations (Tier 1)
 * - clean_database_items (Tier 3)
 */
export function registerDbScannerTools(registry: ToolRegistry): void {
  registry.register(scanDatabaseHealthHandler);
  registry.register(getDatabaseRecommendationsHandler);
  registry.register(cleanDatabaseItemsHandler);
}
