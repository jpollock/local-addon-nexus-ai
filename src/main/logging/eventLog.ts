import { redactParams, maskSecretsInString } from '../mcp/audit';

export type LogLevelName = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * The fixed event vocabulary. Anything outside it is a freeform line with no `event`.
 * Keeping this closed is what lets `grep llm.call` or `grep mutation` be reliable.
 */
export type EventName =
  | 'run.start' | 'run.end' | 'run.skip'
  | 'phase' | 'finding' | 'mutation'
  | 'llm.call' | 'llm.error'
  | 'tool.call'
  | 'credential';

export interface LogEvent {
  level: LogLevelName;
  /** Agent name, or 'chat' / 'gateway'. */
  source: string;
  runId?: string;
  event?: EventName;
  fields?: Record<string, unknown>;
  message?: string;
  /** Injectable for tests; defaults to now. */
  at?: Date;
  /** Agents also get their own file; system sources only reach the combined stream. */
  sourceKind?: 'agent' | 'system';
}

function timeOf(at: Date): string {
  // Time only — the date is in the filename, and repeating it spends ten columns of terminal
  // width on information the reader already has.
  return at.toISOString().slice(11, 23);
}

function renderValue(v: unknown): string {
  const s = maskSecretsInString(String(v ?? ''));
  // A bare space or '=' would break key=value parsing on the way back out.
  return /[\s="]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * One event, one line. Newlines are collapsed rather than escaped: a multi-line payload belongs
 * in a transcript sidecar (Phase 2), and allowing one here would break every `tail`-based
 * assumption in this design.
 */
export function formatLine(e: LogEvent): string {
  const at = e.at ?? new Date();
  const parts: string[] = [timeOf(at), e.level.padEnd(5), e.source];

  if (e.runId) parts.push(`run=${e.runId}`);
  if (e.event) parts.push(e.event);

  if (e.fields) {
    const safe = redactParams(e.fields);
    for (const [k, v] of Object.entries(safe)) {
      if (v === undefined || v === null) continue;
      parts.push(`${k}=${renderValue(v)}`);
    }
  }

  let line = parts.join(' ');
  if (e.message) {
    const msg = maskSecretsInString(e.message).replace(/\s*\n\s*/g, ' ').trim();
    if (msg) line += `  ${msg}`;
  }
  return line;
}
