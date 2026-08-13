/**
 * nexus creds — credential rotation (P1-7)
 */
import { Command } from 'commander';
import { getClient } from '../utils/graphql';

interface RotateResult {
  success: boolean;
  error?: string;
  targetVersion: number;
  synced: string[];
  stale: string[];
  gateway: string[];
}

const credsCommand = new Command('creds').description('Manage Nexus AI credentials');

credsCommand
  .command('rotate <provider>')
  .description([
    'Propagate the current provider key to running local sites and report which sites are stale.',
    '',
    'Recommended flow after a leak:',
    '  1. Revoke the leaked key in the provider console (this is what stops abuse).',
    '  2. Set the new key (nexus ai config / Settings UI).',
    '  3. Run this to push it to running sites. Stopped sites sync automatically on next start;',
    '     gateway sites are rotated for free (the gateway reads the vault live).',
    '',
    'Use --force-now to also start stopped stale sites, sync them, and stop them again (slower;',
    'boots MySQL/PHP per site).',
    '',
    'See docs/incident-response.md for the full runbook.',
  ].join('\n'))
  .option('--force-now', 'Start stopped stale sites, sync them immediately, then restore their stopped state')
  .action(async (provider: string, options: { forceNow?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusRotateCredentials: RotateResult }>(`
        mutation($provider: String!, $force: Boolean) {
          nexusRotateCredentials(provider: $provider, force: $force) {
            success error targetVersion synced stale gateway
          }
        }
      `, { provider, force: Boolean(options.forceNow) });

      const r = result.nexusRotateCredentials;
      if (!r.success) {
        console.error(`Error: ${r.error ?? 'Rotation failed'}`);
        process.exit(1);
      }

      console.log(`\nCredential rotation — ${provider} (version ${r.targetVersion})`);
      console.log('─'.repeat(48));
      console.log(`✓ Synced now (${r.synced.length}): ${r.synced.join(', ') || '—'}`);
      if (r.stale.length > 0) {
        console.log(`⚠ Stale — will sync on next start (${r.stale.length}): ${r.stale.join(', ')}`);
      }
      if (r.gateway.length > 0) {
        console.log(`  Gateway sites, auto-rotated (${r.gateway.length}): ${r.gateway.join(', ')}`);
      }
      console.log('\nReminder: revoke the old key in the provider console if you have not already.');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

export { credsCommand };
