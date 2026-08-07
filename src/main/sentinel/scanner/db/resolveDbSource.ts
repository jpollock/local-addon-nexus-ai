import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Decide whether `app/sql/local.sql` is trustworthy enough to read as the site's current
 * database — without starting the site, without connecting to anything, and without ever
 * reporting a stale or absent dump as if it were current data.
 *
 * A RUNNING site is refused outright, never scored by mtime lag. A live mysqld's redo log and
 * data files can be mid-write at the instant this check runs; a small measured lag does not
 * prove there is no in-flight transaction the dump cannot see. Reading its own socket while
 * running is a live mysqld's job, not this one — see the note in the module doc for
 * checks/database.ts on why that is deliberately out of scope here.
 *
 * A HALTED site's dump is trusted only when:
 *   - the file exists and is readable,
 *   - it carries mysqldump's own `-- Dump completed on` trailer (its absence means a crash, a
 *     killed process, or a disk-full write — a partial file, not an old one),
 *   - and the InnoDB/Aria data files are not newer than the dump by more than the threshold.
 *
 * THRESHOLD MEASURED against 38 real sites: `SiteDatabaseService.dump()` runs mysqldump
 * *before* `stopAll()`, so a graceful stop always leaves the dump a few seconds older than
 * mysqld's own shutdown flush — 29 of 38 sites measured at 0-4 seconds. A process killed out
 * from under mysqld (a `pkill`, a crash) skips the dump entirely: 7 of 38 sites measured at
 * 59,292-63,108 seconds. The chosen threshold sits with a 46x margin from the clean cluster and
 * a 954x margin from the killed cluster — there is no real case observed in between.
 */
const STALE_THRESHOLD_MS = 60_000;

const DEFAULT_RUN_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'run');

export type DbSource =
  | { ok: true; dumpPath: string; asOf: Date; lagMs: number }
  | {
      ok: false;
      reason: 'site-running' | 'no-dump' | 'unreadable' | 'no-completion-marker' | 'stale';
      detail: string;
    };

function socketExists(siteId: string, runDirBase: string): boolean {
  const runDir = path.join(runDirBase, siteId);
  return ['mysql', 'mariadb'].some((engine) =>
    fs.existsSync(path.join(runDir, engine, 'mysqld.sock')));
}

/** Newest mtime among a site's InnoDB/Aria data files, or null if the run/ directory is absent
 *  (the ordinary case for a site that has never been started, or whose run dir was cleaned up). */
function newestDataFileMtime(siteId: string, runDirBase: string): number | null {
  const runDir = path.join(runDirBase, siteId);
  let newest: number | null = null;
  for (const engine of ['mysql', 'mariadb']) {
    const dataDir = path.join(runDir, engine, 'data');
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dataDir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const mtime = fs.statSync(path.join(dataDir, e.name)).mtimeMs;
        if (newest === null || mtime > newest) newest = mtime;
      } catch { /* raced a delete — skip */ }
    }
  }
  return newest;
}

/** `runDirBase` defaults to Local's real run/ directory — overridable so tests never touch it. */
export function resolveDbSource(siteId: string, webRoot: string, runDirBase: string = DEFAULT_RUN_DIR): DbSource {
  if (socketExists(siteId, runDirBase)) {
    return {
      ok: false, reason: 'site-running',
      detail: 'the site is currently running — its dump cannot reflect in-flight state, and this scanner does not connect to a live mysqld',
    };
  }

  const dumpPath = path.join(path.dirname(webRoot), 'sql', 'local.sql');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dumpPath);
  } catch {
    return { ok: false, reason: 'no-dump', detail: `${dumpPath} does not exist` };
  }

  // Reading the whole file just for a trailer is wasteful on a multi-hundred-MB dump; the
  // trailer is always in the last ~60 bytes ("-- Dump completed on YYYY-MM-DD HH:MM:SS\n").
  let tail = '';
  try {
    const fd = fs.openSync(dumpPath, 'r');
    const len = Math.min(200, stat.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stat.size - len);
    fs.closeSync(fd);
    tail = buf.toString('latin1');
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: (err as Error).message };
  }
  if (!/-- Dump completed on/.test(tail)) {
    return {
      ok: false, reason: 'no-completion-marker',
      detail: 'dump has no completion trailer — the write that produced it did not finish',
    };
  }

  const newestData = newestDataFileMtime(siteId, runDirBase);
  const lagMs = newestData !== null ? newestData - stat.mtimeMs : 0;
  if (lagMs > STALE_THRESHOLD_MS) {
    return {
      ok: false, reason: 'stale',
      detail: `database files are ${Math.round(lagMs / 1000)}s newer than the dump — the site was likely stopped uncleanly`,
    };
  }

  return { ok: true, dumpPath, asOf: stat.mtime, lagMs };
}
