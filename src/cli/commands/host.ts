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

/**
 * Client timeout for the two commands that run a probe.
 *
 * MUST STAY ABOVE THE PROBE'S WORST CASE, which is ~155s — see the timeout
 * block in src/main/external/probeExternalHost.ts for the arithmetic. Below it,
 * a host slow enough to land in the gap makes the CLI print a timeout and exit
 * 1 *while the resolver finishes and registers the host*: failure reported for
 * an operation that succeeded. That is the slow-home-directory case the design
 * names as a known risk, so it is not hypothetical.
 *
 * The extra headroom over 155s covers the resolver's serialising queue, which a
 * probe may sit behind. Raise a probe step timeout and you must raise this.
 */
const HOST_PROBE_CLIENT_TIMEOUT_MS = 210000;

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

/**
 * `failure` is nullable in the schema while `ok` is not, so `ok: false` with no
 * failure is representable. Guarded rather than assumed: dereferencing it would
 * replace the diagnosis with "Cannot read properties of null (reading 'split')".
 */
function printFailure(r: any): void {
  if (!r?.failure) {
    console.error(
      `\n✗ ${r?.alias ?? 'host'}: the probe reported a failure but returned no diagnosis. `
      + 'Re-run with --json to see the raw response.\n',
    );
    return;
  }
  console.error(`\n✗ ${r.alias}: ${r.failure.kind}\n`);
  console.error(String(r.failure.detail ?? '').split('\n').map((l: string) => `  ${l}`).join('\n'));
  console.error(`\n${r.failure.remedy ?? ''}\n`);
}

/**
 * What `add` will actually label this host, for the pre-confirmation preview.
 *
 * Omitting `--env` means "leave a registered host alone", so echoing the flag
 * back would be a lie for exactly the case that motivated dropping its default.
 * Returns null when the lookup itself failed — the caller says so rather than
 * guessing 'production', which would be wrong for every staging host.
 */
async function previewEnvironment(
  client: { mutate: <T>(q: string, v: Record<string, unknown>) => Promise<T> },
  alias: string,
  envFlag?: string,
): Promise<string | null> {
  if (envFlag) return envFlag;
  try {
    const r = await client.mutate<{ nexusHostList: any }>(
      'mutation { nexusHostList { success hosts { alias environment } } }', {},
    );
    if (!r.nexusHostList?.success) return null;
    const existing = (r.nexusHostList.hosts ?? []).find((h: any) => h.alias === alias);
    return existing?.environment ?? 'production';
  } catch {
    return null;
  }
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
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });
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
      if (!report) {
        console.error(`✗ ${alias}: no report returned by the addon.`);
        process.exit(1);
      }
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
  // No commander default. A default here reaches the resolver as a value the
  // user "chose", which makes re-running `host add` to refresh a path relabel a
  // staging host as production. Omitted means unspecified; the resolver keeps
  // an existing host's label and falls back to production only for a new one.
  .option('--env <environment>',
    'production | staging | development (new hosts default to production; an already-registered host keeps its label)')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });

      if (!options.yes && !options.json) {
        console.log(`\nProbing ${alias}...`);
        const probe = await client.mutate<{ nexusHostProbe: any }>(`
          mutation($alias: String!, $path: String) {
            nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
          }
        `, { alias, path: options.path ?? null });

        const pr = probe.nexusHostProbe;
        if (!pr.success) { console.error(`✗ ${pr.error}`); process.exit(1); }
        if (!pr.report) {
          console.error(`✗ ${alias}: probe returned no report.`);
          process.exit(1);
        }
        if (!pr.report.ok) { printFailure(pr.report); process.exit(1); }

        printReport(pr.report);
        const envPreview = await previewEnvironment(client, alias, options.env);
        console.log(envPreview === null
          ? '  Environment production for a new host; unchanged if this host is already registered'
          : `  Environment ${envPreview}   (writes are refused on production by default)`);
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
            success error registered environment report { ${PROBE_FIELDS} }
          }
        }
      `, { alias, path: options.path ?? null, environment: options.env ?? null });

      const { success, error, registered, report, environment } = result.nexusHostAdd;
      if (options.json) {
        console.log(JSON.stringify({ registered, environment, report, error }, null, 2));
        process.exit(registered ? 0 : 1);
      }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!registered) {
        if (!report) {
          console.error(`✗ ${alias}: registration failed with no report.`);
          process.exit(1);
        }
        printFailure(report);
        process.exit(1);
      }

      console.log(`\n✓ Added ${alias} to the fleet.`);
      printReport(report);
      // The resolver's environment, not options.env: with --env omitted the two
      // differ for a host that was already registered, and a target line the
      // user cannot address the host by is worse than no target line.
      console.log(`  Try: nexus wp core version ssh:${alias}@${environment ?? 'production'}\n`);
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
      if (options.json) {
        // Failure is reported in the payload AND the exit code. Printing
        // `hosts` unconditionally emitted `[]` for a failed resolver, discarded
        // `error`, and exited 0 — a script could not tell "no hosts" from "the
        // addon is broken". `test` and `add` already order it this way.
        console.log(JSON.stringify(success ? hosts : { error }, null, 2));
        if (!success) process.exit(1);
        return;
      }
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
