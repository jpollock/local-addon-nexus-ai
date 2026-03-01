import * as fs from 'fs';
import * as path from 'path';
import type { SafetyTier } from './safety';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  toolName: string;
  tier: SafetyTier;
  params: Record<string, unknown>;
  confirmed: boolean | null;
  result: 'success' | 'error' | 'confirmation_required';
  error?: string;
  duration_ms: number;
}

export interface AuditLogger {
  log(entry: AuditEntry): void;
  getEntries(): AuditEntry[];
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = ['password', 'token', 'secret', 'key', 'certificate', 'private_key'];

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (SENSITIVE_PATTERNS.some((p) => lower.includes(p))) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => redactValue(String(i), item));
  }
  if (value !== null && typeof value === 'object') {
    return redactParams(value as Record<string, unknown>);
  }
  return value;
}

export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    redacted[k] = redactValue(k, v);
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export function createAuditLogger(logPath?: string): AuditLogger {
  const entries: AuditEntry[] = [];

  return {
    log(entry: AuditEntry): void {
      const redacted: AuditEntry = {
        ...entry,
        params: redactParams(entry.params),
      };
      entries.push(redacted);
    },

    getEntries(): AuditEntry[] {
      return [...entries];
    },

    async flush(): Promise<void> {
      if (!logPath || entries.length === 0) return;
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(logPath, lines, { encoding: 'utf-8', mode: 0o600 });
      entries.length = 0;
    },
  };
}
