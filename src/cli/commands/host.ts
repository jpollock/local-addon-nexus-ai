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

/** First label of a domain, or the alias if there's nothing to derive from. */
function suggestSiteSlug(domain: string | undefined, alias: string): string {
  if (!domain) return alias;
  return domain.split('.')[0] || alias;
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
  // Environment is resolved per site, here in the CLI, before nexusHostAdd is
  // called: a connection can hold several sites and each is labelled
  // independently. Omitted defaults to production for every site registered
  // in this run — there is no "leave this site's existing label alone"
  // behavior for `add` any more (registering a site with the same id again
  // will relabel it if --env is passed).
  .option('--env <environment>', 'production | staging | development (defaults to production)')
  .option('--site <name>', 'Site slug to register under (only meaningful with --path; overrides the domain-derived slug)')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });
      // A connection can now hold zero, one, or many WordPress sites, so there
      // is no zero-round-trip path any more: the CLI always probes once,
      // unqualified, to find out which case it's in before deciding whether to
      // register directly or prompt over a candidate list. `--json` suppresses
      // the interactive chatter and per-candidate prompting (like `--yes`) and
      // emits a single JSON summary at the end instead of the human-readable
      // lines, so scripts keep the scriptable contract the old shortcut gave them.
      const quiet = !!options.json;

      if (!quiet) console.log(`\nProbing ${alias}...`);
      const probe = await client.mutate<{ nexusHostProbe: any }>(`
        mutation($alias: String!, $path: String) {
          nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
        }
      `, { alias, path: options.path ?? null });

      const pr = probe.nexusHostProbe;
      if (!pr.success) {
        if (quiet) { console.log(JSON.stringify({ error: pr.error }, null, 2)); process.exit(1); }
        console.error(`✗ ${pr.error}`);
        process.exit(1);
        return;
      }
      if (!pr.report) {
        const msg = `${alias}: probe returned no report.`;
        if (quiet) { console.log(JSON.stringify({ error: msg }, null, 2)); process.exit(1); }
        console.error(`✗ ${msg}`);
        process.exit(1);
        return;
      }

      let selections: Array<{ path: string; site: string; environment: string }>;

      if (pr.report.ok) {
        // Zero-ambiguity case: one root, register it directly. An explicit
        // --site (e.g. adding a second site under an already-registered
        // connection via --path) wins over the domain-derived slug.
        const slug = options.site || suggestSiteSlug(
          pr.report.siteUrl ? new URL(pr.report.siteUrl).hostname : undefined, alias,
        );
        selections = [{ path: pr.report.wpPath, site: slug, environment: options.env ?? 'production' }];
      } else if (pr.report.failure?.kind === 'multiple-wordpress') {
        const candidates: string[] = pr.report.candidates ?? [];
        if (!quiet) console.log(`\nFound ${candidates.length} WordPress installations on '${alias}':`);

        // Probe each candidate individually to get its domain — reusing the
        // same single-path probe, not new discovery logic.
        const withDomains: Array<{ path: string; domain?: string }> = [];
        for (const path of candidates) {
          const p = await client.mutate<{ nexusHostProbe: any }>(`
            mutation($alias: String!, $path: String) {
              nexusHostProbe(alias: $alias, path: $path) { success report { ${PROBE_FIELDS} } }
            }
          `, { alias, path });
          const r = p.nexusHostProbe?.report;
          withDomains.push({ path, domain: r?.siteUrl ? new URL(r.siteUrl).hostname : undefined });
        }

        if (options.yes || quiet) {
          selections = withDomains.map((c) => ({
            path: c.path, site: suggestSiteSlug(c.domain, alias), environment: options.env ?? 'production',
          }));
        } else {
          selections = [];
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            for (const c of withDomains) {
              const suggested = suggestSiteSlug(c.domain, alias);
              const answer = (await prompt(
                rl, `  [${c.domain ?? c.path}] register as '${suggested}'? [Y/n/name] `,
              )).trim();
              if (answer.toLowerCase() === 'n') continue;
              const site = answer && answer.toLowerCase() !== 'y' ? answer : suggested;
              selections.push({ path: c.path, site, environment: options.env ?? 'production' });
            }
          } finally {
            rl.close();
          }
        }

        if (selections.length === 0) {
          if (quiet) {
            console.log(JSON.stringify({ registered: false, sites: [] }, null, 2));
            return;
          }
          console.log('\nNo sites selected. Connection registered with zero sites.');
          console.log(`  Add one later: nexus host add ${alias} --path <one-of-the-paths-above> --site <name>\n`);
          return;
        }
      } else {
        if (quiet) {
          console.log(JSON.stringify({ error: pr.report.failure ?? 'probe failed', report: pr.report }, null, 2));
          process.exit(1);
          return;
        }
        printFailure(pr.report);
        process.exit(1);
        return;
      }

      let anyFailed = false;
      const results: Array<{ site: string; registered: boolean; environment: string | null; error: string | null }> = [];
      for (const sel of selections) {
        const result = await client.mutate<{ nexusHostAdd: any }>(`
          mutation($alias: String!, $path: String, $environment: String, $site: String) {
            nexusHostAdd(alias: $alias, path: $path, environment: $environment, site: $site) {
              success error registered environment report { ${PROBE_FIELDS} }
            }
          }
        `, { alias, path: sel.path, environment: sel.environment, site: sel.site });

        const { success, error, registered, environment } = result.nexusHostAdd;
        results.push({ site: sel.site, registered: !!(success && registered), environment, error });
        if (!success || !registered) {
          anyFailed = true;
          if (!quiet) console.error(`✗ ${sel.site}: ${error ?? 'registration failed'}`);
          continue;
        }
        if (!quiet) {
          console.log(`✓ Registered ${alias}/${sel.site}`);
          console.log(`  Try: nexus wp core version ssh:${alias}/${sel.site}@${environment ?? 'production'}`);
        }
      }

      if (quiet) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log('');
      }
      if (anyFailed) process.exit(1);
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

// ============================================================================
// host refresh
// ============================================================================

hostCommand
  .command('refresh <alias>')
  .description('Collect WordPress metadata from a registered external host now')
  .action(async (alias: string) => {
    try {
      // Same extended budget as host add/test: a full four-batch refresh is
      // measured at 40s+, well over the client library's default. With the
      // default, the CLI printed failure and exited 1 while the server kept
      // running and wrote real data seconds later — inviting the user to re-run
      // and double the load on a third party's production server.
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });
      const result = await client.mutate<{ nexusHostRefresh: any }>(`
        mutation($alias: String!) {
          nexusHostRefresh(alias: $alias) {
            success error wpVersion phpVersion pluginCount themeCount
          }
        }
      `, { alias });

      const { success, error, wpVersion, phpVersion, pluginCount, themeCount } = result.nexusHostRefresh;
      if (!success) {
        console.error(`\n✗ ${error}`);
        process.exit(1);
      }
      console.log(`\n✓ Refreshed ${alias}`);
      console.log(`  WordPress:  ${wpVersion ?? 'unknown'}`);
      console.log(`  PHP:        ${phpVersion ?? 'unknown'}`);
      console.log(`  Plugins:    ${pluginCount ?? 'not collected'}`);
      console.log(`  Themes:     ${themeCount ?? 'not collected'}`);
      console.log('');
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host index
// ============================================================================

hostCommand
  .command('index <alias>')
  .description('Content-index a registered external host now, for semantic search')
  .action(async (alias: string) => {
    try {
      // Same extended budget as host refresh: content indexing over SSH is not
      // faster than metadata refresh, and the default client timeout is too
      // short for this class of command.
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });
      const result = await client.mutate<{ nexusHostIndex: any }>(`
        mutation($alias: String!) {
          nexusHostIndex(alias: $alias) {
            success error documentCount
          }
        }
      `, { alias });

      const { success, error, documentCount } = result.nexusHostIndex;
      if (!success) {
        console.error(`\n✗ ${error}`);
        process.exit(1);
      }
      console.log(`\n✓ Indexed ${alias}`);
      console.log(`  Documents:  ${documentCount ?? 'not collected'}`);
      console.log('');
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

export { hostCommand };
