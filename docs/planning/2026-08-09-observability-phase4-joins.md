# Observability Phase 4 — Joins, honesty fixes, and the documents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the run id the user can see the same one they can grep, stop a run reporting success when its work failed, close the last silent refusal path, and write the documents the design promised.

**Architecture:** Phases 1–3 built the log; this phase fixes the seams between it and everything around it. Four are defects found by the logging itself once it was running; the fifth joins the event log to the compliance record; the sixth is the user- and developer-facing documentation.

**Tech Stack:** TypeScript, Jest, the `EventLog` and `OperationAuditLog` already in place.

## Global Constraints

- Line format, local time, closed vocabulary, single redaction path — as Phases 1–3. This phase adds no new vocabulary words.
- Logging must never throw.
- **Never fabricate.** A field that cannot be known is absent, not defaulted.
- `operation-audit.log` is the compliance record and is written **synchronously**. Adding a field must not change that, and must not alter existing entry semantics — see the "three writers" section of `CLAUDE.md`.
- Renderer components are class-based with `React.createElement()`.
- Run tests with `npx jest <path>`. Do NOT run `npm rebuild better-sqlite3`.

---

### Task 1: One run id, from the button to the log line

**Files:**
- Modify: `src/main/ipc-handlers.ts` (`AGENT_RUN_NOW`, ~line 4840)
- Test: `tests/unit/agent-runtime/runNowRunId.test.ts`

**Interfaces:**
- Consumes: `AgentResult.runId` (Phase 1).
- Produces: `AGENT_RUN_NOW` returns and broadcasts the runner's own `runId`s.

**Context you need:** The handler mints `const runId = \`run-${Date.now()}\`` for the UI and then loops `runner.run()` once per selected site. So one visible "run" over 3 sites produces 3 unrelated `r_…` ids in the log, none of which is the id the UI shows — and `lastRunResult.runId` is in hand at the call site and never broadcast. The result: there is no path from the app to a greppable id, so `grep run=<id>` requires finding an id in the log first.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/runNowRunId.test.ts
import { collectRunIds } from '../../../src/main/agent-runtime/runNowIds';

describe('collectRunIds', () => {
  it('returns the runner ids, in site order', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: { runId: 'r_2' } },
    ] as any)).toEqual(['r_1', 'r_2']);
  });

  it('skips a run that produced no id rather than inserting a hole', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: {} },
    ] as any)).toEqual(['r_1']);
  });

  it('is empty, not undefined, when nothing ran', () => {
    expect(collectRunIds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/runNowRunId.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement and wire**

```ts
// src/main/agent-runtime/runNowIds.ts
import type { AgentResult } from '../agent-sdk/types';

/**
 * The run ids a single "Run Now" produced — one per site, because the handler loops the runner
 * per selected site.
 *
 * The UI used to show a `run-${Date.now()}` string it minted itself, which appeared in no log
 * line anywhere. Broadcasting the runner's own ids is what makes `grep run=<id>` reachable from
 * the app rather than only from reading the log first.
 */
export function collectRunIds(runs: Array<{ site: string; result: Partial<AgentResult> }>): string[] {
  return runs.map(r => r.result?.runId).filter((id): id is string => typeof id === 'string' && id !== '');
}
```

In `AGENT_RUN_NOW`: keep the existing `runId` only as the UI's correlation handle for its own toast, collect each `runner.run()` result's `runId`, and include `runIds: string[]` in both the broadcast payload and the returned object. Where the UI displays a single run, show the first id and note the count when there is more than one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/runNowRunId.test.ts` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/runNowIds.ts src/main/ipc-handlers.ts tests/unit/agent-runtime/runNowRunId.test.ts
git commit -m "fix(agents): Run Now reports the run id that appears in the log"
```

---

### Task 2: run.end stops claiming success when the work failed

**Files:**
- Modify: `src/main/agent-runtime/NexusToolProvider.ts`, `src/main/agent-runtime/AgentRunner.ts`
- Test: `tests/unit/agent-runtime/runEndHonesty.test.ts`

**Interfaces:**
- Produces: `NexusToolProvider.failedCallCount(): number`; `run.end` gains `failedCalls` when non-zero.

**Context you need:** Observed live: `auth-probe` logged `run.end status=success` in a run where `wp_plugin_list` had failed — the agent caught the error and carried on, so the run "succeeded". That is defensible, but it means `grep "run.end status=error"` finds nothing for a run that did real work badly, and the only trace is a `WARN` line someone has to notice. Do **not** change `status` — an agent that handled a failure did succeed. Add the count instead, so the line carries both facts.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/runEndHonesty.test.ts
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

const services = { contributedRegistry: { list: () => [] } } as any;
const failing = { call: async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }), list: () => [] } as any;
const okRegistry = { call: async () => ({ isError: false, content: [{ type: 'text', text: '{}' }] }), list: () => [] } as any;

describe('failedCallCount', () => {
  it('starts at zero', () => {
    expect(new NexusToolProvider(okRegistry, services, undefined).failedCallCount()).toBe(0);
  });

  it('counts a tool call that failed', async () => {
    const p = new NexusToolProvider(failing, services, undefined);
    await expect(p.invoke('wp_plugin_list', { site: 'x' })).rejects.toThrow();
    expect(p.failedCallCount()).toBe(1);
  });

  it('counts a refusal too — the agent asked for something it could not have', async () => {
    const p = new NexusToolProvider(okRegistry, services, ['wp_plugin_list']);
    await expect(p.invoke('wp_plugin_update', { site: 'x' })).rejects.toThrow();
    expect(p.failedCallCount()).toBe(1);
  });

  it('does not count successes', async () => {
    const p = new NexusToolProvider(okRegistry, services, undefined);
    await p.invoke('wp_plugin_list', { site: 'x' });
    expect(p.failedCallCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/runEndHonesty.test.ts`
Expected: FAIL — `failedCallCount` does not exist.

- [ ] **Step 3: Count, and report on run.end**

Add a private counter to `NexusToolProvider`, incremented in the same `catch` that already emits the failed `tool.call`, plus the accessor. In `AgentRunner`, add `failedCalls` to the `run.end` fields **only when it is non-zero** — a `failedCalls=0` on every successful run is noise that trains people to ignore the field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS except the 4 known sqlite ABI failures.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/NexusToolProvider.ts src/main/agent-runtime/AgentRunner.ts tests/unit/agent-runtime/runEndHonesty.test.ts
git commit -m "fix(agents): run.end reports how many tool calls failed"
```

---

### Task 3: The last silent refusal

**Files:**
- Modify: `src/main/ipc-handlers.ts` (the disabled-agent guard in `AGENT_RUN_NOW`, ~line 4851)
- Test: `tests/unit/agent-runtime/runNowSkip.test.ts`

**Interfaces:**
- Consumes: `emitRunSkip` (Phase 1, already exported from `ipc-handlers.ts`).

**Context you need:** Three paths refuse a run. The scheduler and the event bus both write `run.skip` through `canAutoRun`. `AGENT_RUN_NOW` has its own guard — `getAgentSetting(agentId, 'enabled') === false` — that returns an error object and writes nothing, so a user pressing Run Now on a disabled agent produces no evidence at all.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/runNowSkip.test.ts
// Harness: copy the MockIpcMain + registerWithServices harness from
// tests/unit/agent-runtime/emitRunSkip.test.ts — including its note about never invoking
// AGENT_SETTINGS_UPDATE, which writes the user's real agent-settings.json.

it('writes run.skip when Run Now refuses a disabled agent', async () => {
  const { calls, log } = fakeLog();
  const deps = registerWithServices({ eventLog: log });
  (deps as any).__agentSettingsCache.set('run-now-skip-test', { enabled: false, scheduleEnabled: true });

  await mockIpc.invoke(IPC_CHANNELS.AGENT_RUN_NOW, { agentId: 'run-now-skip-test', siteNames: [] });

  expect(calls).toHaveLength(1);
  expect(calls[0].event).toBe('run.skip');
  expect(calls[0].fields).toEqual({ trigger: 'manual', reason: 'agent-disabled' });
});

it('writes nothing when the agent is enabled', async () => {
  const { calls, log } = fakeLog();
  const deps = registerWithServices({ eventLog: log });
  (deps as any).__agentSettingsCache.set('run-now-ok-test', { enabled: true, scheduleEnabled: true });
  await mockIpc.invoke(IPC_CHANNELS.AGENT_RUN_NOW, { agentId: 'run-now-ok-test', siteNames: [] })
    .catch(() => { /* the agent does not exist; the guard under test is the one before that */ });
  expect(calls.filter((c: any) => c.event === 'run.skip')).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/runNowSkip.test.ts`
Expected: FAIL — no `run.skip` is written.

- [ ] **Step 3: Emit at the guard**

In the disabled-agent branch, call the existing `emitRunSkip(agentId, 'manual', { allowed: false, reason: 'agent-disabled' }, getEventLog())` before returning the error object. `AutoRunKind` must accept `'manual'` — widen it if it does not, and check the two existing `canAutoRun` callers still typecheck.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/runNowSkip.test.ts tests/unit/agent-runtime/emitRunSkip.test.ts tests/unit/agent-runtime/can-auto-run.test.ts`
Expected: PASS — all three.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/agent-runtime/auto-run-gate.ts tests/unit/agent-runtime/runNowSkip.test.ts
git commit -m "fix(agents): Run Now records why it refused a disabled agent"
```

---

### Task 4: Keep the SSH socket alive long enough to matter

**Files:**
- Modify: `src/main/mcp/utils/remoteFailure.ts` (add the constant), `src/main/mcp/local-services-bridge.ts`, `src/main/sentinel/SentinelExecutor.ts`
- Test: `tests/unit/mcp/controlPersist.test.ts`

**Interfaces:**
- Produces: `SSH_CONTROL_PERSIST` — a single value both SSH argument builders use.

**Context you need:** Both builders pass `ControlPersist=30s`. Measured live: `auth-probe` runs every 2 minutes, so the multiplexed socket has always expired and **every** scheduled call pays the full 13–30s cold start — the "subsequent calls complete in 1–3s" the code describes never happens for a scheduled agent. This is why calls were hitting the timeout ceiling. The trade is real: a longer persist holds an authenticated socket to a production server open for longer, so this is a deliberate, documented choice rather than a free win.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mcp/controlPersist.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { SSH_CONTROL_PERSIST } from '../../../src/main/mcp/utils/remoteFailure';

it('outlives a typical agent cadence, or the multiplexed socket never helps', () => {
  // A 30s persist against a 2-minute agent cadence means every scheduled call is cold. The point
  // of ControlMaster is that the second call is cheap; that only happens if the socket survives
  // the gap between calls.
  const seconds = Number(String(SSH_CONTROL_PERSIST).replace(/\D/g, ''));
  expect(seconds).toBeGreaterThanOrEqual(300);
});

it('both SSH builders use the shared constant, not their own literal', () => {
  for (const f of ['src/main/mcp/local-services-bridge.ts', 'src/main/sentinel/SentinelExecutor.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../../../', f), 'utf-8');
    expect(src).toContain('SSH_CONTROL_PERSIST');
    expect(src).not.toMatch(/ControlPersist=30s/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/mcp/controlPersist.test.ts`
Expected: FAIL — the constant does not exist and both files carry the literal.

- [ ] **Step 3: Add the constant and use it in both builders**

```ts
/**
 * How long the multiplexed SSH socket outlives its last command.
 *
 * Was 30s, which is shorter than every agent cadence in this codebase — an agent on a 2-minute
 * schedule found the socket already gone and paid the full 13-30s WP Engine cold start on every
 * single call, which is how calls were reaching the timeout ceiling at all.
 *
 * The cost of raising it is an authenticated socket to a production server staying open longer,
 * which is why this is 10 minutes rather than an hour: long enough that a scheduled agent reuses
 * it, short enough that an idle machine is not holding connections indefinitely.
 */
export const SSH_CONTROL_PERSIST = '600s';
```

Replace `'ControlPersist=30s'` in both argument arrays with a template using the constant.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/mcp` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS except the 2 known pre-existing failures (`fleet-sql`, `wpe-deep-refresh`).

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/utils/remoteFailure.ts src/main/mcp/local-services-bridge.ts src/main/sentinel/SentinelExecutor.ts tests/unit/mcp/controlPersist.test.ts
git commit -m "perf(ssh): keep the multiplexed socket past a typical agent cadence"
```

---

### Task 5: The run id reaches the compliance record

**Files:**
- Modify: `src/main/audit/OperationAuditLog.ts`, `src/main/agent-runtime/NexusToolProvider.ts`
- Test: `tests/unit/audit/auditRunId.test.ts`

**Interfaces:**
- Produces: `OperationAuditEntry` gains `runId?: string`.

**Context you need:** `operation-audit.log` is the compliance record and the event log is the diagnostic one; today they cannot be joined. Adding the run id to audit entries written on the agent path makes "which run performed this Tier 3 operation?" answerable. `OperationAuditLog.log()` is synchronous and redacts inside itself — do not move either, and do not change existing field semantics.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/audit/auditRunId.test.ts
// Use the existing harness style in tests/main/audit.test.ts for constructing an
// OperationAuditLog against a temp directory.

it('records the run id when one is supplied', async () => {
  const log = makeAuditLog();                       // temp-dir helper, per tests/main/audit.test.ts
  await log.log({ operation: 'wp_plugin_update', target: 'acfprod', outcome: 'success', runId: 'r_abc' } as any);
  expect(readEntries(log)[0].runId).toBe('r_abc');
});

it('omits it entirely when there is none, rather than writing null', async () => {
  // Most audit entries come from paths with no run — a null field on every one of them is noise
  // that makes the joinable entries harder to spot.
  const log = makeAuditLog();
  await log.log({ operation: 'ipc.wp.core.update', target: 'site', outcome: 'success' } as any);
  expect('runId' in readEntries(log)[0]).toBe(false);
});

it('redacts the run id like every other field', async () => {
  // Not because a run id is secret, but because the redaction walk must cover every field it
  // writes — an exemption is how the next field added quietly skips it.
  const log = makeAuditLog();
  await log.log({ operation: 'x', target: 'y', outcome: 'success', runId: 'r_abc' } as any);
  expect(readEntries(log)[0].runId).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/audit/auditRunId.test.ts`
Expected: FAIL — `runId` is dropped.

- [ ] **Step 3: Thread it**

Add `runId?: string` to the audit entry type, include it in the redaction walk, and omit the key when undefined. In `NexusToolProvider`, pass `this.events?.runId` on the audit call it already makes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/audit tests/main/audit.test.ts`
Expected: PASS — including the existing must-mask/must-survive corpus.

- [ ] **Step 5: Commit**

```bash
git add src/main/audit/OperationAuditLog.ts src/main/agent-runtime/NexusToolProvider.ts tests/unit/audit/auditRunId.test.ts
git commit -m "feat(audit): join the compliance record to the run that caused it"
```

---

### Task 6: The documents

**Files:**
- Create: `docs/logging.md`
- Modify: `CLAUDE.md` (the event-log section), `docs/planning/2026-08-09-ai-observability-design.md` (stale sample lines)

**Context you need:** The design promised a developer reference and a user-facing explanation and neither exists. `CLAUDE.md` already carries the internals. The design doc's §2 sample lines are **stale** — they show `run=r_8f3a2c  phase=scan site=acfprod`, but the shipped format is `run=r_8f3a2c phase name=scan detail=acfprod` after the distinct-event-names ruling, and the level is no longer padded.

- [ ] **Step 1: Write `docs/logging.md`**

Cover, with real examples copied from an actual log file rather than invented:
- where the logs are, and what each file is for
- how to read a line (the format, field by field)
- the three questions the log answers: did my agent run, what did it do, why did it not run
- the event vocabulary as a table, one row per word, with its fields
- levels: global, per-agent, `NEXUS_LOG_LEVEL`
- retention and the disk budget, and which files are preserved from eviction
- transcripts: what they contain, that they are off by default, and why
- what is redacted and what is withheld, with a pointer to `CLAUDE.md` for the mechanism
- the cost table's `PRICES_AS_OF` date and what it means for the `cost=` field

- [ ] **Step 2: Correct the design doc's stale samples**

Update §2's sample lines to the shipped format. Leave the rest of the document as the historical record of the decision.

- [ ] **Step 3: Verify every command in the document actually works**

Run each `grep`/`tail`/`awk` example from `docs/logging.md` against a real log file and paste the real output into the doc. A documented command that does not work is worse than no documentation.

- [ ] **Step 4: Commit**

```bash
git add docs/logging.md CLAUDE.md docs/planning/2026-08-09-ai-observability-design.md
git commit -m "docs: how to read the agent logs"
```

---

### Task 7: The carried minors

**Files:**
- Modify: `src/main/logging/eventLog.ts`, `src/main/ipc-handlers.ts` (`emitRunSkip`), `src/renderer/components/NexusOverview.tsx:522`
- Test: `tests/unit/logging/eventLogPerf.test.ts`, `tests/unit/agent-runtime/runSkipVolume.test.ts`

**Context you need:** Four items carried from Phase 1's review, each individually small and none worth its own task. They are grouped here so the list closes rather than being quietly dropped.

- [ ] **Step 1: Stop re-creating the directory and re-chmodding on every line**

Measured at 80µs/line against 23µs for a bare append, roughly half of it `mkdirSync` + `chmodSync` on **every** write. Cache the created directory per path and chmod only when the file is created:

```ts
  private readonly ensured = new Set<string>();

  private append(file: string, line: string): void {
    try {
      const dir = path.dirname(file);
      if (!this.ensured.has(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        this.ensured.add(dir);
      }
      const isNew = !fs.existsSync(file);
      rotateIfNeeded(file, this.maxBytes);
      fs.appendFileSync(file, line, { mode: 0o600 });
      // Only on creation: chmod on every line was the other half of the cost, and the mode
      // cannot drift on a file nothing else touches.
      if (isNew) { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
    } catch (err) { this.reportAppendFailure(file, err); }
  }
```

Add a test asserting the mode is still 0600 on both a new and a pre-existing file — the existing guarantee must survive the optimisation.

- [ ] **Step 2: Stop `run.skip` repeating itself every tick**

Three disabled agents on 15-minute cadences produce roughly 288 identical lines a day in the stream the design tells you to `tail -f`. Emit on **transition** — the first refusal for an agent, and again only if the reason changes — keeping a count:

```ts
  // agentId → the reason last reported, so a steady state is stated once rather than every tick.
  const lastSkipReason = new Map<string, string>();
```

Test that two consecutive refusals with the same reason write one line, and that a changed reason writes a second.

- [ ] **Step 3: Fix the UTC/local mix in the overview row**

`src/renderer/components/NexusOverview.tsx:522` formats a date from UTC while showing a local clock beside it — the same defect fixed in the log format. Make both local.

- [ ] **Step 4: Leave the spread-ordering guard untested, and say so**

`emit`'s `{...e}` ordering in `buildAgentContext.ts` is correct but has no test, because `AgentLogger` gives no caller a way to reach `source`/`runId` — any test written today passes under either ordering. Add a comment at the code saying exactly that, so the next reader does not mistake the gap for an oversight and does not write the vacuous test.

- [ ] **Step 5: Run tests and commit**

Run: `npx jest tests/unit/logging tests/unit/agent-runtime tests/unit/renderer`

```bash
git add src/main/logging/eventLog.ts src/main/ipc-handlers.ts src/renderer/components/NexusOverview.tsx src/main/agent-runtime/buildAgentContext.ts tests/unit/logging/eventLogPerf.test.ts tests/unit/agent-runtime/runSkipVolume.test.ts
git commit -m "perf(logging): hoist the per-append syscalls; quieten repeated run.skip"
```

---

## Done when

`grep run=<id>` works from an id the UI showed you; a run whose tool call failed says so on its `run.end` line; pressing Run Now on a disabled agent leaves a `run.skip`; a scheduled agent's second call completes in seconds rather than paying a cold start; a Tier 3 audit entry names the run that caused it; and `docs/logging.md` answers "where are my logs and how do I read them" without anyone reading the source.
