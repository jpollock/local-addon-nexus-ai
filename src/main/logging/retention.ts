/**
 * Retention: days, a disk budget, and preserved failures.
 *
 * Phase 1's `rotateIfNeeded` bounds one day's file by size; nothing bounds the
 * number of days, so the directory grows without limit. This module sweeps old
 * files, runs daily, and skips runs worth auditing.
 *
 * Contract: NEVER throws. A cleanup fault must never become an operational fault.
 */
import * as fs from 'fs';
import * as path from 'path';
import { localDay } from './eventLog';
import { createLogger } from './Logger';

export interface LogFileInfo {
  path: string;
  category: 'combined' | 'agent' | 'transcript';
  /** YYYY-MM-DD, from the filename or file mtime. Sorts lexically, which is why the format matters. */
  day: string;
  bytes: number;
  /** True when this file records a failed or Tier 3 run — never evicted. */
  preserved: boolean;
}

export interface RetentionPolicy { logDays: number; transcriptDays: number; budgetBytes: number }
export interface RetentionPlan { deletePaths: string[]; freedBytes: number; keptBytes: number }

const DAY_IN_NAME = /(\d{4}-\d{2}-\d{2})/;

const logger = createLogger('Retention');

/**
 * What retention would delete, decided before anything is deleted.
 *
 * Pure on purpose: "Clear logs" has to state what it will remove, and a UI cannot honestly
 * promise that if the decision only exists inside the deleting loop.
 *
 * Preserved files are exempt from BOTH passes. A run that errored, timed out, or performed a Tier 3
 * operation is the one most worth auditing; ageing it out on the same schedule as a quiet run —
 * or evicting it to satisfy a disk budget — defeats the point of keeping logs at all. Going over
 * budget is recoverable; losing the record of a failed production run is not.
 */
export function planRetention(files: LogFileInfo[], policy: RetentionPolicy, now?: () => Date): RetentionPlan {
  const cutoff = (days: number): string => {
    // Copy the date before mutating — a clock returning a shared instance would otherwise
    // be mutated twice, making transcriptCutoff = today - logDays - transcriptDays.
    const d = new Date(now ? now() : new Date());
    d.setDate(d.getDate() - days);
    return localDay(d);
  };
  const logCutoff = cutoff(policy.logDays);
  const transcriptCutoff = cutoff(policy.transcriptDays);

  const doomed = new Set<string>();
  for (const f of files) {
    if (f.preserved) continue;
    const cut = f.category === 'transcript' ? transcriptCutoff : logCutoff;
    if (f.day < cut) doomed.add(f.path);
  }

  // Budget pass: oldest first, and only over files the day pass spared.
  let kept = files.filter(f => !doomed.has(f.path));
  let keptBytes = kept.reduce((n, f) => n + f.bytes, 0);
  if (keptBytes > policy.budgetBytes) {
    for (const f of [...kept].sort((a, b) => a.day.localeCompare(b.day))) {
      if (keptBytes <= policy.budgetBytes) break;
      if (f.preserved) continue;
      doomed.add(f.path);
      keptBytes -= f.bytes;
    }
    kept = files.filter(f => !doomed.has(f.path));
  }

  const deleted = files.filter(f => doomed.has(f.path));
  return {
    deletePaths: deleted.map(f => f.path),
    freedBytes: deleted.reduce((n, f) => n + f.bytes, 0),
    keptBytes: kept.reduce((n, f) => n + f.bytes, 0),
  };
}

/**
 * Scan, plan, unlink. Never throws: a cleanup fault must not fail a run.
 */
export function applyRetention(root: string, policy: RetentionPolicy): RetentionPlan {
  const empty: RetentionPlan = { deletePaths: [], freedBytes: 0, keptBytes: 0 };
  try {
    const files: LogFileInfo[] = [];
    const scan = (dir: string, category: LogFileInfo['category']) => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const full = path.join(dir, name);
        let bytes = 0;
        let mtime: Date | undefined;
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          bytes = st.size;
          mtime = st.mtime;
        } catch { continue; }
        // Extract day from filename if present; otherwise use file mtime
        let day = DAY_IN_NAME.exec(name)?.[1];
        if (!day && mtime) {
          day = localDay(mtime);
        }
        if (!day) continue;
        files.push({ path: full, category, day, bytes, preserved: isPreserved(full) });
      }
    };
    scan(root, 'combined');
    scan(path.join(root, 'agents'), 'agent');
    scan(path.join(root, 'transcripts'), 'transcript');

    const plan = planRetention(files, policy);
    for (const p of plan.deletePaths) {
      // Individually wrapped: one undeletable file must not abort the sweep.
      try { fs.unlinkSync(p); } catch { /* leave it; the next sweep tries again */ }
    }

    // Warn when preserved files push the directory over budget
    if (plan.keptBytes > policy.budgetBytes) {
      const overage = ((plan.keptBytes - policy.budgetBytes) / (1024 * 1024)).toFixed(1);
      logger.warn(`Retention budget exceeded by ${overage} MB due to preserved files (kept: ${(plan.keptBytes / (1024 * 1024)).toFixed(1)} MB, budget: ${(policy.budgetBytes / (1024 * 1024)).toFixed(1)} MB)`);
    }

    return plan;
  } catch {
    return empty;
  }
}

/**
 * A file records a run worth keeping: an error, timeout, or a mutation. Read cheaply — a scan runs daily
 * over files that can be megabytes, so this looks for the markers and stops caring about the rest.
 *
 * Reads incrementally with early exit: a 100 MB log directory is NOT pulled through the Node heap.
 * Chunk overlap ensures a marker straddling a boundary is not missed.
 */
function isPreserved(file: string): boolean {
  const CHUNK_SIZE = 64 * 1024; // 64 KB
  // These markers must match eventLog.ts:292 isPreservationCritical gate (the coupling is invisible
  // from either side). A marker must appear here AND be emitted regardless of log level there, or
  // the exemption looks like it works while doing nothing.
  const MARKERS = ['run.end status=error', 'run.end status=timeout', ' mutation op='];
  const MAX_MARKER_LEN = Math.max(...MARKERS.map(m => m.length));
  const OVERLAP = MAX_MARKER_LEN - 1;

  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
    let leftover = '';

    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) break;

      const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
      for (const marker of MARKERS) {
        if (chunk.includes(marker)) {
          fs.closeSync(fd);
          return true;
        }
      }

      // Carry the last (MAX_MARKER_LEN - 1) chars forward so a marker straddling the
      // chunk boundary is not missed. If the chunk is shorter than the overlap, carry it all.
      leftover = chunk.length >= OVERLAP ? chunk.slice(-OVERLAP) : chunk;
    }

    fs.closeSync(fd);
    return false;
  } catch {
    // Unreadable: treat as preserved. Deleting a file we could not inspect is the wrong default
    // for a record whose whole purpose is auditing.
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    return true;
  }
}
