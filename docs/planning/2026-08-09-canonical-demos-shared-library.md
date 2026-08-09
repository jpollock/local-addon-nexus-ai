# Canonical Demos `shared/` Generator Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `shared/` generator library that all canonical demo sites depend on — deterministic seeding, a manifest count gate, checkpointed and budgeted AI generation, and a WP-CLI wrapper that works against Local's MySQL socket.

**Architecture:** A single ESM TypeScript package (`@canonical-demos/shared`) inside a new npm-workspaces monorepo at `~/development/wpengine/canonical-demos/`. Every module is pure or takes its I/O as an injected dependency, so the whole suite runs with no network and no WordPress. External effects live behind two interfaces — `CompletionClient` (AI) and `WpRunner` (WP-CLI) — which tests replace with fakes.

**Tech Stack:** Node ≥18, TypeScript 5.4 (strict, ESM, `NodeNext`), vitest 4, zod 3, `@faker-js/faker` 9, `@anthropic-ai/sdk` 0.30.

**Source spec:** `docs/superpowers/specs/2026-08-09-canonical-demo-sites-design.md` (§1.1, §6)

## Global Constraints

- **Node ≥18**, `"type": "module"`, TypeScript `strict: true`, module resolution `NodeNext`.
- **No test may touch the network, the filesystem outside a temp dir, or a WordPress install.** AI and WP-CLI effects are injected.
- **`alpine-outfitters-demo/` is not modified by this plan.** It keeps its own git repo and its own `scripts/` copy. `shared/` is lifted from it by copy-and-generalize, never by moving files out of it.
- **Determinism:** one `seed` value drives every random choice. Two runs with the same seed produce byte-identical output. `Math.random()` is banned in `shared/src/**`.
- **`origin` has no default.** Any record representing observed-vs-seeded provenance must require the field explicitly. Enforced in later plans; stated here because `shared/` defines the types those plans consume.
- **Never `git push`, `npm version`, or `git tag`** — commits only.
- Spec §6 rule that governs this whole library: **a manifest is the source of truth for counts, and `verify` fails when actual ≠ manifest.**

---

## File Structure

| File | Responsibility |
|---|---|
| `canonical-demos/package.json` | Workspace root. Declares `shared` as the only workspace for now. |
| `canonical-demos/.gitignore` | Ignores `node_modules`, `.env`, and `alpine-outfitters-demo/` (a nested independent repo). |
| `canonical-demos/tsconfig.base.json` | Shared compiler options. |
| `shared/package.json` | Package manifest for `@canonical-demos/shared`. |
| `shared/vitest.config.ts` | Test config. |
| `shared/src/seed.ts` | Deterministic RNG + seeded Faker factory. No other module may generate randomness. |
| `shared/src/manifest.ts` | Manifest schema, loader, and the count gate. |
| `shared/src/checkpoint.ts` | Append-only JSONL progress store for resumable runs. |
| `shared/src/budget.ts` | Token budget accounting. |
| `shared/src/ai-client.ts` | `CompletionClient` interface, model preflight, budget-charging generate. |
| `shared/src/anthropic-client.ts` | The one module that imports the Anthropic SDK. Adapter only, no logic. |
| `shared/src/generate-runner.ts` | The resumable generation loop: checkpoint + budget + handler. |
| `shared/src/wp-cli.ts` | WP-CLI argv construction (incl. Local's MySQL socket) and execution. |
| `shared/src/verify.ts` | Counts live content and checks it against the manifest. |
| `shared/src/index.ts` | Public exports. |

Each module gets a sibling `*.test.ts`.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `canonical-demos/package.json`
- Create: `canonical-demos/.gitignore`
- Create: `canonical-demos/tsconfig.base.json`
- Create: `canonical-demos/shared/package.json`
- Create: `canonical-demos/shared/tsconfig.json`
- Create: `canonical-demos/shared/vitest.config.ts`
- Create: `canonical-demos/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable `npm test -w @canonical-demos/shared`; the import specifier `@canonical-demos/shared` for later site packages.

- [ ] **Step 1: Initialize the repo and workspace root**

`alpine-outfitters-demo/` already lives in this directory and has its own `.git`. It must be ignored, not embedded.

```bash
cd ~/development/wpengine/canonical-demos
git init -q
cat > .gitignore <<'EOF'
node_modules/
.env
dist/
*.log

# Independent repo with its own history — deliberately not a workspace.
alpine-outfitters-demo/
EOF
cat > package.json <<'EOF'
{
  "name": "canonical-demos",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18.0.0" },
  "workspaces": ["shared"],
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
EOF
cat > tsconfig.base.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
EOF
```

- [ ] **Step 2: Create the `shared` package**

```bash
mkdir -p ~/development/wpengine/canonical-demos/shared/src
cd ~/development/wpengine/canonical-demos/shared
cat > package.json <<'EOF'
{
  "name": "@canonical-demos/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@faker-js/faker": "^9.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.4.5",
    "vitest": "^4.1.10"
  }
}
EOF
cat > tsconfig.json <<'EOF'
{
  "extends": "../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
EOF
cat > vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
EOF
echo "export {};" > src/index.ts
```

- [ ] **Step 3: Install and verify the toolchain runs**

```bash
cd ~/development/wpengine/canonical-demos && npm install
cd shared && npx vitest run
```

Expected: vitest exits reporting **"No test files found"** — that is success for this step. `npm install` must complete without workspace errors, and must not create a `node_modules` inside `alpine-outfitters-demo/`.

- [ ] **Step 4: Confirm Alpine was untouched**

```bash
git -C ~/development/wpengine/canonical-demos/alpine-outfitters-demo status --short
git -C ~/development/wpengine/canonical-demos status --short | head
```

Expected: Alpine's own repo reports only the three symlink-script edits already in flight from prior work — no new files. The monorepo's status must **not** list `alpine-outfitters-demo/`.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add .gitignore package.json tsconfig.base.json shared package-lock.json
git commit -m "chore: scaffold canonical-demos monorepo with shared package"
```

---

### Task 2: Deterministic seeding

**Files:**
- Create: `shared/src/seed.ts`
- Test: `shared/src/seed.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createRng(seed: number): Rng` where `Rng = { next(): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[]; weighted<T>(entries: readonly (readonly [T, number])[]): T }` — note the inner `readonly` on the tuple; it is the only form that typechecks against the test's `as const` literal
  - `seededFaker(seed: number): Faker`
  - `int` is inclusive of `min`, exclusive of `max`.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/seed.test.ts
import { describe, expect, it } from 'vitest';
import { createRng, seededFaker } from './seed.js';

describe('createRng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toEqual(createRng(2).next());
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int is inclusive of min and exclusive of max', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(5, 8));
    expect([...seen].sort()).toEqual([5, 6, 7]);
  });

  it('shuffle is deterministic and preserves every element', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = createRng(11).shuffle(input);
    const second = createRng(11).shuffle(input);
    expect(first).toEqual(second);
    expect([...first].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input not mutated
  });

  it('weighted respects weights and never returns a zero-weight entry', () => {
    const rng = createRng(5);
    const counts = { a: 0, b: 0, z: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[rng.weighted([['a', 3], ['b', 1], ['z', 0]] as const)]++;
    }
    expect(counts.z).toBe(0);
    expect(counts.a).toBeGreaterThan(counts.b);
  });
});

describe('seededFaker', () => {
  it('produces identical output for identical seeds', () => {
    expect(seededFaker(99).person.firstName()).toEqual(seededFaker(99).person.firstName());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/seed.test.ts`
Expected: FAIL — `Failed to resolve import "./seed.js"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/seed.ts
import { Faker, en } from '@faker-js/faker';

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

/**
 * mulberry32 — small, fast, and stable across Node versions, which matters
 * because a regenerated corpus must be byte-identical (spec §6).
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError(`int() requires integers, got (${min}, ${max})`);
    }
    if (max <= min) throw new RangeError(`int() requires max > min, got (${min}, ${max})`);
    return min + Math.floor(next() * (max - min));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('pick() called on an empty array');
    return items[int(0, items.length)]!;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (total <= 0) throw new RangeError('weighted() requires at least one positive weight');
    let roll = next() * total;
    for (const [value, weight] of entries) {
      if (weight <= 0) continue;
      roll -= weight;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1]![0];
  };

  return { next, int, pick, shuffle, weighted };
}

export function seededFaker(seed: number): Faker {
  const faker = new Faker({ locale: en });
  faker.seed(seed);
  return faker;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/seed.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/seed.ts shared/src/seed.test.ts
git commit -m "feat(shared): deterministic RNG and seeded faker factory"
```

---

### Task 3: Manifest schema and the count gate

**Files:**
- Create: `shared/src/manifest.ts`
- Test: `shared/src/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ManifestSchema`, `Manifest = { site: string; seed: number; entries: ManifestEntry[] }`, `ManifestEntry = { postType: string; tier: 'hero' | 'composite'; count: number }`
  - `parseManifest(raw: unknown): Manifest`
  - `expectedCounts(m: Manifest): Record<string, number>` — sums tiers per post type
  - `verifyCounts(m: Manifest, actual: Record<string, number>): CountReport` where `CountReport = { ok: boolean; mismatches: CountMismatch[] }` and `CountMismatch = { postType: string; expected: number; actual: number }`
  - `assertCounts(m: Manifest, actual: Record<string, number>): void` — throws `CountMismatchError`
  - `CountMismatchError extends Error` with a `.mismatches` property

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/manifest.test.ts
import { describe, expect, it } from 'vitest';
import {
  CountMismatchError,
  assertCounts,
  expectedCounts,
  parseManifest,
  verifyCounts,
} from './manifest.js';

const manifest = parseManifest({
  site: 'cedar-vale-health',
  seed: 20260809,
  entries: [
    { postType: 'location', tier: 'composite', count: 25 },
    { postType: 'provider', tier: 'hero', count: 60 },
    { postType: 'post', tier: 'hero', count: 215 },
    { postType: 'post', tier: 'composite', count: 385 },
  ],
});

describe('parseManifest', () => {
  it('rejects an entry missing a count', () => {
    expect(() =>
      parseManifest({ site: 's', seed: 1, entries: [{ postType: 'p', tier: 'hero' }] }),
    ).toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      parseManifest({ site: 's', seed: 1, entries: [{ postType: 'p', tier: 'gold', count: 1 }] }),
    ).toThrow();
  });

  it('rejects an empty entry list', () => {
    expect(() => parseManifest({ site: 's', seed: 1, entries: [] })).toThrow();
  });
});

describe('expectedCounts', () => {
  it('sums tiers for the same post type', () => {
    expect(expectedCounts(manifest)).toEqual({ location: 25, provider: 60, post: 600 });
  });
});

describe('verifyCounts', () => {
  it('passes when every count matches', () => {
    const report = verifyCounts(manifest, { location: 25, provider: 60, post: 600 });
    expect(report).toEqual({ ok: true, mismatches: [] });
  });

  it('reports both numbers when a count is short — the 300-vs-60 gate', () => {
    const report = verifyCounts(manifest, { location: 25, provider: 60, post: 60 });
    expect(report.ok).toBe(false);
    expect(report.mismatches).toEqual([{ postType: 'post', expected: 600, actual: 60 }]);
  });

  it('treats a missing post type as actual 0, not as absent', () => {
    const report = verifyCounts(manifest, { location: 25, provider: 60 });
    expect(report.mismatches).toEqual([{ postType: 'post', expected: 600, actual: 0 }]);
  });

  it('reports content the manifest never declared', () => {
    const report = verifyCounts(manifest, { location: 25, provider: 60, post: 600, ghost: 4 });
    expect(report.mismatches).toEqual([{ postType: 'ghost', expected: 0, actual: 4 }]);
  });
});

describe('assertCounts', () => {
  it('throws CountMismatchError naming the post type and both numbers', () => {
    try {
      assertCounts(manifest, { location: 25, provider: 60, post: 60 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CountMismatchError);
      const err = e as CountMismatchError;
      expect(err.mismatches).toHaveLength(1);
      expect(err.message).toContain('post');
      expect(err.message).toContain('600');
      expect(err.message).toContain('60');
    }
  });

  it('does not throw when counts match', () => {
    expect(() => assertCounts(manifest, { location: 25, provider: 60, post: 600 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/manifest.test.ts`
Expected: FAIL — cannot resolve `./manifest.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/manifest.ts
import { z } from 'zod';

export const ManifestEntrySchema = z.object({
  postType: z.string().min(1),
  tier: z.enum(['hero', 'composite']),
  count: z.number().int().positive(),
});

export const ManifestSchema = z.object({
  site: z.string().min(1),
  seed: z.number().int(),
  entries: z.array(ManifestEntrySchema).min(1),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export interface CountMismatch {
  postType: string;
  expected: number;
  actual: number;
}

export interface CountReport {
  ok: boolean;
  mismatches: CountMismatch[];
}

export class CountMismatchError extends Error {
  constructor(public readonly mismatches: CountMismatch[]) {
    const detail = mismatches
      .map((m) => `${m.postType}: expected ${m.expected}, actual ${m.actual}`)
      .join('; ');
    super(`Manifest count mismatch — ${detail}`);
    this.name = 'CountMismatchError';
  }
}

export function parseManifest(raw: unknown): Manifest {
  return ManifestSchema.parse(raw);
}

export function expectedCounts(manifest: Manifest): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of manifest.entries) {
    totals[entry.postType] = (totals[entry.postType] ?? 0) + entry.count;
  }
  return totals;
}

export function verifyCounts(manifest: Manifest, actual: Record<string, number>): CountReport {
  const expected = expectedCounts(manifest);
  const postTypes = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const mismatches: CountMismatch[] = [];

  for (const postType of postTypes) {
    const want = expected[postType] ?? 0;
    const got = actual[postType] ?? 0;
    if (want !== got) mismatches.push({ postType, expected: want, actual: got });
  }

  return { ok: mismatches.length === 0, mismatches };
}

export function assertCounts(manifest: Manifest, actual: Record<string, number>): void {
  const report = verifyCounts(manifest, actual);
  if (!report.ok) throw new CountMismatchError(report.mismatches);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/manifest.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/manifest.ts shared/src/manifest.test.ts
git commit -m "feat(shared): manifest schema and count gate"
```

---

### Task 4: Checkpoint store

**Files:**
- Create: `shared/src/checkpoint.ts`
- Test: `shared/src/checkpoint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class Checkpoint` with `constructor(filePath: string)`, `loadCompleted(): Set<string>`, `record(uid: string, at?: string): void`, `count(): number`
  - Corrupt lines are skipped, and the count of skipped lines is returned by `loadCorruptCount(): number`.

> **Amended during execution (2026-08-09).** Review found that the Step 3 code
> below carries a silent-wrong-answer hazard: `loadCorruptCount()` returned `0`
> before `loadCompleted()` had ever run — indistinguishable from a confirmed zero
> — and `count()` called `loadCompleted()` internally, resetting the corrupt
> counter as a side effect. Ruled: harden. The shipped implementation adds a
> private `readEntries(): { completed: Set<string>; corrupt: number }` that
> parses without mutating; `loadCompleted()` stores the count and marks the
> instance loaded; `count()` mutates nothing; and `loadCorruptCount()` **throws**
> if `loadCompleted()` has not run. `loadCompleted()`'s signature is unchanged,
> so Task 8 is unaffected. Git is the source of truth for the final code.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/checkpoint.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Checkpoint } from './checkpoint.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ckpt-'));
  path = join(dir, 'progress.jsonl');
});

describe('Checkpoint', () => {
  it('returns an empty set when the file does not exist', () => {
    expect(new Checkpoint(path).loadCompleted().size).toBe(0);
  });

  it('records uids that survive a reopen', () => {
    const first = new Checkpoint(path);
    first.record('provider-001');
    first.record('provider-002');

    const reopened = new Checkpoint(path);
    expect(reopened.loadCompleted()).toEqual(new Set(['provider-001', 'provider-002']));
  });

  it('appends rather than truncating', () => {
    new Checkpoint(path).record('a');
    new Checkpoint(path).record('b');
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('deduplicates a uid recorded twice', () => {
    const ckpt = new Checkpoint(path);
    ckpt.record('dupe');
    ckpt.record('dupe');
    expect(ckpt.loadCompleted()).toEqual(new Set(['dupe']));
  });

  it('skips corrupt lines and counts them instead of throwing', () => {
    writeFileSync(path, '{"uid":"good","at":"2026-08-09T00:00:00.000Z"}\nnot json\n{"at":"x"}\n');
    const ckpt = new Checkpoint(path);
    expect(ckpt.loadCompleted()).toEqual(new Set(['good']));
    expect(ckpt.loadCorruptCount()).toBe(2);
  });

  it('writes an ISO timestamp with each record', () => {
    new Checkpoint(path).record('uid-1', '2026-08-09T12:00:00.000Z');
    expect(JSON.parse(readFileSync(path, 'utf8').trim())).toEqual({
      uid: 'uid-1',
      at: '2026-08-09T12:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/checkpoint.test.ts`
Expected: FAIL — cannot resolve `./checkpoint.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/checkpoint.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CheckpointRecord {
  uid: string;
  at: string;
}

/**
 * Append-only progress log. A crash costs one item, not a run (spec §6).
 * Deliberately synchronous: a record that was buffered when the process died
 * is a record that lies about what completed.
 */
export class Checkpoint {
  private corruptCount = 0;

  constructor(private readonly filePath: string) {}

  loadCompleted(): Set<string> {
    this.corruptCount = 0;
    const completed = new Set<string>();
    if (!existsSync(this.filePath)) return completed;

    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<CheckpointRecord>;
        if (typeof parsed.uid === 'string' && parsed.uid !== '') {
          completed.add(parsed.uid);
        } else {
          this.corruptCount++;
        }
      } catch {
        this.corruptCount++;
      }
    }
    return completed;
  }

  loadCorruptCount(): number {
    return this.corruptCount;
  }

  count(): number {
    return this.loadCompleted().size;
  }

  record(uid: string, at: string = new Date().toISOString()): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const entry: CheckpointRecord = { uid, at };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/checkpoint.test.ts`
Expected: PASS — 6 tests. (Amended during execution: the shipped suite is larger, adding coverage for `count()`, `count()`'s non-interference with a pending corrupt-count read, `loadCorruptCount()` throwing before `loadCompleted()`, non-accumulation across repeated loads, parent-directory creation, default-timestamp format, and temp-dir cleanup.)

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/checkpoint.ts shared/src/checkpoint.test.ts
git commit -m "feat(shared): append-only checkpoint store for resumable runs"
```

---

### Task 5: Token budget

**Files:**
- Create: `shared/src/budget.ts`
- Test: `shared/src/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class TokenBudget` with `constructor(limit: number)`, `spend(tokens: number): void`, `spent(): number`, `remaining(): number`, `assertAffordable(estimate: number): void`, `report(): string`
  - `class BudgetExceededError extends Error` with `.limit`, `.spent`, `.attempted`
  - `limit: Infinity` means unlimited.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/budget.test.ts
import { describe, expect, it } from 'vitest';
import { BudgetExceededError, TokenBudget } from './budget.js';

describe('TokenBudget', () => {
  it('tracks spend and remaining', () => {
    const budget = new TokenBudget(1000);
    budget.spend(250);
    budget.spend(150);
    expect(budget.spent()).toBe(400);
    expect(budget.remaining()).toBe(600);
  });

  it('throws when a spend would exceed the limit', () => {
    const budget = new TokenBudget(100);
    budget.spend(90);
    expect(() => budget.spend(20)).toThrow(BudgetExceededError);
  });

  it('does not record the overspend that threw', () => {
    const budget = new TokenBudget(100);
    budget.spend(90);
    expect(() => budget.spend(20)).toThrow();
    expect(budget.spent()).toBe(90);
  });

  it('carries limit, spent and attempted on the error', () => {
    const budget = new TokenBudget(100);
    budget.spend(90);
    try {
      budget.spend(20);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as BudgetExceededError;
      expect(err.limit).toBe(100);
      expect(err.spent).toBe(90);
      expect(err.attempted).toBe(20);
    }
  });

  it('assertAffordable throws before any spend happens', () => {
    const budget = new TokenBudget(100);
    expect(() => budget.assertAffordable(101)).toThrow(BudgetExceededError);
    expect(budget.spent()).toBe(0);
  });

  it('allows spending exactly to the limit', () => {
    const budget = new TokenBudget(100);
    expect(() => budget.spend(100)).not.toThrow();
    expect(budget.remaining()).toBe(0);
  });

  it('treats Infinity as unlimited', () => {
    const budget = new TokenBudget(Number.POSITIVE_INFINITY);
    budget.spend(10_000_000);
    expect(budget.remaining()).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects negative spends', () => {
    expect(() => new TokenBudget(100).spend(-1)).toThrow(RangeError);
  });

  it('reports spend for the abort report', () => {
    const budget = new TokenBudget(1000);
    budget.spend(400);
    expect(budget.report()).toBe('400 / 1000 tokens spent (600 remaining)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/budget.test.ts`
Expected: FAIL — cannot resolve `./budget.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/budget.ts
export class BudgetExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly spent: number,
    public readonly attempted: number,
  ) {
    super(
      `Token budget exceeded: ${spent} of ${limit} already spent, ` +
        `attempted ${attempted} more (${limit - spent} remaining)`,
    );
    this.name = 'BudgetExceededError';
  }
}

export class TokenBudget {
  private used = 0;

  constructor(private readonly limit: number) {
    if (limit < 0) throw new RangeError(`limit must be >= 0, got ${limit}`);
  }

  spent(): number {
    return this.used;
  }

  remaining(): number {
    return this.limit - this.used;
  }

  assertAffordable(estimate: number): void {
    if (estimate < 0) throw new RangeError(`estimate must be >= 0, got ${estimate}`);
    if (this.used + estimate > this.limit) {
      throw new BudgetExceededError(this.limit, this.used, estimate);
    }
  }

  spend(tokens: number): void {
    this.assertAffordable(tokens);
    this.used += tokens;
  }

  report(): string {
    return `${this.used} / ${this.limit} tokens spent (${this.remaining()} remaining)`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/budget.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/budget.ts shared/src/budget.test.ts
git commit -m "feat(shared): token budget with pre-spend assertion"
```

---

### Task 6: AI client with model preflight

This is the fix for what actually killed Alpine's run: an hour of work lost to a model id the API never accepted.

**Files:**
- Create: `shared/src/ai-client.ts`
- Test: `shared/src/ai-client.test.ts`

**Interfaces:**
- Consumes: `TokenBudget`, `BudgetExceededError` from `./budget.js` (Task 5).
- Produces:
  - `interface CompletionRequest { model: string; prompt: string; system?: string; maxTokens: number }`
  - `interface CompletionResult { text: string; inputTokens: number; outputTokens: number }`
  - `interface CompletionClient { complete(req: CompletionRequest): Promise<CompletionResult> }`
  - `class ModelPreflightError extends Error` with `.model`
  - `class AiClient` with `constructor(client: CompletionClient, budget: TokenBudget)`, `preflight(model: string): Promise<void>`, `generate(req: CompletionRequest): Promise<CompletionResult>`

> **Amended during execution (2026-08-09).** The Step 3 code below wraps *any*
> error from `generate()` into `ModelPreflightError`, including
> `BudgetExceededError` — so `preflight()` on an exhausted budget reports a bad
> model id, a confident wrong diagnosis of a different problem, which is the very
> failure mode this module exists to prevent. Ruled: fix. The shipped
> `preflight()` re-throws `BudgetExceededError` unwrapped (requiring a value
> import, `import { BudgetExceededError, type TokenBudget } from './budget.js'` —
> a type-only import cannot satisfy `instanceof`), and the unreachable
> `if (error instanceof ModelPreflightError) throw error;` guard was **deleted**
> rather than commented, since `generate()` has no path that constructs one.
> Git is the source of truth for the final code.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/ai-client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AiClient, ModelPreflightError, type CompletionClient } from './ai-client.js';
import { BudgetExceededError, TokenBudget } from './budget.js';

const fakeClient = (
  impl?: CompletionClient['complete'],
): CompletionClient & { calls: number } => {
  const client = {
    calls: 0,
    async complete(req: Parameters<CompletionClient['complete']>[0]) {
      client.calls++;
      if (impl) return impl(req);
      return { text: 'ok', inputTokens: 10, outputTokens: 20 };
    },
  };
  return client;
};

describe('preflight', () => {
  it('sends a single minimal request', async () => {
    const client = fakeClient();
    const spy = vi.spyOn(client, 'complete');
    await new AiClient(client, new TokenBudget(1000)).preflight('claude-sonnet-5');

    expect(client.calls).toBe(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ model: 'claude-sonnet-5', maxTokens: 1 });
  });

  it('throws ModelPreflightError naming the model when the API rejects it', async () => {
    const client = fakeClient(async () => {
      throw new Error('model: claude-sonnet-4-5@20250929');
    });
    const ai = new AiClient(client, new TokenBudget(1000));

    await expect(ai.preflight('claude-sonnet-4-5@20250929')).rejects.toThrow(ModelPreflightError);
    await expect(ai.preflight('claude-sonnet-4-5@20250929')).rejects.toThrow(
      /claude-sonnet-4-5@20250929/,
    );
  });

  it('preserves the underlying error as the cause', async () => {
    const underlying = new Error('not_found_error');
    const ai = new AiClient(
      fakeClient(async () => {
        throw underlying;
      }),
      new TokenBudget(1000),
    );

    await expect(ai.preflight('bad-model')).rejects.toMatchObject({ cause: underlying });
  });

  it('charges the budget for the preflight call', async () => {
    const budget = new TokenBudget(1000);
    await new AiClient(fakeClient(), budget).preflight('claude-sonnet-5');
    expect(budget.spent()).toBe(30);
  });
});

describe('generate', () => {
  it('returns the completion and charges actual token usage', async () => {
    const budget = new TokenBudget(1000);
    const result = await new AiClient(fakeClient(), budget).generate({
      model: 'claude-sonnet-5',
      prompt: 'write a provider bio',
      maxTokens: 500,
    });

    expect(result.text).toBe('ok');
    expect(budget.spent()).toBe(30);
  });

  it('refuses before calling the API when maxTokens cannot be afforded', async () => {
    const client = fakeClient();
    const ai = new AiClient(client, new TokenBudget(100));

    await expect(
      ai.generate({ model: 'claude-sonnet-5', prompt: 'x', maxTokens: 500 }),
    ).rejects.toThrow(BudgetExceededError);
    expect(client.calls).toBe(0);
  });

  it('does not charge the budget when the API call fails', async () => {
    const budget = new TokenBudget(1000);
    const ai = new AiClient(
      fakeClient(async () => {
        throw new Error('overloaded');
      }),
      budget,
    );

    await expect(
      ai.generate({ model: 'claude-sonnet-5', prompt: 'x', maxTokens: 100 }),
    ).rejects.toThrow('overloaded');
    expect(budget.spent()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/ai-client.test.ts`
Expected: FAIL — cannot resolve `./ai-client.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/ai-client.ts
import type { TokenBudget } from './budget.js';

export interface CompletionRequest {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ModelPreflightError extends Error {
  constructor(
    public readonly model: string,
    cause: unknown,
  ) {
    super(
      `Model preflight failed for "${model}". The generation run was stopped before ` +
        `spending tokens. Check the model id against the provider's current list.`,
      { cause },
    );
    this.name = 'ModelPreflightError';
  }
}

export class AiClient {
  constructor(
    private readonly client: CompletionClient,
    private readonly budget: TokenBudget,
  ) {}

  /**
   * One cheap call to prove the model id is real before a long run.
   * Alpine lost an hour of generation to `claude-sonnet-4-5@20250929`, a
   * Vertex-shaped id sent to the Anthropic API (spec §6).
   */
  async preflight(model: string): Promise<void> {
    try {
      await this.generate({ model, prompt: 'ok', maxTokens: 1 });
    } catch (error) {
      if (error instanceof ModelPreflightError) throw error;
      throw new ModelPreflightError(model, error);
    }
  }

  async generate(req: CompletionRequest): Promise<CompletionResult> {
    // Charge nothing until the call returns, but refuse up front if the
    // requested ceiling is already unaffordable.
    this.budget.assertAffordable(req.maxTokens);
    const result = await this.client.complete(req);
    this.budget.spend(result.inputTokens + result.outputTokens);
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/ai-client.test.ts`
Expected: PASS — 7 tests.

Note the budget-exceeded test asserts `client.calls === 0`, which is what pins the "refuse before calling" ordering. If `assertAffordable` were moved below the `complete` call, that test fails.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/ai-client.ts shared/src/ai-client.test.ts
git commit -m "feat(shared): AI client with model preflight and budget charging"
```

---

### Task 7: Anthropic adapter

Kept separate so exactly one file imports the SDK, and so every other module stays testable without it.

**Files:**
- Create: `shared/src/anthropic-client.ts`
- Test: `shared/src/anthropic-client.test.ts`

**Interfaces:**
- Consumes: `CompletionClient`, `CompletionRequest`, `CompletionResult` from `./ai-client.js` (Task 6).
- Produces:
  - `interface AnthropicMessagesApi { messages: { create(body: unknown): Promise<unknown> } }`
  - `class AnthropicCompletionClient implements CompletionClient` with `constructor(api: AnthropicMessagesApi)`
  - `createAnthropicClient(apiKey: string): AnthropicCompletionClient`
  - `DEFAULT_MODEL = 'claude-sonnet-5'`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/anthropic-client.test.ts
import { describe, expect, it } from 'vitest';
import { AnthropicCompletionClient, DEFAULT_MODEL } from './anthropic-client.js';

const apiReturning = (payload: unknown) => {
  const received: unknown[] = [];
  return {
    received,
    messages: {
      async create(body: unknown) {
        received.push(body);
        return payload;
      },
    },
  };
};

describe('AnthropicCompletionClient', () => {
  it('maps a request onto the messages API shape', async () => {
    const api = apiReturning({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 11, output_tokens: 22 },
    });

    await new AnthropicCompletionClient(api).complete({
      model: 'claude-sonnet-5',
      system: 'be terse',
      prompt: 'hi',
      maxTokens: 64,
    });

    expect(api.received[0]).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 64,
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('omits system when not supplied', async () => {
    const api = apiReturning({
      content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await new AnthropicCompletionClient(api).complete({
      model: 'm',
      prompt: 'p',
      maxTokens: 8,
    });

    expect(api.received[0]).not.toHaveProperty('system');
  });

  it('concatenates every text block and reports usage', async () => {
    const api = apiReturning({
      content: [
        { type: 'text', text: 'part one ' },
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: 'part two' },
      ],
      usage: { input_tokens: 5, output_tokens: 7 },
    });

    const result = await new AnthropicCompletionClient(api).complete({
      model: 'm',
      prompt: 'p',
      maxTokens: 8,
    });

    expect(result).toEqual({ text: 'part one part two', inputTokens: 5, outputTokens: 7 });
  });

  it('throws when the response carries no text block', async () => {
    const api = apiReturning({ content: [], usage: { input_tokens: 1, output_tokens: 0 } });
    await expect(
      new AnthropicCompletionClient(api).complete({ model: 'm', prompt: 'p', maxTokens: 8 }),
    ).rejects.toThrow(/no text content/i);
  });

  it('defaults to a current model id', () => {
    expect(DEFAULT_MODEL).toBe('claude-sonnet-5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/anthropic-client.test.ts`
Expected: FAIL — cannot resolve `./anthropic-client.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/anthropic-client.ts
import Anthropic from '@anthropic-ai/sdk';
import type { CompletionClient, CompletionRequest, CompletionResult } from './ai-client.js';

export const DEFAULT_MODEL = 'claude-sonnet-5';

export interface AnthropicMessagesApi {
  messages: { create(body: unknown): Promise<unknown> };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicCompletionClient implements CompletionClient {
  constructor(private readonly api: AnthropicMessagesApi) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: [{ role: 'user', content: req.prompt }],
    };
    if (req.system !== undefined) body.system = req.system;

    const raw = (await this.api.messages.create(body)) as AnthropicResponse;

    const text = (raw.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');

    if (text === '') {
      throw new Error(`Anthropic response contained no text content for model "${req.model}"`);
    }

    return {
      text,
      inputTokens: raw.usage?.input_tokens ?? 0,
      outputTokens: raw.usage?.output_tokens ?? 0,
    };
  }
}

export function createAnthropicClient(apiKey: string): AnthropicCompletionClient {
  if (apiKey.trim() === '') throw new Error('ANTHROPIC_API_KEY is empty');
  return new AnthropicCompletionClient(new Anthropic({ apiKey }) as AnthropicMessagesApi);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/anthropic-client.test.ts`
Expected: PASS — 5 tests. (Amended during execution: the shipped suite is 9 tests. The standing coverage rule added `createAnthropicClient`'s empty-key and whitespace-key guards, its happy path, and a response with `usage` absent. The happy path *does* construct the SDK client — which performs no network I/O, only object construction — and never calls `.complete()`, so the no-network constraint still holds.)

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/anthropic-client.ts shared/src/anthropic-client.test.ts
git commit -m "feat(shared): Anthropic adapter behind the CompletionClient interface"
```

---

### Task 8: Resumable generation runner

**Files:**
- Create: `shared/src/generate-runner.ts`
- Test: `shared/src/generate-runner.test.ts`

**Interfaces:**
- Consumes: `Checkpoint` from `./checkpoint.js` (Task 4).
- Produces:
  - `interface GenerationItem { uid: string }`
  - `interface RunOptions<TItem extends GenerationItem, TResult> { items: readonly TItem[]; checkpoint: Checkpoint; handler(item: TItem): Promise<TResult>; onResult(uid: string, value: TResult): void; log?(message: string): void }`
  - `interface RunSummary { generated: number; skipped: number; total: number }`
  - `runGeneration<TItem, TResult>(opts: RunOptions<TItem, TResult>): Promise<RunSummary>`
  - Ordering contract: `onResult` is called **before** the checkpoint records the uid, so a crash between them re-generates rather than losing the item.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/generate-runner.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Checkpoint } from './checkpoint.js';
import { runGeneration } from './generate-runner.js';

let checkpoint: Checkpoint;

beforeEach(() => {
  checkpoint = new Checkpoint(join(mkdtempSync(join(tmpdir(), 'run-')), 'progress.jsonl'));
});

const items = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }];

describe('runGeneration', () => {
  it('generates every item on a clean run', async () => {
    const results: string[] = [];
    const summary = await runGeneration({
      items,
      checkpoint,
      handler: async (item) => item.uid.toUpperCase(),
      onResult: (_uid, value) => results.push(value),
    });

    expect(results).toEqual(['A', 'B', 'C']);
    expect(summary).toEqual({ generated: 3, skipped: 0, total: 3 });
  });

  it('skips items already recorded in the checkpoint', async () => {
    checkpoint.record('a');
    checkpoint.record('b');
    const handled: string[] = [];

    const summary = await runGeneration({
      items,
      checkpoint,
      handler: async (item) => {
        handled.push(item.uid);
        return item.uid;
      },
      onResult: () => {},
    });

    expect(handled).toEqual(['c']);
    expect(summary).toEqual({ generated: 1, skipped: 2, total: 3 });
  });

  it('rethrows a handler failure and keeps prior progress — a crash costs one item', async () => {
    await expect(
      runGeneration({
        items,
        checkpoint,
        handler: async (item) => {
          if (item.uid === 'b') throw new Error('model overloaded');
          return item.uid;
        },
        onResult: () => {},
      }),
    ).rejects.toThrow('model overloaded');

    expect(checkpoint.loadCompleted()).toEqual(new Set(['a']));
  });

  it('does not record a uid whose onResult threw', async () => {
    await expect(
      runGeneration({
        items: [{ uid: 'a' }],
        checkpoint,
        handler: async () => 'value',
        onResult: () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');

    expect(checkpoint.loadCompleted().size).toBe(0);
  });

  it('logs a resume line when prior progress exists', async () => {
    checkpoint.record('a');
    const lines: string[] = [];

    await runGeneration({
      items,
      checkpoint,
      handler: async (item) => item.uid,
      onResult: () => {},
      log: (message) => lines.push(message),
    });

    expect(lines.some((l) => l.includes('resuming') && l.includes('1'))).toBe(true);
  });

  it('handles an empty item list', async () => {
    const summary = await runGeneration({
      items: [],
      checkpoint,
      handler: async () => 'x',
      onResult: () => {},
    });
    expect(summary).toEqual({ generated: 0, skipped: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/generate-runner.test.ts`
Expected: FAIL — cannot resolve `./generate-runner.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/generate-runner.ts
import type { Checkpoint } from './checkpoint.js';

export interface GenerationItem {
  uid: string;
}

export interface RunOptions<TItem extends GenerationItem, TResult> {
  items: readonly TItem[];
  checkpoint: Checkpoint;
  handler(item: TItem): Promise<TResult>;
  onResult(uid: string, value: TResult): void;
  log?(message: string): void;
}

export interface RunSummary {
  generated: number;
  skipped: number;
  total: number;
}

export async function runGeneration<TItem extends GenerationItem, TResult>(
  opts: RunOptions<TItem, TResult>,
): Promise<RunSummary> {
  const completed = opts.checkpoint.loadCompleted();
  const log = opts.log ?? (() => {});

  if (completed.size > 0) {
    log(`resuming: ${completed.size} of ${opts.items.length} items already complete`);
  }

  let generated = 0;
  let skipped = 0;

  for (const item of opts.items) {
    if (completed.has(item.uid)) {
      skipped++;
      continue;
    }

    const value = await opts.handler(item);

    // Persist the result BEFORE the checkpoint. If the process dies between
    // these two lines the item is regenerated — wasteful but correct. The
    // reverse order would record work that was never written.
    opts.onResult(item.uid, value);
    opts.checkpoint.record(item.uid);
    generated++;
  }

  return { generated, skipped, total: opts.items.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/generate-runner.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/generate-runner.ts shared/src/generate-runner.test.ts
git commit -m "feat(shared): resumable generation runner"
```

---

### Task 9: WP-CLI wrapper with Local socket support

Local's MySQL listens on a per-site socket, and `wp-config.php` sets `DB_HOST` to plain `localhost`. A system `wp` therefore fails with **"Error establishing a database connection"** against a running Local site — verified on Alpine Outfitters. The fix is to run the WP-CLI phar under a PHP process with `mysqli.default_socket` pointed at that site's socket.

**Files:**
- Create: `shared/src/wp-cli.ts`
- Test: `shared/src/wp-cli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface WpTarget { path: string; mysqlSocket?: string; php?: string; wpPhar?: string }`
  - `buildWpInvocation(target: WpTarget, args: readonly string[]): { command: string; argv: string[] }`
  - `localMysqlSocket(siteId: string, home?: string): string`
  - `interface WpRunner { run(command: string, argv: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }> }`
  - `class WpCli` with `constructor(target: WpTarget, runner: WpRunner)`, `run(args: readonly string[]): Promise<string>`, `json<T>(args: readonly string[]): Promise<T>`
  - `class WpCliError extends Error` with `.code`, `.stderr`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/wp-cli.test.ts
import { describe, expect, it } from 'vitest';
import { WpCli, WpCliError, buildWpInvocation, localMysqlSocket, type WpRunner } from './wp-cli.js';

const runner = (
  result: Partial<{ stdout: string; stderr: string; code: number }>,
): WpRunner & { last?: { command: string; argv: readonly string[] } } => {
  const r: WpRunner & { last?: { command: string; argv: readonly string[] } } = {
    async run(command, argv) {
      r.last = { command, argv };
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.code ?? 0 };
    },
  };
  return r;
};

describe('buildWpInvocation', () => {
  it('invokes wp directly when no socket is supplied', () => {
    const { command, argv } = buildWpInvocation({ path: '/srv/site' }, ['post', 'list']);
    expect(command).toBe('wp');
    expect(argv).toEqual(['--path=/srv/site', 'post', 'list']);
  });

  it('runs the phar under php with mysqli.default_socket when a socket is supplied', () => {
    const { command, argv } = buildWpInvocation(
      { path: '/srv/site', mysqlSocket: '/tmp/mysqld.sock' },
      ['option', 'get', 'siteurl'],
    );

    expect(command).toBe('php');
    expect(argv).toEqual([
      '-d',
      'mysqli.default_socket=/tmp/mysqld.sock',
      '-d',
      'error_reporting=E_ALL & ~E_DEPRECATED',
      '/usr/local/bin/wp',
      '--path=/srv/site',
      'option',
      'get',
      'siteurl',
    ]);
  });

  it('honours php and wpPhar overrides', () => {
    const { command, argv } = buildWpInvocation(
      { path: '/srv/site', mysqlSocket: '/s.sock', php: '/opt/php', wpPhar: '/opt/wp' },
      ['cli', 'version'],
    );
    expect(command).toBe('/opt/php');
    expect(argv).toContain('/opt/wp');
  });

  it('rejects an empty path', () => {
    expect(() => buildWpInvocation({ path: '' }, ['post', 'list'])).toThrow(/path/i);
  });
});

describe('localMysqlSocket', () => {
  it('builds the per-site socket path under Local run/', () => {
    expect(localMysqlSocket('8Id0qz1eA', '/Users/x')).toBe(
      '/Users/x/Library/Application Support/Local/run/8Id0qz1eA/mysql/mysqld.sock',
    );
  });

  it('rejects an empty site id', () => {
    expect(() => localMysqlSocket('', '/Users/x')).toThrow(/site id/i);
  });
});

describe('WpCli', () => {
  it('returns trimmed stdout on success', async () => {
    const cli = new WpCli({ path: '/srv/site' }, runner({ stdout: 'http://example.test\n' }));
    expect(await cli.run(['option', 'get', 'siteurl'])).toBe('http://example.test');
  });

  it('throws WpCliError carrying code and stderr on failure', async () => {
    const cli = new WpCli({ path: '/srv/site' }, runner({ code: 1, stderr: 'Error: no DB' }));
    await expect(cli.run(['post', 'list'])).rejects.toThrow(WpCliError);
    await expect(cli.run(['post', 'list'])).rejects.toMatchObject({ code: 1, stderr: 'Error: no DB' });
  });

  it('appends --format=json and parses the result', async () => {
    const r = runner({ stdout: '[{"ID":1},{"ID":2}]' });
    const cli = new WpCli({ path: '/srv/site' }, r);

    expect(await cli.json<{ ID: number }[]>(['post', 'list'])).toEqual([{ ID: 1 }, { ID: 2 }]);
    expect(r.last!.argv).toContain('--format=json');
  });

  it('does not duplicate --format=json when already present', async () => {
    const r = runner({ stdout: '[]' });
    await new WpCli({ path: '/srv/site' }, r).json(['post', 'list', '--format=json']);
    expect(r.last!.argv.filter((a) => a === '--format=json')).toHaveLength(1);
  });

  it('throws a diagnostic error when stdout is not valid JSON', async () => {
    const cli = new WpCli({ path: '/srv/site' }, runner({ stdout: 'PHP Warning: something' }));
    await expect(cli.json(['post', 'list'])).rejects.toThrow(/not valid JSON/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/wp-cli.test.ts`
Expected: FAIL — cannot resolve `./wp-cli.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/wp-cli.ts
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WpTarget {
  path: string;
  /**
   * Local runs MySQL on a per-site unix socket while wp-config.php says
   * DB_HOST=localhost, so a system `wp` cannot connect. Supplying the socket
   * switches the invocation to `php -d mysqli.default_socket=... <phar>`.
   */
  mysqlSocket?: string;
  php?: string;
  wpPhar?: string;
}

export interface WpRunner {
  run(
    command: string,
    argv: readonly string[],
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

export class WpCliError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'WpCliError';
  }
}

export function buildWpInvocation(
  target: WpTarget,
  args: readonly string[],
): { command: string; argv: string[] } {
  if (target.path.trim() === '') throw new Error('WpTarget.path must not be empty');
  const pathArg = `--path=${target.path}`;

  if (target.mysqlSocket === undefined) {
    return { command: 'wp', argv: [pathArg, ...args] };
  }

  return {
    command: target.php ?? 'php',
    argv: [
      '-d',
      `mysqli.default_socket=${target.mysqlSocket}`,
      '-d',
      'error_reporting=E_ALL & ~E_DEPRECATED',
      target.wpPhar ?? '/usr/local/bin/wp',
      pathArg,
      ...args,
    ],
  };
}

export function localMysqlSocket(siteId: string, home: string = homedir()): string {
  if (siteId.trim() === '') throw new Error('site id must not be empty');
  return `${home}/Library/Application Support/Local/run/${siteId}/mysql/mysqld.sock`;
}

export class NodeWpRunner implements WpRunner {
  async run(command: string, argv: readonly string[]) {
    try {
      const { stdout, stderr } = await execFileAsync(command, [...argv], {
        maxBuffer: 64 * 1024 * 1024,
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number; message: string };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message, code: e.code ?? 1 };
    }
  }
}

export class WpCli {
  constructor(
    private readonly target: WpTarget,
    private readonly runner: WpRunner = new NodeWpRunner(),
  ) {}

  async run(args: readonly string[]): Promise<string> {
    const { command, argv } = buildWpInvocation(this.target, args);
    const { stdout, stderr, code } = await this.runner.run(command, argv);
    if (code !== 0) {
      throw new WpCliError(`wp ${args.join(' ')} failed with exit code ${code}`, code, stderr);
    }
    return stdout.trim();
  }

  async json<T>(args: readonly string[]): Promise<T> {
    const withFormat = args.includes('--format=json') ? args : [...args, '--format=json'];
    const stdout = await this.run(withFormat);
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new Error(
        `wp ${args.join(' ')} returned output that is not valid JSON: ${stdout.slice(0, 200)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/wp-cli.test.ts`
Expected: PASS — **11** tests (this plan originally said 12; the test file above contains 11 `it()` blocks — `WpCli` has 5 cases, not 6). No process is spawned: every test injects a fake `WpRunner`, and `NodeWpRunner` is never constructed because `WpCli`'s default parameter is only evaluated when omitted. `NodeWpRunner` is therefore a deliberate, documented coverage exclusion — testing it would spawn a process, which the Definition of Done forbids.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/wp-cli.ts shared/src/wp-cli.test.ts
git commit -m "feat(shared): WP-CLI wrapper with Local MySQL socket support"
```

---

### Task 10: Site verification against the manifest

**Files:**
- Create: `shared/src/verify.ts`
- Test: `shared/src/verify.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `expectedCounts`, `verifyCounts`, `CountReport` from `./manifest.js` (Task 3); `WpCli` from `./wp-cli.js` (Task 9).
- Produces:
  - `interface PostTypeCounter { count(postType: string): Promise<number> }`
  - `class WpPostTypeCounter implements PostTypeCounter` with `constructor(cli: WpCli)`
  - `verifySite(counter: PostTypeCounter, manifest: Manifest): Promise<CountReport>`
  - `formatReport(report: CountReport): string`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/verify.test.ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest.js';
import { WpPostTypeCounter, formatReport, verifySite, type PostTypeCounter } from './verify.js';
import { WpCli, type WpRunner } from './wp-cli.js';

const manifest = parseManifest({
  site: 'cedar-vale-health',
  seed: 1,
  entries: [
    { postType: 'location', tier: 'composite', count: 25 },
    { postType: 'provider', tier: 'hero', count: 60 },
  ],
});

const counter = (counts: Record<string, number>): PostTypeCounter => ({
  async count(postType) {
    return counts[postType] ?? 0;
  },
});

describe('verifySite', () => {
  it('passes when live counts match the manifest', async () => {
    const report = await verifySite(counter({ location: 25, provider: 60 }), manifest);
    expect(report.ok).toBe(true);
  });

  it('fails and names the shortfall', async () => {
    const report = await verifySite(counter({ location: 25, provider: 7 }), manifest);
    expect(report.mismatches).toEqual([{ postType: 'provider', expected: 60, actual: 7 }]);
  });
});

describe('WpPostTypeCounter', () => {
  it('asks WP-CLI for a published count of the post type', async () => {
    let seen: readonly string[] = [];
    const runner: WpRunner = {
      async run(_command, argv) {
        seen = argv;
        return { stdout: '25\n', stderr: '', code: 0 };
      },
    };

    const count = await new WpPostTypeCounter(new WpCli({ path: '/srv/s' }, runner)).count('location');

    expect(count).toBe(25);
    expect(seen).toEqual([
      '--path=/srv/s',
      'post',
      'list',
      '--post_type=location',
      '--post_status=publish',
      '--format=count',
    ]);
  });

  it('throws when WP-CLI returns something that is not a number', async () => {
    const runner: WpRunner = {
      async run() {
        return { stdout: 'Error: unknown post type', stderr: '', code: 0 };
      },
    };
    await expect(
      new WpPostTypeCounter(new WpCli({ path: '/srv/s' }, runner)).count('nope'),
    ).rejects.toThrow(/not a number/i);
  });
});

describe('formatReport', () => {
  it('renders a passing report', () => {
    expect(formatReport({ ok: true, mismatches: [] })).toBe('✅ All manifest counts match.');
  });

  it('renders every mismatch with both numbers', () => {
    const text = formatReport({
      ok: false,
      mismatches: [
        { postType: 'post', expected: 600, actual: 60 },
        { postType: 'ghost', expected: 0, actual: 4 },
      ],
    });
    expect(text).toContain('post: expected 600, actual 60');
    expect(text).toContain('ghost: expected 0, actual 4');
    expect(text).toMatch(/^❌/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/verify.test.ts`
Expected: FAIL — cannot resolve `./verify.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/verify.ts
import { expectedCounts, verifyCounts, type CountReport, type Manifest } from './manifest.js';
import type { WpCli } from './wp-cli.js';

export interface PostTypeCounter {
  count(postType: string): Promise<number>;
}

export class WpPostTypeCounter implements PostTypeCounter {
  constructor(private readonly cli: WpCli) {}

  async count(postType: string): Promise<number> {
    const raw = await this.cli.run([
      'post',
      'list',
      `--post_type=${postType}`,
      '--post_status=publish',
      '--format=count',
    ]);
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed)) {
      throw new Error(
        `wp post list for "${postType}" returned a value that is not a number: ${raw.slice(0, 120)}`,
      );
    }
    return parsed;
  }
}

export async function verifySite(
  counter: PostTypeCounter,
  manifest: Manifest,
): Promise<CountReport> {
  const actual: Record<string, number> = {};
  for (const postType of Object.keys(expectedCounts(manifest))) {
    actual[postType] = await counter.count(postType);
  }
  return verifyCounts(manifest, actual);
}

export function formatReport(report: CountReport): string {
  if (report.ok) return '✅ All manifest counts match.';
  const lines = report.mismatches.map(
    (m) => `  ${m.postType}: expected ${m.expected}, actual ${m.actual}`,
  );
  return [`❌ ${report.mismatches.length} manifest count mismatch(es):`, ...lines].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/verify.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/verify.ts shared/src/verify.test.ts
git commit -m "feat(shared): site verification against the manifest"
```

---

### Task 11: Public exports, typecheck, and a no-`Math.random` guard

**Files:**
- Modify: `shared/src/index.ts`
- Create: `shared/src/determinism.test.ts`

**Interfaces:**
- Consumes: every module from Tasks 2–10.
- Produces: the complete public surface of `@canonical-demos/shared`.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/src/determinism.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as shared from './index.js';

const SRC = new URL('.', import.meta.url).pathname;

describe('determinism guard', () => {
  it('no source module calls Math.random', () => {
    const offenders = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => readFileSync(join(SRC, f), 'utf8').includes('Math.random'));

    expect(offenders).toEqual([]);
  });
});

describe('public surface', () => {
  it('exports every entry point the site packages need', () => {
    for (const name of [
      'createRng',
      'seededFaker',
      'parseManifest',
      'expectedCounts',
      'verifyCounts',
      'assertCounts',
      'CountMismatchError',
      'Checkpoint',
      'TokenBudget',
      'BudgetExceededError',
      'AiClient',
      'ModelPreflightError',
      'AnthropicCompletionClient',
      'createAnthropicClient',
      'DEFAULT_MODEL',
      'runGeneration',
      'WpCli',
      'WpCliError',
      'NodeWpRunner',
      'buildWpInvocation',
      'localMysqlSocket',
      'WpPostTypeCounter',
      'verifySite',
      'formatReport',
    ]) {
      expect(shared, `missing export: ${name}`).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/development/wpengine/canonical-demos/shared && npx vitest run src/determinism.test.ts`
Expected: FAIL — the public-surface test reports missing exports, because `index.ts` is still `export {};`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/src/index.ts
export { createRng, seededFaker, type Rng } from './seed.js';
export {
  CountMismatchError,
  ManifestEntrySchema,
  ManifestSchema,
  assertCounts,
  expectedCounts,
  parseManifest,
  verifyCounts,
  type CountMismatch,
  type CountReport,
  type Manifest,
  type ManifestEntry,
} from './manifest.js';
export { Checkpoint, type CheckpointRecord } from './checkpoint.js';
export { BudgetExceededError, TokenBudget } from './budget.js';
export {
  AiClient,
  ModelPreflightError,
  type CompletionClient,
  type CompletionRequest,
  type CompletionResult,
} from './ai-client.js';
export {
  AnthropicCompletionClient,
  DEFAULT_MODEL,
  createAnthropicClient,
  type AnthropicMessagesApi,
} from './anthropic-client.js';
export {
  runGeneration,
  type GenerationItem,
  type RunOptions,
  type RunSummary,
} from './generate-runner.js';
export {
  NodeWpRunner,
  WpCli,
  WpCliError,
  buildWpInvocation,
  localMysqlSocket,
  type WpRunner,
  type WpTarget,
} from './wp-cli.js';
export {
  WpPostTypeCounter,
  formatReport,
  verifySite,
  type PostTypeCounter,
} from './verify.js';
```

- [ ] **Step 4: Run the full suite and the typechecker**

```bash
cd ~/development/wpengine/canonical-demos/shared
npx vitest run
npm run typecheck
```

Expected: all tests pass and `tsc --noEmit` reports no errors.

As-planned this file's tally was 69 across 10 files (7 seed, 10 manifest, 6 checkpoint, 9 budget, 7 ai-client, 5 anthropic, 6 runner, 11 wp-cli, 6 verify, 2 determinism) — note the plan twice mis-stated this total, first as 68 and then as 70, both times from counting `wp-cli` at 12 instead of 11.

**Actual shipped counts are higher**, because the standing coverage rule added tests during execution. Measured after Task 9: 82 passing across 8 files — 14 seed, 10 manifest, 12 checkpoint, 11 budget, 9 ai-client, 9 anthropic, 6 runner, 11 wp-cli. With Task 10's 6 and Task 11's 2, expect **90 across 10 files**. Re-measure rather than trusting this number.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add shared/src/index.ts shared/src/determinism.test.ts
git commit -m "feat(shared): public exports and determinism guard"
```

---

## Definition of Done

- [ ] `npm test -w @canonical-demos/shared` passes from the monorepo root.
- [ ] `npm run typecheck -w @canonical-demos/shared` is clean.
- [ ] No test performs network I/O, spawns a process, or requires WordPress.
- [ ] `alpine-outfitters-demo/` has no new files and no `node_modules/`, and remains its own git repo.
- [ ] `grep -rn 'Math.random' shared/src --include='*.ts' | grep -v test` returns nothing.
- [ ] One commit per task, none pushed. (Shipped as **21**: 11 task commits + 5 task-review fix commits + 5 final-review fix-wave commits. The original line said "eleven"; the intent — a commit per unit of reviewed work, nothing pushed — is met.)

---

## Post-Merge Follow-Ups

Adjudicated after the final whole-branch review and its single fix wave. All 11 review
findings were addressed; these are the residuals, parked with rulings rather than
churned on. None is load-bearing for this plan. Recorded here because the SDD
scratch workspace is disposable and these would otherwise be lost.

**Carry into Plan 1b — these affect the code that will consume `shared/`:**

1. **`assertReport` has no caller.** The fail-closed verification path exists
   (`verify.ts`) but nothing in the library invokes it — `verifySite` still returns a
   report. Spec §6's central rule ("`verify` **fails** when actual ≠ manifest") is
   therefore enforced only by whoever writes Plan 1b's import script. **Plan 1b must
   call `assertReport`**, not merely print `formatReport`.
2. **`expectedCounts` returns a null-prototype object across the public API boundary**
   (`manifest.ts`). Its declared type is still `Record<string, number>`, so a consumer
   calling `.hasOwnProperty()` / `.toString()` on it, or `toStrictEqual`-ing it against
   an object literal, will throw or fail. Deliberate — it closes a fail-open
   `__proto__` hole — but it is a contract a consumer must know about.
3. **The hard budget can overshoot by one call's real input usage.** A consequence of
   the ruled authorize/record split: `assertAffordable` bounds `maxTokens` (output)
   only, so a long prompt's input tokens can push `used` past `limit`, with the abort
   arriving on the *next* `assertAffordable`. It fails closed, and `preflight()` can now
   silently push `used` past `limit` where it previously threw. No test exercises the
   abort-on-next-call sequel.
4. **`verifyCounts`/`assertCounts` remain exposed to the `__proto__` read hazard** when
   a *caller* passes a plain-object `actual` map (`manifest.ts`): `actual['__proto__']
   ?? 0` yields `Object.prototype`, which flows into a `CountMismatch.actual` typed
   `number` and prints `[object Object]`. Fails closed. The wave's own tests pass
   `Object.create(null)` to work around it, which is the tell.

**Library hygiene, no consumer impact:**

5. `generate-runner.ts` gates `tokensRecorded` accumulation on `typeof tokens ===
   'number'` while `checkpoint.ts` gates the persisted field on finite-and-non-negative.
   A `tokensFor` returning `NaN` (realistically, summing an absent `usage`) poisons
   `summary.tokensRecorded` while the checkpoint reports 0. Same NaN-poisons-a-total
   shape as the budget bug, one layer up. **The two predicates should be one shared
   predicate.**
6. Three tests are weaker than their names claim, though each underlying property is
   confirmed in source: `wp-cli.test.ts`'s "defaults to the real execFileAsync" only
   asserts construction doesn't throw (tautological); `checkpoint.test.ts`'s "mutates no
   instance state" would still pass under an idempotent assignment, catching only
   accumulating mutation; `generate-runner.test.ts`'s duplicate-uid test does not pin the
   pre-pass *position* — a check placed inside the loop after the skip would pass every
   test in the file yet fail to refuse a duplicate whose uid is already checkpointed.
   A test with all uids pre-recorded plus a duplicate in `items` closes the last one.
7. `assertAffordable(Infinity)` now throws where it previously succeeded against an
   `Infinity` limit. Correct by intent, unreachable today, unnamed by any finding.
8. `integration.test.ts` and `generate-runner.test.ts` leak one `mkdtempSync` dir per
   run; `checkpoint.test.ts` is the only file that does `rmSync`.
9. `determinism.test.ts` uses `new URL('.', import.meta.url).pathname`, which breaks on
   Windows (`fileURLToPath` is portable), and its `readdirSync` scan is non-recursive —
   harmless while `src/` is flat, silently uncovering any future nested module.
10. A `uid: ''` item passes the duplicate pre-pass, is recorded, then classified corrupt
    on read, so it regenerates on every resume. Pre-existing.
11. `manifest.ts`'s `seed` accepts negatives and values ≥ 2³², but `createRng` does
    `seed >>> 0` while `seededFaker` does not truncate — two seeds differing only above
    2³² give identical RNG streams and different faker streams. Constrain the schema.
12. `tier` is declared on manifest entries and never read; `expectedCounts` sums across
    tiers, so the gate cannot detect "600 posts exist but all composite when 215 should
    be hero." Needs a meta key to fix, so it plausibly belongs with Plan 1b's importer.
13. `tsconfig.base.json` sets `declaration` and `sourceMap` but there is no build script
    and `exports` points at TS source — dead config.
14. `createAnthropicClient` does not expose `maxRetries`/`timeout`, so runs inherit the
    SDK defaults (2 retries) invisibly. The SDK is used as an HTTP transport plus retry
    policy, not as a type source — worth a comment, since a future reader will otherwise
    "fix" the `as AnthropicMessagesApi` cast that keeps the adapter testable.

## What This Plan Deliberately Does Not Do

- No content generation and no prompts — those are per-site and belong to Plan 1b.
- **No `_demo_uid` idempotent-import layer.** Spec §6 requires it, and it lands in Plan 1b with the two-pass importer, because idempotency is a property of the import path rather than of the library. The `uid` this plan threads through `Checkpoint` and `runGeneration` is the same identity that becomes `_demo_uid` on the WordPress side.
- No `origin` provenance types; they arrive with the analytics fixtures in Plan 3 (spec §4.2).
- No `design-system/`; it arrives with the first theme in Plan 1d.
- No Alpine migration onto `shared/` (spec §7.2).

## Follow-On Plans

| Plan | Covers | Depends on |
|---|---|---|
| **1b** | Cedar & Vale flagship — seeder plugin, ACF field groups, 6 generators, two-pass import, JSON-LD | This plan |
| **1c** | Cedar & Vale fleet — 7 installs, pathology injection manifest, drift assertions | 1b |
| **1d** | Cedar & Vale design pass — block theme, Block Bindings, CWV + AA gates | 1b |
