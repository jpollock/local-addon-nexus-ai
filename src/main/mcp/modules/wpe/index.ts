import { ToolRegistry } from '../../tool-registry';
import { getAccountsHandler } from './get-accounts';
// Consolidated: wpe_account replaces wpe_get_account, wpe_get_account_limits,
// wpe_get_account_usage_summary, wpe_get_account_usage_insights, wpe_get_account_users
import { getAccountCombinedHandler } from './get-account-combined';
import { getAccountUserHandler } from './get-account-user';
import { createAccountUserHandler } from './create-account-user';
import { updateAccountUserHandler } from './update-account-user';
import { deleteAccountUserHandler } from './delete-account-user';
import { getInstallsHandler } from './get-installs';
// Consolidated: wpe_install replaces wpe_get_install, wpe_get_install_usage,
// wpe_get_domains, wpe_get_ssl_certificates, wpe_get_offload_settings
import { getInstallCombinedHandler } from './get-install-combined';
import { getUserInfoHandler } from './get-user-info';
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
import { fleetVersionsHandler } from './fleet-versions';
import { detectDriftHandler } from './detect-drift';
import { waitForSshHandler } from './wait-for-ssh';
import {
  setApiCredentialsHandler,
  clearApiCredentialsHandler,
  credentialsStatusHandler,
} from './api-credentials';
import { getSitesHandler } from './get-sites';
import { getSiteHandler } from './get-site';
import { createSiteHandler } from './create-site';
import { updateSiteHandler } from './update-site';
import { deleteSiteHandler } from './delete-site';
import { createInstallHandler } from './create-install';
import { updateInstallHandler } from './update-install';
import { deleteInstallHandler } from './delete-install';
import { getBackupHandler } from './get-backup';
import { refreshInstallDiskUsageHandler } from './refresh-disk-usage';
import { refreshAccountDiskUsageHandler } from './refresh-account-disk-usage';
import { getDomainsHandler } from './get-domains';
import { getDomainHandler } from './get-domain';
import { createDomainHandler } from './create-domain';
import { createDomainsBulkHandler } from './create-domains-bulk';
import { updateDomainHandler } from './update-domain';
import { deleteDomainHandler } from './delete-domain';
import { checkDomainStatusHandler } from './check-domain-status';
import { getDomainStatusReportHandler } from './get-domain-status-report';
import { getSslCertificatesHandler } from './get-ssl-certificates';
import { getDomainSslCertificateHandler } from './get-domain-ssl-certificate';
import { requestSslCertificateHandler } from './request-ssl-certificate';
import { importSslCertificateHandler } from './import-ssl-certificate';
import { getSshKeysHandler } from './get-ssh-keys';
import { createSshKeyHandler } from './create-ssh-key';
import { deleteSshKeyHandler } from './delete-ssh-key';
import { getCurrentUserHandler } from './get-current-user';
import { getOffloadSettingsHandler } from './get-offload-settings';
import { updateOffloadSettingsHandler } from './update-offload-settings';
import { getLargeFsValidationHandler } from './get-largefs-validation';
import { promoteEnvironmentHandler } from './promote-environment';
import { backupAndVerifyHandler } from './backup-and-verify';
import { accountOverviewHandler } from './account-overview';
import { installsByAccountHandler } from './installs-by-account';
import { accountDomainsHandler } from './account-domains';
import { accountSslStatusHandler } from './account-ssl-status';
import { userAuditHandler } from './user-audit';
import { fleetHealthHandler } from './fleet-health';
import { diagnoseSiteHandler } from './diagnose-site';
import { goLiveChecklistHandler } from './go-live-checklist';
import { prepareGoLiveHandler } from './prepare-go-live';
import { environmentDiffHandler } from './environment-diff';
import { portfolioOverviewHandler } from './portfolio-overview';
import { addUserToAccountsHandler } from './add-user-to-accounts';

/**
 * WPE integration module — tools for WP Engine account/install management
 * and push/pull sync between local and WPE environments.
 *
 * CAPI tools (wpe_*) gate on `isCAPIAvailable()`.
 * Local-WPE tools (local_wpe_*, nexus_list_sites) gate on `localServices`.
 */
export function registerWpeTools(registry: ToolRegistry): void {
  registry.register(getAccountsHandler);
  registry.register(getAccountCombinedHandler);   // wpe_account (replaces 5 separate read tools)
  registry.register(getAccountUserHandler);        // wpe_get_account_user (kept — needs user_id)
  registry.register(createAccountUserHandler);
  registry.register(updateAccountUserHandler);
  registry.register(deleteAccountUserHandler);
  registry.register(getInstallsHandler);
  registry.register(getInstallCombinedHandler);   // wpe_install (replaces 5 separate read tools)
  registry.register(getUserInfoHandler);           // wpe_user_info (replaces current_user + ssh_keys)
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
  // getInstallUsageHandler, getAccountUsageHandler → merged into wpe_install and wpe_account
  registry.register(portfolioUsageHandler);
  registry.register(fleetVersionsHandler);
  registry.register(detectDriftHandler);
  registry.register(waitForSshHandler);
  registry.register(setApiCredentialsHandler);
  registry.register(clearApiCredentialsHandler);
  registry.register(credentialsStatusHandler);
  registry.register(getSitesHandler);
  registry.register(getSiteHandler);
  registry.register(createSiteHandler);
  registry.register(updateSiteHandler);
  registry.register(deleteSiteHandler);
  registry.register(createInstallHandler);
  registry.register(updateInstallHandler);
  registry.register(deleteInstallHandler);
  registry.register(getBackupHandler);
  registry.register(refreshInstallDiskUsageHandler);
  registry.register(refreshAccountDiskUsageHandler);
  // Domain management (getDomains/getSslCertificates/getOffload → wpe_install include=[])
  registry.register(getDomainHandler);             // still needed: specific domain by ID
  registry.register(createDomainHandler);
  registry.register(createDomainsBulkHandler);
  registry.register(updateDomainHandler);
  registry.register(deleteDomainHandler);
  registry.register(checkDomainStatusHandler);
  registry.register(getDomainStatusReportHandler);
  // SSL management (getSslCertificates → wpe_install include=['ssl'])
  registry.register(getDomainSslCertificateHandler); // still needed: specific domain cert
  registry.register(requestSslCertificateHandler);
  registry.register(importSslCertificateHandler);
  // SSH keys (getSshKeys/getCurrentUser → wpe_user_info)
  registry.register(createSshKeyHandler);
  registry.register(deleteSshKeyHandler);
  registry.register(updateOffloadSettingsHandler);
  registry.register(getLargeFsValidationHandler);
  // Composite / workflow tools
  registry.register(promoteEnvironmentHandler);
  registry.register(backupAndVerifyHandler);
  registry.register(accountOverviewHandler);
  registry.register(installsByAccountHandler);
  registry.register(accountDomainsHandler);
  registry.register(accountSslStatusHandler);
  registry.register(userAuditHandler);
  registry.register(fleetHealthHandler);
  registry.register(diagnoseSiteHandler);
  registry.register(goLiveChecklistHandler);
  registry.register(prepareGoLiveHandler);
  registry.register(environmentDiffHandler);
  registry.register(portfolioOverviewHandler);
  registry.register(addUserToAccountsHandler);
}
