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
  .option('--emails <addresses>', 'Comma-separated notification emails (defaults to no-reply@wpengine.com)')
  .action(async (target, options) => {
    try {
      const client = getClient({ timeout: 300000 }); // 5 min for backup

      console.log(`\nCreating backup for ${target}...`);

      const notificationEmails = options.emails
        ? options.emails.split(',').map((e: string) => e.trim())
        : undefined;

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
          notificationEmails: notificationEmails || null,
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
// nexus wpe set-credentials
// ---------------------------------------------------------------------------

wpeCommand
  .command('set-credentials <username> <password>')
  .description('Store WP Engine API credentials for basic authentication (required for backup creation)')
  .action(async (username, password) => {
    try {
      const client = getClient({ timeout: 10000 });
      const data = await client.mutate<{ nexusWpeSetApiCredentials: any }>(`
        mutation($username: String!, $password: String!) {
          nexusWpeSetApiCredentials(username: $username, password: $password) {
            success
            error
          }
        }
      `, { username, password });
      if (!data.nexusWpeSetApiCredentials.success) {
        console.error(`\n❌ Failed to store credentials: ${data.nexusWpeSetApiCredentials.error || 'Unknown error'}`);
        process.exit(1);
      }
      console.log('\n✅ WP Engine API credentials stored securely');
      console.log('   Backup creation will now use basic authentication\n');
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe clear-credentials
// ---------------------------------------------------------------------------

wpeCommand
  .command('clear-credentials')
  .description('Remove stored WP Engine API credentials')
  .action(async () => {
    try {
      const client = getClient({ timeout: 10000 });
      const data = await client.mutate<{ nexusWpeClearApiCredentials: any }>(`
        mutation {
          nexusWpeClearApiCredentials {
            success
            error
          }
        }
      `, {});
      if (!data.nexusWpeClearApiCredentials.success) {
        console.error(`\n❌ Failed to clear credentials: ${data.nexusWpeClearApiCredentials.error || 'Unknown error'}`);
        process.exit(1);
      }
      console.log('\n✅ WP Engine API credentials cleared\n');
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe credentials-status
// ---------------------------------------------------------------------------

wpeCommand
  .command('credentials-status')
  .description('Check if WP Engine API credentials are configured')
  .action(async () => {
    try {
      const client = getClient({ timeout: 10000 });
      const data = await client.mutate<{ nexusWpeApiCredentialsStatus: any }>(`
        mutation {
          nexusWpeApiCredentialsStatus {
            success
            error
            configured
            username
          }
        }
      `, {});
      if (!data.nexusWpeApiCredentialsStatus.success) {
        console.error(`\n❌ Failed to check credentials: ${data.nexusWpeApiCredentialsStatus.error || 'Unknown error'}`);
        process.exit(1);
      }
      console.log('');
      if (data.nexusWpeApiCredentialsStatus.configured) {
        console.log(`✅ WP Engine API credentials are configured`);
        console.log(`   Username: ${data.nexusWpeApiCredentialsStatus.username}`);
        console.log('   Backup creation will use basic authentication\n');
      } else {
        console.log('⚫ WP Engine API credentials are NOT configured');
        console.log('   Backup creation will fail (OAuth not supported by WP Engine)');
        console.log('\nTo enable backup creation:');
        console.log('1. Get your API credentials from https://my.wpengine.com');
        console.log('2. Run: nexus wpe set-credentials <username> <password>\n');
      }
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

// ---------------------------------------------------------------------------
// nexus wpe account
// ---------------------------------------------------------------------------

wpeCommand
  .command('account <accountId>')
  .description('Get details about a specific WP Engine account')
  .option('--json', 'Output as JSON')
  .action(async (accountId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeAccount: any }>(`
        mutation($accountId: String!) {
          nexusWpeAccount(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId });
      const { success, error, data } = result.nexusWpeAccount;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      console.log(`\nAccount: ${parsed.name || parsed.id}`);
      console.log('─'.repeat(40));
      console.log(`  ID:      ${parsed.id}`);
      console.log(`  Name:    ${parsed.name}`);
      if (parsed.created_at) console.log(`  Created: ${parsed.created_at}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe limits
// ---------------------------------------------------------------------------

wpeCommand
  .command('limits <accountId>')
  .description('Show plan limits for a WP Engine account')
  .option('--json', 'Output as JSON')
  .action(async (accountId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeAccountLimits: any }>(`
        mutation($accountId: String!) {
          nexusWpeAccountLimits(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId });
      const { success, error, data } = result.nexusWpeAccountLimits;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      console.log(`\nAccount Limits: ${accountId}`);
      console.log('─'.repeat(40));
      for (const [key, value] of Object.entries(parsed)) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(`  ${label.padEnd(28)} ${value}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe users
// ---------------------------------------------------------------------------

wpeCommand
  .command('users <accountId>')
  .description('List users for a WP Engine account')
  .option('--json', 'Output as JSON')
  .action(async (accountId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeAccountUsers: any }>(`
        mutation($accountId: String!) {
          nexusWpeAccountUsers(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId });
      const { success, error, data } = result.nexusWpeAccountUsers;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const users = parsed.results ?? parsed;
      if (options.json) { console.log(JSON.stringify(users, null, 2)); return; }
      console.log(`\nUsers for account ${accountId}:`);
      console.log('─'.repeat(60));
      console.log(`  ${'Name'.padEnd(24)} ${'Email'.padEnd(28)} Roles`);
      console.log('─'.repeat(60));
      for (const u of users) {
        const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id;
        const roles = Array.isArray(u.roles) ? u.roles.join(', ') : (u.role ?? '');
        console.log(`  ${name.padEnd(24)} ${(u.email ?? '').padEnd(28)} ${roles}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe user
// ---------------------------------------------------------------------------

wpeCommand
  .command('user <accountId> <userId>')
  .description('Get details about a specific user in a WP Engine account')
  .option('--json', 'Output as JSON')
  .action(async (accountId, userId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeAccountUser: any }>(`
        mutation($accountId: String!, $userId: String!) {
          nexusWpeAccountUser(accountId: $accountId, userId: $userId) {
            success
            error
            data
          }
        }
      `, { accountId, userId });
      const { success, error, data } = result.nexusWpeAccountUser;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const u = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(u, null, 2)); return; }
      const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id;
      console.log(`\nUser: ${name}`);
      console.log('─'.repeat(40));
      console.log(`  ID:     ${u.id}`);
      console.log(`  Email:  ${u.email}`);
      if (u.role) console.log(`  Role:   ${u.role}`);
      if (Array.isArray(u.roles)) console.log(`  Roles:  ${u.roles.join(', ')}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe user-add
// ---------------------------------------------------------------------------

wpeCommand
  .command('user-add <accountId>')
  .description('Add a user to a WP Engine account')
  .option('--email <e>', 'User email address')
  .option('--first <f>', 'First name')
  .option('--last <l>', 'Last name')
  .option('--role <r>', 'Role to assign')
  .action(async (accountId, options) => {
    try {
      if (!options.email || !options.first || !options.last || !options.role) {
        console.error('\n❌ All of --email, --first, --last, and --role are required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeUserAdd: any }>(`
        mutation($accountId: String!, $email: String!, $firstName: String!, $lastName: String!, $role: String!) {
          nexusWpeUserAdd(accountId: $accountId, email: $email, firstName: $firstName, lastName: $lastName, role: $role) {
            success
            error
            message
          }
        }
      `, { accountId, email: options.email, firstName: options.first, lastName: options.last, role: options.role });
      const { success, error, message } = result.nexusWpeUserAdd;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ User added successfully`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe user-update
// ---------------------------------------------------------------------------

wpeCommand
  .command('user-update <accountId> <userId>')
  .description('Update a user role in a WP Engine account')
  .option('--role <role>', 'New role to assign')
  .action(async (accountId, userId, options) => {
    try {
      if (!options.role) {
        console.error('\n❌ --role is required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeUserUpdate: any }>(`
        mutation($accountId: String!, $userId: String!, $role: String!) {
          nexusWpeUserUpdate(accountId: $accountId, userId: $userId, role: $role) {
            success
            error
            message
          }
        }
      `, { accountId, userId, role: options.role });
      const { success, error, message } = result.nexusWpeUserUpdate;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ User updated successfully`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe user-remove
// ---------------------------------------------------------------------------

wpeCommand
  .command('user-remove <accountId> <userId>')
  .description('Remove a user from a WP Engine account')
  .option('--confirm', 'Confirm user removal (required)')
  .action(async (accountId, userId, options) => {
    try {
      if (!options.confirm) {
        console.error('\n❌ --confirm flag is required to remove a user');
        console.error('   This action cannot be undone. Re-run with --confirm to proceed.');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeUserRemove: any }>(`
        mutation($accountId: String!, $userId: String!, $confirm: Boolean) {
          nexusWpeUserRemove(accountId: $accountId, userId: $userId, confirm: $confirm) {
            success
            error
            message
          }
        }
      `, { accountId, userId, confirm: true });
      const { success, error, message } = result.nexusWpeUserRemove;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ User removed successfully`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe user-audit
// ---------------------------------------------------------------------------

wpeCommand
  .command('user-audit')
  .description('Audit users across WP Engine accounts')
  .option('--account <accountId>', 'Limit audit to a specific account')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeUserAudit: any }>(`
        mutation($accountId: String) {
          nexusWpeUserAudit(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId: options.account || null });
      const { success, error, data } = result.nexusWpeUserAudit;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        console.log(`\nAccount: ${entry.account}`);
        console.log('─'.repeat(60));
        console.log(`  ${'Name'.padEnd(24)} ${'Email'.padEnd(28)} Roles`);
        console.log('─'.repeat(60));
        const users = entry.users ?? [];
        for (const u of users) {
          const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.id;
          const roles = Array.isArray(u.roles) ? u.roles.join(', ') : (u.role ?? '');
          console.log(`  ${name.padEnd(24)} ${(u.email ?? '').padEnd(28)} ${roles}`);
        }
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe sites
// ---------------------------------------------------------------------------

wpeCommand
  .command('sites')
  .description('List WP Engine sites')
  .option('--account <accountId>', 'Filter by account')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSites: any }>(`
        mutation($accountId: String) {
          nexusWpeSites(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId: options.account || null });
      const { success, error, data } = result.nexusWpeSites;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const sites = parsed.results ?? parsed;
      if (options.json) { console.log(JSON.stringify(sites, null, 2)); return; }
      console.log('\nWP Engine Sites:');
      console.log('─'.repeat(70));
      console.log(`  ${'Name'.padEnd(30)} ${'ID'.padEnd(24)} Account`);
      console.log('─'.repeat(70));
      for (const s of sites) {
        console.log(`  ${(s.name ?? '').padEnd(30)} ${(s.id ?? '').padEnd(24)} ${s.account_id ?? s.account ?? ''}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe site
// ---------------------------------------------------------------------------

wpeCommand
  .command('site <siteId>')
  .description('Get details about a specific WP Engine site')
  .option('--json', 'Output as JSON')
  .action(async (siteId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSite: any }>(`
        mutation($siteId: String!) {
          nexusWpeSite(siteId: $siteId) {
            success
            error
            data
          }
        }
      `, { siteId });
      const { success, error, data } = result.nexusWpeSite;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const s = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(s, null, 2)); return; }
      console.log(`\nSite: ${s.name || siteId}`);
      console.log('─'.repeat(40));
      console.log(`  ID:      ${s.id}`);
      console.log(`  Name:    ${s.name}`);
      if (s.account_id) console.log(`  Account: ${s.account_id}`);
      if (s.created_at) console.log(`  Created: ${s.created_at}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe create-site
// ---------------------------------------------------------------------------

wpeCommand
  .command('create-site')
  .description('Create a new WP Engine site')
  .option('--name <name>', 'Site name (required)')
  .option('--account <accountId>', 'Account ID (required)')
  .action(async (options) => {
    try {
      if (!options.name || !options.account) {
        console.error('\n❌ --name and --account are required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeCreateSite: any }>(`
        mutation($name: String!, $accountId: String!) {
          nexusWpeCreateSite(name: $name, accountId: $accountId) {
            success
            error
            siteId
            name
          }
        }
      `, { name: options.name, accountId: options.account });
      const { success, error, siteId, name } = result.nexusWpeCreateSite;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Site created`);
      console.log(`   ID:   ${siteId}`);
      console.log(`   Name: ${name}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe create-install
// ---------------------------------------------------------------------------

wpeCommand
  .command('create-install')
  .description('Create a new install under a WP Engine site')
  .option('--site <siteId>', 'Site ID (required)')
  .option('--name <name>', 'Install name (required)')
  .option('--env <environment>', 'Environment: production|staging|development (required)')
  .option('--account <accountId>', 'Account ID (required)')
  .action(async (options) => {
    try {
      if (!options.site || !options.name || !options.env || !options.account) {
        console.error('\n❌ --site, --name, --env, and --account are all required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeCreateInstall: any }>(`
        mutation($siteId: String!, $name: String!, $environment: String!, $accountId: String!) {
          nexusWpeCreateInstall(siteId: $siteId, name: $name, environment: $environment, accountId: $accountId) {
            success
            error
            installId
            name
            domain
          }
        }
      `, { siteId: options.site, name: options.name, environment: options.env, accountId: options.account });
      const { success, error, installId, name, domain } = result.nexusWpeCreateInstall;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Install created`);
      console.log(`   ID:     ${installId}`);
      console.log(`   Name:   ${name}`);
      if (domain) console.log(`   Domain: ${domain}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe update-install
// ---------------------------------------------------------------------------

wpeCommand
  .command('update-install <installId>')
  .description('Update settings for a WP Engine install')
  .option('--php <version>', 'PHP version to set')
  .option('--env <environment>', 'Environment to set')
  .action(async (installId, options) => {
    try {
      if (!options.php && !options.env) {
        console.error('\n❌ At least one of --php or --env must be provided');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeUpdateInstall: any }>(`
        mutation($installId: String!, $phpVersion: String, $environment: String) {
          nexusWpeUpdateInstall(installId: $installId, phpVersion: $phpVersion, environment: $environment) {
            success
            error
            message
          }
        }
      `, { installId, phpVersion: options.php || null, environment: options.env || null });
      const { success, error, message } = result.nexusWpeUpdateInstall;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Install updated`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe delete-install
// ---------------------------------------------------------------------------

wpeCommand
  .command('delete-install <installId>')
  .description('Delete a WP Engine install')
  .option('--confirm-name <installName>', 'Install name to confirm deletion (required)')
  .action(async (installId, options) => {
    try {
      if (!options.confirmName) {
        console.error('\n❌ --confirm-name <installName> is required to delete an install');
        console.error('   Provide the install name to confirm this destructive action.');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDeleteInstall: any }>(`
        mutation($installId: String!, $confirmName: String) {
          nexusWpeDeleteInstall(installId: $installId, confirmName: $confirmName) {
            success
            error
            message
          }
        }
      `, { installId, confirmName: options.confirmName });
      const { success, error, message } = result.nexusWpeDeleteInstall;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Install deleted`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe backup-status
// ---------------------------------------------------------------------------

wpeCommand
  .command('backup-status <installId> <backupId>')
  .description('Check the status of a WP Engine backup')
  .option('--json', 'Output as JSON')
  .action(async (installId, backupId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeBackupStatus: any }>(`
        mutation($installId: String!, $backupId: String!) {
          nexusWpeBackupStatus(installId: $installId, backupId: $backupId) {
            success
            error
            data
          }
        }
      `, { installId, backupId });
      const { success, error, data } = result.nexusWpeBackupStatus;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      console.log(`\nBackup Status: ${backupId}`);
      console.log('─'.repeat(40));
      console.log(`  Status:  ${parsed.status ?? 'unknown'}`);
      if (parsed.created_at) console.log(`  Created: ${parsed.created_at}`);
      if (parsed.type) console.log(`  Type:    ${parsed.type}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe backup-verify
// ---------------------------------------------------------------------------

wpeCommand
  .command('backup-verify <installId>')
  .description('Create a backup and poll until complete')
  .option('--description <text>', 'Backup description')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient({ timeout: 360000 }); // 6 min timeout
      console.log('Creating backup and polling for completion...');
      const result = await client.mutate<{ nexusWpeBackupVerify: any }>(`
        mutation($installId: String!, $description: String) {
          nexusWpeBackupVerify(installId: $installId, description: $description) {
            success
            error
            backupId
            status
            createdAt
          }
        }
      `, { installId, description: options.description || null });
      const { success, error, backupId, status, createdAt } = result.nexusWpeBackupVerify;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      if (options.json) { console.log(JSON.stringify({ backupId, status, createdAt }, null, 2)); return; }
      console.log(`\n✅ Backup ${status}`);
      console.log(`   ID: ${backupId}`);
      if (createdAt) console.log(`   Created: ${createdAt}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe domains
// ---------------------------------------------------------------------------

wpeCommand
  .command('domains <installId>')
  .description('List domains for a WP Engine install')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDomains: any }>(`
        mutation($installId: String!) {
          nexusWpeDomains(installId: $installId) {
            success
            error
            data
          }
        }
      `, { installId });
      const { success, error, data } = result.nexusWpeDomains;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const domains = parsed.results ?? parsed;
      if (options.json) { console.log(JSON.stringify(domains, null, 2)); return; }
      console.log(`\nDomains for install ${installId}:`);
      console.log('─'.repeat(70));
      console.log(`  ${'Domain'.padEnd(40)} ${'Primary'.padEnd(10)} Status`);
      console.log('─'.repeat(70));
      for (const d of domains) {
        const primary = d.primary ? 'yes' : 'no';
        console.log(`  ${(d.name ?? d.domain ?? '').padEnd(40)} ${primary.padEnd(10)} ${d.status ?? ''}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe domain-add
// ---------------------------------------------------------------------------

wpeCommand
  .command('domain-add <installId> <domain>')
  .description('Add a domain to a WP Engine install')
  .action(async (installId, domain) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDomainAdd: any }>(`
        mutation($installId: String!, $domain: String!) {
          nexusWpeDomainAdd(installId: $installId, domain: $domain) {
            success
            error
            domainId
            name
          }
        }
      `, { installId, domain });
      const { success, error, domainId, name } = result.nexusWpeDomainAdd;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Domain added`);
      console.log(`   ID:   ${domainId}`);
      console.log(`   Name: ${name}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe domain-remove
// ---------------------------------------------------------------------------

wpeCommand
  .command('domain-remove <installId> <domainId>')
  .description('Remove a domain from a WP Engine install')
  .option('--confirm', 'Confirm domain removal (required)')
  .action(async (installId, domainId, options) => {
    try {
      if (!options.confirm) {
        console.error('\n❌ --confirm flag is required to remove a domain');
        console.error('   This action cannot be undone. Re-run with --confirm to proceed.');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDomainRemove: any }>(`
        mutation($installId: String!, $domainId: String!, $confirm: Boolean) {
          nexusWpeDomainRemove(installId: $installId, domainId: $domainId, confirm: $confirm) {
            success
            error
            message
          }
        }
      `, { installId, domainId, confirm: true });
      const { success, error, message } = result.nexusWpeDomainRemove;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ Domain removed`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe domain-check
// ---------------------------------------------------------------------------

wpeCommand
  .command('domain-check <installId> <domainId>')
  .description('Check DNS status for a domain on a WP Engine install')
  .option('--json', 'Output as JSON')
  .action(async (installId, domainId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDomainCheck: any }>(`
        mutation($installId: String!, $domainId: String!) {
          nexusWpeDomainCheck(installId: $installId, domainId: $domainId) {
            success
            error
            data
          }
        }
      `, { installId, domainId });
      const { success, error, data } = result.nexusWpeDomainCheck;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      console.log(`\nDNS Check: ${domainId}`);
      console.log('─'.repeat(40));
      for (const [key, value] of Object.entries(parsed)) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(`  ${label.padEnd(20)} ${value}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe ssl
// ---------------------------------------------------------------------------

wpeCommand
  .command('ssl <installId>')
  .description('List SSL certificates for a WP Engine install')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSslCertificates: any }>(`
        mutation($installId: String!) {
          nexusWpeSslCertificates(installId: $installId) {
            success
            error
            data
          }
        }
      `, { installId });
      const { success, error, data } = result.nexusWpeSslCertificates;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const certs = parsed.results ?? parsed;
      if (options.json) { console.log(JSON.stringify(certs, null, 2)); return; }
      console.log(`\nSSL Certificates for install ${installId}:`);
      console.log('─'.repeat(70));
      console.log(`  ${'Domains'.padEnd(36)} ${'Expiry'.padEnd(14)} Status`);
      console.log('─'.repeat(70));
      for (const c of certs) {
        const domains = Array.isArray(c.domains) ? c.domains.join(', ') : (c.domain ?? '');
        const expiry = c.expires_at ?? c.expiry ?? '';
        console.log(`  ${domains.padEnd(36)} ${expiry.padEnd(14)} ${c.status ?? ''}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe ssl-request
// ---------------------------------------------------------------------------

wpeCommand
  .command('ssl-request <installId>')
  .description('Request SSL certificate provisioning for a WP Engine install')
  .option('--domains <d1,d2,...>', 'Comma-separated domain IDs (required)')
  .action(async (installId, options) => {
    try {
      if (!options.domains) {
        console.error('\n❌ --domains is required (comma-separated domain IDs)');
        process.exit(1);
      }
      const domainIds = options.domains.split(',').map((d: string) => d.trim()).filter(Boolean);
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSslRequest: any }>(`
        mutation($installId: String!, $domainIds: [String!]!) {
          nexusWpeSslRequest(installId: $installId, domainIds: $domainIds) {
            success
            error
            message
          }
        }
      `, { installId, domainIds });
      const { success, error, message } = result.nexusWpeSslRequest;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ SSL certificate provisioning requested`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe ssh-keys
// ---------------------------------------------------------------------------

wpeCommand
  .command('ssh-keys')
  .description('List SSH keys on your WP Engine account')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSshKeys: any }>(`
        mutation {
          nexusWpeSshKeys {
            success
            error
            data
          }
        }
      `);
      const { success, error, data } = result.nexusWpeSshKeys;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const keys = parsed.results ?? parsed;
      if (options.json) { console.log(JSON.stringify(keys, null, 2)); return; }
      console.log('\nSSH Keys:');
      console.log('─'.repeat(60));
      console.log(`  ${'Label'.padEnd(30)} ID`);
      console.log('─'.repeat(60));
      for (const k of keys) {
        console.log(`  ${(k.label ?? k.name ?? '').padEnd(30)} ${k.uuid ?? k.id ?? ''}`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe ssh-key-add
// ---------------------------------------------------------------------------

wpeCommand
  .command('ssh-key-add')
  .description('Add an SSH public key to your WP Engine account')
  .option('--label <label>', 'Label for the key (required)')
  .option('--key <pubkey>', 'SSH public key string (required)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      if (!options.label || !options.key) {
        console.error('\n❌ --label and --key are required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSshKeyAdd: any }>(`
        mutation($label: String!, $publicKey: String!) {
          nexusWpeSshKeyAdd(label: $label, publicKey: $publicKey) {
            success
            error
            keyId
            label
          }
        }
      `, { label: options.label, publicKey: options.key });
      const { success, error, keyId, label } = result.nexusWpeSshKeyAdd;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      if (options.json) { console.log(JSON.stringify({ keyId, label }, null, 2)); return; }
      console.log(`\n✅ SSH key added`);
      console.log(`   ID:    ${keyId}`);
      console.log(`   Label: ${label}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe ssh-key-remove
// ---------------------------------------------------------------------------

wpeCommand
  .command('ssh-key-remove <keyId>')
  .description('Remove an SSH key from your WP Engine account')
  .option('--confirm', 'Confirm key removal (required)')
  .action(async (keyId, options) => {
    try {
      if (!options.confirm) {
        console.error('\n❌ --confirm flag is required to remove an SSH key');
        console.error('   Re-run with --confirm to proceed.');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.mutate<{ nexusWpeSshKeyRemove: any }>(`
        mutation($sshKeyId: String!, $confirm: Boolean) {
          nexusWpeSshKeyRemove(sshKeyId: $sshKeyId, confirm: $confirm) {
            success
            error
            message
          }
        }
      `, { sshKeyId: keyId, confirm: true });
      const { success, error, message } = result.nexusWpeSshKeyRemove;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      console.log(`\n✅ SSH key removed`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe promote
// ---------------------------------------------------------------------------

wpeCommand
  .command('promote <sourceInstallId> <destInstallId>')
  .description('Promote (copy) one WP Engine install to another')
  .option('--no-database', 'Exclude database from promotion')
  .option('--confirm', 'Confirm promotion (required for destructive action)')
  .action(async (sourceInstallId, destInstallId, options) => {
    try {
      const client = getClient();
      const includeDatabase = options.database !== false;
      const confirm = options.confirm ? true : undefined;
      const result = await client.mutate<{ nexusWpePromote: any }>(`
        mutation($sourceInstallId: String!, $destInstallId: String!, $includeDatabase: Boolean, $confirm: Boolean) {
          nexusWpePromote(sourceInstallId: $sourceInstallId, destInstallId: $destInstallId, includeDatabase: $includeDatabase, confirm: $confirm) {
            success
            error
            message
            requiresConfirmation
          }
        }
      `, { sourceInstallId, destInstallId, includeDatabase, confirm });
      const { success, error, message, requiresConfirmation } = result.nexusWpePromote;
      if (!success && !requiresConfirmation) { console.error(`\n❌ ${error}`); process.exit(1); }
      if (requiresConfirmation) {
        console.log(`\n⚠️  Confirmation required`);
        if (message) console.log(`   ${message}`);
        console.log('\n   Re-run with --confirm to proceed.');
        console.log('');
        return;
      }
      console.log(`\n✅ Promotion complete`);
      if (message) console.log(`   ${message}`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe diagnose
// ---------------------------------------------------------------------------

wpeCommand
  .command('diagnose <installId>')
  .description('Run a diagnostic check on a WP Engine install')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeDiagnose: any }>(`
        mutation($installId: String!) {
          nexusWpeDiagnose(installId: $installId) {
            success
            error
            data
          }
        }
      `, { installId });
      const { success, error, data } = result.nexusWpeDiagnose;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      const install = parsed.install ?? parsed;
      console.log(`\nDiagnostic: ${install.name ?? installId}`);
      console.log('─'.repeat(40));
      if (install.domain) console.log(`  Domain:      ${install.domain}`);
      if (install.environment) console.log(`  Environment: ${install.environment}`);
      console.log('');
      const hasPrimaryDomain = !!(install.primary_domain ?? install.domain);
      console.log(`  ${hasPrimaryDomain ? '✅' : '❌'} Has primary domain`);
      const sslResults = parsed.ssl?.results ?? parsed.ssl ?? [];
      const hasSsl = Array.isArray(sslResults) ? sslResults.length > 0 : !!sslResults;
      console.log(`  ${hasSsl ? '✅' : '❌'} SSL certificate`);
      const backupResults = parsed.backups?.results ?? parsed.backups ?? [];
      const hasBackup = Array.isArray(backupResults) ? backupResults.length > 0 : !!backupResults;
      console.log(`  ${hasBackup ? '✅' : '❌'} Recent backup`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe go-live-check
// ---------------------------------------------------------------------------

wpeCommand
  .command('go-live-check <installId> <domain>')
  .description('Check go-live readiness for a domain on a WP Engine install')
  .option('--json', 'Output as JSON')
  .action(async (installId, domain, options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeGoLiveCheck: any }>(`
        mutation($installId: String!, $domain: String!) {
          nexusWpeGoLiveCheck(installId: $installId, domain: $domain) {
            success
            error
            data
          }
        }
      `, { installId, domain });
      const { success, error, data } = result.nexusWpeGoLiveCheck;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
      console.log(`\nGo-Live Check: ${domain}`);
      console.log('─'.repeat(40));
      const domainAdded = parsed.domainAdded ?? parsed.domain_added;
      const ssl = parsed.ssl;
      console.log(`  ${domainAdded ? '✅' : '❌'} Domain added to install`);
      console.log(`  ${ssl ? '✅' : '❌'} SSL configured`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe fleet-health
// ---------------------------------------------------------------------------

wpeCommand
  .command('fleet-health')
  .description('Show health overview of all WP Engine installs')
  .option('--account <accountId>', 'Filter by account')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusWpeFleetHealth: any }>(`
        mutation($accountId: String) {
          nexusWpeFleetHealth(accountId: $accountId) {
            success
            error
            data
          }
        }
      `, { accountId: options.account || null });
      const { success, error, data } = result.nexusWpeFleetHealth;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      const installs = Array.isArray(parsed) ? parsed : (parsed.results ?? [parsed]);
      if (options.json) { console.log(JSON.stringify(installs, null, 2)); return; }
      console.log('\nFleet Health:');
      console.log('─'.repeat(76));
      console.log(`  ${'Name'.padEnd(24)} ${'Env'.padEnd(14)} ${'Domain'.padEnd(28)} SSL`);
      console.log('─'.repeat(76));
      for (const inst of installs) {
        const sslStatus = inst.ssl_status ?? (inst.ssl ? 'active' : 'none');
        console.log(
          `  ${(inst.name ?? '').padEnd(24)} ${(inst.environment ?? '').padEnd(14)} ${(inst.domain ?? '').padEnd(28)} ${sslStatus}`,
        );
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// nexus wpe portfolio
// ---------------------------------------------------------------------------

wpeCommand
  .command('portfolio')
  .description('Show a portfolio overview of your WP Engine accounts and installs')
  .option('--month-offset <n>', 'Month offset (0 = current, 1 = last month)', '0')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const monthOffset = parseInt(options.monthOffset ?? '0', 10);
      const client = getClient();
      const result = await client.mutate<{ nexusWpePortfolioOverview: any }>(`
        mutation($monthOffset: Int) {
          nexusWpePortfolioOverview(monthOffset: $monthOffset) {
            success
            error
            data
          }
        }
      `, { monthOffset });
      const { success, error, data } = result.nexusWpePortfolioOverview;
      if (!success) { console.error(`\n❌ ${error}`); process.exit(1); }
      const parsed = JSON.parse(data);
      if (options.json) { console.log(JSON.stringify(parsed, null, 2)); return; }

      const accounts: any[] = Array.isArray(parsed.accounts) ? parsed.accounts : [];
      const installs: any[] = Array.isArray(parsed.installs) ? parsed.installs : [];
      const usageData: any[] = Array.isArray(parsed.usage) ? parsed.usage : [];
      const period = parsed.period ?? {};

      // Aggregate totals from per-account usage
      let totalVisits = 0;
      let totalBandwidthBytes = 0;
      const accountRows: Array<{ name: string; installCount: number; visits: number; bandwidthBytes: number }> = [];

      for (const u of usageData) {
        const envMetrics: any[] = u.usage?.environment_metrics ?? [];
        let acctVisits = 0;
        let acctBandwidth = 0;
        for (const env of envMetrics) {
          acctVisits += Number(env.metrics_rollup?.visit_count?.sum ?? 0);
          acctBandwidth += Number(env.metrics_rollup?.network_total_bytes?.sum ?? 0);
        }
        totalVisits += acctVisits;
        totalBandwidthBytes += acctBandwidth;
        const acctInstalls = installs.filter((i: any) => (i.account?.id ?? i.account_id) === u.accountId).length;
        accountRows.push({ name: u.accountName, installCount: acctInstalls, visits: acctVisits, bandwidthBytes: acctBandwidth });
      }

      const monthLabel = period.firstDate ? period.firstDate.slice(0, 7) : 'current month';

      console.log(`\nPortfolio Overview — ${monthLabel}`);
      console.log('─'.repeat(50));
      console.log(`  Accounts:  ${formatNum(accounts.length)}`);
      console.log(`  Installs:  ${formatNum(installs.length)}`);
      console.log(`  Visits:    ${formatNum(totalVisits)}`);
      console.log(`  Bandwidth: ${formatBytes(totalBandwidthBytes)}`);

      if (accountRows.length > 0) {
        accountRows.sort((a, b) => b.visits - a.visits);
        console.log('\nBy Account (sorted by visits):');
        console.log('─'.repeat(70));
        console.log(`  ${'Account'.padEnd(26)} ${'Installs'.padEnd(10)} ${'Visits'.padEnd(12)} Bandwidth`);
        console.log('─'.repeat(70));
        for (const a of accountRows) {
          console.log(`  ${a.name.padEnd(26)} ${String(a.installCount).padEnd(10)} ${formatNum(a.visits).padEnd(12)} ${formatBytes(a.bandwidthBytes)}`);
        }
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { wpeCommand };

