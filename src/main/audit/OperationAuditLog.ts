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
 * File location: ~/Library/Application Support/Local/nexus-ai/operation-audit.log
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { redactParams, maskSecretsInString } from '../mcp/audit';
import { rotateIfNeeded, DEFAULT_MAX_BYTES, DEFAULT_KEEP } from '../logging/rotate';

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
  private readonly maxBytes: number;
  private readonly keep: number;

  constructor(
    private logPath: string,
    opts?: { maxBytes?: number; keep?: number },
  ) {
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.keep = opts?.keep ?? DEFAULT_KEEP;
  }

  /**
   * Append a new entry to the audit log.
   * Synchronous write — ensures the entry is durably flushed before returning.
   *
   * `parameters` is redacted HERE rather than at the call site: this log now
   * receives arbitrary tool arguments from the dispatch chokepoints, so a
   * call-site convention would eventually leak a token to disk. `error` is
   * masked the same way — for a failed WP-CLI or CAPI call it is raw tool
   * output, which routinely carries connection strings and bearer tokens.
   *
   * Never throws — a failed audit write must not break the audited operation.
   * Entry construction is inside the try for that reason: `randomUUID()` and
   * the recursive redaction walk are both capable of throwing.
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    let full: AuditEntry;
    try {
      full = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: this.currentUser(),
        ...entry,
        parameters: redactParams(entry.parameters ?? {}),
        ...(entry.error !== undefined
          ? { error: maskSecretsInString(String(entry.error)) }
          : {}),
      };
    } catch {
      // Losing the detail beats losing the record that something happened.
      full = {
        id: '00000000-0000-0000-0000-000000000000',
        timestamp: new Date().toISOString(),
        operation: String(entry?.operation ?? 'unknown'),
        target: String(entry?.target ?? 'unknown'),
        parameters: { _redactionFailed: true },
        outcome: entry?.outcome ?? 'failure',
      };
    }

    try {
      this.ensureDir();
      rotateIfNeeded(this.logPath, this.maxBytes, this.keep);
      fs.appendFileSync(this.logPath, JSON.stringify(full) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // Fail open. The caller still receives the entry for in-process use.
    }

    return full;
  }

  /**
   * Read all entries on disk, optionally filtered.
   * Returns entries in reverse chronological order (newest first).
   *
   * Rotated generations are included. `rotateIfNeeded` moves history out of
   * `logPath` into `.1`/`.2`/`.3`, so reading only `logPath` would silently
   * drop everything older than the current generation — and `export()` is
   * built on this method and promises a complete compliance record.
   */
  list(
    limit?: number,
    filter?: { operation?: string },
  ): AuditEntry[] {
    const entries: AuditEntry[] = [];

    // Oldest generation first (`.keep` … `.1`), then the live file, so the
    // accumulated order stays chronological.
    for (let i = this.keep; i >= 1; i--) {
      this.readInto(`${this.logPath}.${i}`, filter, entries);
    }
    this.readInto(this.logPath, filter, entries);

    // Reverse chronological — newest first
    entries.reverse();

    if (limit !== undefined && limit > 0) {
      return entries.slice(0, limit);
    }

    return entries;
  }

  /** Append parsed entries from one generation file. Missing files are skipped. */
  private readInto(
    filePath: string,
    filter: { operation?: string } | undefined,
    out: AuditEntry[],
  ): void {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return; // does not exist, or unreadable
    }

    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (filter?.operation && entry.operation !== filter.operation) continue;
        out.push(entry);
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Export every entry on disk — including rotated generations — to a separate
   * JSONL file, oldest first.
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
