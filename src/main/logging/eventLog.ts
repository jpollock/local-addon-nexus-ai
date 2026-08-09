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

import * as fs from 'fs';
import * as path from 'path';
import { rotateIfNeeded, DEFAULT_MAX_BYTES } from './rotate';

const ORDER: Record<LogLevelName, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

export interface EventLogOptions {
  root: string;
  minLevel?: LogLevelName;
  maxBytes?: number;
  /** Injectable clock, so the midnight-rollover test does not need to wait for midnight. */
  now?: () => Date;
}

/**
 * Owns the log directory: the daily filename, the dual write, and the size guard.
 *
 * Callers hand it an event and know nothing about paths — which is what keeps agents out of the
 * filesystem entirely, and what makes the layout changeable in one place.
 */
export class EventLog {
  private readonly root: string;
  private readonly minLevel: LogLevelName;
  private readonly maxBytes: number;
  private readonly now: () => Date;

  constructor(opts: EventLogOptions) {
    this.root = opts.root;
    this.minLevel = opts.minLevel ?? 'INFO';
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = opts.now ?? (() => new Date());
  }

  pathsFor(e: LogEvent): { combined: string; agent?: string } {
    const day = (e.at ?? this.now()).toISOString().slice(0, 10);
    return {
      combined: path.join(this.root, `nexus-${day}.log`),
      agent: e.sourceKind === 'agent'
        ? path.join(this.root, 'agents', `${e.source}-${day}.log`)
        : undefined,
    };
  }

  write(e: LogEvent): void {
    try {
      if (ORDER[e.level] > ORDER[this.minLevel]) return;
      const at = e.at ?? this.now();
      const line = formatLine({ ...e, at }) + '\n';
      const { combined, agent } = this.pathsFor({ ...e, at });
      this.append(combined, line);
      if (agent) this.append(agent, line);
    } catch { /* logging must never break a run */ }
  }

  private append(file: string, line: string): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      rotateIfNeeded(file, this.maxBytes);
      fs.appendFileSync(file, line);
    } catch { /* one unwritable destination must not stop the other */ }
  }
}
