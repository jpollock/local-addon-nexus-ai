# Sentinel Ask-Mode: Scan-Then-Approve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the sentinel's autonomy is set to `'ask'`, the agent scans and analyzes but stops before executing any sandbox remediation — the user reviews the proposed plan and clicks "Execute remediation in sandbox" before anything is deleted or modified.

**Architecture:** Three-part change. (1) The agent reads `ctx.autonomy` and in `ask` mode returns a plan with `pendingApproval: true` instead of running the checklist. (2) A new `nexus:sentinel:execute-sandbox` IPC handler uses the existing `localServicesBridge.wpCliRun` path to run `executeChecklist` on demand. (3) `SentinelReviewOverlay` shows an "Execute remediation in sandbox" button when `pendingApproval: true`, replacing the current "Verified on isolated sandbox" state.

**Tech Stack:** CommonJS agent.js, TypeScript IPC handlers, React class components (no JSX).

## Global Constraints

- Agent receives `autonomy` via destructuring from `ctx` in `run({ event, tools, ai, log, state, autonomy })`
- `pendingApproval: true` is set on the plan object returned by `tier2Investigate` in ask mode
- The new IPC channel is `'nexus:sentinel:execute-sandbox'` — registred in `registerIpcHandlers` alongside `nexus:sentinel:execute`
- `SentinelReviewOverlay` uses `React.createElement` — no JSX
- The existing `executeChecklist` function is re-used; it accepts `(checklist, install, sandboxName, tools, log, reportPath)` — the IPC handler must reconstruct `tools` using `localServicesBridge`
- All existing 143 sentinel tests must still pass

---

### Task 1: Agent — skip execution in ask mode, return `pendingApproval: true`

In `ask` mode, `tier2Investigate` builds the checklist but does not call `executeChecklist`. It returns the plan with `pendingApproval: true` and a `checklist` array (the steps that would have run). The sandbox stays alive exactly as it does today.

**Files:**
- Modify: `agents/security-sentinel/agent.js:224` (run destructure), `agent.js:2192` (tier3Remediate call site)

**Interfaces:**
- Consumes: `ctx.autonomy: 'suggest' | 'ask' | 'auto'` — already wired by Fix 1
- Produces: `plan.pendingApproval?: boolean` and `plan.checklist?: ChecklistItem[]` — read by Task 3 UI

- [ ] **Step 1: Write the failing tests**

Add in `tests/unit/agents/security-sentinel/sentinel.test.js` inside `describe('security-sentinel')`:

```javascript
describe('ask-mode autonomy', () => {
  it('does not execute checklist when autonomy is ask', async () => {
    const { tier2Investigate } = agent._test;
    const installObj = { id: 's1', name: 'testsite', source: 'local', environment: null,
      postCount: 5, userCount: 1, wpVersion: '6.5', phpVersion: '8.2', plugins: [],
      adminUsers: [], settings: {}, protectedEmails: [], sshLastSyncAt: null };

    let checklistExecuted = false;
    const tools = {
      invoke: jest.fn().mockImplementation(async (name, args) => {
        if (name === 'local_start_site') return 'ok';
        if (name === 'local_clone_site') return '{}';
        if (name === 'local_operation_status') return JSON.stringify({ site_status: 'running', message: 'ok' });
        if (name === 'wp_eval') {
          // Mark if executeChecklist runs (it calls wp_eval with shuffle-salts)
          if ((args.code || '').includes('shuffle-salts')) checklistExecuted = true;
          return '[]';
        }
        return '{}';
      }),
      registerSandbox: jest.fn(),
    };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(),
      phase: jest.fn(), finding: jest.fn(), action: jest.fn(), siteStatus: jest.fn() };
    const state = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {},
      isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() };
    const ai = { run: jest.fn(), generateObject: jest.fn().mockResolvedValue({
      verdict: 'active-compromise', attackSummary: 'test', entryPoint: 'unknown',
      temporalNarrative: '', attackerItems: [], legitimateItems: [],
      blindSpots: [], remediationSteps: [],
    }) };

    const signals = [{ id: 'ABS-05', severity: 'critical', category: 'active-compromise',
      installName: 'testsite', title: 'Known backdoor', detail: '', fix: '', evidence: [] }];

    const plan = await tier2Investigate(installObj, signals, tools, ai, log, state, 0, 'ask');

    expect(checklistExecuted).toBe(false);
    expect(plan).not.toBeNull();
    expect(plan.pendingApproval).toBe(true);
    expect(Array.isArray(plan.checklist)).toBe(true);
    expect(plan.checklist.length).toBeGreaterThan(0);
  });

  it('executes checklist normally when autonomy is auto', async () => {
    const { tier2Investigate } = agent._test;
    const installObj = { id: 's1', name: 'testsite', source: 'local', environment: null,
      postCount: 5, userCount: 1, wpVersion: '6.5', phpVersion: '8.2', plugins: [],
      adminUsers: [], settings: {}, protectedEmails: [], sshLastSyncAt: null };

    let checklistExecuted = false;
    const tools = {
      invoke: jest.fn().mockImplementation(async (name, args) => {
        if (name === 'local_start_site') return 'ok';
        if (name === 'local_clone_site') return '{}';
        if (name === 'local_operation_status') return JSON.stringify({ site_status: 'running', message: 'ok' });
        if (name === 'wp_eval') {
          if ((args.code || '').includes('shuffle-salts')) checklistExecuted = true;
          return '[]';
        }
        return '{}';
      }),
      registerSandbox: jest.fn(),
    };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(),
      phase: jest.fn(), finding: jest.fn(), action: jest.fn(), siteStatus: jest.fn() };
    const state = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {},
      isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() };
    const ai = { run: jest.fn(), generateObject: jest.fn().mockResolvedValue({
      verdict: 'active-compromise', attackSummary: 'test', entryPoint: 'unknown',
      temporalNarrative: '', attackerItems: [], legitimateItems: [],
      blindSpots: [], remediationSteps: [],
    }) };

    const signals = [{ id: 'ABS-05', severity: 'critical', category: 'active-compromise',
      installName: 'testsite', title: 'Known backdoor', detail: '', fix: '', evidence: [] }];

    const plan = await tier2Investigate(installObj, signals, tools, ai, log, state, 0, 'auto');

    expect(checklistExecuted).toBe(true);
    expect(plan?.pendingApproval).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "ask-mode"
```
Expected: both tests fail (tier2Investigate doesn't accept 8th arg yet)

- [ ] **Step 3: Add `autonomy` param to `tier2Investigate` and skip execution in ask mode**

**In `agents/security-sentinel/agent.js`:**

Step 3a — change `run` destructure at line 224 to include `autonomy`:
```javascript
async run({ event, tools, ai, log, state, autonomy }) {
```

Step 3b — pass `autonomy` to `tier2Investigate` at line 262:
```javascript
const plan = await tier2Investigate(install, signals, tools, ai, log, state, autonomy);
```

Step 3c — update `tier2Investigate` signature at line 1314:
```javascript
async function tier2Investigate(install, tier1Signals, tools, ai, log, state, autonomy, _pollIntervalMs = 20000) {
```

Step 3d — replace the `tier3Remediate` call at line 2192 with:
```javascript
  if (autonomy === 'ask') {
    // Ask mode: build the checklist but don't execute it. Return a pending plan
    // so the user can review and approve before anything is deleted or modified.
    log.phase('Tier 3', `Plan ready — awaiting approval before execution (${install.name})`);
    const checklist = buildRemediationChecklist(install, tier1Signals.concat(fsSignals), sandboxName);
    return {
      site: install.name,
      sandbox: sandboxName,
      verified: false,
      verdict: 'pending',
      pendingApproval: true,
      checklist,
      summary: synthesis.attackSummary,
      entryPoint: synthesis.entryPoint,
      blindSpots: synthesis.blindSpots,
      attackerItems: synthesis.attackerItems,
      steps: checklist.map((item, i) => ({
        id: `step-${item.step ?? i + 1}`,
        label: item.action,
        command: item.executableCommand ?? '',
        tier: 3,
        requiresApproval: item.requiresApproval ?? false,
        verificationResult: 'pending',
        verificationOutput: '',
      })),
      reportPath: '',
    };
  }

  log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
  const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
```

Step 3e — the unit test passes `autonomy` as 8th arg and `_pollIntervalMs` as 7th. Adjust the default params so the existing call sites (which don't pass `autonomy`) default to `'auto'`:
```javascript
async function tier2Investigate(install, tier1Signals, tools, ai, log, state, autonomy = 'auto', _pollIntervalMs = 20000) {
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | tail -10
```
Expected: 145 passing (143 + 2 new ask-mode tests)

- [ ] **Step 5: Sync and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel): ask-mode stops before checklist execution — returns pendingApproval plan for user review"
```

---

### Task 2: IPC handler — `nexus:sentinel:execute-sandbox`

When the user approves the plan in the overlay, the UI calls `nexus:sentinel:execute-sandbox` with `{ sandboxName, installName, signals }`. The handler re-runs `buildRemediationChecklist` + `executeChecklist` using `localServicesBridge.wpCliRun` directly (same path `wp_eval` uses).

**Files:**
- Modify: `src/main/ipc-handlers.ts` — add handler before the closing `console.log` line
- Modify: `src/common/constants.ts` or inline the channel string (no constants file for sentinel channels — use inline string matching existing pattern)

**Interfaces:**
- Consumes: `{ sandboxName: string, installName: string, signals: Array<{id,severity,category,installName,title,detail,fix,evidence}> }` from renderer
- Produces: `{ success: boolean, steps: RemediationStep[], reportPath: string }` to renderer

- [ ] **Step 1: Add the handler**

In `src/main/ipc-handlers.ts`, immediately before the closing `console.log('[NexusAI]...')` line:

```typescript
  // Sentinel ask-mode: execute the remediation checklist on the sandbox after user approval
  safeHandle('nexus:sentinel:execute-sandbox', async (
    _event: any,
    { sandboxName, installName, signals }: {
      sandboxName: string;
      installName: string;
      signals: Array<{ id: string; severity: string; category: string; installName: string;
                       title: string; detail: string; fix: string; evidence: string[] }>;
    }
  ) => {
    try {
      // Load agent.js to access buildRemediationChecklist and executeChecklist
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sentinelAgent = require(
        require('path').join(require('os').homedir(),
          'Library', 'Application Support', 'Local', 'nexus-ai',
          'agents', 'security-sentinel', 'agent.js')
      );
      const { buildRemediationChecklist, executeChecklist } = sentinelAgent._test;

      // Build a minimal install object from the installName
      const install = { name: installName, environment: null, postCount: 0 };

      // Build tools wrapper using localServicesBridge (same as wp_eval MCP handler)
      const tools = {
        invoke: async (toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'wp_eval') {
            const code = args.code as string;
            const result = await localServicesBridge.wpCliRun(
              sandboxName,
              ['eval', code],
              {
                skipPlugins: !!(args.skip_plugins),
                skipThemes: !!(args.skip_themes),
                timeoutMs: 30_000,
              }
            );
            if (!result.success) throw new Error('Eval failed: ' + result.stdout);
            return result.stdout?.trim() || '';
          }
          throw new Error(`Tool "${toolName}" not available in sandbox execution context`);
        },
      };

      const log = {
        info: (msg: string) => localLogger.info(msg),
        warn: (msg: string) => localLogger.warn(msg),
        error: (msg: string) => localLogger.error(msg),
        phase: (name: string, desc?: string) => localLogger.info(`[phase] ${name}${desc ? ': ' + desc : ''}`),
        action: (a: any) => localLogger.info(`[action] ${a.label}`),
      };

      // Report path
      const reportPath = require('path').join(
        require('os').homedir(),
        'Library', 'Application Support', 'Local', 'nexus-ai',
        'agents', 'security-sentinel', 'reports', installName,
        `${new Date().toISOString().slice(0, 10)}T${new Date().toISOString().slice(11, 16).replace(':', '-')}-sandbox.md`
      );
      require('fs').mkdirSync(require('path').dirname(reportPath), { recursive: true });

      const checklist = buildRemediationChecklist(install, signals, sandboxName);
      const results = await executeChecklist(checklist, install, sandboxName, tools, log, reportPath);
      const steps = checklist.map((item: any, i: number) => ({
        id: `step-${item.step ?? i + 1}`,
        label: item.action,
        command: item.executableCommand ?? '',
        tier: 3,
        requiresApproval: item.requiresApproval ?? false,
        verificationResult: results[i]?.passed ? 'ok' : 'failed',
        verificationOutput: results[i]?.detail ?? '',
      }));

      return { success: steps.every((s: any) => s.verificationResult !== 'failed'), steps, reportPath };
    } catch (err: any) {
      localLogger.error('[nexus:sentinel:execute-sandbox] Failed:', err.message);
      return { success: false, steps: [], reportPath: '' };
    }
  });
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
```
Expected: `Done. Hot reload will pick up changes in ~2s.`

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(sentinel): nexus:sentinel:execute-sandbox IPC handler — runs checklist on approved ask-mode plan"
```

---

### Task 3: UI — "Execute remediation in sandbox" button in SentinelReviewOverlay

When `plan.pendingApproval === true`, the overlay verdict area shows "Awaiting your approval" instead of the normal verdict, and an "Execute remediation in sandbox" button. After execution, the overlay updates with the results and the normal verdict.

**Files:**
- Modify: `src/renderer/components/agents/SentinelReviewOverlay.tsx` — `renderVerdict()` + new state + new method
- Modify: `src/renderer/components/agents/AgentConsoleTab.tsx` — map `plan.pendingApproval` onto `SentinelCase`

**Interfaces:**
- Consumes: `sentinelCase.pendingApproval?: boolean` and `sentinelCase.signals` (the raw signal array for the IPC call)
- Produces: overlay updates steps in-place after execution

- [ ] **Step 1: Map `pendingApproval` onto `SentinelCase` in `AgentConsoleTab.tsx`**

Find where `SentinelCase` is built from `eventPlan` (around line 73). Add:
```typescript
pendingApproval: (eventPlan as any)?.pendingApproval ?? false,
signals: (eventPlan as any)?.signals ?? event?.findings ?? [],
```

Also add these fields to the `SentinelCase` type in `src/renderer/components/agents/SentinelTypes.ts` (or wherever the type is defined):
```typescript
pendingApproval?: boolean;
signals?: Array<{ id: string; severity: string; category: string; installName: string;
                  title: string; detail: string; fix: string; evidence: string[] }>;
```

- [ ] **Step 2: Add execution state to `SentinelReviewOverlay`**

Add to the component's state interface and initializer:
```typescript
interface OverlayState {
  mode: 'full' | 'panel';
  executing: boolean;
  executionDone: boolean;
}
// initial state:
state: OverlayState = { mode: 'full', executing: false, executionDone: false };
```

- [ ] **Step 3: Add `handleExecuteSandbox` method**

```typescript
private handleExecuteSandbox = async () => {
  const { sentinelCase } = this.props;
  this.setState({ executing: true });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ipcRenderer } = require('electron');
    const result = await ipcRenderer.invoke('nexus:sentinel:execute-sandbox', {
      sandboxName: sentinelCase.sandbox?.id ?? '',
      installName: sentinelCase.site,
      signals: sentinelCase.signals ?? [],
    });
    if (result.steps?.length) {
      // Update steps in the case to show verification results
      this.props.sentinelCase.steps = result.steps;
      this.props.sentinelCase.reportPath = result.reportPath ?? '';
    }
    this.setState({ executing: false, executionDone: true });
  } catch {
    this.setState({ executing: false, executionDone: true });
  }
};
```

- [ ] **Step 4: Update `renderVerdict()` to handle pending state**

Find `renderVerdict()`. At the top of the method, before the existing `ready` check, add:

```typescript
private renderVerdict() {
  const { verdict, failedSteps, pendingApproval } = this.props.sentinelCase;
  const { executing, executionDone } = this.state;

  if (pendingApproval && !executionDone) {
    return React.createElement('div', {
      style: {
        background: 'rgba(245,181,68,0.08)', border: '1px solid rgba(245,181,68,0.3)',
        borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 16,
      },
    },
      React.createElement('div', null,
        React.createElement('div', {
          style: { fontSize: 15, fontWeight: 600, color: '#f5b544', marginBottom: 4 },
        }, '⏸ Awaiting approval — nothing has been modified'),
        React.createElement('div', {
          style: { fontSize: 12.5, color: 'var(--ag-text-muted)' },
        }, 'Review the proposed remediation steps above, then approve to execute in sandbox.'),
      ),
      React.createElement('button', {
        onClick: this.handleExecuteSandbox,
        disabled: executing,
        style: {
          background: executing ? 'var(--ag-bg-elevated)' : '#f5b544',
          color: executing ? 'var(--ag-text-muted)' : '#0d0f13',
          border: 'none', borderRadius: 8, padding: '10px 20px',
          fontSize: 13, fontWeight: 600, cursor: executing ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        },
      }, executing ? 'Executing…' : 'Execute remediation in sandbox'),
    );
  }

  // Existing verdict rendering continues below…
  const ready = verdict === 'ready';
  // ... (rest of existing renderVerdict code unchanged)
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
```
Expected: `Done.`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/agents/SentinelReviewOverlay.tsx src/renderer/components/agents/AgentConsoleTab.tsx
git commit -m "feat(sentinel): ask-mode overlay — show pending approval state, Execute remediation button"
```
