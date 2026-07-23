# Per-Run Log Files, Report Separation, and Sandbox Indexing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Create a separate log file per agent run so the Log chip links to the right run; (2) Stop writing the Site Content Report to the log — it belongs in the Report chip via AgentResult.summary; (3) Reindex the sandbox after pull so seo-insights content analysis works.

**Architecture:** Two independent tasks. Task 1 threads a per-run `logFileName` from IPC handler → AgentRunner → buildAgentContext → AGENT_RUN_STARTED broadcast → RunStore watcher → AgentStateStore → GQL → AgentRunList Log chip. Task 2 adds a reindex+poll step in seo-insights after the sandbox pull.

**Tech Stack:** TypeScript, React class components (no JSX), better-sqlite3, Electron IPC.

## Global Constraints

- `agent.log` (the shared log) MUST continue to exist alongside per-run files — other tooling may read it.
- Per-run log filename format: `run-<startedAt_ms>.log` e.g. `run-1753276539000.log`.
- Log files live in `~/Library/Application Support/Local/nexus-ai/agents/<agentId>/logs/`.
- `AgentResult` type is in `src/main/agent-sdk/types.ts` — adding fields there propagates to all agents.
- Renderer uses `React.createElement()` — no JSX.
- `better-sqlite3` — synchronous only.
- Agent files at `~/Library/Application Support/Local/nexus-ai/agents/` are the runtime copies. The repo copies at `agents/` are synced by `npm run build`. Edit repo copies; the build syncs them.

---

### Task 1: Per-run log files + report separation

**Files:**
- Modify: `src/main/agent-sdk/types.ts`
- Modify: `src/main/agent-runtime/buildAgentContext.ts`
- Modify: `src/main/agent-runtime/AgentRunner.ts`
- Modify: `src/main/agent-runtime/AgentStateStore.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/graphql/schema.ts`
- Modify: `src/main/graphql/resolvers.ts`
- Modify: `src/renderer/components/agents/AgentStore.ts`
- Modify: `src/renderer/components/agents/RunStore.ts`
- Modify: `src/renderer/components/agents/AgentRunList.tsx`
- Modify: `agents/seo-insights/agent.ts` (repo copy)

**Interfaces:**
- `AgentResult` gains `logFile?: string`
- `AgentContextDeps` gains `logFileName?: string`
- `AgentRunner.run(agent, event, options)` — `options` gains `logFileName?: string`
- `AGENT_RUN_STARTED` broadcast payload gains `logFile: string`
- `RunStore.startRun()` params gain `logFile: string`
- `AgentRunRow` (main) + `AgentRunRecord` (renderer) gain `logFile?: string`
- `AgentRunRecord` GQL type gains `logFile: String`

---

- [ ] **Step 1: Add `logFile` to `AgentResult` and `logFileName` to `AgentContextDeps`**

In `src/main/agent-sdk/types.ts`, add to `AgentResult`:
```typescript
/** Absolute path to this run's log file. Stored in agent_runs for the Log chip. */
logFile?: string;
```

In `src/main/agent-runtime/buildAgentContext.ts`, add to `AgentContextDeps`:
```typescript
/** Per-run log filename (e.g. "run-1753276539000.log"). Defaults to "agent.log". */
logFileName?: string;
```

In the same file, change line 90 from:
```typescript
const logFile = path.join(logDir, 'agent.log');
```
To:
```typescript
const logFile = path.join(logDir, deps.logFileName ?? 'agent.log');
```

The shared `agent.log` still gets written when `logFileName` is absent (scheduler-triggered runs, tests).

- [ ] **Step 2: Thread `logFileName` through `AgentRunner.run()`**

In `src/main/agent-runtime/AgentRunner.ts`, update `run()` signature:
```typescript
async run(
  agent: AgentDefinition,
  event?: NexusEvent,
  options?: { fullRun?: boolean; logFileName?: string },
): Promise<AgentResult> {
```

Pass `logFileName` to `buildAgentContext`:
```typescript
const { ctx, agentLog, accFindings, accActions, accSites } = buildAgentContext({
  agent,
  event,
  toolRegistry: this.toolRegistry,
  services: this.services,
  stateStore: this.stateStore,
  resolvedProvider: this.resolvedProvider,
  logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', agentName, 'logs'),
  dbManager: this.dbManager,
  fullRun: options?.fullRun ?? false,
  logFileName: options?.logFileName,   // <-- add
});
```

After the result is assembled (find the `return result` or equivalent near the bottom of `run()`), add `logFile` to the returned object:
```typescript
// Wherever the AgentResult is built before returning:
result.logFile = options?.logFileName
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', agentName, 'logs', options.logFileName)
  : undefined;
```

Read the full `run()` method before editing to find the exact return assembly point.

- [ ] **Step 3: Update `AgentStateStore` to persist `log_file`**

In `src/main/agent-runtime/AgentStateStore.ts`, add migration in constructor (after existing migrations):
```typescript
try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN log_file TEXT`); } catch {}
```

Update `AgentRunRow` interface — add:
```typescript
logFile?: string;
```

Update `recordRun()` INSERT to include `log_file`:
```typescript
this.db
  .prepare('INSERT INTO agent_runs (agent_name, started_at, finished_at, status, error, summary, findings_count, log_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(result.agentName, result.startedAt, result.finishedAt, result.status, result.error ?? null, result.summary ?? null, findingsCount, result.logFile ?? null);
```

Update `getRunHistory()` row mapping — add:
```typescript
logFile: r.log_file ?? undefined,
```

- [ ] **Step 4: Generate logFileName in AGENT_RUN_NOW handler and thread through**

In `src/main/ipc-handlers.ts`, in the `AGENT_RUN_NOW` handler, add logFileName generation immediately after `const runId = ...`:
```typescript
const runId = `run-${Date.now()}`;
const logFileName = `run-${Date.now()}.log`;   // <-- add (separate timestamp for uniqueness)
const logDir = require('path').join(
  require('os').homedir(),
  'Library', 'Application Support', 'Local', 'nexus-ai',
  'agents', agentId, 'logs',
);
const logFilePath = require('path').join(logDir, logFileName);
```

Include `logFile` in the `AGENT_RUN_STARTED` broadcast (line ~4517):
```typescript
broadcast(IPC_CHANNELS.AGENT_RUN_STARTED, { runId, agentId, agentName, siteNames, logFile: logFilePath });
```

Pass `logFileName` to `runner.run()` (line ~4552):
```typescript
lastRunResult = await runner.run(agent, scopedEvent, { fullRun: fullRun ?? false, logFileName });
```

Update the `logPath` used for outcome parsing (line ~4542) to use the same per-run file:
```typescript
const logPath = logFilePath;  // already computed above — replace the path.join block
const lastSize = _fs.existsSync(logPath) ? _fs.statSync(logPath).size : 0;
```

Update `AGENT_LOG_OPEN` handler to accept an optional `logFile` parameter:
```typescript
safeHandle(IPC_CHANNELS.AGENT_LOG_OPEN, (_event, { agentId, logFile }: { agentId: string; logFile?: string }) => {
  const { shell } = require('electron');
  const _path = require('path') as typeof import('path');
  const _os   = require('os')   as typeof import('os');
  const target = logFile ?? _path.join(
    _os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', agentId, 'logs', 'agent.log',
  );
  shell.openPath(target);
  return { ok: true };
});
```

- [ ] **Step 5: Update GraphQL schema and resolver**

In `src/main/graphql/schema.ts`, add to `AgentRunRecord`:
```graphql
logFile: String
```

In `src/main/graphql/resolvers.ts`, update the `agentRunHistory` resolver row mapping to include:
```typescript
logFile: r.logFile ?? null,
```

- [ ] **Step 6: Update renderer types, RunStore, and AgentRunList**

**`src/renderer/components/agents/AgentStore.ts`** — add to `AgentRunRecord`:
```typescript
logFile?: string;
```

**`src/renderer/components/agents/RunStore.ts`** — update `startRun()` to accept and use `logFile`:

```typescript
startRun(params: { runId: string; agentId: string; agentName: string; siteNames: string[]; logFile?: string }): void {
```

In `startWatching()` (line 137), replace the hardcoded `agent.log` path with the per-run path:
```typescript
private startWatching(agentId: string, startedAt: number, logFile?: string): void {
  const logPath = logFile ?? path.join(
    os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', agentId, 'logs', 'agent.log',
  );
```

Pass `logFile` from `startRun()` to `startWatching()`:
```typescript
// In startRun():
this.startWatching(params.agentId, run.startedAt, params.logFile);
```

In `AgentConsoleTab.tsx`, find where `runStore.startRun()` is called on the `AGENT_RUN_STARTED` event and pass `logFile` from the payload:
```typescript
runStore.startRun({ runId, agentId, agentName, siteNames, logFile: payload.logFile });
```

**`src/renderer/components/agents/AgentRunList.tsx`** — update the Log chip `onClick` to pass `run.logFile`:
```typescript
onClick: () => this.props.electron?.ipcRenderer?.invoke(
  IPC_CHANNELS.AGENT_LOG_OPEN,
  { agentId: this.props.agentId, logFile: run.logFile },
),
```

Also update the GQL query in `loadRuns()` to include `logFile`:
```typescript
query: `query AgentRunHistory($agentName: String!) {
  agentRunHistory(agentName: $agentName, limit: 50) {
    id agentName startedAt finishedAt status error summary findingsCount logFile
  }
}`,
```

- [ ] **Step 7: Remove `log.info(reportLines)` from seo-insights**

In `agents/seo-insights/agent.ts`, find the line `log.info(reportLines)` (around line 1635) and delete it. The report is already returned as `{ summary: reportLines }` which the UI renders via the Report chip — it does not need to also appear in the log file.

- [ ] **Step 8: Build and verify**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add \
  src/main/agent-sdk/types.ts \
  src/main/agent-runtime/buildAgentContext.ts \
  src/main/agent-runtime/AgentRunner.ts \
  src/main/agent-runtime/AgentStateStore.ts \
  src/main/ipc-handlers.ts \
  src/main/graphql/schema.ts \
  src/main/graphql/resolvers.ts \
  src/renderer/components/agents/AgentStore.ts \
  src/renderer/components/agents/RunStore.ts \
  src/renderer/components/agents/AgentRunList.tsx \
  agents/seo-insights/agent.ts
git commit -m "feat: per-run log files; separate report from log; Log chip opens run-specific file"
```

---

### Task 2: Sandbox reindexing after pull (Issue 3)

**Files:**
- Modify: `agents/seo-insights/agent.ts` (repo copy)

**Interfaces:**
- Consumes: `reindex_site` (built-in tool — triggers async reindex), `get_index_status` (already in tools[])
- No interface changes needed

---

- [ ] **Step 1: Add `reindex_site` to seo-insights `tools[]`**

In `agents/seo-insights/agent.ts`, add to the `tools` array in `defineAgent`:
```typescript
'reindex_site',
```

- [ ] **Step 2: Add reindex + poll helper function**

Add this helper function before `run()` in the agent file:

```typescript
async function waitForIndex(
  siteName: string,
  tools: { invoke(name: string, args: unknown): Promise<unknown> },
  log: any,
  maxWaitMs = 90_000,
): Promise<boolean> {
  // Trigger reindex (async — returns immediately)
  try {
    await tools.invoke('reindex_site', { site: siteName });
    log.info(`[SEO] Reindexing ${siteName}…`);
  } catch (err: unknown) {
    log.warn(`[SEO] reindex_site failed: ${(err as Error).message} — analysis may find 0 posts`);
    return false;
  }

  // Poll get_index_status until indexed or timeout
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000));
    try {
      const status = await tools.invoke('get_index_status', { site: siteName }) as string;
      if (typeof status === 'string' && !status.includes('not been indexed') && !status.includes('Indexing')) {
        log.info(`[SEO] Index ready for ${siteName}`);
        return true;
      }
    } catch { /* keep polling */ }
  }
  log.warn(`[SEO] Index not ready after ${maxWaitMs / 1000}s — continuing with whatever is available`);
  return false;
}
```

- [ ] **Step 3: Call `waitForIndex` after sandbox is started**

In `run()`, find the section where the sandbox is created and the site is started. For WPE sites, after the sandbox pull completes and `local_start_site` is called (or the equivalent site start), add the reindex wait.

Find the line in `run()` where the sandbox analysis site is set (`analysisSite = sandbox`). After the sandbox is pulled and started, insert:

```typescript
// Reindex the sandbox so get_all_site_documents returns posts
if (createdSandbox && analysisSite) {
  await waitForIndex(analysisSite, tools, log, 90_000);
}
```

For local sites (non-sandbox path), the index may already be populated — skip reindex there, or only reindex if `get_index_status` shows the site is unindexed.

Read the `run()` function carefully to find the exact insertion point after the sandbox is ready and started.

- [ ] **Step 4: Build and verify**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add agents/seo-insights/agent.ts
git commit -m "feat(seo-insights): reindex sandbox after pull before content analysis"
```

---

## Issue 4 — Log data (no code change needed)

After completing Tasks 1 and 2:
1. `npm run build` (syncs agents to runtime, recompiles addon)
2. Restart Local (loads updated `NexusToolProvider` with contributed tool routing)
3. Run seo-insights on `jeremypollock2` again
4. Verify `getLogInsights` succeeds — look for `[LOG]` lines in the run output

The `get_log_aggregates` call uses `siteId = siteName` which should be `jeremypollock2` — matching what was used in `connect_log_source`.

---

## Self-Review

### Spec Coverage
- Per-run log file generated before AGENT_RUN_STARTED broadcast ✓
- RunStore watches per-run file during live run ✓
- AgentStateStore persists log_file per run ✓
- Historical Log chip opens run-specific file ✓
- `log.info(reportLines)` removed — report no longer appears in log ✓
- Report still available via AgentResult.summary → Report chip ✓
- Sandbox reindexed before analyzeContent ✓
- Graceful timeout if reindex doesn't complete ✓

### Gaps
- `AgentConsoleTab.tsx` not listed but needs update to pass `logFile` from AGENT_RUN_STARTED payload to `runStore.startRun()`. Find the listener with `grep -n "AGENT_RUN_STARTED\|startRun" src/renderer/components/agents/AgentConsoleTab.tsx`.

### Type Consistency
- `logFile?: string` appears in: `AgentResult`, `AgentRunRow`, `AgentRunRecord` (renderer), `AgentRunRecord` (GQL), `AgentRunList` query. All optional strings. Consistent.
- `startRun()` params: `logFile?: string` — optional so scheduler-triggered runs (no logFile) still work.
