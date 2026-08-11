/**
 * Shared log directory scanner.
 *
 * Both LOGGING_STATS and STORAGE_GET_HEALTH need total log size by category. Extracting one
 * scanner ensures they never silently disagree about how much disk the logs use — a future change
 * (excluding rotated `.1`/`.2` generations, adding a category) is made once.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_KEEP } from './rotate';

export interface LogSizes {
  combined: number;
  agent: number;
  transcript: number;
  audit: number;
  total: number;
}

/**
 * Scan log directories and return sizes by category.
 *
 * Never throws — a missing directory or unreadable file is treated as zero bytes. A storage-health
 * scan that throws is worse than one that reports partial data.
 */
export function scanLogDirectories(userDataPath: string): LogSizes {
  const sizes: LogSizes = { combined: 0, agent: 0, transcript: 0, audit: 0, total: 0 };

  const scan = (dir: string, category: keyof Omit<LogSizes, 'total'>) => {
    try {
      const entries = fs.readdirSync(dir);
      for (const name of entries) {
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) sizes[category] += st.size;
        } catch { /* skip unreadable file */ }
      }
    } catch { /* skip unreadable directory */ }
  };

  const logRoot = path.join(userDataPath, 'nexus-ai', 'logs');
  scan(logRoot, 'combined');
  scan(path.join(logRoot, 'agents'), 'agent');
  scan(path.join(logRoot, 'transcripts'), 'transcript');

  // Audit logs: explicit allowlist, not a directory sweep.
  // The nexus-ai/ directory also contains vectors.db and graph.db, which are not logs.
  const auditDir = path.join(userDataPath, 'nexus-ai');
  const auditFiles = ['audit.log', 'operation-audit.log'];
  for (const basename of auditFiles) {
    const auditPath = path.join(auditDir, basename);
    try {
      const st = fs.statSync(auditPath);
      if (st.isFile()) sizes.audit += st.size;
    } catch { /* skip missing or unreadable file */ }
    // Also count rotated generations (.1, .2, ..., .DEFAULT_KEEP)
    for (let gen = 1; gen <= DEFAULT_KEEP; gen++) {
      const rotatedPath = `${auditPath}.${gen}`;
      try {
        const st = fs.statSync(rotatedPath);
        if (st.isFile()) sizes.audit += st.size;
      } catch { /* skip missing generation */ }
    }
  }

  sizes.total = sizes.combined + sizes.agent + sizes.transcript + sizes.audit;
  return sizes;
}
