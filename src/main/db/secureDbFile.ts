import * as fs from 'fs';

/**
 * Restrict a SQLite database file (and its WAL/SHM sidecars) to owner-only
 * read/write (0600).
 *
 * graph.db and vectors.db hold customer emails, indexed site content, and chat
 * transcripts, yet were created 0644 — world-readable — while every log this
 * app writes is deliberately 0600. Any other local user (or a compromised
 * same-machine process running as a different user) could read them (P1-4).
 *
 * Call this AFTER `PRAGMA journal_mode = WAL`, so the `-wal`/`-shm` sidecars
 * (which carry recently-written, not-yet-checkpointed data) already exist.
 *
 * Best-effort: a chmod failure — a not-yet-created sidecar, or a filesystem
 * that ignores Unix modes — must never stop the database from opening.
 */
export function secureDbFile(dbPath: string): void {
  if (!dbPath || dbPath === ':memory:') return;
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.chmodSync(p, 0o600);
    } catch {
      // ENOENT (sidecar not created yet) or an unsupported filesystem — ignore.
    }
  }
}
