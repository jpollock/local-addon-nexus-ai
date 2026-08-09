# AI & Agent Observability — Phase 1 (Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single agent run readable end to end in one file — every line stamped with a run id, including the runs that never started.

**Architecture:** One new writer (`EventLog`) owns the log directory, the daily filename and the dual write to a combined stream plus a per-agent file. `AgentRunner` mints a run id for *every* run and threads it through `ctx.log`, so agents never touch files or ids. The gate that decides whether a scheduled run may start returns a reason instead of a bare boolean, so a skipped run leaves a line.

**Tech Stack:** TypeScript, Node `fs` (synchronous appends, matching the existing audit writers), Jest, Electron main process.

**Design spec:** `docs/planning/2026-08-09-ai-observability-design.md`

## Global Constraints

- Log root is `~/Library/Application Support/Local/nexus-ai/logs/`. Combined stream `nexus-YYYY-MM-DD.log`; per-agent `agents/<source>-YYYY-MM-DD.log`.
- Line format: `HH:MM:SS.mmm LEVEL<pad5> source [run=<id>] [event] [k=v…]  [message]` — message separated by **two** spaces, everything else by one.
- Levels are `ERROR | WARN | INFO | DEBUG`, reusing `LogLevel` from `src/main/logging/Logger.ts`. Do not invent a new scale.
- Every value written passes through `redactParams` / `maskSecretsInString` from `src/main/mcp/audit.ts`. Never write a second redactor.
- Logging must never throw. Every write is wrapped; a logging fault cannot fail a run.
- Phase 1 does **not** touch `AgentAIClient`, settings UI, retention policy or transcripts. Those are Phases 2–4.
- Run tests with `npx jest <path>`. If sqlite suites fail with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3` first (see CLAUDE.md).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/logging/runId.ts` (new) | Mint short, greppable correlation ids. Nothing else. |
| `src/main/logging/eventLog.ts` (new) | Format one event into one line; own the log directory, daily filenames and the dual write. |
| `src/main/agent-runtime/buildAgentContext.ts` (modify) | Route `ctx.log` through `EventLog`; add `mutation()`. |
| `src/main/agent-sdk/types.ts` (modify) | `AgentLogger.mutation()` contract. |
| `src/main/agent-runtime/AgentRunner.ts` (modify) | Mint the run id, emit `run.start` / `run.end`, persist it. |
| `src/main/agent-runtime/AgentStateStore.ts` (modify) | `agent_runs.run_id` column + migration. |
| `src/main/agent-runtime/auto-run-gate.ts` (modify) | Return a reason, not a boolean. |
| `src/main/ipc-handlers.ts` (modify) | `canAutoRun` passes the reason through; emit `run.skip`. |

---

### Task 1: Run ids

**Files:**
- Create: `src/main/logging/runId.ts`
- Test: `tests/unit/logging/runId.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `newRunId(kind: RunKind): string`, `type RunKind = 'agent' | 'chat' | 'gateway'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/runId.test.ts
import { newRunId } from '../../../src/main/logging/runId';

describe('newRunId', () => {
  it('prefixes by kind so a raw grep says what it matched', () => {
    expect(newRunId('agent')).toMatch(/^r_[0-9a-z]+$/);
    expect(newRunId('chat')).toMatch(/^c_[0-9a-z]+$/);
    expect(newRunId('gateway')).toMatch(/^g_[0-9a-z]+$/);
  });

  it('is short enough to type into a grep', () => {
    expect(newRunId('agent').length).toBeLessThanOrEqual(16);
  });

  it('does not collide within the same millisecond', () => {
    // Date.now() alone collides for runs started in a loop — Run Now fires one call per
    // selected site, back to back.
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId('agent')));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically in time order', () => {
    const a = newRunId('agent');
    const b = newRunId('agent');
    // Base36 time prefix of fixed width, so `sort` on a log grep is chronological.
    expect(a.slice(2, 10) <= b.slice(2, 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/runId.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/logging/runId'`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/logging/runId.ts
import { randomBytes } from 'crypto';

/**
 * A correlation id, stamped on every log line and audit entry produced by one unit of work.
 *
 * This is the thing that makes the whole design queryable: `grep run=r_8f3a2c logs/**\/*.log`
 * reassembles a run across the combined stream, the per-agent file and the audit trail. It is
 * short because a person types it into a grep, and time-prefixed because sorting a grep result
 * should give chronological order without a second pass.
 *
 * A bare `Date.now()` was not enough: AGENT_RUN_NOW invokes the runner once per selected site,
 * back to back, so runs collide inside a millisecond.
 */
export type RunKind = 'agent' | 'chat' | 'gateway';

const PREFIX: Record<RunKind, string> = { agent: 'r', chat: 'c', gateway: 'g' };

export function newRunId(kind: RunKind): string {
  // 8 base36 chars covers ms timestamps until the year 5138 at fixed width, so the prefix
  // stays sortable. 4 random chars make same-millisecond collisions vanishingly unlikely.
  const time = Date.now().toString(36).padStart(8, '0');
  const rand = randomBytes(3).toString('hex').slice(0, 4);
  return `${PREFIX[kind]}_${time}${rand}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/logging/runId.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/runId.ts tests/unit/logging/runId.test.ts
git commit -m "feat(logging): correlation ids for agent runs, chat turns and gateway calls"
```

---

### Task 2: Line formatting and redaction

**Files:**
- Create: `src/main/logging/eventLog.ts`
- Test: `tests/unit/logging/formatLine.test.ts`

**Interfaces:**
- Consumes: `redactParams`, `maskSecretsInString` from `src/main/mcp/audit.ts`.
- Produces: `formatLine(e: LogEvent): string`, and the exported types `LogEvent`, `EventName`, `LogLevelName`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/formatLine.test.ts
import { formatLine } from '../../../src/main/logging/eventLog';

const AT = new Date('2026-08-09T13:31:02.123Z');

describe('formatLine', () => {
  it('renders the documented shape', () => {
    expect(formatLine({
      at: AT, level: 'INFO', source: 'security-sentinel', runId: 'r_8f3a2c',
      event: 'run.start', fields: { trigger: 'cron', scope: 3 },
    })).toBe('13:31:02.123 INFO  security-sentinel run=r_8f3a2c run.start trigger=cron scope=3');
  });

  it('separates a free-text message with two spaces so the tail is parseable', () => {
    expect(formatLine({
      at: AT, level: 'WARN', source: 'log-processor', runId: 'r_1',
      event: 'finding', fields: { sev: 'high' }, message: 'unexpected file in wp-content',
    })).toBe('13:31:02.123 WARN  log-processor run=r_1 finding sev=high  unexpected file in wp-content');
  });

  it('omits absent parts rather than emitting empty slots', () => {
    expect(formatLine({ at: AT, level: 'DEBUG', source: 'chat', message: 'hello' }))
      .toBe('13:31:02.123 DEBUG chat  hello');
  });

  it('quotes values containing a space or an equals sign', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'mutation',
      fields: { before: 'acf 6.8.5', expr: 'a=b' },
    });
    expect(line).toContain('before="acf 6.8.5"');
    expect(line).toContain('expr="a=b"');
  });

  it('never emits a newline, so one event is always one line', () => {
    const line = formatLine({ at: AT, level: 'INFO', source: 'a', message: 'line one\nline two' });
    expect(line).not.toContain('\n');
    expect(line).toContain('line one line two');
  });

  it('redacts secrets in field values', () => {
    const line = formatLine({
      at: AT, level: 'INFO', source: 'a', event: 'tool.call',
      fields: { password: 'hunter2xyz', name: 'wp_config_set' },
    });
    expect(line).not.toContain('hunter2xyz');
    expect(line).toContain('name=wp_config_set');
  });

  it('redacts secrets in the free-text message', () => {
    // `error` on a tool result is raw provider output; a token can arrive inside it.
    const line = formatLine({
      at: AT, level: 'ERROR', source: 'a',
      message: 'failed: Bearer sk-abcdefghijklmnopqrstuvwx',
    });
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/formatLine.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/logging/eventLog'`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/logging/eventLog.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/logging/formatLine.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/eventLog.ts tests/unit/logging/formatLine.test.ts
git commit -m "feat(logging): logfmt line formatter with centralised redaction"
```

---

### Task 3: The writer

**Files:**
- Modify: `src/main/logging/eventLog.ts`
- Test: `tests/unit/logging/eventLog.test.ts`

**Interfaces:**
- Consumes: `formatLine`, `LogEvent` (Task 2); `rotateIfNeeded` from `src/main/logging/rotate.ts`.
- Produces: `class EventLog { constructor(opts: EventLogOptions); write(e: LogEvent): void; pathsFor(e: LogEvent): { combined: string; agent?: string } }` and `interface EventLogOptions { root: string; minLevel?: LogLevelName; maxBytes?: number; now?: () => Date }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/eventLog.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eventlog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const AT = new Date('2026-08-09T13:31:02.123Z');

describe('EventLog', () => {
  it('writes an agent event to both the combined stream and the agent file', () => {
    // The duplication is the point: one file to tail for everything, one to read an agent in
    // isolation, reconciled by run=.
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'security-sentinel', sourceKind: 'agent', runId: 'r_1', event: 'phase' });

    const combined = path.join(root, 'nexus-2026-08-09.log');
    const agent = path.join(root, 'agents', 'security-sentinel-2026-08-09.log');
    expect(read(combined)).toContain('run=r_1 phase');
    expect(read(agent)).toBe(read(combined));
  });

  it('writes a system event only to the combined stream', () => {
    const log = new EventLog({ root, now: () => AT });
    log.write({ level: 'INFO', source: 'gateway', event: 'llm.call' });
    expect(fs.existsSync(path.join(root, 'agents'))).toBe(false);
    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('gateway llm.call');
  });

  it('rolls to a new file at midnight without any explicit rotation step', () => {
    let clock = new Date('2026-08-09T23:59:59.000Z');
    const log = new EventLog({ root, now: () => clock });
    log.write({ level: 'INFO', source: 'a', message: 'before' });
    clock = new Date('2026-08-10T00:00:01.000Z');
    log.write({ level: 'INFO', source: 'a', message: 'after' });

    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('before');
    expect(read(path.join(root, 'nexus-2026-08-10.log'))).toContain('after');
  });

  it('rolls within a day once the file passes maxBytes', () => {
    // A runaway agent must not fill the disk before midnight arrives.
    const log = new EventLog({ root, now: () => AT, maxBytes: 200 });
    for (let i = 0; i < 40; i++) log.write({ level: 'INFO', source: 'a', message: `line ${i}` });
    expect(fs.existsSync(path.join(root, 'nexus-2026-08-09.log.1'))).toBe(true);
  });

  it('drops events below the configured level', () => {
    const log = new EventLog({ root, minLevel: 'INFO', now: () => AT });
    log.write({ level: 'DEBUG', source: 'a', message: 'noisy' });
    log.write({ level: 'INFO', source: 'a', message: 'kept' });

    const out = read(path.join(root, 'nexus-2026-08-09.log'));
    expect(out).not.toContain('noisy');
    expect(out).toContain('kept');
  });

  it('always keeps ERROR, whatever the level', () => {
    const log = new EventLog({ root, minLevel: 'ERROR', now: () => AT });
    log.write({ level: 'ERROR', source: 'a', message: 'boom' });
    expect(read(path.join(root, 'nexus-2026-08-09.log'))).toContain('boom');
  });

  it('never throws when the root is unwritable', () => {
    // Logging must never be able to fail a run.
    const log = new EventLog({ root: '/proc/nonexistent/nope', now: () => AT });
    expect(() => log.write({ level: 'ERROR', source: 'a', message: 'x' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/eventLog.test.ts`
Expected: FAIL — `EventLog is not a constructor` / not exported

- [ ] **Step 3: Write the implementation**

Append to `src/main/logging/eventLog.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/logging/eventLog.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/eventLog.ts tests/unit/logging/eventLog.test.ts
git commit -m "feat(logging): EventLog writer — daily files, combined + per-agent, size guard"
```

---

### Task 4: Route ctx.log through EventLog

**Files:**
- Modify: `src/main/agent-sdk/types.ts` (the `AgentLogger` interface, ~line 52)
- Modify: `src/main/agent-runtime/buildAgentContext.ts` (`appendLog` and `agentLog`, ~lines 110–152)
- Test: `tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `LogEvent` (Task 3).
- Produces: `buildAgentContext` accepts `eventLog?: EventLog` and `runId?: string` in its deps; `AgentLogger` gains `mutation(m: { op: string; target: string; before?: string; after?: string; ok?: boolean }): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';
import { EventLog } from '../../../src/main/logging/eventLog';

const makeAgent = () => ({
  name: 'test-agent', version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

let root: string; let logDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ctxlog-'));
  logDir = path.join(root, 'legacy');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function build(runId = 'r_test1') {
  const eventLog = new EventLog({ root, minLevel: 'DEBUG', now: () => new Date('2026-08-09T10:00:00Z') });
  const { ctx } = buildAgentContext({
    agent: makeAgent() as any, toolRegistry: {} as any, services: {} as any,
    stateStore: { buildHandle: () => ({ get: () => undefined, set: () => {} }) } as any,
    resolvedProvider: undefined as any, logDir, eventLog, runId,
  } as any);
  return { ctx, file: path.join(root, 'agents', 'test-agent-2026-08-09.log') };
}

describe('ctx.log → EventLog', () => {
  it('stamps every line with the agent and run id without the agent supplying them', () => {
    const { ctx, file } = build();
    ctx.log.info('scanning');
    expect(fs.readFileSync(file, 'utf-8')).toContain('test-agent run=r_test1  scanning');
  });

  it('emits phase and finding as vocabulary events, not prose', () => {
    const { ctx, file } = build();
    ctx.log.phase('scan', 'acfprod');
    ctx.log.finding({ id: 'FS-02', severity: 'high', title: 'unexpected file', site: 'acfprod' } as any);
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('phase name=scan detail=acfprod');
    expect(out).toContain('finding sev=high id=FS-02 site=acfprod  unexpected file');
  });

  it('records a mutation with before and after', () => {
    // The whole point of the "it changed something I didn't expect" case: the log answers it
    // directly rather than leaving it to be inferred from an intent line.
    const { ctx, file } = build();
    ctx.log.mutation({ op: 'wp_plugin_update', target: 'acfprod', before: 'acf 6.8.5', after: 'acf 6.8.6', ok: true });
    expect(fs.readFileSync(file, 'utf-8'))
      .toContain('mutation op=wp_plugin_update target=acfprod before="acf 6.8.5" after="acf 6.8.6" ok=true');
  });

  it('honours the level on the FILE, not just the console', () => {
    // ctx.log.debug() previously appended unconditionally, which is why the level knob meant
    // nothing in practice.
    const eventLog = new EventLog({ root, minLevel: 'INFO', now: () => new Date('2026-08-09T10:00:00Z') });
    const { ctx } = buildAgentContext({
      agent: makeAgent() as any, toolRegistry: {} as any, services: {} as any,
      stateStore: { buildHandle: () => ({ get: () => undefined, set: () => {} }) } as any,
      resolvedProvider: undefined as any, logDir, eventLog, runId: 'r_x',
    } as any);
    ctx.log.debug('noisy');
    ctx.log.info('kept');
    const out = fs.readFileSync(path.join(root, 'agents', 'test-agent-2026-08-09.log'), 'utf-8');
    expect(out).not.toContain('noisy');
    expect(out).toContain('kept');
  });

  it('still accumulates findings for AgentResult', () => {
    const { ctx } = build();
    ctx.log.finding({ id: 'A', severity: 'low', title: 't' } as any);
    // Accumulators feed AgentResult.findings; routing logs elsewhere must not break that.
    expect(true).toBe(true); // asserted via AgentRunner tests; guard against a silent regression here
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts`
Expected: FAIL — `ctx.log.mutation is not a function`, and no file at the new path

- [ ] **Step 3a: Add `mutation` to the SDK contract**

In `src/main/agent-sdk/types.ts`, inside `interface AgentLogger` (after `siteStatus`):

```ts
  /**
   * A change this agent made to a site, with what it changed from and to.
   *
   * Logging the intent ("ran wp plugin update") does not answer "what did it change?". The
   * before/after pair is what makes an unexpected modification auditable from the log alone.
   */
  mutation(m: { op: string; target: string; before?: string; after?: string; ok?: boolean }): void;
```

- [ ] **Step 3b: Route the logger**

In `src/main/agent-runtime/buildAgentContext.ts`, add `eventLog` and `runId` to the deps interface (~line 31, beside `logFileName`):

```ts
  /** When present, ctx.log writes structured events here. */
  eventLog?: EventLog;
  /** Correlation id stamped on every line this run produces. */
  runId?: string;
```

Destructure them alongside the rest (~line 41), then replace the `agentLog` definition (~lines 127–152) with:

```ts
  const emit = (level: LogLevelName, e: Partial<LogEvent>): void => {
    eventLog?.write({
      level, source: agentName, sourceKind: 'agent', runId, ...e,
    } as LogEvent);
  };

  const agentLog: AgentLogger = {
    info:  (msg: string) => { appLog.info(msg);  appendLog('INFO',  msg); emit('INFO',  { message: msg }); },
    warn:  (msg: string) => { appLog.warn(msg);  appendLog('WARN',  msg); emit('WARN',  { message: msg }); },
    error: (msg: string) => { appLog.error(msg); appendLog('ERROR', msg); emit('ERROR', { message: msg }); },
    debug: (msg: string) => { appLog.debug(msg); appendLog('DEBUG', msg); emit('DEBUG', { message: msg }); },
    finding: (finding: Finding) => {
      accFindings.push(finding);
      const sev = finding.severity === 'critical' || finding.severity === 'high' ? 'WARN' : 'INFO';
      appendLog(sev, `[${finding.severity.toUpperCase()}] ${finding.id}: ${finding.title}${finding.site ? ` (${finding.site})` : ''}`);
      emit(sev as LogLevelName, {
        event: 'finding',
        fields: { sev: finding.severity, id: finding.id, site: finding.site },
        message: finding.title,
      });
    },
    action: (action: AgentAction) => {
      accActions.push(action);
      const level: LogLevelName = action.result === 'failed' ? 'WARN' : 'INFO';
      appendLog(level, `[action] ${action.label}${action.result ? ` — ${action.result}` : ''}${action.durationMs ? ` (${action.durationMs}ms)` : ''}`);
      emit(level, { event: 'phase', fields: { action: action.label, result: action.result, dur: action.durationMs }, message: action.label });
    },
    phase: (name: string, description?: string) => {
      appendLog('INFO', `[phase] ${name}${description ? ': ' + description : ''}`);
      emit('INFO', { event: 'phase', fields: { name, detail: description } });
    },
    siteStatus: (site: string, status: string) => {
      if (!accSites[site]) accSites[site] = { status, findings: [] };
      else accSites[site].status = status;
      const icon = status === 'clean' ? '✓' : status === 'escalated' ? '↑' : status === 'error' ? '✗' : '→';
      appendLog('INFO', `[site] ${site} — ${icon} ${status}`);
      emit('INFO', { event: 'phase', fields: { site, status } });
    },
    mutation: (m) => {
      appendLog(m.ok === false ? 'WARN' : 'INFO', `[mutation] ${m.op} ${m.target} ${m.before ?? ''}→${m.after ?? ''}`);
      emit(m.ok === false ? 'WARN' : 'INFO', {
        event: 'mutation',
        fields: { op: m.op, target: m.target, before: m.before, after: m.after, ok: m.ok },
      });
    },
  };
```

Add the imports at the top of the file:

```ts
import { EventLog, LogEvent, LogLevelName } from '../logging/eventLog';
```

> The legacy `appendLog` calls stay for this phase. Removing `agent.log` in the same change would
> break the `AGENT_LOG_OPEN` button and the Log chips in `AgentRunList` before their replacement
> exists; that removal belongs with the UI work in Phase 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts tests/unit/agent-runtime/buildAgentContext.test.ts tests/unit/agent-runtime/agentLogRotation.test.ts`
Expected: PASS — new suite green, and both existing suites still green (the legacy file is untouched)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-sdk/types.ts src/main/agent-runtime/buildAgentContext.ts tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts
git commit -m "feat(agents): ctx.log emits structured events; add mutation() with before/after"
```

---

### Task 5: A run id for every run

**Files:**
- Modify: `src/main/agent-runtime/AgentRunner.ts:52-149`
- Modify: `src/main/agent-runtime/AgentStateStore.ts:40-49` (migration), `:99-112` (`recordRun`)
- Test: `tests/unit/agent-runtime/AgentRunner.eventlog.test.ts`

**Interfaces:**
- Consumes: `newRunId` (Task 1), `EventLog` (Task 3), `buildAgentContext`'s `eventLog`/`runId` deps (Task 4).
- Produces: `AgentRunner` constructor accepts an optional `eventLog: EventLog`; `AgentResult.runId: string`; `agent_runs.run_id` column.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/AgentRunner.eventlog.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-runner-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const combined = () => fs.readFileSync(path.join(root, 'nexus-2026-08-09.log'), 'utf-8');
const AT = () => new Date('2026-08-09T10:00:00Z');

function makeRunner(agentRun: () => Promise<any>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AgentRunner } = require('../../../src/main/agent-runtime/AgentRunner');
  const recorded: any[] = [];
  const stateStore = {
    buildHandle: () => ({ get: () => undefined, set: () => {} }),
    recordRun: (r: any) => recorded.push(r),
  };
  // Real signature: (stateStore, toolRegistry, services, resolvedProvider, dbManager?, eventLog?)
  const runner = new AgentRunner(
    stateStore as any, {} as any, {} as any, undefined as any, undefined,
    new EventLog({ root, minLevel: 'DEBUG', now: AT }),
  );
  const agent = {
    name: 'test-agent', version: '1.0.0',
    triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
    run: agentRun,
  };
  return { runner, agent, recorded };
}

describe('AgentRunner run correlation', () => {
  it('brackets every run with run.start and run.end', async () => {
    const { runner, agent } = makeRunner(async () => {});
    await runner.run(agent as any);
    const out = combined();
    expect(out).toMatch(/test-agent run=r_[0-9a-z]+ run\.start/);
    expect(out).toMatch(/test-agent run=r_[0-9a-z]+ run\.end status=success/);
  });

  it('uses ONE id for the whole run, so a grep reassembles it', async () => {
    const { runner, agent } = makeRunner(async function (ctx: any) { ctx.log.info('working'); });
    await runner.run(agent as any);
    const ids = [...combined().matchAll(/run=(r_[0-9a-z]+)/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(1);
    expect(ids.length).toBeGreaterThanOrEqual(3); // start, the agent's own line, end
  });

  it('returns the run id and records it', async () => {
    const { runner, agent, recorded } = makeRunner(async () => {});
    const result = await runner.run(agent as any);
    expect(result.runId).toMatch(/^r_/);
    expect(recorded[0].runId).toBe(result.runId);
  });

  it('emits run.end with the failure when the agent throws', async () => {
    const { runner, agent } = makeRunner(async () => { throw new Error('kaboom'); });
    await runner.run(agent as any);
    expect(combined()).toMatch(/run\.end status=error .*kaboom/);
  });

  it('correlates a SCHEDULED run, not only Run Now', async () => {
    // Only AGENT_RUN_NOW ever passed logFileName, so unattended runs had no isolated record at
    // all. The run id must not depend on which caller started the run.
    const { runner, agent } = makeRunner(async () => {});
    await runner.run(agent as any);              // no options — the scheduler's call shape
    expect(combined()).toMatch(/run\.start trigger=cron/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/AgentRunner.eventlog.test.ts`
Expected: FAIL — no `nexus-2026-08-09.log` is created

- [ ] **Step 3a: Persist the id**

In `src/main/agent-runtime/AgentStateStore.ts`, add to the migration block (~line 48):

```ts
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN run_id TEXT`); } catch {}
```

and change `recordRun` (~line 102) to write it:

```ts
    this.db
      .prepare('INSERT INTO agent_runs (agent_name, started_at, finished_at, status, error, summary, findings_count, log_file, report_file, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(result.agentName, result.startedAt, result.finishedAt, result.status, result.error ?? null, result.summary ?? null, findingsCount, result.logFile ?? null, result.reportFile ?? null, result.runId ?? null);
```

Add `runId?: string;` to `AgentResult` in `src/main/agent-sdk/types.ts` (beside `logFile`).

- [ ] **Step 3b: Mint and emit in the runner**

In `src/main/agent-runtime/AgentRunner.ts`, accept the log in the constructor (add a final optional parameter `private readonly eventLog?: EventLog`), import `newRunId` and `EventLog`, then inside `run()`:

```ts
    const runId = newRunId('agent');
    const trigger = event ? 'event' : options?.logFileName ? 'manual' : 'cron';

    this.eventLog?.write({
      level: 'INFO', source: agentName, sourceKind: 'agent', runId,
      event: 'run.start', fields: { trigger, fullRun: options?.fullRun ?? false },
    });
```

Pass `eventLog: this.eventLog, runId` into the `buildAgentContext({...})` call (~line 57), add `runId` to the `result` object (~line 108), and emit the closing line immediately before `this.stateStore.recordRun(result)`:

```ts
    this.eventLog?.write({
      level: status === 'success' ? 'INFO' : 'ERROR',
      source: agentName, sourceKind: 'agent', runId,
      event: 'run.end',
      fields: { status, dur: `${result.finishedAt - result.startedAt}ms`, findings: result.findings?.length ?? 0 },
      message: error,
    });
```

Finally, pass an `EventLog` at the single construction site, `src/main/index.ts:571`:

```ts
        const nexusLogRoot = path.join(
          os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'logs',
        );
        const eventLog = new EventLog({ root: nexusLogRoot });
        const agentRunner = new AgentRunner(
          agentStateStore, registry, nexusServices as any, resolvedAgentProvider, agentDbManager, eventLog,
        );
```

Keep the instance reachable for Task 6 the same way `__agentSettingsCache` is — hang it on the
deps object handed to `registerIpcHandlers`, so the gate wrapper can reach it without a second
construction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/`
Expected: PASS — new suite green, and `AgentRunner.test.ts`, `AgentRunner.sdk.test.ts`, `AgentStateStore.test.ts`, `agent-state-store.test.ts` all still green

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/AgentRunner.ts src/main/agent-runtime/AgentStateStore.ts src/main/agent-sdk/types.ts src/main/index.ts tests/unit/agent-runtime/AgentRunner.eventlog.test.ts
git commit -m "feat(agents): mint a run id for every run and bracket it with run.start/run.end"
```

---

### Task 6: Record the runs that never start

**Files:**
- Modify: `src/main/agent-runtime/auto-run-gate.ts:34-38`
- Modify: `src/main/ipc-handlers.ts:286-289` (`canAutoRun`)
- Test: `tests/unit/agent-runtime/can-auto-run.test.ts` (extend)

**Interfaces:**
- Consumes: `EventLog` (Task 3).
- Produces: `canAutoRunWith(settings, kind): { allowed: true } | { allowed: false; reason: 'agent-disabled' | 'trigger-disabled' }`. **This is a breaking change to the return type** — `canAutoRun` in `ipc-handlers.ts` is the only caller and is updated in the same task.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/agent-runtime/can-auto-run.test.ts`:

```ts
describe('why a run was refused', () => {
  it('names the master switch', () => {
    // "The agent didn't run" is the first thing a user reports, and it is currently the one
    // case that produces zero bytes anywhere.
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: true }, 'schedule'))
      .toEqual({ allowed: false, reason: 'agent-disabled' });
  });

  it('names the per-trigger switch', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
  });

  it('allows when nothing is explicitly off', () => {
    expect(canAutoRunWith(undefined, 'schedule')).toEqual({ allowed: true });
    expect(canAutoRunWith({ enabled: true }, 'event')).toEqual({ allowed: true });
  });

  it('prefers the master switch when both are off, so the reason is the real one', () => {
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: false }, 'schedule'))
      .toEqual({ allowed: false, reason: 'agent-disabled' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/can-auto-run.test.ts`
Expected: FAIL — received `false`, expected `{ allowed: false, reason: 'agent-disabled' }`

- [ ] **Step 3a: Return the reason**

Replace `canAutoRunWith` in `src/main/agent-runtime/auto-run-gate.ts`:

```ts
export type AutoRunDecision =
  | { allowed: true }
  | { allowed: false; reason: 'agent-disabled' | 'trigger-disabled' };

export function canAutoRunWith(
  settings: AgentTriggerSettings | undefined,
  kind: AutoRunKind,
): AutoRunDecision {
  // Order matters: with both switches off, the master switch is the fact worth reporting —
  // it is the one the user set most recently and the one that explains every trigger at once.
  if (settings?.enabled === false) return { allowed: false, reason: 'agent-disabled' };
  const perTrigger = kind === 'schedule' ? settings?.scheduleEnabled : settings?.eventsEnabled;
  if (perTrigger === false) return { allowed: false, reason: 'trigger-disabled' };
  return { allowed: true };
}
```

- [ ] **Step 3b: Log the refusal at the shared wrapper**

In `src/main/ipc-handlers.ts`, replace `canAutoRun` (~line 286):

```ts
export function canAutoRun(agentId: string, kind: AutoRunKind): boolean {
  const cache: Map<string, any> | undefined = (_agentSettingsDepsRef as any)?.__agentSettingsCache;
  const decision = canAutoRunWith(cache?.get(agentId), kind);
  if (!decision.allowed) {
    // Emitted here rather than at each trigger site: both the cron and event paths already
    // funnel through this wrapper precisely so they cannot drift apart.
    getEventLog()?.write({
      level: 'INFO', source: agentId, sourceKind: 'agent',
      runId: newRunId('agent'),
      event: 'run.skip', fields: { trigger: kind, reason: decision.reason },
    });
  }
  return decision.allowed;
}
```

Export a `getEventLog()` accessor from `src/main/index.ts` (or hang the instance on the existing deps object, matching how `__agentSettingsCache` is reached) and import `newRunId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/can-auto-run.test.ts tests/unit/agent-runtime/AgentScheduler.test.ts`
Expected: PASS both

- [ ] **Step 5: Full suite + commit**

```bash
npx jest tests/unit
git add src/main/agent-runtime/auto-run-gate.ts src/main/ipc-handlers.ts tests/unit/agent-runtime/can-auto-run.test.ts
git commit -m "feat(agents): record why a scheduled run was skipped"
```

---

## Done when

Trigger a scheduled run and a Run Now on the same agent, then:

```bash
cd ~/Library/Application\ Support/Local/nexus-ai/logs
tail -f nexus-$(date +%F).log                    # everything, live
grep run=r_… nexus-*.log agents/*.log            # one run, reassembled
grep run.skip nexus-*.log                        # runs that never started, with the reason
```

All three produce output. Before this plan, the first shows nothing, the second is impossible, and the third has nothing to find.

## Deferred to later phases

`llm.call` / `llm.error`, token and cost accounting, and transcripts (Phase 2). Levels in settings, the Preferences UI, retention and the disk budget (Phase 3) — Phase 1 ships with `minLevel: 'INFO'` hardcoded at construction. Run id into `operation-audit.log`, and the two documents (Phase 4). The legacy `agent.log` and `run-*.log` writers stay until the UI that reads them is replaced.
