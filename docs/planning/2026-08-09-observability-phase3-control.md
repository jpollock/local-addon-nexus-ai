# Observability Phase 3 — Levels, retention, and disk visibility

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the logs a control surface — a level you can change, a retention policy that bounds the directory, and a Preferences panel that shows where the logs are and what they cost you in disk.

**Architecture:** Phase 1 hardcoded `minLevel: 'INFO'` at construction and bounded a single day's file by size, leaving nothing to bound the number of days. This adds a global level in `NexusSettings` with a per-agent override, day-based retention with a total disk budget and oldest-first eviction, and a Logging panel in Preferences. Retention runs on the existing scheduler tick pattern, not a new timer.

**Tech Stack:** TypeScript, Jest, `src/main/logging/rotate.ts` (`pruneOldFiles` already exists and is unused here), React class components with `React.createElement` — no JSX, no hooks.

## Global Constraints

- Levels are `ERROR | WARN | INFO | DEBUG`, reusing `LogLevel` from `src/main/logging/Logger.ts`. Do not invent a scale.
- `NEXUS_LOG_LEVEL` in the environment beats any stored setting — a developer launching from a shell wins.
- **A new `NexusSettings` field MUST be added to `UpdateSettingsSchema` in `src/common/schemas.ts`.** That schema is `.strict()` and silently strips unlisted fields, so the setting appears to save and never persists. This has bitten this codebase before.
- **Retention is in days, not generations**: logs 14, transcripts 3, both configurable. A total disk budget (default 250 MB) evicts oldest-first across categories.
- **Failure-triggered preservation:** a run that errored, timed out, or performed a Tier 3 operation is exempt from day-based eviction. The runs most worth auditing must not age out on the same schedule as the quiet ones.
- **Never delete without saying what.** "Clear logs" states what it will remove before removing it.
- Logging must never throw; retention must never throw. A cleanup fault cannot fail a run.
- Renderer components are class-based with `React.createElement()` — Local's React has no hooks.
- Run tests with `npx jest <path>`. Do NOT run `npm rebuild better-sqlite3`.

---

### Task 1: A configurable global level

**Files:**
- Modify: `src/common/types.ts` (`NexusSettings`, ~line 296), `src/common/schemas.ts` (`UpdateSettingsSchema`), `src/main/index.ts` (where `EventLog` is constructed, ~line 577)
- Test: `tests/unit/logging/logLevelSetting.test.ts`

**Interfaces:**
- Produces: `NexusSettings.logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'`; `resolveLogLevel(settings, env): LogLevelName`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/logLevelSetting.test.ts
import { resolveLogLevel } from '../../../src/main/logging/resolveLogLevel';

describe('resolveLogLevel', () => {
  it('defaults to INFO when nothing is set', () => {
    expect(resolveLogLevel(undefined, {})).toBe('INFO');
    expect(resolveLogLevel({}, {})).toBe('INFO');
  });

  it('uses the stored setting', () => {
    expect(resolveLogLevel({ logLevel: 'DEBUG' }, {})).toBe('DEBUG');
  });

  it('lets the environment beat the stored setting', () => {
    // A developer launching from a shell should not have to change a stored preference to get
    // debug output for one session.
    expect(resolveLogLevel({ logLevel: 'ERROR' }, { NEXUS_LOG_LEVEL: 'DEBUG' })).toBe('DEBUG');
  });

  it('ignores a value that is not a level, rather than logging nothing', () => {
    // A typo in an env var must not silently switch the log off. Falling back to the setting —
    // and then to INFO — keeps evidence flowing.
    expect(resolveLogLevel({ logLevel: 'WARN' }, { NEXUS_LOG_LEVEL: 'LOUD' })).toBe('WARN');
    expect(resolveLogLevel({ logLevel: 'nonsense' as any }, {})).toBe('INFO');
  });

  it('accepts a level in any case', () => {
    expect(resolveLogLevel({}, { NEXUS_LOG_LEVEL: 'debug' })).toBe('DEBUG');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/logLevelSetting.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the resolver and add the setting**

```ts
// src/main/logging/resolveLogLevel.ts
import type { LogLevelName } from './eventLog';

const LEVELS: readonly LogLevelName[] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

function asLevel(value: unknown): LogLevelName | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase() as LogLevelName;
  return LEVELS.includes(upper) ? upper : undefined;
}

/**
 * The level the event log writes at.
 *
 * Order: NEXUS_LOG_LEVEL, then the stored setting, then INFO. An unrecognised value at either
 * layer is ignored rather than honoured — a typo in an env var must not silently switch logging
 * off, which is the one failure this system cannot report.
 */
export function resolveLogLevel(
  settings: { logLevel?: string } | undefined,
  env: Record<string, string | undefined>,
): LogLevelName {
  return asLevel(env.NEXUS_LOG_LEVEL) ?? asLevel(settings?.logLevel) ?? 'INFO';
}
```

Add to `NexusSettings` in `src/common/types.ts`:

```ts
  /** Level the structured event log writes at. NEXUS_LOG_LEVEL overrides it. Default INFO. */
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
```

**And to `UpdateSettingsSchema` in `src/common/schemas.ts`** — the schema is `.strict()` and will otherwise strip it:

```ts
  logLevel: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG']).optional(),
```

In `src/main/index.ts`, replace the hardcoded construction with the resolved level, and restart the log on settings change by wiring it into the existing `onSettingsUpdated` closure (grep for `const onSettingsUpdated = `).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/logging/logLevelSetting.test.ts` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Verify the schema actually persists it**

Add a test asserting `UpdateSettingsSchema.parse({ logLevel: 'DEBUG' })` returns `logLevel: 'DEBUG'`. Confirm it fails when the schema line is removed — this is the exact defect the constraint warns about.

- [ ] **Step 6: Commit**

```bash
git add src/main/logging/resolveLogLevel.ts src/common/types.ts src/common/schemas.ts src/main/index.ts tests/unit/logging/logLevelSetting.test.ts
git commit -m "feat(logging): configurable global log level"
```

---

### Task 2: Per-agent level override

**Files:**
- Modify: `src/main/logging/eventLog.ts` (`EventLog.write`), `src/renderer/components/agents/AgentStore.ts` (`AgentSettings`), `src/main/ipc-handlers.ts` (a `getAgentLogLevel` accessor beside `getAgentCadence`)
- Test: `tests/unit/logging/perAgentLevel.test.ts`

**Interfaces:**
- Consumes: `resolveLogLevel` (Task 1).
- Produces: `EventLog` accepts `levelFor?: (source: string) => LogLevelName | undefined`; `AgentSettings.logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/perAgentLevel.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-perlevel-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const AT = () => new Date('2026-08-09T10:00:00Z');
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '');
const combined = () => read(path.join(root, `nexus-${new Date(AT()).toLocaleDateString('en-CA')}.log`));

describe('per-agent level override', () => {
  it('lets one agent log DEBUG while the rest stay at INFO', () => {
    // You debug one agent, not the whole app: a global DEBUG across a fleet produces noise
    // nobody reads, which is why the override exists at all.
    const log = new EventLog({
      root, minLevel: 'INFO', now: AT,
      levelFor: (source) => (source === 'security-sentinel' ? 'DEBUG' : undefined),
    });
    log.write({ level: 'DEBUG', source: 'security-sentinel', sourceKind: 'agent', message: 'kept' } as any);
    log.write({ level: 'DEBUG', source: 'log-processor', sourceKind: 'agent', message: 'dropped' } as any);

    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('falls back to the global level when the agent has no override', () => {
    const log = new EventLog({ root, minLevel: 'WARN', now: AT, levelFor: () => undefined });
    log.write({ level: 'INFO', source: 'a', sourceKind: 'agent', message: 'dropped' } as any);
    log.write({ level: 'ERROR', source: 'a', sourceKind: 'agent', message: 'kept' } as any);
    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('an override can also be stricter than the global level', () => {
    const log = new EventLog({
      root, minLevel: 'DEBUG', now: AT,
      levelFor: (s) => (s === 'noisy' ? 'ERROR' : undefined),
    });
    log.write({ level: 'INFO', source: 'noisy', sourceKind: 'agent', message: 'dropped' } as any);
    log.write({ level: 'INFO', source: 'quiet', sourceKind: 'agent', message: 'kept' } as any);
    expect(combined()).toContain('kept');
    expect(combined()).not.toContain('dropped');
  });

  it('a throwing levelFor cannot lose the line', () => {
    // The callback reads a settings cache that may not exist yet. Failing closed here would drop
    // evidence for the least interesting reason.
    const log = new EventLog({
      root, minLevel: 'INFO', now: AT,
      levelFor: () => { throw new Error('cache not ready'); },
    });
    expect(() => log.write({ level: 'INFO', source: 'a', sourceKind: 'agent', message: 'kept' } as any)).not.toThrow();
    expect(combined()).toContain('kept');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/perAgentLevel.test.ts`
Expected: FAIL — `levelFor` is not an option.

- [ ] **Step 3: Implement**

Add `levelFor?: (source: string) => LogLevelName | undefined` to `EventLogOptions`, store it, and in `write()` resolve the effective level before the gate:

```ts
    // A per-agent override beats the global level in both directions — you debug one agent, and
    // you silence one agent, without touching the rest.
    let min = this.minLevel;
    try {
      const override = this.levelFor?.(e.source);
      if (override) min = override;
    } catch { /* a settings cache that is not ready must not drop the line */ }
    if (LogLevel[e.level] > LogLevel[min]) return;
```

Add `logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'` to `AgentSettings`, export `getAgentLogLevel(agentId)` from `ipc-handlers.ts` beside `getAgentCadence`, and pass `levelFor: (source) => getAgentLogLevel(source)` when constructing the log in `src/main/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/logging` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/eventLog.ts src/renderer/components/agents/AgentStore.ts src/main/ipc-handlers.ts src/main/index.ts tests/unit/logging/perAgentLevel.test.ts
git commit -m "feat(logging): per-agent log level override"
```

---

### Task 3: Retention — days, a disk budget, and preserved failures

**Files:**
- Create: `src/main/logging/retention.ts`
- Test: `tests/unit/logging/retention.test.ts`

**Interfaces:**
- Produces: `planRetention(files: LogFileInfo[], policy: RetentionPolicy): RetentionPlan` and `applyRetention(root, policy, now)`.
  - `interface LogFileInfo { path: string; category: 'combined' | 'agent' | 'transcript'; day: string; bytes: number; preserved: boolean }`
  - `interface RetentionPolicy { logDays: number; transcriptDays: number; budgetBytes: number }`
  - `interface RetentionPlan { deletePaths: string[]; freedBytes: number; keptBytes: number }`

**Context you need:** Phase 1's `rotateIfNeeded` bounds one day's file by size; nothing bounds the number of days, so the directory grows without limit. `pruneOldFiles(dir, pattern, keep)` already exists in `rotate.ts` but counts generations, not days — do not reuse it for this. Decide the whole plan as a pure function first, then apply it; that is what makes "what will Clear logs delete?" answerable before deleting anything.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/retention.test.ts
import { planRetention } from '../../../src/main/logging/retention';

const POLICY = { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 };
const f = (over: Partial<any> = {}) => ({
  path: '/logs/nexus-2026-08-01.log', category: 'combined' as const,
  day: '2026-08-01', bytes: 1024, preserved: false, ...over,
});

describe('planRetention', () => {
  it('keeps everything inside the day windows and under budget', () => {
    const plan = planRetention([f({ day: '2026-08-09' }), f({ day: '2026-08-08' })], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('drops logs older than logDays', () => {
    const old = f({ day: '2026-07-01', path: '/logs/old.log' });
    const plan = planRetention([old, f({ day: '2026-08-09' })], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
  });

  it('holds transcripts to a shorter window than logs', () => {
    // Transcripts carry prompt text, so they age out faster than the lines that reference them.
    const t = f({ day: '2026-08-04', category: 'transcript', path: '/logs/t.jsonl' });
    const l = f({ day: '2026-08-04', path: '/logs/keep.log' });
    const plan = planRetention([t, l], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/t.jsonl']);
  });

  it('NEVER deletes a preserved file, however old', () => {
    // A run that errored or performed a Tier 3 operation is the one most worth auditing; ageing
    // it out on the same schedule as a quiet run defeats the point of keeping logs at all.
    const kept = f({ day: '2020-01-01', preserved: true, path: '/logs/failed-run.log' });
    const plan = planRetention([kept], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('evicts oldest-first when the budget is exceeded', () => {
    const big = { ...POLICY, budgetBytes: 2048 };
    const plan = planRetention([
      f({ day: '2026-08-09', bytes: 1024, path: '/logs/new.log' }),
      f({ day: '2026-08-08', bytes: 1024, path: '/logs/mid.log' }),
      f({ day: '2026-08-07', bytes: 1024, path: '/logs/old.log' }),
    ], big);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
    expect(plan.keptBytes).toBeLessThanOrEqual(2048);
  });

  it('will not breach the budget by deleting a preserved file', () => {
    // The budget yields to preservation: going over disk is recoverable, losing the evidence of a
    // failed production run is not. The caller surfaces this rather than silently deleting.
    const tiny = { ...POLICY, budgetBytes: 10 };
    const plan = planRetention([f({ bytes: 5000, preserved: true, path: '/logs/keep.log' })], tiny);
    expect(plan.deletePaths).toEqual([]);
    expect(plan.keptBytes).toBe(5000);
  });

  it('reports how much it would free, so the UI can say so before deleting', () => {
    const plan = planRetention([f({ day: '2026-07-01', bytes: 4096, path: '/logs/old.log' })], POLICY);
    expect(plan.freedBytes).toBe(4096);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/retention.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the plan function**

```ts
// src/main/logging/retention.ts
export interface LogFileInfo {
  path: string;
  category: 'combined' | 'agent' | 'transcript';
  /** YYYY-MM-DD, from the filename. Sorts lexically, which is why the format matters. */
  day: string;
  bytes: number;
  /** True when this file records a failed or Tier 3 run — never evicted. */
  preserved: boolean;
}

export interface RetentionPolicy { logDays: number; transcriptDays: number; budgetBytes: number }
export interface RetentionPlan { deletePaths: string[]; freedBytes: number; keptBytes: number }

/**
 * What retention would delete, decided before anything is deleted.
 *
 * Pure on purpose: "Clear logs" has to state what it will remove, and a UI cannot honestly
 * promise that if the decision only exists inside the deleting loop.
 *
 * Preserved files are exempt from BOTH passes. A run that errored or performed a Tier 3
 * operation is the one most worth auditing; ageing it out on the same schedule as a quiet run —
 * or evicting it to satisfy a disk budget — defeats the point of keeping logs at all. Going over
 * budget is recoverable; losing the record of a failed production run is not.
 */
export function planRetention(files: LogFileInfo[], policy: RetentionPolicy): RetentionPlan {
  const cutoff = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString('en-CA');
  };
  const logCutoff = cutoff(policy.logDays);
  const transcriptCutoff = cutoff(policy.transcriptDays);

  const doomed = new Set<string>();
  for (const f of files) {
    if (f.preserved) continue;
    const cut = f.category === 'transcript' ? transcriptCutoff : logCutoff;
    if (f.day < cut) doomed.add(f.path);
  }

  // Budget pass: oldest first, and only over files the day pass spared.
  let kept = files.filter(f => !doomed.has(f.path));
  let keptBytes = kept.reduce((n, f) => n + f.bytes, 0);
  if (keptBytes > policy.budgetBytes) {
    for (const f of [...kept].sort((a, b) => a.day.localeCompare(b.day))) {
      if (keptBytes <= policy.budgetBytes) break;
      if (f.preserved) continue;
      doomed.add(f.path);
      keptBytes -= f.bytes;
    }
    kept = files.filter(f => !doomed.has(f.path));
  }

  const deleted = files.filter(f => doomed.has(f.path));
  return {
    deletePaths: deleted.map(f => f.path),
    freedBytes: deleted.reduce((n, f) => n + f.bytes, 0),
    keptBytes: kept.reduce((n, f) => n + f.bytes, 0),
  };
}
```

- [ ] **Step 3b: Implement the applier**

```ts
import * as fs from 'fs';
import * as path from 'path';

const DAY_IN_NAME = /(\d{4}-\d{2}-\d{2})/;

/** Scan, plan, unlink. Never throws: a cleanup fault must not fail a run. */
export function applyRetention(root: string, policy: RetentionPolicy): RetentionPlan {
  const empty: RetentionPlan = { deletePaths: [], freedBytes: 0, keptBytes: 0 };
  try {
    const files: LogFileInfo[] = [];
    const scan = (dir: string, category: LogFileInfo['category']) => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const full = path.join(dir, name);
        let bytes = 0;
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          bytes = st.size;
        } catch { continue; }
        const day = DAY_IN_NAME.exec(name)?.[1];
        if (!day) continue;
        files.push({ path: full, category, day, bytes, preserved: isPreserved(full) });
      }
    };
    scan(root, 'combined');
    scan(path.join(root, 'agents'), 'agent');
    scan(path.join(root, 'transcripts'), 'transcript');

    const plan = planRetention(files, policy);
    for (const p of plan.deletePaths) {
      // Individually wrapped: one undeletable file must not abort the sweep.
      try { fs.unlinkSync(p); } catch { /* leave it; the next sweep tries again */ }
    }
    return plan;
  } catch {
    return empty;
  }
}

/**
 * A file records a run worth keeping: an error, or a mutation. Read cheaply — a scan runs daily
 * over files that can be megabytes, so this looks for the markers and stops caring about the rest.
 */
function isPreserved(file: string): boolean {
  try {
    const text = fs.readFileSync(file, 'utf-8');
    return text.includes('run.end status=error') || text.includes(' mutation ');
  } catch {
    // Unreadable: treat as preserved. Deleting a file we could not inspect is the wrong default
    // for a record whose whole purpose is auditing.
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/logging/retention.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Schedule it**

Call `applyRetention` once at startup and once a day, wired into the existing `onSettingsUpdated` block in `src/main/index.ts` alongside the other schedulers. Do not add a bespoke timer.

- [ ] **Step 6: Commit**

```bash
git add src/main/logging/retention.ts src/main/index.ts tests/unit/logging/retention.test.ts
git commit -m "feat(logging): day-based retention with a disk budget and preserved failures"
```

---

### Task 4: The Logging panel in Preferences

**Files:**
- Modify: `src/renderer/components/NexusPreferences.tsx`
- Create: `src/renderer/components/LoggingSection.tsx`
- Modify: `src/main/ipc-handlers.ts` (a `LOGGING_STATS` channel), `src/common/constants.ts` (the channel name)
- Test: `tests/unit/renderer/LoggingSection.test.tsx`

**Interfaces:**
- Consumes: `RetentionPolicy`, `planRetention` (Task 3).
- Produces: IPC `LOGGING_STATS` → `{ root: string; totalBytes: number; byCategory: { combined: number; agent: number; transcript: number; audit: number }; policy: RetentionPolicy }`.

**Context you need:** The panel shows total size broken down by category, the path with Reveal in Finder, the level and per-agent overrides, the transcript toggle, retention days and the disk budget, and a **Clear logs** action that states what it will delete before doing it. `StorageHealthPanel` is a separate component and gets its own task.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/renderer/LoggingSection.test.tsx
import { LoggingSection } from '../../../src/renderer/components/LoggingSection';

function flatten(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(' ');
  return node.props ? flatten(node.props.children) : '';
}

const STATS = {
  root: '/Users/x/Library/Application Support/Local/nexus-ai/logs',
  totalBytes: 12 * 1024 * 1024,
  byCategory: { combined: 6 * 1024 * 1024, agent: 4 * 1024 * 1024, transcript: 1024 * 1024, audit: 1024 * 1024 },
  policy: { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 },
};

describe('LoggingSection', () => {
  it('shows where the logs are, so the answer is not "somewhere"', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    expect(flatten(s.render())).toContain('nexus-ai/logs');
  });

  it('breaks the size down by category rather than one opaque total', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    const text = flatten(s.render());
    for (const label of ['Combined', 'Per-agent', 'Transcripts', 'Audit']) {
      expect(text).toContain(label);
    }
  });

  it('states the budget as well as the usage', () => {
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    expect(flatten(s.render())).toMatch(/12(\.0)? MB.*250 MB/s);
  });

  it('says what Clear logs will delete BEFORE deleting it', () => {
    // Deleting evidence on a button press with no statement of what goes is the one thing this
    // panel must not do.
    const s: any = new LoggingSection({ stats: STATS, electron: undefined });
    s.state = { ...s.state, confirmingClear: true };
    const text = flatten(s.render());
    expect(text).toMatch(/will delete/i);
    expect(text).toContain('MB');
  });

  it('renders without stats, while they are still loading', () => {
    const s: any = new LoggingSection({ stats: null, electron: undefined });
    expect(() => s.render()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/LoggingSection.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Build the component**

```tsx
// src/renderer/components/LoggingSection.tsx
import * as React from 'react';

export interface LoggingStats {
  root: string;
  totalBytes: number;
  byCategory: { combined: number; agent: number; transcript: number; audit: number };
  policy: { logDays: number; transcriptDays: number; budgetBytes: number };
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const CATEGORY_LABELS: Array<[keyof LoggingStats['byCategory'], string]> = [
  ['combined', 'Combined'], ['agent', 'Per-agent'], ['transcript', 'Transcripts'], ['audit', 'Audit'],
];

export class LoggingSection extends React.Component<
  { stats: LoggingStats | null; electron: any },
  { confirmingClear: boolean }
> {
  state = { confirmingClear: false };

  render(): React.ReactElement {
    const { stats } = this.props;
    if (!stats) return React.createElement('div', null, 'Loading log statistics…');

    return React.createElement('div', null,
      // Where they are. "Somewhere in Application Support" is not an answer a user can act on.
      React.createElement('div', null, stats.root),
      React.createElement('button', {
        onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:reveal-path', stats.root),
      }, 'Reveal in Finder'),

      // Usage against the budget, broken down — one opaque total tells you nothing about what to
      // turn off if it is too large.
      React.createElement('div', null, `${mb(stats.totalBytes)} of ${mb(stats.policy.budgetBytes)}`),
      ...CATEGORY_LABELS.map(([key, label]) =>
        React.createElement('div', { key }, `${label}: ${mb(stats.byCategory[key])}`)),

      React.createElement('div', null,
        `Logs kept ${stats.policy.logDays} days · transcripts ${stats.policy.transcriptDays} days`),

      this.state.confirmingClear
        // Say what goes, before it goes. Runs that failed are exempt and the copy says so, or a
        // user clearing space would reasonably believe they had destroyed their own evidence.
        ? React.createElement('div', null,
            React.createElement('div', null,
              `This will delete ${mb(stats.totalBytes)} of logs. Runs that failed are kept.`),
            React.createElement('button', {
              onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:clear-logs'),
            }, 'Delete them'),
            React.createElement('button', { onClick: () => this.setState({ confirmingClear: false }) }, 'Cancel'),
          )
        : React.createElement('button', { onClick: () => this.setState({ confirmingClear: true }) }, 'Clear logs'),
    );
  }
}
```

- [ ] **Step 3b: Add the IPC and register the section**

Add `LOGGING_STATS: 'nexus-ai:logging-stats'` to `src/common/constants.ts`, a handler in `ipc-handlers.ts` that walks the log root with `fs.statSync` and returns the `LoggingStats` shape, and render `LoggingSection` from `NexusPreferences.tsx` beside the existing sections.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/renderer/LoggingSection.test.tsx` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/LoggingSection.tsx src/renderer/components/NexusPreferences.tsx src/main/ipc-handlers.ts src/common/constants.ts tests/unit/renderer/LoggingSection.test.tsx
git commit -m "feat(ui): Logging panel — size, path, level, retention, clear"
```

---

### Task 5: StorageHealthPanel learns that logs exist

**Files:**
- Modify: `src/renderer/components/StorageHealthPanel.tsx`
- Test: `tests/unit/renderer/StorageHealthPanel.logs.test.tsx`

**Interfaces:**
- Consumes: the `LOGGING_STATS` IPC (Task 4).

**Context you need:** The panel already renders categories via `renderStorageBar(label, sizeBytes, meta)` (line ~261) for Graph Database and Vector Database. Logs are simply absent from it today, so a user auditing disk use sees everything except the directory this project has been filling.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/renderer/StorageHealthPanel.logs.test.tsx
import { StorageHealthPanel } from '../../../src/renderer/components/StorageHealthPanel';

function flatten(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(' ');
  return node.props ? flatten(node.props.children) : '';
}

it('lists Logs as a storage category', () => {
  const p: any = new StorageHealthPanel({ electron: undefined } as any);
  p.state = { ...p.state, health: { graphDb: { sizeBytes: 1 }, vectorDb: { sizeBytes: 1 }, logs: { sizeBytes: 12582912 } } };
  expect(flatten(p.render())).toContain('Logs');
});

it('does not break when the logs figure has not loaded', () => {
  const p: any = new StorageHealthPanel({ electron: undefined } as any);
  p.state = { ...p.state, health: { graphDb: { sizeBytes: 1 }, vectorDb: { sizeBytes: 1 } } };
  expect(() => p.render()).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/StorageHealthPanel.logs.test.tsx`
Expected: FAIL — no Logs category.

- [ ] **Step 3: Add the category**

```tsx
  renderLogs(): React.ReactNode {
    const logs = (this.state.health as any)?.logs;
    // Absent while LOGGING_STATS is still in flight — render nothing rather than "0 B", which
    // would read as "the logs take no space" on a directory that may hold hundreds of megabytes.
    if (!logs) return null;
    const meta = React.createElement('span', null, 'Agent runs, tool calls, model calls');
    return this.renderStorageBar('Logs', logs.sizeBytes, meta);
  }
```

Call `this.renderLogs()` from `render()` alongside the existing `renderGraphDb()` / `renderVectorDb()` calls, and populate `health.logs` from the `LOGGING_STATS` channel where the panel already loads its other figures.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/renderer` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/StorageHealthPanel.tsx tests/unit/renderer/StorageHealthPanel.logs.test.tsx
git commit -m "feat(ui): storage health counts the log directory"
```

---

## Done when

Preferences → Nexus AI → Logging shows the path, a size breakdown, the level, retention days and the budget; changing the level takes effect without a restart; a 15-day-old log is gone while a log from a failed run of the same age is still there.
