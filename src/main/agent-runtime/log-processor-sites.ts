import * as fs from 'fs';
import * as path from 'path';

/**
 * Sites log-processor already has a bound S3 log source for — read directly from its own sqlite
 * file (agents/log-processor/db.ts's `sources` table), read-only, the same way GET_SITES reads
 * graph.db directly rather than routing a plain SELECT through the agent runtime.
 *
 * Extracted from the IPC handler (src/main/ipc-handlers.ts) so it can be unit-tested against a
 * temp directory instead of the real, non-empty `~/Library/Application Support/.../agents/`
 * tree this addon writes to on a real machine.
 */
export function getLogProcessorConnectedSites(agentsDir: string): string[] {
  const dbPath = path.join(agentsDir, 'log-processor', 'logs.sqlite');
  if (!fs.existsSync(dbPath)) return [];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new BetterSqlite3(dbPath, { readonly: true });
  try {
    return (db.prepare('SELECT site FROM sources').all() as Array<{ site: string }>).map(r => r.site);
  } finally {
    db.close();
  }
}
