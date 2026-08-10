import { redactParams, maskSecretsInString, isIdentityField } from '../mcp/audit';

export type LogLevelName = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * The fixed event vocabulary. Anything outside it is a freeform line with no `event`.
 * Keeping this closed is what lets `grep llm.call` or `grep mutation` be reliable.
 */
export type EventName =
  | 'run.start' | 'run.end' | 'run.skip'
  | 'phase' | 'action' | 'site' | 'finding' | 'mutation'
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

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * LOCAL time, not UTC.
 *
 * The reader is a person looking at a terminal clock, and the line carries no `Z` and no offset
 * to warn them otherwise — a UTC stamp is simply the wrong time by the length of the offset.
 * The filename (`localDay`) is local for the same reason, and the two must not disagree.
 *
 * Time only — the date is in the filename, and repeating it spends ten columns of terminal
 * width on information the reader already has.
 *
 * Throws on an invalid Date, exactly as the `toISOString()` this replaced did, so `formatLine`'s
 * outer guard still turns one into a `log.error` line instead of `NaN:NaN:NaN.NaN`.
 */
function timeOf(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new RangeError('Invalid time value');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

/**
 * The log's day boundary, in the reader's own timezone.
 *
 * This is what makes the documented `tail -f nexus-$(date +%F).log` correct as written. Under a
 * UTC filename, every evening west of Greenwich that command follows a file nothing will ever
 * append to again — succeeding silently and showing nothing, during exactly the hours someone
 * is asking "why didn't my agent run tonight?".
 *
 * `en-CA` renders `YYYY-MM-DD`. The regex guard is not decoration: on a runtime built without
 * full ICU the locale falls back to `en-US` and yields `8/9/2026`, whose `/` is a path
 * separator, and an invalid Date yields the literal `Invalid Date`, whose space would land in a
 * filename. Both fall back to local date components, and an unusable clock to `unknown`.
 */
export function localDay(at: Date): string {
  if (!Number.isFinite(at.getTime())) return 'unknown';
  const day = at.toLocaleDateString('en-CA');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Safely convert any value to a string, even if toString() throws.
 * Used in the fallback handler to ensure the fallback line never throws.
 */
function safeString(v: unknown, fallback: string = 'unknown'): string {
  try {
    return String(v ?? fallback);
  } catch {
    return fallback;
  }
}

/**
 * Safely extract time from a potentially invalid Date.
 * Used in the fallback handler to ensure the fallback line never throws.
 */
function safeTimeOf(at: unknown): string {
  try {
    if (at instanceof Date && !isNaN(at.getTime())) {
      return timeOf(at);
    }
    return 'HH:MM:SS.SSS'; // constant placeholder for invalid/missing time
  } catch {
    return 'HH:MM:SS.SSS';
  }
}

/**
 * Mask the RENDERED form, WITH key context, then quote.
 *
 * Both halves matter and each one was got wrong once:
 *
 * - Masking the rendered string is not redundant with `redactParams`. That walk masks values it
 *   sees AS STRINGS; a value whose `String()` rendering is a secret — `{ toString: () =>
 *   'sk-…' }` — is walked as an object, never masked, and only becomes a credential at the
 *   moment this function renders it. No emitter passes such a value today, which is the same
 *   "merely unexercised" status the `emit` spread ordering had, and the same reason to close it
 *   structurally rather than trust it.
 * - Masking key-BLIND undoes the one carve-out key context buys: `redactParams` preserves
 *   `target` / `install_name` when the whole value is a legal WP Engine install name, and a
 *   blind second pass turned `mutation op=wp_plugin_update target=acmeprod2026staging1` into
 *   `target=[REDACTED]`, losing the one field that says which production install was changed.
 *
 * `identityField` only skips the opaque-alphanumeric-run rule (`audit.ts`'s `maskSecretsInString`
 * ), so `target=sk-…` or `target=AKIA…` is still masked — the carve-out is for install names,
 * not for the field.
 *
 * `message` gets `maskSecretsInString` in `formatLine` for a different reason: it is raw text
 * that never passes through `redactParams` at all.
 */
function renderValue(v: unknown, identityField: boolean): string {
  try {
    const s = maskSecretsInString(String(v ?? ''), identityField ? { identityField: true } : undefined);
    // A bare space or '=' would break key=value parsing on the way back out.
    return /[\s="]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  } catch {
    // Pathological toString() or Symbol.toPrimitive; return a safe placeholder
    return '[UNPRINTABLE]';
  }
}

function renderKey(k: string): string {
  try {
    // Keys must be masked and quoted like values
    const masked = maskSecretsInString(k);
    return /[\s="]/.test(masked) ? `"${masked.replace(/"/g, '\\"')}"` : masked;
  } catch {
    return '[UNPRINTABLE]';
  }
}

/**
 * One event, one line. Newlines are collapsed rather than escaped: a multi-line payload belongs
 * in a transcript sidecar (Phase 2), and allowing one here would break every `tail`-based
 * assumption in this design.
 *
 * Never throws — a failed format must not break a run. Returns a line describing the failure
 * so the event is not silently lost.
 *
 * THE LEVEL IS NOT PADDED, deliberately. Padding `INFO` and `WARN` to five columns emitted two
 * spaces after them and one after `DEBUG`/`ERROR`, so `awk -F'  ' '{print $2}'` returned the
 * message on a DEBUG line and the whole body on an INFO line. "Message separated by two spaces,
 * everything else by one" and "level padded to five" cannot both hold for a four-character
 * level; the two-space rule is the one a reader parses with, so it wins. The cost is column
 * alignment, and only that.
 */
export function formatLine(e: LogEvent): string {
  try {
    const at = e.at ?? new Date();
    const parts: string[] = [timeOf(at), String(e.level ?? 'INFO'), e.source];

    if (e.runId) parts.push(`run=${e.runId}`);
    if (e.event) parts.push(e.event);

    if (e.fields) {
      const safe = redactParams(e.fields);
      for (const [k, v] of Object.entries(safe)) {
        if (v === undefined || v === null) continue;
        // The RAW key, before renderKey masks it — a masked key would never match the identity
        // list, and the carve-out would be silently dead.
        const identity = isIdentityField(k);
        const renderedKey = renderKey(k);
        parts.push(`${renderedKey}=${renderValue(v, identity)}`);
      }
    }

    let line = parts.join(' ');
    if (e.message) {
      const msg = maskSecretsInString(e.message).replace(/\s*\n\s*/g, ' ').trim();
      if (msg) line += `  ${msg}`;
    }
    return line;
  } catch (err) {
    // Losing detail beats losing the record that something happened.
    // The fallback path must never access e properties without protection, as they
    // may contain pathological values (throwing toString(), invalid Date, etc).
    const timeStr = safeTimeOf(e?.at);
    const source = safeString(e?.source, 'unknown');
    const errorMsg = safeString(err instanceof Error ? err.message : 'unknown error', 'format failed');
    return `${timeStr} ERROR ${source} event=log.error  Failed to format event: ${errorMsg}`;
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { rotateIfNeeded, DEFAULT_MAX_BYTES } from './rotate';
import { LogLevel, createLogger } from './Logger';

export interface EventLogOptions {
  root: string;
  minLevel?: LogLevelName;
  maxBytes?: number;
  /** Injectable clock, so the midnight-rollover test does not need to wait for midnight. */
  now?: () => Date;
  /** Per-agent override. Returns the level for a specific source, or undefined to use the global level. */
  levelFor?: (source: string) => LogLevelName | undefined;
}

/**
 * Sanitize a source name to a safe filename segment.
 *
 * Collapses path separators only. A `.` is a legal filename character and is LEFT ALONE:
 * collapsing it too made `a.b`, `a/b` and `a\b` share one log file, and `defineAgent({ name:
 * 'my.agent' })` registers cleanly — `VALID_AGENT_NAME` is applied in `loadManifest()`, while
 * `loadAgent()` registers on `def?.name && def?.run` alone, so a dotted source is reachable.
 *
 * Traversal is still impossible: separators are gone, so the result is one filename segment, and
 * the `-YYYY-MM-DD.log` suffix means it can never BE a bare `..`.
 */
function sanitizeSourceName(source: string): string {
  return source.replace(/[\/\\]/g, '_');
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
  private readonly levelFor?: (source: string) => LogLevelName | undefined;
  /**
   * Paths already reported as unwritable. Keyed by path so a broken agent file and a broken
   * combined file each get their own line, and so a new day's file is reported afresh.
   * Bounded in practice by (days x sources) within one process lifetime.
   */
  private readonly reportedFailures = new Set<string>();
  /**
   * Directories already created. Cached to avoid mkdirSync on every append (measured at ~40µs
   * per append). Keyed by absolute path so a changed root invalidates. Bounded by the number
   * of distinct directories written in one process lifetime (typically: root + agents/).
   */
  private readonly ensured = new Set<string>();

  constructor(opts: EventLogOptions) {
    this.root = opts.root;
    this.minLevel = opts.minLevel ?? 'INFO';
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = opts.now ?? (() => new Date());
    this.levelFor = opts.levelFor;
  }

  pathsFor(e: LogEvent): { combined: string; agent?: string } {
    try {
      // Local, so the file a person opens is the one `date +%F` names. See `localDay`.
      const day = localDay(e.at ?? this.now());
      return {
        combined: path.join(this.root, `nexus-${day}.log`),
        agent: e.sourceKind === 'agent'
          ? path.join(this.root, 'agents', `${sanitizeSourceName(e.source)}-${day}.log`)
          : undefined,
      };
    } catch {
      // Guard against invalid dates or other unexpected values
      return { combined: path.join(this.root, 'nexus-unknown.log') };
    }
  }

  /**
   * Update the minimum log level. Takes effect immediately for all subsequent writes.
   * Wired into the settings-updated callback so a change in Preferences or NEXUS_LOG_LEVEL
   * does not require a restart.
   */
  setMinLevel(level: LogLevelName): void {
    (this as any).minLevel = level;
  }

  /**
   * Write a log event. Returns true if the event was written, false if it was dropped
   * (level gate, append failure, exception). Callers that need to know whether a line
   * reached disk (e.g., deduplication) can key on this.
   */
  write(e: LogEvent): boolean {
    try {
      // A per-agent override beats the global level in both directions — you debug one agent, and
      // you silence one agent, without touching the rest.
      let min = this.minLevel;
      try {
        const override = this.levelFor?.(e.source);
        if (override) min = override;
      } catch { /* a settings cache that is not ready must not drop the line */ }

      // Preservation-critical events bypass the level gate. A successful mutation or a failed run
      // must reach the file regardless of verbosity — the retention system keys on these markers
      // (retention.ts:141 MARKERS list), so a WARN or ERROR level must not silently disable
      // preservation. Mutations are rare (volume is negligible), and failed runs are by definition
      // events someone wants a record of.
      //
      // NOTE: The `run.end` half is presently inert — `AgentRunner` already emits non-success at
      // ERROR level, which passes at every level — so the live effect of I6 is entirely the
      // `mutation` case.
      const isPreservationCritical =
        e.event === 'mutation' ||
        (e.event === 'run.end' && e.fields?.status && (e.fields.status === 'error' || e.fields.status === 'timeout'));

      if (!isPreservationCritical && LogLevel[e.level] > LogLevel[min]) return false;

      const at = e.at ?? this.now();
      const line = formatLine({ ...e, at }) + '\n';
      const { combined, agent } = this.pathsFor({ ...e, at });
      const ok1 = this.append(combined, line);
      const ok2 = agent ? this.append(agent, line) : true;
      return ok1 && ok2;
    } catch {
      /* logging must never break a run */
      return false;
    }
  }

  private append(file: string, line: string): boolean {
    try {
      const dir = path.dirname(file);
      // Create directory if not cached OR if cached but externally removed. Trades two
      // write syscalls (mkdirSync + chmodSync) for one or two cheap stat calls (existsSync).
      // The second half runs only when cached (steady state), re-verifying the directory still
      // exists so external removal is detected and recovered rather than staying quiet.
      if (!this.ensured.has(dir) || !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        this.ensured.add(dir);
      }
      const isNew = !fs.existsSync(file);
      rotateIfNeeded(file, this.maxBytes);
      fs.appendFileSync(file, line, { mode: 0o600 });
      // Only on creation: chmod on every line was the other half of the cost, and the mode
      // cannot drift on a file nothing else touches.
      if (isNew) {
        try {
          fs.chmodSync(file, 0o600);
        } catch { /* best-effort mode setting */ }
      }
      return true;
    } catch (err) {
      // On failure, invalidate cache so next append retries directory creation. A logging
      // layer that goes quiet after a directory removal is worse than one that retries.
      const dir = path.dirname(file);
      this.ensured.delete(dir);
      // One unwritable destination must not stop the other — but it must not be invisible
      // either. A silent total failure is indistinguishable from "the agent never ran", which
      // is the exact question this log exists to answer.
      this.reportAppendFailure(file, err);
      return false;
    }
  }

  /**
   * Report the FIRST append failure per path, to the console logger, once.
   *
   * Rate-limited because the alternative is a stack trace per log line — a failing log that
   * floods the very console someone is reading to find out why it is failing. `createLogger`
   * is console-based and has no EventLog dependency, so this cannot recurse. Never throws and
   * returns nothing: `append` must behave identically whether or not this fires.
   */
  private reportAppendFailure(file: string, err: unknown): void {
    try {
      if (this.reportedFailures.has(file)) return;
      this.reportedFailures.add(file);
      const reason = err instanceof Error ? err.message : String(err);
      createLogger('EventLog').error(
        `Cannot append to ${file} — events for this file are being lost (reported once per file): ${reason}`,
      );
    } catch { /* the failure reporter must never become the failure */ }
  }
}
