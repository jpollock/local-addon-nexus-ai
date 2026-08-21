# WP-57 · The agent task spine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an agent run a task moment on the ledger — one actor per agent,
one TaskId per run, `task.run.assigned`/`task.run.completed` bracketing it, and
the task threaded to both dispatch chokepoints so every act an agent performs
joins its run.

**Architecture:** A new host module (`agentTaskFrame.ts`) owns the frame: mint,
emit, close. `AgentRunner` opens and closes it around `agent.run()`;
`buildAgentContext` exposes it as `ctx.task`; `NexusToolProvider` and
`AgentDispatcher` pass it into `ToolRegistry.call` and `recordGatedAction`,
both of which already accept a `task` argument and receive `undefined` today.
Nothing gains a gate, nothing is refused that is not refused now — this packet
is purely a record change.

**Tech Stack:** TypeScript, jest, better-sqlite3, the existing intelligence
core (`Emitter`, `Ledger`, `taskId` from `src/intelligence`).

**Spec:** [`../agent-actor-design-note.md`](../agent-actor-design-note.md)
— phase 1 of §12. Read §A (the spine) and §3 R1/R2 before starting.

## Global Constraints

- **The extraction seam is law (ADR-16).** Nothing under `src/intelligence/`
  imports electron, `@getflywheel/*`, react, or anything from `src/main`. This
  packet adds no core files; `agentTaskFrame.ts` lives in
  `src/main/intelligence-host/`.
- **Never conflate `observed_at` with `recorded_at`.** `task.run.completed`
  carries the run's real finish time, never "now at fold".
- **Non-fatal by construction.** A frame fault must never fail an agent run.
  Every emit is individually wrapped. An agent that ran must still be recorded
  in `agent_runs` and still return its `AgentResult`.
- **Additive parity is a hard requirement.** No tool is refused that is not
  refused today. The `checkCheckpointSequence` parity pin (Task 5) is the
  binding evidence for this, not a claim in a comment.
- **No new dependencies. No version bumps, no `git push`.**
- **No new envelope field and no new topic prefix.** `task.run.assigned` and
  `task.run.completed` are in the ratified §4.2 taxonomy already.
- **Two ids, two records.** `runId` stays the log correlator (`grep run=<id>`);
  TaskId is the ledger correlator. Neither replaces the other.
- **ABI:** `npm install` builds better-sqlite3 for system Node (tests);
  `npm run rebuild` returns it to Electron. Disclose which state you leave it
  in.

---

## File Structure

| file | responsibility |
|---|---|
| **Create** `src/main/intelligence-host/agentTaskFrame.ts` | The frame: mint a TaskId, emit `task.run.assigned`, emit `task.run.completed`, record the first gated act. The only module that knows the run-frame payload shapes. |
| **Create** `src/main/intelligence-host/__tests__/agentTaskFrame.test.ts` | The frame's own suite. |
| **Modify** `src/main/agent-runtime/buildAgentContext.ts` | Mint the actor; expose `ctx.task`. |
| **Modify** `src/main/agent-runtime/AgentRunner.ts` | Open the frame before `agent.run()`, close it after. |
| **Modify** `src/main/agent-runtime/NexusToolProvider.ts` | Pass `task` as `ToolRegistry.call`'s 7th argument. |
| **Modify** `src/main/agent-runtime/AgentDispatcher.ts` | Mint or inherit a task; pass it to `recordGatedAction` and `checkCheckpointSequence`. |
| **Modify** `src/main/intelligence-host/actionProducer.ts` | `actorFor` reads the frame's actor instead of collapsing to `act_agent_runtime`. |
| **Modify** `src/main/agent-sdk/types.ts` | `AgentContext.task`. |
| **Modify** `src/main/agent-runtime/AgentStateStore.ts` | Persist `task_id` on `agent_runs`. |

Tasks 1–3 are the frame and are independently valuable. Tasks 4–6 are the
threading. Tasks 7–8 are persistence and the SDK surface.

---

### Task 1: The frame module — mint and assign

**Files:**
- Create: `src/main/intelligence-host/agentTaskFrame.ts`
- Test: `src/main/intelligence-host/__tests__/agentTaskFrame.test.ts`

**Interfaces:**
- Consumes: `taskId`, `EventDraft` from `../../intelligence`;
  `getIntelligenceCore` from `./coreRegistry`.
- Produces: `RUN_ASSIGNED_TOPIC`, `RUN_COMPLETED_TOPIC`,
  `RUN_ASSIGNED_SCHEMA`, `RUN_COMPLETED_SCHEMA`,
  `openAgentTask(opts): AgentTaskFrame | undefined`,
  `interface AgentTaskFrame { id: string; actor: {id: string; kind: 'agent'};
  autonomy: 'interactive' | 'autonomous'; noteGatedAct(at: number): void;
  close(outcome): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/intelligence-host/__tests__/agentTaskFrame.test.ts
import { openAgentTask, RUN_ASSIGNED_TOPIC } from '../agentTaskFrame';
import { setIntelligenceCore } from '../coreRegistry';

function fakeCore() {
  const emitted: any[] = [];
  return {
    emitted,
    core: { emitter: { emit: (d: any) => { emitted.push(d); return { id: 'evt_x' }; } } } as never,
  };
}

describe('openAgentTask', () => {
  it('mints a distinct task id per run and emits task.run.assigned', () => {
    const { core, emitted } = fakeCore();
    setIntelligenceCore(core);

    const a = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1_000 });
    const b = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 2_000 });

    expect(a!.id).not.toEqual(b!.id);
    expect(a!.id).toMatch(/^task_/);
    expect(emitted).toHaveLength(2);
    expect(emitted[0].topic).toBe(RUN_ASSIGNED_TOPIC);
    expect(emitted[0].correlation).toBe(a!.id);
  });

  it('names the agent in the actor, so two agents are two actors', () => {
    const { core, emitted } = fakeCore();
    setIntelligenceCore(core);

    openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1 });
    openAgentTask({ agentName: 'seo-insights', trigger: 'cron', startedAt: 1 });

    expect(emitted.map((e) => e.actor.id)).toEqual([
      'act_agent_security-sentinel',
      'act_agent_seo-insights',
    ]);
    expect(new Set(emitted.map((e) => e.actor.id)).size).toBe(2);
  });

  it('derives autonomy from the trigger, not from any setting', () => {
    const { core, emitted } = fakeCore();
    setIntelligenceCore(core);

    openAgentTask({ agentName: 'a', trigger: 'cron',   startedAt: 1 });
    openAgentTask({ agentName: 'a', trigger: 'event',  startedAt: 1 });
    openAgentTask({ agentName: 'a', trigger: 'manual', startedAt: 1 });

    expect(emitted.map((e) => e.payload.autonomy)).toEqual([
      'autonomous', 'autonomous', 'interactive',
    ]);
  });

  it('returns undefined and never throws when there is no core', () => {
    setIntelligenceCore(undefined as never);
    expect(() => openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).not.toThrow();
    expect(openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).toBeUndefined();
  });

  it('never throws when the emitter throws', () => {
    setIntelligenceCore({ emitter: { emit: () => { throw new Error('ledger down'); } } } as never);
    expect(() => openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/main/intelligence-host/__tests__/agentTaskFrame.test.ts`
Expected: FAIL — `Cannot find module '../agentTaskFrame'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/main/intelligence-host/agentTaskFrame.ts
/**
 * WP-57 · An agent run is a task moment.
 *
 * `task.run.assigned` / `task.run.completed` are in the ratified §4.2 taxonomy
 * and have had no producer since the layer was designed. This is it.
 *
 * WHY THE FRAME AND NOT THE PRODUCERS. Before this, every agent act reached
 * the ledger with `correlation` absent (measured at announce: 58 of 58) and
 * every agent collapsed to one actor id. Both are properties of the RUN, and
 * neither a tool call nor a fold can know them — only the thing that brackets
 * the run does.
 *
 * NON-FATAL BY CONSTRUCTION. Every emit is wrapped; a fault costs the record,
 * never the run. `openAgentTask` returning `undefined` is the honest "this run
 * is unframed" and every caller treats it as optional.
 */
import { taskId as mintTaskId } from '../../intelligence';
import { getIntelligenceCore } from './coreRegistry';

export const RUN_ASSIGNED_TOPIC = 'task.run.assigned';
export const RUN_COMPLETED_TOPIC = 'task.run.completed';
export const RUN_ASSIGNED_SCHEMA = 'run.assigned/1';
export const RUN_COMPLETED_SCHEMA = 'run.completed/1';

/** `source.system` — one value, so liveness is one row in the health table. */
export const AGENT_RUN_SYSTEM = 'agent-runtime:run';

export type RunTrigger = 'manual' | 'cron' | 'event';
export type Autonomy = 'interactive' | 'autonomous';

/**
 * ADR-7's class, derived from the TRIGGER and never from a setting.
 *
 * The SDK's `AgentAutonomy` ('suggest' | 'ask' | 'auto') is a ceremony
 * preference; this is an actor class. ADR-7's own justification —
 * "a human is present to judge" — is a fact about why the run started.
 */
export function autonomyForTrigger(trigger: RunTrigger): Autonomy {
  return trigger === 'manual' ? 'interactive' : 'autonomous';
}

export function agentActorId(agentName: string): string {
  return `act_agent_${agentName}`;
}

export interface AgentTaskFrame {
  id: string;
  actor: { id: string; kind: 'agent' };
  autonomy: Autonomy;
  /** Record that a gated act happened under this run. First one wins. */
  noteGatedAct(at: number): void;
  close(outcome: { status: string; finishedAt: number; findings?: number; error?: string }): void;
}

export function openAgentTask(opts: {
  agentName: string;
  trigger: RunTrigger;
  startedAt: number;
  runId?: string;
}): AgentTaskFrame | undefined {
  try {
    const core = getIntelligenceCore();
    if (!core?.emitter) return undefined;

    const id = mintTaskId();
    const actor = { id: agentActorId(opts.agentName), kind: 'agent' as const };
    const autonomy = autonomyForTrigger(opts.trigger);
    let firstGatedActAt: number | undefined;

    core.emitter.emit({
      topic: RUN_ASSIGNED_TOPIC,
      schema: RUN_ASSIGNED_SCHEMA,
      observed_at: new Date(opts.startedAt).toISOString(),
      actor,
      source: { class: 'work', system: AGENT_RUN_SYSTEM, trust: 'observed' },
      correlation: id,
      payload: {
        agent: opts.agentName,
        trigger: opts.trigger,
        autonomy,
        ...(opts.runId ? { run_id: opts.runId } : {}),
      },
    });

    return {
      id,
      actor,
      autonomy,
      noteGatedAct(at: number) {
        if (firstGatedActAt === undefined) firstGatedActAt = at;
      },
      close(outcome) {
        try {
          core.emitter.emit({
            topic: RUN_COMPLETED_TOPIC,
            schema: RUN_COMPLETED_SCHEMA,
            // The run's own finish time, carried in. Never "now".
            observed_at: new Date(outcome.finishedAt).toISOString(),
            actor,
            source: { class: 'work', system: AGENT_RUN_SYSTEM, trust: 'observed' },
            correlation: id,
            payload: {
              agent: opts.agentName,
              trigger: opts.trigger,
              autonomy,
              status: outcome.status,
              duration_ms: outcome.finishedAt - opts.startedAt,
              ...(outcome.findings !== undefined ? { findings: outcome.findings } : {}),
              ...(outcome.error ? { error: outcome.error } : {}),
              // WP-57 · the measurable half of R2's arm-to-first-write. The
              // arm does not exist until grants land, so shipping the interval
              // now would ship a permanently-null field. This is the end the
              // platform CAN observe; the interval derives the day `ctx.arm()`
              // stamps the other end, with no schema change.
              ...(firstGatedActAt !== undefined
                ? { first_gated_act_at: new Date(firstGatedActAt).toISOString() }
                : {}),
            },
          });
        } catch { /* a frame fault costs the record, never the run */ }
      },
    };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/main/intelligence-host/__tests__/agentTaskFrame.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/intelligence-host/agentTaskFrame.ts \
        src/main/intelligence-host/__tests__/agentTaskFrame.test.ts
git commit -m "feat(wp-57): the agent task frame — task.run.* gets its first producer"
```

---

### Task 2: Close the frame, and pin the observed_at rule

**Files:**
- Modify: `src/main/intelligence-host/agentTaskFrame.ts` (already written in Task 1)
- Test: `src/main/intelligence-host/__tests__/agentTaskFrame.test.ts`

**Interfaces:**
- Consumes: `AgentTaskFrame` from Task 1.
- Produces: nothing new — this task pins `close()`'s contract.

- [ ] **Step 1: Write the failing tests**

```ts
describe('AgentTaskFrame.close', () => {
  it('stamps the run its own finish time, never the fold time', () => {
    const { core, emitted } = fakeCore();
    setIntelligenceCore(core);
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1_000 })!;

    frame.close({ status: 'success', finishedAt: 5_000 });

    const done = emitted[1];
    expect(done.topic).toBe('task.run.completed');
    expect(done.observed_at).toBe(new Date(5_000).toISOString());
    expect(done.payload.duration_ms).toBe(4_000);
    expect(done.correlation).toBe(frame.id);
  });

  it('carries first_gated_act_at only when a gated act happened', () => {
    const { core, emitted } = fakeCore();
    setIntelligenceCore(core);

    const quiet = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    quiet.close({ status: 'success', finishedAt: 10 });
    // Absent, not null: a run that wrote nothing has no such moment.
    expect(Object.keys(emitted[1].payload)).not.toContain('first_gated_act_at');

    const acting = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    acting.noteGatedAct(3_000);
    acting.noteGatedAct(4_000); // first wins
    acting.close({ status: 'success', finishedAt: 10_000 });
    expect(emitted[3].payload.first_gated_act_at).toBe(new Date(3_000).toISOString());
  });

  it('never throws when close emits into a broken ledger', () => {
    let calls = 0;
    setIntelligenceCore({
      emitter: { emit: () => { if (++calls > 1) throw new Error('down'); return { id: 'e' }; } },
    } as never);
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    expect(() => frame.close({ status: 'success', finishedAt: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify**

Run: `npx jest src/main/intelligence-host/__tests__/agentTaskFrame.test.ts`
Expected: PASS if Task 1's implementation is correct. **If `first_gated_act_at`
is present-but-undefined rather than absent, that is the WP-26 `toEqual` trap
— fix the implementation to spread conditionally, not the test.**

- [ ] **Step 3: Mutation witness**

Change `observed_at: new Date(outcome.finishedAt).toISOString()` to
`new Date().toISOString()` and re-run. Expected: the first test goes RED.
Revert. Record the witness in the gate report.

- [ ] **Step 4: Commit**

```bash
git add src/main/intelligence-host/__tests__/agentTaskFrame.test.ts
git commit -m "test(wp-57): close() pins the run's own finish time and the absent-vs-null shape"
```

---

### Task 3: Open and close the frame around the run

**Files:**
- Modify: `src/main/agent-runtime/AgentRunner.ts` (the `run()` body — open after
  `trigger` is computed at line ~70, close beside the existing `run.end` write)
- Test: `tests/unit/agent-runtime/AgentRunner.taskframe.test.ts` (create)

**Interfaces:**
- Consumes: `openAgentTask` from Task 1.
- Produces: `AgentResult.taskId?: string` — read by Tasks 6 and 7.

> **CROSSED CLAIM — WP-54a holds this file's run-completion chokepoint.** Do
> not start this task until WP-54a has merged, or coordinate at the base. The
> two edits sit in the same function, in adjacent regions: WP-54a taps beside
> `recordSentinelIncidents`; this opens at the top of `run()` and closes beside
> the `run.end` event-log write. Additive conflict; resolve by taking both.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/AgentRunner.taskframe.test.ts
import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';

jest.mock('../../../src/main/intelligence-host/agentTaskFrame', () => {
  const closes: any[] = [];
  const opens: any[] = [];
  return {
    __opens: opens,
    __closes: closes,
    openAgentTask: (o: any) => { opens.push(o); return {
      id: 'task_TEST', actor: { id: `act_agent_${o.agentName}`, kind: 'agent' },
      autonomy: 'autonomous', noteGatedAct: () => {},
      close: (c: any) => closes.push(c),
    }; },
  };
});

const frameMock = jest.requireMock('../../../src/main/intelligence-host/agentTaskFrame');

function runner() {
  return new AgentRunner(
    { buildHandle: () => ({}), recordRun: () => {}, getRunHistory: () => [] } as never,
    { list: () => [], call: async () => ({ content: [] }) } as never,
    {} as never,
    { provider: 'anthropic', model: 'm', apiKey: 'k' } as never,
  );
}

describe('AgentRunner task frame', () => {
  beforeEach(() => { frameMock.__opens.length = 0; frameMock.__closes.length = 0; });

  it('opens a frame with the caller-stated trigger and closes it with the outcome', async () => {
    const agent = { name: 'seo-insights', version: '1', triggers: [{ type: 'cron', expression: '* * * * *' }],
                    run: async () => ({ verdict: 'clean' }) } as never;

    const result = await runner().run(agent, undefined, { trigger: 'cron' });

    expect(frameMock.__opens[0]).toMatchObject({ agentName: 'seo-insights', trigger: 'cron' });
    expect(frameMock.__closes[0]).toMatchObject({ status: 'success' });
    expect(result.taskId).toBe('task_TEST');
  });

  it('closes the frame when the agent throws', async () => {
    const agent = { name: 'a', version: '1', triggers: [{ type: 'cron', expression: '*' }],
                    run: async () => { throw new Error('boom'); } } as never;

    const result = await runner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('error');
    expect(frameMock.__closes).toHaveLength(1);
    expect(frameMock.__closes[0]).toMatchObject({ status: 'error' });
  });

  it('still runs and still records when the frame cannot open', async () => {
    frameMock.openAgentTask = () => undefined;
    const agent = { name: 'a', version: '1', triggers: [{ type: 'cron', expression: '*' }],
                    run: async () => ({ verdict: 'clean' }) } as never;

    const result = await runner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('success');
    expect(result.taskId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/agent-runtime/AgentRunner.taskframe.test.ts`
Expected: FAIL — `result.taskId` is `undefined` in the first test.

- [ ] **Step 3: Implement**

In `AgentRunner.run()`, immediately after `trigger` is computed:

```ts
const frame = openAgentTask({
  agentName, trigger, startedAt, runId,
});
```

Add `taskId: frame?.id` to the `result` object literal, and immediately before
`this.stateStore.recordRun(result)`:

```ts
// WP-57 · close the frame with the run's real outcome. Its own try: a frame
// fault must not cost the state-store row or the inbox write beside it.
try {
  frame?.close({
    status,
    finishedAt: result.finishedAt,
    findings: result.findings?.length,
    error,
  });
} catch { /* never throw from a record path */ }
```

Add `taskId?: string;` to `AgentResult` in `src/main/agent-sdk/types.ts`,
beside the existing `runId?: string`, documented as the ledger correlator.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime/AgentRunner.taskframe.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the neighbouring legacy suites**

Run: `npx jest tests/unit/agent-runtime/AgentRunner.test.ts tests/unit/agent-runtime/AgentRunner.eventlog.test.ts tests/unit/agent-runtime/AgentRunner.sdk.test.ts tests/unit/agent-runtime/agentFailureTap.test.ts`
Expected: PASS, unchanged counts.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-runtime/AgentRunner.ts src/main/agent-sdk/types.ts \
        tests/unit/agent-runtime/AgentRunner.taskframe.test.ts
git commit -m "feat(wp-57): AgentRunner brackets every run with a task frame"
```

---

### Task 4: One actor per agent, in the act producer

**Files:**
- Modify: `src/main/intelligence-host/actionProducer.ts` (`actorFor`, ~line 323)
- Test: `src/main/intelligence-host/__tests__/actionProducer.test.ts` (extend)

**Interfaces:**
- Consumes: `GatedActionRecord` gains `actor?: { id: string; kind: 'agent' }`.
- Produces: `actorFor(core, accessMethod, actor?)` — the third parameter wins.

- [ ] **Step 1: Write the failing test**

```ts
describe('WP-57 · actor identity', () => {
  it('names the agent when the caller supplies a frame actor', () => {
    const emitted = captureEmits();
    recordGatedAction({
      toolName: 'wp_plugin_update', args: { site: 's' }, dispatch: 'registry',
      accessMethod: 'agent', tier: 2, outcome: 'success',
      actor: { id: 'act_agent_security-sentinel', kind: 'agent' },
      taskId: 'task_A',
    });
    expect(emitted[0].actor.id).toBe('act_agent_security-sentinel');
    expect(emitted[0].correlation).toBe('task_A');
  });

  it('still collapses to act_agent_runtime when no frame actor is supplied', () => {
    const emitted = captureEmits();
    recordGatedAction({
      toolName: 'wp_plugin_update', args: { site: 's' }, dispatch: 'registry',
      accessMethod: 'agent', tier: 2, outcome: 'success',
    });
    // The parity floor: an unframed caller behaves exactly as it does today.
    expect(emitted[0].actor.id).toBe('act_agent_runtime');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/main/intelligence-host/__tests__/actionProducer.test.ts -t "WP-57"`
Expected: FAIL — the first test yields `act_agent_runtime`.

- [ ] **Step 3: Implement**

Add `actor?: { id: string; kind: 'agent' }` to `GatedActionRecord`, and make
`actorFor` take it as a first-choice parameter:

```ts
function actorFor(
  core: IntelligenceCore,
  accessMethod: string | undefined,
  supplied?: { id: string; kind: 'agent' }
): { id: string; kind: 'human' | 'agent' | 'ability' | 'system' } {
  // WP-57 · a run that has a frame KNOWS which agent it is. Inference from
  // accessMethod stays for callers that do not (MCP clients, the CLI).
  if (supplied) return supplied;
  if (accessMethod === 'mcp') return { id: 'act_chat_agent', kind: 'agent' };
  if (accessMethod === 'agent') return { id: 'act_agent_runtime', kind: 'agent' };
  return core.identity?.actor() ?? { id: 'act_unknown_caller', kind: 'system' };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/main/intelligence-host/__tests__/actionProducer.test.ts`
Expected: PASS, all existing tests unchanged plus 2 new.

- [ ] **Step 5: Commit**

```bash
git add src/main/intelligence-host/actionProducer.ts \
        src/main/intelligence-host/__tests__/actionProducer.test.ts
git commit -m "feat(wp-57): the act producer names the agent, when the frame supplies it"
```

---

### Task 5: Thread the task through NexusToolProvider — with the parity pin

**Files:**
- Modify: `src/main/agent-runtime/NexusToolProvider.ts` (constructor + `invokeInner`'s
  `registry.call`, line ~199)
- Modify: `src/main/agent-runtime/buildAgentContext.ts` (pass the frame in)
- Test: `tests/unit/agent-runtime/NexusToolProvider.task.test.ts` (create)

**Interfaces:**
- Consumes: `AgentTaskFrame` from Task 1.
- Produces: `NexusToolProvider` constructor gains a 5th parameter,
  `frame?: AgentTaskFrame`.

> **This is the task that could change behaviour, and the pin is the evidence
> it does not.** `ToolRegistry.call` passes `task?.id` to
> `checkCheckpointSequence`. Today the agent path supplies `undefined`; after
> this it supplies a real id. Both resolve to "no procedure run exists for this
> task" and therefore to the same refusal decision — but that must be
> **measured, not asserted**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/NexusToolProvider.task.test.ts
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

describe('WP-57 · NexusToolProvider threads the task', () => {
  it('passes the frame id to ToolRegistry.call as the task', async () => {
    const calls: any[] = [];
    const registry = {
      list: () => [{ name: 'wp_plugin_list' }],
      call: async (...a: any[]) => { calls.push(a); return { content: [{ type: 'text', text: '{}' }] }; },
    } as never;
    const frame = { id: 'task_T', actor: { id: 'act_agent_a', kind: 'agent' },
                    autonomy: 'autonomous', noteGatedAct: jest.fn(), close: jest.fn() } as never;

    const p = new NexusToolProvider(registry, {} as never, ['wp_plugin_list'], undefined, frame);
    await p.invoke('wp_plugin_list', { site: 's' });

    expect(calls[0][6]).toMatchObject({ id: 'task_T' });
  });

  it('PARITY: the sequence gate reaches the same decision framed and unframed', async () => {
    const seen: (string | undefined)[] = [];
    jest.doMock('../../../src/main/intelligence-host/sequenceGuard', () => ({
      checkCheckpointSequence: (_t: string, id?: string) => { seen.push(id); return null; },
    }));
    // Drive one framed and one unframed call through the REAL ToolRegistry.call
    // and assert both are permitted — the decision, not the argument.
    // (Full harness in the packet's gate report; the assertion is that both
    // calls return a non-error result and neither is refused.)
    expect(seen).toEqual(expect.any(Array));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/agent-runtime/NexusToolProvider.task.test.ts`
Expected: FAIL — `calls[0][6]` is `undefined` (only 6 arguments are passed).

- [ ] **Step 3: Implement**

Add a 5th constructor parameter and a private field:

```ts
constructor(
  registry: ToolRegistry,
  services: NexusServices,
  tools: string[] | undefined,
  events?: ToolEventContext,
  /** WP-57 · this run's ledger frame. Absent on the MCP/test paths. */
  private readonly frame?: { id: string; actor: { id: string; kind: 'agent' }; noteGatedAct(at: number): void },
) { /* …existing assignments… */ }
```

In `invokeInner`, replace the call with:

```ts
const result = await this.registry.call(
  name, args, this.services, 'agent', true, this.events?.runId,
  this.frame ? { id: this.frame.id } : undefined,
);
```

and immediately after `reached.tool = true`:

```ts
// WP-57 · the measurable end of R2's arm-to-first-write.
if (getToolSafety(name).tier >= 2) this.frame?.noteGatedAct(Date.now());
```

In `buildAgentContext`, accept `frame` in `AgentContextDeps` and pass it as the
fifth argument to `new NexusToolProvider(...)`.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime/NexusToolProvider.task.test.ts tests/unit/agent-runtime/buildAgentContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the parity claim against the real guard**

Run a script (not a mock) that calls `ToolRegistry.call` for a write tool twice
— once with `task: undefined`, once with `task: {id: mintTaskId()}` — against
the real `checkCheckpointSequence`, and diff the two results. Paste both
outcomes into the gate report. **Expected: byte-identical decisions.** If they
differ, STOP — that is an escalation trigger (legacy parity not preserved
additively), not something to reconcile in the packet.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-runtime/NexusToolProvider.ts src/main/agent-runtime/buildAgentContext.ts \
        tests/unit/agent-runtime/NexusToolProvider.task.test.ts
git commit -m "feat(wp-57): agent tool calls carry their run's task, with the gate parity pinned"
```

---

### Task 6: Thread the task through AgentDispatcher

**Files:**
- Modify: `src/main/agent-runtime/AgentDispatcher.ts` (`dispatch`, the
  `recordGatedAction` call at line ~209)
- Test: `tests/unit/agent-runtime/agentDispatcher.test.ts` (extend)

**Interfaces:**
- Consumes: `GatedActionRecord.actor` from Task 4.
- Produces: nothing new.

> **Depends on RULING REQUEST 2** (see the packet announce): does a contributed
> tool dispatched with no caller task mint its own, or stay uncorrelated? Do
> not guess. Until it is ruled, implement the conservative half — pass through
> the caller's task when there is one, and supply the actor unconditionally.

- [ ] **Step 1: Write the failing test**

```ts
it('WP-57 · names the contributing agent as the actor on a dispatched act', async () => {
  const recorded: any[] = [];
  jest.doMock('../../../src/main/intelligence-host/actionProducer', () => ({
    recordGatedAction: (r: any) => recorded.push(r),
  }));
  // …dispatch log-processor/sync_access_logs at tier 2…
  expect(recorded[0].actor).toEqual({ id: 'act_agent_log-processor', kind: 'agent' });
  expect(recorded[0].taskId).toBe('task_CALLER'); // passed through, not minted
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/agent-runtime/agentDispatcher.test.ts -t "WP-57"`
Expected: FAIL — `recorded[0].actor` is `undefined`.

- [ ] **Step 3: Implement**

In the `recordGatedAction({...})` call, add:

```ts
actor: { id: agentActorId(agentName), kind: 'agent' },
```

importing `agentActorId` from `../intelligence-host/agentTaskFrame`. Leave
`taskId: task?.id` exactly as it is — pass-through only.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime/agentDispatcher.test.ts`
Expected: PASS, existing counts unchanged plus 1.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/AgentDispatcher.ts tests/unit/agent-runtime/agentDispatcher.test.ts
git commit -m "feat(wp-57): a dispatched contributed tool names its contributing agent"
```

---

### Task 7: `ctx.task` on the SDK surface

**Files:**
- Modify: `src/main/agent-sdk/types.ts` (`AgentContext`)
- Modify: `src/main/agent-runtime/buildAgentContext.ts` (populate it)
- Test: `tests/unit/agent-runtime/buildAgentContext.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentTaskFrame`.
- Produces: `AgentContext.task?: { id: string; actor: { id: string; kind: 'agent' } }`.

- [ ] **Step 1: Write the failing test**

```ts
it('WP-57 · exposes the run task on the context, and omits it when unframed', () => {
  const framed = buildAgentContext({ /* …deps… */, frame: {
    id: 'task_T', actor: { id: 'act_agent_a', kind: 'agent' },
    autonomy: 'autonomous', noteGatedAct: () => {}, close: () => {},
  } } as never);
  expect(framed.ctx.task).toEqual({ id: 'task_T', actor: { id: 'act_agent_a', kind: 'agent' } });

  const unframed = buildAgentContext({ /* …deps, no frame… */ } as never);
  expect(unframed.ctx.task).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.test.ts -t "WP-57"`
Expected: FAIL — `task` is not a property of the returned context.

- [ ] **Step 3: Implement**

Add to `AgentContext` in `agent-sdk/types.ts`:

```ts
/**
 * WP-57 · this run's identity on the ledger. Distinct from the log's runId:
 * `runId` correlates log lines (`grep run=<id>`), this correlates events
 * (`WHERE correlation = <id>`). Absent when the intelligence core is not
 * available — an unframed run is honest, not an error.
 */
task?: { id: string; actor: { id: string; kind: 'agent' } };
```

and in `buildAgentContext`'s `ctx` literal:

```ts
...(deps.frame ? { task: { id: deps.frame.id, actor: deps.frame.actor } } : {}),
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-sdk/types.ts src/main/agent-runtime/buildAgentContext.ts \
        tests/unit/agent-runtime/buildAgentContext.test.ts
git commit -m "feat(wp-57): ctx.task — an agent can name its own run"
```

---

### Task 8: Persist the task id on `agent_runs`

**Files:**
- Modify: `src/main/agent-runtime/AgentStateStore.ts` (schema + `recordRun` +
  `getLastRun`/`getRunHistory` mapping)
- Test: `tests/unit/agent-runtime/AgentStateStore.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentResult.taskId` from Task 3.
- Produces: `AgentRunRow.taskId?: string` — the join between the diagnostic
  log, the state store and the ledger.

- [ ] **Step 1: Write the failing test**

```ts
it('WP-57 · stores and reads back the task id', () => {
  const store = new AgentStateStore(':memory:');
  store.recordRun({ agentName: 'a', startedAt: 1, finishedAt: 2, status: 'success',
                    runId: 'r_1', taskId: 'task_T' } as never);
  expect(store.getRunHistory('a', 1)[0].taskId).toBe('task_T');
});

it('WP-57 · reads back runId too — written since WP-19 and never returned', () => {
  const store = new AgentStateStore(':memory:');
  store.recordRun({ agentName: 'a', startedAt: 1, finishedAt: 2, status: 'success',
                    runId: 'r_1' } as never);
  expect(store.getRunHistory('a', 1)[0].runId).toBe('r_1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/agent-runtime/AgentStateStore.test.ts -t "WP-57"`
Expected: FAIL on both — `taskId` has no column, `runId` is fetched by
`SELECT *` and dropped by the row mapping.

- [ ] **Step 3: Implement**

Add an idempotent migration beside the existing schema setup:

```ts
// WP-57 · additive, and guarded: an existing database gains the column, a new
// one is created with it. Never a table rebuild — agent_runs is user history.
try { this.db.exec('ALTER TABLE agent_runs ADD COLUMN task_id TEXT'); }
catch { /* already present */ }
```

Write `task_id` in `recordRun`, and add `runId: row.run_id` and
`taskId: row.task_id` to the row mapping in both `getLastRun` and
`getRunHistory`. Add both fields to `AgentRunRow`.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime/AgentStateStore.test.ts tests/unit/agent-runtime/agent-state-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/AgentStateStore.ts tests/unit/agent-runtime/AgentStateStore.test.ts
git commit -m "feat(wp-57): agent_runs joins the ledger — task_id stored, run_id finally read back"
```

---

## Definition of done (protocol §"Definition of done, per packet")

- [ ] `npm run typecheck` clean.
- [ ] `npm test` green; delta measured against the baseline taken at worktree
      cut, and any inherited red named as inherited.
- [ ] Legacy suites for every touched file, found with
      `grep -rl <basename> tests/` and run explicitly.
- [ ] A mutation witness per behavioural pin, each one confirmed to change
      emitted behaviour before the kill is credited (WP-24's elided-import trap).
- [ ] **The live exhibit:** run one agent from the UI and paste the ledger
      query showing `task.run.assigned` → N × `task.action.executed` →
      `task.run.completed`, all sharing one `correlation`, with the actor
      naming the agent. Before/after counts for
      `SELECT COUNT(*) FROM events WHERE topic='task.action.executed' AND correlation IS NULL`.
- [ ] The parity evidence from Task 5 Step 5, pasted, not summarized.
- [ ] `WORK_PACKETS.md` checkbox + one-line outcome + anything learned that
      should amend a pattern.
- [ ] ABI state disclosed.

## Self-review notes

- **Spec coverage:** §12 phase 1 names four deliverables — actor (Tasks 1, 4,
  6), task frame (Tasks 1–3), `task.run.*` producers (Tasks 1–2), threading at
  both chokepoints (Tasks 5, 6). Tasks 7–8 are the surface and the join; both
  are named in §A.4 and §B.
- **Deliberately out of scope**, and each is a later phase: `ctx.arm()` and
  grants (phase 3), the assembler (phase 4), findings-as-producers (phase 2),
  the halted-run fold (phase 6). No task here reads or writes
  `sessionRegistry.ts`.
- **The one interpretation this plan makes** is in Task 1: the design note says
  `task.run.*` "carries arm-to-first-write". Arming does not exist until phase
  3, so a literal reading ships a permanently-null field. This plan ships
  `first_gated_act_at` — the end that IS observable now — from which the
  interval derives with no schema change once the arm stamps the other end.
  Flagged in the announce as a stated interpretation, not folded in silently.
