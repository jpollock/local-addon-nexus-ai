# Audit Trail + Log Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Tier 2/3 operation durably auditable on disk, and stop every log file in the addon from growing without bound.

**Architecture:** Add one shared size-based rotation primitive, then wire the already-built-but-never-connected `OperationAuditLog` into `NexusServices` and write to it from the two central tool-dispatch chokepoints (`McpSafetyWrapper` for MCP tools, `AgentDispatcher` for agent-contributed tools). Redaction moves *into* `OperationAuditLog` so it cannot be forgotten at a call site. Finally, apply the rotation primitive to the three existing unbounded writers.

**Tech Stack:** TypeScript, Node `fs` (synchronous appends — deliberate, see Design Decision 4), Jest, Electron main process.

---

## Global Constraints

- **No new dependencies.** Rotation and pruning use Node's `fs` only. No `winston`, no `pino`, no `rotating-file-stream`.
- **All audit writes are synchronous** (`appendFileSync`). An audit entry that is lost because the process died before an async flush is worse than a few hundred microseconds of blocking. This matches the existing `OperationAuditLog.log()` contract.
- **Audit file permissions stay `0o600`, directories `0o700`.** Already implemented in `OperationAuditLog`; must not regress.
- **Never throw from a logging or audit path.** A failed audit write must not break the operation being audited. Every fs call in these paths is wrapped.
- **better-sqlite3 is currently ABI-mismatched in this working copy** (`NODE_MODULE_VERSION 146` vs `141`). 6 pre-existing test suites fail for this reason on `main`, unrelated to this work. **No task in this plan may introduce a test that touches SQLite** — all new tests use the real filesystem in a temp dir.
- **Do not run `npm install` or `npm run rebuild`** as part of this plan; it would change which set of tests pass and muddy verification. This includes `./dev-reload.sh`, which runs `npm run rebuild` at line 12. **Task 4 is the sole exception** — it is a human-run verification step performed *after* all code tasks are complete and tested, so the rebuild cannot affect any test run in this plan.

---

## Background: What Is Actually Broken

This section is the **why**. Every claim below was verified by direct code reading during planning, with file:line references so a reviewer can re-check independently.

### Finding 1 — The audit trail has never recorded a single entry

There is no `.log` file of any kind in `~/Library/Application Support/Local/nexus-ai/`:

```
$ ls ~/Library/Application\ Support/Local/nexus-ai/*.log
zsh: no matches found
```

Two separate audit mechanisms are supposed to write there. Both are broken, in different ways:

**1a. `OperationAuditLog` — the service handle is never assigned.**

`src/main/audit/OperationAuditLog.ts` is a complete, unit-tested, append-only JSONL logger with correct `0o600`/`0o700` permissions. It is declared as an optional service in two type files:

- `src/main/types/nexus-services.ts:159` — `operationAuditLog?: OperationAuditLog;`
- `src/main/mcp/types.ts:138` — `operationAuditLog?: import('../audit/OperationAuditLog').OperationAuditLog;`

Exactly one tool calls it — `wpe_create_backup` — three times, for pending/success/failure:

- `src/main/mcp/modules/wpe/create-backup.ts:27` — `services.operationAuditLog?.log({ operation: 'wpe.backup.create', ... outcome: 'pending' })`
- `src/main/mcp/modules/wpe/create-backup.ts:40` — `outcome: 'success'`
- `src/main/mcp/modules/wpe/create-backup.ts:50` — `outcome: 'failure'`

**`services.operationAuditLog` is never assigned anywhere in `src/`.** Grepping for an assignment (as opposed to a type declaration) returns nothing. So the optional chain `?.` silently short-circuits to `undefined` and all three calls are **dead no-ops**.

This is the same failure class as the security-sentinel incident fixed earlier today: instrumentation that *looks* present, type-checks cleanly, reads correctly in review — and does nothing at runtime. The `?.` is what makes it silent.

Meanwhile the **read** path works and is fully wired — it just constructs its own instance pointed at a file nothing writes:

- `src/main/ipc-handlers.ts:4492-4493` and `:4503-4504` (IPC `OPERATION_AUDIT_LIST` / `OPERATION_AUDIT_EXPORT`)
- `src/main/graphql/resolvers.ts:5019-5020` and `:5039-5040` (GraphQL `nexusOperationAuditList` / `nexusOperationAuditExport`)

**1b. `mcp/audit.ts` — buffered in memory, never flushed.**

`createAuditLogger(logPath)` (`src/main/mcp/audit.ts:59`) pushes entries to a plain in-memory array. Its `flush()` method appends them to disk as JSONL — and `flush()` is called **nowhere in production**, only in `tests/main/audit.test.ts`. The `before-quit` handler at `src/main/index.ts:232-236` stops the scheduler, stops daemons, and closes the graph DB; it does not flush the audit logger.

The logger is instantiated with a real path at `src/main/index.ts:282`. Every MCP tool call does reach it, via `McpSafetyWrapper.auditLog()` (`src/main/mcp/mcp-safety-wrapper.ts:102-124`) — for all three tiers, not just Tier 3. So the data is being collected correctly and then discarded on every process exit.

**1c. Instrumentation is per-tool and does not scale.**

Even if 1a were fixed, only 1 tool out of roughly 200 has `OperationAuditLog` calls. Hand-instrumenting each tool guarantees drift — the next tool added is the next gap.

### Finding 2 — Nothing rotates, and fixing Finding 1 makes that worse

Verified unbounded writers:

| Writer | Location | Cap |
|---|---|---|
| Per-agent log (`agent.log`, `run-*.log`) | `src/main/agent-runtime/buildAgentContext.ts:97` | **none** |
| Main process log (opt-in via env) | `src/main/logging/Logger.ts:122` | **none** |
| `OperationAuditLog` | `src/main/audit/OperationAuditLog.ts:54` | **none** |

Both are bare `fs.appendFileSync` with no size check, no truncation, no age-based cleanup. `security-sentinel/agent.log` was observed at **9.1 MB** — that is the architecture working as written, not an anomaly. `run-<ts>.log` and `<run>-report.md` pairs accumulate one per run forever; no pruning code exists anywhere in `src/main/agent-runtime/`.

**The ordering risk:** closing Gap 1 turns `operation-audit.log` into a *new* high-volume unbounded writer — Tier 2 is the **default** tier for any tool not explicitly listed (`src/main/mcp/safety.ts:223`: `TIER_OVERRIDES[toolName] ?? 2`), so most tool calls will be audit-worthy. Shipping the audit fix before the rotation primitive would introduce a fresh disk-growth leak.

**This is why the plan builds the rotation primitive first (Phase 1) even though the audit gap was requested first.** The audit trail is fully working by end of Phase 2; Phase 3 then retrofits the pre-existing writers. No phase ever leaves an uncapped file behind.

### Finding 3 — Minor: the docstring path is wrong

`src/main/audit/OperationAuditLog.ts:11` documents the file location as `.../nexus-ai/audit.log`, but `defaultAuditLogPath()` (`:143-152`) returns `.../nexus-ai/operation-audit.log`. `audit.log` is a *different* file belonging to `mcp/audit.ts`. Fixed in Task 4.

---

## Design Decisions

**1. Write at the dispatch chokepoints, not per-tool.**
`McpSafetyWrapper.auditLog()` already receives `toolName`, `tier`, `params`, `confirmed`, `result`, `error`, `duration_ms` for every MCP tool call. `AgentDispatcher.dispatch()` has the equivalent for agent-contributed tools. Instrumenting these two functions covers every tool at once and cannot drift as tools are added. Rejected: hand-instrumenting tools (guarantees the next gap).

**2. Instrument `AgentDispatcher` too, not just `McpSafetyWrapper`.**
Agent-contributed tools (e.g. `security-sentinel__scan`) route through `AgentDispatcher.dispatch()` and **bypass `McpSafetyWrapper` entirely**. This is precisely the path the Sentinel incident used. Auditing only the MCP wrapper would leave the agent path — the one with a demonstrated incident — unaudited.

**3. Redaction lives inside `OperationAuditLog.log()`, not at call sites.**
Today `OperationAuditLog.log()` does no redaction; it was only ever fed hand-picked safe values. Once it receives arbitrary tool `params` it will see tokens, passwords and certificates. `redactParams()` already exists and is well-tested (`src/main/mcp/audit.ts:45`). Putting the call inside `log()` makes redaction unforgettable rather than a call-site convention. Rejected: redacting at each call site (one forgotten site leaks credentials to disk).

**4. Synchronous appends, deliberately.**
Async batching risks losing the audit record of the very operation that crashed the process. The blocking cost of `appendFileSync` on a line of JSON is negligible relative to a WP-CLI or CAPI call. This preserves the existing contract documented at `OperationAuditLog.ts:43`.

**5. Fail-open on audit errors.**
A full disk must not break `wpe_create_backup`. Every fs operation in the audit and rotation paths is wrapped; failures are swallowed (with one `console.warn` at most). Rationale: this addon manages other people's production WordPress sites; a logging fault must never become an operational fault.

**6. Size-based rotation with generation shifting, not truncation.**
`file.log` → `file.log.1` → `file.log.2` … dropping the oldest. Truncating in place loses history at exactly the moment you most want it (right after a burst). Rejected: date-stamped files (unbounded file *count* instead of unbounded file *size* — same problem, harder to reason about).

**7. Keep `mcp/audit.ts`'s in-memory logger; just flush it.**
It is the source of `getEntries()` for any future live introspection and is already wired everywhere. Adding a `before-quit` + periodic flush is a two-line fix. Rejected: deleting it (churn with no benefit, and it feeds a distinct use case from the durable JSONL trail).

---

## File Structure

**Created:**
- `src/main/logging/rotate.ts` — the shared rotation + pruning primitive. Pure `fs`, no deps, no state. One responsibility: keep a file or a directory of files bounded.
- `tests/unit/logging/rotate.test.ts` — tests for the above, against a real temp dir.
- `tests/unit/audit/operationAuditLog.wiring.test.ts` — proves the service handle is assigned and redaction is applied.

**Modified:**
- `src/main/audit/OperationAuditLog.ts` — add redaction + rotation inside `log()`; fix docstring path.
- `src/main/index.ts` — construct `OperationAuditLog`, assign to `nexusServices`, add `before-quit` + periodic flush for the in-memory audit logger.
- `src/main/mcp/mcp-safety-wrapper.ts:102-124` — dual-write Tier ≥ 2 to `operationAuditLog`.
- `src/main/agent-runtime/AgentDispatcher.ts` — dual-write Tier ≥ 2 to `operationAuditLog`.
- `src/main/agent-runtime/buildAgentContext.ts:97` — rotate before append; prune old run files.
- `src/main/logging/Logger.ts:122` — rotate before append.

---

# Phase 1 — Rotation Primitive

Built first because Phase 2 creates a new high-volume log file that must not leak. See "The ordering risk" above.

### Task 1: Shared rotation and pruning utility

**Files:**
- Create: `src/main/logging/rotate.ts`
- Test: `tests/unit/logging/rotate.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `rotateIfNeeded(filePath: string, maxBytes: number, keep: number): void`
  - `pruneOldFiles(dir: string, pattern: RegExp, keep: number): number` (returns count deleted)
  - `DEFAULT_MAX_BYTES: number` (5 MiB), `DEFAULT_KEEP: number` (3)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/logging/rotate.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rotateIfNeeded, pruneOldFiles } from '../../../src/main/logging/rotate';

describe('rotateIfNeeded', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rotate-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('does nothing when the file does not exist', () => {
    const f = path.join(dir, 'missing.log');
    expect(() => rotateIfNeeded(f, 100, 3)).not.toThrow();
    expect(fs.existsSync(f)).toBe(false);
  });

  it('does nothing when the file is under the size limit', () => {
    const f = path.join(dir, 'small.log');
    fs.writeFileSync(f, 'x'.repeat(50));
    rotateIfNeeded(f, 100, 3);
    expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(`${f}.1`)).toBe(false);
  });

  it('rotates the file to .1 once it reaches the limit', () => {
    const f = path.join(dir, 'big.log');
    fs.writeFileSync(f, 'x'.repeat(100));
    rotateIfNeeded(f, 100, 3);
    expect(fs.existsSync(f)).toBe(false);          // caller re-creates on next append
    expect(fs.readFileSync(`${f}.1`, 'utf-8')).toBe('x'.repeat(100));
  });

  it('shifts generations and drops the oldest beyond keep', () => {
    const f = path.join(dir, 'gen.log');
    fs.writeFileSync(`${f}.3`, 'oldest');
    fs.writeFileSync(`${f}.2`, 'older');
    fs.writeFileSync(`${f}.1`, 'old');
    fs.writeFileSync(f, 'x'.repeat(100));

    rotateIfNeeded(f, 100, 3);

    expect(fs.readFileSync(`${f}.1`, 'utf-8')).toBe('x'.repeat(100));
    expect(fs.readFileSync(`${f}.2`, 'utf-8')).toBe('old');
    expect(fs.readFileSync(`${f}.3`, 'utf-8')).toBe('older');
    expect(fs.existsSync(`${f}.4`)).toBe(false);   // 'oldest' dropped
  });

  it('never throws on an unwritable path', () => {
    expect(() => rotateIfNeeded('/proc/definitely/not/writable.log', 1, 3)).not.toThrow();
  });
});

describe('pruneOldFiles', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prune-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps the newest N matching files and deletes the rest', () => {
    for (let i = 1; i <= 5; i++) {
      const f = path.join(dir, `run-${i}.log`);
      fs.writeFileSync(f, 'data');
      fs.utimesSync(f, new Date(i * 100000), new Date(i * 100000)); // 5 is newest
    }
    const deleted = pruneOldFiles(dir, /^run-.*\.log$/, 2);
    expect(deleted).toBe(3);
    expect(fs.existsSync(path.join(dir, 'run-5.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-4.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
  });

  it('ignores files that do not match the pattern', () => {
    fs.writeFileSync(path.join(dir, 'run-1.log'), 'x');
    fs.writeFileSync(path.join(dir, 'agent.log'), 'keep me');
    pruneOldFiles(dir, /^run-.*\.log$/, 0);
    expect(fs.existsSync(path.join(dir, 'agent.log'))).toBe(true);
  });

  it('returns 0 and does not throw for a missing directory', () => {
    expect(pruneOldFiles(path.join(dir, 'nope'), /.*/, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/logging/rotate.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../../../src/main/logging/rotate'`

- [ ] **Step 3: Write the implementation**

Create `src/main/logging/rotate.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/logging/rotate.test.ts --no-coverage`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/rotate.ts tests/unit/logging/rotate.test.ts
git commit -m "feat(logging): add shared rotateIfNeeded + pruneOldFiles primitives"
```

---

# Phase 2 — Close the Audit Gap

### Task 2: Make `OperationAuditLog` redact and rotate

Redaction moves inside `log()` (Design Decision 3) because Task 3 starts feeding it arbitrary tool parameters. Rotation lands here so the file is bounded from its very first write (Design Decision 6).

**Files:**
- Modify: `src/main/audit/OperationAuditLog.ts` (docstring `:11`, imports, `log()` at `:45-60`)
- Test: `tests/unit/audit/OperationAuditLog.test.ts` (extend existing)

**Interfaces:**
- Consumes: `rotateIfNeeded` from Task 1; `redactParams` from `src/main/mcp/audit.ts:45`.
- Produces: `OperationAuditLog.log()` unchanged in signature — `log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry` — but now redacts `parameters` and rotates before appending.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/audit/OperationAuditLog.test.ts`:

```typescript
describe('OperationAuditLog — redaction and rotation', () => {
  let dir: string;
  let logPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    logPath = path.join(dir, 'operation-audit.log');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('redacts sensitive parameter values before they reach disk', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'wpe.install.update',
      target: 'my-install',
      parameters: { api_token: 'super-secret-value', password: 'hunter2', install: 'my-install' },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('hunter2');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('my-install'); // non-sensitive values survive
  });

  it('redacts nested sensitive values', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'test.op',
      target: 't',
      parameters: { creds: { private_key: 'PEM-DATA-HERE' } },
      outcome: 'success',
    });
    expect(fs.readFileSync(logPath, 'utf-8')).not.toContain('PEM-DATA-HERE');
  });

  it('rotates the audit log once it exceeds the size cap', () => {
    const log = new OperationAuditLog(logPath, { maxBytes: 512, keep: 2 });
    // Each entry is well over 50 bytes; 40 entries comfortably exceeds 512.
    for (let i = 0; i < 40; i++) {
      log.log({ operation: 'test.op', target: `target-${i}`, parameters: {}, outcome: 'success' });
    }
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.statSync(logPath).size).toBeLessThan(512);
  });

  it('still returns the full entry to the caller', () => {
    const log = new OperationAuditLog(logPath);
    const entry = log.log({ operation: 'o', target: 't', parameters: {}, outcome: 'pending' });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.outcome).toBe('pending');
  });

  it('does not throw when the log path is unwritable', () => {
    const log = new OperationAuditLog('/proc/nope/audit.log');
    expect(() => log.log({ operation: 'o', target: 't', parameters: {}, outcome: 'success' })).not.toThrow();
  });
});
```

Ensure the file's existing imports include `fs`, `os`, `path`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/audit/OperationAuditLog.test.ts --no-coverage`
Expected: FAIL — secrets present in file; no `.1` created; constructor rejects a second argument.

- [ ] **Step 3: Implement**

In `src/main/audit/OperationAuditLog.ts`:

Fix the docstring at line 11:
```typescript
 * File location: ~/Library/Application Support/Local/nexus-ai/operation-audit.log
```

Add imports below the existing ones:
```typescript
import { redactParams } from '../mcp/audit';
import { rotateIfNeeded, DEFAULT_MAX_BYTES, DEFAULT_KEEP } from '../logging/rotate';
```

Replace the constructor and `log()` (lines 38-60):

```typescript
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
   * call-site convention would eventually leak a token to disk.
   *
   * Never throws — a failed audit write must not break the audited operation.
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: this.currentUser(),
      ...entry,
      parameters: redactParams(entry.parameters ?? {}),
    };

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
```

Note the `parameters:` key is placed **after** the `...entry` spread so redaction always wins.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/audit/OperationAuditLog.test.ts --no-coverage`
Expected: PASS — all pre-existing tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/audit/OperationAuditLog.ts tests/unit/audit/OperationAuditLog.test.ts
git commit -m "feat(audit): redact parameters and rotate inside OperationAuditLog

Redaction moves into log() so it cannot be forgotten once the dispatch
chokepoints start feeding it arbitrary tool arguments. Rotation lands here
so the file is bounded from its first write. Also corrects the docstring
path (operation-audit.log, not audit.log)."
```

---

### Task 3: Wire the service handle and audit both dispatch chokepoints

This is the task that actually closes the gap: it assigns `services.operationAuditLog` (revives the three dead no-ops in `create-backup.ts` for free) and adds central writes covering every tool on both dispatch paths.

**Files:**
- Modify: `src/main/index.ts` (near `createAuditLogger` at `:282`; `nexusServices` assembly; `before-quit` at `:232-236`)
- Modify: `src/main/mcp/mcp-safety-wrapper.ts:102-124`
- Modify: `src/main/agent-runtime/AgentDispatcher.ts` (the `dispatch()` audit block around `:77-84`)
- Test: `tests/unit/audit/operationAuditLog.wiring.test.ts` (create)

**Interfaces:**
- Consumes: `OperationAuditLog`, `defaultAuditLogPath` from Task 2.
- Produces: `services.operationAuditLog` is a live `OperationAuditLog` instance for all downstream consumers.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/audit/operationAuditLog.wiring.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';
import { McpSafetyWrapper } from '../../../src/main/mcp/mcp-safety-wrapper';

function makeDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wiring-')); }

describe('audit wiring at the MCP dispatch chokepoint', () => {
  let dir: string, logPath: string;
  beforeEach(() => { dir = makeDir(); logPath = path.join(dir, 'operation-audit.log'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function servicesWithAudit() {
    return { operationAuditLog: new OperationAuditLog(logPath) } as any;
  }

  const registry = {
    call: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false }),
  } as any;

  beforeEach(() => registry.call.mockClear());

  it('writes a durable entry for a Tier 2 tool call', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, servicesWithAudit());

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('wp_core_update');
    expect(entry.outcome).toBe('success');
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
  });

  it('does NOT write a durable entry for a Tier 1 read-only tool', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    await wrapper.callWithSafety('wp_plugin_list', { site: 'demo' }, servicesWithAudit());
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('records failures with outcome=failure', async () => {
    const failing = {
      call: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    } as any;
    const wrapper = new McpSafetyWrapper(failing);
    await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, servicesWithAudit());

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(entry.outcome).toBe('failure');
    expect(entry.error).toContain('boom');
  });

  it('does not break the tool call when auditing is unavailable', async () => {
    const wrapper = new McpSafetyWrapper(registry);
    const result = await wrapper.callWithSafety('wp_core_update', { site: 'demo' }, {} as any);
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/audit/operationAuditLog.wiring.test.ts --no-coverage`
Expected: FAIL — no `operation-audit.log` is created; `McpSafetyWrapper` never touches `operationAuditLog`.

- [ ] **Step 3: Implement — `McpSafetyWrapper.auditLog()`**

In `src/main/mcp/mcp-safety-wrapper.ts`, replace the body of `auditLog()` (lines 102-124) with:

```typescript
  private auditLog(
    services: NexusServices,
    toolName: string,
    tier: number,
    params: Record<string, unknown>,
    confirmed: boolean | null,
    result: 'success' | 'error' | 'confirmation_required',
    error: string | undefined,
    duration_ms: number,
  ): void {
    // In-memory trail (live introspection via getEntries()).
    services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName,
      tier: tier as 1 | 2 | 3,
      params,
      confirmed,
      result,
      error,
      duration_ms,
    });

    // Durable trail — Tier 2 (modifying) and Tier 3 (destructive) only. Tier 1
    // is read-only and would swamp the file with no compliance value.
    // OperationAuditLog redacts params and never throws.
    if (tier >= 2) {
      services.operationAuditLog?.log({
        operation: toolName,
        target: String(params.site ?? params.install_id ?? params.install_name ?? 'unknown'),
        parameters: { ...params, _tier: tier, _durationMs: duration_ms, _confirmed: confirmed },
        outcome: result === 'success' ? 'success' : result === 'error' ? 'failure' : 'pending',
        error,
      });
    }
  }
```

- [ ] **Step 4: Implement — `AgentDispatcher.dispatch()`**

In `src/main/agent-runtime/AgentDispatcher.ts`, immediately after the existing `this.services.auditLogger?.log({...})` block in `dispatch()`, add:

```typescript
    // Durable trail for agent-contributed tools. This path bypasses
    // McpSafetyWrapper entirely — it is the path the security-sentinel incident
    // used — so it needs its own write or agent tool calls stay unaudited.
    if (registered.permissionTier >= 2) {
      this.services.operationAuditLog?.log({
        operation: `${agentName}/${toolName}`,
        target: args && typeof args === 'object'
          ? String((args as Record<string, unknown>).site ?? 'unknown')
          : 'unknown',
        parameters: {
          ...(args && typeof args === 'object' ? (args as Record<string, unknown>) : {}),
          _tier: registered.permissionTier,
          _durationMs: Date.now() - start,
        },
        outcome: outcome === 'ok' ? 'success' : 'failure',
      });
    }
```

- [ ] **Step 5: Implement — construct and assign the service in `index.ts`**

In `src/main/index.ts`, next to the existing `createAuditLogger` call at line 282:

```typescript
  const { OperationAuditLog, defaultAuditLogPath } = require('./audit/OperationAuditLog');
  const operationAuditLog = new OperationAuditLog(defaultAuditLogPath());
```

Add `operationAuditLog` to the `nexusServices` object literal alongside `auditLogger`:

```typescript
    auditLogger,
    operationAuditLog,
```

Then extend the `before-quit` handler (lines 232-236) so the in-memory buffer is no longer discarded on exit (Finding 1b):

```typescript
  app.on('before-quit', () => {
    agentScheduler?.stop();
    daemonManager?.stopAll().catch(() => {});
    graphService.close().catch(() => {});
    auditLogger?.flush().catch(() => {});   // was never called — entries were lost on every exit
  });

  // Periodic flush so a hard kill (SIGKILL, crash) loses at most 5 minutes.
  setInterval(() => { auditLogger?.flush().catch(() => {}); }, 5 * 60 * 1000);
```

Note: `auditLogger` must be declared before the `before-quit` handler for this to reference it; if `createAuditLogger` at line 282 sits *after* the handler at 232, move the `createAuditLogger` + `OperationAuditLog` construction above the handler. Verify ordering when editing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/unit/audit/ tests/unit/agent-runtime/agentDispatcher.test.ts --no-coverage`
Expected: PASS — the 4 new wiring tests, existing `OperationAuditLog` tests, and the 5 existing `AgentDispatcher` tests all green.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "index.ts|mcp-safety-wrapper|AgentDispatcher|OperationAuditLog"`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/main/mcp/mcp-safety-wrapper.ts \
        src/main/agent-runtime/AgentDispatcher.ts \
        tests/unit/audit/operationAuditLog.wiring.test.ts
git commit -m "fix(audit): wire operationAuditLog service and audit both dispatch paths

services.operationAuditLog was declared optional in two type files but never
assigned, so the three existing ?.log() calls in create-backup.ts silently
no-opped and no audit file was ever created. Assign it at construction and
write Tier 2/3 entries centrally from McpSafetyWrapper and AgentDispatcher,
covering every tool rather than the one that was hand-instrumented.

Also flushes the in-memory mcp/audit.ts buffer on before-quit and every 5
minutes; flush() had never been called in production."
```

---

### Task 4: Verify the audit trail end-to-end in the real app

> **HUMAN-RUN TASK — do not dispatch a subagent for this.**
> Run this **last**, after Tasks 1-3 and 5-7 are complete and their tests pass.
> Step 1 runs `./dev-reload.sh`, which invokes `npm run rebuild` (line 12) and
> rebuilds better-sqlite3 for Electron's ABI — that is why it must come after all
> test-bearing tasks, per Global Constraints.

A unit test proves the code path. This task proves the *file* appears on the *real* machine — the failure in Finding 1a was invisible to unit tests precisely because the wiring, not the logic, was broken.

**Files:** none modified — verification only.

- [ ] **Step 1: Build and restart Local**

```bash
./dev-reload.sh
```

- [ ] **Step 2: Confirm the audit file does not exist yet**

```bash
ls -la ~/Library/Application\ Support/Local/nexus-ai/operation-audit.log 2>&1
```
Expected: `No such file or directory`

- [ ] **Step 3: Trigger one Tier 2 operation**

Any modifying tool through the UI or chat — e.g. a plugin list refresh is Tier 1 and will *not* appear (that is the point); use something modifying such as `nexus_site_refresh`.

- [ ] **Step 4: Confirm the entry landed with correct permissions**

```bash
ls -la ~/Library/Application\ Support/Local/nexus-ai/operation-audit.log
tail -1 ~/Library/Application\ Support/Local/nexus-ai/operation-audit.log | python3 -m json.tool
```
Expected: file exists with mode `-rw-------` (0600); the last line parses as JSON with `id`, `timestamp`, `operation`, `target`, `outcome`, `userId`.

- [ ] **Step 5: Confirm no secrets are present**

```bash
grep -icE "password|api_token|private_key|secret" ~/Library/Application\ Support/Local/nexus-ai/operation-audit.log
grep -c "REDACTED" ~/Library/Application\ Support/Local/nexus-ai/operation-audit.log
```
Expected: sensitive **values** absent; `[REDACTED]` present where such keys were passed. Key *names* may legitimately appear — inspect any hit to confirm the value beside it is `[REDACTED]`.

- [ ] **Step 6: Confirm the read path now returns data**

The GraphQL field `nexusOperationAuditList` and IPC `OPERATION_AUDIT_LIST` were already wired (`resolvers.ts:5019`, `ipc-handlers.ts:4492`) but had nothing to read. Confirm they now return entries.

- [ ] **Step 7: Record the result**

If any step fails, stop and fix before Phase 3 — a half-wired audit trail is worse than a known-absent one, because it invites false confidence.

---

# Phase 3 — Bound the Pre-Existing Log Writers

### Task 5: Rotate and prune agent logs

Fixes the observed 9.1 MB `security-sentinel/agent.log` and the unbounded accumulation of `run-*.log` / `*-report.md` pairs.

**Files:**
- Modify: `src/main/agent-runtime/buildAgentContext.ts:97`
- Test: `tests/unit/agent-runtime/agentLogRotation.test.ts` (create)

**Interfaces:**
- Consumes: `rotateIfNeeded`, `pruneOldFiles` from Task 1.
- Produces: no new exports; behavioral change only.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent-runtime/agentLogRotation.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rotateIfNeeded, pruneOldFiles } from '../../../src/main/logging/rotate';

// buildAgentContext requires heavy main-process wiring (and better-sqlite3, which
// is ABI-mismatched in this working copy), so this test verifies the rotation
// contract the appendLog path depends on, against the real filesystem.
describe('agent log rotation contract', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agentlog-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('bounds a continuously appended agent.log', () => {
    const logFile = path.join(dir, 'agent.log');
    const line = `[INFO] ${new Date().toISOString()} ${'x'.repeat(200)}\n`;
    for (let i = 0; i < 200; i++) {
      rotateIfNeeded(logFile, 4096, 2);
      fs.appendFileSync(logFile, line);
    }
    expect(fs.statSync(logFile).size).toBeLessThan(4096 + line.length);
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    expect(fs.existsSync(`${logFile}.3`)).toBe(false); // keep=2
  });

  it('prunes old per-run logs and reports, keeping the newest', () => {
    for (let i = 1; i <= 6; i++) {
      const log = path.join(dir, `run-${i}.log`);
      const report = path.join(dir, `run-${i}-report.md`);
      fs.writeFileSync(log, 'log'); fs.writeFileSync(report, 'report');
      const t = new Date(i * 100000);
      fs.utimesSync(log, t, t); fs.utimesSync(report, t, t);
    }
    pruneOldFiles(dir, /^run-.*\.log$/, 3);
    pruneOldFiles(dir, /^run-.*-report\.md$/, 3);

    expect(fs.existsSync(path.join(dir, 'run-6.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'run-6-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-1-report.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/agentLogRotation.test.ts --no-coverage`
Expected: PASS if Task 1 is complete (this test pins the contract). If Task 1 was skipped: FAIL on missing module. Proceed to Step 3 regardless — the behavioral wiring is what Steps 3-4 add.

- [ ] **Step 3: Implement**

In `src/main/agent-runtime/buildAgentContext.ts`, add to the imports:

```typescript
import { rotateIfNeeded, pruneOldFiles } from '../logging/rotate';
```

Replace `appendLog` (line ~95-98):

```typescript
  /** Agent logs are appended on every single log call and were previously
   *  uncapped — security-sentinel/agent.log reached 9.1 MB. Rotate before each
   *  append; rotateIfNeeded is a cheap statSync when under the limit. */
  function appendLog(level: string, msg: string): void {
    try {
      rotateIfNeeded(logFile);
      fs.appendFileSync(logFile, `[${level}] ${new Date().toISOString()} ${msg}\n`);
    } catch { /* logging must never break the agent */ }
  }
```

Then, once per context construction (not per log line), prune old per-run artifacts. Add immediately after `logDir` is known and the directory is ensured:

```typescript
  // Per-run logs and reports accumulated one pair per run forever. Keep the 20
  // most recent of each; older runs remain summarised in the agent_runs table.
  try {
    pruneOldFiles(logDir, /^run-.*\.log$/, 20);
    pruneOldFiles(logDir, /^run-.*-report\.md$/, 20);
  } catch { /* best effort */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/agentLogRotation.test.ts tests/unit/logging/ --no-coverage`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep buildAgentContext`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-runtime/buildAgentContext.ts tests/unit/agent-runtime/agentLogRotation.test.ts
git commit -m "fix(logging): bound agent.log and prune old per-run agent logs

agent.log was appended to on every log call with no size cap — the
security-sentinel copy reached 9.1 MB. Rotate before append (5 MiB x 3
generations) and keep only the 20 most recent run-*.log / *-report.md pairs."
```

---

### Task 6: Rotate the main process log file

Lowest severity — file logging is opt-in via env vars and off by default — but it is the same one-line unbounded `appendFileSync` and should not be left as the last uncapped writer.

**Files:**
- Modify: `src/main/logging/Logger.ts:122`
- Test: covered by `tests/unit/logging/rotate.test.ts` (Task 1)

**Interfaces:**
- Consumes: `rotateIfNeeded` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Implement**

In `src/main/logging/Logger.ts`, add to imports:

```typescript
import { rotateIfNeeded } from './rotate';
```

In `write()`, wrap the existing append (line ~122):

```typescript
      if (this.logToFile && this.logFilePath) {
        try {
          rotateIfNeeded(this.logFilePath);
          fs.appendFileSync(this.logFilePath, formatted + '\n', 'utf-8');
        } catch { /* logging must never break the caller */ }
      }
```

- [ ] **Step 2: Verify the whole logging + audit surface still passes**

Run: `npx jest tests/unit/logging/ tests/unit/audit/ --no-coverage`
Expected: PASS

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "logging/Logger"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/main/logging/Logger.ts
git commit -m "fix(logging): rotate the main process log file when enabled"
```

---

### Task 7: Full-suite regression check and documentation

**Files:**
- Modify: `CLAUDE.md` (add a Logging & Audit section)

- [ ] **Step 1: Establish the baseline on a clean tree**

```bash
git stash && npx jest --no-coverage 2>&1 | tail -5 && git stash pop
```
Record the failure count. Expect 6 suites failing from the better-sqlite3 ABI mismatch documented in Global Constraints.

- [ ] **Step 2: Run the full suite with the changes**

```bash
npx jest --no-coverage 2>&1 | tail -5
```
Expected: the **same** failing suites as the baseline, with a higher passing count from the new tests. Any *new* failing suite is a regression and must be fixed before proceeding.

- [ ] **Step 3: Document the behaviour in CLAUDE.md**

Append:

```markdown
---

## Logging & Audit

**Durable audit trail:** `~/Library/Application Support/Local/nexus-ai/operation-audit.log`
— JSONL, mode 0600, one line per Tier 2/3 operation. Written centrally from
`McpSafetyWrapper.auditLog()` (MCP tools) and `AgentDispatcher.dispatch()`
(agent-contributed tools). **Do not hand-instrument individual tools** — the
chokepoints cover everything and cannot drift.

Tier 1 (read-only) is deliberately not written to disk. Note that Tier 2 is the
*default* for any tool absent from `TIER_OVERRIDES` (`src/main/mcp/safety.ts:223`),
so new tools are audited unless explicitly marked Tier 1.

`parameters` is redacted inside `OperationAuditLog.log()`, never at the call
site, so a new call site cannot leak credentials.

**Rotation:** all durable writers use `src/main/logging/rotate.ts`
(`rotateIfNeeded`, `pruneOldFiles`). Default 5 MiB x 3 generations. Per-run agent
logs and reports are pruned to the 20 most recent per agent.

**Historical:** `services.operationAuditLog` was declared in the service types but
never assigned, so `?.log()` calls silently no-opped and no audit file was ever
created; `mcp/audit.ts`'s `flush()` was likewise never called in production and
its in-memory buffer was discarded on every exit. Both are fixed — if you add a
new service handle, verify it is actually assigned, not merely declared.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record logging and audit architecture in CLAUDE.md"
```

---

## Risks and Non-Goals

**Risks**

| Risk | Mitigation |
|---|---|
| Tier 2 being the default makes the audit log high-volume | Rotation ships *before* the first write (Phase 1 precedes Phase 2). 5 MiB x 3 caps it at 20 MiB. |
| Redaction misses a sensitive key name | `redactParams` matches `password/token/secret/key/certificate/private_key` as substrings and recurses into nested objects and arrays. Task 4 Step 5 verifies on real data. Extending the list is a one-line change. |
| Synchronous appends on a hot path | One JSON line per Tier 2/3 call only; Tier 1 reads (the high-frequency case) skip disk entirely. Negligible beside the WP-CLI/CAPI call being audited. |
| `rotateIfNeeded` racing between the addon and another process | Renames are atomic on macOS; worst case a few lines land in the previous generation. Acceptable for an audit trail; a lock file is not justified. |
| Pruning deletes a report a user still wanted | Keeps 20 per agent, and `agent_runs` retains 100 rows of run metadata regardless. |

**Non-goals (explicitly out of scope)**

- Restructuring the three competing logging idioms (`createLogger`, injected `localLogger`, raw `console.*`). Real inconsistency, but a large mechanical refactor unrelated to these two gaps.
- Adding logging to the ~74 silent catch blocks in `ipc-handlers.ts` / ~124 in `resolvers.ts`. Worth doing; separate effort.
- Renderer-side structured logging.
- Surfacing `AuditLogger.getLogs()` (the `RegistryStorage`-backed one) in the UI. It has a working write path and a 1000-entry cap; only the read path is unused.
- Retiring the duplicate `logging/config.ts` dead code.

## Verification Summary

The plan is complete when all of the following hold:

1. `npx jest tests/unit/logging/ tests/unit/audit/ tests/unit/agent-runtime/ --no-coverage` passes, with no new failing suites versus the Task 7 Step 1 baseline.
2. `npx tsc --noEmit -p tsconfig.json` reports no errors in the modified files.
3. `~/Library/Application Support/Local/nexus-ai/operation-audit.log` exists on a real run, is mode `0600`, contains valid JSONL, and contains no unredacted secrets (Task 4).
4. A Tier 1 tool call produces **no** durable audit entry; a Tier 2 call produces exactly one.
5. Appending past the size cap produces `operation-audit.log.1` and leaves the live file under the cap.
6. No log file in `~/Library/Application Support/Local/nexus-ai/` can exceed its configured cap.
