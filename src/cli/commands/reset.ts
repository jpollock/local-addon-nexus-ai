/**
 * nexus reset --factory
 *
 * Wipes all Nexus AI addon data as if the addon was just installed:
 *   - IndexRegistry (content index state)
 *   - SiteMetadataCache (WP versions, plugins, themes)
 *   - Settings (AI provider, WPE permissions, scheduler config, etc.)
 *   - API key status cache
 *   - Site AI configs
 *   - WPE install cache
 *   - DB scan cache
 *   - Graph DB (SQLite — plugins, themes, users, WPE sites, events)
 *   - Vector store (LanceDB — all embeddings)
 *
 * What survives:
 *   - API keys (stored in macOS Keychain, not in these files)
 *   - WPE OAuth session (Local's own auth layer)
 *   - Telemetry installationId (nexus-ai/config.json)
 *
 * Local MUST be stopped before running this — electron-store flushes
 * to disk on exit and would overwrite the deleted files.
 */

import { Command } from 'commander';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { getLocalPaths } from '../bootstrap/paths';

const ADDON_PREFIX = 'nexus-ai';

function getDataFiles(dataDir: string): Array<{ label: string; path: string; isDir?: boolean }> {
  return [
    { label: 'Index registry (content index state)',   path: path.join(dataDir, `${ADDON_PREFIX}_index_registry.json`) },
    { label: 'Site metadata cache (WP version, plugins)', path: path.join(dataDir, `${ADDON_PREFIX}_site_metadata.json`) },
    { label: 'Settings (provider, permissions, etc.)', path: path.join(dataDir, `${ADDON_PREFIX}_settings.json`) },
    { label: 'API key status cache',                   path: path.join(dataDir, `${ADDON_PREFIX}_api_key_status.json`) },
    { label: 'Site AI configurations',                 path: path.join(dataDir, `${ADDON_PREFIX}_site_ai_config.json`) },
    { label: 'WPE install cache',                      path: path.join(dataDir, `${ADDON_PREFIX}_wpe_install_cache.json`) },
    { label: 'DB scan cache',                          path: path.join(dataDir, `${ADDON_PREFIX}_db_scan_cache.json`) },
    { label: 'Graph DB (plugins, themes, users, events)', path: path.join(dataDir, ADDON_PREFIX, 'graph.db') },
    { label: 'Graph DB WAL files',                     path: path.join(dataDir, ADDON_PREFIX, 'graph.db-shm') },
    { label: 'Graph DB WAL files',                     path: path.join(dataDir, ADDON_PREFIX, 'graph.db-wal') },
    { label: 'Vector store / embeddings (LanceDB)',    path: path.join(dataDir, ADDON_PREFIX, 'vectors'), isDir: true },
  ];
}

function isLocalRunning(dataDir: string): boolean {
  try {
    const infoFile = path.join(dataDir, 'graphql-connection-info.json');
    if (!fs.existsSync(infoFile)) return false;
    // If the GraphQL info file exists and was modified recently, Local may be running
    const stat = fs.statSync(infoFile);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < 60 * 60 * 1000; // modified in last hour = likely running
  } catch {
    return false;
  }
}

function deleteItem(entry: { path: string; isDir?: boolean }): 'deleted' | 'not-found' | 'error' {
  try {
    if (!fs.existsSync(entry.path)) return 'not-found';
    if (entry.isDir) {
      // Rename first (atomic O(1)), then delete in background — avoids blocking
      // for minutes on large directories (LanceDB vectors: 1M+ files, multi-GB)
      const tmpPath = entry.path + '_deleting_' + Date.now();
      fs.renameSync(entry.path, tmpPath);
      exec(`rm -rf "${tmpPath}"`); // fire-and-forget
    } else {
      fs.unlinkSync(entry.path);
    }
    return 'deleted';
  } catch {
    return 'error';
  }
}

async function promptConfirm(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Type "reset" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'reset');
    });
  });
}

export const resetCommand = new Command('reset')
  .description('Factory reset — wipe all Nexus AI data as if the addon was just installed')
  .option('--factory', 'Required flag — confirms this is a full data wipe')
  .option('--confirm', 'Skip interactive confirmation prompt')
  .option('--dry-run', 'Show what would be deleted without deleting anything')
  .action(async (options) => {
    if (!options.factory) {
      console.error('Error: --factory flag required. This command wipes all Nexus AI data.');
      console.error('Usage: nexus reset --factory');
      process.exit(1);
    }

    const { dataDir } = getLocalPaths();
    const entries = getDataFiles(dataDir);
    const existing = entries.filter(e => fs.existsSync(e.path));

    if (existing.length === 0) {
      console.log('\n✓ Already clean — no Nexus AI data found.\n');
      process.exit(0);
    }

    // Warning header
    console.log('\n⚠  NEXUS AI FACTORY RESET\n');
    console.log('This will permanently delete:\n');
    existing.forEach(e => console.log(`  • ${e.label}`));
    console.log('\nWhat is NOT deleted:');
    console.log('  • API keys (stored in macOS Keychain)');
    console.log('  • WPE OAuth session');
    console.log('  • Telemetry ID\n');

    // Local running check
    if (isLocalRunning(dataDir)) {
      console.log('⚠  Local appears to be running. Stop Local before resetting,');
      console.log('   otherwise electron-store will recreate the deleted files on exit.\n');
    }

    if (options.dryRun) {
      console.log('DRY RUN — nothing deleted. Remove --dry-run to execute.\n');
      process.exit(0);
    }

    // Confirmation
    if (!options.confirm) {
      const confirmed = await promptConfirm();
      if (!confirmed) {
        console.log('\nCancelled.\n');
        process.exit(0);
      }
    }

    // Execute
    console.log('\nDeleting...\n');
    let deleted = 0;
    let errors = 0;

    for (const entry of entries) {
      const result = deleteItem(entry);
      if (result === 'deleted') {
        console.log(`  ✓ ${entry.label}`);
        deleted++;
      } else if (result === 'error') {
        console.log(`  ✗ ${entry.label} (error)`);
        errors++;
      }
      // not-found = skip silently
    }

    console.log(`\n${deleted} items deleted${errors > 0 ? `, ${errors} errors` : ''}.`);
    console.log('\nRestart Local — Nexus AI will initialize from scratch.\n');

    process.exit(errors > 0 ? 1 : 0);
  });
