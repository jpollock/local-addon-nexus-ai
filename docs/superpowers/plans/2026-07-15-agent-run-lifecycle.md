# Agent Run Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ad-hoc agent run lifecycle — start toast, ambient run pill (every view), run drawer with per-site status + live log, completion toast, and OS notification — so users always know when an agent run starts, progresses, and finishes.

**Architecture:** A new `nexus:agent:run-now` IPC channel fires agent runs in the background and returns `{ runId }` immediately. The main process pushes `nexus:agent:run-started` and `nexus:agent:run-complete` events to the renderer. The renderer watches the agent log file (`agents/{agentId}/logs/agent.log`) with `fs.watch` to parse per-site progress in real time. Three top-level components in `NexusOverview` — `RunToast`, `RunPill`, and `RunDrawer` — show state from a new `RunStore` singleton. Ad-hoc runs only (cron-triggered runs do not show the pill).

**Tech Stack:** React class components + `React.createElement()`, `fs.watch` for log tailing, `ipcRenderer.on()` for push events, `ipcMain` for the run-now handler, existing `AgentRunner`/`AgentRegistry` from the agent runtime.

## Global Constraints

- All renderer components: class-based, `React.createElement()` only, no JSX
- Design tokens from `agent-console.css` (`--ag-*` variables)
- `electron` prop follows the same thread-through pattern as `NexusOverview` → child components
- Running color: `#35d0c5` (teal). Clean: `#3ecf8e`. Has-failures: `#f5b544`. Log levels: info `#9aa1ac` / ok `#3ecf8e` / warn `#f5b544` / error `#f4685f`
- Sites appear in the drawer as they are processed (not pre-populated as queued)
- Run pill is visible on EVERY view inside Nexus, not just the Agents tab
- TypeScript must compile clean: `npm run compile 2>&1 | head -5`
- IPC channel name: `nexus-ai:agent:run-now` (follows the `nexus-ai:` prefix from `IPC_CHANNELS`)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/renderer/components/agents/RunStore.ts` | Create | `Run` state, pub/sub singleton, log file watcher |
| `src/renderer/components/agents/RunToast.tsx` | Create | Start toast (5s auto-dismiss) + completion toast (persists) |
| `src/renderer/components/agents/RunPill.tsx` | Create | Bottom-right ambient pill, every view |
| `src/renderer/components/agents/RunDrawer.tsx` | Create | Right 540px panel: per-site status + live log |
| `src/renderer/components/NexusOverview.tsx` | Modify | Mount RunToast, RunPill, RunDrawer at top level; subscribe to run-started push |
| `src/renderer/components/agents/AgentRunModal.tsx` | Modify | Call `nexus-ai:agent:run-now` IPC instead of `agentRun` mutation on confirm |
| `src/common/constants.ts` | Modify | Add `AGENT_RUN_NOW`, `AGENT_RUN_STARTED`, `AGENT_RUN_COMPLETE`, `AGENT_RUN_LOG_LINE` channels |
| `src/main/ipc-handlers.ts` | Modify | Register `nexus-ai:agent:run-now` handler; push run-started/complete to renderer |

---

### Task 1: IPC channels + constants + backend handler

**Files:**
- Modify: `src/common/constants.ts`
- Modify: `src/main/ipc-handlers.ts`

**Interfaces:**
- Produces: `IPC_CHANNELS.AGENT_RUN_NOW` — handler accepts `{ agentId: string; siteNames: string[] }`, returns `{ runId: string }`
- Produces: `IPC_CHANNELS.AGENT_RUN_STARTED` — push event payload `{ runId: string; agentId: string; agentName: string; siteNames: string[] }`
- Produces: `IPC_CHANNELS.AGENT_RUN_COMPLETE` — push event payload `{ runId: string; doneCount: number; failedCount: number; findingsSites: string[] }`

- [ ] **Step 1: Add IPC channel constants**

In `src/common/constants.ts`, find the `IPC_CHANNELS` object and add:

```typescript
  AGENT_RUN_NOW:      `${ADDON_PREFIX}:agent:run-now`,
  AGENT_RUN_STARTED:  `${ADDON_PREFIX}:agent:run-started`,
  AGENT_RUN_COMPLETE: `${ADDON_PREFIX}:agent:run-complete`,
```

- [ ] **Step 2: Register the run-now IPC handler**

In `src/main/ipc-handlers.ts`, near the end of `registerIpcHandlers` (after other agent-related handlers), add:

```typescript
safeHandle(IPC_CHANNELS.AGENT_RUN_NOW, async (_event, { agentId, siteNames }: { agentId: string; siteNames: string[] }) => {
  const runId = `run-${Date.now()}`;
  const agent = nexusServices?.agentRegistry?.get(agentId);
  const agentName = agent?.name || agentId;

  // Broadcast run-started to all renderer windows immediately
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const broadcast = (channel: string, payload: unknown) => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    });
  };

  broadcast(IPC_CHANNELS.AGENT_RUN_STARTED, { runId, agentId, agentName, siteNames });

  // Fire agent runs in background — one scoped wpe:sync.completed event per site
  // so the sentinel picks each up and processes it
  (async () => {
    let doneCount = 0;
    let failedCount = 0;
    const findingsSites: string[] = [];

    for (const siteName of siteNames) {
      try {
        if (nexusServices?.agentEventBus) {
          nexusServices.agentEventBus.publish({
            namespace: 'wpe',
            type: 'sync.completed',
            key: 'wpe:sync.completed',
            siteId: siteName,
            payload: { installName: siteName, installId: siteName, siteId: siteName },
            createdAt: Date.now(),
          });
        }
        doneCount++;
      } catch {
        failedCount++;
      }
    }

    // Wait for the sweep to complete — poll the agent log for "sweep complete"
    // Allow up to 30 minutes; broadcast complete when detected
    const logPath = require('path').join(
      require('os').homedir(),
      'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', agentId, 'logs', 'agent.log',
    );
    const fs = require('fs') as typeof import('fs');
    let waited = 0;
    const POLL_MS = 5000;
    const MAX_MS = 30 * 60 * 1000;
    const lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        waited += POLL_MS;
        if (waited >= MAX_MS) { clearInterval(interval); resolve(); return; }
        try {
          const content = fs.readFileSync(logPath, 'utf-8');
          // Check for sweep complete after the run started
          const afterStart = content.slice(lastSize);
          if (afterStart.includes('sweep complete')) { clearInterval(interval); resolve(); }
        } catch { /* file may not exist yet */ }
      }, POLL_MS);
    });

    broadcast(IPC_CHANNELS.AGENT_RUN_COMPLETE, { runId, doneCount, failedCount, findingsSites });
  })();

  return { runId };
});
```

- [ ] **Step 3: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts
git commit -m "feat(run-lifecycle): add AGENT_RUN_NOW IPC handler and run-started/complete push channels"
```

---

### Task 2: RunStore

**Files:**
- Create: `src/renderer/components/agents/RunStore.ts`

**Interfaces:**
- Produces: `RunStore` singleton with `getState()`, `setState()`, `subscribe()`, `unsubscribe()`
- Produces: `Run` and `LogLine` types consumed by Tasks 3-5

- [ ] **Step 1: Create RunStore.ts**

Create `src/renderer/components/agents/RunStore.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type SiteRunStatus = 'running' | 'done' | 'findings' | 'failed';

export interface LogLine {
  ts: string;       // 'mm:ss'
  site: string;
  msg: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

export interface Run {
  runId: string;
  agentId: string;
  agentName: string;
  siteNames: string[];
  phase: 'running' | 'done';
  cancelled?: boolean;
  startedAt: number;
  endedAt?: number;
  doneCount: number;
  failedCount: number;
  findingsSites: string[];
  siteStatus: Record<string, SiteRunStatus>;
  log: LogLine[];
}

interface RunState {
  currentRun: Run | null;
  drawerOpen: boolean;
}

function parseLogLine(rawLine: string, startedAt: number): { site: string; msg: string; level: LogLine['level'] } | null {
  // Format: [INFO/WARN/ERROR] 2026-07-15T... [message]
  // Extract meaningful content
  const timeMatch = rawLine.match(/^\[(\w+)\]\s+[\d\-T:.Z]+\s+(.+)$/);
  if (!timeMatch) return null;
  const [, levelRaw, content] = timeMatch;
  const level: LogLine['level'] = levelRaw === 'WARN' ? 'warn' : levelRaw === 'ERROR' ? 'error' : 'info';

  // Parse site from content: "security-sentinel: theawfulpmtest — ..."
  const siteMatch = content.match(/^security-sentinel:\s+([\w-]+)\s+[—–]/);
  const site = siteMatch ? siteMatch[1] : '';

  // Determine ok vs info
  const effectiveLevel: LogLine['level'] = content.includes('✓ clean') ? 'ok'
    : content.includes('finding(s)') || content.includes('ESCALATING') ? 'warn'
    : level;

  return { site, msg: content, level: effectiveLevel };
}

function elapsedSeconds(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

class RunStore {
  private state: RunState = { currentRun: null, drawerOpen: false };
  private listeners = new Set<() => void>();
  private watcher: fs.FSWatcher | null = null;
  private logOffset = 0;

  getState(): RunState { return this.state; }

  setState(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  subscribe(fn: () => void): void   { this.listeners.add(fn); }
  unsubscribe(fn: () => void): void { this.listeners.delete(fn); }

  startRun(params: { runId: string; agentId: string; agentName: string; siteNames: string[] }): void {
    const run: Run = {
      ...params,
      phase: 'running',
      startedAt: Date.now(),
      doneCount: 0,
      failedCount: 0,
      findingsSites: [],
      siteStatus: {},
      log: [],
    };
    this.setState({ currentRun: run });
    this.startWatching(params.agentId, run.startedAt);
  }

  completeRun(payload: { runId: string; doneCount: number; failedCount: number; findingsSites: string[] }): void {
    const run = this.state.currentRun;
    if (!run || run.runId !== payload.runId) return;
    this.stopWatching();
    this.setState({
      currentRun: {
        ...run,
        phase: 'done',
        endedAt: Date.now(),
        doneCount: payload.doneCount,
        failedCount: payload.failedCount,
        findingsSites: payload.findingsSites,
      },
    });
  }

  dismissRun(): void {
    this.stopWatching();
    this.setState({ currentRun: null, drawerOpen: false });
    this.logOffset = 0;
  }

  toggleDrawer(): void {
    this.setState({ drawerOpen: !this.state.drawerOpen });
  }

  getElapsed(): string {
    const run = this.state.currentRun;
    if (!run) return '0:00';
    const secs = elapsedSeconds(run.startedAt);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private startWatching(agentId: string, startedAt: number): void {
    const logPath = path.join(
      os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
      'agents', agentId, 'logs', 'agent.log',
    );
    // Record current file size so we only read new content
    try { this.logOffset = fs.statSync(logPath).size; } catch { this.logOffset = 0; }

    const processNewLines = () => {
      const run = this.state.currentRun;
      if (!run) return;
      try {
        const stat = fs.statSync(logPath);
        if (stat.size <= this.logOffset) return;
        const buf = Buffer.alloc(stat.size - this.logOffset);
        const fd = fs.openSync(logPath, 'r');
        fs.readSync(fd, buf, 0, buf.length, this.logOffset);
        fs.closeSync(fd);
        this.logOffset = stat.size;

        const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
        const newLog: LogLine[] = [];
        const siteUpdates: Record<string, SiteRunStatus> = {};

        for (const raw of newLines) {
          const parsed = parseLogLine(raw, startedAt);
          if (!parsed) continue;

          const secs = elapsedSeconds(startedAt);
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          newLog.push({
            ts: `${m}:${s.toString().padStart(2, '0')}`,
            site: parsed.site,
            msg: parsed.msg,
            level: parsed.level,
          });

          // Derive per-site status from log content
          if (parsed.site) {
            if (parsed.msg.includes('✓ clean')) {
              siteUpdates[parsed.site] = 'done';
            } else if (parsed.msg.includes('ESCALATING') || parsed.msg.includes('Tier 2')) {
              siteUpdates[parsed.site] = 'running';
            } else if (parsed.msg.includes('finding(s)') || parsed.msg.includes('CRITICAL') || parsed.msg.includes('Active threat')) {
              siteUpdates[parsed.site] = 'findings';
            }
          }
        }

        if (newLog.length > 0 || Object.keys(siteUpdates).length > 0) {
          this.setState({
            currentRun: {
              ...run,
              log: [...run.log, ...newLog].slice(-500), // keep last 500 lines
              siteStatus: { ...run.siteStatus, ...siteUpdates },
            },
          });
        }
      } catch { /* file not ready yet */ }
    };

    try {
      this.watcher = fs.watch(logPath, { persistent: false }, () => processNewLines());
    } catch {
      // File may not exist yet — poll instead
      const interval = setInterval(() => {
        if (!this.state.currentRun) { clearInterval(interval); return; }
        processNewLines();
        if (!this.watcher) {
          try {
            this.watcher = fs.watch(logPath, { persistent: false }, () => processNewLines());
            clearInterval(interval);
          } catch { /* keep polling */ }
        }
      }, 2000);
    }
  }

  private stopWatching(): void {
    if (this.watcher) {
      try { this.watcher.close(); } catch {}
      this.watcher = null;
    }
  }
}

export const runStore = new RunStore();
```

- [ ] **Step 2: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/RunStore.ts
git commit -m "feat(run-lifecycle): add RunStore with log file watcher and per-site status parsing"
```

---

### Task 3: RunToast

**Files:**
- Create: `src/renderer/components/agents/RunToast.tsx`

**Interfaces:**
- Consumes: `runStore.getState().currentRun`
- Produces: `RunToast` component — props: `{ electron: any }` — renders start toast OR completion toast based on run phase

The toast is top-right, 360px, uses `slideIn` animation. Start toast auto-dismisses after 5s; completion toast persists.

- [ ] **Step 1: Create RunToast.tsx**

Create `src/renderer/components/agents/RunToast.tsx`:

```typescript
import * as React from 'react';
import { runStore, Run } from './RunStore';

interface ToastProps {
  onViewProgress: () => void;
  onViewReport: () => void;
}

interface ToastState {
  run: Run | null;
  startDismissed: boolean;
}

export class RunToast extends React.Component<ToastProps, ToastState> {
  state: ToastState = { run: runStore.getState().currentRun, startDismissed: false };
  private unsub!: () => void;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidMount() {
    const update = () => {
      const prev = this.state.run;
      const next = runStore.getState().currentRun;
      // When a new run starts, reset dismissed state
      if (next && (!prev || next.runId !== prev?.runId)) {
        this.setState({ run: next, startDismissed: false });
        // Auto-dismiss the start toast after 5s
        if (this.autoTimer) clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => this.setState({ startDismissed: true }), 5000);
      } else {
        this.setState({ run: next });
      }
    };
    runStore.subscribe(update);
    this.unsub = update;
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }

  render() {
    const { run, startDismissed } = this.state;
    const { onViewProgress, onViewReport } = this.props;
    if (!run) return null;

    const isDone = run.phase === 'done';
    const isClean = isDone && run.failedCount === 0;
    const accentColor = isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';

    // Start toast: show while running and not dismissed
    if (!isDone && !startDismissed) {
      return React.createElement('div', {
        style: {
          position: 'fixed', top: 20, right: 20, width: 360, zIndex: 200,
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderLeft: `4px solid ${accentColor}`, borderRadius: 12,
          padding: '14px 18px', animation: 'slideIn 0.28s ease',
          display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        },
      },
        React.createElement('span', {
          style: { fontSize: 18, animation: 'spin 0.9s linear infinite', display: 'inline-block', flexShrink: 0 },
        }, '⟳'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
            `${run.agentName} started on ${run.siteNames.length} site${run.siteNames.length !== 1 ? 's' : ''}.`,
          ),
        ),
        React.createElement('button', {
          onClick: onViewProgress,
          style: { background: 'none', border: 'none', color: 'var(--ag-teal)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0, padding: '0 0 0 4px' },
        }, 'View progress'),
        React.createElement('button', {
          onClick: () => this.setState({ startDismissed: true }),
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 14, cursor: 'pointer', padding: 0 },
        }, '✕'),
      );
    }

    // Completion toast: show when done until dismissed
    if (isDone) {
      const summaryText = isClean
        ? `${run.agentName} finished — all sites clean.`
        : `${run.agentName} finished · ${run.failedCount} failed · ${run.findingsSites.length} need review`;
      return React.createElement('div', {
        style: {
          position: 'fixed', top: 20, right: 20, width: 360, zIndex: 200,
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderLeft: `4px solid ${accentColor}`, borderRadius: 12,
          padding: '14px 18px', animation: 'slideIn 0.28s ease',
          display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        },
      },
        React.createElement('span', { style: { fontSize: 18, color: accentColor, flexShrink: 0 } }, isClean ? '✓' : '!'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-primary)' } }, summaryText),
        ),
        React.createElement('button', {
          onClick: onViewReport,
          style: { background: 'none', border: 'none', color: accentColor, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0, padding: '0 4px' },
        }, 'View report'),
        React.createElement('button', {
          onClick: () => runStore.dismissRun(),
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 14, cursor: 'pointer', padding: 0 },
        }, '✕'),
      );
    }

    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/agents/RunToast.tsx
git commit -m "feat(run-lifecycle): add RunToast component (start + completion toasts)"
```

---

### Task 4: RunPill + RunDrawer

**Files:**
- Create: `src/renderer/components/agents/RunPill.tsx`
- Create: `src/renderer/components/agents/RunDrawer.tsx`

**Interfaces:**
- Both consume `runStore.getState()`
- `RunPill` renders bottom-right, always visible while run exists and drawer is closed
- `RunDrawer` renders as a 540px right panel with per-site status list + live log

- [ ] **Step 1: Create RunPill.tsx**

Create `src/renderer/components/agents/RunPill.tsx`:

```typescript
import * as React from 'react';
import { runStore, Run } from './RunStore';

interface PillProps {
  onOpen: () => void;
}

interface PillState { run: Run | null; elapsed: string; drawerOpen: boolean; }

export class RunPill extends React.Component<PillProps, PillState> {
  state: PillState = { run: runStore.getState().currentRun, elapsed: '0:00', drawerOpen: runStore.getState().drawerOpen };
  private unsub!: () => void;
  private ticker: ReturnType<typeof setInterval> | null = null;

  componentDidMount() {
    const update = () => this.setState({ run: runStore.getState().currentRun, elapsed: runStore.getElapsed(), drawerOpen: runStore.getState().drawerOpen });
    runStore.subscribe(update);
    this.unsub = update;
    this.ticker = setInterval(() => this.setState({ elapsed: runStore.getElapsed() }), 1000);
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.ticker) clearInterval(this.ticker);
  }

  render() {
    const { run, elapsed, drawerOpen } = this.state;
    const { onOpen } = this.props;
    if (!run || drawerOpen) return null;

    const isDone = run.phase === 'done';
    const doneSites = Object.values(run.siteStatus).filter(s => s === 'done' || s === 'findings' || s === 'failed').length;
    const isClean = isDone && run.failedCount === 0;
    const accentColor = isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';
    const totalSites = run.siteNames.length;

    // Progress bar width
    const progress = totalSites > 0 ? (doneSites / totalSites) * 100 : 0;

    return React.createElement('div', {
      onClick: onOpen,
      style: {
        position: 'fixed', bottom: 20, right: 20, width: 280, zIndex: 199,
        background: 'var(--ag-bg-card)', border: `1px solid ${accentColor}40`,
        borderRadius: 12, padding: '12px 16px', cursor: 'pointer',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)', animation: 'fadeUp 0.25s ease',
      },
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
        React.createElement('span', {
          style: {
            fontSize: 16, color: accentColor, flexShrink: 0,
            animation: isDone ? 'none' : 'spin 0.9s linear infinite', display: 'inline-block',
          },
        }, isDone ? (isClean ? '✓' : '!') : '⟳'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 1 } },
            isDone ? `${run.agentName} done` : `${run.agentName} running`,
          ),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } },
            isDone
              ? `${run.doneCount} done · ${run.failedCount} failed · ${run.findingsSites.length} review`
              : `${doneSites} / ${totalSites} sites · ${elapsed} elapsed`,
          ),
        ),
        isDone && React.createElement('button', {
          onClick: (e: MouseEvent) => { e.stopPropagation(); runStore.dismissRun(); },
          style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', cursor: 'pointer', fontSize: 14, padding: 0 },
        }, '✕'),
      ),
      // Progress bar
      React.createElement('div', { style: { height: 4, background: 'var(--ag-bg-elevated)', borderRadius: 2, overflow: 'hidden' } },
        React.createElement('div', {
          style: { height: '100%', width: `${isDone ? 100 : progress}%`, background: accentColor, borderRadius: 2, transition: 'width 0.3s' },
        }),
      ),
    );
  }
}
```

- [ ] **Step 2: Create RunDrawer.tsx**

Create `src/renderer/components/agents/RunDrawer.tsx`:

```typescript
import * as React from 'react';
import { runStore, Run, LogLine, SiteRunStatus } from './RunStore';

interface DrawerState { run: Run | null; elapsed: string; }

const STATUS_ICON: Record<SiteRunStatus, string> = {
  running: '⟳', done: '✓', findings: '!', failed: '✗',
};
const STATUS_COLOR: Record<SiteRunStatus, string> = {
  running: 'var(--ag-teal)', done: 'var(--ag-green)', findings: 'var(--ag-amber)', failed: 'var(--ag-red)',
};
const LOG_COLORS: Record<LogLine['level'], string> = {
  info: '#9aa1ac', ok: '#3ecf8e', warn: '#f5b544', error: '#f4685f',
};

export class RunDrawer extends React.Component<Record<string, never>, DrawerState> {
  state: DrawerState = { run: runStore.getState().currentRun, elapsed: '0:00' };
  private unsub!: () => void;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private logRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    const update = () => this.setState({ run: runStore.getState().currentRun, elapsed: runStore.getElapsed() });
    runStore.subscribe(update);
    this.unsub = update;
    this.ticker = setInterval(() => this.setState({ elapsed: runStore.getElapsed() }), 1000);
  }

  componentDidUpdate() {
    // Auto-scroll log to newest
    if (this.logRef.current) {
      this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
    }
  }

  componentWillUnmount() {
    runStore.unsubscribe(this.unsub);
    if (this.ticker) clearInterval(this.ticker);
  }

  render() {
    const { run, elapsed } = this.state;
    if (!run || !runStore.getState().drawerOpen) return null;

    const isDone = run.phase === 'done';
    const isClean = isDone && run.failedCount === 0;
    const accentColor = isDone ? (isClean ? 'var(--ag-green)' : 'var(--ag-amber)') : 'var(--ag-teal)';
    const doneSites = Object.values(run.siteStatus).filter(s => s !== 'running').length;
    const totalSites = run.siteNames.length;
    const progress = totalSites > 0 ? (doneSites / totalSites) * 100 : 0;

    const activeSites = Object.entries(run.siteStatus);

    return React.createElement('div', null,
      // Scrim (click to close)
      React.createElement('div', {
        onClick: () => runStore.toggleDrawer(),
        style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.4)', zIndex: 198 },
      }),

      // Drawer
      React.createElement('div', {
        style: {
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 540,
          background: 'var(--ag-bg-card)', borderLeft: '1px solid var(--ag-border)',
          zIndex: 199, display: 'flex', flexDirection: 'column', animation: 'slideIn 0.28s ease',
        },
      },
        // Header
        React.createElement('div', { style: { padding: '18px 22px', borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
            React.createElement('span', {
              style: { fontSize: 20, color: accentColor, animation: isDone ? 'none' : 'spin 0.9s linear infinite', display: 'inline-block' },
            }, isDone ? (isClean ? '✓' : '!') : '⟳'),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
                `${run.agentName} ${isDone ? 'done' : 'running'}`,
              ),
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } },
                isDone
                  ? `Finished in ${elapsed}`
                  : `${doneSites} of ${totalSites} sites · ${elapsed} elapsed`,
              ),
            ),
            React.createElement('button', {
              onClick: () => runStore.toggleDrawer(),
              style: { background: 'none', border: 'none', color: 'var(--ag-text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 },
            }, '✕'),
          ),

          // Progress bar
          React.createElement('div', { style: { height: 5, background: 'var(--ag-bg-elevated)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 } },
            React.createElement('div', { style: { height: '100%', width: `${isDone ? 100 : progress}%`, background: accentColor, borderRadius: 3, transition: 'width 0.5s' } }),
          ),

          // Stat line
          React.createElement('div', { style: { display: 'flex', gap: 16, fontSize: 12.5 } },
            React.createElement('span', { style: { color: 'var(--ag-green)' } }, `✓ ${run.doneCount} done`),
            run.failedCount > 0 && React.createElement('span', { style: { color: 'var(--ag-red)' } }, `! ${run.failedCount} failed`),
            run.findingsSites.length > 0 && React.createElement('span', { style: { color: 'var(--ag-amber)' } }, `◷ ${run.findingsSites.length} need review`),
          ),
        ),

        // Per-site status list
        activeSites.length > 0 && React.createElement('div', {
          style: { padding: '14px 22px', borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0 },
        },
          React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10 } },
            `Sites (${activeSites.length})`,
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
            ...activeSites.map(([site, status]) =>
              React.createElement('div', {
                key: site,
                style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 },
              },
                React.createElement('span', {
                  style: {
                    color: STATUS_COLOR[status], fontSize: 14, flexShrink: 0,
                    animation: status === 'running' ? 'spin 0.9s linear infinite' : 'none',
                    display: 'inline-block',
                  },
                }, STATUS_ICON[status]),
                React.createElement('span', { style: { color: 'var(--ag-text-primary)', fontWeight: 500 } }, site),
                React.createElement('span', { style: { color: 'var(--ag-text-muted)', fontSize: 11.5 } },
                  status === 'findings' ? '· findings detected' : status === 'failed' ? '· failed' : '',
                ),
              ),
            ),
          ),
        ),

        // Live log console
        React.createElement('div', {
          ref: this.logRef,
          style: {
            flex: 1, overflowY: 'auto' as const, background: '#0d0f13',
            padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
          },
        },
          run.log.length === 0
            ? React.createElement('div', { style: { color: '#4a4d55', padding: '20px 0', textAlign: 'center' as const } }, 'Waiting for output…')
            : run.log.map((line, i) =>
                React.createElement('div', {
                  key: i,
                  style: { display: 'flex', gap: 12, marginBottom: 3, lineHeight: 1.5 },
                },
                  React.createElement('span', { style: { color: '#4a4d55', flexShrink: 0, width: 36 } }, line.ts),
                  line.site && React.createElement('span', { style: { color: '#6b7280', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, line.site),
                  React.createElement('span', { style: { color: LOG_COLORS[line.level], wordBreak: 'break-word' as const } }, line.msg),
                ),
              ),
        ),

        // Completion actions
        isDone && React.createElement('div', {
          style: { padding: '14px 22px', borderTop: '1px solid var(--ag-border-subtle)', display: 'flex', gap: 10, flexShrink: 0 },
        },
          run.findingsSites.length > 0 && React.createElement('button', {
            style: { flex: 2, padding: '9px 0', background: 'var(--ag-teal)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--ag-on-teal)', cursor: 'pointer' },
          }, `Review ${run.findingsSites.length} site${run.findingsSites.length !== 1 ? 's' : ''}`),
          React.createElement('button', {
            onClick: () => runStore.dismissRun(),
            style: { flex: 1, padding: '9px 0', background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border)', borderRadius: 8, fontSize: 13, color: 'var(--ag-text-secondary)', cursor: 'pointer' },
          }, 'Dismiss'),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/RunPill.tsx src/renderer/components/agents/RunDrawer.tsx
git commit -m "feat(run-lifecycle): add RunPill (ambient progress) and RunDrawer (per-site status + live log)"
```

---

### Task 5: Wire into NexusOverview + AgentRunModal

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx`
- Modify: `src/renderer/components/agents/AgentRunModal.tsx`

**Interfaces:**
- `NexusOverview` subscribes to `nexus-ai:agent:run-started` and `nexus-ai:agent:run-complete` IPC events; mounts `RunToast`, `RunPill`, `RunDrawer`
- `AgentRunModal.onRun` calls `electron.ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_NOW, ...)` instead of firing individual `agentRun` mutations

- [ ] **Step 1: Wire NexusOverview**

In `src/renderer/components/NexusOverview.tsx`:

**a) Add imports:**
```typescript
import { runStore } from './agents/RunStore';
import { RunToast } from './agents/RunToast';
import { RunPill } from './agents/RunPill';
import { RunDrawer } from './agents/RunDrawer';
import { IPC_CHANNELS } from '../../common/constants';
```

**b) In `componentDidMount` (or the equivalent mount lifecycle where IPC listeners are registered):**
```typescript
const ipc = this.props.electron.ipcRenderer;
ipc.on(IPC_CHANNELS.AGENT_RUN_STARTED, (_event: any, payload: any) => {
  runStore.startRun(payload);
});
ipc.on(IPC_CHANNELS.AGENT_RUN_COMPLETE, (_event: any, payload: any) => {
  runStore.completeRun(payload);
  // OS notification
  if (typeof Notification !== 'undefined' && document.visibilityState === 'hidden') {
    new Notification(`${runStore.getState().currentRun?.agentName || 'Agent'} run complete`, {
      body: payload.failedCount === 0 ? 'All sites clean.' : `${payload.failedCount} failed, ${payload.findingsSites?.length || 0} need review.`,
    });
  }
});
```

**c) In `componentWillUnmount` (cleanup):**
```typescript
const ipc = this.props.electron.ipcRenderer;
ipc.removeAllListeners(IPC_CHANNELS.AGENT_RUN_STARTED);
ipc.removeAllListeners(IPC_CHANNELS.AGENT_RUN_COMPLETE);
```

**d) In `render()`, add the three components as siblings to the main content (they render as fixed/absolute overlays, so placement in the tree doesn't matter visually):**
```typescript
// Add at the end of the return, alongside existing content:
React.createElement(RunToast, {
  onViewProgress: () => runStore.setState({ drawerOpen: true }),
  onViewReport: () => runStore.setState({ drawerOpen: true }),
}),
React.createElement(RunPill, {
  onOpen: () => runStore.setState({ drawerOpen: true }),
}),
React.createElement(RunDrawer, {}),
```

- [ ] **Step 2: Update AgentRunModal to use run-now IPC**

In `src/renderer/components/agents/AgentRunModal.tsx`, update the `handleRun()` method:

```typescript
private async handleRun() {
  const { onRun, electron } = this.props;
  const filtered = this.getFiltered();
  const toRun = filtered.filter(s => this.state.selected.has(s.id)).map(s => s.name);

  // Fire the IPC run-now channel — returns { runId } immediately
  try {
    await electron.ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_NOW, {
      agentId: this.props.agentId,
      siteNames: toRun,
    });
  } catch (err) {
    console.warn('[AgentRunModal] run-now IPC failed:', err);
  }

  onRun(toRun); // close the modal
}
```

Also add the import at the top:
```typescript
import { IPC_CHANNELS } from '../../../common/constants';
```

- [ ] **Step 3: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/NexusOverview.tsx src/renderer/components/agents/AgentRunModal.tsx
git commit -m "feat(run-lifecycle): wire RunToast/RunPill/RunDrawer into NexusOverview; AgentRunModal calls run-now IPC"
```

---

## Self-Review

**Spec coverage:**

| Design requirement | Plan task |
|---|---|
| Start toast (top-right, 5s auto-dismiss) | Task 3: RunToast |
| Run pill (bottom-right, every view) | Task 4: RunPill |
| Run drawer (per-site status + live log) | Task 4: RunDrawer |
| Completion toast (persists, View report) | Task 3: RunToast done state |
| OS notification when window unfocused | Task 5: NexusOverview Notification API |
| Log file watching → per-site progress | Task 2: RunStore.startWatching() |
| Ad-hoc only (not cron) | Task 1: only fires from run-now IPC, not AgentRunner |
| Sites appear as processed (not pre-queued) | Task 2: siteStatus populated from log lines only |
| Cancel run button | RunDrawer — not wired to actual cancellation (prototype parity) |
