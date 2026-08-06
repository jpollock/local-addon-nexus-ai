# External Host Connection/Site Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ssh:<alias>` moves from meaning "one site" to meaning "one connection that can have 0..N sites" — `ssh:<alias>/<site>@<environment>`, mirroring `wpe:<account>/<install>@<environment>` — so a real multi-tenant SSH login (confirmed live: `hostinger-test` has two WordPress installs) can register every site it hosts instead of exactly one.

**Architecture:** No new tables — WP Engine's existing generic `account_id` column on `sites` is reused to link a site row back to its connection alias. A new shared query helper (`findExternalSites`) becomes the single place that resolves "alias + optional site" to graph rows, replacing five call sites' worth of ad-hoc, alias-as-site-id logic with one correct implementation. The permission gate in `resolveTransport` is reordered so the environment comparison runs against the resolved *site*, not the connection, preserving a security property this codebase has already had to fix once.

**Tech Stack:** TypeScript, better-sqlite3 (graph DB), GraphQL (Apollo-style schema/resolvers), Jest, commander (CLI).

## Global Constraints

- **Nothing is ever written to the user's remote server.** Every change in this plan is either a local data-model change or a read-only SSH command (`find`, `wp` reads). No new write-to-remote-host code anywhere.
- **No SSH key material is stored.** The `~/.ssh/config` alias remains the only credential path.
- **`src/main/transport/ssh-args.ts` is the only place an SSH invocation or remote command is constructed.** Nothing in this plan needs to touch it except Task 1's `find` flag.
- **`resolveTransport` (`src/main/transport/resolve.ts`) is the only router.** No target resolution or command policy logic is duplicated elsewhere; new resolution logic goes into the shared `findExternalSites` helper, not copy-pasted per call site.
- **Read-only paths are not audited.** None of `findExternalSites`, `queryQualifiedTarget`, `nexusSitesGet`, `nexusFleetSiteHealth`, or the schedulers' selection queries mutate a remote resource — do not add `auditDirectOperation` calls to them. `nexusHostAdd`/`nexusHostRemove`/`nexusHostRemoveSite` are local-mutation-only (graph + registryStorage), matching the existing `nexusHostRefresh`/`nexusHostIndex` precedent of not being audited (CLAUDE.md: "nothing here can mutate the remote host").
- **No migration code.** The one host currently registered (`hostinger-test`) is re-registered from scratch under the new flow once this plan ships. No task converts old-shape rows.
- **The target shorthand (`ssh:<alias>@<environment>`) is accepted as input when unambiguous, and is never printed by any surface that emits a target string.** Every place that prints a target — `nexus_list_sites`, `sites list`, `host list`, error messages — prints the full `/<site>` form.
- `better-sqlite3` is built for the system-Node ABI, so `npx jest` works. Do **not** run `npm run rebuild` until the final task's live check.
- **Baseline, verified today: 12 failing suites (same names throughout: `tests/main/chat-providers.test.ts`, `tests/main/embedding-service.test.ts`, `tests/main/error-recovery.test.ts`, `tests/main/mcp-tools.test.ts`, `tests/unit/agents/log-processor/agent.test.ts`, `tests/unit/agents/log-processor/db.test.ts`, `tests/unit/ai-gateway/routing.test.ts`, `tests/unit/cli/agent-commands.test.ts`, `tests/unit/common/iw-types.test.ts`, `tests/unit/content/site-readiness.test.ts`, `tests/unit/credentials/ProviderRegistry.test.ts`, `tests/unit/mcp/wpe-deep-refresh.test.ts`), 3782 passing.** Compare failing suite **names**, not counts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/external/probeExternalHost.ts` *(modify)* | Task 1 only: add `-L` to the discovery `find`. |
| `src/common/target.ts` *(modify)* | `ssh:` regex gains optional `/<site>` segment. |
| `src/main/mcp/site-resolver.ts` *(modify)* | New `findExternalSites()` helper; `queryQualifiedTarget`'s external branch rewired to use it. |
| `src/main/external/externalSiteStore.ts` *(modify)* | `ExternalSiteProfile` → connection-only fields; `externalSiteId(alias, site)`. |
| `src/main/transport/resolve.ts` *(modify)* | `resolveTransport`'s external branch — the security-critical rework. |
| `src/main/mcp/tool-registry.ts` *(modify)* | `maybeUpsertExternalSite` — sighting refreshes, never creates. |
| `src/main/graphql/schema.ts` *(modify)* | `NexusHostAddResult`/`nexusHostAdd` gains `site`; new `nexusHostRemoveSite`; `NexusHostRefreshResult`/`NexusHostIndexResult` become per-site lists; `NexusHostEntry` nests sites. |
| `src/main/graphql/resolvers.ts` *(modify)* | `nexusHostAdd`, `nexusHostRemove`, new `nexusHostRemoveSite`, `nexusHostRefresh`, `nexusHostIndex`, `nexusHostList`, `nexusSitesGet`'s external branch, `nexusFleetSiteHealth`'s health lookup. |
| `src/main/graphql/resolvers/sites.ts` *(modify)* | Dormant mirror of `nexusSitesGet`'s external branch — resynced per the established `resolvers/wpe.ts` policy (CLAUDE.md). |
| `src/cli/commands/host.ts` *(modify)* | `add` gains the interactive multi-site picker; new `remove-site` command; `list`/`refresh`/`index` output restructured for connection→sites. |
| `src/main/startup/ExternalRefreshScheduler.ts`, `ExternalContentIndexScheduler.ts` *(modify)* | Target reconstruction fixed to use `account_id`/`name`, not `name` alone. |

---

### Task 1: Fix the discovery `find` to follow a symlinked `$HOME`

**Files:**
- Modify: `src/main/external/probeExternalHost.ts:189`
- Test: `tests/unit/external/probeExternalHost.test.ts` (extend if it exists; check with `find tests -iname "*probeExternalHost*"` and create alongside the existing suite's conventions if none is found)

**Interfaces:** none new — this is a one-flag change to an existing shell command string.

Diagnosed live against a real SiteGround connection: `$HOME` there is a symlink
(`/home/u2640-gkgnd9yg00xk -> customer`), and `find "$HOME" ...` finds nothing because `find`
does not follow a symlink given as its starting argument unless told to. `find -L "$HOME" ...`
finds it immediately, three levels below the symlinked home — well inside the existing
`SEARCH_MAXDEPTH = 4`. The fix is one flag; the root list and depth are already correct.

- [ ] **Step 1: Write the failing test**

Find how the existing probe tests mock the SSH `run()` function (grep for `jest.mock` or a
constructor-injected runner in the existing probe test file) and add a case in that same style:

```ts
it('finds wp-config.php through a symlinked $HOME (find -L)', async () => {
  const commands: string[] = [];
  const run = jest.fn(async (cmd: string) => {
    commands.push(cmd);
    if (cmd.includes('find')) {
      // Only the -L invocation would return this on a real symlinked-home host.
      if (cmd.includes('-L')) {
        return { stdout: '/home/u2640/www/example.com/public_html/wp-config.php', code: 0 };
      }
      return { stdout: '', code: 0 };
    }
    return { stdout: '', code: 0 };
  });

  // Call probeExternalHost with `run` injected exactly as the existing test suite does.
  const report = await probeExternalHost('siteground-alias', {}, { run });

  expect(commands.some((c) => c.includes('find -L'))).toBe(true);
  expect(report.ok).toBe(true);
  expect(report.wpPath).toBe('/home/u2640/www/example.com/public_html');
});

it('still finds every root it found before on a non-symlinked host (additive, not narrower)', async () => {
  const run = jest.fn(async (cmd: string) => {
    if (cmd.includes('find')) {
      return { stdout: '/home/u923/domains/site.com/public_html/wp-config.php', code: 0 };
    }
    return { stdout: '', code: 0 };
  });

  const report = await probeExternalHost('hostinger-alias', {}, { run });
  expect(report.ok).toBe(true);
  expect(report.wpPath).toBe('/home/u923/domains/site.com/public_html');
});
```

Adjust the exact call signature/mock shape to match whatever the existing `probeExternalHost`
tests actually use — read the current test file in full before writing this, since the function
may take its shell-runner as a constructor argument, a module-level mock, or a parameter, and
guessing the wrong shape wastes the whole step.

- [ ] **Step 2: Run and verify the first test fails**

Run: `npx jest tests/unit/external/probeExternalHost.test.ts -t "symlinked"`
Expected: FAIL — the command built without `-L` finds nothing.

- [ ] **Step 3: Implement**

In `src/main/external/probeExternalHost.ts`, change:

```ts
    const find =
      `find ${SEARCH_ROOTS.join(' ')} -maxdepth ${SEARCH_MAXDEPTH} -name wp-config.php -type f 2>/dev/null | head -20`;
```

to:

```ts
    // -L: follow symlinks, including a symlinked $HOME itself (confirmed live
    // on a real SiteGround connection, whose home directory is a symlink).
    // Without it `find` treats the symlink as an unreadable leaf and finds
    // nothing, even though the real WordPress root is a few levels through it.
    const find =
      `find -L ${SEARCH_ROOTS.join(' ')} -maxdepth ${SEARCH_MAXDEPTH} -name wp-config.php -type f 2>/dev/null | head -20`;
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/external/probeExternalHost.test.ts -v`
Expected: PASS, both new tests and every pre-existing one in the file.

- [ ] **Step 5: Commit**

```bash
git add src/main/external/probeExternalHost.ts tests/unit/external/probeExternalHost.test.ts
git commit -m "fix(external): discovery follows a symlinked \$HOME"
```

---

### Task 2: Target parsing gains an optional site segment

**Files:**
- Modify: `src/common/target.ts:12-22,37-45`
- Test: `tests/unit/common/target.test.ts` (extend existing suite)

**Interfaces:**
- Produces: `ParsedTarget.site?: string` (new, optional field). `parseTarget()`'s external branch
  populates it when present, leaves it `undefined` for the bare shorthand.

- [ ] **Step 1: Write the failing tests**

```ts
describe('parseTarget — external site segment', () => {
  it('parses ssh:<alias>/<site>@<environment>', () => {
    const parsed = parseTarget('ssh:hostinger-test/mediumslateblue-hyena@production');
    expect(parsed).toEqual({
      type: 'external',
      original: 'ssh:hostinger-test/mediumslateblue-hyena@production',
      alias: 'hostinger-test',
      site: 'mediumslateblue-hyena',
      environment: 'production',
    });
  });

  it('parses the bare shorthand with site left undefined', () => {
    const parsed = parseTarget('ssh:hostinger-test@production');
    expect(parsed.alias).toBe('hostinger-test');
    expect(parsed.site).toBeUndefined();
    expect(parsed.environment).toBe('production');
  });

  it('still rejects ssh:x@local as an incomplete SSH target, not a local site named "ssh:x"', () => {
    expect(() => parseTarget('ssh:x@local')).toThrow(/Incomplete SSH target/);
  });

  it('still throws Incomplete SSH target for a bare alias with no environment', () => {
    expect(() => parseTarget('ssh:hostinger-test')).toThrow(/Incomplete SSH target/);
  });

  it('does not let a slash in the site segment swallow the environment', () => {
    const parsed = parseTarget('ssh:alias/site-name@staging');
    expect(parsed.site).toBe('site-name');
    expect(parsed.environment).toBe('staging');
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/common/target.test.ts -t "external site segment"`
Expected: FAIL — `parsed.site` is `undefined` on the type today (the field doesn't exist), and
the first test's `toEqual` fails because the alias capture currently swallows the whole
`hostinger-test/mediumslateblue-hyena` string (the existing regex's `(.+?)` is lazy but has no
`/` boundary to stop at).

- [ ] **Step 3: Implement**

In `src/common/target.ts`, add the field to the interface:

```ts
export interface ParsedTarget {
  type: 'local' | 'wpe' | 'external';
  original: string;
  siteName?: string;
  account?: string;
  installName?: string;
  alias?: string;
  /** For external SSH hosts: which site under the connection. Undefined ⇒ bare shorthand. */
  site?: string;
  environment?: TargetEnvironment;
}
```

Replace the `sshMatch` block:

```ts
  const sshMatch = target.match(/^ssh:(.+?)@(production|staging|development)$/);
  if (sshMatch) {
    return {
      type: 'external',
      original: target,
      alias: sshMatch[1],
      environment: sshMatch[2] as TargetEnvironment,
    };
  }
```

with:

```ts
  const sshMatch = target.match(/^ssh:([^/@]+)(?:\/([^@]+))?@(production|staging|development)$/);
  if (sshMatch) {
    return {
      type: 'external',
      original: target,
      alias: sshMatch[1],
      site: sshMatch[2],
      environment: sshMatch[3] as TargetEnvironment,
    };
  }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/common/target.test.ts -v`
Expected: PASS, all tests including every pre-existing one in the file (the WPE and local
branches are untouched, but re-run the whole file to be sure nothing else depended on the old
alias regex).

- [ ] **Step 5: Commit**

```bash
git add src/common/target.ts tests/unit/common/target.test.ts
git commit -m "feat(target): ssh: targets accept an optional /<site> segment"
```

---

### Task 3: `findExternalSites` — the shared query helper

**Files:**
- Modify: `src/main/mcp/site-resolver.ts` (add after `resolveRemoteGraphSite`, before
  `queryQualifiedTarget`)
- Test: `tests/unit/mcp/site-resolver.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new — takes a raw `db` handle exactly as `resolveRemoteGraphSite` does.
- Produces: `findExternalSites(db: any, alias: string, site?: string, columns?: string): any[]`
  — used by Task 4 (`queryQualifiedTarget`), Task 6 (`resolveTransport`), Task 8
  (`nexusHostAdd`'s duplicate-check), Task 9 (`nexusHostRemove`/`nexusHostRemoveSite`), Task 10
  (`nexusHostRefresh`/`nexusHostIndex`), Task 11 (`nexusSitesGet`), Task 12
  (`nexusFleetSiteHealth`).

**Why this is one function, not five copies.** Grepped every consumer that currently resolves an
external alias to a graph row: `queryQualifiedTarget` (5 downstream consumers of its own —
`resolveAnySite`, `get_all_site_documents`, `detect_drift`, `compare_sites`, `get_site_health`),
`resolveTransport`, `nexusSitesGet` (two copies), `nexusFleetSiteHealth`, `nexusHostRefresh`,
`nexusHostIndex`. Every one of them currently does its own ad-hoc `WHERE source='external' AND
... name = ?` query treating the alias as if it were the site's name. Fixing each independently
means seven chances to get the `account_id`/`name` split subtly wrong in seven different ways —
one shared, tested function removes that risk.

**Contract:** given `alias` and no `site`, returns every active site row under that connection
(0, 1, or many — the caller decides what that count means for its own error message). Given
`alias` and `site`, returns 0 or 1 row scoped to that specific site. Never throws; returns `[]`
on a missing/unavailable `db`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('findExternalSites', () => {
  function makeDb(rows: Array<{ id: string; name: string; account_id: string; is_active: number }>) {
    return {
      prepare: (sql: string) => ({
        all: (...params: any[]) => {
          if (sql.includes('AND name=?')) {
            const [alias, site] = params;
            return rows.filter((r) => r.account_id === alias && r.name === site && r.is_active === 1);
          }
          const [alias] = params;
          return rows.filter((r) => r.account_id === alias && r.is_active === 1);
        },
      }),
    };
  }

  it('returns every active site under a connection when no site is given', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:other/site-c', name: 'site-c', account_id: 'other', is_active: 1 },
    ]);
    const rows = findExternalSites(db, 'hostinger-test');
    expect(rows.map((r: any) => r.name).sort()).toEqual(['site-a', 'site-b']);
  });

  it('scopes to exactly one site when given', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', is_active: 1 },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', account_id: 'hostinger-test', is_active: 1 },
    ]);
    const rows = findExternalSites(db, 'hostinger-test', 'site-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('site-a');
  });

  it('returns empty for a connection with zero registered sites', () => {
    const db = makeDb([]);
    expect(findExternalSites(db, 'unregistered')).toEqual([]);
  });

  it('returns empty rather than throwing when db is unavailable', () => {
    expect(findExternalSites(undefined, 'hostinger-test')).toEqual([]);
    expect(findExternalSites(null, 'hostinger-test')).toEqual([]);
  });

  it('excludes a soft-deleted site (is_active=0)', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/gone', name: 'gone', account_id: 'hostinger-test', is_active: 0 },
    ]);
    expect(findExternalSites(db, 'hostinger-test')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/mcp/site-resolver.test.ts -t "findExternalSites"`
Expected: FAIL — `findExternalSites is not a function`.

- [ ] **Step 3: Implement**

Add to `src/main/mcp/site-resolver.ts`, after `resolveRemoteGraphSite` and before
`queryQualifiedTarget`:

```ts
/**
 * Find external sites registered under a connection alias, optionally scoped
 * to one specific site.
 *
 * The alias is a CONNECTION (a `~/.ssh/config` Host entry), not a site — one
 * connection can have zero, one, or many WordPress installs under it
 * (confirmed live: a single Hostinger login can host two). `account_id` links
 * a site row back to its connection, reusing the same generic column WP
 * Engine already uses for its own account→install grouping.
 *
 * Returns every matching site when `site` is omitted — the caller decides
 * what 0/1/many rows means for its own error message (see `resolveTransport`
 * for the canonical ok/none/ambiguous handling). `columns` is an internal
 * constant supplied by this module's own callers, not caller-controlled
 * input, matching the same convention as `queryQualifiedTarget`.
 */
export function findExternalSites(
  db: any,
  alias: string,
  site?: string,
  columns = '*',
): any[] {
  if (!db) return [];
  try {
    return (site
      ? db.prepare(
          `SELECT ${columns} FROM sites WHERE source='external' AND is_active=1 AND account_id=? AND name=?`,
        ).all(alias, site)
      : db.prepare(
          `SELECT ${columns} FROM sites WHERE source='external' AND is_active=1 AND account_id=?`,
        ).all(alias)
    ) as any[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/mcp/site-resolver.test.ts -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/site-resolver.ts tests/unit/mcp/site-resolver.test.ts
git commit -m "feat(mcp): findExternalSites — one shared alias+site resolver for the graph"
```

---

### Task 4: Rewire `queryQualifiedTarget` — fixes five consumers with one change

**Files:**
- Modify: `src/main/mcp/site-resolver.ts:97-136`
- Test: `tests/unit/mcp/site-resolver.test.ts` (extend)

**Interfaces:**
- Consumes: `findExternalSites` from Task 3.
- Produces: no signature change — `queryQualifiedTarget`'s existing `(db, target, columns) =>
  any[] | null` contract is preserved exactly. Every one of its five consumers
  (`resolveAnySite`, `src/main/mcp/modules/content/get-all-documents.ts`,
  `src/main/mcp/modules/fleet/detect-drift.ts`, `src/main/mcp/modules/fleet/compare-sites.ts`,
  `src/main/mcp/modules/fleet-intelligence/get-site-health.ts`) needs **zero changes** —
  confirmed by reading all five: each already branches on `qualified.length === 1 / > 1 / 0`
  (or, for `get-site-health.ts`, `qualified !== null` with a single-row check), which is exactly
  the right behavior once the row set itself is correct.

**Why this matters more than any other single task in this plan:** `resolveAnySite` alone feeds
three MCP tools; `get_site_health` is a fourth. Get this one function right and all of them are
right. Get it wrong and all of them are wrong identically, in a way each tool's own tests won't
catch because they mock `graphService`, not this function's internals — which is exactly why
Task 3's dedicated tests on the shared helper matter.

- [ ] **Step 1: Write the failing tests**

```ts
describe('queryQualifiedTarget — external site resolution', () => {
  function makeDb(rows: any[]) {
    return {
      prepare: (sql: string) => ({
        all: (...params: any[]) => {
          if (sql.includes('account_id=?') && sql.includes('name=?')) {
            const [alias, site] = params;
            return rows.filter((r) => r.source === 'external' && r.account_id === alias && r.name === site);
          }
          if (sql.includes('account_id=?')) {
            const [alias] = params;
            return rows.filter((r) => r.source === 'external' && r.account_id === alias);
          }
          return [];
        },
      }),
    };
  }

  it('resolves ssh:<alias>/<site>@<env> to exactly that site', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', source: 'external', account_id: 'hostinger-test' },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', source: 'external', account_id: 'hostinger-test' },
    ]);
    const rows = queryQualifiedTarget(db, 'ssh:hostinger-test/site-a@production');
    expect(rows).toHaveLength(1);
    expect(rows![0].name).toBe('site-a');
  });

  it('bare shorthand resolves when the connection has exactly one site', () => {
    const db = makeDb([
      { id: 'ssh:solo/only-site', name: 'only-site', source: 'external', account_id: 'solo' },
    ]);
    const rows = queryQualifiedTarget(db, 'ssh:solo@production');
    expect(rows).toHaveLength(1);
  });

  it('bare shorthand against a two-site connection returns both rows for the caller to disambiguate', () => {
    const db = makeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', source: 'external', account_id: 'hostinger-test' },
      { id: 'ssh:hostinger-test/site-b', name: 'site-b', source: 'external', account_id: 'hostinger-test' },
    ]);
    const rows = queryQualifiedTarget(db, 'ssh:hostinger-test@production');
    expect(rows).toHaveLength(2);
  });

  it('a connection with zero registered sites returns an empty array, not null', () => {
    const db = makeDb([]);
    const rows = queryQualifiedTarget(db, 'ssh:unregistered@production');
    expect(rows).toEqual([]);
  });

  it('still returns null for a bare name — not a qualified target at all', () => {
    const db = makeDb([]);
    expect(queryQualifiedTarget(db, 'mysite')).toBeNull();
  });

  it('WPE resolution is untouched by this change', () => {
    const db = {
      prepare: (sql: string) => ({
        all: () => (sql.includes("source = 'wpe'") ? [{ id: 'wpe-1', name: 'myinstall', source: 'wpe' }] : []),
      }),
    };
    const rows = queryQualifiedTarget(db, 'wpe:acct/myinstall@production');
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/mcp/site-resolver.test.ts -t "queryQualifiedTarget — external"`
Expected: FAIL — today's implementation queries `name = parsed.alias`, which never matches a
row whose `name` is a site slug, not the alias.

- [ ] **Step 3: Implement**

Replace the body of `queryQualifiedTarget` in `src/main/mcp/site-resolver.ts`:

```ts
export function queryQualifiedTarget(
  db: any,
  target: string,
  columns = 'id, name, source',
): any[] | null {
  let parsed;
  try {
    parsed = parseTarget(target);
  } catch {
    return null;
  }

  if (parsed.type === 'external') {
    if (!parsed.alias || !db) return [];
    // The alias is a connection, not a site — findExternalSites returns every
    // site under it when `site` is omitted, and the caller's existing
    // length===1/>1/0 branching already does the right thing with that.
    return findExternalSites(db, parsed.alias, parsed.site, columns);
  }

  let source: 'wpe';
  let name: string | undefined;
  if (parsed.type === 'wpe') {
    source = 'wpe';
    name = parsed.installName;
  } else {
    // type === 'local' — a bare name or `<name>@local`. Not our business.
    return null;
  }

  if (!name || !db) return [];

  try {
    return (db.prepare(
      `SELECT ${columns} FROM sites WHERE source = '${source}' AND is_active = 1 AND name = ?`,
    ).all(name) ?? []) as any[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/mcp/site-resolver.test.ts -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Confirm the five downstream consumers need no change**

Run the existing test suites for all five consumers to confirm nothing regressed:

```bash
npx jest tests/unit/mcp/compare-sites.test.ts tests/unit/mcp/detect-drift.test.ts \
  tests/unit/mcp/get-site-health.test.ts tests/unit/mcp/get-all-site-documents.test.ts \
  tests/unit/mcp/site-resolver.test.ts -v
```

Expected: PASS, unchanged from before this task (their fixtures use single-site aliases today,
so this is a no-regression check, not new coverage — Task 8 onward is where multi-site fixtures
get exercised end to end).

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/site-resolver.ts tests/unit/mcp/site-resolver.test.ts
git commit -m "fix(mcp): queryQualifiedTarget resolves external targets by connection+site"
```

---

### Task 5: Connection profile shrinks to connection-only fields

**Files:**
- Modify: `src/main/external/externalSiteStore.ts`
- Test: `tests/unit/external/externalSiteStore.test.ts` (extend existing suite)

**Interfaces:**
- Produces: `ExternalConnectionProfile` (renamed from `ExternalSiteProfile`, `wpPath` and
  `environment` removed). `externalSiteId(alias: string, site: string): string` (was
  `externalSiteId(alias: string)`) — now returns `ssh:${alias}/${site}`.
- Every other export (`getExternalProfile`, `listExternalProfiles`, `upsertExternalProfile`,
  `removeExternalProfile`, `ProfileWriteSource`) keeps its existing signature — they operate on
  the connection, which is unaffected by field removal except for the type they carry.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ExternalConnectionProfile — connection-only fields', () => {
  it('externalSiteId takes alias and site, joined by a slash', () => {
    expect(externalSiteId('hostinger-test', 'mediumslateblue-hyena'))
      .toBe('ssh:hostinger-test/mediumslateblue-hyena');
  });

  it('a stored connection profile has no wpPath or environment field', () => {
    const storage = makeMemoryStorage(); // reuse whatever in-memory Storage fake this test file already has
    const stored = upsertExternalProfile(storage, {
      alias: 'hostinger-test',
      wpCliPath: '/usr/bin/wp',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    } as any, 'registration');
    expect(stored).not.toHaveProperty('wpPath');
    expect(stored).not.toHaveProperty('environment');
  });
});
```

Use whatever in-memory `Storage` fake the existing test file already defines rather than
inventing a new one — read the file in full before writing this step.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/external/externalSiteStore.test.ts -t "connection-only"`
Expected: FAIL — `externalSiteId('hostinger-test', 'mediumslateblue-hyena')` today ignores the
second argument (the function only takes one) and returns `ssh:hostinger-test`.

- [ ] **Step 3: Implement**

In `src/main/external/externalSiteStore.ts`, replace the interface and `upsertExternalProfile`'s
merge logic:

```ts
export interface ExternalConnectionProfile {
  /** ~/.ssh/config Host alias. The credential path — no key material is stored. */
  alias: string;
  /**
   * Absolute path to WP-CLI, stored only when it is NOT on the remote's
   * non-interactive PATH. Shared by every site under this connection unless a
   * site overrides it. Undefined means plain `wp` works.
   */
  wpCliPath?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** Stable connection id. A site's own id (see externalSiteId) embeds this plus the site slug. */
export function externalSiteId(alias: string, site: string): string {
  return `ssh:${alias}/${site}`;
}
```

Update `upsertExternalProfile`'s merge (drop the `wpPath`/`environment` lines):

```ts
export function upsertExternalProfile(
  storage: Storage,
  profile: ExternalConnectionProfile,
  source: ProfileWriteSource = 'sighting',
): ExternalConnectionProfile {
  const all = readAll(storage);
  const existing = all[profile.alias];
  const merged: ExternalConnectionProfile = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
  };
  all[profile.alias] = merged;
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
  return merged;
}
```

Update `readAll`'s and `getExternalProfile`'s/`listExternalProfiles`'s type annotations from
`ExternalSiteProfile` to `ExternalConnectionProfile` (mechanical rename, no logic change).

Update the doc comment above `upsertExternalProfile` to remove the now-inapplicable paragraph
about `environment` being "the write gate" on this type — that property moves to the site level
in Task 6, and the comment should say so rather than describe behavior this file no longer has.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/external/ -v && npx tsc --noEmit`
Expected: **`tsc` will show type errors in every caller that still constructs an
`ExternalSiteProfile` with `wpPath`/`environment`, or calls `externalSiteId(alias)` with one
argument.** This is expected at this point in the plan — later tasks fix each caller. Confirm the
errors are confined to files this plan's later tasks touch (`tool-registry.ts`, `resolve.ts`,
`resolvers.ts`, `resolvers/sites.ts`) and not somewhere unexpected; if `tsc` names a file not in
this plan's file list, stop and report it rather than guessing a fix.

- [ ] **Step 5: Commit**

```bash
git add src/main/external/externalSiteStore.ts tests/unit/external/externalSiteStore.test.ts
git commit -m "refactor(external): connection profile drops site-scoped fields"
```

---

### Task 6: `resolveTransport` — the security-critical rework

**Files:**
- Modify: `src/main/transport/resolve.ts:23-77`
- Test: `tests/unit/transport/resolve.test.ts` (extend existing suite)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3), `parseTarget`'s new `.site` field (Task 2),
  `ExternalConnectionProfile` (Task 5).
- Produces: no external signature change — `resolveTransport(args, services, operation)` keeps
  its existing return type (`SiteTransport | McpToolResult`).

**Read `resolve.ts:23-77` in full before touching it — this is the piece most likely to
reintroduce a real security bug if rushed.** The existing code's own comment records a prior
fix: *"a host registered `--env production` stayed writable when addressed as
`ssh:<alias>@development`"* was a real bug, fixed by looking up the registered environment
**before** the permission gate runs, not after. That ordering must survive this change exactly —
only *what* gets looked up changes (a resolved site's environment, not the connection's).

- [ ] **Step 1: Write the failing tests**

```ts
describe('resolveTransport — external connection/site resolution', () => {
  // Build on whatever NexusServices fixture this test file already uses for
  // registryStorage + graphService; these examples assume helpers named
  // `makeServices({ profile, sites })` exist or are added following the file's
  // existing conventions.

  it('a site registered --env production is still gated as production via the bare shorthand with a @development suffix', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', is_active: 1 }],
    });
    const result = await resolveTransport({ ssh_target: 'ssh:hostinger-test@development' }, services, 'wpcli');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect((result.content[0] as any).text).toMatch(/blocked|not permitted/i);
    }
  });

  it('the same regression check via the full /<site> form', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', is_active: 1 }],
    });
    const result = await resolveTransport({ ssh_target: 'ssh:hostinger-test/site-a@development' }, services, 'wpcli');
    expect('content' in result).toBe(true);
  });

  it('a connection with zero registered sites refuses with guidance, and the gate never runs', async () => {
    const services = makeServices({ profile: { alias: 'empty-conn', firstSeenAt: 1, lastSeenAt: 1 }, sites: [] });
    const result = await resolveTransport({ ssh_target: 'ssh:empty-conn@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect((result.content[0] as any).text).toMatch(/no registered sites/i);
    }
  });

  it('two sites under one connection, bare shorthand, refuses with a disambiguation naming both', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [
        { id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', is_active: 1 },
        { id: 'ssh:hostinger-test/site-b', name: 'site-b', account_id: 'hostinger-test', environment: 'production', is_active: 1 },
      ],
    });
    const result = await resolveTransport({ ssh_target: 'ssh:hostinger-test@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      const text = (result.content[0] as any).text;
      expect(text).toContain('site-a');
      expect(text).toContain('site-b');
      expect(text).toContain('/');
    }
  });

  it('a /<site> naming a site that does not exist under the connection is not-found, distinct from zero-sites', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', is_active: 1 }],
    });
    const result = await resolveTransport({ ssh_target: 'ssh:hostinger-test/nope@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect((result.content[0] as any).text).toMatch(/no site "nope"/i);
    }
  });

  it('builds a transport with the resolved site\'s wpPath, and the connection\'s wpCliPath', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', wpCliPath: '/usr/bin/wp', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'staging', wp_path: '/home/u1/site-a', is_active: 1 }],
    });
    const result = await resolveTransport({ ssh_target: 'ssh:hostinger-test/site-a@staging' }, services, 'wpcli_read');
    expect('content' in result).toBe(false);
    if (!('content' in result)) {
      expect((result as any).alias).toBe('hostinger-test');
    }
  });
});
```

Adjust the exact fixture-construction helper name/shape to match this test file's existing
conventions — read it in full first. The assertions on message content (`/blocked|not
permitted/i`, `/no registered sites/i`, etc.) should match whatever exact wording Step 3 below
produces; keep the test and the implementation's wording in sync.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/transport/resolve.test.ts -t "external connection/site"`
Expected: FAIL — today's code reads `environment`/`wpPath` off the connection profile, which no
longer carries them after Task 5, so `tsc` itself should already be flagging this file as one of
the expected failures from Task 5 Step 4.

- [ ] **Step 3: Implement**

Replace the external branch of `resolveTransport` in `src/main/transport/resolve.ts`:

```ts
  const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
  if (sshTarget) {
    let parsed;
    try {
      parsed = parseTarget(sshTarget);
    } catch (e: any) {
      return error(e?.message ?? `Invalid SSH target: ${sshTarget}`);
    }
    if (parsed.type !== 'external' || !parsed.alias) {
      return error(`Not an external SSH target: ${sshTarget}. Expected ssh:alias@environment`);
    }

    // Connection profile: reachability metadata (wpCliPath), not per-site data.
    const storage = (services as any).registryStorage;
    const connectionProfile = storage ? getExternalProfile(storage, parsed.alias) : null;

    // Resolve the SITE before the gate runs — same ordering requirement as the
    // profile lookup this replaces, for the same reason: the registered
    // environment (now per-site) is half of what the gate decides on.
    const graphService = (services as any).graphService;
    const db = graphService?.getDb?.();
    const sites = findExternalSites(db, parsed.alias, parsed.site,
      'id, name, environment, wp_path, wp_cli_path');

    let resolvedSite: { id: string; name: string; environment: string | null; wp_path: string | null; wp_cli_path: string | null };
    if (parsed.site) {
      if (sites.length === 0) {
        return error(`No site "${parsed.site}" registered on connection "${parsed.alias}".`);
      }
      resolvedSite = sites[0];
    } else if (sites.length === 0) {
      return error(`Connection "${parsed.alias}" has no registered sites. Run \`nexus host add ${parsed.alias}\`.`);
    } else if (sites.length > 1) {
      const names = sites.map((s: any) => `ssh:${parsed.alias}/${s.name}@${s.environment ?? 'production'}`);
      return error(
        `"${parsed.alias}" has ${sites.length} registered sites — specify which one: ${names.join(', ')}`,
      );
    } else {
      resolvedSite = sites[0];
    }

    // Same gate as WP Engine installs, keyed on an ssh: target ref — but on the
    // more restrictive of the label the SITE was registered with and the one
    // the caller typed. See mostRestrictiveEnvironment for why the target
    // string alone cannot be trusted.
    const gatedEnv = mostRestrictiveEnvironment(parsed.environment, resolvedSite.environment as any);
    const settings = getEffectiveSettings(storage);
    if (!isOperationAllowed(operation as any, gatedEnv, settings, `ssh:${parsed.alias}/${resolvedSite.name}`)) {
      const registeredNote = resolvedSite.environment && gatedEnv !== parsed.environment
        ? ` '${parsed.alias}/${resolvedSite.name}' is registered as "${resolvedSite.environment}", which is what applies.`
        : '';
      return error(
        `Operation blocked: not permitted on "${gatedEnv}" environments.${registeredNote} `
        + `Adjust in Nexus AI → Settings → WP Engine Access.`,
      );
    }

    // An explicit wp_path wins — the user meant it. Otherwise the site's own
    // stored path, then nothing (WP-CLI searches from the login dir).
    const explicitPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;
    const wpPath = explicitPath ?? resolvedSite.wp_path ?? undefined;
    const wpCliPath = resolvedSite.wp_cli_path ?? connectionProfile?.wpCliPath;
    return withPolicy(
      new ExternalSshTransport(parsed.alias, wpPath, wpCliPath),
      REMOTE_POLICY,
    );
  }
```

Add the import: `import { findExternalSites } from '../mcp/site-resolver';` alongside the
existing `getExternalProfile` import.

**Note the graph column is `wp_path`, not the connection profile's `wpPath` — check the actual
`sites` table schema (`GraphService.ts`) for the exact column name before writing the `SELECT`
list**, since Task 6's implementer is adding a genuinely new pair of columns
(`wp_path`, `wp_cli_path`) to the `sites` row that did not exist as per-site fields before this
plan. Confirm via `sqlite3 <graph.db> ".schema sites"` whether `wp_path`/`wp_cli_path` already
exist as columns (they may not — `wpPath` and `wpCliPath` were connection-profile fields before
this plan, never per-site graph columns). **If they do not exist, add them via the same
migration pattern already used for `account_id`** (`GraphService.ts:219-226` — `hasColumn` check,
`ALTER TABLE ... ADD COLUMN`, no index needed since these are not queried on, only selected).

- [ ] **Step 4: If new columns are needed, add the migration**

Only if the schema check above shows `wp_path`/`wp_cli_path` are not existing columns, add to
`GraphService.ts` immediately after the existing `account_id` migration block:

```ts
    if (!this.hasColumn('sites', 'wp_path')) {
      this.logger.info('[GraphService] Adding wp_path column to sites table...');
      this.db!.exec('ALTER TABLE sites ADD COLUMN wp_path TEXT');
      this.logger.info('[GraphService] ✓ wp_path column added');
    }
    if (!this.hasColumn('sites', 'wp_cli_path')) {
      this.logger.info('[GraphService] Adding wp_cli_path column to sites table...');
      this.db!.exec('ALTER TABLE sites ADD COLUMN wp_cli_path TEXT');
      this.logger.info('[GraphService] ✓ wp_cli_path column added');
    }
```

Also add `wp_path?: string; wp_cli_path?: string;` to the `Site` interface/type that
`upsertSite` accepts, and add both to `upsertSite`'s `INSERT`/`ON CONFLICT` column lists
following the exact same `COALESCE(excluded.x, x)` pattern used for `environment` and
`account_id` — a later refresh must not erase what registration discovered.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/transport/ tests/unit/events/ -v && npx tsc --noEmit`
Expected: PASS. If Step 4's migration was needed, also run
`npx jest tests/unit/events/GraphService.migrations.test.ts -v` specifically (this file is in
the pre-existing failing baseline — confirm it fails for the **same** pre-existing reason, not a
new one your migration introduced; if it's already broken for an unrelated reason, don't try to
fix it, just confirm your change isn't why).

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/resolve.ts src/main/events/GraphService.ts tests/unit/transport/resolve.test.ts
git commit -m "fix(transport): resolveTransport gates on the resolved site's environment, not the connection's"
```

---

### Task 7: Sighting refreshes an existing site, never creates one

**Files:**
- Modify: `src/main/mcp/tool-registry.ts:20-80` (`maybeUpsertExternalSite`)
- Test: `tests/unit/mcp/tool-registry.test.ts` (extend existing suite)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3).

**The behavior change, stated explicitly (spec §8):** today, any successful command against
`ssh:<alias>@<env>` unconditionally creates a graph row for that alias, even if `nexus host add`
was never run. That auto-registration is the thing the explicit picker (Task 8) exists to
replace. After this task, a command against an alias/site pair that was never registered will
already have failed in Task 6's `resolveTransport` before this function is ever reached — so
this function only needs to handle refreshing a site that resolution has *already proven exists*.

- [ ] **Step 1: Write the failing tests**

```ts
describe('maybeUpsertExternalSite — refresh only, never create', () => {
  it('updates last_sync_at on an existing site', async () => {
    const graphService = { upsertSite: jest.fn(async () => {}) };
    const registryStorage = makeMemoryStorage(); // reuse the file's existing fake
    // Seed: connection profile already registered, and the target resolves to
    // an existing site — mock findExternalSites' underlying db.getDb() so the
    // function sees one matching row.
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:hostinger-test/site-a@production' },
      true,
      registryStorage,
      graphService,
    );
    expect(graphService.upsertSite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh:hostinger-test/site-a' }),
    );
  });

  it('does nothing for a bare shorthand against a connection with zero sites — nothing to sight', async () => {
    const graphService = { upsertSite: jest.fn(async () => {}) };
    const registryStorage = makeMemoryStorage();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:brand-new-alias@production' },
      true,
      registryStorage,
      graphService,
    );
    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('never invents a site row for an alias that was never registered', async () => {
    const graphService = { upsertSite: jest.fn(async () => {}) };
    const registryStorage = makeMemoryStorage();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:unregistered/whatever@production' },
      true,
      registryStorage,
      graphService,
    );
    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });
});
```

Adjust the mock shape for `registryStorage`/`graphService.getDb()` to match how this function
actually reaches the graph — read the current implementation fully (already shown below) before
finalizing the fixture.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/mcp/tool-registry.test.ts -t "refresh only"`
Expected: FAIL — today's implementation unconditionally calls `upsertSite` for any alias.

- [ ] **Step 3: Implement**

Replace `maybeUpsertExternalSite` in `src/main/mcp/tool-registry.ts`:

```ts
export async function maybeUpsertExternalSite(
  args: Record<string, unknown>,
  succeeded: boolean,
  registryStorage: { get(k: string): unknown; set(k: string, v: unknown): void } | null | undefined,
  graphService: { upsertSite(site: any): Promise<void>; getDb?: () => any } | null | undefined,
): Promise<void> {
  try {
    if (!succeeded) return;
    const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
    if (!sshTarget || !registryStorage || !graphService) return;

    const { parseTarget } = require('../../common/target');
    const parsed = parseTarget(sshTarget);
    if (parsed.type !== 'external' || !parsed.alias) return;

    const { findExternalSites } = require('./site-resolver');
    const db = graphService.getDb?.();
    // A successful call already proves the site resolved in resolveTransport,
    // so this is a lookup of something that must already exist — not a guess.
    // If it comes back empty (a race, or a call bypassing resolveTransport),
    // there is nothing to sight: creating a row here is exactly the silent
    // auto-registration this function used to do and no longer should.
    const sites = findExternalSites(db, parsed.alias, parsed.site, 'id, name, domain, environment');
    if (sites.length !== 1) return;
    const site = sites[0];

    const now = Date.now();

    // Preserve the existing domain — a sighting has nothing better than what
    // registration already discovered.
    let domain = site.domain;
    if (!domain) domain = site.name;

    await graphService.upsertSite({
      id: site.id,
      name: site.name,
      domain,
      source: 'external',
      host: 'external',
      account_id: parsed.alias,
      environment: site.environment,
      is_active: true,
      created_at: now,
      updated_at: now,
      last_sync_at: now,
    });

    // Connection-level freshness — this alias is still reachable.
    const { upsertExternalProfile } = require('../external/externalSiteStore');
    upsertExternalProfile(registryStorage, {
      alias: parsed.alias,
      firstSeenAt: now,
      lastSeenAt: now,
    } as any, 'sighting');
  } catch {
    // Never let a sighting failure affect the caller's actual result.
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/mcp/tool-registry.test.ts -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/tool-registry.ts tests/unit/mcp/tool-registry.test.ts
git commit -m "fix(mcp): a lazy sighting refreshes an existing external site, never creates one"
```

---

### Task 8: Registration — the multi-site picker

**Files:**
- Modify: `src/main/graphql/schema.ts` (`NexusHostAddResult`, `nexusHostAdd`)
- Modify: `src/main/graphql/resolvers.ts` (`nexusHostAdd`)
- Modify: `src/cli/commands/host.ts` (`add` command)
- Test: `tests/unit/graphql/host-add.test.ts` (extend or create, following the existing
  `tests/unit/mcp/host-refresh.test.ts`-style pattern if one exists — check first)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3), `externalSiteId(alias, site)` (Task 5).
- Produces: `nexusHostAdd(alias, path?, environment?, site?)` — `site` is new and optional.

**The flow (spec §5.2):** the probe is unchanged — it already returns every discovered root as
`candidates` when it finds more than one. What changes is what the CLI does with that.

1. CLI calls `nexusHostAdd(alias)` with no `path`.
2. If the probe finds **zero or one** root, behavior is unchanged from today except the site
   name: derive a slug from the discovered domain (or reuse `alias` if there's no `report.siteUrl`
   to derive from), and register that one site.
3. If the probe finds **more than one** root, the resolver must still **persist the connection
   profile** (so `host list` shows a zero-site connection) but return `registered: false` with
   `report.candidates` populated — this already happens today via the existing
   `multiple-wordpress` probe failure; the new requirement is that the connection profile write
   must happen on this branch too, which it does not today (today's code only writes the profile
   after a successful single-site probe).
4. The CLI, seeing `candidates`, probes each one individually (`nexusHostProbe(alias, path)`) to
   get its domain, builds a checklist with an auto-suggested slug per candidate, prompts for
   environment per selection, and — for each selected site — calls
   `nexusHostAdd(alias, path=candidatePath, site=chosenSlug, environment=chosenEnv)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('nexusHostAdd — connection persists even when multiple sites are found', () => {
  it('a single discovered root registers one site with a domain-derived slug', async () => {
    // mock probeExternalHost to resolve ok:true, siteUrl: 'https://example.com', wpPath set
    const result = await createResolvers(ctx()).Mutation.nexusHostAdd(
      null, { alias: 'solo-host', path: null, environment: null },
    );
    expect(result.registered).toBe(true);
    // The graph write's id must be ssh:solo-host/<slug>, not ssh:solo-host.
    expect(upsertSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(/^ssh:solo-host\//), account_id: 'solo-host' }),
    );
  });

  it('multiple discovered roots persist the connection profile without registering any site', async () => {
    // mock probeExternalHost to resolve ok:false, failure.kind:'multiple-wordpress', candidates:[...]
    const result = await createResolvers(ctx()).Mutation.nexusHostAdd(
      null, { alias: 'multi-host', path: null, environment: null },
    );
    expect(result.registered).toBe(false);
    expect(result.report.candidates).toHaveLength(2);
    // The connection profile write still happened.
    expect(upsertExternalProfileSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ alias: 'multi-host' }),
      'registration',
    );
  });

  it('an explicit site name is used verbatim rather than derived', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusHostAdd(
      null, { alias: 'multi-host', path: '/home/u1/site-a', environment: 'production', site: 'my-custom-name' },
    );
    expect(result.registered).toBe(true);
    expect(upsertSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh:multi-host/my-custom-name' }),
    );
  });

  it('registering a second site under an already-registered connection does not disturb the first', async () => {
    // Seed one existing site under 'multi-host', then register a second.
    const result = await createResolvers(ctx()).Mutation.nexusHostAdd(
      null, { alias: 'multi-host', path: '/home/u1/site-b', environment: 'production', site: 'site-b' },
    );
    expect(result.registered).toBe(true);
    // Both sites' upsertSite calls are independent — assert on call args, not
    // on a shared mutable object, to catch accidental cross-contamination.
  });
});
```

Follow this test file's existing fixture/mocking conventions for `probeExternalHost` and
`graphService.upsertSite` — read whatever existing `nexusHostAdd`/`nexusHostProbe` test coverage
exists first (grep `nexusHostAdd` across `tests/`) rather than inventing a new harness.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/graphql/host-add.test.ts -v`
Expected: FAIL — today's resolver never persists the connection profile on the
`multiple-wordpress` branch, and has no `site` parameter.

- [ ] **Step 3: Implement the schema change**

In `src/main/graphql/schema.ts`, change:

```graphql
    nexusHostAdd(alias: String!, path: String, environment: String): NexusHostAddResult!
```

to:

```graphql
    "Probe an external SSH host and register it on success. `site` names which discovered WordPress install to register — required when the connection has more than one and `path` disambiguates which one; omitted for a single-site connection, where a slug is derived from the discovered domain."
    nexusHostAdd(alias: String!, path: String, environment: String, site: String): NexusHostAddResult!
```

- [ ] **Step 4: Implement the resolver**

In `src/main/graphql/resolvers.ts`, replace the body of `nexusHostAdd` (the block shown in this
task's context, currently ending with the `report.ok` failure-passthrough and the single
`upsertSite` call):

```ts
      nexusHostAdd: async (_parent: ResolverParent, {
        alias, path, environment, site,
      }: { alias: string; path?: string; environment?: string; site?: string }) => {
        return withQueue(async () => {
          try {
            if (environment !== undefined && environment !== null
              && !['production', 'staging', 'development'].includes(environment)) {
              return {
                success: false, registered: false, report: null, environment: null,
                error: `Invalid environment '${environment}'. Expected production, staging or development.`,
              };
            }
            const storage = (services as any).registryStorage;
            if (!storage) {
              return {
                success: false, registered: false, report: null, environment: null,
                error: 'Storage not available',
              };
            }

            const validEnv = (environment ?? 'production') as 'production' | 'staging' | 'development';
            const report = await probeExternalHost(alias, { wpPath: path ?? undefined });

            if (!report.ok) {
              // A `multiple-wordpress` failure is not a refusal to register the
              // CONNECTION — only to guess which site. Persist the connection
              // profile now so `host list` shows it (with zero sites) even
              // before the caller picks one; a genuinely unreachable/typo'd
              // alias should NOT be persisted, so this only runs when the
              // probe got far enough to discover WordPress at all.
              if (report.failure?.kind === 'multiple-wordpress') {
                const now = Date.now();
                upsertExternalProfile(storage, {
                  alias,
                  wpCliPath: report.wpCliPath,
                  firstSeenAt: now,
                  lastSeenAt: now,
                }, 'registration');
              }
              return {
                success: true, registered: false, report: toHostReport(report),
                environment: validEnv, error: null,
              };
            }

            const now = Date.now();
            upsertExternalProfile(storage, {
              alias,
              wpCliPath: report.wpCliPath,
              firstSeenAt: now,
              lastSeenAt: now,
            }, 'registration');

            let domain = alias;
            if (report.siteUrl) {
              try { domain = new URL(report.siteUrl).hostname || alias; } catch { /* keep alias */ }
            }
            // Auto-suggest a slug from the domain's first label when none was
            // given — the single-site case, which stays zero-ceremony.
            const siteSlug = site ?? domain.split('.')[0] ?? alias;

            await (services as any).graphService?.upsertSite({
              id: externalSiteId(alias, siteSlug),
              name: siteSlug,
              domain,
              source: 'external',
              host: 'external',
              account_id: alias,
              environment: validEnv,
              wp_version: report.wpVersion,
              wp_path: report.wpPath,
              wp_cli_path: report.wpCliPath,
              is_active: true,
              created_at: now,
              updated_at: now,
              last_sync_at: now,
            });

            return {
              success: true, registered: true, report: toHostReport(report),
              environment: validEnv, error: null,
            };
          } catch (e: any) {
            return {
              success: false, registered: false, report: null, environment: null,
              error: e?.message ?? String(e),
            };
          }
        });
      },
```

- [ ] **Step 5: Implement the CLI picker**

Replace the `add` command's action in `src/cli/commands/host.ts`. Add a helper above it:

```ts
/** First label of a domain, or the alias if there's nothing to derive from. */
function suggestSiteSlug(domain: string | undefined, alias: string): string {
  if (!domain) return alias;
  return domain.split('.')[0] || alias;
}
```

Then replace the `add` action body from the point where it currently prints the probe report:

```ts
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: HOST_PROBE_CLIENT_TIMEOUT_MS });

      // Probe once, unqualified, to discover how many sites this connection has.
      console.log(`\nProbing ${alias}...`);
      const probe = await client.mutate<{ nexusHostProbe: any }>(`
        mutation($alias: String!, $path: String) {
          nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
        }
      `, { alias, path: options.path ?? null });

      const pr = probe.nexusHostProbe;
      if (!pr.success) { console.error(`✗ ${pr.error}`); process.exit(1); }
      if (!pr.report) { console.error(`✗ ${alias}: probe returned no report.`); process.exit(1); }

      let selections: Array<{ path: string; site: string; environment: string }>;

      if (pr.report.ok) {
        // Zero-ambiguity case: one root, register it directly.
        const slug = suggestSiteSlug(
          pr.report.siteUrl ? new URL(pr.report.siteUrl).hostname : undefined, alias,
        );
        selections = [{ path: pr.report.wpPath, site: slug, environment: options.env ?? 'production' }];
      } else if (pr.report.failure?.kind === 'multiple-wordpress') {
        const candidates: string[] = pr.report.candidates ?? [];
        console.log(`\nFound ${candidates.length} WordPress installations on '${alias}':`);

        // Probe each candidate individually to get its domain — reusing the
        // same single-path probe, not new discovery logic.
        const withDomains: Array<{ path: string; domain?: string }> = [];
        for (const path of candidates) {
          const p = await client.mutate<{ nexusHostProbe: any }>(`
            mutation($alias: String!, $path: String) {
              nexusHostProbe(alias: $alias, path: $path) { success report { ${PROBE_FIELDS} } }
            }
          `, { alias, path });
          const r = p.nexusHostProbe?.report;
          withDomains.push({ path, domain: r?.siteUrl ? new URL(r.siteUrl).hostname : undefined });
        }

        if (options.yes) {
          selections = withDomains.map((c) => ({
            path: c.path, site: suggestSiteSlug(c.domain, alias), environment: options.env ?? 'production',
          }));
        } else {
          selections = [];
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            for (const c of withDomains) {
              const suggested = suggestSiteSlug(c.domain, alias);
              const answer = (await prompt(
                rl, `  [${c.domain ?? c.path}] register as '${suggested}'? [Y/n/name] `,
              )).trim();
              if (answer.toLowerCase() === 'n') continue;
              const site = answer && answer.toLowerCase() !== 'y' ? answer : suggested;
              selections.push({ path: c.path, site, environment: options.env ?? 'production' });
            }
          } finally {
            rl.close();
          }
        }

        if (selections.length === 0) {
          console.log('\nNo sites selected. Connection registered with zero sites.');
          console.log(`  Add one later: nexus host add ${alias} --path <one-of-the-paths-above> --site <name>\n`);
          return;
        }
      } else {
        printFailure(pr.report);
        process.exit(1);
        return;
      }

      let anyFailed = false;
      for (const sel of selections) {
        const result = await client.mutate<{ nexusHostAdd: any }>(`
          mutation($alias: String!, $path: String, $environment: String, $site: String) {
            nexusHostAdd(alias: $alias, path: $path, environment: $environment, site: $site) {
              success error registered environment report { ${PROBE_FIELDS} }
            }
          }
        `, { alias, path: sel.path, environment: sel.environment, site: sel.site });

        const { success, error, registered, environment } = result.nexusHostAdd;
        if (!success || !registered) {
          console.error(`✗ ${sel.site}: ${error ?? 'registration failed'}`);
          anyFailed = true;
          continue;
        }
        console.log(`✓ Registered ${alias}/${sel.site}`);
        console.log(`  Try: nexus wp core version ssh:${alias}/${sel.site}@${environment ?? 'production'}`);
      }
      console.log('');
      if (anyFailed) process.exit(1);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });
```

This drops the pre-confirmation `previewEnvironment`/`confirm()` flow in favor of the per-site
prompt shown above, since confirming once-per-connection no longer makes sense once a connection
can yield an arbitrary number of sites to confirm individually. `-y`/`--yes` skips all prompts,
matching the existing convention.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/graphql/host-add.test.ts tests/unit/cli/ -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/host.ts tests/unit/graphql/host-add.test.ts
git commit -m "feat(external): registration lists every discovered site and lets the user pick"
```

---

### Task 9: Removal — cascade, and a new scoped-down command

**Files:**
- Modify: `src/main/graphql/schema.ts` (`nexusHostRemove` docstring, new
  `nexusHostRemoveSite`/`NexusHostRemoveSiteResult`)
- Modify: `src/main/graphql/resolvers.ts` (`nexusHostRemove`, new `nexusHostRemoveSite`)
- Modify: `src/cli/commands/host.ts` (`remove` unchanged in signature; new `remove-site`)
- Test: `tests/unit/graphql/host-remove.test.ts` (extend or create)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3).
- Produces: `nexusHostRemoveSite(alias: String!, site: String!): NexusHostRemoveSiteResult!`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('nexusHostRemove — cascades to every site under the connection', () => {
  it('removing a connection deactivates every site with that account_id', async () => {
    // Seed two sites under 'hostinger-test'.
    const result = await createResolvers(ctx()).Mutation.nexusHostRemove(null, { alias: 'hostinger-test' });
    expect(result.removed).toBe(true);
    // Both upsertSite calls set is_active: false.
    expect(upsertSiteMock).toHaveBeenCalledTimes(2);
    for (const call of upsertSiteMock.mock.calls) {
      expect(call[0].is_active).toBe(false);
    }
  });
});

describe('nexusHostRemoveSite — removes one site, leaves siblings', () => {
  it('deactivates exactly the named site', async () => {
    // Seed two sites under 'hostinger-test': site-a, site-b.
    const result = await createResolvers(ctx()).Mutation.nexusHostRemoveSite(
      null, { alias: 'hostinger-test', site: 'site-a' },
    );
    expect(result.removed).toBe(true);
    expect(upsertSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh:hostinger-test/site-a', is_active: false }),
    );
    expect(upsertSiteMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh:hostinger-test/site-b' }),
    );
  });

  it('reports not-removed for a site that does not exist under the connection', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusHostRemoveSite(
      null, { alias: 'hostinger-test', site: 'nonexistent' },
    );
    expect(result.removed).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/graphql/host-remove.test.ts -v`
Expected: FAIL — `nexusHostRemoveSite` doesn't exist; `nexusHostRemove` deactivates only one row.

- [ ] **Step 3: Implement the schema addition**

In `src/main/graphql/schema.ts`:

```graphql
  type NexusHostRemoveSiteResult {
    success: Boolean!
    error: String
    removed: Boolean!
  }
```

and in the `extend type Mutation` block, after `nexusHostRemove`:

```graphql
    "Forget one site under a connection, leaving the connection and its other sites registered."
    nexusHostRemoveSite(alias: String!, site: String!): NexusHostRemoveSiteResult!
```

- [ ] **Step 4: Implement the resolvers**

Replace `nexusHostRemove` in `src/main/graphql/resolvers.ts`:

```ts
      nexusHostRemove: async (_p: ResolverParent, { alias }: { alias: string }) => {
        return withQueue(async () => {
          try {
            const storage = (services as any).registryStorage;
            if (!storage) return { success: false, error: 'Storage not available', removed: false };

            const removed = removeExternalProfile(storage, alias);

            // Cascade to every site under this connection — one alias, one
            // command, everything under it goes. Deactivate rather than
            // delete: GraphService has no per-site delete, and the retention
            // sweep already hard-deletes inactive sites once they age out.
            if (removed) {
              const db = (services as any).graphService?.getDb?.();
              const sites = findExternalSites(db, alias, undefined, 'id, name');
              const now = Date.now();
              for (const site of sites) {
                await (services as any).graphService?.upsertSite({
                  id: site.id,
                  name: site.name,
                  domain: site.name,
                  source: 'external',
                  host: 'external',
                  account_id: alias,
                  is_active: false,
                  created_at: now,
                  updated_at: now,
                });
              }
            }

            return { success: true, error: null, removed };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), removed: false };
          }
        });
      },

      nexusHostRemoveSite: async (_p: ResolverParent, { alias, site }: { alias: string; site: string }) => {
        return withQueue(async () => {
          try {
            const db = (services as any).graphService?.getDb?.();
            const matches = findExternalSites(db, alias, site, 'id, name');
            if (matches.length === 0) {
              return { success: true, error: null, removed: false };
            }
            const now = Date.now();
            await (services as any).graphService?.upsertSite({
              id: matches[0].id,
              name: matches[0].name,
              domain: matches[0].name,
              source: 'external',
              host: 'external',
              account_id: alias,
              is_active: false,
              created_at: now,
              updated_at: now,
            });
            return { success: true, error: null, removed: true };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), removed: false };
          }
        });
      },
```

- [ ] **Step 5: Implement the CLI command**

Add to `src/cli/commands/host.ts`, after the `remove` command:

```ts
// ============================================================================
// host remove-site
// ============================================================================

hostCommand
  .command('remove-site <alias/site>')
  .description('Forget one site under a connection, leaving the connection and its other sites')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (aliasSite: string, options) => {
    const slash = aliasSite.indexOf('/');
    if (slash === -1) {
      console.error(`✗ Expected <alias>/<site>, got: ${aliasSite}`);
      process.exit(1);
    }
    const alias = aliasSite.slice(0, slash);
    const site = aliasSite.slice(slash + 1);

    try {
      if (!options.yes && !(await confirm(`Remove ${alias}/${site} from the fleet?`))) {
        console.log('Cancelled.');
        process.exit(0);
      }

      const client = getClient();
      const result = await client.mutate<{ nexusHostRemoveSite: any }>(`
        mutation($alias: String!, $site: String!) {
          nexusHostRemoveSite(alias: $alias, site: $site) { success error removed }
        }
      `, { alias, site });

      const { success, error, removed } = result.nexusHostRemoveSite;
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!removed) { console.error(`✗ ${alias}/${site} is not registered.`); process.exit(1); }
      console.log(`✓ Removed ${alias}/${site}.`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/graphql/host-remove.test.ts tests/unit/cli/ -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/host.ts tests/unit/graphql/host-remove.test.ts
git commit -m "feat(external): host remove cascades to every site; host remove-site scopes to one"
```

---

### Task 10: `nexusHostRefresh`/`nexusHostIndex` operate per connection

**Files:**
- Modify: `src/main/graphql/schema.ts` (`NexusHostRefreshResult`, `NexusHostIndexResult` become
  per-site lists)
- Modify: `src/main/graphql/resolvers.ts` (`nexusHostRefresh`, `nexusHostIndex`)
- Modify: `src/cli/commands/host.ts` (`refresh`, `index` output)
- Test: `tests/unit/graphql/host-refresh.test.ts`, `tests/unit/graphql/host-index.test.ts`
  (extend existing suites)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3).
- Produces: `NexusHostRefreshResult.results: [NexusSiteRefreshResult!]!` (was flat scalars —
  `wpVersion`/`phpVersion`/`pluginCount`/`themeCount` move onto the new per-site type). Same
  shape change for `NexusHostIndexResult.results: [NexusSiteIndexResult!]!`.

Both mutations today take a bare `alias: String!` and refresh/index exactly one row — the one
whose `name` happened to equal the alias, which only worked because that was true under the old
model. A connection can now have N sites, and an on-demand "refresh this host" command that
silently only touches one of them is a half-finished feature, not a smaller one — so this
mirrors what both schedulers already do: iterate every active site under the connection.

`alias` also accepts an optional `/<site>` suffix to scope to one, matching the target grammar
established in Task 2 (parse with `parseTarget` rather than hand-rolling a second split).

- [ ] **Step 1: Write the failing tests**

```ts
describe('nexusHostRefresh — operates on every site under the connection', () => {
  it('refreshes every site when given a bare alias', async () => {
    // Seed two sites under 'hostinger-test'; mock resolveTransport/collectExternalHostData
    // to succeed for both.
    const result = await createResolvers(ctx()).Mutation.nexusHostRefresh(null, { alias: 'hostinger-test' });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('scopes to one site when given alias/site', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusHostRefresh(null, { alias: 'hostinger-test/site-a' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].site).toBe('site-a');
  });

  it('one site failing does not prevent the others from refreshing', async () => {
    // Mock resolveTransport to fail for site-a and succeed for site-b.
    const result = await createResolvers(ctx()).Mutation.nexusHostRefresh(null, { alias: 'hostinger-test' });
    expect(result.results.find((r: any) => r.site === 'site-a').success).toBe(false);
    expect(result.results.find((r: any) => r.site === 'site-b').success).toBe(true);
  });

  it('a connection with zero sites reports a clear top-level error, not an empty results list', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusHostRefresh(null, { alias: 'empty-conn' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no registered sites/i);
  });
});
```

Mirror the same four cases for `nexusHostIndex` in its own test file.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts -v`
Expected: FAIL — today's resolvers return flat scalars for exactly one row looked up by
`LOWER(name) = alias.toLowerCase()`, which stops matching once `name` is a site slug.

- [ ] **Step 3: Implement the schema change**

In `src/main/graphql/schema.ts`, replace:

```graphql
  "Result of refreshing one external SSH host's metadata."
  type NexusHostRefreshResult {
    success: Boolean!
    error: String
    "WordPress version collected, null when it could not be read."
    wpVersion: String
    "PHP version from wp --info, null when it could not be read."
    phpVersion: String
    "Plugins found, null when the plugin batch failed."
    pluginCount: Int
    "Themes found, null when the theme batch failed."
    themeCount: Int
  }
```

with:

```graphql
  type NexusSiteRefreshResult {
    site: String!
    success: Boolean!
    error: String
    wpVersion: String
    phpVersion: String
    pluginCount: Int
    themeCount: Int
  }

  "Result of refreshing every site under one external SSH connection."
  type NexusHostRefreshResult {
    "False only when the connection itself could not be resolved (unregistered, zero sites)."
    success: Boolean!
    error: String
    results: [NexusSiteRefreshResult!]!
  }
```

Same shape for indexing — replace `NexusHostIndexResult`:

```graphql
  type NexusSiteIndexResult {
    site: String!
    success: Boolean!
    error: String
    documentCount: Int
  }

  "Result of content-indexing every site under one external SSH connection."
  type NexusHostIndexResult {
    success: Boolean!
    error: String
    results: [NexusSiteIndexResult!]!
  }
```

Update both mutation docstrings/signatures in `extend type Mutation` to note `alias` accepts
`alias` or `alias/site`.

- [ ] **Step 4: Implement the resolvers**

Replace `nexusHostRefresh`:

```ts
      nexusHostRefresh: async (_parent: ResolverParent, { alias: aliasArg }: { alias: string }) => {
        try {
          const [alias, site] = aliasArg.includes('/') ? aliasArg.split('/', 2) : [aliasArg, undefined];
          const db = services.graphService?.getDb?.();
          const rows = findExternalSites(db, alias, site, 'id, name, environment');
          if (rows.length === 0) {
            return {
              success: false,
              error: site
                ? `No site "${site}" registered on connection "${alias}".`
                : `"${alias}" is not a registered external host, or has no registered sites. Run \`nexus host add ${alias}\` first.`,
              results: [],
            };
          }

          const results = await Promise.all(rows.map(async (row: any) => {
            try {
              const target = `ssh:${alias}/${row.name}@${row.environment ?? 'production'}`;
              const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
              if ('content' in transport) {
                const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Could not reach host';
                return { site: row.name, success: false, error: msg, wpVersion: null, phpVersion: null, pluginCount: null, themeCount: null };
              }
              const data = await collectExternalHostData(transport as any, console);
              await writeExternalHostData(services.graphService as any, row.id, row.name, data, Date.now(), console);
              return {
                site: row.name, success: true, error: null,
                wpVersion: data.wpVersion ?? null, phpVersion: data.phpVersion ?? null,
                pluginCount: data.plugins?.length ?? null, themeCount: data.themes?.length ?? null,
              };
            } catch (e: any) {
              return { site: row.name, success: false, error: e?.message ?? String(e), wpVersion: null, phpVersion: null, pluginCount: null, themeCount: null };
            }
          }));

          return { success: true, error: null, results };
        } catch (e: any) {
          return { success: false, error: e?.message ?? String(e), results: [] };
        }
      },
```

Apply the identical shape to `nexusHostIndex`, substituting the existing per-site indexing body
(the `ExternalContentIndexService` construction and `indexOne` call already shown in this task's
context) inside the `Promise.all` map, returning `{ site: row.name, success, error,
documentCount }` per entry.

- [ ] **Step 5: Update the CLI output**

Replace the `refresh` command's result handling in `src/cli/commands/host.ts`:

```ts
      const { success, error, results } = result.nexusHostRefresh;
      if (!success) {
        console.error(`\n✗ ${error}`);
        process.exit(1);
      }
      console.log(`\nRefreshed ${alias}:`);
      let anyFailed = false;
      for (const r of results) {
        if (!r.success) {
          console.log(`  ✗ ${r.site}: ${r.error}`);
          anyFailed = true;
          continue;
        }
        console.log(`  ✓ ${r.site}`);
        console.log(`      WordPress:  ${r.wpVersion ?? 'unknown'}`);
        console.log(`      PHP:        ${r.phpVersion ?? 'unknown'}`);
        console.log(`      Plugins:    ${r.pluginCount ?? 'not collected'}`);
        console.log(`      Themes:     ${r.themeCount ?? 'not collected'}`);
      }
      console.log('');
      if (anyFailed) process.exit(1);
```

Mirror the same shape for `index`, printing `documentCount` per site.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts tests/unit/cli/ -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/host.ts tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts
git commit -m "feat(external): host refresh/index operate on every site under a connection"
```

---

### Task 11: `nexusSitesGet`'s external branch, both copies

**Files:**
- Modify: `src/main/graphql/resolvers.ts:530-577`
- Modify: `src/main/graphql/resolvers/sites.ts` (dormant mirror — same fix, per the established
  `resolvers/wpe.ts` resync policy in CLAUDE.md)
- Test: `tests/unit/graphql/sites-get.test.ts` (extend existing suite)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
describe('nexusSitesGet — external target resolves by connection+site', () => {
  it('resolves ssh:<alias>/<site>@<env>', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:hostinger-test/site-a@production' },
    );
    expect(result.success).toBe(true);
    expect(result.site.id).toBe('ssh:hostinger-test/site-a');
  });

  it('bare shorthand resolves when the connection has exactly one site', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:solo-host@production' },
    );
    expect(result.success).toBe(true);
  });

  it('bare shorthand against a multi-site connection fails with a clear disambiguation message', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusSitesGet(
      null, { target: 'ssh:hostinger-test@production' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/site-a/);
    expect(result.error).toMatch(/site-b/);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/graphql/sites-get.test.ts -t "external target"`
Expected: FAIL — today's implementation matches `r.id === externalSiteId(alias)`, which no
longer identifies a specific site.

- [ ] **Step 3: Implement**

Replace the `parsed.type === 'external'` block in `src/main/graphql/resolvers.ts` (shown fully
in this task's context, from `if (parsed.type === 'external') {` through its closing `}`):

```ts
          if (parsed.type === 'external') {
            const alias = parsed.alias!;
            const db = graphService?.getDb?.();
            const rows = findExternalSites(db, alias, parsed.site,
              '*');

            let graphSite: any;
            if (rows.length === 0) {
              return {
                success: false,
                error: parsed.site
                  ? `No site "${parsed.site}" registered on connection "${alias}".`
                  : `External host not found: ${target}`,
              };
            } else if (rows.length > 1) {
              const names = rows.map((r: any) => `ssh:${alias}/${r.name}@${r.environment ?? 'production'}`);
              return {
                success: false,
                error: `"${alias}" has ${rows.length} registered sites — specify which one: ${names.join(', ')}`,
              };
            } else {
              graphSite = rows[0];
            }

            const twin = services.twinService?.getFromGraph?.(graphSite, graphService) ?? null;
            const twinAge = twin?.asOf ? formatTwinAge(Date.now() - twin.asOf) : null;
            return {
              success: true,
              site: {
                id: graphSite.id,
                name: graphSite.name,
                domain: graphSite.domain ?? null,
                path: '',
                status: 'remote',
                siteKind: 'external',
                wpVersion:            twin?.wpVersion ?? graphSite.wp_version ?? null,
                phpVersion:           twin?.phpVersion ?? graphSite.php_version ?? null,
                mysqlVersion:         null,
                siteUrl:              twin?.siteUrl ?? graphSite.site_url ?? graphSite.domain ?? null,
                adminEmail:           null,
                activeTheme:          twin?.activeTheme ?? null,
                activePluginCount:    twin?.plugins?.filter((p: any) => p.status === 'active').length ?? null,
                installedPluginCount: twin?.plugins?.length ?? null,
                postCount:            twin?.postCount ?? null,
                lastPostAt:           null,
                twinCompleteness:     twin?.completeness ?? 'none',
                twinAge,
                indexed: false,
                indexedAt: null,
                documentCount: 0,
                chunkCount: 0,
                linkedTo: null,
              },
            };
          }
```

Add `import { findExternalSites } from '../mcp/site-resolver';` if not already imported in this
file (it will be by Task 6 already, since `resolve.ts` and `resolvers.ts` are separate files —
check before adding a duplicate import).

- [ ] **Step 4: Resync the dormant mirror**

Read `src/main/graphql/resolvers/sites.ts`'s current `parsed.type === 'external'` block in full
(same shape as `resolvers.ts`'s pre-fix version, per the earlier `externalSiteId` grep) and apply
the identical fix. Confirm the surrounding function's variable names (`graphService`, `target`,
`db`) match this file's own conventions before pasting — do not assume they're identical to
`resolvers.ts` without checking, since this dormant file has its own history of small
divergences (see CLAUDE.md's note on `resolvers/wpe.ts`).

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/graphql/sites-get.test.ts -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/graphql/resolvers.ts src/main/graphql/resolvers/sites.ts tests/unit/graphql/sites-get.test.ts
git commit -m "fix(graphql): nexusSitesGet resolves external targets by connection+site"
```

---

### Task 12: Health lookup and `host list`'s connection→sites shape

**Files:**
- Modify: `src/main/graphql/resolvers.ts` (`nexusFleetSiteHealth`'s health lookup, `nexusHostList`)
- Modify: `src/main/graphql/schema.ts` (`NexusHostEntry` nests sites)
- Modify: `src/cli/commands/host.ts` (`list` output)
- Test: `tests/unit/graphql/fleet-site-health.test.ts`, `tests/unit/graphql/host-list.test.ts`
  (extend existing suites)

**Interfaces:**
- Consumes: `findExternalSites` (Task 3).
- Produces: `NexusHostEntry.sites: [NexusExternalSite!]!` (new nested field, replacing the flat
  `wpPath`/`environment` fields that no longer describe a connection after Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
describe('nexusFleetSiteHealth — external lookup by connection+site', () => {
  it('resolves via ssh_target with a site segment', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusFleetSiteHealth(
      null, { ssh_target: 'ssh:hostinger-test/site-a@production' },
    );
    expect(result.success).toBe(true);
  });
});

describe('nexusHostList — sites nested under their connection', () => {
  it('lists every site under each connection', async () => {
    // Seed hostinger-test with two sites.
    const result = await createResolvers(ctx()).Mutation.nexusHostList();
    const host = result.hosts.find((h: any) => h.alias === 'hostinger-test');
    expect(host.sites).toHaveLength(2);
    expect(host.sites.map((s: any) => s.name).sort()).toEqual(['site-a', 'site-b']);
  });

  it('a connection with zero sites still appears, with an empty sites array', async () => {
    const result = await createResolvers(ctx()).Mutation.nexusHostList();
    const host = result.hosts.find((h: any) => h.alias === 'empty-conn');
    expect(host.sites).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/graphql/fleet-site-health.test.ts tests/unit/graphql/host-list.test.ts -v`
Expected: FAIL — the health lookup's `expectedId = externalSiteId(alias)` call no longer
compiles with one argument after Task 5; `nexusHostList` returns flat `NexusHostEntry` objects
with no `sites` field.

- [ ] **Step 3: Fix the health lookup**

In `src/main/graphql/resolvers.ts`, replace the `nexusFleetSiteHealth` external branch (the
`else` block shown in this task's context, keyed on `'ssh_target' in targetArgs`):

```ts
            } else {
              // I7: is_active = 1 enforced inside findExternalSites.
              const sshTarget = targetArgs.ssh_target as string;
              const parsed = parseTarget(sshTarget);
              const alias = parsed.alias!;
              const db2 = db; // the outer `db` is already confirmed non-null above this block
              const rows = findExternalSites(db2, alias, parsed.site,
                'id, domain, php_version, wp_version, site_url');
              if (rows.length === 1) {
                row = rows[0] as typeof row;
              }
              // rows.length === 0 or > 1 both fall through to the existing
              // "Remote site not found" handling below — an ambiguous bare
              // shorthand is reported the same as not-found here, since this
              // path has no per-site disambiguation message today; that is
              // consistent with its existing behavior for a missing row.
            }
```

- [ ] **Step 4: Schema change for `host list`**

In `src/main/graphql/schema.ts`, add and change:

```graphql
  type NexusExternalSite {
    name: String!
    domain: String
    environment: String!
    wpVersion: String
  }

  type NexusHostEntry {
    alias: String!
    wpCliPath: String
    firstSeenAt: Float!
    lastSeenAt: Float!
    sites: [NexusExternalSite!]!
  }
```

(removes the old flat `wpPath: String` and `environment: String!` fields from `NexusHostEntry`
— they described a single site under the old model and have no connection-level meaning now).

- [ ] **Step 5: Fix `nexusHostList`**

```ts
      nexusHostList: async () => {
        try {
          const storage = (services as any).registryStorage;
          if (!storage) return { success: false, error: 'Storage not available', hosts: [] };
          const db = (services as any).graphService?.getDb?.();
          const profiles = listExternalProfiles(storage);
          const hosts = profiles.map((p: any) => {
            const sites = findExternalSites(db, p.alias, undefined,
              'name, domain, environment, wp_version');
            return {
              alias: p.alias,
              wpCliPath: p.wpCliPath ?? null,
              firstSeenAt: p.firstSeenAt,
              lastSeenAt: p.lastSeenAt,
              sites: sites.map((s: any) => ({
                name: s.name, domain: s.domain, environment: s.environment ?? 'production',
                wpVersion: s.wp_version,
              })),
            };
          });
          return { success: true, error: null, hosts };
        } catch (e: any) {
          return { success: false, error: e?.message ?? String(e), hosts: [] };
        }
      },
```

- [ ] **Step 6: Update the CLI's `list` output**

Replace the rendering loop in `src/cli/commands/host.ts`'s `list` command:

```ts
      console.log(`\n${hosts.length} external connection${hosts.length === 1 ? '' : 's'}:\n`);
      for (const h of hosts) {
        console.log(`  ${h.alias}`);
        if (h.wpCliPath) console.log(`    wp-cli     ${h.wpCliPath}`);
        console.log(`    last seen  ${new Date(h.lastSeenAt).toLocaleString()}`);
        if (h.sites.length === 0) {
          console.log(`    (no sites registered — nexus host add ${h.alias} --path <dir>)`);
        } else {
          for (const s of h.sites) {
            console.log(`    ${s.name} [${s.environment}]  ${s.domain ?? ''}`.trimEnd());
            console.log(`      target: ssh:${h.alias}/${s.name}@${s.environment}`);
          }
        }
      }
      console.log('');
```

Also update the GraphQL query string embedded in the `list` action to request the nested
`sites { name domain environment wpVersion }` field instead of the removed flat
`wpPath environment` fields.

- [ ] **Step 7: Run tests**

Run: `npx jest tests/unit/graphql/ tests/unit/cli/ -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/graphql/resolvers.ts src/main/graphql/schema.ts src/cli/commands/host.ts tests/unit/graphql/fleet-site-health.test.ts tests/unit/graphql/host-list.test.ts
git commit -m "fix(graphql): fleet site health resolves by connection+site; host list nests sites"
```

---

### Task 13: Fix the schedulers' target reconstruction

**Files:**
- Modify: `src/main/startup/ExternalRefreshScheduler.ts:99,116`
- Modify: `src/main/startup/ExternalContentIndexScheduler.ts` (same pattern, confirmed present)
- Test: `tests/unit/startup/ExternalRefreshScheduler.test.ts`,
  `tests/unit/startup/ExternalContentIndexScheduler.test.ts` (extend existing suites)

**Interfaces:** none new.

Both schedulers already select correctly (`WHERE source='external' AND is_active=1` — no id
parsing, confirmed to need no change). The bug is narrower: each reconstructs a target string as
`` `ssh:${row.name}@${row.environment}` ``, which was correct when `row.name` was the alias.
After this plan, `row.name` is the site slug — the reconstruction needs the connection alias
too, which lives in `row.account_id`.

- [ ] **Step 1: Write the failing test**

```ts
it('reconstructs the target from account_id and name, not name alone — regression pin for the multi-site case', async () => {
  const g = graph([{ id: 'ssh:hostinger-test/site-a', name: 'site-a', account_id: 'hostinger-test', environment: 'production', ssh_last_sync_at: null }]);
  (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
  const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
  await s.runCycleNow();
  expect(resolveTransport).toHaveBeenCalledWith(
    { ssh_target: 'ssh:hostinger-test/site-a@production' }, expect.anything(), 'wpcli_read');
});
```

Follow this test file's existing `graph(rows)` fixture helper and `okTransport()` mock —
extend the seeded row shape to include `account_id` rather than inventing new fixtures. Mirror
the identical test for `ExternalContentIndexScheduler`.

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/startup/ExternalRefreshScheduler.test.ts -t "account_id and name"`
Expected: FAIL — today's code calls `resolveTransport` with
`{ ssh_target: 'ssh:site-a@production' }` (missing the alias entirely, since `row.name` is now
`site-a`, not the alias).

- [ ] **Step 3: Implement**

In `src/main/startup/ExternalRefreshScheduler.ts`, update the `SELECT` to include `account_id`:

```ts
      rows = db.prepare(
        `SELECT id, name, account_id, environment, ssh_last_sync_at
         FROM sites
         WHERE source = 'external' AND is_active = 1`
      ).all();
```

and update the row type annotation and the reconstruction:

```ts
    let rows: Array<{ id: string; name: string; account_id: string; environment: string | null; ssh_last_sync_at: number | null }>;
```

```ts
        const target = `ssh:${row.account_id}/${row.name}@${row.environment ?? 'production'}`;
```

Apply the identical change to `ExternalContentIndexScheduler.ts` (its `SELECT` and row type
include `content_indexed_at` instead of `ssh_last_sync_at`, otherwise the same shape).

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/startup/ -v && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/startup/ExternalRefreshScheduler.ts src/main/startup/ExternalContentIndexScheduler.ts tests/unit/startup/ExternalRefreshScheduler.test.ts tests/unit/startup/ExternalContentIndexScheduler.test.ts
git commit -m "fix(external): schedulers reconstruct targets from account_id+name, not name alone"
```

---

### Task 14: Documentation, full verification, live re-registration

**Files:**
- Modify: `CLAUDE.md` (External SSH Hosts section)
- Modify: `docs/user-guide.md` if it documents `nexus host add`/target syntax (check first)

**No new behavior in this task** beyond what re-registering the live host naturally produces.

- [ ] **Step 1: Document in CLAUDE.md**

Add to the "External SSH Hosts" section:

```markdown
- **An alias is a connection, not a site.** `ssh:<alias>` can have zero, one, or many
  WordPress installs under it — confirmed live: a single Hostinger login hosts two. Target
  syntax is `ssh:<alias>/<site>@<environment>`, mirroring `wpe:<account>/<install>@
  <environment>`. The bare `ssh:<alias>@<environment>` form is accepted as input only when the
  connection has exactly one site; every surface that PRINTS a target — `nexus_list_sites`,
  `sites list`, `host list`, error messages — always prints the full `/<site>` form, so nothing
  already scripted or agent-copied breaks the day a second site is added.
- **`account_id` links a site row back to its connection**, reusing the same generic column WP
  Engine uses for its own account→install grouping — no new table.
- **A lazy "sighting" no longer auto-registers a site.** `nexus wp core version
  ssh:newalias@production` against a connection that was never through `nexus host add` now
  fails with "no registered sites," where it previously created a phantom row with no
  discovered domain. A `sites` row means "a human, or the registration picker, named this,"
  never "something referenced this string once."
- **Registration lists every discovered WordPress install and lets the user pick which to
  register** (`nexus host add <alias>`) — the probe already found every root before this
  landed; only the registration step used to force picking exactly one.
```

- [ ] **Step 2: Full suite**

```bash
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort -u
npx tsc --noEmit && npm run build
```

Baseline: **12 failing suites (same names as this plan's header), 3782 passing before this
plan's work began.** Compare failing suite **names**.

- [ ] **Step 3: Live re-registration and verification**

`hostinger-test` is re-registered from scratch under the new flow, per the plan's "no migration"
decision:

```bash
npm run rebuild && ./dev-reload.sh
node bin/nexus.js host remove hostinger-test -y
node bin/nexus.js host add hostinger-test
```

The `add` command should show the two-site picker (`mediumslateblue-hyena-983322...` and
`palegreen-capybara-114180...`). Select both.

```bash
node bin/nexus.js host list
node bin/nexus.js sites list
node bin/nexus.js fleet site-health ssh:hostinger-test/mediumslateblue-hyena@production
node bin/nexus.js content search ssh:hostinger-test/mediumslateblue-hyena@production "power"
node bin/nexus.js host refresh hostinger-test
```

Expected: both sites appear in `host list` and `sites list` with distinct, correct domains;
health and content search resolve via the `/<site>` form; `host refresh` (bare alias) refreshes
both and reports two per-site results. **If anything resolves to the wrong site's data, or the
bare `ssh:hostinger-test@production` form silently picks one instead of erroring, that is a
finding — report it, do not adjust the expectation to match.**

Confirm the disambiguation error fires correctly:

```bash
node bin/nexus.js fleet site-health ssh:hostinger-test@production
```

Expected: an error naming both sites, not a score for either one.

Leave the repo rebuilt for **Electron**, since Local is the live running app, and say so
explicitly at the end of the report so the next person knows to run `npm rebuild better-sqlite3`
before running jest again.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/user-guide.md
git commit -m "docs(external): ssh: is a connection, not a site"
```

---

## Self-Review

**Spec coverage.** §3 (target grammar) → Task 2. §4 (storage, `account_id` reuse) → Tasks 3, 5,
8. §5.1 (`find -L`) → Task 1. §5.2 (registration picker) → Task 8. §6 (target parsing) → Task 2.
§7 (`resolveTransport` security rework) → Task 6. §8 (sighting behavior change) → Task 7. §9
(removal) → Task 9. §10 (no migration) → Task 14's live re-registration. §11 (consumer
inventory) → Tasks 6, 7, 11, 12, 13, plus Task 4's `queryQualifiedTarget` fix, which the spec's
own inventory missed and this plan found by reading every consumer of the function the spec
*did* name (`resolveAnySite`). No spec requirement is without a task.

**Placeholders.** None — every code step contains complete, real code derived from the actual
current source, not a sketch. Two steps (Task 6 Step 3's schema-column check, Task 11 Step 4's
"read the dormant file before pasting") explicitly instruct verifying against live state rather
than assuming — that is a deliberate instruction to check reality, not a deferred decision, and
both name exactly what to check.

**Type consistency.** `findExternalSites(db, alias, site?, columns?)` has the identical
signature everywhere it's introduced (Task 3) and consumed (Tasks 4, 6, 7, 8, 9, 10, 11, 12).
`externalSiteId(alias, site)` (Task 5) is consumed with two arguments everywhere it's called
after that task (Task 8). `ExternalConnectionProfile` (Task 5) replaces `ExternalSiteProfile`
consistently in every later task that touches `externalSiteStore.ts`'s exports. The GraphQL
`NexusHostRefreshResult`/`NexusHostIndexResult` list-shape change (Task 10) and
`NexusHostEntry.sites` (Task 12) are introduced and consumed within their own tasks, not split
across a boundary where a mismatch could hide.

**One risk carried forward from the spec, restated for whoever executes this:** Task 6 is the
highest-consequence task in the plan — a mistake there reopens an environment-downgrade bug this
codebase's own comments record having fixed once already. Its test list is deliberately
adversarial, not just happy-path, and should not be trimmed under time pressure.
