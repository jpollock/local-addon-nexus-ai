/**
 * WP Engine CAPI resolvers.
 *
 * Covers: nexusWpeStatus, nexusWpeLogin, nexusWpeLogout, nexusWpeAccounts,
 * nexusWpeInstalls, nexusWpeInstall, nexusWpeBackup, nexusWpeFleetHealth,
 * and all other nexusWpe* resolvers.
 */

import type { NexusServices } from '../../types/nexus-services';
import type { ResolverParent } from '../resolver-utils';
import {
  buildDateRange,
  getUsageCached,
  isCurrentMonthRange,
  makeUsageCacheKey,
  setUsageCached,
} from '../../mcp/modules/wpe/usage-cache';

const REQUIRES_WPE_AUTH = 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.';

export function createWpeResolvers(services: NexusServices) {
  // WPE CAPI accepts install names for the root /installs/{id} endpoint but
  // requires UUID for all sub-resource paths (/domains, /ssl_certificates, etc.)
  async function resolveInstallUuid(installId: string): Promise<string> {
    try {
      const install = await services.localServices!.capiGetInstall(installId) as any;
      return install?.id ?? installId;
    } catch {
      return installId;
    }
  }

  return {
    nexusWpeStatus: async () => {
      try {
        if (!services.localServices) return { success: true, authenticated: false };
        const userInfo = await services.localServices.wpeGetUserInfo();
        if (!userInfo) return { success: true, authenticated: false };
        return { success: true, authenticated: true, email: userInfo.email ?? null, accountName: userInfo.accountName ?? null };
      } catch (err: any) {
        return { success: false, error: err.message, authenticated: false };
      }
    },

    nexusWpeLogin: async () => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        services.localServices.wpeAuthenticate().catch(() => {});
        return { success: true, email: null };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeLogout: async () => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        await services.localServices.wpeLogout();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeSetApiCredentials: async (
      _parent: ResolverParent,
      { username, password }: { username: string; password: string }
    ) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        await services.localServices.wpeSetApiCredentials(username, password);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeClearApiCredentials: async () => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        await services.localServices.wpeClearApiCredentials();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeApiCredentialsStatus: async () => {
      try {
        if (!services.localServices) return { success: true, hasCredentials: false };
        const hasCredentials = await services.localServices.wpeGetApiCredentialsStatus().then(s => s.configured);
        return { success: true, hasCredentials };
      } catch (err: any) {
        return { success: false, error: err.message, hasCredentials: false };
      }
    },

    nexusWpeInstallUsage: async (
      _parent: ResolverParent,
      { installId, monthOffset = 0 }: { installId: string; monthOffset?: number }
    ) => {
      try {
        if (!services.localServices?.isCAPIAvailable()) {
          return { success: false, error: 'WP Engine API not available' };
        }

        const { firstDate, lastDate } = buildDateRange(monthOffset);
        const cacheKey = makeUsageCacheKey('install', installId, firstDate, lastDate);
        const cached = getUsageCached(cacheKey);
        if (cached) return { success: true, data: JSON.stringify(cached), cached: true };

        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices!.capiDirect(`/installs/${uuid}/usage?first_date=${firstDate}&last_date=${lastDate}`);
        setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));

        return { success: true, data: JSON.stringify(data), cached: false };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeAccountUsage: async (
      _parent: ResolverParent,
      { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }
    ) => {
      try {
        if (!services.localServices?.isCAPIAvailable()) {
          return { success: false, error: 'WP Engine API not available' };
        }

        const { firstDate, lastDate } = buildDateRange(monthOffset);
        const cacheKey = makeUsageCacheKey('account', accountId, firstDate, lastDate);
        const cached = getUsageCached(cacheKey);
        if (cached) return { success: true, data: JSON.stringify(cached), cached: true };

        const data = await services.localServices!.capiDirect(`/accounts/${accountId}/usage?first_date=${firstDate}&last_date=${lastDate}`);
        setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));

        return { success: true, data: JSON.stringify(data), cached: false };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeAccounts: async () => {
      try {
        if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
          return { success: false, error: REQUIRES_WPE_AUTH, accounts: [] };
        }

        const accounts = await services.localServices!.capiGetAccounts() as any[];

        return {
          success: true,
          accounts: accounts.map((acc: any) => ({ id: acc.id, name: acc.name })),
        };
      } catch (error: any) {
        return { success: false, error: error.message, accounts: [] };
      }
    },

    nexusWpeInstalls: async (_parent: ResolverParent, { account }: { account?: string }) => {
      console.log('[NEXUS DEBUG] nexusWpeInstalls resolver called, account:', account);
      try {
        const hasCapi = services.localServices?.isCAPIAvailable();
        const hasAuth = services.localServices?.isWPEAuthenticated();
        console.log('[NEXUS DEBUG] nexusWpeInstalls: hasCapi =', hasCapi, 'hasAuth =', hasAuth);

        if (!hasCapi || !hasAuth) {
          return { success: false, error: REQUIRES_WPE_AUTH, installs: [] };
        }

        const installs = await services.localServices!.capiGetInstalls() as any[];
        const accounts = await services.localServices!.capiGetAccounts() as any[];

        const accountMap = new Map<string, string>();
        accounts.forEach((acc: any) => { accountMap.set(acc.id, acc.name); });

        let filtered = installs;
        if (account) {
          filtered = installs.filter((inst: any) => {
            const accId = typeof inst.account === 'object' ? inst.account.id : inst.account;
            return accId === account || accountMap.get(accId) === account;
          });
        }

        return {
          success: true,
          installs: filtered.map((inst: any) => {
            const accId = typeof inst.account === 'object' ? inst.account.id : inst.account;
            return {
              id: inst.id,
              name: inst.name,
              account: accId,
              accountName: accountMap.get(accId) || null,
              environment: inst.environment,
              domain: inst.primaryDomain || inst.cname || `${inst.name}.wpengine.com`,
              phpVersion: inst.phpVersion || null,
              wpVersion: inst.wpVersion || null,
            };
          }),
        };
      } catch (error: any) {
        return { success: false, error: error.message, installs: [] };
      }
    },

    nexusWpeInstall: async (_parent: ResolverParent, { installId }: { installId: string }) => {
      try {
        if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
          return { success: false, error: REQUIRES_WPE_AUTH };
        }

        const install = await services.localServices.capiGetInstall(installId) as any;
        if (!install) return { success: false, error: `Install "${installId}" not found` };

        const accounts = await services.localServices!.capiGetAccounts() as any[];
        const accountMap = new Map<string, string>();
        accounts.forEach((acc: any) => { accountMap.set(acc.id, acc.name); });

        const accId = typeof install.account === 'object' ? install.account.id : install.account;

        return {
          success: true,
          install: {
            id: install.id,
            name: install.name,
            account: accId,
            accountName: accountMap.get(accId) || null,
            environment: install.environment,
            domain: install.primaryDomain || install.cname || `${install.name}.wpengine.com`,
            phpVersion: install.phpVersion || null,
            wpVersion: install.wpVersion || null,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    nexusWpeBackup: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices?.isCAPIAvailable()) {
          return { success: false, error: 'WP Engine API not available' };
        }

        const installs = await services.localServices!.capiGetInstalls() as any[];
        const install = installs.find((i: any) =>
          i.name === input.installId || i.id === input.installId
        );
        if (!install) {
          return { success: false, error: `Install "${input.installId}" not found` };
        }

        const backupResult = await services.localServices.capiCreateBackup(
          install.id,
          input.description || 'Backup created via Nexus CLI',
          input.notificationEmails || undefined
        ) as any;

        return {
          success: true,
          backupId: backupResult?.id || null,
          message: `Backup created for install ${install.name}`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    nexusWpeCache: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        await services.localServices.capiDirect(`/installs/${target}/cache_purge`, 'POST', {});
        return { success: true, message: `Cache purged for install ${target}` };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    nexusWpeAccount: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeAccountLimits: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/site_limits`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeAccountUsageSummary: async (_parent: ResolverParent, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const { firstDate, lastDate } = buildDateRange(monthOffset);
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage?first_date=${firstDate}&last_date=${lastDate}`);
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeAccountUsageInsights: async (_parent: ResolverParent, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const { firstDate, lastDate } = buildDateRange(monthOffset);
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage?first_date=${firstDate}&last_date=${lastDate}`);
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeAccountUsers: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeAccountUser: async (_parent: ResolverParent, { accountId, userId }: { accountId: string; userId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeUserAdd: async (_parent: ResolverParent, { accountId, email, firstName, lastName, role }: { accountId: string; email: string; firstName: string; lastName: string; role: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users`, 'POST', { email, first_name: firstName, last_name: lastName, roles: role }) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeUserUpdate: async (_parent: ResolverParent, { accountId, userId, role }: { accountId: string; userId: string; role: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'PATCH', { roles: role }) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeUserRemove: async (_parent: ResolverParent, { accountId, userId, confirm }: { accountId: string; userId: string; confirm?: boolean }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        if (!confirm) return { success: false, error: 'Pass --confirm to remove this user' };
        await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'DELETE');
        return { success: true, message: `User ${userId} removed` };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeUserAudit: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const accounts = accountId
          ? [{ id: accountId }]
          : await services.localServices!.capiGetAccounts() as any[];

        const results = await Promise.all((accounts || []).map(async (a: any) => {
          try {
            const users = await services.localServices!.capiDirect(`/accounts/${a.id}/account_users`);
            return { accountId: a.id, users };
          } catch { return { accountId: a.id, users: null }; }
        }));

        return { success: true, data: JSON.stringify(results) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSites: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const path = accountId ? `/accounts/${accountId}/sites` : '/sites';
        const data = await services.localServices.capiDirect(path) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSite: async (_parent: ResolverParent, { siteId }: { siteId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect(`/sites/${siteId}`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeCreateSite: async (_parent: ResolverParent, { name, accountId }: { name: string; accountId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect('/sites', 'POST', { name, account_id: accountId }) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeCreateInstall: async (_parent: ResolverParent, { siteId, name, environment, accountId }: { siteId: string; name: string; environment: string; accountId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect('/installs', 'POST', { site: siteId, name, environment, account: accountId }) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeUpdateInstall: async (_parent: ResolverParent, { installId, phpVersion, environment }: { installId: string; phpVersion?: string; environment?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const body: Record<string, string> = {};
        if (phpVersion) body.php_version = phpVersion;
        if (environment) body.environment = environment;
        const data = await services.localServices.capiDirect(`/installs/${uuid}`, 'PATCH', body) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDeleteInstall: async (_parent: ResolverParent, { installId, confirmName }: { installId: string; confirmName?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        if (!confirmName) return { success: false, error: 'Pass --confirm-name with the install name to confirm deletion' };
        const uuid = await resolveInstallUuid(installId);
        const body = confirmName ? { name: confirmName } : {};
        await services.localServices.capiDirect(`/installs/${uuid}`, 'DELETE', body);
        return { success: true, message: `Install ${installId} deleted` };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeBackupStatus: async (_parent: ResolverParent, { installId, backupId }: { installId: string; backupId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices.capiDirect(`/installs/${uuid}/backups/${backupId}`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeBackupVerify: async (_parent: ResolverParent, { installId, description }: { installId: string; description?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const backups = await services.localServices.capiDirect(`/installs/${uuid}/backups?limit=5`) as any;
        const latestBackup = ((backups as any)?.results ?? [])[0];
        if (!latestBackup) return { success: false, error: 'No backups found for this install' };
        return { success: true, data: JSON.stringify(latestBackup) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDomains: async (_parent: ResolverParent, { installId }: { installId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices.capiDirect(`/installs/${uuid}/domains`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDomainAdd: async (_parent: ResolverParent, { installId, domain }: { installId: string; domain: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices.capiDirect(`/installs/${uuid}/domains`, 'POST', { name: domain }) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDomainRemove: async (_parent: ResolverParent, { installId, domainId, confirm }: { installId: string; domainId: string; confirm?: boolean }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        if (!confirm) return { success: false, error: 'Pass --confirm to remove this domain' };
        const uuid = await resolveInstallUuid(installId);
        await services.localServices.capiDirect(`/installs/${uuid}/domains/${domainId}`, 'DELETE');
        return { success: true, message: `Domain ${domainId} removed` };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDomainCheck: async (_parent: ResolverParent, { installId, domainId }: { installId: string; domainId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices.capiDirect(`/installs/${uuid}/domains/${domainId}/check`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSslCertificates: async (_parent: ResolverParent, { installId }: { installId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const data = await services.localServices.capiDirect(`/installs/${uuid}/ssl_certificates`) as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSslRequest: async (_parent: ResolverParent, { installId, domainIds }: { installId: string; domainIds: string[] }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        await services.localServices.capiDirect(`/installs/${uuid}/ssl_certificates`, 'POST', { domain_ids: domainIds });
        return { success: true, message: 'SSL certificate provisioning requested' };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSshKeys: async () => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect('/ssh_keys') as any;
        return { success: true, data: JSON.stringify(data) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSshKeyAdd: async (_parent: ResolverParent, { label, publicKey }: { label: string; publicKey: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const data = await services.localServices.capiDirect('/ssh_keys', 'POST', { public_key: publicKey }) as any;
        return { success: true, keyId: data?.id, label: data?.label };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeSshKeyRemove: async (_parent: ResolverParent, { sshKeyId, confirm }: { sshKeyId: string; confirm?: boolean }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        if (!confirm) return { success: false, error: 'Pass --confirm to remove this SSH key' };
        await services.localServices.capiDirect(`/ssh_keys/${sshKeyId}`, 'DELETE');
        return { success: true, message: `SSH key ${sshKeyId} removed` };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpePromote: async (_parent: ResolverParent, { sourceInstallId, destInstallId, includeDatabase, confirm }: { sourceInstallId: string; destInstallId: string; includeDatabase?: boolean; confirm?: boolean }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const [src, dst] = await Promise.all([
          services.localServices.capiDirect(`/installs/${sourceInstallId}`) as Promise<any>,
          services.localServices.capiDirect(`/installs/${destInstallId}`) as Promise<any>,
        ]);
        if (!confirm) {
          return {
            success: true,
            requiresConfirmation: true,
            message: `This will overwrite "${(dst as any)?.name}" (${(dst as any)?.environment}) with content from "${(src as any)?.name}" (${(src as any)?.environment}). Pass --confirm to proceed.`,
          };
        }
        await services.localServices.capiDirect('/install_copy', 'POST', {
          source_environment_id: (src as any)?.id ?? sourceInstallId,
          destination_environment_id: (dst as any)?.id ?? destInstallId,
          custom_options: { include_files: true, include_db: includeDatabase !== false },
        });
        return { success: true, message: `Promotion started from ${sourceInstallId} to ${destInstallId}` };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeDiagnose: async (_parent: ResolverParent, { installId }: { installId: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const install = await services.localServices.capiGetInstall(installId) as any;
        if (!install) return { success: false, error: `Install "${installId}" not found` };
        const uuid = install.id ?? installId;
        const [domains, ssl, backups] = await Promise.all([
          services.localServices.capiDirect(`/installs/${uuid}/domains`).catch(() => null) as Promise<any>,
          services.localServices.capiDirect(`/installs/${uuid}/ssl_certificates`).catch(() => null) as Promise<any>,
          services.localServices.capiDirect(`/installs/${uuid}/backups?limit=1`).catch(() => null) as Promise<any>,
        ]);
        return { success: true, data: JSON.stringify({ install, domains, ssl, backups }) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeGoLiveCheck: async (_parent: ResolverParent, { installId, domain }: { installId: string; domain: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const uuid = await resolveInstallUuid(installId);
        const [domainsData, ssl] = await Promise.all([
          services.localServices.capiDirect(`/installs/${uuid}/domains`) as Promise<any>,
          services.localServices.capiDirect(`/installs/${uuid}/ssl_certificates`).catch(() => null) as Promise<any>,
        ]);
        const domainEntry = ((domainsData as any)?.results ?? []).find((d: any) => d.name === domain);
        return { success: true, data: JSON.stringify({ domain, domainAdded: !!domainEntry, domainId: domainEntry?.id, ssl }) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpeFleetHealth: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const installs = await services.localServices!.capiGetInstalls() as any[];
        const filtered = accountId ? installs.filter((i: any) => {
          const aid = typeof i.account === 'object' ? i.account?.id : i.account;
          return aid === accountId;
        }) : installs;
        const withSsl = await Promise.all((filtered || []).map(async (install: any) => {
          let ssl = null;
          try { ssl = await services.localServices!.capiDirect(`/installs/${install.id}/ssl_certificates`); } catch {}
          return { ...install, ssl };
        }));
        return { success: true, data: JSON.stringify(withSsl) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },

    nexusWpePortfolioOverview: async (_parent: ResolverParent, { monthOffset = 0 }: { monthOffset?: number }) => {
      try {
        if (!services.localServices) return { success: false, error: 'Local services not available' };
        const { firstDate, lastDate } = buildDateRange(monthOffset);
        const [accounts, installs] = await Promise.all([
          services.localServices!.capiGetAccounts() as Promise<any[]>,
          services.localServices.capiGetInstalls() as Promise<any[]>,
        ]);
        const usage = await Promise.all((accounts || []).map(async (a: any) => {
          try {
            const d = await services.localServices!.capiDirect(`/accounts/${a.id}/usage?first_date=${firstDate}&last_date=${lastDate}`);
            return { accountId: a.id, accountName: a.name, usage: d };
          } catch { return { accountId: a.id, accountName: a.name, usage: null }; }
        }));
        return { success: true, data: JSON.stringify({ accounts, installs, usage, period: { firstDate, lastDate } }) };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
  };
}
