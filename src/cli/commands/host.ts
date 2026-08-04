/**
 * External Host Commands
 *
 * Register WordPress sites on SSH-reachable hosts that are not WP Engine and
 * not Local. The ~/.ssh/config alias is the credential path — Nexus stores no
 * key material, and never writes anything to your server.
 */

import { Command } from 'commander';
import * as readline from 'readline';
import { getClient } from '../utils/graphql';

const hostCommand = new Command('host').description('External SSH host management');

const PROBE_FIELDS = `
  ok
  alias
  hostname
  user
  port
  wpCliPath
  wpCliVersion
  wpPath
  wpVersion
  siteUrl
  candidates
  failure { kind detail remedy }
`;

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt(rl, `${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function printReport(r: any): void {
  console.log(`\n  Host        ${r.user ? `${r.user}@` : ''}${r.hostname}:${r.port}`);
  if (r.wpCliVersion) console.log(`  WP-CLI      ${r.wpCliVersion}${r.wpCliPath ? `  (${r.wpCliPath})` : ''}`);
  if (r.wpPath) console.log(`  WordPress   ${r.wpPath}`);
  if (r.wpVersion) console.log(`  Version     ${r.wpVersion}`);
  if (r.siteUrl) console.log(`  Site URL    ${r.siteUrl}`);
  console.log('');
}

function printFailure(r: any): void {
  console.error(`\n✗ ${r.alias}: ${r.failure.kind}\n`);
  console.error(r.failure.detail.split('\n').map((l: string) => `  ${l}`).join('\n'));
  console.error(`\n${r.failure.remedy}\n`);
}

// ============================================================================
// host test
// ============================================================================

hostCommand
  .command('test <alias>')
  .description('Check an SSH host without registering it')
  .option('--path <dir>', 'WordPress root (skips discovery)')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: 120000 });
      const result = await client.mutate<{ nexusHostProbe: any }>(`
        mutation($alias: String!, $path: String) {
          nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
        }
      `, { alias, path: options.path ?? null });

      const { success, error, report } = result.nexusHostProbe;
      if (options.json) {
        console.log(JSON.stringify(report ?? { error }, null, 2));
        process.exit(success && report?.ok ? 0 : 1);
      }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!report.ok) { printFailure(report); process.exit(1); }

      console.log(`\n✓ ${alias} is reachable and running WordPress.`);
      printReport(report);
      console.log(`  Register it with: nexus host add ${alias}\n`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host add
// ============================================================================

hostCommand
  .command('add <alias>')
  .description('Probe an SSH host and add it to the fleet')
  .option('--path <dir>', 'WordPress root (skips discovery)')
  .option('--env <environment>', 'production | staging | development', 'production')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: 120000 });

      if (!options.yes && !options.json) {
        console.log(`\nProbing ${alias}...`);
        const probe = await client.mutate<{ nexusHostProbe: any }>(`
          mutation($alias: String!, $path: String) {
            nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
          }
        `, { alias, path: options.path ?? null });

        const pr = probe.nexusHostProbe;
        if (!pr.success) { console.error(`✗ ${pr.error}`); process.exit(1); }
        if (!pr.report.ok) { printFailure(pr.report); process.exit(1); }

        printReport(pr.report);
        console.log(`  Environment ${options.env}   (writes are refused on production by default)`);
        if (!(await confirm(`\nAdd ${alias} to the fleet?`))) {
          console.log('Cancelled.');
          process.exit(0);
        }
        // The probe re-runs inside nexusHostAdd. Two round trips, but the
        // alternative is a mutation that persists whatever a stale earlier
        // probe found.
      }

      const result = await client.mutate<{ nexusHostAdd: any }>(`
        mutation($alias: String!, $path: String, $environment: String) {
          nexusHostAdd(alias: $alias, path: $path, environment: $environment) {
            success error registered report { ${PROBE_FIELDS} }
          }
        }
      `, { alias, path: options.path ?? null, environment: options.env });

      const { success, error, registered, report } = result.nexusHostAdd;
      if (options.json) {
        console.log(JSON.stringify({ registered, report, error }, null, 2));
        process.exit(registered ? 0 : 1);
      }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!registered) { printFailure(report); process.exit(1); }

      console.log(`\n✓ Added ${alias} to the fleet.`);
      printReport(report);
      console.log(`  Try: nexus wp core version ssh:${alias}@${options.env}\n`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host list
// ============================================================================

hostCommand
  .command('list')
  .description('List registered external SSH hosts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusHostList: any }>(`
        mutation {
          nexusHostList {
            success error
            hosts { alias wpPath wpCliPath environment firstSeenAt lastSeenAt }
          }
        }
      `, {});

      const { success, error, hosts } = result.nexusHostList;
      if (options.json) { console.log(JSON.stringify(hosts, null, 2)); return; }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }

      if (hosts.length === 0) {
        console.log('\nNo external hosts registered.\n  Add one: nexus host add <ssh-alias>\n');
        return;
      }

      console.log(`\n${hosts.length} external host${hosts.length === 1 ? '' : 's'}:\n`);
      for (const h of hosts) {
        console.log(`  ${h.alias}  [${h.environment}]`);
        console.log(`    path       ${h.wpPath ?? '(not set — pass --path)'}`);
        if (h.wpCliPath) console.log(`    wp-cli     ${h.wpCliPath}`);
        console.log(`    last seen  ${new Date(h.lastSeenAt).toLocaleString()}`);
      }
      console.log('');
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host remove
// ============================================================================

hostCommand
  .command('remove <alias>')
  .description('Forget an external SSH host')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (alias, options) => {
    try {
      if (!options.yes && !(await confirm(`Remove ${alias} from the fleet?`))) {
        console.log('Cancelled.');
        process.exit(0);
      }

      const client = getClient();
      const result = await client.mutate<{ nexusHostRemove: any }>(`
        mutation($alias: String!) { nexusHostRemove(alias: $alias) { success error removed } }
      `, { alias });

      const { success, error, removed } = result.nexusHostRemove;
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!removed) { console.error(`✗ ${alias} is not registered.`); process.exit(1); }
      console.log(`✓ Removed ${alias}.`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

export { hostCommand };
