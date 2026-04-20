/**
 * OperationAuditLog
 *
 * Append-only JSONL log for Tier 2/3 destructive operations.
 * Each entry is written to disk as a single JSON line.
 *
 * Separate from AuditLogger (which uses RegistryStorage in-memory) — this
 * writes directly to disk so entries survive crashes and can be exported for
 * compliance review.
 *
 * File location: ~/Library/Application Support/Local/nexus-ai/audit.log
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;             // UUID v4
  timestamp: string;      // ISO 8601
  operation: string;      // e.g. 'wpe.backup.create'
  target: string;         // install name, site ID, or other resource identifier
  parameters: Record<string, unknown>;
  outcome: 'success' | 'failure' | 'pending';
  error?: string;
  userId?: string;        // machine username from os.userInfo()
}

// ---------------------------------------------------------------------------
// OperationAuditLog
// ---------------------------------------------------------------------------

export class OperationAuditLog {
  constructor(private logPath: string) {}

  /**
   * Append a new entry to the audit log.
   * Synchronous write — ensures the entry is durably flushed before returning.
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: this.currentUser(),
      ...entry,
    };

    this.ensureDir();
    fs.appendFileSync(this.logPath, JSON.stringify(full) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });

    return full;
  }

  /**
   * Read all entries from the log file, optionally filtered.
   * Returns entries in reverse chronological order (newest first).
   */
  list(
    limit?: number,
    filter?: { operation?: string },
  ): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    const raw = fs.readFileSync(this.logPath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (filter?.operation && entry.operation !== filter.operation) continue;
        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    // Reverse chronological — newest first
    entries.reverse();

    if (limit !== undefined && limit > 0) {
      return entries.slice(0, limit);
    }

    return entries;
  }

  /**
   * Export all entries to a separate JSONL file.
   */
  export(outputPath: string): void {
    const entries = this.list(); // newest first
    // Re-sort chronologically for export (oldest first)
    entries.reverse();

    this.ensureOutputDir(outputPath);
    const lines = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(outputPath, lines + (lines ? '\n' : ''), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureDir(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private ensureOutputDir(outputPath: string): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private currentUser(): string {
    try {
      return os.userInfo().username;
    } catch {
      return 'unknown';
    }
  }
}

// ---------------------------------------------------------------------------
// Default log path helper
// ---------------------------------------------------------------------------

export function defaultAuditLogPath(): string {
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Local',
    'nexus-ai',
    'operation-audit.log',
  );
}
