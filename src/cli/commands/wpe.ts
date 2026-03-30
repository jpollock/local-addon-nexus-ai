/**
 * WPE Commands
 *
 * Manage WP Engine accounts and installs.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getClient } from '../utils/graphql';

// ---------------------------------------------------------------------------
// Local's built-in GraphQL client (for WPE auth — different from addon GQL)
// ---------------------------------------------------------------------------

interface LocalConnectionInfo {
  url: string;
  authToken: string;
  port: number;
}

function getLocalConnectionInfo(): LocalConnectionInfo | null {
  const dataDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'Local')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const infoFile = path.join(dataDir, 'graphql-connection-info.json');
  try {
    return JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
  } catch {
    return null;
  }
}

async function localGql<T>(query: string, timeout = 120000): Promise<T> {
  const info = getLocalConnectionInfo();
  if (!info) throw new Error('Could not connect to Local. Is Local running?');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${info.authToken}`,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    const json = await res.json() as { data?: T; errors?: any[] };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  } finally {
    clearTimeout(id);
  }
}

const wpeCommand = new Command('wpe').description('Manage WP Engine accounts and installs');

/**
 * nexus wpe accounts
 */
wpeCommand
  .command('accounts')
  .description('List WP Engine accounts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeAccounts: any }>(`
        mutation {
          nexusWpeAccounts {
            success
            error
            accounts {
              id
              name
            }
          }
        }
      `);

      const { success, error, accounts } = result.nexusWpeAccounts;

      if (!success) {
        console.error(`\n❌ Failed to list accounts: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(accounts, null, 2));
        return;
      }

      console.log('\nWP Engine Accounts:');
      if (accounts.length === 0) {
        console.log('  (none - not authenticated or no accounts)');
      } else {
        for (const account of accounts) {
          console.log(`  ${account.name}`);
          console.log(`    ID: ${account.id}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe installs
 */
wpeCommand
  .command('installs [account]')
  .description('List installs for an account (or all accounts)')
  .option('--json', 'Output as JSON')
  .action(async (account, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeInstalls: any }>(`
        mutation($account: String) {
          nexusWpeInstalls(account: $account) {
            success
            error
            installs {
              id
              name
              account
              accountName
              environment
              domain
            }
          }
        }
      `, { account: account || null });

      const { success, error, installs } = result.nexusWpeInstalls;

      if (!success) {
        console.error(`\n❌ Failed to list installs: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(installs, null, 2));
        return;
      }

      console.log('\nWP Engine Installs:');
      if (installs.length === 0) {
        console.log('  (none)');
      } else {
        for (const install of installs) {
          console.log(`  ${install.name} (${install.environment})`);
          console.log(`    Account: ${install.accountName || install.account}`);
          console.log(`    Domain:  ${install.domain}`);
          console.log(`    Target:  wpe:${install.account}/${install.name}@${install.environment}`);
          console.log('');
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe install
 */
wpeCommand
  .command('install <installId>')
  .description('Get details about a specific install')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeInstall: any }>(`
        mutation($installId: String!) {
          nexusWpeInstall(installId: $installId) {
            success
            error
            install {
              id
              name
              account
              accountName
              environment
              domain
              phpVersion
              wpVersion
            }
          }
        }
      `, { installId });

      const { success, error, install } = result.nexusWpeInstall;

      if (!success) {
        console.error(`\n❌ Failed to get install: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(install, null, 2));
        return;
      }

      console.log(`\n${install.name}`);
      console.log('─'.repeat(Math.max(install.name.length, 40)));
      console.log(`Environment:  ${install.environment}`);
      console.log(`Account:      ${install.accountName || install.account}`);
      console.log(`Domain:       ${install.domain}`);
      if (install.wpVersion) {
        console.log(`WordPress:    ${install.wpVersion}`);
      }
      if (install.phpVersion) {
        console.log(`PHP:          ${install.phpVersion}`);
      }
      console.log(`Target:       wpe:${install.account}/${install.name}@${install.environment}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe backup
 */
wpeCommand
  .command('backup <target>')
  .description('Create a backup of a WPE install')
  .option('--description <text>', 'Backup description')
  .action(async (target, options) => {
    try {
      const client = getClient({ timeout: 300000 }); // 5 min for backup

      console.log(`\nCreating backup for ${target}...`);

      const result = await client.mutate<{ nexusWpeBackup: any }>(`
        mutation($input: NexusWpeBackupInput!) {
          nexusWpeBackup(input: $input) {
            success
            error
            backupId
          }
        }
      `, {
        input: {
          target,
          description: options.description || null,
        },
      });

      const { success, error, backupId } = result.nexusWpeBackup;

      if (!success) {
        console.error(`\n❌ Failed to create backup: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Backup created`);
      console.log(`   ID: ${backupId}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe cache
 */
wpeCommand
  .command('cache <target>')
  .description('Purge WPE install cache')
  .option('--purge', 'Purge cache (required)')
  .action(async (target, options) => {
    try {
      if (!options.purge) {
        console.error('\n❌ Must specify --purge to confirm cache purge');
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nPurging cache for ${target}...`);

      const result = await client.mutate<{ nexusWpeCache: any }>(`
        mutation($target: String!) {
          nexusWpeCache(target: $target) {
            success
            error
          }
        }
      `, { target });

      const { success, error } = result.nexusWpeCache;

      if (!success) {
        console.error(`\n❌ Failed to purge cache: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Cache purged successfully`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe link
 */
wpeCommand
  .command('link <localSite> <wpeTarget>')
  .description('Link a local site to a WPE install')
  .action(async (localSite, wpeTarget, options) => {
    try {
      // Enforce @local syntax
      if (!localSite.endsWith('@local')) {
        console.error('\n❌ Local site must use @local format.');
        console.error(`   Use: nexus wpe link ${localSite}@local ${wpeTarget}`);
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nLinking ${localSite} to ${wpeTarget}...`);

      const result = await client.mutate<{ nexusWpeLink: any }>(`
        mutation($input: NexusWpeLinkInput!) {
          nexusWpeLink(input: $input) {
            success
            error
          }
        }
      `, {
        input: {
          localSite,
          wpeTarget,
        },
      });

      const { success, error } = result.nexusWpeLink;

      if (!success) {
        console.error(`\n❌ Failed to link: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Sites linked successfully`);
      console.log(`   ${localSite} ↔ ${wpeTarget}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe changes
 */
wpeCommand
  .command('changes <localSite>')
  .description('View changes between local and WPE')
  .option('--since <date>', 'Show changes since date')
  .action(async (localSite, options) => {
    try {
      if (!localSite.endsWith('@local')) {
        console.error('\n❌ Local site must use @local format.');
        console.error(`   Use: nexus wpe changes ${localSite}@local`);
        process.exit(1);
      }

      const client = getClient();

      const result = await client.mutate<{ nexusWpeChanges: any }>(`
        mutation($input: NexusWpeChangesInput!) {
          nexusWpeChanges(input: $input) {
            success
            error
            changes {
              type
              path
              status
            }
          }
        }
      `, {
        input: {
          localSite,
          since: options.since || null,
        },
      });

      const { success, error, changes } = result.nexusWpeChanges;

      if (!success) {
        console.error(`\n❌ Failed to get changes: ${error}`);
        process.exit(1);
      }

      console.log(`\nChanges for ${localSite}:`);
      if (changes.length === 0) {
        console.log('  (no changes)');
      } else {
        for (const change of changes) {
          const icon = change.type === 'added' ? '+' : change.type === 'modified' ? '~' : '-';
          console.log(`  ${icon} ${change.path}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe status
// ---------------------------------------------------------------------------

wpeCommand
  .command('status')
  .description('Show WP Engine authentication status')
  .action(async () => {
    try {
      const client = getClient({ timeout: 10000 });
      const data = await client.mutate<{ nexusWpeStatus: any }>(`
        mutation { nexusWpeStatus { success error authenticated email accountName } }
      `, {});
      const { authenticated, email, accountName, error } = data.nexusWpeStatus;
      if (error) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log('');
      if (authenticated && email) {
        console.log(`✅ Authenticated as ${email}${accountName ? ` (${accountName})` : ''}`);
      } else {
        console.log('⚫ Not authenticated with WP Engine');
        console.log('\nRun: nexus wpe login');
      }
      console.log('');
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe login
// ---------------------------------------------------------------------------

wpeCommand
  .command('login')
  .description('Authenticate with WP Engine (opens browser)')
  .action(async () => {
    try {
      const client = getClient({ timeout: 10000 });

      // Start auth flow (fire-and-forget in main process — Express server stays alive)
      const start = await client.mutate<{ nexusWpeLogin: any }>(`
        mutation { nexusWpeLogin { success error } }
      `, {});

      if (!start.nexusWpeLogin.success) {
        console.error(`\n❌ ${start.nexusWpeLogin.error}`);
        process.exit(1);
      }

      console.log('\n🔐 Browser opened for WP Engine authentication.');
      console.log('   Complete the login in your browser, then wait...\n');

      // Poll until authenticated (up to 3 minutes)
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        process.stdout.write('.');
        try {
          const status = await client.mutate<{ nexusWpeStatus: any }>(`
            mutation { nexusWpeStatus { success authenticated email accountName } }
          `, {});
          if (status.nexusWpeStatus?.authenticated) {
            const { email, accountName } = status.nexusWpeStatus;
            console.log(`\n\n✅ Authenticated as ${email}${accountName ? ` (${accountName})` : ''}\n`);
            return;
          }
        } catch { /* keep polling */ }
      }

      console.log('\n\n⚠️  Timed out waiting. Run: nexus wpe status\n');
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe logout
// ---------------------------------------------------------------------------

wpeCommand
  .command('logout')
  .description('Log out of WP Engine')
  .action(async () => {
    try {
      const client = getClient({ timeout: 10000 });
      const data = await client.mutate<{ nexusWpeLogout: any }>(`
        mutation { nexusWpeLogout { success error } }
      `, {});
      if (!data.nexusWpeLogout.success) {
        console.error(`\n❌ Logout failed: ${data.nexusWpeLogout.error || 'Unknown error'}`);
        process.exit(1);
      }
      console.log('\n✅ Logged out of WP Engine\n');
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Shared usage formatting helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number | string | undefined | null): string {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : (bytes ?? 0);
  if (!n || isNaN(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatNum(v: number | string | undefined | null): string {
  const n = typeof v === 'string' ? parseInt(v, 10) : (v ?? 0);
  if (!n || isNaN(n)) return '0';
  return new Intl.NumberFormat('en-US').format(n);
}

function printUsage(
  label: string,
  data: any,
  opts: { firstDate: string; lastDate: string; cached: boolean; cachedAgeMinutes: number },
): void {
  const r = data?.metrics_rollup ?? {};
  const monthLabel = (() => {
    const [y, m] = opts.firstDate.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  })();

  const line = '─'.repeat(42);
  console.log(`\n${label} — ${monthLabel}`);
  console.log(line);
  console.log(`  Visits (total):    ${formatNum(r.visit_count?.sum)}`);
  console.log(`  Billable visits:   ${formatNum(r.billable_visits?.sum)}`);
  console.log(`  Bandwidth:         ${formatBytes(r.network_total_bytes?.sum)}`);
  console.log(`  File storage:      ${formatBytes(r.storage_file_bytes?.latest?.value)}`);
  console.log(`  DB storage:        ${formatBytes(r.storage_database_bytes?.latest?.value)}`);
  console.log(line);
  console.log(`  Period:  ${opts.firstDate} → ${opts.lastDate}`);
  if (opts.cached) {
    console.log(`  Cached:  yes (${opts.cachedAgeMinutes}m old)`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// nexus wpe usage
// ---------------------------------------------------------------------------

wpeCommand
  .command('usage <installId>')
  .description('Show bandwidth, storage, and visitor usage for a WP Engine install')
  .option('--month-offset <n>', 'Month offset (0 = current, 1 = last month)', '0')
  .option('--json', 'Output raw JSON')
  .action(async (installId, options) => {
    try {
      const monthOffset = parseInt(options.monthOffset ?? '0', 10);
      const client = getClient();

      const result = await client.mutate<{ nexusWpeInstallUsage: any }>(`
        mutation($installId: String!, $monthOffset: Int) {
          nexusWpeInstallUsage(installId: $installId, monthOffset: $monthOffset) {
            success
            error
            data
            cached
            cachedAgeMinutes
            firstDate
            lastDate
          }
        }
      `, { installId, monthOffset });

      const { success, error, data, cached, cachedAgeMinutes, firstDate, lastDate } =
        result.nexusWpeInstallUsage;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      const parsed = JSON.parse(data);

      if (options.json) {
        console.log(JSON.stringify(parsed, null, 2));
        return;
      }

      printUsage(
        `Install: ${parsed.install_name ?? installId}`,
        parsed,
        { firstDate, lastDate, cached, cachedAgeMinutes },
      );
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe account-usage
// ---------------------------------------------------------------------------

wpeCommand
  .command('account-usage <accountId>')
  .description('Show bandwidth, storage, and visitor usage for a WP Engine account')
  .option('--month-offset <n>', 'Month offset (0 = current, 1 = last month)', '0')
  .option('--json', 'Output raw JSON')
  .action(async (accountId, options) => {
    try {
      const monthOffset = parseInt(options.monthOffset ?? '0', 10);
      const client = getClient();

      const result = await client.mutate<{ nexusWpeAccountUsage: any }>(`
        mutation($accountId: String!, $monthOffset: Int) {
          nexusWpeAccountUsage(accountId: $accountId, monthOffset: $monthOffset) {
            success
            error
            data
            cached
            cachedAgeMinutes
            firstDate
            lastDate
          }
        }
      `, { accountId, monthOffset });

      const { success, error, data, cached, cachedAgeMinutes, firstDate, lastDate } =
        result.nexusWpeAccountUsage;

      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      const parsed = JSON.parse(data);

      if (options.json) {
        console.log(JSON.stringify(parsed, null, 2));
        return;
      }

      printUsage(
        `Account: ${accountId}`,
        parsed,
        { firstDate, lastDate, cached, cachedAgeMinutes },
      );
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { wpeCommand };
