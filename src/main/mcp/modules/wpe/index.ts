import { ToolRegistry } from '../../tool-registry';
import { getAccountsHandler } from './get-accounts';
import { getInstallsHandler } from './get-installs';
import { getInstallHandler } from './get-install';
import { createBackupHandler } from './create-backup';
import { purgeCacheHandler } from './purge-cache';
import { wpeLinkHandler } from './wpe-link';
import { wpePullHandler } from './wpe-pull';
import { wpePushHandler } from './wpe-push';
import { nexusListSitesHandler } from './nexus-list-sites';
import { getSiteChangesHandler } from './get-site-changes';
import { getSyncHistoryHandler } from './get-sync-history';
import { wpeStatusHandler, wpeLoginHandler, wpeLogoutHandler } from './authenticate';
import { getInstallUsageHandler, getAccountUsageHandler } from './get-install-usage';
import { portfolioUsageHandler } from './portfolio-usage';

/**
 * WPE integration module — tools for WP Engine account/install management
 * and push/pull sync between local and WPE environments.
 *
 * CAPI tools (wpe_*) gate on `isCAPIAvailable()`.
 * Local-WPE tools (local_wpe_*, nexus_list_sites) gate on `localServices`.
 */
export function registerWpeTools(registry: ToolRegistry): void {
  registry.register(getAccountsHandler);
  registry.register(getInstallsHandler);
  registry.register(getInstallHandler);
  registry.register(createBackupHandler);
  registry.register(purgeCacheHandler);
  registry.register(wpeLinkHandler);
  registry.register(wpePullHandler);
  registry.register(wpePushHandler);
  registry.register(nexusListSitesHandler);
  registry.register(getSiteChangesHandler);
  registry.register(getSyncHistoryHandler);
  registry.register(wpeStatusHandler);
  registry.register(wpeLoginHandler);
  registry.register(wpeLogoutHandler);
  registry.register(getInstallUsageHandler);
  registry.register(getAccountUsageHandler);
  registry.register(portfolioUsageHandler);
}
