# Sentinel SDK v1 Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the security sentinel to conform to the Nexus Agent SDK v1 spec — structured log events, typed `AgentResult` return value, `generateObject` for LLM synthesis, state helpers, and manifest — eliminating all markdown file parsing and UI-side regex.

**Architecture:** Three layers change together. The SDK layer (`types.ts`, `AgentRunner`, `AgentStateStore`, `AgentAIClient`) gains the new APIs. The sentinel (`agent.js`) switches to using them. The renderer (`SentinelReviewOverlay`, `AgentConsoleTab`, `parseSentinelReport`) is refactored to consume typed data instead of parsed markdown. Tasks are ordered so each layer can be tested independently before the next.

**Tech Stack:** TypeScript (main), JavaScript (sentinel agent), React class components (`React.createElement`, no JSX), better-sqlite3, Zod for schema validation in `generateObject`.

## Global Constraints

- All TypeScript must compile clean: `npm run compile` exits with no output
- React components: class components, `React.createElement()` only — no JSX, no hooks
- `agent.js` remains CommonJS JavaScript — no TypeScript, no ESM
- `AgentResult` in `types.ts` must remain backward-compatible: existing `agentName`, `startedAt`, `finishedAt`, `status`, `error` fields are kept; new fields are added as optional
- `AgentContext` in `types.ts` must remain backward-compatible: new fields added alongside existing ones
- `AgentStateHandle` in `types.ts` must remain backward-compatible: existing `get/set/delete/scratch` kept; new methods added
- Zod is not yet in `package.json` — do NOT add it. Use a hand-rolled schema validation approach or use the provider's native structured-output tool-use pattern
- No new npm packages without explicit approval
- `parseSentinelReport.ts` is DELETED in Task 7 — nothing may import it after that task
- Commit after every task

---

## File Map

**Modified (main process):**
- `src/main/agent-sdk/types.ts` — add `Finding`, `RemediationPlan`, `RemediationStep`, `AgentResult` domain fields, `AgentLogger` structured methods, `AgentStateHandle` helpers, `AgentContext.log` upgrade
- `src/main/agent-runtime/AgentRunner.ts` — intercept structured log events, pass domain result through
- `src/main/agent-runtime/AgentStateStore.ts` — add `isCoolingDown`, `setCooldown`, `buildTable`
- `src/main/agent-runtime/AgentAIClient.ts` — add `generateObject` via tool-use pattern
- `src/main/ipc-handlers.ts` — `AGENT_RUN_COMPLETE` payload gains `findings` and `plan`

**Modified (sentinel agent):**
- `agents/security-sentinel/agent.js` — use SDK APIs throughout; return typed `AgentResult`
- `agents/security-sentinel/nexus.agent.yaml` — new file: manifest with permissions + UI contract

**Modified (renderer):**
- `src/renderer/components/agents/SentinelReviewOverlay.tsx` — accept `RemediationPlan` prop instead of reading `.md` file
- `src/renderer/components/agents/AgentConsoleTab.tsx` — remove `generateCommands()`, drive from `plan.steps`; remove `openSentinelReview` file parsing
- `src/renderer/components/NexusOverview.tsx` — pass `plan` from `AGENT_RUN_COMPLETE` payload into overlay

**Deleted:**
- `src/renderer/utils/parseSentinelReport.ts`

---

### Task 1: SDK types — domain output types + structured logger interface

**Files:**
- Modify: `src/main/agent-sdk/types.ts`
- Test: `tests/unit/agent-sdk/types.test.ts` (new)

**Interfaces:**
- Produces: `Finding`, `RemediationStep`, `RemediationPlan`, updated `AgentResult`, updated `AgentLogger`, updated `AgentStateHandle`, updated `AgentContext` — consumed by Tasks 2, 3, 4, 5, 6, 7

- [ ] **Step 1: Write the type test**

```typescript
// tests/unit/agent-sdk/types.test.ts
import type { Finding, RemediationPlan, AgentResult, AgentLogger, AgentStateHandle } from '../../../src/main/agent-sdk/types';

describe('SDK type shapes', () => {
  it('Finding has required fields', () => {
    const f: Finding = { id: 'ABS-01', severity: 'high', title: 'Default admin exists' };
    expect(f.id).toBe('ABS-01');
    expect(f.severity).toBe('high');
  });

  it('RemediationPlan has steps array', () => {
    const p: RemediationPlan = {
      site: 'theawfulpmtest', verified: true, verdict: 'ready', steps: [],
    };
    expect(p.steps).toEqual([]);
  });

  it('AgentResult domain fields are optional', () => {
    // existing shape still works
    const r: AgentResult = {
      agentName: 'security-sentinel', startedAt: 0, finishedAt: 1,
      status: 'success',
    };
    expect(r.findings).toBeUndefined();
    expect(r.plan).toBeUndefined();
  });
});
```

Run: `npm test -- --testPathPattern=types.test --no-coverage 2>&1 | tail -5`
Expected: FAIL (types don't exist yet)

- [ ] **Step 2: Add domain types to `src/main/agent-sdk/types.ts`**

Append after the existing `AgentResult` interface (line 93 of the current file):

```typescript
// ─── Domain output types ──────────────────────────────────────────────────────

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category?: 'active-compromise' | 'pre-breach' | 'misconfiguration' | 'informational';
  title: string;
  description?: string;
  site?: string;
  evidence?: Record<string, unknown>;
  remediated?: boolean;
}

export interface RemediationStep {
  id: string;
  label: string;
  command: string;
  description?: string;
  tier: 1 | 2 | 3;
  requiresApproval: boolean;
  verificationResult?: 'ok' | 'failed' | 'skipped';
  verificationOutput?: string;
}

export interface RemediationPlan {
  site: string;
  sandbox?: string;
  verified: boolean;
  verdict: 'ready' | 'blocked';
  summary?: string;
  steps: RemediationStep[];
}

export interface AgentAction {
  label: string;
  command?: string;
  site?: string;
  result?: 'ok' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}
```

- [ ] **Step 3: Extend `AgentResult` with optional domain fields**

Replace the current `AgentResult` interface (keep existing fields, add new optional ones):

```typescript
export interface AgentResult {
  agentName: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  // Domain output — populated by agents that conform to SDK v1
  verdict?: 'clean' | 'findings' | 'escalated' | 'plan_ready' | 'error';
  findings?: Finding[];
  plan?: RemediationPlan;
  sites?: Record<string, { status: string; findings: Finding[]; plan?: RemediationPlan }>;
}
```

- [ ] **Step 4: Extend `AgentLogger` with structured event methods**

Replace the current `AgentLogger` interface:

```typescript
export interface AgentLogger {
  // Freeform — existing, keep
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  // Structured events — new
  finding(finding: Finding): void;
  action(action: AgentAction): void;
  phase(name: string, description?: string): void;
  siteStatus(site: string, status: 'running' | 'clean' | 'findings' | 'escalated' | 'error'): void;
}
```

- [ ] **Step 5: Extend `AgentStateHandle` with cooldown helpers**

Replace the current `AgentStateHandle` interface:

```typescript
export interface AgentStateHandle {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  scratch: Record<string, unknown>;
  // Cooldown helpers — new
  isCoolingDown(key: string, durationMs: number): boolean;
  setCooldown(key: string): void;
}
```

- [ ] **Step 6: Extend `AgentContext` with `generateObject` on `ai`**

Add `generateObject` to the `AIClient` interface:

```typescript
export interface AIClient {
  run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string>;
  generateObject<T>(opts: {
    prompt: string;
    system?: string;
    schema: Record<string, unknown>;  // JSON Schema object describing T
    schemaName?: string;
  }): Promise<T>;
}
```

- [ ] **Step 7: Run tests**

```bash
npm test -- --testPathPattern=types.test --no-coverage 2>&1 | tail -5
npm run compile 2>&1 | head -5
```

Expected: types test PASS (3/3), compile clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/agent-sdk/types.ts tests/unit/agent-sdk/types.test.ts
git commit -m "feat(sdk): add Finding, RemediationPlan, structured AgentLogger, cooldown helpers to types"
```

---

### Task 2: AgentRunner — intercept structured log events, pass domain result

**Files:**
- Modify: `src/main/agent-runtime/AgentRunner.ts`
- Test: `tests/unit/agent-runtime/AgentRunner.sdk.test.ts` (new)

**Interfaces:**
- Consumes: `Finding`, `AgentAction`, `RemediationPlan`, `AgentLogger` (Task 1)
- Produces: `AgentRunner.run()` now returns `AgentResult` with populated `findings`, `plan`, `sites` when agent uses structured log events

The runner wraps `agentLog` so that calls to `log.finding()`, `log.action()`, `log.phase()`, `log.siteStatus()` are intercepted and accumulated. After `agent.run(ctx)` resolves, the accumulated data is merged into the returned `AgentResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent-runtime/AgentRunner.sdk.test.ts
import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import type { AgentDefinition } from '../../../src/main/agent-sdk/types';

function makeMinimalRunner(): AgentRunner {
  const mockRegistry = {} as any;
  const mockStateStore = {
    buildHandle: () => ({
      get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
      isCoolingDown: () => false, setCooldown: () => {},
    }),
    recordRun: () => {},
    getLastRun: () => undefined,
  } as any;
  const mockServices = {} as any;
  const mockProvider = { provider: 'anthropic', apiKey: 'test', model: 'claude-sonnet-5', useLocalGateway: false } as any;
  return new AgentRunner(mockStateStore, mockRegistry, mockServices, mockProvider);
}

describe('AgentRunner structured log events', () => {
  it('accumulates log.finding() calls into AgentResult.findings', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0',
      triggers: [],
      run: async ({ log }) => {
        log.finding({ id: 'ABS-01', severity: 'high', title: 'Test finding', site: 'mysite' });
        log.finding({ id: 'ABS-02', severity: 'critical', title: 'Critical finding', site: 'mysite' });
      },
    };
    const result = await runner.run(agent);
    expect(result.findings).toHaveLength(2);
    expect(result.findings![0].id).toBe('ABS-01');
    expect(result.findings![1].severity).toBe('critical');
  });

  it('accumulates log.siteStatus() into AgentResult.sites', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0', triggers: [],
      run: async ({ log }) => {
        log.siteStatus('site-a', 'clean');
        log.siteStatus('site-b', 'findings');
      },
    };
    const result = await runner.run(agent);
    expect(result.sites?.['site-a']?.status).toBe('clean');
    expect(result.sites?.['site-b']?.status).toBe('findings');
  });

  it('carries agent return value into AgentResult', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0', triggers: [],
      run: async () => ({
        verdict: 'plan_ready' as const,
        sites: {},
        findings: [],
        plan: { site: 'mysite', verified: true, verdict: 'ready' as const, steps: [] },
      }),
    };
    const result = await runner.run(agent);
    expect(result.verdict).toBe('plan_ready');
    expect(result.plan?.site).toBe('mysite');
  });
});
```

Run: `npm test -- --testPathPattern=AgentRunner.sdk --no-coverage 2>&1 | tail -8`
Expected: FAIL — `log.finding is not a function`

- [ ] **Step 2: Update `AgentRunner.ts` to intercept structured events and merge return value**

Find the `agentLog` construction block in `AgentRunner.ts` (around lines 90-110). Replace the `agentLog` object and `agent.run(ctx)` call:

```typescript
// Accumulators for structured log events
const accFindings: import('../agent-sdk/types').Finding[] = [];
const accActions:  import('../agent-sdk/types').AgentAction[] = [];
const accSites:    Record<string, { status: string; findings: import('../agent-sdk/types').Finding[] }> = {};

const agentLog: AgentLogger = {
  info:  (msg: string) => { appLog.info(msg);  appendLog('INFO',  msg); },
  warn:  (msg: string) => { appLog.warn(msg);  appendLog('WARN',  msg); },
  error: (msg: string) => { appLog.error(msg); appendLog('ERROR', msg); },
  debug: (msg: string) => { appLog.debug(msg); appendLog('DEBUG', msg); },
  finding: (f) => {
    accFindings.push(f);
    const sev = f.severity === 'critical' || f.severity === 'high' ? 'WARN' : 'INFO';
    appendLog(sev, `[${f.severity.toUpperCase()}] ${f.id}: ${f.title}${f.site ? ` (${f.site})` : ''}`);
  },
  action: (a) => {
    accActions.push(a);
    appendLog(a.result === 'failed' ? 'WARN' : 'INFO',
      `[action] ${a.label}${a.result ? ` — ${a.result}` : ''}${a.durationMs ? ` (${a.durationMs}ms)` : ''}`);
  },
  phase: (name, description) => {
    appendLog('INFO', `[phase] ${name}${description ? ': ' + description : ''}`);
  },
  siteStatus: (site, status) => {
    if (!accSites[site]) accSites[site] = { status, findings: [] };
    else accSites[site].status = status;
    const icon = status === 'clean' ? '✓' : status === 'escalated' ? '↑' : status === 'error' ? '✗' : '→';
    appendLog('INFO', `security-sentinel: ${site} — ${icon} ${status}`);
  },
};
```

Then update the `run()` call to capture the agent's return value:

```typescript
// Replace: await agent.run(ctx) with:
const agentReturnValue = await agent.run(ctx) as import('../agent-sdk/types').AgentResult | void | undefined;
```

And merge the accumulated data into the final `AgentResult`. Find where the result object is constructed (after the try/catch) and add:

```typescript
// After building the base result object, merge structured log data:
if (accFindings.length > 0) result.findings = accFindings;
if (Object.keys(accSites).length > 0) {
  result.sites = Object.fromEntries(
    Object.entries(accSites).map(([k, v]) => [k, { ...v, findings: accFindings.filter(f => f.site === k) }])
  );
}
// If the agent returned a typed AgentResult, merge its domain fields
if (agentReturnValue && typeof agentReturnValue === 'object') {
  const rv = agentReturnValue as import('../agent-sdk/types').AgentResult;
  if (rv.verdict)   result.verdict  = rv.verdict;
  if (rv.findings)  result.findings = rv.findings;
  if (rv.plan)      result.plan     = rv.plan;
  if (rv.sites)     result.sites    = rv.sites;
}
```

- [ ] **Step 3: Update `AgentStateStore.buildHandle` to include cooldown helpers**

In `AgentStateStore.ts`, update `buildHandle`:

```typescript
buildHandle(agentName: string): AgentStateHandle {
  const store = this;
  return {
    get: <T>(key: string) => store.get<T>(agentName, key),
    set: (key: string, value: unknown) => store.set(agentName, key, value),
    delete: (key: string) => store.delete(agentName, key),
    scratch: {},
    isCoolingDown(key: string, durationMs: number): boolean {
      const last = store.get<number>(agentName, key);
      if (!last) return false;
      return Date.now() - last < durationMs;
    },
    setCooldown(key: string): void {
      store.set(agentName, key, Date.now());
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern=AgentRunner.sdk --no-coverage 2>&1 | tail -8
npm run compile 2>&1 | head -5
```

Expected: 3/3 PASS, compile clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/AgentRunner.ts src/main/agent-runtime/AgentStateStore.ts \
        tests/unit/agent-runtime/AgentRunner.sdk.test.ts
git commit -m "feat(sdk): AgentRunner intercepts structured log events, merges typed AgentResult"
```

---

### Task 3: `AgentAIClient.generateObject()` — structured output via tool-use

**Files:**
- Modify: `src/main/agent-runtime/AgentAIClient.ts`
- Test: `tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts` (new)

**Interfaces:**
- Consumes: `AIClient.generateObject` signature (Task 1)
- Produces: `agentAIClient.generateObject(opts)` → typed T; consumed by sentinel Task 5

The implementation uses the provider's existing tool-use capability: define a single tool whose schema matches the desired output, instruct the model to call it, extract the arguments. No Zod dependency.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts
import { AgentAIClient } from '../../../src/main/agent-runtime/AgentAIClient';

function makeClient(mockResponse: string): AgentAIClient {
  const mockProvider = {
    streamChat: jest.fn().mockImplementation(async function*(messages, tools) {
      // Simulate the model calling our output tool
      yield { type: 'tool_call', name: '__output__', id: 'c1', arguments: { result: JSON.parse(mockResponse) } };
    }),
  } as any;
  const mockToolProvider = {
    getProviderToolDefinitions: () => [],
    invoke: jest.fn(),
  } as any;
  return new AgentAIClient(mockProvider, { model: 'claude-sonnet-5', apiKey: 'test' } as any, mockToolProvider);
}

describe('AgentAIClient.generateObject', () => {
  it('returns parsed object from model tool call', async () => {
    const client = makeClient(JSON.stringify({ verdict: 'ready', steps: [] }));
    const result = await client.generateObject<{ verdict: string; steps: unknown[] }>({
      prompt: 'Analyze this site',
      schema: {
        type: 'object',
        properties: { verdict: { type: 'string' }, steps: { type: 'array', items: {} } },
        required: ['verdict', 'steps'],
      },
    });
    expect(result.verdict).toBe('ready');
    expect(result.steps).toEqual([]);
  });

  it('throws if model does not call the output tool', async () => {
    const mockProvider = {
      streamChat: jest.fn().mockImplementation(async function*() {
        yield { type: 'text', content: 'I cannot help with that' };
      }),
    } as any;
    const client = new AgentAIClient(mockProvider, { model: 'claude-sonnet-5', apiKey: 'test' } as any, { getProviderToolDefinitions: () => [], invoke: jest.fn() } as any);
    await expect(client.generateObject({ prompt: 'test', schema: { type: 'object', properties: {}, required: [] } }))
      .rejects.toThrow('generateObject: model did not call __output__ tool');
  });
});
```

Run: `npm test -- --testPathPattern=generateObject --no-coverage 2>&1 | tail -8`
Expected: FAIL — `generateObject is not a function`

- [ ] **Step 2: Implement `generateObject` in `AgentAIClient.ts`**

Add this method to the `AgentAIClient` class:

```typescript
async generateObject<T>(opts: {
  prompt: string;
  system?: string;
  schema: Record<string, unknown>;
  schemaName?: string;
}): Promise<T> {
  const { prompt, system, schema, schemaName = 'output' } = opts;

  // Inject a synthetic tool whose schema IS the desired output.
  // Instruct the model to call it — the arguments become our typed result.
  const outputTool: ProviderToolDefinition = {
    name: '__output__',
    description: `Call this tool with the structured result. Schema name: ${schemaName}`,
    inputSchema: schema as any,
  };

  const systemMsg = system
    ? `${system}\n\nYou MUST call the __output__ tool with your response. Do not reply in plain text.`
    : 'You MUST call the __output__ tool with your response. Do not reply in plain text.';

  const messages: ChatMessage[] = [
    { role: 'user', content: `${systemMsg}\n\n${prompt}` },
  ];

  const tools = [outputTool, ...this.toolProvider.getProviderToolDefinitions()];
  const signal = new AbortController().signal;

  for (let turn = 0; turn < 5; turn++) {
    const response = await collectStream(this.provider.streamChat(messages, tools, this.config, signal));

    const outputCall = response.toolCalls.find(c => c.name === '__output__');
    if (outputCall) {
      // Arguments is the structured object the model produced
      const raw = outputCall.arguments;
      // The provider may nest under a 'result' key depending on schema shape
      return (raw?.result ?? raw) as T;
    }

    if (response.toolCalls.length === 0) {
      throw new Error('generateObject: model did not call __output__ tool');
    }

    // Handle non-output tool calls normally (e.g. fleet_sql during analysis)
    messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
    for (const call of response.toolCalls) {
      const result = await this.toolProvider.invoke(call.name, call.arguments);
      messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: call.id });
    }
  }

  throw new Error('generateObject: model did not call __output__ tool after 5 turns');
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern=generateObject --no-coverage 2>&1 | tail -8
npm run compile 2>&1 | head -5
```

Expected: 2/2 PASS, compile clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-runtime/AgentAIClient.ts \
        tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts
git commit -m "feat(sdk): AgentAIClient.generateObject() via tool-use pattern — no Zod dependency"
```

---

### Task 4: IPC — `AGENT_RUN_COMPLETE` carries `findings` and `plan`

**Files:**
- Modify: `src/main/ipc-handlers.ts` (the `AGENT_RUN_COMPLETE` broadcast call)
- Modify: `src/renderer/components/NexusOverview.tsx` (runCompleteHandler reads new fields)

**Interfaces:**
- Consumes: `AgentResult.findings`, `AgentResult.plan` (Task 1 + Task 2)
- Produces: `AGENT_RUN_COMPLETE` payload gains `findings?: Finding[]`, `plan?: RemediationPlan`, `agentId`, `siteNames`; consumed by Tasks 6 and 7

- [ ] **Step 1: Update the broadcast in `src/main/ipc-handlers.ts`**

Find the `broadcast(IPC_CHANNELS.AGENT_RUN_COMPLETE, ...)` call inside the `AGENT_RUN_NOW` handler IIFE. Replace:

```typescript
// BEFORE:
broadcast(IPC_CHANNELS.AGENT_RUN_COMPLETE, {
  runId,
  doneCount: outcomes.doneCount,
  failedCount: outcomes.failedCount,
  findingsSites: outcomes.findingsSites,
});

// AFTER — also carry the typed domain result:
broadcast(IPC_CHANNELS.AGENT_RUN_COMPLETE, {
  runId,
  agentId,
  siteNames,
  doneCount: outcomes.doneCount,
  failedCount: outcomes.failedCount,
  findingsSites: outcomes.findingsSites,
  // Domain result from agentRunner (populated after Task 2 lands)
  findings: (runResult as any)?.findings,
  plan:     (runResult as any)?.plan,
});
```

Where `runResult` is the value returned from `await runner.run(agent, scopedEvent)`. Capture it:

```typescript
// Replace: await runner.run(agent, scopedEvent);
// With:
const runResult = await runner.run(agent, scopedEvent);
```

- [ ] **Step 2: Update `NexusOverview.runCompleteHandler` to pass `plan` when creating activity event**

In `src/renderer/components/NexusOverview.tsx`, the `runCompleteHandler` lambda already creates an activity event. Update it to also store the plan:

```typescript
this.runCompleteHandler = (_: any, payload: any) => {
  runStore.completeRun(payload);
  if (!payload.cancelled) {
    // ... existing activity event creation code ...
    // After creating the event, also store the plan for the overlay
    if (payload.plan) {
      (this as any)._lastPlan = payload.plan;
      (this as any)._lastPlanSite = payload.plan.site;
    }
    // ...
  }
  // ...
};
```

Also, expose a method on NexusOverview to retrieve the latest plan (used by AgentConsoleTab in Task 7):

```typescript
getLatestPlan(): { site: string; plan: import('./agents/AgentStore').RemediationPlan } | null {
  const plan = (this as any)._lastPlan;
  const site = (this as any)._lastPlanSite;
  return plan ? { site, plan } : null;
}
```

- [ ] **Step 3: Compile**

```bash
npm run compile 2>&1 | head -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts src/renderer/components/NexusOverview.tsx
git commit -m "feat(sdk): AGENT_RUN_COMPLETE payload carries findings and plan from AgentResult"
```

---

### Task 5: Sentinel agent — use SDK APIs, return typed AgentResult

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Create: `agents/security-sentinel/nexus.agent.yaml`
- Test: run sentinel manually and check log output

**Interfaces:**
- Consumes: `log.finding()`, `log.siteStatus()`, `log.phase()`, `log.action()`, `state.isCoolingDown()`, `state.setCooldown()`, `ai.generateObject()` (Tasks 1–3)
- Produces: sentinel `run()` returns `{ verdict, findings, plan, sites }` instead of `void`

This is the largest task — ~100 line changes across `agent.js`. Work function by function.

- [ ] **Step 1: Replace `log.warn` finding emissions with `log.finding()`**

In the main `run()` loop (around lines 220-232), replace:

```javascript
// BEFORE:
log.warn(`security-sentinel: ${install.name} — ESCALATING to Tier 2 ...`);
signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));

// AFTER:
log.siteStatus(install.name, 'escalated');
log.phase('Tier 2', `Deep investigation: ${install.name}`);
signals.forEach(s => log.finding({
  id: s.id, severity: s.severity, title: s.title,
  description: s.detail, site: install.name,
  category: s.category,
}));
```

And for non-escalating findings (lines 230-231):

```javascript
// BEFORE:
log.warn(`security-sentinel: ${install.name} — ${signals.length} finding(s):`);
signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));

// AFTER:
log.siteStatus(install.name, 'findings');
signals.forEach(s => log.finding({ id: s.id, severity: s.severity, title: s.title, site: install.name }));
```

And for clean sites (line 224):

```javascript
// BEFORE:
log.info(`security-sentinel: ${install.name} — ✓ clean`);

// AFTER:
log.info(`security-sentinel: ${install.name} — ✓ clean`);
log.siteStatus(install.name, 'clean');
```

- [ ] **Step 2: Replace cooldown management with SDK helpers**

In `tier2Investigate` (around lines 521-527):

```javascript
// BEFORE:
const lastEscalation = state.get(`tier2-last:${install.id}`);
const hoursAgo = lastEscalation ? (Date.now() - lastEscalation) / 3_600_000 : Infinity;
if (hoursAgo < 24) {
  log.info(`[Tier 2] Skipping ${install.name} — escalated ${hoursAgo.toFixed(1)}h ago (cooldown: 24h)`);
  return;
}
state.set(`tier2-last:${install.id}`, Date.now());

// AFTER:
if (state.isCoolingDown(`tier2:${install.id}`, 24 * 60 * 60 * 1000)) {
  const lastMs = state.get(`tier2:${install.id}`);
  const hoursAgo = lastMs ? ((Date.now() - lastMs) / 3_600_000).toFixed(1) : '?';
  log.info(`[Tier 2] Skipping ${install.name} — escalated ${hoursAgo}h ago (cooldown: 24h)`);
  return null;
}
state.setCooldown(`tier2:${install.id}`);
```

Note: `tier2Investigate` return type changes from `void` to `RemediationPlan | null` — add `return null;` at all early-exit points.

- [ ] **Step 3: Replace `llmSynthesis` freeform text with `ai.generateObject()`**

Replace the `llmSynthesis` function. Instead of calling `ai.run(prompt)` and parsing the result with string methods, use `ai.generateObject`:

```javascript
async function llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName) {
  const allSignals = [...tier1Signals, ...fsSignals];

  const schema = {
    type: 'object',
    properties: {
      classification: {
        type: 'string',
        enum: ['active-compromise', 'high-risk', 'misconfiguration', 'false-positive'],
      },
      summary: { type: 'string', description: 'Two-sentence summary of the situation' },
      escalateToTier3: { type: 'boolean', description: 'Whether to apply the remediation plan to production' },
    },
    required: ['classification', 'summary', 'escalateToTier3'],
  };

  const systemPrompt = `You are a WordPress security analyst completing an investigation of a WP Engine production site.
Site: ${install.name} (${install.environment}, ${install.postCount} posts)
Sandbox: ${sandboxName}`;

  const userPrompt = `Security signals found:
${allSignals.map(s => `[${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`).join('\n')}

Signal details:
${allSignals.map(s => `${s.id}: ${s.detail || '(no detail)'}`).join('\n\n')}

Classify the situation and decide if the remediation plan should be applied to production.`;

  log.info(`[Tier 2] Calling LLM synthesis...`);
  let synthesis = { classification: 'active-compromise', summary: '(synthesis unavailable)', escalateToTier3: true };

  try {
    synthesis = await ai.generateObject({ prompt: userPrompt, system: systemPrompt, schema, schemaName: 'SentinelSynthesis' });
    log.warn(`[Tier 2 Synthesis] ${install.name}: ${synthesis.classification} — ${synthesis.summary}`);
  } catch (err) {
    log.warn(`[Tier 2 Synthesis] LLM call failed for ${install.name}: ${err.message} — defaulting to escalate`);
  }

  if (synthesis.escalateToTier3 || allSignals.some(s => s.severity === 'critical')) {
    log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
    const plan = await tier3Remediate(install, synthesis.summary, allSignals, sandboxName, tools, log);
    return plan;
  }

  return null;
}
```

- [ ] **Step 4: Update `tier3Remediate` to return `RemediationPlan`**

`tier3Remediate` currently writes a markdown file and returns `void`. Update it to return a typed `RemediationPlan`:

```javascript
async function tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log) {
  // ... existing checklist execution code (keep intact) ...
  // At the end, instead of writing the markdown file, return the plan:

  const steps = checklist.map((item, i) => ({
    id: `step-${item.step ?? i + 1}`,
    label: item.action,
    command: item.action,  // display label — actual execution uses toolArgs
    tier: 3,
    requiresApproval: true,
    verificationResult: checklistResults[i]?.ok ? 'ok' : 'failed',
    verificationOutput: checklistResults[i]?.output ?? '',
  }));

  const allPassed = steps.every(s => s.verificationResult !== 'failed');

  log.action({
    label: `Remediation prepared in sandbox: ${sandboxName}`,
    site: install.name,
    result: allPassed ? 'ok' : 'failed',
  });

  // Keep the markdown report write for backward compat during transition
  // (Task 7 removes parseSentinelReport — keep the file write until then)

  return {
    site: install.name,
    sandbox: sandboxName,
    verified: allPassed,
    verdict: allPassed ? 'ready' : 'blocked',
    summary: synthesis,
    steps,
  };
}
```

- [ ] **Step 5: Update main `run()` to return typed `AgentResult`**

The sentinel's `run()` currently returns `Promise<void>`. Change it to return `Promise<{ verdict, findings, plan, sites }>`:

```javascript
async run({ event, tools, ai, log, state }) {
  // ... existing code ...

  const allFindings = [];
  let latestPlan = null;

  for (const install of installs) {
    // ... existing per-install loop ...
    // Collect findings:
    for (const sig of signals) {
      allFindings.push({ id: sig.id, severity: sig.severity, title: sig.title, site: install.name, category: sig.category });
    }
    if (criticalCount >= 1 || compromiseHighCount >= 2) {
      const plan = await tier2Investigate(install, signals, tools, ai, log, state);
      if (plan) latestPlan = plan;
    }
  }

  log.info('security-sentinel: sweep complete');

  const verdict = latestPlan ? 'plan_ready'
    : allFindings.length > 0 ? 'findings'
    : 'clean';

  return { verdict, findings: allFindings, plan: latestPlan ?? undefined, sites: {} };
},
```

- [ ] **Step 6: Create `agents/security-sentinel/nexus.agent.yaml`**

```yaml
name: security-sentinel
version: 1.0.0
description: Fleet-wide security surveillance — detects compromise and pre-breach exposure across all WPE installs
author:
  name: WP Engine
  verified: true

triggers:
  - type: event
    pattern: wpe:sync.completed
  - type: cron
    expression: "*/15 * * * *"

tools:
  - fleet_sql
  - wpe_site_deep_refresh
  - local_create_site
  - local_wpe_pull
  - local_operation_status
  - wp_eval
  - local_wpe_push

permissions:
  tier: 3
  scope: fleet

runtime:
  - local

ui:
  autonomy_description: "Investigates on its own • you approve anything on production"
  kpis:
    - label: Sites monitored
      query: "SELECT COUNT(*) FROM sites WHERE source='wpe'"
      color: default
    - label: Active threats
      query: "SELECT COUNT(DISTINCT site_id) FROM agent_security_sentinel_findings WHERE severity IN ('critical','high') AND resolved=0"
      color: red
```

- [ ] **Step 7: Test manually**

```bash
npm run build 2>&1 | tail -3
npm run compile 2>&1 | head -5
```

Then rebuild Local and trigger a sentinel run via the UI against one site. Verify in the RunDrawer that:
- Log shows `[phase] Tier 2: ...` lines instead of raw `[Tier 2] ...` strings
- Findings appear in the SITES section with proper icons
- "sweep complete" appears at the end

- [ ] **Step 8: Commit**

```bash
git add agents/security-sentinel/agent.js agents/security-sentinel/nexus.agent.yaml
git commit -m "feat(sentinel): use SDK structured log events, typed AgentResult, generateObject for synthesis, cooldown helpers"
```

---

### Task 6: KPI rendering from manifest — AgentWorkspace Overview tab

**Files:**
- Modify: `src/renderer/components/agents/AgentWorkspace.tsx`
- Modify: `src/renderer/components/agents/AgentConsoleTab.tsx` (refresh KPIs via fleet_sql IPC)

**Interfaces:**
- Consumes: `nexus.agent.yaml` `ui.kpis` array (Task 5) — read from the agent's registered definition
- Produces: AgentWorkspace.renderOverviewTab() runs KPI queries and renders real numbers

The agent registry loads agent definitions from disk. The agent's `kpis` array in `nexus.agent.yaml` is parsed by the registry. We need to expose it via the `agentStatus` GraphQL query OR via a new IPC call.

Simpler approach: load the manifest directly from disk in the renderer using the known agent directory path, run the KPI `fleet_sql` queries via the existing `FLEET_SQL` IPC channel.

- [ ] **Step 1: Add `FLEET_SQL_QUERY` IPC channel for ad-hoc queries**

In `src/common/constants.ts`, add:
```typescript
FLEET_SQL_QUERY: `${ADDON_PREFIX}:fleet-sql-query`,
```

In `src/main/ipc-handlers.ts`, add the handler near the existing fleet_sql MCP tool:
```typescript
safeHandle(IPC_CHANNELS.FLEET_SQL_QUERY, async (_event, { query }: { query: string }) => {
  try {
    const db = deps.nexusServices?.graphDb;
    if (!db) return { error: 'Graph DB not available' };
    const rows = db.prepare(query).all();
    return { rows };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

- [ ] **Step 2: Update `AgentWorkspace.renderOverviewTab` to load and display KPIs**

Replace the current sparse overview tab with one that reads KPIs from the agent definition (passed via agentStore statuses) and runs the queries:

```typescript
interface KpiState {
  label: string;
  value: string | null;
  color: string;
  loading: boolean;
}

// Add to WorkspaceState:
// kpis: KpiState[];
// kpisLoaded: boolean;

// In componentDidMount, load KPIs:
private async loadKpis() {
  const { agentId } = this.props;
  const status = agentStore.getState().statuses.find(s =>
    s.name.toLowerCase().replace(/\s+/g, '-') === agentId
  );
  const kpiDefs = (status as any)?.kpis ?? [];
  if (kpiDefs.length === 0) return;

  this.setState({ kpisLoaded: false });
  const kpis: KpiState[] = await Promise.all(kpiDefs.map(async (kpi: any) => {
    try {
      const res = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.FLEET_SQL_QUERY, { query: kpi.query }
      );
      const value = res?.rows?.[0] ? String(Object.values(res.rows[0])[0]) : '—';
      const colorMap: Record<string, string> = {
        red: 'var(--ag-red)', green: 'var(--ag-green)', amber: 'var(--ag-amber)',
        default: 'var(--ag-text-primary)',
      };
      return { label: kpi.label, value, color: colorMap[kpi.color ?? 'default'], loading: false };
    } catch {
      return { label: kpi.label, value: '—', color: 'var(--ag-text-muted)', loading: false };
    }
  }));
  this.setState({ kpis, kpisLoaded: true });
}
```

In `renderOverviewTab`:
```typescript
private renderOverviewTab() {
  const { kpis, kpisLoaded } = this.state;
  const pendingCount = agentStore.getState().activityEvents.filter(
    e => e.agentId === this.props.agentId && e.status === 'review'
  ).length;

  return React.createElement('div', null,
    // KPI grid (only when loaded and non-empty)
    kpisLoaded && kpis.length > 0 && React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`, gap: 12, marginBottom: 24 },
    },
      ...kpis.map(kpi => React.createElement('div', {
        key: kpi.label,
        style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, padding: '16px 18px' },
      },
        React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, kpi.label),
        React.createElement('div', { style: { fontSize: 32, fontWeight: 600, color: kpi.color } }, kpi.value ?? '—'),
      )),
    ),
    // Needs review
    React.createElement('div', { style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 12 } }, 'Needs your review'),
    pendingCount > 0
      ? React.createElement('button', {
          onClick: () => this.setState({ activeTab: 'approvals' }),
          style: { background: 'none', border: 'none', color: 'var(--ag-amber)', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
        }, `${pendingCount} item${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} review — go to Approvals`)
      : React.createElement('div', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } }, 'No pending approvals.'),
  );
}
```

- [ ] **Step 3: Compile**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts src/renderer/components/agents/AgentWorkspace.tsx
git commit -m "feat(sdk): KPI queries from manifest render in agent Overview tab"
```

---

### Task 7: Remove `parseSentinelReport`, refactor `SentinelReviewOverlay` to use typed plan

**Files:**
- Delete: `src/renderer/utils/parseSentinelReport.ts`
- Modify: `src/renderer/components/agents/SentinelReviewOverlay.tsx`
- Modify: `src/renderer/components/agents/AgentConsoleTab.tsx`
- Modify: `src/renderer/components/agents/SentinelTypes.ts` (or inline types)

**Interfaces:**
- Consumes: `RemediationPlan` from `agentStore` / IPC payload (Tasks 1, 4)
- Produces: `SentinelReviewOverlay` receives `plan: RemediationPlan` prop; `AgentConsoleTab.generateCommands()` reads `plan.steps`; `openSentinelReview` no longer reads files

**Note:** Before this task, verify `parseSentinelReport` has zero non-test importers:
```bash
grep -r "parseSentinelReport\|findLatestReport" src/ --include="*.ts" --include="*.tsx" | grep -v test
```
Expected: only `AgentConsoleTab.tsx`. If others exist, update them first.

- [ ] **Step 1: Verify no remaining file importers**

```bash
grep -r "parseSentinelReport\|findLatestReport" src/ --include="*.ts" --include="*.tsx"
```

Expected: `AgentConsoleTab.tsx` only (the importer we're replacing in this task).

- [ ] **Step 2: Update `SentinelReviewOverlay` props to accept `RemediationPlan`**

`SentinelReviewOverlay` currently reads from a `SentinelCase` (parsed from `.md` files). Change its interface to accept `RemediationPlan` directly. The overlay already renders findings, steps, and accounts — map from the typed plan:

Replace `SentinelReviewOverlay`'s `sentinelCase: SentinelCase` prop with:
```typescript
interface SentinelReviewOverlayProps {
  plan: RemediationPlan;   // typed plan from AgentResult
  onDismiss: () => void;
  onExecute: (decisions: AccountDecisionMap) => void;
}
```

Map `plan.steps` → display steps (each step maps `verificationResult` to `ok`/`failed` icon).  
Map findings from the surrounding `AgentResult.findings` (pass as separate prop):
```typescript
interface SentinelReviewOverlayProps {
  plan: RemediationPlan;
  findings: Finding[];
  onDismiss: () => void;
  onExecute: (decisions: AccountDecisionMap) => void;
}
```

The account cards come from findings that have `id === 'LLM-USER-01'` or `id === 'ABS-01'/'ABS-02'` — extract from `findings` prop.

- [ ] **Step 3: Update `AgentConsoleTab.openSentinelReview` — read from store, not files**

Replace the file-reading implementation with a store lookup:

```typescript
private openSentinelReview(eventId: string) {
  // Find the plan from the activity event or latest runStore state
  const event = agentStore.getState().activityEvents.find(e => e.id === eventId);

  // Plan is stored on NexusOverview when AGENT_RUN_COMPLETE fires
  // Access it via a ref we store on the electron global (set in NexusOverview)
  const planData = (window as any).__nexusSentinelPlan;
  if (planData) {
    this.setState({
      activeSentinelCase: planData.plan,
      activeFindings: planData.findings,
    });
    return;
  }

  // Fallback: read the most recent report file (deprecated path, remove after full rollout)
  // ... existing mtime-sorted file reading code as fallback ...
}
```

Also update `AgentConsoleTabState` to add `activeFindings: Finding[]`.

- [ ] **Step 4: Update `NexusOverview.runCompleteHandler` to expose plan globally**

In `NexusOverview.tsx`, after storing `_lastPlan`, also expose it for `AgentConsoleTab`:

```typescript
if (payload.plan || payload.findings) {
  (window as any).__nexusSentinelPlan = {
    plan:     payload.plan,
    findings: payload.findings ?? [],
    site:     payload.plan?.site ?? payload.findingsSites?.[0],
  };
}
```

- [ ] **Step 5: Update `AgentConsoleTab.generateCommands` to use `plan.steps`**

Replace the hardcoded plugin slug list with commands derived from `plan.steps`:

```typescript
private generateCommands(plan: RemediationPlan): string[] {
  // Extract commands from the plan steps
  // Steps with tier=3 and requiresApproval=true are the execution commands
  return plan.steps
    .filter(s => s.tier === 3)
    .map(s => s.command)
    .filter(Boolean);
}
```

Update the `onExecute` callback in `renderSentinelModals`:
```typescript
onExecute: (decisions: AccountDecisionMap) => {
  const plan = this.state.activeSentinelCase as any;
  const commands = this.generateCommands(plan);
  this.setState({ executeDecisions: decisions, executeCommands: commands });
},
```

- [ ] **Step 6: Delete `parseSentinelReport.ts`**

```bash
rm src/renderer/utils/parseSentinelReport.ts
```

- [ ] **Step 7: Compile**

```bash
npm run compile 2>&1 | head -10
```

Expected: clean — no references to deleted file remain.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sdk): SentinelReviewOverlay uses typed RemediationPlan, delete parseSentinelReport.ts"
```

---

### Task 8: Final wiring — smoke test and branch cleanup

**Files:**
- Modify: `src/renderer/components/agents/AgentsHub.tsx` — agent card shows formatted name from status.name (already done, verify)
- Verify: all existing tests still pass

- [ ] **Step 1: Run the full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -15
```

Expected: no new failures. The 5 pre-existing native-module failures (better-sqlite3 context mismatch) are acceptable and unrelated.

- [ ] **Step 2: Rebuild Local and run an end-to-end sentinel run**

```bash
npm run build 2>&1 | tail -3
```

Then in Local:
1. Clear the Tier 2 cooldown: `sqlite3 ~/Library/Application\ Support/Local/nexus-ai/graph.db "DELETE FROM agent_state WHERE agent_name='security-sentinel' AND key LIKE 'tier2:%';"`
2. Restart Local
3. Go to Agents → Security Sentinel → Run now → select one WPE site
4. Verify:
   - RunDrawer shows `[phase] Tier 2: ...` section header
   - Drawer shows site status icons updating in real time
   - On completion: toast shows correct verdict (amber if findings)
   - Click Review in Fleet activity → SentinelReviewOverlay opens with typed plan data (no file read)
   - Execute plan → Done → activity event transitions to "done" with step children

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(sdk): smoke test complete — sentinel SDK v1 refactor ready for review"
```
