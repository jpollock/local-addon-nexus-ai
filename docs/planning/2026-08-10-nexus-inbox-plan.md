# Nexus Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run-counting "31 pending decisions" banner with a durable Inbox whose item is a distinct finding or failure, deduplicated by identity so its size tracks distinct problems rather than sweep frequency.

**Architecture:** A new `InboxStore` on the existing `graphService.getDb()` connection, keyed `UNIQUE (source, code, scope)`. Items are written in the **main** process at agent-run completion, so a closed renderer no longer loses everything an agent found. The renderer reads a bounded list over IPC and renders the prototype's three groups. Per-agent pending counts derive from this one store, collapsing five independent copies of `filter(e => e.status === 'review')`.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React 16 (`React.createElement`, class components, no JSX/hooks), Jest.

Design: `docs/planning/2026-08-10-nexus-inbox-design.md`

## Global Constraints

- React 16, `React.createElement`, class components, inline style objects — **no JSX, no hooks**.
- No hardcoded colours anywhere. `--nxai-*` theme variables only, working in light and dark.
- Every population rendered carries its `scope` string, **never a bare number**.
- The Inbox acquires **no permission** the addon does not already have. Execution stays behind `SentinelExecutor`'s `isOperationAllowed` gate.
- **No unbounded list renders, at any volume.** Every list is limited and reports its total.
- **Copy may not promise reversal of a live change.** "Reopen" a decision is allowed; "undo" a shipped change is not.
- `status`, `decision`, `decided_at` and `first_seen_at` are **never** overwritten by a re-report.
- Never use bare `git stash` / `git stash pop` — the stash stack is shared across worktrees.
- Do **not** run `npm version`, `git tag`, `git push`, or trigger a release. Commit locally only.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/inbox/InboxStore.ts` | Create. Schema, identity upsert, decision state, bounded queries. |
| `src/main/inbox/types.ts` | Create. `InboxKind`, `InboxStatus`, `InboxItem`, `InboxItemInput`. |
| `src/main/inbox/recordRun.ts` | Create. Maps an `AgentResult` to inbox items. Pure; takes a store. |
| `src/main/inbox/autoPause.ts` | Create. Wraps `shouldAutoPause` and closes its caller contract. |
| `src/main/index.ts` | Modify (~line 667). Construct `InboxStore` beside `AgentStateStore`. |
| `src/main/ipc-handlers.ts` | Modify (~line 5417). Write items before the broadcast. Add read/decide handlers. |
| `src/common/constants.ts` | Modify. Three new IPC channels. |
| `src/renderer/components/tabs/InboxTab.tsx` | Create. Three groups, actions, evidence disclosure, empty state. |
| `src/renderer/components/agents/AgentsHub.tsx` | Modify. Banner summarises the real queue. |
| `tests/unit/inbox/inbox-store.test.ts` | Create. Identity, dismissal, bounded queries. |
| `tests/unit/inbox/record-run.test.ts` | Create. Mapping, site attribution, broadcast independence. |
| `tests/unit/inbox/auto-pause.test.ts` | Create. The caller contract. |
| `tests/unit/renderer/inbox-tab.test.ts` | Create. `serializeTree` snapshots. |

---

### Task 1: `InboxStore` — schema and identity

**Files:**
- Create: `src/main/inbox/types.ts`
- Create: `src/main/inbox/InboxStore.ts`
- Test: `tests/unit/inbox/inbox-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `InboxStore` class with `record(input: InboxItemInput, now?: number): void`. Types `InboxKind = 'decide' | 'problem' | 'know'`, `InboxStatus = 'open' | 'dismissed' | 'done'`, `InboxItem`, `InboxItemInput` — all consumed by Tasks 2–7.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/inbox/inbox-store.test.ts
import Database from 'better-sqlite3';
import { InboxStore } from '../../../src/main/inbox/InboxStore';
import type { InboxItemInput } from '../../../src/main/inbox/types';

let db: InstanceType<typeof Database>;
let store: InboxStore;

const item = (over: Partial<InboxItemInput> = {}): InboxItemInput => ({
  source: 'security-sentinel',
  code: 'FS-01',
  scope: 'local:abc123',
  scopeLabel: 'Good Aesthetic Club',
  kind: 'decide',
  title: 'File permissions are too open',
  detail: 'wp-config.php is world-readable.',
  ...over,
});

beforeEach(() => {
  db = new Database(':memory:');
  store = new InboxStore(db);
});
afterEach(() => db.close());

describe('InboxStore identity', () => {
  test('a re-report updates the existing row instead of inserting', () => {
    store.record(item(), 1000);
    store.record(item(), 2000);

    const rows = store.listOpen();
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0].seenCount).toBe(2);
    expect(rows.items[0].firstSeenAt).toBe(1000);
    expect(rows.items[0].lastSeenAt).toBe(2000);
  });

  test('the same check code on two different scopes is two items', () => {
    store.record(item({ scope: 'local:aaa', scopeLabel: 'Site A' }), 1000);
    store.record(item({ scope: 'local:bbb', scopeLabel: 'Site B' }), 1000);

    expect(store.listOpen().items).toHaveLength(2);
  });

  test('different check codes on one scope are two items', () => {
    store.record(item({ code: 'FS-01' }), 1000);
    store.record(item({ code: 'ABS-05' }), 1000);

    expect(store.listOpen().items).toHaveLength(2);
  });

  test('a re-report refreshes mutable display fields', () => {
    store.record(item({ title: 'Old title' }), 1000);
    store.record(item({ title: 'New title', detail: 'Now worse.' }), 2000);

    const row = store.listOpen().items[0];
    expect(row.title).toBe('New title');
    expect(row.detail).toBe('Now worse.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/inbox/inbox-store.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/inbox/InboxStore'`

- [ ] **Step 3: Write the types**

```ts
// src/main/inbox/types.ts

/** Which of the Inbox's three groups an item belongs to. */
export type InboxKind = 'decide' | 'problem' | 'know';

/** `open` is actionable; `dismissed` and `done` are decided and stay decided. */
export type InboxStatus = 'open' | 'dismissed' | 'done';

export interface InboxItemInput {
  /** The agent that raised it, e.g. 'security-sentinel'. */
  source: string;
  /**
   * Check code (`'FS-01'`) or, for a failure, `failureCode(message)`.
   * NOT a per-instance id — two sites failing one check share a code.
   */
  code: string;
  /**
   * Stable target identity, namespaced: `local:<siteId>`, `name:<siteName>`,
   * or `*` for fleet-level. Never a bare display name — names collide across
   * sources (see CLAUDE.md "Names collide across sources").
   */
  scope: string;
  /** What to show for the scope: 'Good Aesthetic Club', '12 sites'. */
  scopeLabel: string;
  kind: InboxKind;
  title: string;
  detail?: string;
  /** Shown behind a disclosure. */
  evidence?: string;
  severity?: string;
  /** Arbitrary structured extra (plan, raw finding). Stored as JSON. */
  payload?: unknown;
}

export interface InboxItem {
  id: number;
  source: string;
  code: string;
  scope: string;
  scopeLabel: string;
  kind: InboxKind;
  title: string;
  detail?: string;
  evidence?: string;
  severity?: string;
  status: InboxStatus;
  decision?: string;
  decidedAt?: number;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  payload?: unknown;
}
```

- [ ] **Step 4: Write the store**

```ts
// src/main/inbox/InboxStore.ts
import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { InboxItem, InboxItemInput, InboxKind, InboxStatus } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbox_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  scope         TEXT    NOT NULL,
  scope_label   TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  detail        TEXT,
  evidence      TEXT,
  severity      TEXT,
  status        TEXT    NOT NULL DEFAULT 'open',
  decision      TEXT,
  decided_at    INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  seen_count    INTEGER NOT NULL DEFAULT 1,
  payload       TEXT,
  UNIQUE (source, code, scope)
);
CREATE INDEX IF NOT EXISTS idx_inbox_open
  ON inbox_items (status, kind, last_seen_at DESC);
`;

/** Default page size. No caller may request an unbounded list. */
export const INBOX_PAGE_SIZE = 100;

/** Stable code for a failure, whose message is free text rather than a check id. */
export function failureCode(message: string): string {
  return 'fail:' + createHash('sha256').update(message).digest('hex').slice(0, 12);
}

interface Row {
  id: number; source: string; code: string; scope: string; scope_label: string;
  kind: string; title: string; detail: string | null; evidence: string | null;
  severity: string | null; status: string; decision: string | null;
  decided_at: number | null; first_seen_at: number; last_seen_at: number;
  seen_count: number; payload: string | null;
}

function toItem(r: Row): InboxItem {
  let payload: unknown;
  if (r.payload) { try { payload = JSON.parse(r.payload); } catch { payload = undefined; } }
  return {
    id: r.id,
    source: r.source,
    code: r.code,
    scope: r.scope,
    scopeLabel: r.scope_label,
    kind: r.kind as InboxKind,
    title: r.title,
    detail: r.detail ?? undefined,
    evidence: r.evidence ?? undefined,
    severity: r.severity ?? undefined,
    status: r.status as InboxStatus,
    decision: r.decision ?? undefined,
    decidedAt: r.decided_at ?? undefined,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    seenCount: r.seen_count,
    payload,
  };
}

export class InboxStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  /**
   * Record a sighting. A re-report of the same (source, code, scope) UPDATES.
   *
   * `status`, `decision`, `decided_at` and `first_seen_at` are deliberately
   * absent from the DO UPDATE SET. That omission is the load-bearing line in
   * this file: it is what makes a user's decision survive the next sweep.
   * Without it every sweep un-dismisses everything.
   */
  record(input: InboxItemInput, now: number = Date.now()): void {
    this.db.prepare(`
      INSERT INTO inbox_items
        (source, code, scope, scope_label, kind, title, detail, evidence,
         severity, first_seen_at, last_seen_at, seen_count, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(source, code, scope) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        seen_count   = inbox_items.seen_count + 1,
        scope_label  = excluded.scope_label,
        kind         = excluded.kind,
        title        = excluded.title,
        detail       = excluded.detail,
        evidence     = excluded.evidence,
        severity     = excluded.severity,
        payload      = excluded.payload
    `).run(
      input.source, input.code, input.scope, input.scopeLabel, input.kind,
      input.title, input.detail ?? null, input.evidence ?? null,
      input.severity ?? null, now, now,
      input.payload === undefined ? null : JSON.stringify(input.payload),
    );
  }

  /** Open items, newest sighting first, bounded. `total` is the full open count. */
  listOpen(limit: number = INBOX_PAGE_SIZE): { items: InboxItem[]; total: number } {
    const rows = this.db.prepare(`
      SELECT * FROM inbox_items WHERE status = 'open'
      ORDER BY last_seen_at DESC, id DESC LIMIT ?
    `).all(limit) as Row[];
    const total = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM inbox_items WHERE status = 'open'`,
    ).get() as { n: number }).n;
    return { items: rows.map(toItem), total };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/inbox/inbox-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/inbox tests/unit/inbox
git commit -m "feat(inbox): InboxStore keyed by (source, code, scope)

A re-report updates rather than inserts, so row count tracks distinct
problems rather than sweep frequency."
```

---

### Task 2: Decision state that survives a re-report

**Files:**
- Modify: `src/main/inbox/InboxStore.ts`
- Test: `tests/unit/inbox/inbox-store.test.ts`

**Interfaces:**
- Consumes: `InboxStore`, `InboxItem`, `InboxStatus` from Task 1.
- Produces: `decide(id: number, decision: string, status: 'dismissed' | 'done', now?: number): void`, `reopen(id: number, now?: number): void`, `countsByKind(): Record<InboxKind, number>`, `pendingBySource(): Record<string, number>`. Tasks 5–7 consume all four.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/inbox/inbox-store.test.ts
describe('InboxStore decisions', () => {
  test('a dismissed item stays dismissed when re-reported', () => {
    store.record(item(), 1000);
    const id = store.listOpen().items[0].id;
    store.decide(id, 'Not now', 'dismissed', 1500);

    store.record(item(), 2000);   // the next sweep finds it again

    expect(store.listOpen().items).toHaveLength(0);
    const all = store.listAll();
    expect(all[0].status).toBe('dismissed');
    expect(all[0].decision).toBe('Not now');
    expect(all[0].decidedAt).toBe(1500);
    // still counted and still time-stamped — the problem has not gone away
    expect(all[0].seenCount).toBe(2);
    expect(all[0].lastSeenAt).toBe(2000);
  });

  test('reopen returns a decided item to the queue and clears the decision', () => {
    store.record(item(), 1000);
    const id = store.listOpen().items[0].id;
    store.decide(id, 'Approve', 'done', 1500);
    expect(store.listOpen().items).toHaveLength(0);

    store.reopen(id, 2000);

    const open = store.listOpen().items;
    expect(open).toHaveLength(1);
    expect(open[0].decision).toBeUndefined();
    expect(open[0].decidedAt).toBeUndefined();
  });

  test('countsByKind counts only open items', () => {
    store.record(item({ code: 'A', kind: 'decide' }), 1000);
    store.record(item({ code: 'B', kind: 'decide' }), 1000);
    store.record(item({ code: 'C', kind: 'problem' }), 1000);
    const doneId = store.listOpen().items.find(i => i.code === 'B')!.id;
    store.decide(doneId, 'Approve', 'done', 1500);

    expect(store.countsByKind()).toEqual({ decide: 1, problem: 1, know: 0 });
  });

  test('pendingBySource counts open items per agent', () => {
    store.record(item({ source: 'security-sentinel', code: 'A' }), 1000);
    store.record(item({ source: 'security-sentinel', code: 'B' }), 1000);
    store.record(item({ source: 'seo-insights', code: 'C' }), 1000);

    expect(store.pendingBySource()).toEqual({ 'security-sentinel': 2, 'seo-insights': 1 });
  });

  test('listOpen is bounded and reports the true total', () => {
    for (let i = 0; i < 250; i++) store.record(item({ code: `C-${i}` }), 1000 + i);
    const page = store.listOpen(100);
    expect(page.items).toHaveLength(100);
    expect(page.total).toBe(250);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/inbox/inbox-store.test.ts`
Expected: FAIL — `store.decide is not a function`

- [ ] **Step 3: Add the methods to `InboxStore`**

```ts
  /** Record the user's decision. Survives every later re-report. */
  decide(
    id: number,
    decision: string,
    status: 'dismissed' | 'done',
    now: number = Date.now(),
  ): void {
    this.db.prepare(`
      UPDATE inbox_items SET status = ?, decision = ?, decided_at = ? WHERE id = ?
    `).run(status, decision, now, id);
  }

  /**
   * Return a decided item to the queue.
   *
   * This reverses the DECISION, not the change the decision caused. Reversing a
   * live change is the staging-and-revert problem this spec deliberately does
   * not solve — no copy on this surface may imply otherwise.
   */
  reopen(id: number, _now: number = Date.now()): void {
    this.db.prepare(`
      UPDATE inbox_items SET status = 'open', decision = NULL, decided_at = NULL
      WHERE id = ?
    `).run(id);
  }

  /** Every item regardless of status, bounded. Diagnostics and tests. */
  listAll(limit: number = INBOX_PAGE_SIZE): InboxItem[] {
    return (this.db.prepare(`
      SELECT * FROM inbox_items ORDER BY last_seen_at DESC, id DESC LIMIT ?
    `).all(limit) as Row[]).map(toItem);
  }

  /** Open counts per group. Always carries all three keys, zero included. */
  countsByKind(): Record<InboxKind, number> {
    const out: Record<InboxKind, number> = { decide: 0, problem: 0, know: 0 };
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) AS n FROM inbox_items WHERE status = 'open' GROUP BY kind
    `).all() as Array<{ kind: string; n: number }>;
    for (const r of rows) {
      if (r.kind in out) out[r.kind as InboxKind] = r.n;
    }
    return out;
  }

  /** Open counts per agent — the single source for per-agent pending badges. */
  pendingBySource(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT source, COUNT(*) AS n FROM inbox_items WHERE status = 'open' GROUP BY source
    `).all() as Array<{ source: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.source] = r.n;
    return out;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/unit/inbox/inbox-store.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/inbox/InboxStore.ts tests/unit/inbox/inbox-store.test.ts
git commit -m "feat(inbox): decisions survive re-report; bounded queries

A dismissed item re-reported stays dismissed but keeps counting — the
problem has not gone away just because the user chose not to act."
```

---

### Task 3: Map an agent run to inbox items

**Files:**
- Create: `src/main/inbox/recordRun.ts`
- Test: `tests/unit/inbox/record-run.test.ts`

**Interfaces:**
- Consumes: `InboxStore.record` (Task 1), `failureCode` (Task 1).
- Produces: `recordRunToInbox(store: InboxStore, run: RunForInbox, now?: number): number` returning the number of items written, and `interface RunForInbox`. Task 4 calls it.

**Context the brief cannot know:** `AgentResult.sites?: Record<string, { status, findings, plan? }>` (`src/main/agent-sdk/types.ts:159`) carries **per-site** findings. Prefer it. The top-level `findings` array has no site attribution — fall back to it only when `sites` is absent.

`Finding` is `{ id: string; sev: 'critical' | 'high' | 'medium'; title: string; plain: string }` (`src/renderer/components/agents/SentinelTypes.ts`). `id` is a check code, not a per-instance id.

All findings map to `kind: 'decide'`. **Do not invent a `know` producer** — no current severity is informational, and the empty group is intended (see design section C).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/inbox/record-run.test.ts
import Database from 'better-sqlite3';
import { InboxStore } from '../../../src/main/inbox/InboxStore';
import { recordRunToInbox } from '../../../src/main/inbox/recordRun';

let db: InstanceType<typeof Database>;
let store: InboxStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new InboxStore(db);
});
afterEach(() => db.close());

const finding = (id: string, title = `Finding ${id}`) =>
  ({ id, sev: 'high' as const, title, plain: 'Because reasons.' });

describe('recordRunToInbox', () => {
  test('per-site findings become one item per (code, site)', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: {
        'Site A': { status: 'findings', findings: [finding('FS-01'), finding('FS-02')] },
        'Site B': { status: 'findings', findings: [finding('FS-01')] },
      },
    }, 1000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(3);
    // The same code on two sites is two items, each scoped to its own site.
    const fs01 = items.filter(i => i.code === 'FS-01');
    expect(fs01).toHaveLength(2);
    expect(fs01.map(i => i.scopeLabel).sort()).toEqual(['Site A', 'Site B']);
  });

  test('re-running the same sweep does not grow the inbox', () => {
    const run = {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [finding('FS-01')] } },
    };
    recordRunToInbox(store, run, 1000);
    recordRunToInbox(store, run, 2000);
    recordRunToInbox(store, run, 3000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(1);
    expect(items[0].seenCount).toBe(3);
  });

  test('a site with no findings writes nothing', () => {
    const written = recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'clean', findings: [] } },
    }, 1000);

    expect(written).toBe(0);
    expect(store.listOpen().items).toHaveLength(0);
  });

  test('without per-site data, a single-site run still attributes to that site', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      findings: [finding('FS-01')],
      findingsSites: ['Site A'],
    }, 1000);

    expect(store.listOpen().items[0].scopeLabel).toBe('Site A');
  });

  test('without per-site data, a multi-site run is fleet-scoped and says so', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      findings: [finding('FS-01')],
      findingsSites: ['Site A', 'Site B'],
    }, 1000);

    const row = store.listOpen().items[0];
    expect(row.scope).toBe('*');
    expect(row.scopeLabel).toBe('2 sites');
  });

  test('scope is namespaced, never a bare site name', () => {
    recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [finding('FS-01')] } },
    }, 1000);

    // Bare names collide across local/WPE sources; the namespace prevents a merge.
    expect(store.listOpen().items[0].scope).toBe('name:Site A');
  });

  test('a failed run becomes one problem item, deduplicated by message', () => {
    const run = {
      agentId: 'security-sentinel',
      status: 'error' as const,
      error: '(s.evidence || []).map is not a function',
    };
    recordRunToInbox(store, run, 1000);
    recordRunToInbox(store, run, 2000);

    const items = store.listOpen().items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('problem');
    expect(items[0].seenCount).toBe(2);
    expect(items[0].scope).toBe('*');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/inbox/record-run.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/inbox/recordRun'`

- [ ] **Step 3: Write the mapper**

```ts
// src/main/inbox/recordRun.ts
import type { InboxStore } from './InboxStore';
import { failureCode } from './InboxStore';
import type { InboxItemInput } from './types';

interface RunFinding {
  id: string;
  sev?: string;
  title?: string;
  plain?: string;
}

export interface RunForInbox {
  agentId: string;
  status?: 'success' | 'error' | 'timeout';
  error?: string;
  /** Preferred: per-site findings, from AgentResult.sites. */
  sites?: Record<string, { status: string; findings?: RunFinding[] }>;
  /** Fallback: run-level findings with no per-finding attribution. */
  findings?: RunFinding[];
  /** Which sites the run found something on. Only meaningful with `findings`. */
  findingsSites?: string[];
}

/**
 * Site names are display strings and collide across sources (CLAUDE.md,
 * "Names collide across sources"), so they are namespaced rather than used
 * bare. Resolving a name to a stable site id is a follow-up; the namespace
 * means that change will not silently merge two sites' items in the meantime.
 */
function siteScope(name: string): string {
  return `name:${name}`;
}

function findingItem(
  agentId: string, f: RunFinding, scope: string, scopeLabel: string,
): InboxItemInput {
  return {
    source: agentId,
    code: f.id,
    scope,
    scopeLabel,
    kind: 'decide',
    title: f.title || f.id,
    detail: f.plain,
    severity: f.sev,
    payload: f,
  };
}

/** Write a run's findings and failure to the inbox. Returns items written. */
export function recordRunToInbox(
  store: InboxStore, run: RunForInbox, now: number = Date.now(),
): number {
  let written = 0;

  if (run.status === 'error' || run.status === 'timeout') {
    const message = run.error || `The run ended with status "${run.status}".`;
    store.record({
      source: run.agentId,
      code: failureCode(message),
      scope: '*',
      scopeLabel: 'This agent',
      kind: 'problem',
      title: `${run.agentId} could not finish a run`,
      detail: message,
      payload: { status: run.status },
    }, now);
    written++;
  }

  if (run.sites) {
    for (const [siteName, site] of Object.entries(run.sites)) {
      for (const f of site.findings ?? []) {
        store.record(findingItem(run.agentId, f, siteScope(siteName), siteName), now);
        written++;
      }
    }
    return written;
  }

  const findings = run.findings ?? [];
  if (findings.length === 0) return written;

  // No per-finding attribution available. Three distinct cases, and none of
  // them may state something untrue:
  //   1 site  → name it
  //   n sites → "n sites"
  //   0 sites → we have findings but no attribution. Say that. "0 sites" would
  //             assert the finding affects nothing, which is false.
  const sites = run.findingsSites ?? [];
  const scope = sites.length === 1 ? siteScope(sites[0]) : '*';
  const scopeLabel = sites.length === 1
    ? sites[0]
    : sites.length === 0
      ? 'Site not identified'
      : `${sites.length} sites`;

  for (const f of findings) {
    store.record(findingItem(run.agentId, f, scope, scopeLabel), now);
    written++;
  }
  return written;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/inbox/record-run.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/inbox/recordRun.ts tests/unit/inbox/record-run.test.ts
git commit -m "feat(inbox): map an agent run to deduplicated inbox items

Prefers AgentResult.sites for per-finding site attribution; falls back to
fleet scope with an honest label when a multi-site run cannot attribute."
```

---

### Task 4: Write items in the main process, before the broadcast

**Files:**
- Modify: `src/main/index.ts` (~line 667, beside `new AgentStateStore(agentDb)`)
- Modify: `src/main/ipc-handlers.ts` (~line 5417, after `parseRunOutcomes`, before the `AGENT_RUN_COMPLETE` broadcast)
- Test: `tests/unit/inbox/record-run.test.ts` (append)

**Interfaces:**
- Consumes: `recordRunToInbox` (Task 3), `InboxStore` (Task 1).
- Produces: an `inboxStore` handle reachable from the IPC handlers, by the same mechanism `agentStateStore` already uses. Tasks 6, 7 and 9 read it.

**Context the brief cannot know:** the existing broadcast at `ipc-handlers.ts:5419` is wrapped in a `try/catch` that degrades to a **minimal payload** when `findings`/`plan` fail to serialize (the comment there says "Full payload failed to serialize (e.g. enriched plan evidence too large)"). The inbox write must sit **before** that block and **outside** its try — a finding too large to send to the renderer is still a finding worth recording. This is design property 5 and the reviewer will check it.

`lastRunResult` at that scope is the `AgentResult`, so `.sites`, `.findings`, `.status` and `.error` are all available even though the broadcast does not forward `.sites`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/inbox/record-run.test.ts
describe('inbox writes are independent of the renderer', () => {
  test('a run whose payload cannot be serialized is still recorded', () => {
    // A payload with a cycle is exactly what breaks structured clone over IPC.
    const cyclic: any = { id: 'FS-01', sev: 'high', title: 'Cyclic finding' };
    cyclic.self = cyclic;

    const written = recordRunToInbox(store, {
      agentId: 'security-sentinel',
      sites: { 'Site A': { status: 'findings', findings: [cyclic] } },
    }, 1000);

    expect(written).toBe(1);
    expect(store.listOpen().items[0].code).toBe('FS-01');
  });
});
```

Note: `InboxStore.record` calls `JSON.stringify(payload)`, which throws on a cycle. Make `record` tolerate an unserializable payload by storing `null` for it rather than losing the item — the item matters more than its extra detail.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/inbox/record-run.test.ts`
Expected: FAIL — `TypeError: Converting circular structure to JSON`

- [ ] **Step 3: Harden `record` against an unserializable payload**

In `src/main/inbox/InboxStore.ts`, replace the inline `JSON.stringify(input.payload)` with:

```ts
function encodePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  try {
    return JSON.stringify(payload);
  } catch {
    // A cyclic or otherwise unserializable payload must not cost us the item.
    return null;
  }
}
```

and call `encodePayload(input.payload)` in `record`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/inbox/record-run.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Construct the store in `src/main/index.ts`**

Immediately after `const agentStateStore = new AgentStateStore(agentDb);`:

```ts
        const inboxStore = new InboxStore(agentDb);
```

Add the import alongside the existing `AgentStateStore` import:

```ts
import { InboxStore } from './inbox/InboxStore';
```

Pass `inboxStore` to the IPC handlers by the same route `agentStateStore` already takes. Follow whatever that route is — do not invent a second one, and do not reach for a module-level global.

- [ ] **Step 6: Write items at run completion in `src/main/ipc-handlers.ts`**

After `const outcomes = parseRunOutcomes(logContent, siteNames);` and **before** the `try { broadcast(...) }` block:

```ts
      // Record to the inbox BEFORE the broadcast, and outside its try/catch.
      // That broadcast degrades to a minimal payload when findings are too
      // large to serialize; a finding we cannot send to the renderer is still
      // a finding worth keeping. Never let an inbox fault fail the run.
      try {
        recordRunToInbox(inboxStore, {
          agentId: agentId || 'security-sentinel',
          status: (lastRunResult as any)?.status,
          error:  (lastRunResult as any)?.error,
          sites:  (lastRunResult as any)?.sites,
          findings: (lastRunResult as any)?.findings,
          findingsSites: outcomes.findingsSites,
        });
      } catch (inboxErr: any) {
        console.error('[AGENT_RUN_NOW] inbox write failed:', inboxErr?.message);
      }
```

- [ ] **Step 7: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit && npx jest tests/unit`
Expected: no new type errors; no new test failures against the branch baseline.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/main/ipc-handlers.ts src/main/inbox tests/unit/inbox
git commit -m "feat(inbox): write items in main at run completion

Before the broadcast and outside its try/catch, so a payload too large to
send to the renderer is still recorded. An agent that finds a problem with
Nexus closed no longer leaves no trace."
```

---

### Task 5: Auto-pause, with its caller contract closed

**Files:**
- Create: `src/main/inbox/autoPause.ts`
- Test: `tests/unit/inbox/auto-pause.test.ts`

**Interfaces:**
- Consumes: `shouldAutoPause`, `FailureRun` from `src/main/agents/failureAggregation.ts`; `AgentRunRow` / `getRunHistory` from `src/main/agent-runtime/AgentStateStore.ts`.
- Produces: `trailingFailures(runs: AgentRunRow[]): FailureRun[]` and `shouldPauseAgent(runs: AgentRunRow[]): boolean`.

**Why this task exists at all.** `shouldAutoPause` takes `FailureRun[]` — a type with no way to represent a success — and every test in `tests/unit/agents/failure-aggregation.test.ts` passes failures only. Hand it an agent's failed runs and an agent that goes fail / succeed / fail / succeed / fail reads as a three-failure streak and gets paused. That agent is flaky, not stuck.

The contract is: **pass only the trailing failures since the last success.** It is invisible in the type, so it is pinned here, at the call site. Do **not** "fix" `failureAggregation.ts` — its own suite is correct for its own contract.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/inbox/auto-pause.test.ts
import { trailingFailures, shouldPauseAgent } from '../../../src/main/inbox/autoPause';
import type { AgentRunRow } from '../../../src/main/agent-runtime/AgentStateStore';

const row = (
  id: number, status: AgentRunRow['status'], error?: string,
): AgentRunRow => ({
  id, agentName: 'security-sentinel', startedAt: id * 1000, finishedAt: id * 1000,
  status, error, findingsCount: 0,
});

describe('trailingFailures', () => {
  test('stops at the most recent success', () => {
    const runs = [
      row(5, 'error', 'boom'), row(4, 'error', 'boom'),
      row(3, 'success'),
      row(2, 'error', 'boom'), row(1, 'error', 'boom'),
    ];
    expect(trailingFailures(runs).map(f => f.at)).toEqual([5000, 4000]);
  });

  test('a leading success means no trailing failures', () => {
    expect(trailingFailures([row(2, 'success'), row(1, 'error', 'boom')])).toEqual([]);
  });

  test('accepts oldest-first input too', () => {
    const runs = [row(1, 'error', 'boom'), row(2, 'success'), row(3, 'error', 'boom')];
    expect(trailingFailures(runs).map(f => f.at)).toEqual([3000]);
  });
});

describe('shouldPauseAgent', () => {
  test('pauses after three consecutive identical failures', () => {
    expect(shouldPauseAgent([
      row(3, 'error', 'boom'), row(2, 'error', 'boom'), row(1, 'error', 'boom'),
    ])).toBe(true);
  });

  test('a success between failures prevents the pause', () => {
    // THE contract test. Five failures, same message, but not consecutive:
    // this agent is flaky, not stuck, and pausing it would be wrong.
    expect(shouldPauseAgent([
      row(5, 'error', 'boom'),
      row(4, 'success'),
      row(3, 'error', 'boom'),
      row(2, 'success'),
      row(1, 'error', 'boom'),
    ])).toBe(false);
  });

  test('three consecutive failures with differing messages do not pause', () => {
    expect(shouldPauseAgent([
      row(3, 'error', 'c'), row(2, 'error', 'b'), row(1, 'error', 'a'),
    ])).toBe(false);
  });

  test('a timeout counts as a failure', () => {
    expect(shouldPauseAgent([
      row(3, 'timeout', 'slow'), row(2, 'timeout', 'slow'), row(1, 'timeout', 'slow'),
    ])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/inbox/auto-pause.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/inbox/autoPause'`

- [ ] **Step 3: Write the wrapper**

```ts
// src/main/inbox/autoPause.ts
import { shouldAutoPause, type FailureRun } from '../agents/failureAggregation';
import type { AgentRunRow } from '../agent-runtime/AgentStateStore';

/**
 * The failures since the agent's most recent success, newest first.
 *
 * `shouldAutoPause` takes `FailureRun[]`, which cannot represent a success, so
 * it cannot tell "three failures in a row" from "three failures with successes
 * between them". Handing it every failed run would pause a flaky agent as if
 * it were stuck. Closing that gap is this function's whole job.
 */
export function trailingFailures(runs: AgentRunRow[]): FailureRun[] {
  const newestFirst = [...runs].sort((a, b) => b.finishedAt - a.finishedAt);
  const out: FailureRun[] = [];
  for (const r of newestFirst) {
    if (r.status === 'success') break;
    out.push({
      agentId: r.agentName,
      at: r.finishedAt,
      message: r.error ?? `status:${r.status}`,
    });
  }
  return out;
}

/** True when the agent's most recent runs are an unbroken identical failure streak. */
export function shouldPauseAgent(runs: AgentRunRow[]): boolean {
  return shouldAutoPause(trailingFailures(runs));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/inbox/auto-pause.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/inbox/autoPause.ts tests/unit/inbox/auto-pause.test.ts
git commit -m "feat(inbox): close shouldAutoPause's caller contract

FailureRun cannot represent a success, so passing every failed run would
pause a flaky agent as if it were stuck. trailingFailures cuts at the most
recent success; the contract is pinned here because the module's own suite
structurally cannot see it."
```

---

### Task 6: Actually pause the agent

**Files:**
- Modify: `src/main/agent-runtime/auto-run-gate.ts`
- Modify: `src/main/ipc-handlers.ts` (the run-completion block from Task 4; the `canAutoRun` path)
- Test: `tests/unit/agents/auto-run-gate.test.ts` (existing file — append)
- Test: `tests/unit/inbox/auto-pause.test.ts` (append)

**Interfaces:**
- Consumes: `shouldPauseAgent` (Task 5), `AgentStateStore.set/get` (existing), `canAutoRunWith` (existing).
- Produces: the `_autoPausedAt` state key and a `canAutoRunWith` signature that honours it.

**Why this task exists.** Task 5 on its own would leave a second unwired module, which is the exact
criticism the design levels at `aggregateFailures`. This is its caller.

**The marker must not be the user's own switch.** Do **not** auto-pause by writing
`enabled: false` or `scheduleEnabled: false`. Those are the user's settings; silently flipping one
means a user who later looks at the toggle cannot tell whether they turned the agent off or Nexus
did, and turning it back on would be indistinguishable from clearing the pause. Use a separate
`_autoPausedAt` key in `AgentStateStore` (main-side, same DB, already per-agent KV) and leave the
user's settings untouched.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/agents/auto-run-gate.test.ts
import { canAutoRunWith } from '../../../src/main/agent-runtime/auto-run-gate';

describe('auto-pause marker', () => {
  test('an auto-paused agent may not be started by the scheduler', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toBe(true);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: 900 }, 'schedule')).toBe(false);
  });

  test('an auto-paused agent may not be started by an event either', () => {
    // Both triggers are automatic, so both are blocked. Running by hand does
    // not pass through this gate at all — "Try again" keeps working.
    expect(canAutoRunWith({ enabled: true, autoPausedAt: 900 }, 'event')).toBe(false);
  });

  test('clearing the marker resumes automatic runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: undefined }, 'schedule')).toBe(true);
  });
});
```

```ts
// append to tests/unit/inbox/auto-pause.test.ts
import { pauseIfStuck } from '../../../src/main/inbox/autoPause';

describe('pauseIfStuck', () => {
  const stuck = [row(3, 'error', 'boom'), row(2, 'error', 'boom'), row(1, 'error', 'boom')];
  const flaky = [
    row(5, 'error', 'boom'), row(4, 'success'),
    row(3, 'error', 'boom'), row(2, 'success'), row(1, 'error', 'boom'),
  ];

  test('marks a stuck agent paused', () => {
    const set = jest.fn();
    expect(pauseIfStuck({ set }, 'security-sentinel', stuck, 5000)).toBe(true);
    expect(set).toHaveBeenCalledWith('security-sentinel', '_autoPausedAt', 5000);
  });

  test('leaves a flaky agent running', () => {
    const set = jest.fn();
    expect(pauseIfStuck({ set }, 'security-sentinel', flaky, 5000)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/agents/auto-run-gate.test.ts tests/unit/inbox/auto-pause.test.ts`
Expected: FAIL — `autoPausedAt` is not a property of `AgentTriggerSettings`; `pauseIfStuck` is not exported.

- [ ] **Step 3: Extend the gate**

In `src/main/agent-runtime/auto-run-gate.ts`, add `autoPausedAt?: number` to
`AgentTriggerSettings` and honour it:

```ts
export interface AgentTriggerSettings {
  enabled?: boolean;
  scheduleEnabled?: boolean;
  eventsEnabled?: boolean;
  /**
   * Set by pauseIfStuck when an agent's recent runs are an unbroken identical
   * failure streak. Deliberately separate from `enabled` — that switch belongs
   * to the user, and overwriting it would make "did I turn this off, or did
   * Nexus?" unanswerable.
   */
  autoPausedAt?: number;
}

export function canAutoRunWith(
  settings: AgentTriggerSettings | undefined,
  kind: AutoRunKind,
): boolean {
  if (settings?.enabled === false) return false;
  if (settings?.autoPausedAt !== undefined) return false;
  const perTrigger = kind === 'schedule' ? settings?.scheduleEnabled : settings?.eventsEnabled;
  return perTrigger !== false;
}
```

The signature is unchanged — the marker rides in the settings object, so every existing caller and
every existing test in `tests/unit/agents/auto-run-gate.test.ts` keeps working untouched.

- [ ] **Step 4: Add `pauseIfStuck` to `src/main/inbox/autoPause.ts`**

```ts
/** Just the slice of AgentStateStore this needs, so tests need no database. */
export interface PauseMarkerWriter {
  set(agentName: string, key: string, value: unknown): void;
}

export const AUTO_PAUSED_KEY = '_autoPausedAt';

/** Mark the agent paused when its recent runs are an unbroken identical failure streak. */
export function pauseIfStuck(
  store: PauseMarkerWriter,
  agentName: string,
  runs: AgentRunRow[],
  now: number = Date.now(),
): boolean {
  if (!shouldPauseAgent(runs)) return false;
  store.set(agentName, AUTO_PAUSED_KEY, now);
  return true;
}
```

- [ ] **Step 5: Call it at run completion**

In `src/main/ipc-handlers.ts`, inside the Task 4 inbox block, after `recordRunToInbox`:

```ts
        const paused = pauseIfStuck(
          agentStateStore, agentName, agentStateStore.getRunHistory(agentName, 10),
        );
        if (paused) {
          localLogger.warn(`[NexusAI] auto-paused ${agentName} after repeated identical failures`);
        }
```

Read `autoPausedAt` into the settings object that `canAutoRun` passes to `canAutoRunWith`, so the
marker actually gates the scheduler.

- [ ] **Step 6: Run to verify they pass**

Run: `npx jest tests/unit/agents tests/unit/inbox`
Expected: PASS. Existing `auto-run-gate` tests unchanged — the third parameter is optional.

- [ ] **Step 7: Typecheck and full unit suite**

Run: `npx tsc --noEmit && npx jest tests/unit`
Expected: no new type errors; no new failures against the branch baseline.

- [ ] **Step 8: Commit**

```bash
git add src/main tests/unit
git commit -m "feat(inbox): auto-pause an agent stuck in an identical failure streak

Uses a separate _autoPausedAt marker rather than the user's enabled switch,
so 'did I turn this off, or did Nexus?' stays answerable."
```

---

### Task 7: IPC — read the inbox and record a decision

**Files:**
- Modify: `src/common/constants.ts`
- Modify: `src/main/ipc-handlers.ts`
- Test: `tests/unit/inbox/inbox-store.test.ts` (no new tests; the handlers are thin)

**Interfaces:**
- Consumes: `InboxStore.listOpen`, `.countsByKind`, `.pendingBySource`, `.decide`, `.reopen`.
- Produces: three IPC channels, consumed by Tasks 8 and 9.

- [ ] **Step 1: Add the channels**

In `src/common/constants.ts`, beside the other agent channels:

```ts
  GET_INBOX:      `${ADDON_PREFIX}:inbox:get`,
  INBOX_DECIDE:   `${ADDON_PREFIX}:inbox:decide`,
  INBOX_REOPEN:   `${ADDON_PREFIX}:inbox:reopen`,
  AGENT_RESUME:   `${ADDON_PREFIX}:agent:resume`,
```

`AGENT_RESUME` is not optional decoration. Task 6 makes an agent auto-pause after an
identical failure streak, and **nothing else clears that marker** — without this channel a
paused agent can never run automatically again and no surface can undo it. A permanent silent
disablement is worse than never auto-pausing at all.

```ts
  safeHandle(IPC_CHANNELS.AGENT_RESUME, async (_e: any, { agentId }: { agentId: string }) => {
    try {
      const store = deps.nexusServices?.agentStateStore;
      if (store) resumeAgent(store, agentId);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] agent-resume failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });
```

`GET_INBOX` must also report which agents are currently paused, or the UI cannot offer the
resume action on the right items. Add `pausedSources: string[]` to its response, built by
testing `isAutoPaused(agentStateStore, source)` for each distinct `source` in the open items.

- [ ] **Step 2: Add the handlers**

In `src/main/ipc-handlers.ts`, using the existing `safeHandle` wrapper:

```ts
  safeHandle(IPC_CHANNELS.GET_INBOX, async () => {
    try {
      const { items, total } = inboxStore.listOpen();
      return {
        success: true,
        items,
        total,
        counts: inboxStore.countsByKind(),
        pendingBySource: inboxStore.pendingBySource(),
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-inbox failed:', (err as Error).message);
      return { success: false, items: [], total: 0,
               counts: { decide: 0, problem: 0, know: 0 }, pendingBySource: {} };
    }
  });

  safeHandle(IPC_CHANNELS.INBOX_DECIDE, async (
    _e: any, { id, decision, status }: { id: number; decision: string; status: 'dismissed' | 'done' },
  ) => {
    try {
      inboxStore.decide(id, decision, status);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] inbox-decide failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.INBOX_REOPEN, async (_e: any, { id }: { id: number }) => {
    try {
      inboxStore.reopen(id);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] inbox-reopen failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });
```

**Note on the failure shape:** `GET_INBOX`'s error path returns zeroed counts with `success: false`. The renderer must render the `success: false` case as *"couldn't read the inbox"*, **not** as an empty inbox — a false all-clear on the one surface whose job is to say what needs attention is the worst available failure. Task 8 is where that gets rendered; the shape exists so it can.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts
git commit -m "feat(inbox): IPC to read the inbox and record decisions"
```

---

### Task 8: The Inbox tab

**Files:**
- Create: `src/renderer/components/tabs/InboxTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx` (add to the `TABS` registry)
- Test: `tests/unit/renderer/inbox-tab.test.ts`

**Interfaces:**
- Consumes: `GET_INBOX`, `INBOX_DECIDE`, `INBOX_REOPEN` (Task 6); `serializeTree` from `tests/unit/renderer/helpers/serializeTree.ts`.
- Produces: `InboxTab` React component.

**Context the brief cannot know:** the tab registry in `NexusOverview.tsx` is module-scoped with a derived union — adding an entry to `TABS` extends `TabKey` automatically:

```ts
const TABS = [
  { key: 'overview', label: 'Dashboard' }, ...
] as const;
type TabKey = typeof TABS[number]['key'];
```

`NexusOverview.tsx`'s `fetchAll` uses a **positional** `Promise.all` destructuring. If you add `GET_INBOX` there, add it at the **end** of both the array and the destructuring — inserting in the middle silently misaligns every variable after the insertion point.

Group presentation follows the prototype: *Needs a decision* / *Something is stuck* / *Worth knowing*, each rendered only when non-empty, each item showing title, detail, scope label, source, relative time, and a primary/secondary/skip action triple. Evidence sits behind a disclosure.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/inbox-tab.test.ts
import * as React from 'react';
import { InboxTab } from '../../../src/renderer/components/tabs/InboxTab';
import { serializeTree } from './helpers/serializeTree';

const item = (over: any = {}) => ({
  id: 1, source: 'security-sentinel', code: 'FS-01', scope: 'name:Site A',
  scopeLabel: 'Site A', kind: 'decide', title: 'File permissions are too open',
  detail: 'wp-config.php is world-readable.', status: 'open',
  firstSeenAt: 1000, lastSeenAt: 1000, seenCount: 1, ...over,
});

const props = (over: any = {}) => ({
  loaded: true,
  failed: false,
  items: [item()],
  total: 1,
  counts: { decide: 1, problem: 0, know: 0 },
  onDecide: jest.fn(),
  onReopen: jest.fn(),
  ...over,
});

describe('InboxTab', () => {
  test('renders a decide item under its group', () => {
    const tree = serializeTree(React.createElement(InboxTab, props()));
    expect(tree).toMatchSnapshot();
  });

  test('an empty group is not rendered', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(InboxTab, props())));
    expect(tree).not.toContain('Something is stuck');
    expect(tree).not.toContain('Worth knowing');
  });

  test('an empty inbox says so', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(
      InboxTab, props({ items: [], total: 0, counts: { decide: 0, problem: 0, know: 0 } }),
    )));
    expect(tree).toContain('Nothing needs you');
  });

  test('a read failure is not rendered as an empty inbox', () => {
    // A false all-clear is the worst failure this surface can have.
    const tree = JSON.stringify(serializeTree(React.createElement(
      InboxTab, props({ failed: true, items: [], total: 0 }),
    )));
    expect(tree).not.toContain('Nothing needs you');
    expect(tree.toLowerCase()).toContain("couldn't read");
  });

  test('a truncated list reports the true total', () => {
    const many = Array.from({ length: 100 }, (_, i) => item({ id: i + 1, code: `C-${i}` }));
    const tree = JSON.stringify(serializeTree(React.createElement(
      InboxTab, props({ items: many, total: 250, counts: { decide: 250, problem: 0, know: 0 } }),
    )));
    expect(tree).toContain('100 of 250');
  });

  test('a repeated item shows how many times it has been seen', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(
      InboxTab, props({ items: [item({ seenCount: 7 })] }),
    )));
    expect(tree).toContain('7');
  });

  test('a paused agent gets a resume action, and it names the agent', () => {
    // Without this the pause is a one-way door — nothing else clears the marker.
    const onResumeAgent = jest.fn();
    const el = React.createElement(InboxTab, props({
      items: [item({ kind: 'problem', title: 'security-sentinel could not finish a run' })],
      counts: { decide: 0, problem: 1, know: 0 },
      pausedSources: ['security-sentinel'],
      onResumeAgent,
    }));
    const tree = JSON.stringify(serializeTree(el));
    expect(tree.toLowerCase()).toContain('paused');
    expect(tree).toContain('Try again');
  });

  test('an unpaused agent gets no resume action', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(InboxTab, props({
      items: [item({ kind: 'problem' })],
      counts: { decide: 0, problem: 1, know: 0 },
      pausedSources: [],
    }))));
    expect(tree).not.toContain('Try again');
  });

  test('no copy promises reversing a live change', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(
      InboxTab, props({ items: [item({ status: 'done', decision: 'Approve' })] }),
    ))).toLowerCase();
    expect(tree).not.toContain('undo');
    expect(tree).not.toContain('revert');
    expect(tree).not.toContain('roll back');
  });

  test('renders no hardcoded hex colours', () => {
    const tree = JSON.stringify(serializeTree(React.createElement(InboxTab, props())));
    expect(tree).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/renderer/inbox-tab.test.ts`
Expected: FAIL — cannot find `InboxTab`.

- [ ] **Step 3: Write `InboxTab`**

The control flow is where the tests bite; the styling is ordinary. Write this skeleton exactly,
then fill in the presentational detail in the same idiom as `src/renderer/components/tabs/OverviewTab.tsx`.

```tsx
// src/renderer/components/tabs/InboxTab.tsx
import * as React from 'react';
import type { InboxItem, InboxKind } from '../../../main/inbox/types';

export interface InboxTabProps {
  loaded: boolean;
  failed: boolean;
  items: InboxItem[];
  total: number;
  counts: Record<InboxKind, number>;
  /** Agent ids currently auto-paused, from GET_INBOX. */
  pausedSources: string[];
  onDecide: (id: number, decision: string, status: 'dismissed' | 'done') => void;
  onReopen: (id: number) => void;
  /** Clear an agent's auto-pause so it may run automatically again. */
  onResumeAgent: (agentId: string) => void;
  onRetry?: () => void;
}

const GROUPS: Array<{ kind: InboxKind; title: string }> = [
  { kind: 'decide',  title: 'Needs a decision' },
  { kind: 'problem', title: 'Something is stuck' },
  { kind: 'know',    title: 'Worth knowing' },
];

export class InboxTab extends React.Component<InboxTabProps> {
  private renderItem(item: InboxItem): React.ReactElement {
    const { onDecide, onReopen } = this.props;
    return React.createElement('div', {
      key: item.id,
      style: {
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 10,
        background: 'var(--nxai-card-bg)',
        padding: '14px 16px',
        marginBottom: 10,
      },
    },
      React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--nxai-card-text)' } }, item.title),
      item.detail && React.createElement('div', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginTop: 4 } }, item.detail),

      // scope is always a labelled string, never a bare number
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginTop: 6 } },
        `${item.scopeLabel} · ${item.source}`,
        item.seenCount > 1 ? ` · seen ${item.seenCount} times` : '',
      ),

      item.evidence && React.createElement('details', { style: { marginTop: 8 } },
        React.createElement('summary', { style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', cursor: 'pointer' } }, 'Evidence'),
        React.createElement('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--nxai-card-sub)' } }, item.evidence),
      ),

      // "Reopen" reverses the DECISION, never a live change — see Global Constraints.
      item.status === 'open'
        ? React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
            React.createElement('button', { onClick: () => onDecide(item.id, 'Approve', 'done') }, 'Approve'),
            React.createElement('button', { onClick: () => onDecide(item.id, 'Not now', 'dismissed') }, 'Not now'),
          )
        : React.createElement('button', { style: { marginTop: 12 }, onClick: () => onReopen(item.id) }, 'Reopen'),
    );
  }

  render() {
    const { loaded, failed, items, total, onRetry } = this.props;

    // Order matters: a failed read must never fall through to the empty state.
    // "Nothing needs you" when we simply could not look is the worst thing this
    // surface can say.
    if (failed) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-text)' } },
        React.createElement('div', null, "Couldn't read the inbox."),
        onRetry && React.createElement('button', { onClick: onRetry, style: { marginTop: 12 } }, 'Try again'),
      );
    }
    if (!loaded) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } }, 'Loading…');
    }
    if (items.length === 0) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } },
        'Nothing needs you right now.');
    }

    const groups = GROUPS
      .map(g => ({ ...g, rows: items.filter(i => i.kind === g.kind) }))
      .filter(g => g.rows.length > 0);   // an empty group is not rendered

    return React.createElement('div', { style: { padding: '0 0 24px' } },
      items.length < total && React.createElement('div', {
        style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, `Showing ${items.length} of ${total}`),

      ...groups.map(g => React.createElement('div', { key: g.kind, style: { marginBottom: 24 } },
        React.createElement('div', {
          style: { fontSize: 13, fontWeight: 700, color: 'var(--nxai-card-text)', marginBottom: 10 },
        }, `${g.title} · ${g.rows.length}`),
        ...g.rows.map(r => this.renderItem(r)),
      )),
    );
  }
}
```

Two notes on this skeleton:

- **The type-only import from main is precedented**, not a layering violation:
  `src/renderer/components/credentials/ConnectionsPanel.tsx:3` does the same thing at the same
  path depth (`import type { Connection } from '../../../main/credentials/types'`). Keep it
  `import type` — a value import from main would pull main-process code into the renderer bundle.
- **The four `--nxai-*` names used here were checked against `src/renderer/utils/theme.ts` and
  exist.** If you add another, check it too: a mistyped variable does not throw and does not fail
  a snapshot — it renders as an invisible colour. The hex-scan test catches a hardcoded colour,
  never a misspelled variable.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/renderer/inbox-tab.test.ts`
Expected: PASS, 8 tests. Inspect the written snapshot — confirm it contains real structure, not an empty shell.

- [ ] **Step 5: Register the tab**

Add `{ key: 'inbox', label: 'Inbox' }` to `TABS` in `NexusOverview.tsx` and render `InboxTab` for it. Wire `GET_INBOX` into `fetchAll` **at the end** of both the `Promise.all` array and its destructuring.

- [ ] **Step 6: Typecheck and run the renderer suite**

Run: `npx tsc --noEmit && npx jest tests/unit/renderer`
Expected: no new type errors; existing snapshots unchanged except the intended `TABS` addition.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "feat(inbox): Inbox tab with three groups

A read failure renders as 'couldn't read the inbox', never as an empty
one — a false all-clear is the worst failure this surface can have."
```

---

### Task 9: Per-agent counts derive from the inbox

**Files:**
- Modify: `src/renderer/components/agents/AgentsHub.tsx`
- Modify: `src/renderer/components/agents/AgentCard.tsx:54`
- Modify: `src/renderer/components/agents/AgentWorkspace.tsx:344,442,508`
- Test: `tests/unit/renderer/inbox-pending.test.ts`

**Interfaces:**
- Consumes: `pendingBySource` from the `GET_INBOX` response (Task 6).
- Produces: a single derivation shared by all five call sites.

**Why:** five call sites each carry their own `filter(e => e.status === 'review')` over renderer `localStorage`, counting **runs that found something** rather than decisions. That is the number the review flagged. Replace all five with the store-backed count. This is the same collapse `FleetCounts` performed for site counts in the foundation spec.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/inbox-pending.test.ts
import { pendingForAgent, totalPending, agentsWithPending } from
  '../../../src/renderer/components/agents/pending';

const counts = { 'security-sentinel': 3, 'seo-insights': 1 };

describe('pending counts derive from one source', () => {
  test('per-agent count reads the map', () => {
    expect(pendingForAgent(counts, 'security-sentinel')).toBe(3);
  });

  test('an agent with no entry has none pending, not undefined', () => {
    expect(pendingForAgent(counts, 'log-processor')).toBe(0);
  });

  test('total is the sum across agents', () => {
    expect(totalPending(counts)).toBe(4);
  });

  test('agentsWithPending counts agents, not items', () => {
    expect(agentsWithPending(counts)).toBe(2);
  });

  test('an agent present with a zero count is not "with pending"', () => {
    expect(agentsWithPending({ ...counts, 'log-processor': 0 })).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/renderer/inbox-pending.test.ts`
Expected: FAIL — cannot find `.../agents/pending`.

- [ ] **Step 3: Write the shared derivation**

```ts
// src/renderer/components/agents/pending.ts

/** Open inbox items per agent id, from GET_INBOX. */
export type PendingCounts = Record<string, number>;

export function pendingForAgent(counts: PendingCounts, agentId: string): number {
  return counts[agentId] ?? 0;
}

export function totalPending(counts: PendingCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function agentsWithPending(counts: PendingCounts): number {
  return Object.values(counts).filter(n => n > 0).length;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/unit/renderer/inbox-pending.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Replace all five call sites**

Replace each `filter(e => e.status === 'review')` derivation with the corresponding helper, threading `pendingBySource` down from `GET_INBOX`. `AgentsHub.renderInbox()`'s "Review now" button navigates to the Inbox tab rather than to the first agent with pending items.

Confirm the count is gone from the renderer store path:

```bash
grep -rn "status === 'review'" src/renderer/
```
Expected: no matches.

- [ ] **Step 6: Run the full unit suite**

Run: `npx tsc --noEmit && npx jest tests/unit`
Expected: no new type errors; no new failures against the branch baseline.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/unit/renderer
git commit -m "refactor(agents): pending counts derive from the inbox

Five copies of filter(e => e.status === 'review') counted runs that found
something, not decisions. One store-backed derivation replaces them."
```

---

## Live verification checklist (needs eyes, not tests)

Nothing automated can judge these. Run them in Local against the dev fleet:

- [ ] The Inbox renders correctly in **both** light and dark mode.
- [ ] Titles read as plain language to someone who did not write the agent.
- [ ] Three groups is the right grouping at real volume — the open question from `DECISIONS.md` that this spec deliberately declined to guess at.
- [ ] Running the same sweep three times leaves the inbox the same size, with counts rising.
- [ ] Dismissing an item and re-running the sweep leaves it dismissed.
- [ ] With Nexus closed during a scheduled run, items appear on next open.

## Known limitations to record, not fix here

- **`scope` uses `name:<siteName>`, not a stable site id.** Names collide across sources (CLAUDE.md), so a Local site and a WPE install with the same name would share inbox items. The namespace prefix means resolving names to ids later will not silently merge anything in the meantime.
- **"Worth knowing" has no producer** and will be empty until an agent can raise informational items. Intended — see design section C.
- **Fleet blockers** ("44 sites never read", "Meridian stopped 6 days") are not in "Something is stuck". Each needs its own producer and staleness policy.
- **`aggregateFailures` remains unwired**, superseded by the store's UNIQUE constraint. Either delete it in a later change or leave it as the tested reference for the streak logic `shouldAutoPause` shares.
