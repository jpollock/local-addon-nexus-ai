import { ToolRegistry } from '../../tool-registry';
import { listSitesHandler } from './list-sites';
import { getSiteHandler } from './get-site';
import { startSiteHandler } from './start-site';
import { stopSiteHandler } from './stop-site';
import { restartSiteHandler } from './restart-site';
import { createSiteHandler } from './create-site';
import { deleteSiteHandler } from './delete-site';
import { cloneSiteHandler } from './clone-site';
import { exportSiteHandler } from './export-site';
import { changePhpVersionHandler } from './change-php-version';
import { trustSslHandler } from './trust-ssl';
import { toggleXdebugHandler } from './toggle-xdebug';
import { renameSiteHandler } from './rename-site';
import { importSiteHandler } from './import-site';
import { listBlueprintsHandler } from './list-blueprints';
import { saveBlueprintHandler } from './save-blueprint';
import { getSiteLogsHandler } from './get-site-logs';

/**
 * Site management module — lifecycle tools for local WordPress sites.
 * Requires `localServices` on NexusServices (gated via isAvailable).
 */
export function registerSiteManagementTools(registry: ToolRegistry): void {
  registry.register(listSitesHandler);
  registry.register(getSiteHandler);
  registry.register(startSiteHandler);
  registry.register(stopSiteHandler);
  registry.register(restartSiteHandler);
  registry.register(createSiteHandler);
  registry.register(deleteSiteHandler);
  registry.register(cloneSiteHandler);
  registry.register(exportSiteHandler);
  registry.register(changePhpVersionHandler);
  registry.register(trustSslHandler);
  registry.register(toggleXdebugHandler);
  registry.register(renameSiteHandler);
  registry.register(importSiteHandler);
  registry.register(listBlueprintsHandler);
  registry.register(saveBlueprintHandler);
  registry.register(getSiteLogsHandler);
}
