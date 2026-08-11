# Nexus Settings Home (Spec 6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two overlapping Nexus settings screens with one five-section Settings home, with every number on it computed once and every cost stated honestly.

**Architecture:** `SettingsTab.tsx` becomes a thin shell (nav + dispatch) with one component per section under `src/renderer/components/settings/`. A single pure module, `derived.ts`, computes every figure on the screen from settings + fleet counts + recorded run durations; no section restates a number. Two new pieces of backend data support it: `backgroundWorkPaused` (a real pause that never touches per-job flags) and `JobRunStore` (per-job run durations, `null` until measured). `NexusOverview`'s Operations tab is retired into the new Advanced section.

**Tech Stack:** TypeScript, React 16 (`React.createElement`, class components, no JSX/hooks), Zod (`src/common/schemas.ts`), Jest, better-sqlite3, Electron IPC.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- React 16, `React.createElement`, class components, inline styles — **no JSX, no hooks**.
- `--nxai-*` CSS variables only. `--nxai-accent` (`#0a8189`) for primary buttons. The brand `#0ECAD4` is **2.02:1** against white and fails WCAG AA — never use it for text or a primary button.
- Every population renders with its `scope` string, never a bare number.
- Counts come from `collectFleetCounts`; never re-derive local counts from the graph.
- **Absent data omits its clause.** No placeholder, no zero, no "not measured yet".
- Every user-visible string comes from `docs/handoff-ux/handoff_nexus_ux/COPY.md`, quoted verbatim.
- Every row-to-subset mapping comes from `docs/handoff-ux/handoff_nexus_ux/MEMBERSHIP.md`. Do not re-derive it.
- Never bare `git stash` / `git stash pop` — the stash stack is shared across worktrees.
- **No `npm version`, `git tag`, `git push`, or release.** Commit locally only.
- **No `npm install` / `npm run rebuild`** — the native module is already correct in this worktree. Running `npm install` will break `npm test` until rebuilt.
- Run tests with `npx jest <path>`. The full suite is `npx jest tests/unit`.

## Baseline

Measure before you start, so "no new failures" is evidence rather than assertion:

```bash
npx jest tests/unit 2>&1 | tail -5
```

Record the pass/fail counts. Every task's final step compares against this number, not against zero.

---

## File Structure

**New — backend:**

| File | Responsibility |
|---|---|
| `src/main/background/JobRunStore.ts` | Per-job run durations, capped at 5 per job, persisted via `registryStorage`. Returns `null` — never 0 — when unmeasured. |

**New — renderer:**

| File | Responsibility |
|---|---|
| `src/renderer/components/settings/derived.ts` | The compute-once module. Job table, three subsets, both connection figures, nav notes, cost strings. Pure; no React. |
| `src/renderer/components/settings/SettingsShell.tsx` | 232px nav, section dispatch, settings fetch + save, the footer line. Nothing else. |
| `src/renderer/components/settings/ConnectionsSection.tsx` | WP Engine, other hosts, AI provider + gateway, Google, WPE API key, AWS S3. |
| `src/renderer/components/settings/ChatSection.tsx` | Panel toggle, retention, delete-all, per-site override link. |
| `src/renderer/components/settings/BackgroundWorkSection.tsx` | Master pause, three destination groups, seven job rows, three-column load summary. |
| `src/renderer/components/settings/PermissionsSection.tsx` | 4×3 Allowed/Blocked grid + the always-on reading line. |
| `src/renderer/components/settings/AdvancedSection.tsx` | MCP, gateway, DB health, ghost installs, SSH diagnostics, the three-level reset group. |

**Modified:**

| File | Change |
|---|---|
| `src/common/schemas.ts:58-89` | Add `backgroundWorkPaused` to `UpdateSettingsSchema` (it is `.strict()`). |
| `src/common/types.ts` | Add `backgroundWorkPaused?: boolean` to `NexusSettings`. |
| `src/main/index.ts:527+` | Gate every scheduler restart on `backgroundWorkPaused`; wire `JobRunStore`. |
| `src/main/startup/*Scheduler.ts` (4 files) | Bracket each run cycle with `JobRunStore.record`. |
| `src/renderer/components/SettingsTab.tsx` | Becomes a 3-line re-export of `SettingsShell`. |
| `src/renderer/components/NexusPreferences.tsx` | Keeps host management + host-key trust; everything else deleted. |
| `src/renderer/components/NexusOverview.tsx` | `renderOperationsTab` and its zone-3 methods deleted. |
| `tests/unit/renderer/operations-shell.test.ts` | Inverted: asserts the five capabilities are reachable from `AdvancedSection`. |

**Existing, do not touch:** `src/renderer/components/settings/ExternalHostAddWizard.tsx` (already in the target directory; unrelated).

---

## Phase A — Backend data

### Task 1: `backgroundWorkPaused`

A master pause that stops every schedule without writing to the six per-job `AutoEnabled` flags.

**Files:**
- Modify: `src/common/schemas.ts:58-89`
- Modify: `src/common/types.ts` (the `NexusSettings` interface)
- Modify: `src/main/index.ts:527` (the `onSettingsUpdated` closure)
- Test: `tests/unit/settings/background-work-paused.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `NexusSettings.backgroundWorkPaused?: boolean`. Task 4 reads it; Task 6 renders it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settings/background-work-paused.test.ts`:

```ts
/**
 * The master pause. Two properties matter and both have burned this codebase
 * before: the field must survive `.strict()`, and pausing must not touch the
 * per-job flags (a master that writes false into all six destroys the user's
 * configuration and silently re-enables jobs they had turned off).
 */
import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('backgroundWorkPaused', () => {
  test('survives UpdateSettingsSchema, which is .strict()', () => {
    const parsed = UpdateSettingsSchema.parse({ backgroundWorkPaused: true });
    expect(parsed.backgroundWorkPaused).toBe(true);
  });

  test('is optional — an unrelated write does not require it', () => {
    const parsed = UpdateSettingsSchema.parse({ wpeSyncAutoEnabled: true });
    expect(parsed).not.toHaveProperty('backgroundWorkPaused');
  });

  test('pausing carries no per-job flag in the same patch', () => {
    // The renderer sends exactly this patch. If a future change makes the
    // master write the six flags, this fails.
    const patch = { backgroundWorkPaused: true };
    const parsed = UpdateSettingsSchema.parse(patch);
    for (const k of [
      'wpeSyncAutoEnabled', 'wpeRefreshAutoEnabled', 'wpeContentIndexAutoEnabled',
      'externalRefreshAutoEnabled', 'externalContentIndexAutoEnabled',
      'localContentIndexAutoEnabled',
    ]) {
      expect(parsed).not.toHaveProperty(k);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/settings/background-work-paused.test.ts
```

Expected: FAIL. `.strict()` rejects the unknown key — `Unrecognized key(s) in object: 'backgroundWorkPaused'`.

- [ ] **Step 3: Add the field to the schema**

In `src/common/schemas.ts`, inside `UpdateSettingsSchema`, next to `dockedPanelEnabled`:

```ts
  dockedPanelEnabled: z.boolean().optional(),
  /** Master pause for all scheduled background work. Deliberately separate from
   *  the six per-job AutoEnabled flags — pausing must never overwrite them. */
  backgroundWorkPaused: z.boolean().optional(),
```

- [ ] **Step 4: Add the field to the type**

In `src/common/types.ts`, in `NexusSettings`, next to `haltedSiteRefreshIntervalHours`:

```ts
  /** Master pause for scheduled background work (default: false). Per-job
   *  AutoEnabled flags are preserved while paused. */
  backgroundWorkPaused?: boolean;
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx jest tests/unit/settings/background-work-paused.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Gate the schedulers**

In `src/main/index.ts`, at the top of the `onSettingsUpdated` closure (line 527, `const onSettingsUpdated = () => {`), before the `opportunisticScheduler.restart` call:

```ts
  const onSettingsUpdated = () => {
    const paused = (registryStorage.get(STORAGE_KEYS.SETTINGS) as
      { backgroundWorkPaused?: boolean } | null)?.backgroundWorkPaused === true;

    if (paused) {
      // Stop everything. The per-job flags are read but never written, so
      // unpausing restores exactly the configuration the user had.
      opportunisticScheduler.stop?.();
      haltedRefreshScheduler?.stop();
      wpeRefreshScheduler?.stop();
      externalRefreshScheduler?.stop();
      externalContentIndexScheduler?.stop();
      localLogger.info('[NexusAI] Background work paused — all schedulers stopped');
      return;
    }

    if (nexusServices?.bulkOpManager) {
```

Leave the rest of the closure exactly as it is: when not paused, each scheduler's own `AutoEnabled` flag decides, as today.

- [ ] **Step 7: Verify nothing else broke**

```bash
npx jest tests/unit 2>&1 | tail -5
```

Expected: the baseline count plus 3.

- [ ] **Step 8: Commit**

```bash
git add src/common/schemas.ts src/common/types.ts src/main/index.ts tests/unit/settings/background-work-paused.test.ts
git commit -m "feat(settings): backgroundWorkPaused — a master pause that preserves per-job flags"
```

---

### Task 2: `JobRunStore`

Per-job run durations. `null` until measured — this is what drives clause omission everywhere downstream.

**Files:**
- Create: `src/main/background/JobRunStore.ts`
- Test: `tests/unit/background/job-run-store.test.ts`

**Interfaces:**
- Consumes: `RegistryStorage` (`{ get(key): unknown; set(key, value): void }`), already the shape `src/main/index.ts:158` provides.
- Produces:
  ```ts
  export type JobKey =
    | 'wpeRefresh' | 'wpeSync' | 'wpeContentIndex'
    | 'externalRefresh' | 'externalContentIndex'
    | 'localContentIndex' | 'haltedSiteRefresh';

  export class JobRunStore {
    constructor(storage: { get(k: string): unknown; set(k: string, v: unknown): void });
    record(jobKey: JobKey, startedAt: number, durationMs: number): void;
    lastRunAt(jobKey: JobKey): number | null;
    averageMs(jobKey: JobKey): number | null;
  }
  ```
  Task 3 calls `record`. Task 4 consumes `averageMs`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/background/job-run-store.test.ts`:

```ts
/**
 * `null` is the product requirement, not an implementation detail: a job with
 * no recorded run renders NO duration clause. Coercing to 0 would print
 * "took 0 min" on every fresh install.
 */
import { JobRunStore } from '../../../src/main/background/JobRunStore';

const fakeStorage = () => {
  const bag: Record<string, unknown> = {};
  return {
    bag,
    get: (k: string) => bag[k] ?? null,
    set: (k: string, v: unknown) => { bag[k] = v; },
  };
};

describe('JobRunStore', () => {
  test('an unmeasured job is null, never 0', () => {
    const s = new JobRunStore(fakeStorage());
    expect(s.averageMs('wpeRefresh')).toBeNull();
    expect(s.lastRunAt('wpeRefresh')).toBeNull();
  });

  test('records a run and averages it', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('wpeRefresh', 1_000, 660_000);
    expect(s.averageMs('wpeRefresh')).toBe(660_000);
    expect(s.lastRunAt('wpeRefresh')).toBe(1_000);
  });

  test('averages the last 5 and caps the stored history at 5', () => {
    const st = fakeStorage();
    const s = new JobRunStore(st);
    for (let i = 1; i <= 7; i++) s.record('wpeSync', i * 1_000, i * 1_000);
    // Runs 3..7 survive: mean of 3000,4000,5000,6000,7000 = 5000
    expect(s.averageMs('wpeSync')).toBe(5_000);
    expect((st.bag['nexus-ai:job-runs'] as any).wpeSync).toHaveLength(5);
  });

  test('lastRunAt is the most recent start, not the first', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('externalRefresh', 100, 10);
    s.record('externalRefresh', 900, 10);
    expect(s.lastRunAt('externalRefresh')).toBe(900);
  });

  test('jobs are independent', () => {
    const s = new JobRunStore(fakeStorage());
    s.record('wpeRefresh', 1, 5_000);
    expect(s.averageMs('localContentIndex')).toBeNull();
  });

  test('survives a corrupt stored value rather than throwing', () => {
    const st = fakeStorage();
    st.bag['nexus-ai:job-runs'] = 'not an object';
    const s = new JobRunStore(st);
    expect(s.averageMs('wpeRefresh')).toBeNull();
    s.record('wpeRefresh', 1, 100);
    expect(s.averageMs('wpeRefresh')).toBe(100);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/background/job-run-store.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/main/background/JobRunStore'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/background/JobRunStore.ts`:

```ts
/**
 * Per-job run durations for the Settings → Background work screen.
 *
 * `null` means "never measured" and MUST NOT be coerced to 0 anywhere: the UI
 * omits the duration clause entirely when there is no measurement, which is
 * the difference between a row that says nothing and a row that lies.
 *
 * Bounded at 5 runs per job, the way AuditLogger bounds its own store.
 */

export type JobKey =
  | 'wpeRefresh'
  | 'wpeSync'
  | 'wpeContentIndex'
  | 'externalRefresh'
  | 'externalContentIndex'
  | 'localContentIndex'
  | 'haltedSiteRefresh';

const STORAGE_KEY = 'nexus-ai:job-runs';
const KEEP = 5;

interface Run { at: number; ms: number; }
type Bag = Partial<Record<JobKey, Run[]>>;

interface Storage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export class JobRunStore {
  constructor(private readonly storage: Storage) {}

  private read(): Bag {
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Bag;
  }

  record(jobKey: JobKey, startedAt: number, durationMs: number): void {
    const bag = this.read();
    const runs = Array.isArray(bag[jobKey]) ? bag[jobKey]! : [];
    runs.push({ at: startedAt, ms: durationMs });
    bag[jobKey] = runs.slice(-KEEP);
    this.storage.set(STORAGE_KEY, bag);
  }

  lastRunAt(jobKey: JobKey): number | null {
    const runs = this.read()[jobKey];
    if (!Array.isArray(runs) || runs.length === 0) return null;
    return runs[runs.length - 1].at;
  }

  averageMs(jobKey: JobKey): number | null {
    const runs = this.read()[jobKey];
    if (!Array.isArray(runs) || runs.length === 0) return null;
    return Math.round(runs.reduce((sum, r) => sum + r.ms, 0) / runs.length);
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest tests/unit/background/job-run-store.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/background/JobRunStore.ts tests/unit/background/job-run-store.test.ts
git commit -m "feat(settings): JobRunStore — per-job durations, null until measured"
```

---

### Task 3: Instrument the seven jobs

**The seven do not share a shape.** Five are `Scheduler` classes, one is a bare `setInterval`, one is a closure. A change that assumes a common base will not compile.

**Files:**
- Modify: `src/main/startup/WpeRefreshScheduler.ts`
- Modify: `src/main/startup/ExternalRefreshScheduler.ts` (`runCycleNow`, around line 114)
- Modify: `src/main/startup/ExternalContentIndexScheduler.ts`
- Modify: `src/main/startup/HaltedSiteRefreshScheduler.ts`
- Modify: `src/main/index.ts` (construct the store; instrument `wpeContentIndexTimer` and `runWpeAutoSyncIncremental` at their call sites, around line 923)
- Test: `tests/unit/background/job-instrumentation.test.ts`

**Interfaces:**
- Consumes: `JobRunStore` and `JobKey` from Task 2.
- Produces: an optional `jobRunStore?: JobRunStore` option on each of the four scheduler classes' options interfaces. Nothing later depends on the schedulers directly.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/background/job-instrumentation.test.ts`:

```ts
/**
 * Guards the shape trap. These read the source rather than running a cycle:
 * what they protect is "every one of the seven records a duration", which is a
 * property of the wiring, not of a single run. Running seven real cycles would
 * need SSH, a graph DB and Local's service container.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src', p), 'utf8');

describe('every scheduled job records its duration', () => {
  test.each([
    ['main/startup/WpeRefreshScheduler.ts', 'wpeRefresh'],
    ['main/startup/ExternalRefreshScheduler.ts', 'externalRefresh'],
    ['main/startup/ExternalContentIndexScheduler.ts', 'externalContentIndex'],
    ['main/startup/HaltedSiteRefreshScheduler.ts', 'haltedSiteRefresh'],
  ])('%s records %s', (file, key) => {
    const src = read(file);
    expect(src).toContain('jobRunStore');
    expect(src).toContain(`'${key}'`);
  });

  test('the two non-class jobs are instrumented at their call sites in index.ts', () => {
    // wpeContentIndexTimer is a bare setInterval and runWpeAutoSyncIncremental
    // is a closure — neither has restart/stop, so neither can be instrumented
    // in a shared base.
    const src = read('main/index.ts');
    expect(src).toContain("'wpeContentIndex'");
    expect(src).toContain("'wpeSync'");
  });

  test('localContentIndex is recorded', () => {
    const src = read('main/index.ts');
    expect(src).toContain("'localContentIndex'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/background/job-instrumentation.test.ts
```

Expected: FAIL on all six — no file mentions `jobRunStore`.

- [ ] **Step 3: Instrument the four scheduler classes**

For each of the four, apply the same three edits. `ExternalRefreshScheduler.ts` shown; the other three are identical apart from the job key.

Add to the options interface:

```ts
  /** Optional — when absent the job simply is not timed. */
  jobRunStore?: import('../background/JobRunStore').JobRunStore;
```

Add to the constructor:

```ts
    this.jobRunStore = options.jobRunStore;
```

with the field `private readonly jobRunStore?: import('../background/JobRunStore').JobRunStore;`

Bracket the cycle body. In `ExternalRefreshScheduler.runCycleNow`, wrap the existing work:

```ts
  async runCycleNow(): Promise<void> {
    const startedAt = Date.now();
    try {
      // ... existing body, unchanged ...
    } finally {
      this.jobRunStore?.record('externalRefresh', startedAt, Date.now() - startedAt);
    }
  }
```

Job keys: `WpeRefreshScheduler` → `'wpeRefresh'`; `ExternalRefreshScheduler` → `'externalRefresh'`; `ExternalContentIndexScheduler` → `'externalContentIndex'`; `HaltedSiteRefreshScheduler` → `'haltedSiteRefresh'`.

Use `finally`, not the success path: a cycle that fails still consumed the time, and a job that only ever fails would otherwise report `null` forever.

- [ ] **Step 4: Construct the store and instrument the three non-class jobs**

In `src/main/index.ts`, after `registryStorage` is defined (line 158) and before the schedulers are constructed:

```ts
  const jobRunStore = new JobRunStore(registryStorage);
```

with `import { JobRunStore } from './background/JobRunStore';` at the top.

Pass `jobRunStore` into each of the four scheduler constructors' options.

For `opportunisticScheduler` (local content index) and the two non-class jobs, bracket at the call site. For `runWpeAutoSyncIncremental` around line 923:

```ts
      const wpeSyncStartedAt = Date.now();
      try {
        await runWpeAutoSyncIncremental(/* existing args */);
      } finally {
        jobRunStore.record('wpeSync', wpeSyncStartedAt, Date.now() - wpeSyncStartedAt);
      }
```

Apply the same bracket to the `wpeContentIndexTimer` interval callback with `'wpeContentIndex'`, and to the opportunistic scheduler's cycle with `'localContentIndex'`.

- [ ] **Step 5: Run it and watch it pass**

```bash
npx jest tests/unit/background/job-instrumentation.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and run the full suite**

```bash
npx tsc --noEmit
npx jest tests/unit 2>&1 | tail -5
```

Expected: no type errors; baseline + 9.

- [ ] **Step 7: Commit**

```bash
git add src/main/startup src/main/index.ts tests/unit/background/job-instrumentation.test.ts
git commit -m "feat(settings): record run durations for all seven scheduled jobs"
```

---

## Phase B — The compute-once module

### Task 4: `derived.ts`

The load-bearing task. Everything the screen displays is computed here, once.

**Files:**
- Create: `src/renderer/components/settings/derived.ts`
- Test: `tests/unit/renderer/settings-derived.test.ts`

**Interfaces:**
- Consumes: `NexusSettings` (`src/common/types.ts`), `JobKey` (Task 2).
- Produces: everything Tasks 5–10 render. Exact signatures in Step 3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/settings-derived.test.ts`:

```ts
/**
 * The handoff says these figures broke four times during the prototype's own
 * build, so they get the heaviest tests in the spec. The membership rules are
 * the part a future reader will "simplify" back into one set — MEMBERSHIP.md
 * exists because group and cost are different predicates.
 */
import { computeDerived, JOBS } from '../../../src/renderer/components/settings/derived';

const base = (over: any = {}) => ({
  settings: {
    wpeRefreshAutoEnabled: true,  wpeRefreshIntervalHours: 4,
    wpeSyncAutoEnabled: true,     wpeSyncIntervalHours: 4,
    wpeContentIndexAutoEnabled: true, wpeContentIndexIntervalHours: 12,
    externalRefreshAutoEnabled: true, externalRefreshIntervalHours: 12,
    externalContentIndexAutoEnabled: true, externalContentIndexIntervalHours: 12,
    localContentIndexAutoEnabled: true, localContentIndexIntervalHours: 4,
    haltedSiteRefreshIntervalHours: 24,
    backgroundWorkPaused: false,
    ...(over.settings ?? {}),
  },
  installCount: 331,
  externalHostCount: 13,
  localSiteCount: 37,
  durations: {} as Record<string, number | null>,
  ...over,
});

describe('derived — the job table', () => {
  test('there are seven jobs, and none is the cut event hook', () => {
    expect(JOBS).toHaveLength(7);
    expect(JOBS.map(j => j.name)).not.toContain('Notice when a local site stops');
  });

  test('a wpe job at 4h with 331 installs reads passes and connections', () => {
    const d = computeDerived(base());
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toBe('6 passes a day · 1,986 connections');
  });

  test('an off job reads "nothing while off", never 0', () => {
    const d = computeDerived(base({ settings: { wpeRefreshAutoEnabled: false } }));
    const row = d.rows.find(r => r.key === 'wpeRefresh')!;
    expect(row.costLabel).toBe('nothing while off');
    expect(row.costLabel).not.toContain('0');
  });
});

describe('derived — membership is three different subsets', () => {
  test('the WP Engine index sits in the wpe group but contributes nothing', () => {
    const row = JOBS.find(j => j.key === 'wpeContentIndex')!;
    expect(row.group).toBe('wpe');
    expect(row.conn).toBeNull();
    const d = computeDerived(base());
    expect(d.rows.find(r => r.key === 'wpeContentIndex')!.costLabel)
      .toBe('2 passes a day · no extra connections');
  });

  test('externalRefresh feeds the other-hosts figure, not the WP Engine one', () => {
    const d = computeDerived(base());
    // 331 installs × 6 passes (wpeRefresh) + 331 × 6 (wpeSync) = 3,972
    expect(d.summary.wpe!.figure).toBe(3972);
    // 13 hosts × 2 passes × 2 external jobs = 52
    expect(d.summary.ext!.figure).toBe(52);
  });

  test('the two figures are never summed into one', () => {
    const d = computeDerived(base());
    expect(d.summary.wpe!.unit).toBe('connections a day');
    expect(d.summary.ext!.unit).toBe('SSH sessions a day');
    expect(JSON.stringify(d.summary)).not.toContain('4024'); // 3972 + 52
  });

  test('the switchable denominator is 6 with an external host', () => {
    const d = computeDerived(base());
    expect(d.switchableTotal).toBe(6);
    expect(d.navNote).toBe('6 of 6 on');
  });

  test('the denominator is 4 with no external host, and the ext group vanishes', () => {
    const d = computeDerived(base({ externalHostCount: 0 }));
    expect(d.switchableTotal).toBe(4);
    expect(d.summary.ext).toBeNull();
    expect(d.rows.map(r => r.key)).not.toContain('externalRefresh');
  });

  test('haltedSiteRefresh is always on and never in the denominator', () => {
    const d = computeDerived(base());
    const row = d.rows.find(r => r.key === 'haltedSiteRefresh')!;
    expect(row.alwaysOn).toBe(true);
    expect(row.enabled).toBe(true);
    expect(row.costLabel).toBe('free');
    // 6 switchable, and it is not one of them
    expect(d.switchableTotal).toBe(6);
  });

  test('haltedSiteRefresh keeps an adjustable interval', () => {
    // Its on/off is absent; its interval is a live control today
    // (SettingsTab.tsx:407). "not adjustable" would remove a shipping control.
    const row = JOBS.find(j => j.key === 'haltedSiteRefresh')!;
    expect(row.enableKey).toBeNull();
    expect(row.intervalKey).toBe('haltedSiteRefreshIntervalHours');
  });
});

describe('derived — thresholds come from the destination', () => {
  test('a wpe job ambers at 2h, not at 4h', () => {
    expect(computeDerived(base({ settings: { wpeRefreshIntervalHours: 4 } }))
      .rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(false);
    expect(computeDerived(base({ settings: { wpeRefreshIntervalHours: 2 } }))
      .rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(true);
  });

  test('an ext job ambers below 6h, where the same interval is fine for wpe', () => {
    const d = computeDerived(base({ settings: {
      externalRefreshIntervalHours: 4, wpeRefreshIntervalHours: 4,
    }}));
    expect(d.rows.find(r => r.key === 'externalRefresh')!.amber).toBe(true);
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.amber).toBe(false);
  });
});

describe('derived — absent data omits its clause', () => {
  test('with no recorded runs there is no duration and no minutes clause', () => {
    const d = computeDerived(base());
    expect(d.rows.every(r => r.durationMin === null)).toBe(true);
    expect(d.summary.time.minsPerDay).toBeNull();
  });

  test('a recorded run produces both', () => {
    const d = computeDerived(base({ durations: { wpeRefresh: 660_000 } }));
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.durationMin).toBe(11);
    expect(d.summary.time.minsPerDay).toBe(66); // 6 passes × 11 min
  });
});

describe('derived — the zero-interval trap', () => {
  test('localContentIndexIntervalHours 0 is off, not Infinity', () => {
    // This interval alone is min(0); every other is min(1). round(24/0) is
    // Infinity and would render "Infinity passes a day".
    const d = computeDerived(base({ settings: { localContentIndexIntervalHours: 0 } }));
    const row = d.rows.find(r => r.key === 'localContentIndex')!;
    expect(row.costLabel).toBe('nothing while off');
    expect(JSON.stringify(d)).not.toContain('Infinity');
  });
});

describe('derived — the master pause', () => {
  test('pausing zeroes the schedule without changing any per-job flag', () => {
    const input = base({ settings: { backgroundWorkPaused: true } });
    const d = computeDerived(input);
    expect(d.paused).toBe(true);
    expect(d.summary.time.nextInHours).toBeNull();
    // The flags the user set are untouched — this is the whole point.
    expect(input.settings.wpeRefreshAutoEnabled).toBe(true);
    expect(d.rows.find(r => r.key === 'wpeRefresh')!.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/renderer/settings-derived.test.ts
```

Expected: FAIL — `Cannot find module '.../settings/derived'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/settings/derived.ts`:

```ts
/**
 * Every number on the Settings screen, computed once.
 *
 * The handoff's first non-negotiable: "Compute fleet figures once, in one
 * module, and have every label read from it. Never restate a number in a
 * string literal." Nothing in a section component may recompute any of this.
 *
 * Row membership is docs/handoff-ux/handoff_nexus_ux/MEMBERSHIP.md, transcribed
 * once. Note that `group` and `conn` are DIFFERENT predicates: a row can sit in
 * a destination group and contribute nothing to its figure.
 */
import type { NexusSettings } from '../../../common/types';

export type Destination = 'wpe' | 'ext' | 'local';
export type JobKey =
  | 'wpeRefresh' | 'wpeSync' | 'wpeContentIndex'
  | 'externalRefresh' | 'externalContentIndex'
  | 'localContentIndex' | 'haltedSiteRefresh';

export interface JobSpec {
  key: JobKey;
  name: string;
  group: Destination;
  /** null = never switchable. Not the same as "off". */
  enableKey: keyof NexusSettings | null;
  intervalKey: keyof NexusSettings;
  defaultHours: number;
  /** Which figure this job feeds. null = costs nothing. */
  conn: Destination | null;
}

/** Seven. An eighth row, the siteStopped event hook, was cut — it is not a
 *  scheduled job and had no interval, no cycle and no cost. Do not add it. */
export const JOBS: JobSpec[] = [
  { key: 'wpeRefresh',           name: 'Check WP Engine sites',        group: 'wpe',   enableKey: 'wpeRefreshAutoEnabled',           intervalKey: 'wpeRefreshIntervalHours',           defaultHours: 24, conn: 'wpe'  },
  { key: 'wpeSync',              name: 'Refresh site details',         group: 'wpe',   enableKey: 'wpeSyncAutoEnabled',              intervalKey: 'wpeSyncIntervalHours',              defaultHours: 24, conn: 'wpe'  },
  { key: 'wpeContentIndex',      name: 'Make content searchable',      group: 'wpe',   enableKey: 'wpeContentIndexAutoEnabled',      intervalKey: 'wpeContentIndexIntervalHours',      defaultHours: 24, conn: null   },
  { key: 'externalRefresh',      name: 'Check other hosts',            group: 'ext',   enableKey: 'externalRefreshAutoEnabled',      intervalKey: 'externalRefreshIntervalHours',      defaultHours: 24, conn: 'ext'  },
  { key: 'externalContentIndex', name: 'Make other hosts searchable',  group: 'ext',   enableKey: 'externalContentIndexAutoEnabled', intervalKey: 'externalContentIndexIntervalHours', defaultHours: 24, conn: 'ext'  },
  { key: 'localContentIndex',    name: 'Index sites on this Mac',      group: 'local', enableKey: 'localContentIndexAutoEnabled',    intervalKey: 'localContentIndexIntervalHours',    defaultHours: 4,  conn: null   },
  { key: 'haltedSiteRefresh',    name: 'Look over stopped local sites', group: 'local', enableKey: null,                             intervalKey: 'haltedSiteRefreshIntervalHours',    defaultHours: 24, conn: null   },
];

/** Amber comes from the destination, not the job. */
const AMBER: Record<Destination, (h: number) => boolean> = {
  wpe:   (h) => h <= 2,
  ext:   (h) => h < 6,
  local: () => false,
};

export interface DerivedInput {
  settings: Partial<NexusSettings>;
  installCount: number;
  externalHostCount: number;
  localSiteCount: number;
  /** Mean run duration in ms per job. Absent or null = never measured. */
  durations: Partial<Record<JobKey, number | null>>;
}

export interface JobRow {
  key: JobKey;
  name: string;
  group: Destination;
  enabled: boolean;
  alwaysOn: boolean;
  hours: number;
  passesPerDay: number | null;
  costLabel: string;
  /** null when never measured — the row then renders NO duration clause. */
  durationMin: number | null;
  amber: boolean;
}

export interface Figure {
  figure: number;
  unit: 'connections a day' | 'SSH sessions a day';
  scope: string;
  amber: boolean;
}

export interface Derived {
  rows: JobRow[];
  summary: {
    wpe: Figure | null;
    ext: Figure | null;
    time: { minsPerDay: number | null; nextInHours: number | null };
  };
  navNote: string;
  switchableTotal: number;
  switchableOn: number;
  paused: boolean;
}

const n = (v: number) => v.toLocaleString('en-US');

/** Passes per day. 0 hours means off — `round(24/0)` is Infinity. */
function per(hours: number): number | null {
  if (!hours || hours <= 0) return null;
  return Math.round(24 / hours);
}

export function computeDerived(input: DerivedInput): Derived {
  const s = input.settings ?? {};
  const paused = s.backgroundWorkPaused === true;
  const hasExternal = input.externalHostCount > 0;

  const visible = JOBS.filter((j) => j.group !== 'ext' || hasExternal);

  const rows: JobRow[] = visible.map((j) => {
    const alwaysOn = j.enableKey === null;
    const hours = (s[j.intervalKey] as number | undefined) ?? j.defaultHours;
    const passes = per(hours);
    // An always-on job is enabled by definition; a zero interval is off.
    const enabled = (alwaysOn || s[j.enableKey!] === true) && passes !== null;
    const ms = input.durations[j.key];
    const durationMin = ms == null ? null : Math.round(ms / 60_000);

    let costLabel: string;
    if (!enabled || passes === null) {
      costLabel = 'nothing while off';
    } else if (j.key === 'haltedSiteRefresh') {
      costLabel = 'free';
    } else if (j.conn === 'wpe') {
      costLabel = `${passes} passes a day · ${n(passes * input.installCount)} connections`;
    } else if (j.conn === 'ext') {
      costLabel = `${passes} passes a day · ${n(passes * input.externalHostCount)} sessions`;
    } else if (j.group === 'wpe') {
      costLabel = `${passes} passes a day · no extra connections`;
    } else {
      costLabel = `${passes} passes a day · ${n(input.localSiteCount)} local sites`;
    }

    return {
      key: j.key, name: j.name, group: j.group,
      enabled, alwaysOn, hours,
      passesPerDay: enabled ? passes : null,
      costLabel, durationMin,
      amber: enabled && AMBER[j.group](hours),
    };
  });

  const live = (g: Destination) =>
    rows.filter((r) => r.group === g && r.enabled && !paused);

  const sumConn = (g: Destination, multiplier: number) =>
    visible
      .filter((j) => j.conn === g)
      .reduce((total, j) => {
        const row = rows.find((r) => r.key === j.key)!;
        return row.enabled && !paused ? total + row.passesPerDay! * multiplier : total;
      }, 0);

  const wpeFigure = sumConn('wpe', input.installCount);
  const extFigure = sumConn('ext', input.externalHostCount);

  const minsList = rows.filter((r) => r.enabled && !paused && r.durationMin !== null);
  const minsPerDay = minsList.length === 0
    ? null
    : minsList.reduce((t, r) => t + r.passesPerDay! * r.durationMin!, 0);

  const enabledHours = rows.filter((r) => r.enabled && !paused).map((r) => r.hours);
  const nextInHours = paused || enabledHours.length === 0 ? null : Math.min(...enabledHours);

  const switchable = rows.filter((r) => !r.alwaysOn);
  const switchableOn = switchable.filter((r) => r.enabled).length;

  return {
    rows,
    summary: {
      wpe: {
        figure: wpeFigure, unit: 'connections a day',
        scope: `across ${n(input.installCount)} installs`,
        amber: live('wpe').some((r) => r.amber),
      },
      ext: hasExternal ? {
        figure: extFigure, unit: 'SSH sessions a day',
        scope: `across ${n(input.externalHostCount)} sites`,
        amber: live('ext').some((r) => r.amber),
      } : null,
      time: { minsPerDay, nextInHours },
    },
    navNote: `${switchableOn} of ${switchable.length} on`,
    switchableTotal: switchable.length,
    switchableOn,
    paused,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest tests/unit/renderer/settings-derived.test.ts
```

Expected: PASS, 15 tests. If `1,986` fails, check `toLocaleString('en-US')` — the locale is pinned deliberately so the assertion does not depend on the test machine.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/derived.ts tests/unit/renderer/settings-derived.test.ts
git commit -m "feat(settings): derived.ts — one module for every figure on the screen"
```

---

## Phase C — Shell and sections

Each section is a pure function of its props: it receives data and callbacks, owns no fetch and no save. The shell owns both. Test every section with `new Component(props).render()` — **never** `serializeTree(createElement(C, props))`, which serializes the props bag and makes assertions vacuous (`tests/unit/renderer/helpers/serializeTree.ts` records why; spec 5 hit it).

### The fixture trap — read before copying any test helper below

An earlier draft of this plan shipped a broken fixture into Tasks 4 and 6, and it
cost a fix round in each. Do not reproduce it:

```js
// BROKEN — later spread keys win, so `...over` replaces the merged object wholesale
const base = (over = {}) => ({
  settings: { ...defaults, ...(over.settings ?? {}) },   // merge happens here…
  installCount: 331,
  ...over,                                               // …and this discards it
});
```

`base({ settings: { someFlag: true } })` yields `settings` containing **only**
`someFlag` — every default gone. The test then silently exercises a state nobody
intended (in Task 4 it made every job read as disabled, so three assertions failed
against correct code; in Task 6 the paused-state test never exercised "jobs on *and*
paused", which is the only state its copy makes a promise about).

Destructure nested objects out before spreading the rest:

```js
// CORRECT
const base = (over = {}) => {
  const { settings: settingsOver, ...rest } = over;
  return { settings: { ...defaults, ...(settingsOver ?? {}) }, installCount: 331, ...rest };
};
```

This applies to every fixture below whose props contain a nested object carrying
defaults — Task 7's and Task 10's both do.

### Task 5: `SettingsShell`

**Files:**
- Create: `src/renderer/components/settings/SettingsShell.tsx`
- Modify: `src/renderer/components/SettingsTab.tsx` (becomes a re-export)
- Test: `tests/unit/renderer/settings-shell.test.ts`

**Interfaces:**
- Consumes: `computeDerived`, `Derived` (Task 4).
- Produces:
  ```ts
  export interface SectionProps<T> { data: T; onSave: (patch: Partial<NexusSettings>) => void; electron: any; }
  export class SettingsShell extends React.Component<{ electron: any }, SettingsShellState>
  ```
  Tasks 6–10 each receive `{ data, onSave, electron }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/settings-shell.test.ts`:

```ts
import { SettingsShell } from '../../../src/renderer/components/settings/SettingsShell';
import { serializeTree } from './helpers/serializeTree';

const shell = (state: any = {}) => {
  const c: any = new (SettingsShell as any)({ electron: { ipcRenderer: { invoke: jest.fn() } } });
  c.state = { ...c.state, loading: false, settings: {}, ...state };
  return JSON.stringify(serializeTree(c.render()));
};

describe('SettingsShell', () => {
  test('renders all five section names in the nav', () => {
    const t = shell();
    for (const name of [
      'Connections', 'Chat', 'Background work', 'What agents may do', 'Advanced',
    ]) expect(t).toContain(name);
  });

  test('the footer names the one surviving native panel', () => {
    // Not "There is no second settings page" — host-key approval is IPC-only
    // by design and must stay in Local's Preferences. Stating the exception is
    // the acceptance test; overclaiming is not.
    const t = shell();
    expect(t).toContain('Local → Preferences → Nexus AI');
    expect(t).not.toContain('There is no second settings page');
  });

  test('no hardcoded brand colour — #0ECAD4 is 2.02:1 on white', () => {
    expect(shell().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/renderer/settings-shell.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the shell**

Create `src/renderer/components/settings/SettingsShell.tsx`. It owns:

- state `{ settings, loading, active, sites, wpeAccounts, wpeInstalls, externalHosts, fleetCounts, durations }`
- `componentDidMount` → `injectThemeVars()` then the same `loadAll()` `Promise.all` block currently at `SettingsTab.tsx:122-140`, plus `GET_DASHBOARD_STATS` for fleet counts
- `saveSetting(patch)` — lifted verbatim from `SettingsTab.tsx:144-151`
- `render()` → a 232px nav `<div>` listing the five sections with their derived notes, and a dispatch on `this.state.active`
- the footer line, quoted from `COPY.md` § Settings footer, with `Local → Preferences → Nexus AI` at `#6b7280`/`700` and the rest at `#9ca3af`

Nav notes come from `computeDerived(...)`: Background work uses `derived.navNote`; Chat uses `settings.dockedPanelEnabled ? 'panel on' : 'panel off'`. **No nav note is a string literal containing a count.**

- [ ] **Step 4: Reduce `SettingsTab.tsx` to a re-export**

Replace the whole file with:

```tsx
/**
 * Moved to settings/SettingsShell.tsx (spec 6a). Kept as a re-export because
 * NexusOverview.tsx:1445 mounts `SettingsTab` and the tab key is persisted in
 * user state; renaming the mount point is a separate change.
 */
export { SettingsShell as SettingsTab } from './settings/SettingsShell';
```

- [ ] **Step 5: Run the shell test and the existing SettingsTab test**

```bash
npx jest tests/unit/renderer/settings-shell.test.ts tests/unit/renderer/SettingsTab.test.tsx
```

Expected: the shell's 3 pass. `SettingsTab.test.tsx` will fail where it asserts on the old sections — that is correct, it is testing deleted UI. Delete the assertions that target removed sections and keep any that target behaviour the shell still has. Note in the commit which ones you removed and why.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/SettingsShell.tsx src/renderer/components/SettingsTab.tsx tests/unit/renderer/settings-shell.test.ts tests/unit/renderer/SettingsTab.test.tsx
git commit -m "feat(settings): SettingsShell — nav, dispatch and the footer exception"
```

---

### Task 6: `BackgroundWorkSection`

The section that carries the argument. Do this before the other four — it is the one with real logic, and it proves `derived.ts`.

**Files:**
- Create: `src/renderer/components/settings/BackgroundWorkSection.tsx`
- Test: `tests/unit/renderer/settings-background-work.test.ts`

**Interfaces:**
- Consumes: `Derived`, `JobRow` (Task 4); `SectionProps` (Task 5).
- Produces: nothing later depends on it.

Props: `{ derived: Derived; onSave: (patch: Partial<NexusSettings>) => void }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/settings-background-work.test.ts`:

```ts
import { BackgroundWorkSection } from '../../../src/renderer/components/settings/BackgroundWorkSection';
import { computeDerived } from '../../../src/renderer/components/settings/derived';
import { serializeTree } from './helpers/serializeTree';

const derived = (over: any = {}) => computeDerived({
  settings: {
    wpeRefreshAutoEnabled: true, wpeRefreshIntervalHours: 4,
    wpeSyncAutoEnabled: true, wpeSyncIntervalHours: 4,
    wpeContentIndexAutoEnabled: true, wpeContentIndexIntervalHours: 12,
    externalRefreshAutoEnabled: true, externalRefreshIntervalHours: 12,
    externalContentIndexAutoEnabled: true, externalContentIndexIntervalHours: 12,
    localContentIndexAutoEnabled: true, localContentIndexIntervalHours: 4,
    haltedSiteRefreshIntervalHours: 24,
    ...(over.settings ?? {}),
  },
  installCount: 331, externalHostCount: 13, localSiteCount: 37,
  durations: {}, ...over,
});

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (BackgroundWorkSection as any)({ derived: derived(over), onSave: jest.fn() }).render()));

describe('BackgroundWorkSection', () => {
  test('renders three destination group headers', () => {
    const t = tree();
    expect(t).toContain('ON YOUR WP ENGINE ACCOUNT');
    expect(t).toContain("ON OTHER PEOPLE'S SERVERS");
    expect(t).toContain('ON THIS MAC');
  });

  test('the external cost explanation is stated once, at the group', () => {
    const t = tree();
    const marker = 'Shared hosting limits how many you may open at once';
    expect(t.split(marker)).toHaveLength(2); // exactly one occurrence
  });

  test('the two figures use different units and are never summed', () => {
    const t = tree();
    expect(t).toContain('connections a day');
    expect(t).toContain('SSH sessions a day');
    expect(t).not.toContain('4024');
  });

  test('the always-on row shows a static label, not a disabled toggle', () => {
    const t = tree();
    expect(t).toContain('ALWAYS ON');
    expect(t).not.toContain('"disabled":true');
  });

  test('the always-on row keeps an adjustable interval', () => {
    // haltedSiteRefreshIntervalHours has a live number input today
    // (SettingsTab.tsx:407). "not adjustable" would remove a shipping control.
    expect(tree()).not.toContain('not adjustable');
  });

  test('with no external host the whole middle group is absent', () => {
    const t = tree({ externalHostCount: 0 });
    expect(t).not.toContain("ON OTHER PEOPLE'S SERVERS");
    expect(t).not.toContain('SSH sessions a day');
    expect(t).not.toContain('Check other hosts');
  });

  test('the paused copy promises the per-job settings survive', () => {
    const t = tree({ settings: { backgroundWorkPaused: true } });
    expect(t).toContain('Background work is paused');
    expect(t).toContain('switching this back on restores them');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/renderer/settings-background-work.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the section**

Create `src/renderer/components/settings/BackgroundWorkSection.tsx`. Structure, top to bottom:

1. **Subtitle** — `COPY.md` § master switch, section subtitle. Quote verbatim. Note the shipped correction: it must **not** claim all of it costs connections; three rows cost nothing.
2. **Master switch** — label and sub from `COPY.md`, both states. `onChange` fires `onSave({ backgroundWorkPaused: <next> })` and **nothing else** — no per-job flag in the patch.
3. **Load summary** — three columns separated by `border-left: 1px solid #f3f4f6`; heads `11px/800` uppercase `letter-spacing: 0.07em` `#6b7280`. Render `derived.summary.wpe`, `derived.summary.ext` (skip entirely when `null`), and the TIME column. Omit the minutes clause when `minsPerDay` is `null`.
4. **Three groups** — for each of `wpe`, `ext`, `local`, a header + hint from `COPY.md` § group headers, then its rows from `derived.rows.filter(r => r.group === g)`. Skip the `ext` group when it has no rows.
5. **Each row** — name, description (from `COPY.md` § job rows), interval stepper (1/2/4/8/12/24h) firing `onSave({ [intervalKey]: hours })`, cost string right-aligned in a 190px column, and either a toggle firing `onSave({ [enableKey]: next })` or, when `row.alwaysOn`, the static text `ALWAYS ON`.

Every number rendered comes from `derived`. No `toLocaleString` call, no arithmetic, and no count in a string literal anywhere in this file.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest tests/unit/renderer/settings-background-work.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Re-home two regression guards deleted in Task 5**

Task 5 deleted `SettingsTab.tsx` and with it two tests that guard *previously-fixed
bugs*, not UI shape. Their UI is gone, but the invariants are not — this section now
owns the interval controls, so it inherits them. The original bodies are parked in
`.superpowers/sdd/2026-08-10-nexus-settings-home-plan/parked-guards-from-task-5.md`.

Re-create both against `BackgroundWorkSection`:

- **The `.strict()` silent-strip guard.** Assert that changing an interval sends the
  *exact* settings key the schema accepts, not a near-miss. `UpdateSettingsSchema` is
  `.strict()`, so a misspelled key is silently dropped and the setting never persists
  — a failure mode with no runtime symptom. Pin at least
  `externalContentIndexAutoEnabled`, which is the one the original test named.
- **The `[1, 168]` clamp.** Assert an out-of-range interval cannot be written. The
  schema rejects it, and a rejected write fails the *whole* settings save, not just
  that field — so an unclamped stepper can silently discard unrelated changes the
  user made in the same session.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/BackgroundWorkSection.tsx tests/unit/renderer/settings-background-work.test.ts
git commit -m "feat(settings): Background work — destination groups and two honest figures"
```

---

### Task 7: `ConnectionsSection`

A port, not new logic. Three groups by what each thing gets you.

**Files:**
- Create: `src/renderer/components/settings/ConnectionsSection.tsx`
- Test: `tests/unit/renderer/settings-connections.test.ts`

**Interfaces:**
- Consumes: `SectionProps` (Task 5).
- Produces: nothing later depends on it.

Props: `{ settings; wpeAccounts; externalHosts; onSave; electron }`.

**Port from** (move the render bodies; keep the handlers with them):
- `NexusPreferences.renderWpeCredsSection` (`:1516-1620`)
- `NexusPreferences.renderAwsCredsSection` (`:1621-1736`)
- `NexusPreferences.renderExternalHostsSection` (`:718-796`) — **read-only summary plus a link**; the host list, Add-Host wizard and key-trust flow stay in `NexusPreferences`
- provider/model selects from `NexusPreferences.handleProviderChange` / `handleModelChange` (`:1152-1172`)

- [ ] **Step 1: Write the failing test**

```ts
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (ConnectionsSection as any)({
    settings: { aiProvider: 'anthropic', useLocalGateway: false },
    wpeAccounts: [], externalHosts: [], onSave: jest.fn(),
    electron: { ipcRenderer: { invoke: jest.fn() } }, ...over,
  }).render()));

describe('ConnectionsSection', () => {
  test('renders the three group headings', () => {
    const t = tree();
    expect(t).toContain('Where your sites are');
    expect(t).toContain('How Nexus answers you');
    expect(t).toContain('What else Nexus can do');
  });

  test('says what the S3 credential unlocks, not its product name', () => {
    const t = tree();
    expect(t).toContain('Reading access logs');
    expect(t).not.toContain('AWS S3 credentials');
  });

  test('the gateway is nested under the provider, not a peer', () => {
    expect(tree()).toContain('Let WordPress sites use it too');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write the section, run it again**

```bash
npx jest tests/unit/renderer/settings-connections.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/ConnectionsSection.tsx tests/unit/renderer/settings-connections.test.ts
git commit -m "feat(settings): Connections — grouped by what each thing gets you"
```

---

### Task 8: `ChatSection`

**Files:**
- Create: `src/renderer/components/settings/ChatSection.tsx`
- Test: `tests/unit/renderer/settings-chat.test.ts`

**Port from:** `NexusPreferences.renderChatSection` (`:1395-1515`), with `handleDockedPanelToggle` (`:421`) and `handleRetentionChange` (`:429`).

Props: `{ settings; onSave; electron }`.

- [ ] **Step 1: Write the failing test**

```ts
import { ChatSection } from '../../../src/renderer/components/settings/ChatSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (settings: any = {}) => JSON.stringify(serializeTree(
  new (ChatSection as any)({
    settings: { dockedPanelEnabled: true, chatRetentionDays: 30, ...settings },
    onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } },
  }).render()));

describe('ChatSection', () => {
  test('offers all four retention choices', () => {
    const t = tree();
    for (const label of ['7', '30', '90', 'Forever']) expect(t).toContain(label);
  });

  test('the retention sentence tracks the choice', () => {
    expect(tree({ chatRetentionDays: 7 })).not.toEqual(tree({ chatRetentionDays: null }));
  });

  test('the panel toggle says it removes the panel everywhere', () => {
    expect(tree()).toContain('every screen');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write the section, run it again**

```bash
npx jest tests/unit/renderer/settings-chat.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/ChatSection.tsx tests/unit/renderer/settings-chat.test.ts
git commit -m "feat(settings): Chat section"
```

---

### Task 9: `PermissionsSection`

The clearest single case of the duplication this spec removes — it exists in **both** current homes.

**Files:**
- Create: `src/renderer/components/settings/PermissionsSection.tsx`
- Test: `tests/unit/renderer/settings-permissions.test.ts`

**Port from:** `SettingsTab.renderWpeAccessSection` (`:586-838`) and `NexusPreferences.renderWpeAccessControlSection` (`:797-1068`) — **reconcile them, do not move one.** Keep the site-exception picker from the `SettingsTab` version (it lists external hosts alongside WPE installs; the comment at `SettingsTab.tsx:48` explains why).

Props: `{ permissions; exceptions; wpeInstalls; externalHosts; onSave }`.

- [ ] **Step 1: Write the failing test**

```ts
import { PermissionsSection } from '../../../src/renderer/components/settings/PermissionsSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (PermissionsSection as any)({
    permissions: {}, exceptions: [], wpeInstalls: [], externalHosts: [],
    onSave: jest.fn(), ...over,
  }).render()));

describe('PermissionsSection', () => {
  test('is a 4x3 grid — reading is not a row', () => {
    const t = tree();
    for (const row of [
      'Copy a site down to this Mac', 'Install or update things',
      'Push local changes up', 'Delete or promote an environment',
    ]) expect(t).toContain(row);
    expect(t).not.toContain('Read what is installed');
  });

  test('reading is stated above the grid instead', () => {
    expect(tree()).toContain('Reading a site is always allowed');
  });

  test('cells read Allowed or Blocked and nothing else', () => {
    const t = tree();
    expect(t).toContain('Allowed');
    expect(t).toContain('Blocked');
  });

  test('the dead legacy setting is not surfaced', () => {
    // wpeAllowedEnvironments has zero callers outside its own test file.
    expect(tree()).not.toContain('wpeAllowedEnvironments');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write the section, run it again**

```bash
npx jest tests/unit/renderer/settings-permissions.test.ts
```

- [ ] **Step 3: Re-home four regression guards deleted in Task 5**

Task 5 deleted `SettingsTab.tsx` and with it four tests guarding *previously-fixed
bugs* in exception handling. This section inherits that behaviour, so it inherits the
guards. Original bodies are parked in
`.superpowers/sdd/2026-08-10-nexus-settings-home-plan/parked-guards-from-task-5.md`.

Re-create all four:

- **Display falls back to the deprecated `wpeSiteExceptions`** when
  `remoteSiteExceptions` is empty, so a user's existing exceptions do not vanish from
  the UI after the rename.
- **`remoteSiteExceptions` takes precedence** over the deprecated key when both exist.
- **Removing the last legacy exception also clears `wpeSiteExceptions`.** This is the
  resurrection bug: without it the fallback re-creates the exception the user just
  deleted, and it comes back on reload.
- **Removing one of two does NOT clear `wpeSiteExceptions`** — the other half of the
  same fix, guarding against over-clearing.

The pair matters together: either one alone permits a bug the other catches.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/PermissionsSection.tsx tests/unit/renderer/settings-permissions.test.ts
git commit -m "feat(settings): What agents may do — one 4x3 grid, reconciled from both homes"
```

---

### Task 10: `AdvancedSection`

**Files:**
- Create: `src/renderer/components/settings/AdvancedSection.tsx`
- Test: `tests/unit/renderer/settings-advanced.test.ts`

**Port from `NexusOverview`:** `renderDbScanSection` (`:1062`), `renderContentMaintenance` (`:1135`) — **split into two rows**, `renderSshDiagnostics` (`:1186`), `renderContentIndexReset` (`:966`), `renderFactoryReset` (`:878`). Plus `renderMcpPanel` and the gateway panel. Also `SettingsTab.renderAutoIndexingSection` (`:312`).

Props: `{ settings; indexEntries; mcpInfo; onSave; electron }`.

- [ ] **Step 1: Write the failing test**

```ts
import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (over: any = {}) => JSON.stringify(serializeTree(
  new (AdvancedSection as any)({
    settings: {}, indexEntries: [], mcpInfo: { port: 10801 },
    onSave: jest.fn(), electron: { ipcRenderer: { invoke: jest.fn() } }, ...over,
  }).render()));

describe('AdvancedSection', () => {
  test('carries all five capabilities stranded by spec 5', () => {
    const t = tree();
    for (const s of [
      'Rebuild search', 'Database health', 'Remove ghost installs',
      'SSH diagnostics', 'Start over',
    ]) expect(t).toContain(s);
  });

  test('there are three resets, ranked by cost-to-undo', () => {
    const t = tree();
    expect(t).toContain('Rebuild search');
    expect(t).toContain('Rebuild what Nexus knows');
    expect(t).toContain('Start over');
  });

  test('no reset claims credentials are destroyed', () => {
    // FACTORY_RESET explicitly preserves Keychain, WPE OAuth and the telemetry
    // ID (ipc-handlers.ts:4342). Warning otherwise would be a lie and would
    // contradict shipped confirmation copy.
    const t = tree().toLowerCase();
    expect(t).not.toContain('keychain');
    expect(t).not.toContain('api keys will be');
  });

  test('the 30-minute reset is not a plain Run', () => {
    // RESET_AND_REFRESH DELETEs every graph table and costs half an hour of an
    // unanswerable fleet. It is the amber row, not routine housekeeping.
    const t = tree();
    expect(t).toContain('About 30 minutes');
    expect(t).toContain('cannot answer questions about your fleet');
    expect(t).not.toContain('Housekeeping');
  });

  test('opens by saying you should not need this page', () => {
    expect(tree()).toContain('should not need anything on this page');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/renderer/settings-advanced.test.ts
```

- [ ] **Step 3: Write the section**

Rows in order: Connect your own AI tools (`port 10801`, Copy command) · AI gateway (`port 13100`, View usage) · Search index (size · *N sites indexed*, Rebuild) · Database health (Scan) · Remove ghost installs (Run) · SSH diagnostics (Run) · index internals.

Then the **Rebuilding and starting over** group — header and hint from `COPY.md`, then the three rows in cost-to-undo order with the nine fragments quoted verbatim and the per-level styling from `COPY.md`:

| Level | Border | Row | Button | Text |
|---|---|---|---|---|
| plain | `#e5e7eb` | white | — | `#374151` |
| amber | `#fde68a` | `#fffdf7` | `#fffbeb` | `#b45309` |
| red | `#fecaca` | `#fff5f5` | `#fef2f2` | `#ef4444` |

The "keeps" fragment stays `#4b5563` at all three levels. All three take a confirm; only **Start over** takes a typed one.

Search index size: `statSync` on `<userData>/Local/nexus-ai/vectors.db`. If the file is missing, omit the size clause — do not render `0 MB`.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx jest tests/unit/renderer/settings-advanced.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/AdvancedSection.tsx tests/unit/renderer/settings-advanced.test.ts
git commit -m "feat(settings): Advanced — three-level reset group ranked by cost-to-undo"
```

---

## Phase D — Retirement

### Task 11: Retire Operations and the second home

**Files:**
- Modify: `src/renderer/components/NexusOverview.tsx` — delete `renderOperationsTab` (`:819-876`), the six zone-3 render methods (`:878-1300` approx), the `'operations'` tab entry and the `case 'operations'` at `:1444`
- Modify: `src/renderer/components/NexusPreferences.tsx` — delete `renderChatSection`, `renderWpeAccessControlSection`, `renderWpeCredsSection`, `renderAwsCredsSection` and their handlers; keep `renderExternalHostsSection`, `renderExternalHostRow`, `renderManagePopover`, `handleSetRootMode` and the host-key trust flow
- Modify: `tests/unit/renderer/operations-shell.test.ts` — invert it
- Test: the same file

- [ ] **Step 1: Invert the guard test**

Rewrite `tests/unit/renderer/operations-shell.test.ts`:

```ts
/**
 * Spec 5 kept Operations alive only because deleting it would strand five
 * maintenance actions with nowhere to go. Spec 6a built that destination, so
 * this inverts: the five must now be reachable from Advanced, and Operations
 * must be gone.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(__dirname, '../../../src/renderer/components', p), 'utf8');

test('Advanced reaches every maintenance action Operations used to hold', () => {
  const advanced = read('settings/AdvancedSection.tsx');
  for (const action of [
    'Start over', 'Rebuild search', 'Database health',
    'Remove ghost installs', 'SSH diagnostics',
  ]) expect(advanced).toContain(action);
});

test('the third reset is reachable too — it was buried inside Housekeeping', () => {
  expect(read('settings/AdvancedSection.tsx')).toContain('Rebuild what Nexus knows');
});

test('Operations is gone from the dashboard', () => {
  const overview = read('NexusOverview.tsx');
  expect(overview).not.toContain('renderOperationsTab');
  expect(overview).not.toContain("case 'operations'");
});

test('bulk progress survived the move', () => {
  // BulkOperationsPanel is the ONLY progress readout for BULK_EXECUTE, which
  // the Sites table's bulk bar dispatches. Deleting it with the tab would
  // leave every bulk action running blind.
  expect(read('NexusOverview.tsx')).toContain('BulkOperationsPanel');
});

test('WPE sync progress survived — the scheduler drives it, not a button', () => {
  expect(read('NexusOverview.tsx')).toContain('wpe-sync-progress');
});

test('the native panel keeps only the host-key boundary', () => {
  const prefs = read('NexusPreferences.tsx');
  expect(prefs).toContain('renderExternalHostsSection');
  // These moved to the one settings home.
  expect(prefs).not.toContain('renderChatSection');
  expect(prefs).not.toContain('renderWpeAccessControlSection');
  expect(prefs).not.toContain('renderAwsCredsSection');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/renderer/operations-shell.test.ts
```

Expected: FAIL — `renderOperationsTab` is still present, and so are the four `NexusPreferences` methods.

- [ ] **Step 3: Delete the Operations tab**

In `NexusOverview.tsx`: remove `renderOperationsTab` and the six zone-3 render methods, the `'operations'` entry from the tab list, and `case 'operations': return this.renderOperationsTab();` at `:1444`. Leave `BulkOperationsPanel` and the `wpe-sync-progress` readout where they are — the tests above pin both, and both are driven by things other than the deleted buttons.

- [ ] **Step 4: Trim `NexusPreferences.tsx`**

Delete the four section methods and their handlers. Add, at the top of the surviving render, a line pointing at the in-app home — quote it from `COPY.md` § Settings footer rather than writing new copy.

- [ ] **Step 5: Run it and watch it pass**

```bash
npx jest tests/unit/renderer/operations-shell.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck, then the whole suite**

```bash
npx tsc --noEmit
npx jest tests/unit 2>&1 | tail -5
```

Expected: no type errors. Compare against the recorded baseline — a per-directory run is not evidence, only the full count is. Any suite that referenced a deleted method needs updating, and each such change belongs in this commit with a note saying why.

- [ ] **Step 7: Verify in the running app**

```bash
./dev-reload.sh
```

Never hand-roll `pkill` + build + open — main-process modules do not hot-reload, and stale in-memory code masquerades as bugs. Then in Local: open Nexus AI → Settings, and confirm the five sections render, that Operations is gone, and that `Preferences → Nexus AI` still shows host management.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(settings): retire Operations and the second settings home"
```

---

## Self-Review

**Spec coverage.** Each spec section maps to a task: §Architecture A → T5; §B one source → T4; §C absent data → T4 (tested) + T6; §1 Connections → T7; §2 Chat → T8; §3 Background work → T1, T3, T4, T6; §4 What agents may do → T9; §5 Advanced incl. the reset group → T10; §Operations dies here → T11; §Data this spec adds → T1 (`backgroundWorkPaused`), T2 (`JobRunStore`), T3 (the seven shapes); §Testing → distributed, with the membership rules in T4 and T6; §Global constraints → the header, plus a no-brand-colour test in every section task.

**Known gaps, deliberate.** Agent cards are spec 6b and untouched. The prototype HTML still renders eight job rows and `README.md` §5 still describes a per-row external explanation — both are the designer's files to regenerate, recorded in the spec's limitations, and `COPY.md` is authoritative for the build.

**Type consistency.** `JobKey` is declared in `src/main/background/JobRunStore.ts` (T2) and re-declared structurally identically in `derived.ts` (T4) because the renderer must not import from `src/main`. The seven members are identical in both; if you change one, change both. `Destination` is `'wpe' | 'ext' | 'local'` everywhere. `computeDerived` takes `DerivedInput` and returns `Derived` in T4, T5 and T6 alike.
