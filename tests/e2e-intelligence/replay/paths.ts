/**
 * WP-18 · Where the live ledger is.
 *
 * Kept pure and pinned because everything downstream depends on the replay
 * having read the RIGHT file: a wrong path finds no ledger, replays nothing,
 * and would otherwise report a clean pass over an empty set.
 */
import * as path from 'path';

/** Local's userData directory — the same resolution the CLI e2e setup uses. */
export function localDataDir(platform: NodeJS.Platform, home: string): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Local');
  if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Local');
  }
  return path.join(home, '.config', 'Local');
}

/** The path `initIntelligenceCore` builds: `<dataDir>/nexus-ai/ledger.db`. */
export function liveLedgerPath(platform: NodeJS.Platform, home: string): string {
  return path.join(localDataDir(platform, home), 'nexus-ai', 'ledger.db');
}
