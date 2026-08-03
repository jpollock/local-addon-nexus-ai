# External SSH Hosts — Plan A: Taxonomy and Safety Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data model and permission model ready to admit a third site type, without adding one.

**Architecture:** Five independent changes to existing code. Fix the eleven queries that treat `source != 'local'` as "is WP Engine"; harden the transport conformance suite into a real gate; add `platform` and `host` columns with backfill; rename the WPE-scoped permission settings to remote-scoped ones with a migration; and make explicit the guarantee that the permission gate never applies to local sites. No new feature ships — every task is provable by tests.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite 3.53.2), Jest + ts-jest, Zod for settings schemas.

**Spec:** `docs/superpowers/specs/2026-08-02-external-ssh-hosts-design.md`
**Depends on:** Spec 0, on branch `feat/site-transport-abstraction` (unmerged). Branch this work from there.
**Followed by:** Plan B — external SSH hosts (transport, registration, CLI).

## Global Constraints

Every task's requirements implicitly include this section.

- **No behavior change visible to users.** Every task here is behaviour-preserving *today*. Task 1 is correctness-preserving rather than behaviour-changing: `source != 'local'` and `source = 'wpe'` are identical while `source` has exactly two values — the fix matters only once Plan B adds a third. If any task produces an observable difference, that is a defect, not an intended outcome.
- **Never `git push`, `npm version`, or `git tag`.** Commit locally only.
- **Tests run against the system-Node build of `better-sqlite3`.** Run `npm install` before testing; `npm run rebuild` only before loading in Local. Never interleave — and note the repo may currently be Electron-built, in which case `npm install` is required first.
- **Do not change `better-sqlite3` from 12.11.1.**
- **New `NexusSettings` fields MUST be added to `UpdateSettingsSchema` in `src/common/schemas.ts`.** That schema is `.strict()` (line 71) and silently strips unlisted fields, so a settings change looks like it works in the UI and never persists. This has bitten this project before.
- **Baseline:** 12 failed suites / 22 failed tests pre-exist from native modules. Add none.
- **`environment` already exists** on `sites` and is populated for WPE installs by `GraphService.upsertSite` (`:339`). Do not re-add it.
- **Out of scope:** `ExternalSshTransport`, registration, CLI, `ssh:` target parsing, `EXTERNAL_REMOTE_POLICY` — all Plan B. Retiring `source` — a later spec.

---

## File Structure

**Modified:**

| Path | Change |
|---|---|
| `src/main/assistant/AssistantService.ts:23` | landmine query |
| `src/main/ipc-handlers.ts:465,1833` | landmine queries |
| `src/main/mcp/modules/fleet/fleet-summary.ts:36,41` | landmine queries |
| `src/main/mcp/modules/fleet/find-sites-with-plugin.ts:75,95` | landmine queries |
| `src/main/mcp/modules/fleet/find-sites-with-theme.ts:80,98` | landmine queries |
| `src/main/mcp/modules/fleet-intelligence/fleet-plugins.ts:88,94` | landmine queries |
| `src/main/events/GraphService.ts` | add `platform` + `host` columns, backfill |
| `src/common/types.ts:275-315` | settings rename |
| `src/common/schemas.ts:61-71` | schema rename |
| `src/main/mcp/utils/operation-permissions.ts` | settings rename, migration, `isGatedHost` |
| `tests/unit/transport/conformance.test.ts` | harden into a real gate |

**Created:** `tests/unit/graph/source-semantics.test.ts`, `tests/unit/graph/taxonomy-migration.test.ts`, `tests/unit/mcp/remote-permissions-migration.test.ts`, `tests/unit/mcp/gate-scoping.test.ts`.

---

### Task 1: Fix the eleven landmine queries

Eleven queries use `source != 'local'` to mean "is a WP Engine install." That is correct only while `source` has exactly two values. The moment Plan B writes a third, external sites are silently counted as WP Engine — including in `AssistantService.ts:23`, which decides whether the assistant treats the user as a WPE customer at all. Nothing throws; the fleet picture is just wrong.

**Files:**
- Modify: `src/main/assistant/AssistantService.ts:23`
- Modify: `src/main/ipc-handlers.ts:465,1833`
- Modify: `src/main/mcp/modules/fleet/fleet-summary.ts:36,41`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-plugin.ts:75,95`
- Modify: `src/main/mcp/modules/fleet/find-sites-with-theme.ts:80,98`
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-plugins.ts:88,94`
- Create: `tests/unit/graph/source-semantics.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks; it is a precondition for Plan B

- [ ] **Step 1: Write the failing lint-shaped test**

Create `tests/unit/graph/source-semantics.test.ts`. This is deliberately a source scan rather than a behavioural test: the pattern is invisible to the type checker and produces wrong data rather than errors, so nothing else can catch its return.

```ts
/**
 * Guards a semantic invariant the type system cannot express.
 *
 * `source != 'local'` means "is a WP Engine install" ONLY while source has
 * exactly two values. Plan B adds a third ('external'), at which point every
 * such query silently reclassifies external sites as WP Engine. The failure is
 * invisible: no exception, just wrong fleet intelligence.
 *
 * Use `source = 'wpe'` when you mean WP Engine.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', '..', 'src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTsFiles(full, out);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('sites.source semantics', () => {
  it("no query uses source != 'local' as a synonym for WP Engine", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/source\s*!=\s*'local'/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/graph/source-semantics.test.ts
```

Expected: FAIL, listing exactly 11 offenders across 6 files. If the count is not 11, the tree has moved since planning — record the actual list in your report and fix all of them.

- [ ] **Step 3: Fix all eleven**

Replace `source != 'local'` with `source = 'wpe'` in each location, preserving surrounding SQL exactly. The table alias varies — some are bare `source`, some `s.source`:

```
AssistantService.ts:23        source != 'local'   → source = 'wpe'
ipc-handlers.ts:465           source != 'local'   → source = 'wpe'
ipc-handlers.ts:1833          source != 'local'   → source = 'wpe'
fleet-summary.ts:36           source != 'local'   → source = 'wpe'
fleet-summary.ts:41           s.source != 'local' → s.source = 'wpe'
find-sites-with-plugin.ts:75  s.source != 'local' → s.source = 'wpe'
find-sites-with-plugin.ts:95  source != 'local'   → source = 'wpe'
find-sites-with-theme.ts:80   s.source != 'local' → s.source = 'wpe'
find-sites-with-theme.ts:98   source != 'local'   → source = 'wpe'
fleet-plugins.ts:88           source != 'local'   → source = 'wpe'
fleet-plugins.ts:94           s.source != 'local' → s.source = 'wpe'
```

This is behaviour-preserving today (`source` has only two values) and correct tomorrow.

- [ ] **Step 4: Run the test and the full suite**

```bash
npx jest tests/unit/graph/source-semantics.test.ts
npm test 2>&1 | tail -20
```

Expected: the lint test passes; the suite matches the 12/22 baseline.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit/graph/source-semantics.test.ts
git commit -m "fix(graph): use source = 'wpe' instead of source != 'local'

Eleven queries across six files treated 'not local' as 'is WP Engine'.
Correct only while source has two values; Plan B adds a third, at which
point external sites would silently count as WP Engine — including in
AssistantService, which decides whether the user is treated as a WPE
customer at all.

Adds a source-scanning test, because the pattern is invisible to the type
checker and yields wrong data rather than errors."
```

---

### Task 2: Harden the transport conformance suite

Two Spec 0 reviewers independently judged this suite too loose to be the gate the spec designates it. Today an implementation passes if `runWpCli` returns `{success:true, stdout:<anything>}` and `probe()` returns `{reachable:true}`. Failure paths, timeouts, and repeat calls are untested — exactly what a third transport most needs to prove.

**Files:**
- Modify: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: `SiteTransport` from `src/main/transport/types.ts`
- Produces: `runTransportConformance(name: string, fx: ConformanceFixtures)` where
  `interface ConformanceFixtures { ok: () => SiteTransport; failing: () => SiteTransport }`.
  **This is a breaking signature change** — the two existing call sites must be updated. Plan B's `ExternalSshTransport` will supply both fixtures.

- [ ] **Step 1: Replace the shared suite**

Replace the existing `runTransportConformance` with:

```ts
/**
 * The gate every SiteTransport implementation must pass.
 *
 * Callers supply TWO fixtures: one whose underlying call succeeds and one whose
 * underlying call fails. Requiring both is the point — the previous version
 * tested only the happy path, so a transport that threw on failure, or returned
 * an empty diagnostic, passed.
 */
export interface ConformanceFixtures {
  /** Transport whose underlying execution succeeds. */
  ok: () => SiteTransport;
  /** Transport whose underlying execution fails (non-zero exit or spawn error). */
  failing: () => SiteTransport;
}

const ALL_CAPABILITIES = [
  'wp-cli', 'arbitrary-options', 'db-query', 'eval',
  'search-replace', 'core-update', 'theme-activate',
] as const;

export function runTransportConformance(name: string, fx: ConformanceFixtures) {
  describe(`SiteTransport conformance — ${name}`, () => {
    it('exposes a non-empty kind and a siteRef with a kind discriminant', () => {
      const t = fx.ok();
      expect(typeof t.kind).toBe('string');
      expect(t.kind.length).toBeGreaterThan(0);
      expect(t.siteRef).toBeDefined();
      expect(typeof t.siteRef.kind).toBe('string');
    });

    it('supports() returns a boolean for every seeded capability', () => {
      const t = fx.ok();
      for (const cap of ALL_CAPABILITIES) {
        expect(typeof t.supports(cap)).toBe('boolean');
      }
    });

    it('runWpCli succeeds on the happy path and returns a string-or-null stdout', async () => {
      const r = await fx.ok().runWpCli(['core', 'version']);
      expect(r.success).toBe(true);
      expect(r.stdout === null || typeof r.stdout === 'string').toBe(true);
    });

    it('runWpCli RESOLVES with success:false on failure — never rejects', async () => {
      const r = await fx.failing().runWpCli(['core', 'version']);
      expect(r.success).toBe(false);
    });

    it('runWpCli failure carries diagnostic output rather than an empty string', async () => {
      const r = await fx.failing().runWpCli(['core', 'version']);
      expect(String(r.stdout ?? '')).not.toBe('');
    });

    it('runWpCli accepts RunOpts without throwing', async () => {
      await expect(
        fx.ok().runWpCli(['core', 'version'], { skipPlugins: false, timeoutMs: 5000 }),
      ).resolves.toHaveProperty('success');
    });

    it('runWpCli survives two sequential calls', async () => {
      const t = fx.ok();
      const a = await t.runWpCli(['core', 'version']);
      const b = await t.runWpCli(['plugin', 'list']);
      expect(a.success).toBe(true);
      expect(b.success).toBe(true);
    });

    it('deleteRemoteFile resolves with {success, output} on both paths', async () => {
      const okRes = await fx.ok().deleteRemoteFile('/tmp/nexus-conformance-probe');
      expect(typeof okRes.success).toBe('boolean');
      expect(typeof okRes.output).toBe('string');

      const failRes = await fx.failing().deleteRemoteFile('/tmp/nexus-conformance-probe');
      expect(typeof failRes.success).toBe('boolean');
      expect(typeof failRes.output).toBe('string');
    });

    it('probe() reports reachable=true on the happy path', async () => {
      const p = await fx.ok().probe();
      expect(p.reachable).toBe(true);
    });

    it('probe() reports reachable=false when unreachable, and never rejects', async () => {
      const p = await fx.failing().probe();
      expect(p.reachable).toBe(false);
    });
  });
}
```

- [ ] **Step 2: Update the two existing call sites**

Both `WpeSshTransport` and `LocalTransport` now need a failing fixture.

For `WpeSshTransport`, the existing `spawnMock`/`fakeProc` helpers already support failure — supply a proc that closes non-zero with stderr:

```ts
runTransportConformance('WpeSshTransport', {
  ok: () => {
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
    return new WpeSshTransport('acmeprod');
  },
  failing: () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'boom-out', stderr: 'boom-err' }));
    return new WpeSshTransport('acmeprod');
  },
});
```

For `LocalTransport`, vary the mocked bridge:

```ts
runTransportConformance('LocalTransport', {
  ok: () => new LocalTransport('site-1', 'Test Site', {
    wpCliRun: jest.fn(async () => ({ stdout: 'WordPress 6.8', success: true })),
  } as any),
  failing: () => new LocalTransport('site-1', 'Test Site', {
    wpCliRun: jest.fn(async () => ({ stdout: 'wp-cli not found', success: false })),
  } as any),
});
```

- [ ] **Step 3: Run and expect some failures — this is the point**

```bash
npx jest tests/unit/transport/conformance.test.ts -v
```

`LocalTransport.deleteRemoteFile` returns `{ success:false, output:'…not supported…' }` on both fixtures, which satisfies the shape assertions. The likely genuine failure is `probe()` on the failing fixture. **Do not weaken an assertion to make it pass.** If an implementation fails a contract test, either the contract is wrong (change it deliberately and say why in your report) or the implementation is (fix it). Record which you chose.

- [ ] **Step 4: Full suite**

```bash
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: 12/22 baseline. The Spec 0 characterization suites (`ssh-argv-characterization.test.ts`, `sentinel-executor.test.ts`) must pass **unmodified** — they are not part of this task.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/transport/conformance.test.ts
git commit -m "test(transport): harden conformance suite into a real gate

Requires an ok AND a failing fixture per implementation. Adds coverage for
failure resolution, non-empty diagnostics, RunOpts acceptance, sequential
calls, deleteRemoteFile shape, and probe on both paths.

Two Spec 0 reviewers independently found the previous version too loose:
a transport passed by returning {success:true, stdout:anything} and
{reachable:true}. Plan B's third transport lands on this gate."
```

---

### Task 3: Add `platform` and `host` columns

**Files:**
- Modify: `src/main/events/GraphService.ts` (migration block near `:185-205`)
- Create: `tests/unit/graph/taxonomy-migration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `sites.platform TEXT DEFAULT 'wordpress'` and `sites.host TEXT`, both backfilled. Plan B writes `host='external'`.

**Note:** `environment` already exists and is populated for WPE installs by `upsertSite` (`GraphService.ts:339`). Do not add it. This task backfills it only for local sites, where it is null.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/graph/taxonomy-migration.test.ts`:

```ts
import Database from 'better-sqlite3';
import { applyTaxonomyMigration } from '../../../src/main/events/GraphService';

function makeLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL,
      wp_version TEXT, last_sync_at INTEGER, is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      source TEXT DEFAULT 'local', environment TEXT
    );
  `);
  const ins = db.prepare(
    `INSERT INTO sites (id,name,domain,created_at,updated_at,source,environment)
     VALUES (?,?,?,0,0,?,?)`,
  );
  ins.run('l1', 'Local One', 'l1.local', 'local', null);
  ins.run('w1', 'wpeprod', 'wpeprod.com', 'wpe', 'production');
  ins.run('w2', 'wpestage', 'wpestage.com', 'wpe', null);
  return db;
}

describe('taxonomy migration', () => {
  it('adds platform and host, and is idempotent', () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    applyTaxonomyMigration(db as any); // must not throw on a second run
    const cols = (db.prepare('PRAGMA table_info(sites)').all() as any[]).map(c => c.name);
    expect(cols).toContain('platform');
    expect(cols).toContain('host');
  });

  it("backfills platform='wordpress' for every row", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const rows = db.prepare('SELECT platform FROM sites').all() as any[];
    expect(rows.every(r => r.platform === 'wordpress')).toBe(true);
  });

  it('backfills host from source', () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const get = (id: string) => (db.prepare('SELECT host FROM sites WHERE id=?').get(id) as any).host;
    expect(get('l1')).toBe('local');
    expect(get('w1')).toBe('wpe');
  });

  it("gives local sites environment='development' and leaves WPE environments untouched", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const get = (id: string) => (db.prepare('SELECT environment FROM sites WHERE id=?').get(id) as any).environment;
    expect(get('l1')).toBe('development');
    expect(get('w1')).toBe('production');
  });

  it("defaults a WPE row with no environment to 'production', the safe value", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const env = (db.prepare("SELECT environment FROM sites WHERE id='w2'").get() as any).environment;
    expect(env).toBe('production');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/graph/taxonomy-migration.test.ts
```

Expected: FAIL — `applyTaxonomyMigration` is not exported.

- [ ] **Step 3: Implement and export the migration**

Add to `src/main/events/GraphService.ts`, as a module-level exported function so it is testable without constructing the service:

```ts
/**
 * Adds the taxonomy columns. Idempotent: safe to call on every startup.
 *
 * `environment` is NOT added here — it already exists and is populated for WPE
 * installs by upsertSite. This only backfills it where null.
 *
 * A WPE row with no environment becomes 'production' deliberately: that is the
 * value normaliseEnv already assigns to unknown environments, and it is the
 * most restrictive, so a mislabelled row fails closed. A later WPE sync
 * corrects it.
 */
export function applyTaxonomyMigration(db: import('better-sqlite3').Database): void {
  const cols = (db.prepare('PRAGMA table_info(sites)').all() as Array<{ name: string }>)
    .map(c => c.name);

  if (!cols.includes('platform')) {
    db.exec("ALTER TABLE sites ADD COLUMN platform TEXT DEFAULT 'wordpress'");
  }
  if (!cols.includes('host')) {
    db.exec('ALTER TABLE sites ADD COLUMN host TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sites_host ON sites(host)');
  }

  db.exec("UPDATE sites SET platform = 'wordpress' WHERE platform IS NULL");
  db.exec('UPDATE sites SET host = source WHERE host IS NULL');
  db.exec("UPDATE sites SET environment = 'development' WHERE environment IS NULL AND host = 'local'");
  db.exec("UPDATE sites SET environment = 'production'  WHERE environment IS NULL AND host = 'wpe'");
}
```

Then call it from the existing migration path, immediately after the `source`-column block around `GraphService.ts:205`:

```ts
applyTaxonomyMigration(this.db!);
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/graph/taxonomy-migration.test.ts -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: new tests pass; suite at 12/22 baseline.

- [ ] **Step 5: Commit**

```bash
git add src/main/events/GraphService.ts tests/unit/graph/taxonomy-migration.test.ts
git commit -m "feat(graph): add platform and host columns with backfill

platform is stored but only ever 'wordpress' in this phase. host is
backfilled from source and is the axis-2 key deciding which platform
tools apply. environment already existed; this only backfills it where
null — 'development' for local, 'production' for WPE (fails closed,
corrected by the next sync).

Migration is idempotent and unit-tested against a legacy schema."
```

---

### Task 4: Rename permission settings to remote-scoped

External hosts need the same per-environment control as WPE installs, but the settings are WPE-named and their exceptions key on `installName`, which an external host does not have.

**Files:**
- Modify: `src/common/types.ts:275-315`
- Modify: `src/common/schemas.ts:61-71`
- Modify: `src/main/mcp/utils/operation-permissions.ts`
- Create: `tests/unit/mcp/remote-permissions-migration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface RemoteOperationPermissions` (same shape as `WpeOperationPermissions`)
  - `interface RemoteSiteException { targetRef: string; environment: string; overrides: {...} }` where `targetRef` is `wpe:<installName>` or `ssh:<alias>`
  - `NexusSettings.remoteOperationPermissions`, `NexusSettings.remoteSiteExceptions`
  - `migrateWpePermissionSettings(settings): { remoteOperationPermissions?, remoteSiteExceptions? }`
  - `isOperationAllowed(operation, environment, settings, targetRef?)` — final parameter renamed from `installName`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/remote-permissions-migration.test.ts`:

```ts
import {
  migrateWpePermissionSettings,
  isOperationAllowed,
} from '../../../src/main/mcp/utils/operation-permissions';

describe('migrateWpePermissionSettings', () => {
  it('carries operation permissions across unchanged', () => {
    const out = migrateWpePermissionSettings({
      wpeOperationPermissions: { wpcli: { development: false, staging: true, production: false } },
    } as any);
    expect(out.remoteOperationPermissions).toEqual({
      wpcli: { development: false, staging: true, production: false },
    });
  });

  it('rewrites installName exceptions to wpe: target refs', () => {
    const out = migrateWpePermissionSettings({
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    } as any);
    expect(out.remoteSiteExceptions).toEqual([
      { targetRef: 'wpe:mystore', environment: 'production', overrides: { wpcli: true } },
    ]);
  });

  it('returns nothing when already migrated — must not clobber new settings', () => {
    const out = migrateWpePermissionSettings({
      remoteOperationPermissions: { wpcli: { development: true, staging: true, production: true } },
      wpeOperationPermissions: { wpcli: { development: false, staging: false, production: false } },
    } as any);
    expect(out.remoteOperationPermissions).toBeUndefined();
  });

  it('returns nothing when there is nothing to migrate', () => {
    expect(migrateWpePermissionSettings({} as any)).toEqual({});
  });
});

describe('isOperationAllowed with target refs', () => {
  const settings = {
    remoteOperationPermissions: { wpcli: { development: true, staging: true, production: false } },
    remoteSiteExceptions: [
      { targetRef: 'ssh:acme-prod', environment: 'production', overrides: { wpcli: true } },
    ],
  } as any;

  it('applies the per-environment default', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'wpe:other')).toBe(false);
  });

  it('lets an ssh: exception override for an external host', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'ssh:acme-prod')).toBe(true);
  });

  it('does not apply an exception to a different target', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'ssh:other-host')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/mcp/remote-permissions-migration.test.ts
```

Expected: FAIL — `migrateWpePermissionSettings` is not exported.

- [ ] **Step 3: Rename the types**

In `src/common/types.ts`, rename `WpeOperationPermissions` → `RemoteOperationPermissions` and `WpeSiteException` → `RemoteSiteException`, changing that interface's `installName: string` field to `targetRef: string` with the comment: `// 'wpe:<installName>' or 'ssh:<alias>'`.

Keep deprecated aliases so nothing breaks mid-migration:

```ts
/** @deprecated Renamed to RemoteOperationPermissions. */
export type WpeOperationPermissions = RemoteOperationPermissions;
/** @deprecated Renamed to RemoteSiteException; installName is now targetRef. */
export type WpeSiteException = RemoteSiteException;
```

On `NexusSettings`, add `remoteOperationPermissions?` and `remoteSiteExceptions?` and mark the two old fields `@deprecated` — **do not delete them**, or `migrateWpePermissionSettings` cannot read an existing user's config.

- [ ] **Step 4: Update the Zod schema — this is the step that silently breaks**

In `src/common/schemas.ts`, add the new fields alongside the old ones (lines 61-62). `UpdateSettingsSchema` is `.strict()` at line 71, so any field not listed is **silently stripped** and the setting never persists, while the UI appears to work:

```ts
  wpeOperationPermissions: WpeOperationPermissionsSchema,
  wpeSiteExceptions: z.array(WpeSiteExceptionSchema).nullable().optional(),
  remoteOperationPermissions: WpeOperationPermissionsSchema,
  remoteSiteExceptions: z.array(RemoteSiteExceptionSchema).nullable().optional(),
```

Add `RemoteSiteExceptionSchema` mirroring `WpeSiteExceptionSchema` with `targetRef: z.string()` in place of `installName`.

- [ ] **Step 5: Implement the migration and update the gate**

In `src/main/mcp/utils/operation-permissions.ts`:

```ts
/**
 * Migrates WPE-named permission settings to remote-scoped ones.
 *
 * Modelled on migrateFromLegacyEnvFilter: returns undefined for a key when
 * there is nothing to migrate, and never overwrites already-migrated settings.
 * Exceptions gain a target ref so they can address an ssh: host as well as a
 * WPE install.
 */
export function migrateWpePermissionSettings(
  settings: Pick<NexusSettings,
    'wpeOperationPermissions' | 'wpeSiteExceptions' |
    'remoteOperationPermissions' | 'remoteSiteExceptions'>,
): { remoteOperationPermissions?: RemoteOperationPermissions; remoteSiteExceptions?: RemoteSiteException[] } {
  const out: {
    remoteOperationPermissions?: RemoteOperationPermissions;
    remoteSiteExceptions?: RemoteSiteException[];
  } = {};

  if (!settings.remoteOperationPermissions && settings.wpeOperationPermissions) {
    out.remoteOperationPermissions = settings.wpeOperationPermissions;
  }

  if (!settings.remoteSiteExceptions && settings.wpeSiteExceptions?.length) {
    out.remoteSiteExceptions = settings.wpeSiteExceptions.map((e: any) => ({
      targetRef: e.targetRef ?? `wpe:${e.installName}`,
      environment: e.environment,
      overrides: e.overrides,
    }));
  }

  return out;
}
```

Then update `isOperationAllowed` to read the new fields, falling back to the old ones, and rename its fourth parameter `installName` → `targetRef`:

```ts
export function isOperationAllowed(
  operation: 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete',
  environment: string | undefined,
  settings: Pick<NexusSettings,
    'remoteOperationPermissions' | 'remoteSiteExceptions' |
    'wpeOperationPermissions' | 'wpeSiteExceptions'>,
  targetRef?: string,
): boolean {
  const env = normaliseEnv(environment);
  const exceptions = settings.remoteSiteExceptions
    ?? (settings.wpeSiteExceptions as any as RemoteSiteException[] | undefined);
  const perms = settings.remoteOperationPermissions ?? settings.wpeOperationPermissions;

  if (targetRef && exceptions?.length) {
    const exc = exceptions.find(
      (e: any) => (e.targetRef ?? `wpe:${e.installName}`) === targetRef && e.environment === env,
    );
    if (exc && operation in exc.overrides) {
      const override = (exc.overrides as any)[operation];
      return override !== undefined ? override : DEFAULT_OPERATION_PERMISSIONS[operation][env];
    }
  }

  const perOp = perms?.[operation];
  if (perOp && env in perOp) {
    const val = (perOp as any)[env];
    return val !== undefined ? val : DEFAULT_OPERATION_PERMISSIONS[operation][env];
  }

  return DEFAULT_OPERATION_PERMISSIONS[operation][env];
}
```

- [ ] **Step 6: Update the ~19 existing call sites**

Existing callers pass a bare install name as the fourth argument, which no longer matches a migrated `wpe:`-prefixed exception. Find them:

```bash
grep -rn "isOperationAllowed(" src/ | grep -v "utils/operation-permissions.ts"
```

For each, wrap the install name: `isOperationAllowed(op, env, settings, installName)` → `isOperationAllowed(op, env, settings, \`wpe:${installName}\`)`.

Then extend `getEffectiveSettings` so every caller receives migrated settings without changing. Replace it with:

```ts
export function getEffectiveSettings(
  registryStorage: { get(key: string): unknown } | null | undefined,
): Pick<NexusSettings,
  'wpeOperationPermissions' | 'wpeSiteExceptions' |
  'remoteOperationPermissions' | 'remoteSiteExceptions'> {
  const raw = (registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;

  // Legacy env-filter migration runs first: it produces the WPE-shaped
  // permissions that the remote-scoped migration below then carries forward.
  const legacyMigrated = migrateFromLegacyEnvFilter(raw);
  const withLegacy = legacyMigrated
    ? { ...raw, wpeOperationPermissions: legacyMigrated }
    : raw;

  const remote = migrateWpePermissionSettings(withLegacy);
  return { ...withLegacy, ...remote };
}
```

Order matters: `migrateFromLegacyEnvFilter` writes `wpeOperationPermissions`, and
`migrateWpePermissionSettings` reads it. Running them the other way round would
silently drop the settings of a user who is still on the oldest format.

- [ ] **Step 7: Verify**

```bash
npx jest tests/unit/mcp/remote-permissions-migration.test.ts tests/unit/mcp/operation-permissions.test.ts -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

Expected: new tests pass; `operation-permissions.test.ts` passes **unmodified** (it is pre-existing and asserts real behaviour — if it fails, the migration changed semantics and that must be reported, not patched); suite at 12/22 baseline.

- [ ] **Step 8: Commit**

```bash
git add src tests/unit/mcp/remote-permissions-migration.test.ts
git commit -m "feat(permissions): rename WPE permission settings to remote-scoped

wpeOperationPermissions -> remoteOperationPermissions; wpeSiteExceptions ->
remoteSiteExceptions, keyed on a target ref ('wpe:<install>' or
'ssh:<alias>') so an external host can be addressed. Old fields retained
and deprecated so existing configs migrate rather than reset.

Both new fields added to UpdateSettingsSchema — it is .strict() and
silently strips unlisted fields, so omitting them would make the setting
appear to save and never persist."
```

---

### Task 5: Make the local-exemption guarantee explicit

The motivating requirement is: lock down writes on WP Engine development installs **without** losing the ability to work on a local site. The environment label does not deliver that — a local site labelled `'development'` is blocked by `wpcli: { development: false }` just as surely as an inherited one. Only host scoping does.

Today local sites happen never to reach the gate. This task turns that accident into a guarantee with a test.

**Files:**
- Modify: `src/main/mcp/utils/operation-permissions.ts`
- Create: `tests/unit/mcp/gate-scoping.test.ts`

**Interfaces:**
- Consumes: Task 4's `isOperationAllowed`
- Produces: `isGatedHost(host: string | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/gate-scoping.test.ts`:

```ts
import { isGatedHost } from '../../../src/main/mcp/utils/operation-permissions';

describe('isGatedHost', () => {
  it('gates remote hosts', () => {
    expect(isGatedHost('wpe')).toBe(true);
    expect(isGatedHost('external')).toBe(true);
  });

  it('never gates local', () => {
    expect(isGatedHost('local')).toBe(false);
  });

  it('gates an unknown host — fails closed', () => {
    expect(isGatedHost('something-new')).toBe(true);
    expect(isGatedHost(undefined)).toBe(true);
  });
});

describe('local sites are never subject to remote permission settings', () => {
  it('a permissive-to-nobody config still cannot block a local site', () => {
    // The user has locked down every environment, including development.
    const lockedDown = {
      remoteOperationPermissions: {
        wpcli: { development: false, staging: false, production: false },
      },
    } as any;

    // A local site must not consult these settings at all.
    expect(isGatedHost('local')).toBe(false);

    // Guard the reasoning too: were a local site ever routed through the gate
    // with environment='development', this is what would happen to it.
    const { isOperationAllowed } = require('../../../src/main/mcp/utils/operation-permissions');
    expect(isOperationAllowed('wpcli', 'development', lockedDown, 'local:site-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/mcp/gate-scoping.test.ts
```

Expected: FAIL — `isGatedHost` is not exported.

- [ ] **Step 3: Implement**

Add to `src/main/mcp/utils/operation-permissions.ts`:

```ts
/**
 * Whether the remote permission gate applies to a site with this host.
 *
 * Local sites are exempt by design. The gate exists to bound blast radius on
 * machines the user does not control; a Local site has Local's own UI
 * confirmations. This is the guarantee that makes "block writes on WPE
 * development installs" safe to configure: it cannot leak into local work.
 *
 * Unknown hosts are gated — fail closed.
 */
export function isGatedHost(host: string | undefined): boolean {
  return host !== 'local';
}
```

- [ ] **Step 4: Document the guarantee where it can be seen**

Add to the doc comment on `isOperationAllowed`:

```
 * SCOPING: only call this for sites where isGatedHost(host) is true. Local
 * sites are exempt by design — see isGatedHost. Routing a local site through
 * this function would let a user's WPE lockdown block their own local work,
 * which is the exact failure this split prevents.
```

- [ ] **Step 5: Verify**

```bash
npx jest tests/unit/mcp/ -v
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/utils/operation-permissions.ts tests/unit/mcp/gate-scoping.test.ts
git commit -m "feat(permissions): make the local-exemption guarantee explicit

isGatedHost(host) — the gate applies to remote hosts and never to local.
Unknown hosts fail closed.

Local sites already happened not to reach the gate; this makes it a
stated, tested guarantee. It is what lets a user block writes on WPE
development installs without blocking their own local work — the
environment label cannot deliver that, since a local site labelled
'development' is caught by the same rule."
```

---

## Self-Review

**Spec coverage.** §2 landmines → Task 1. §3 columns and backfill → Task 3 (`environment` already existed; verified at `GraphService.ts:339`). §3 local-always-development → Task 3 backfill. §4 scoping guarantee → Task 5. §4 settings rename → Task 4. §8 conformance hardening → Task 2.

**Deferred to Plan B**, matching the spec's scope: `ExternalSshTransport` and its golden-argv test (§5), registration and phar upload (§6), `EXTERNAL_REMOTE_POLICY` (§7), `ssh:alias@environment` parsing, the CLI command, fleet integration, and the extension of the table-driven dispatch test to an external target.

**Placeholder scan:** none. Every step carries the code or the exact command.

**Type consistency.** `RemoteOperationPermissions` and `RemoteSiteException` are defined in Task 4 and used only there and in Task 5. `isGatedHost` is defined in Task 5. `applyTaxonomyMigration` is defined in Task 3. `ConformanceFixtures` is defined in Task 2 and consumed by Plan B. `isOperationAllowed`'s fourth parameter is `targetRef` consistently after Task 4.

**Two risks worth flagging at execution time.** Task 4 Step 6 touches roughly nineteen call sites and is the largest single change here — Spec 0 showed that a task's real size is often several times its estimate, so if it runs long, split it by directory rather than pressing on. And Task 2 Step 3 deliberately expects failures: an implementation that cannot pass a contract test is the finding, and weakening the assertion to get green would defeat the entire task.
