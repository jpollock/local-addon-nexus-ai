/**
 * Shared log rotation + pruning primitives.
 *
 * Every durable writer in this addon (agent logs, the main process log, the
 * operation audit log) appends synchronously with no size limit. These helpers
 * are the single place that bounds them.
 *
 * Contract: NEVER throws. A logging fault must never become an operational
 * fault — this addon manages production WordPress sites.
 */
import * as fs from 'fs';
import * as path from 'path';

/** 5 MiB — roughly 20k agent log lines, small enough to open in an editor. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Keep 3 rotated generations (.1 .2 .3) → 20 MiB worst case per log. */
export const DEFAULT_KEEP = 3;

/**
 * Rotate `filePath` if it has reached `maxBytes`.
 *
 * Generations shift upward: file → file.1 → file.2 → ... → file.<keep>, and the
 * oldest is dropped. After rotation `filePath` no longer exists; the caller's
 * next appendFileSync re-creates it. Truncation is deliberately not used — it
 * discards history at exactly the moment it is most wanted.
 */
export function rotateIfNeeded(
  filePath: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
  keep: number = DEFAULT_KEEP,
): void {
  try {
    const size = fs.statSync(filePath).size;
    if (size < maxBytes) return;
  } catch {
    return; // does not exist yet, or unreadable — nothing to rotate
  }

  // Shift downward from the second-oldest so renames never clobber a live file.
  // renameSync overwrites its destination, which drops generation `keep` for free.
  for (let i = keep - 1; i >= 1; i--) {
    try {
      if (fs.existsSync(`${filePath}.${i}`)) {
        fs.renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
      }
    } catch { /* best effort — a stuck generation must not block rotation */ }
  }

  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch { /* best effort — if this fails the file simply keeps growing */ }
}

/**
 * Delete all but the `keep` newest files in `dir` matching `pattern`.
 * Used for many-small-files logs (per-run agent logs) where rotation does not
 * apply. Returns the number of files deleted.
 */
export function pruneOldFiles(dir: string, pattern: RegExp, keep: number): number {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0; // directory does not exist
  }

  const matched: Array<{ full: string; mtime: number }> = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile()) matched.push({ full, mtime: st.mtimeMs });
    } catch { /* vanished mid-scan */ }
  }

  matched.sort((a, b) => b.mtime - a.mtime); // newest first

  let deleted = 0;
  for (const { full } of matched.slice(keep)) {
    try { fs.unlinkSync(full); deleted++; } catch { /* best effort */ }
  }
  return deleted;
}
