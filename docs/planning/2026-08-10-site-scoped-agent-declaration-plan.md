# `siteScoped` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent declare that its work is not per-site, so the site picker stops offering a scope it cannot consume and Run Now stops fanning one action into N identical runs.

**Architecture:** A sixth optional capability field on `AgentDefinition`, defaulting to `true`, threaded along the exact path `allowsProduction` and `effect` already take (SDK type → GraphQL schema → resolver → renderer type → query string → workspace → components). Enforcement lives in the IPC handler; the UI branches are a courtesy on top of it.

**Tech Stack:** TypeScript, Electron main + renderer, GraphQL (custom schema string), Jest. Renderer is **class-based React with `React.createElement` — no JSX, no hooks** (Local ships an older React).

**Spec:** `docs/planning/2026-08-10-site-scoped-agent-declaration-design.md`

## Global Constraints

- **Default is `true`.** An agent that does not declare the field keeps today's behaviour exactly. Only `auth-probe` opts out in this plan.
- **The boundary is the IPC handler, not the UI.** `allowsProduction`'s own doc comment states the rule: *"the same rule must be enforced wherever a scope is actually applied … the UI lock is a courtesy, not the boundary."* A renderer-only gate is not acceptable.
- **Renderer: class components, `React.createElement`, no JSX, no hooks.** Match surrounding style exactly.
- **Every test is mutation-verified.** For each test added, break the production line it covers, observe RED, restore, observe GREEN. Report both. A test that passes against the broken code is worse than no test — this codebase shipped six such guards in the preceding phase.
- **Never fabricate a value.** Absent is absent.
- **`npx tsc --noEmit -p tsconfig.json` must exit 0.** 33 suites fail from a pre-existing better-sqlite3 ABI mismatch (`NODE_MODULE_VERSION 146 vs 141`) — out of scope, do not investigate, never run `npm rebuild better-sqlite3`.

---

### Task 1: Declare the field and carry it to the renderer

**Files:**
- Modify: `src/main/agent-sdk/types.ts` (`AgentDefinition`, after `producesReports`)
- Modify: `src/main/graphql/schema.ts:2013` (the `AgentStatus` type)
- Modify: `src/main/graphql/resolvers.ts:5506` (the `agentStatus` resolver)
- Modify: `src/renderer/components/agents/AgentStore.ts` (the `AgentStatus` interface)
- Modify: `src/renderer/components/agents/AgentConsoleTab.tsx:259` (the query string)
- Test: `tests/unit/agent-runtime/siteScoped.test.ts`

**Interfaces:**
- Produces: `AgentDefinition.siteScoped?: boolean`; `AgentStatus.siteScoped: boolean` in both the GraphQL schema and the renderer interface; resolver default `?? true`.

**The trap in this task:** a field missing from the **query string** arrives `undefined` in the renderer and silently falls back to its default. A `siteScoped: false` agent would then render as scoped, with no error anywhere. Step 1 pins the query string for this reason.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/siteScoped.test.ts
import * as fs from 'fs';
import * as path from 'path';

describe('siteScoped travels from definition to renderer', () => {
  it('the agentStatus GraphQL query actually requests siteScoped', () => {
    // A field absent here arrives undefined in the renderer and falls back to its default,
    // so a siteScoped:false agent renders as scoped with no error anywhere.
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/renderer/components/agents/AgentConsoleTab.tsx'),
      'utf-8',
    );
    const query = src.match(/\{\s*agentStatus\s*\{[^}]*\}/);
    expect(query).toBeTruthy();
    expect(query![0]).toContain('siteScoped');
  });

  it('the GraphQL schema declares siteScoped on AgentStatus', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/graphql/schema.ts'),
      'utf-8',
    );
    expect(src).toMatch(/siteScoped:\s*Boolean/);
  });

  it('the resolver defaults an undeclared agent to true', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/graphql/resolvers.ts'),
      'utf-8',
    );
    // Conservative default: an agent that never declared the field keeps today's behaviour.
    expect(src).toMatch(/siteScoped:\s*\(def as any\)\.siteScoped \?\? true/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/unit/agent-runtime/siteScoped.test.ts`
Expected: FAIL — three assertions, none of the strings exist yet.

- [ ] **Step 3: Add the field to the SDK type**

In `src/main/agent-sdk/types.ts`, immediately after `producesReports?: boolean;` and before the closing brace of `AgentDefinition`:

```ts
  /**
   * Whether this agent's work is per-site. Default **true** — the conservative assumption,
   * matching `effect`'s default of 'writes'.
   *
   * Set false for an agent whose `run()` ignores site scope entirely: it reads neither the site
   * on `ctx.event` nor `settings.scope.siteIds`, and does the same thing regardless of which
   * sites are selected. `auth-probe` is the worked example — a fleet-wide auth diagnostic making
   * three fixed calls, for which the picker offered 404 sites and Run Now would have fired 166
   * identical runs.
   *
   * When false: no surface offers a site picker, and Run Now performs exactly ONE run with no
   * scoped event. Declaring false while actually reading a site from `ctx.event` means the agent
   * silently receives `undefined` — the declaration must match what `run()` does.
   */
  siteScoped?: boolean;
```

- [ ] **Step 4: Add it to the GraphQL schema**

In `src/main/graphql/schema.ts`, in the `AgentStatus` type after the `producesReports` field:

```graphql
    "Whether this agent's work is per-site. False = no site picker on any surface, and Run Now performs exactly one run."
    siteScoped: Boolean
```

- [ ] **Step 5: Add it to the resolver**

In `src/main/graphql/resolvers.ts`, in the `agentStatus` resolver beside its siblings:

```ts
            siteScoped: (def as any).siteScoped ?? true,
```

- [ ] **Step 6: Add it to the renderer type and the query**

In `src/renderer/components/agents/AgentStore.ts`, in the `AgentStatus` interface beside `producesReports`:

```ts
  /** False = this agent is not per-site: no picker, and Run Now performs exactly one run. */
  siteScoped: boolean;
```

In `src/renderer/components/agents/AgentConsoleTab.tsx:259`, add `siteScoped` to the field list, after `producesReports`.

- [ ] **Step 7: Run the tests**

Run: `npx jest tests/unit/agent-runtime/siteScoped.test.ts` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 8: Mutation-verify**

Remove `siteScoped` from the query string only → the first test must go RED. Restore.
Change the resolver default to `?? false` → the third test must go RED. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/main/agent-sdk/types.ts src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/renderer/components/agents/AgentStore.ts src/renderer/components/agents/AgentConsoleTab.tsx tests/unit/agent-runtime/siteScoped.test.ts
git commit -m "feat(sdk): siteScoped capability declaration, defaulting true"
```

---

### Task 2: Enforce it in the IPC handler

**Files:**
- Modify: `src/main/ipc-handlers.ts` (`AGENT_RUN_NOW`, the loop at ~5101)
- Test: `tests/unit/agent-runtime/runNowSiteScoped.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition.siteScoped` (Task 1).
- Produces: for a non-scoped agent, exactly one `runner.run(agent, undefined, …)` and one entry in the broadcast `runIds`.

**Context:** `AGENT_RUN_NOW` is the **only** fan-out point in the system — the scheduler, event bus, GraphQL `agentRun` and MCP dispatch all call `runner.run()` once. This task is therefore the whole of the enforcement.

Read the current handler before editing; it changed materially this week. The local id is now `correlationId` (abort-controller key only) and the real per-run ids are collected into `runIds` and broadcast.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/runNowSiteScoped.test.ts
//
// The handler is the boundary, not the UI: the CLI and any future caller reach this channel
// too, so a renderer-only gate would not hold.

describe('AGENT_RUN_NOW honours siteScoped', () => {
  it('runs a non-scoped agent exactly once, whatever the caller selected', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_one' }) };
    const agent = { name: 'auth-probe', siteScoped: false } as any;
    const runs = await invokeRunNow({ agent, runner, siteNames: ['a', 'b', 'c'] });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls[0][1]).toBeUndefined(); // no scoped event
    expect(runs.runIds).toEqual(['r_one']);
  });

  it('still loops per site for a scoped agent', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_x' }) };
    const agent = { name: 'security-sentinel' } as any; // siteScoped undefined → true
    await invokeRunNow({ agent, runner, siteNames: ['a', 'b', 'c'] });
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runner.run.mock.calls[0][1]).toMatchObject({ siteId: 'a' });
  });

  it('runs a non-scoped agent once even when the caller sends no sites', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ runId: 'r_one' }) };
    const agent = { name: 'auth-probe', siteScoped: false } as any;
    await invokeRunNow({ agent, runner, siteNames: [] });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
```

Write `invokeRunNow` as a local harness that drives the real handler. Follow whatever
registration/stub pattern `tests/unit/agent-runtime/runNowSkip.test.ts` already uses for
`AGENT_RUN_NOW` — do not invent a second one.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/unit/agent-runtime/runNowSiteScoped.test.ts`
Expected: FAIL — the first test sees 3 calls, not 1.

- [ ] **Step 3: Branch the loop**

Replace the site loop so a non-scoped agent takes a single pass with no event. Keep the abort check, keep pushing to `runs` so `collectRunIds` is unchanged, and keep every existing broadcast path intact.

```ts
        // AGENT_RUN_NOW is the only fan-out point in the system — cron, events, GraphQL and MCP
        // all run once. An agent that declares siteScoped:false reads neither ctx.event's site
        // nor settings.scope, so looping it per site produces N identical runs (measured: 166
        // selected sites x ~8.5s for auth-probe) and N unrelated run ids for one user action.
        if ((agent as any).siteScoped === false) {
          lastRunResult = await runner.run(agent, undefined, { fullRun: fullRun ?? false, logFileName, trigger: 'manual' });
          runs.push({ site: '', result: lastRunResult || {} });
        } else {
          for (const siteName of siteNames) {
            // ...existing loop body, unchanged...
          }
        }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/agent-runtime` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS except the 4 known better-sqlite3 ABI suites; tsc exit 0.

- [ ] **Step 5: Mutation-verify**

Change the condition to `=== true` → tests 1 and 3 must go RED. Restore.
Change the non-scoped branch to pass a scoped event instead of `undefined` → test 1 must go RED. Restore.
Delete the `else` branch's loop → test 2 must go RED. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc-handlers.ts tests/unit/agent-runtime/runNowSiteScoped.test.ts
git commit -m "fix(agents): Run Now performs one run for a non-scoped agent"
```

---

### Task 3: Stop offering a picker the agent cannot use

**Files:**
- Modify: `src/renderer/components/agents/AgentRunModal.tsx`
- Modify: `src/renderer/components/agents/AgentWorkspaceSettings.tsx`
- Modify: `src/renderer/components/agents/AgentWorkspace.tsx` (pass the prop to both, beside `allowsProduction` / `effect`)
- Test: `tests/unit/renderer/siteScopedUi.test.tsx`

**Interfaces:**
- Consumes: `AgentStatus.siteScoped` (Task 1), read in `AgentWorkspace` as `this.state.status?.siteScoped ?? true`.
- Produces: no interface for later tasks.

**Follow the existing precedent, do not invent a second conditional style.** `AgentWorkspaceSettings` already switches its scope block on `this.props.scopeLivesInSitesTab` between `renderScanScope()` and `renderScopeElsewhereLine()`. Add the new case to that same ternary.

**Renderer rules:** class components, `React.createElement`, no JSX, no hooks. Use the `spySetState` harness the sibling suites in `tests/unit/renderer` use.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/renderer/siteScopedUi.test.tsx
import { AgentRunModal } from '../../src/renderer/components/agents/AgentRunModal';
import { AgentWorkspaceSettings } from '../../src/renderer/components/agents/AgentWorkspaceSettings';

const findByType = (node: any, name: string): any[] => {
  if (!node || typeof node !== 'object') return [];
  const hits = node.type && (node.type.name === name || node.type === name) ? [node] : [];
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids ? [kids] : [];
  return arr.reduce((acc: any[], k: any) => acc.concat(findByType(k, name)), hits);
};

describe('siteScoped hides the picker', () => {
  it('Run Now renders no SitePicker for a non-scoped agent', () => {
    const el = new (AgentRunModal as any)({
      agentName: 'auth-probe', agentId: 'auth-probe', electron: {},
      supportsFullRun: false, allowsProduction: true, effect: 'readonly',
      siteScoped: false, onCancel: () => {}, onRun: () => {},
    });
    el.state = { ...el.state, loading: false, sites: [], selection: new Set() };
    expect(findByType(el.render(), 'SitePicker')).toHaveLength(0);
  });

  it('Run Now still renders a SitePicker for a scoped agent', () => {
    const el = new (AgentRunModal as any)({
      agentName: 'security-sentinel', agentId: 'security-sentinel', electron: {},
      supportsFullRun: false, allowsProduction: true, effect: 'writes',
      siteScoped: true, onCancel: () => {}, onRun: () => {},
    });
    el.state = { ...el.state, loading: false, sites: [], selection: new Set() };
    expect(findByType(el.render(), 'SitePicker').length).toBeGreaterThan(0);
  });
});
```

Add the equivalent pair for `AgentWorkspaceSettings`: with `siteScoped: false` the rendered
tree must contain neither the `SITES IN SCOPE` eyebrow nor a `SitePicker`; with `true`
(and `scheduleEnabled: true`, `scopeLivesInSitesTab: false`) it must contain both.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/unit/renderer/siteScopedUi.test.tsx`
Expected: FAIL — the picker renders unconditionally today.

- [ ] **Step 3: Branch the Run Now modal**

Add `siteScoped: boolean;` to `ModalProps`. When false, render a single explanatory block in place of the picker, and replace the footer's `Run on N sites` button with `Run now`, with no selection gating:

```ts
          React.createElement('div', {
            style: { padding: '28px 24px', fontSize: 13.5, color: 'var(--ag-text-secondary)', lineHeight: 1.55 },
          },
            'This agent does not run per site — it performs the same fleet-wide checks every time. Running it now performs one run.',
          ),
```

`handleRun()` must call `onRun([])` in this case; Task 2's handler ignores the array for a
non-scoped agent. Do not disable the button on `selection.size === 0` when `siteScoped`
is false — that guard exists for the picker and would make the button permanently dead.

- [ ] **Step 4: Branch the Settings scope block**

Add `siteScoped?: boolean;` to the settings props. Extend the existing ternary:

```ts
          settings.scheduleEnabled && (
            !(this.props.siteScoped ?? true)
              ? this.renderNotSiteScopedLine()
              : this.props.scopeLivesInSitesTab
                ? this.renderScopeElsewhereLine()
                : this.renderScanScope()
          ),
```

Add `renderNotSiteScopedLine()` modelled on `renderScopeElsewhereLine()`'s existing markup
(same inset box, same typography), with no button:

```ts
  /**
   * Stand-in for the scope editor for an agent that declares siteScoped:false. Its run() reads
   * neither ctx.event's site nor settings.scope, so a picker here would write a field nothing
   * consumes — the same "two lists answering one question" failure renderScopeElsewhereLine
   * exists to avoid.
   */
  private renderNotSiteScopedLine() {
    return React.createElement('div', {
      style: {
        marginBottom: 14, padding: '11px 14px', borderRadius: 10,
        background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border-subtle)',
        fontSize: 13, color: 'var(--ag-text-secondary)',
      },
    }, 'This agent is not scoped to sites — each run performs the same fleet-wide checks.');
  }
```

- [ ] **Step 5: Pass the prop from the workspace**

In `AgentWorkspace.tsx`, beside the existing `allowsProduction` / `effect` props on both
`AgentRunModal` and `AgentWorkspaceSettings`:

```ts
            siteScoped: this.state.status?.siteScoped ?? true,
```

- [ ] **Step 6: Run the tests**

Run: `npx jest tests/unit/renderer` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 7: Mutation-verify**

In `AgentWorkspace.tsx`, change the default to `?? false` → the "scoped agent still renders a picker" tests must go RED. Restore.
Remove the modal's branch → the non-scoped modal test must go RED. Restore.
Remove the settings ternary case → the non-scoped settings test must go RED. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/agents/AgentRunModal.tsx src/renderer/components/agents/AgentWorkspaceSettings.tsx src/renderer/components/agents/AgentWorkspace.tsx tests/unit/renderer/siteScopedUi.test.tsx
git commit -m "feat(agents): no site picker for an agent that is not site-scoped"
```

---

### Task 4: Declare it on auth-probe, and close the empty-selection gap

**Files:**
- Modify: `~/Library/Application Support/Local/nexus-ai/agents/auth-probe/agent.js`
- Modify: `src/main/ipc-handlers.ts` (`AGENT_RUN_NOW`, the empty-selection case)
- Test: `tests/unit/agent-runtime/runNowSiteScoped.test.ts` (extend)

**Interfaces:**
- Consumes: everything above.

**Two independent pieces. Keep them as two commits.**

**Piece A — the declaration. Read this before starting: `auth-probe` is NOT in the repo.**
Verified — `agents/` contains `log-processor`, `security-sentinel`, `seo-insights` and
`web-analytics`, but no `auth-probe`. It exists only under
`~/Library/Application Support/Local/nexus-ai/agents/auth-probe/agent.js`, a user-local
diagnostic agent that is not version-controlled.

Consequences you must not paper over:
- The edit **cannot be committed** and will be lost on a reinstall or a fresh machine. Say
  so in your report; do not `git add` a path outside the repo, and do not copy the agent
  into `agents/` to make it committable — adopting a personal diagnostic into the shipped
  set is a product decision nobody has made.
- It therefore **cannot be covered by a repo test.** Its only verification is the
  end-to-end observation in Step 4.

If a reviewer needs a committed example of the field, the honest options are a fixture in
the test suite or leaving the repo with none. Do not invent a third agent to demonstrate it.

Every other agent keeps the default: `security-sentinel` (60 scope references),
`seo-insights` and `log-processor` all read `ctx.settings.scope.siteIds`.

**Piece B — the empty-selection gap.** For a **scoped** agent with an empty `siteNames`, the handler loops zero times and broadcasts `doneCount: 0, failedCount: 0` — a completed run that never happened.

Note the modal already disables its button on `selection.size === 0`, so this is not reachable from the UI today; it is reachable from the CLI or any other caller of the channel. It is therefore defense-in-depth, not a live user-facing bug — fix it as such, and do not describe it as a user-visible defect in the commit message.

Make the handler broadcast a completion that says nothing ran, rather than one indistinguishable from success. Do not silently run all sites instead — inferring intent from an empty list is how a "run on nothing" becomes "run on 404 production installs".

- [ ] **Step 1: Extend the test**

```ts
  it('reports that nothing ran when a scoped agent is given no sites', async () => {
    const runner = { run: jest.fn() };
    const agent = { name: 'security-sentinel' } as any;
    const out = await invokeRunNow({ agent, runner, siteNames: [] });
    expect(runner.run).not.toHaveBeenCalled();
    // Not indistinguishable from a successful run of zero sites.
    expect(out.broadcast).toMatchObject({ ranNothing: true });
  });
```

Use whatever field name the handler's existing broadcast shape makes natural; `ranNothing`
is illustrative. Whatever you choose, the renderer must not show a completed run for it —
check `RunStore.completeRun` and `RunDrawer` before naming it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/unit/agent-runtime/runNowSiteScoped.test.ts`
Expected: FAIL — the broadcast has no such field.

- [ ] **Step 3: Implement both pieces**

Declaration first, commit; then the handler branch, commit.

- [ ] **Step 4: Verify end to end**

Run: `npx jest tests/unit/agent-runtime tests/unit/renderer` and `npx tsc --noEmit -p tsconfig.json`
Then rebuild and load in Local (`npm run rebuild`, `./dev-reload.sh`) and confirm by observation:
- auth-probe's Settings tab shows the not-site-scoped line and no picker
- auth-probe's Run Now offers no picker, and pressing it produces **one** run
- `grep run=<id>` on `~/Library/Application Support/Local/nexus-ai/logs/nexus-$(date +%F).log` finds that single run
- security-sentinel's picker is unchanged

Report what you observed, not what you expected. If Local cannot be started, say so plainly and mark this step unverified rather than assuming.

- [ ] **Step 5: Mutation-verify and commit**

Remove `siteScoped: false` from auth-probe → the handler test for a non-scoped agent still passes (it constructs its own definition), so state explicitly that the declaration is covered by the end-to-end observation in Step 4, not by a unit test. Do not claim coverage you do not have.

```bash
git add <the auth-probe file you changed>
git commit -m "feat(agents): auth-probe declares siteScoped false"
git add src/main/ipc-handlers.ts tests/unit/agent-runtime/runNowSiteScoped.test.ts
git commit -m "fix(agents): an empty site selection reports that nothing ran"
```
