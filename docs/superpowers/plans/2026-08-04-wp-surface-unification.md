# WP Surface Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `wp` surface one implementation reached by two front doors, so CLI and MCP are equivalent by construction — with external SSH host support falling out as a consequence.

**Architecture:** `nexusWpCommand` keeps its GraphQL signature and loses its body, delegating to `resolveTransport` through a new target-string→args mapper. The two remote command policies collapse into one blocklist-only policy. The four local-only `wp` tools move onto `resolveTransport`. `ssh_target` becomes discoverable on the tool schemas.

**Tech Stack:** TypeScript, Jest, GraphQL (internal transport), Commander (CLI), Node `child_process`.

**Spec:** `docs/superpowers/specs/2026-08-04-wp-surface-unification-design.md`
**Evidence:** `docs/wp-cli-surface-matrix.md`, `docs/cli-mcp-equivalence-inventory.md`

**Branch:** `feat/non-wpe-host-support`, already checked out. Do not create or switch branches. Do not merge to main.

## Global Constraints

- **`auditDirectOperation` must survive the migration on both success and failure paths.** `nexusWpCommand` audits today as `cli.wp.command`; CLAUDE.md lists it as covered. `resolveTransport` does **not** audit — it is pure resolution, and `ToolRegistry.call()`'s chokepoint is not in this path. Dropping these calls silently empties part of the compliance record, which is the exact bug CLAUDE.md's audit section exists to prevent.
- **No capability regression on Local or WP Engine.** This is why the policy unifies downward (§2 of the spec). Measured: unifying upward breaks 8 of 17 commands.
- **`src/main/transport/ssh-args.ts` stays the only place an SSH invocation is constructed.**
- **Nexus never writes to a user's server** — no upload, no remote installer, no `ssh-copy-id`.
- **No SSH key material is stored anywhere.**
- **`resolveTransport` is the only router.** After Task 4, no resolver may hand-roll target resolution, a command blocklist, or a permission gate.
- **`classifyWpCliOp` fails closed to `wpcli`** (write) for unknown commands. Never invert that default.
- **`wpeAllowedEnvironments` is dead code** (`mcp/utils/environment-filter.ts`, zero callers). Do not cite it as a protection or wire it up here.
- `npm test` baseline: **12 failed suites / 22–23 failed tests**, all pre-existing native-module failures. One test is flaky between runs, hence the range. Compare failing suite **names**, not counts. If jest fails wholesale with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3` first (never `npm run rebuild`, which is the Electron build).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/main/transport/policy.ts` | **Modify.** One `REMOTE_POLICY`; delete `MCP_REMOTE_POLICY` and `GRAPHQL_REMOTE_POLICY`. |
| `src/main/transport/resolveTargetArgs.ts` | **New.** Target string → transport args. Owns the bare-name→WPE fallback. |
| `src/main/transport/classify.ts` | **New.** `classifyWpCliOp`, moved out of the resolver so both surfaces share it. |
| `src/main/transport/LocalTransport.ts` | **Modify.** Refuse on a stopped site with the existing message. |
| `src/main/transport/resolve.ts` | **Modify.** Use `REMOTE_POLICY`. |
| `src/main/graphql/resolvers.ts` | **Modify.** `nexusWpCommand` delegates; delete its router, blocklist and gates. |
| `src/main/mcp/modules/wp-cli/*.ts` | **Modify.** Declare `ssh_target`/`wp_path` on 15 tools; port 4 tools onto `resolveTransport`. |
| `tests/unit/transport/resolve-target-args.test.ts` | **New.** Mapper, incl. the fallback. |
| `tests/unit/transport/policy.test.ts` | **Modify.** Unified policy. |
| `tests/unit/transport/surface-equivalence.test.ts` | **New.** The regression matrix. |

---

## Task 1: One remote command policy

**Files:**
- Modify: `src/main/transport/policy.ts:23-69`, `src/main/transport/resolve.ts:6,87`
- Test: `tests/unit/transport/policy.test.ts`

**Interfaces:**
- Produces: `REMOTE_POLICY: CommandPolicy`. `MCP_REMOTE_POLICY`, `GRAPHQL_REMOTE_POLICY` and `EXTERNAL_REMOTE_POLICY` cease to exist as separate names.

- [ ] **Step 1: Write the failing tests**

Replace the policy-identity tests in `tests/unit/transport/policy.test.ts` with:

```ts
import { REMOTE_POLICY, checkCommand } from '../../../src/main/transport/policy';

describe('REMOTE_POLICY — one policy for every remote target', () => {
  it('blocks exactly the five arbitrary-code commands', () => {
    for (const cmd of [['eval','x'], ['eval-file','x'], ['shell'], ['db','query','SELECT 1'], ['db','cli']]) {
      expect(checkCommand(cmd, REMOTE_POLICY)).not.toBeNull();
    }
  });

  it('has no whitelist — an unlisted command is permitted', () => {
    expect(REMOTE_POLICY.allowed).toBeUndefined();
    expect(checkCommand(['cron','event','list'], REMOTE_POLICY)).toBeNull();
  });

  // The five tools MCP_REMOTE_POLICY's whitelist made permanently dead on WPE.
  it.each([
    ['core update',    ['core','update']],
    ['theme activate', ['theme','activate','twentytwentyfour']],
    ['post create',    ['post','create','--post_title=x']],
    ['post update',    ['post','update','12']],
    ['post delete',    ['post','delete','12']],
  ])('permits %s, which the old whitelist refused', (_label, cmd) => {
    expect(checkCommand(cmd as string[], REMOTE_POLICY)).toBeNull();
  });

  // The eight CLI commands that unifying UPWARD would have broken.
  it.each([
    [['theme','activate','x']], [['core','update']], [['db','export']],
    [['db','import','f.sql']], [['search-replace','a','b']],
    [['post','create']], [['post','update','1']], [['post','delete','1']],
  ])('keeps CLI command %j working on WP Engine', (cmd) => {
    expect(checkCommand(cmd as string[], REMOTE_POLICY)).toBeNull();
  });
});
```

Delete any test asserting `MCP_REMOTE_POLICY.allowed` has 14 entries — that behaviour is being removed on purpose.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/transport/policy.test.ts
```
Expected: FAIL — `REMOTE_POLICY` is not exported.

- [ ] **Step 3: Implement**

In `policy.ts`, replace `MCP_REMOTE_POLICY`, `GRAPHQL_REMOTE_POLICY` and `EXTERNAL_REMOTE_POLICY` with one constant. Replace the file's opening docblock too — it currently documents a divergence that no longer exists:

```ts
/**
 * Command policy for remote execution — ONE policy for every remote target.
 *
 * This was three constants: MCP's 14-command whitelist plus blocklist, a
 * GraphQL blocklist with no consumers, and a blocklist-only external policy.
 * They are unified here on blocklist-only. Two reasons, both measured:
 *
 *  - Unifying UPWARD onto the whitelist would break 8 of the 17 CLI commands
 *    on WP Engine (theme activate, core update, db export, db import,
 *    search-replace, post create/update/delete). That is a capability
 *    regression for existing users.
 *  - The whitelist protected less than it appeared to. No MCP tool accepts an
 *    arbitrary command array — every tool emits a fixed command shape, and the
 *    one free-form tool (wp_eval) is in the blocklist below. So removing the
 *    whitelist grants agents exactly five tools (core update, theme activate,
 *    post create/update/delete) — capabilities a human at the CLI already had.
 *
 * IF A FUTURE MCP TOOL EVER ACCEPTS A FREE-FORM COMMAND ARRAY, that second
 * reason dies and the whitelist question must be reopened.
 *
 * What still protects production is the permission gate, not this list:
 * wpcli/push are refused on production and delete is refused everywhere
 * (DEFAULT_OPERATION_PERMISSIONS, mcp/utils/operation-permissions.ts).
 */
export const REMOTE_POLICY: CommandPolicy = {
  blocked: ['eval', 'eval-file', 'shell', 'db query', 'db cli'],
};
```

In `resolve.ts`, update the import on line 6 and the two `withPolicy` call sites to use `REMOTE_POLICY`. The comment at line 85 about "MCP's whitelist applied HERE" is now wrong — replace it with a note that every remote target gets the same policy.

- [ ] **Step 4: Run tests**

```bash
npm rebuild better-sqlite3
npx jest tests/unit/transport/ && npx tsc --noEmit
```
Expected: PASS, clean typecheck. `grep -rn "MCP_REMOTE_POLICY\|GRAPHQL_REMOTE_POLICY" src/` must return nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/policy.ts src/main/transport/resolve.ts tests/unit/transport/policy.test.ts
git commit -m "feat(transport): one remote command policy, blocklist only"
```

---

## Task 2: The target-string mapper and the op classifier

**Files:**
- Create: `src/main/transport/resolveTargetArgs.ts`, `src/main/transport/classify.ts`
- Modify: `src/main/graphql/resolvers.ts:40-56` — delete the local copies, import from `classify.ts`
- Test: `tests/unit/transport/resolve-target-args.test.ts`

**Interfaces:**
- Produces: `resolveTargetArgs(target: string, services: NexusServices): Record<string, unknown>`; `classifyWpCliOp(command: string[]): 'wpcli_read' | 'wpcli'`

**This task carries the migration's one genuine hazard.** `nexusWpCommand` has a bare-name fallback (`resolvers.ts:1666`): when a plain name is not a Local site, it queries the graph DB for an active WPE install of that name and switches to the remote path. `resolveTarget` does **not** do this — it keys off *which argument* was supplied. Lose the fallback and `nexus wp core version my-wpe-install` silently stops working.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/transport/resolve-target-args.test.ts`:

```ts
import { resolveTargetArgs } from '../../../src/main/transport/resolveTargetArgs';
import { classifyWpCliOp } from '../../../src/main/transport/classify';

function services(opts: { localSites?: string[]; wpeInstalls?: string[] } = {}) {
  const sites = Object.fromEntries((opts.localSites ?? []).map((n) => [n, { id: `id-${n}`, name: n }]));
  return {
    siteData: { getSites: () => sites, getSite: (id: string) => (sites as any)[id] ?? null },
    graphService: {
      getDb: () => ({
        prepare: () => ({
          get: (name: string) =>
            (opts.wpeInstalls ?? []).map((s) => s.toLowerCase()).includes(name)
              ? { name: (opts.wpeInstalls ?? []).find((s) => s.toLowerCase() === name) }
              : undefined,
        }),
      }),
    },
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  } as any;
}

describe('resolveTargetArgs', () => {
  it('maps an ssh: target to ssh_target', () => {
    expect(resolveTargetArgs('ssh:box@production', services()))
      .toEqual({ ssh_target: 'ssh:box@production' });
  });

  it('maps a wpe: target to install_name, keeping only the install portion', () => {
    expect(resolveTargetArgs('wpe:acct/myinstall@production', services()))
      .toEqual({ install_name: 'myinstall' });
  });

  it('maps an explicit @local target to site', () => {
    expect(resolveTargetArgs('mysite@local', services({ localSites: ['mysite'] })))
      .toEqual({ site: 'mysite' });
  });

  it('maps a bare name that IS a local site to site', () => {
    expect(resolveTargetArgs('mysite', services({ localSites: ['mysite'] })))
      .toEqual({ site: 'mysite' });
  });

  // THE HAZARD. Deleting the fallback must fail this test.
  it('maps a bare name that is NOT local but IS a WPE install to install_name', () => {
    expect(resolveTargetArgs('myinstall', services({ wpeInstalls: ['myinstall'] })))
      .toEqual({ install_name: 'myinstall' });
  });

  it('is case-insensitive on the WPE fallback lookup', () => {
    expect(resolveTargetArgs('MyInstall', services({ wpeInstalls: ['myinstall'] })))
      .toEqual({ install_name: 'myinstall' });
  });

  it('prefers a local site over a WPE install of the same name', () => {
    expect(resolveTargetArgs('clash', services({ localSites: ['clash'], wpeInstalls: ['clash'] })))
      .toEqual({ site: 'clash' });
  });

  it('falls back to site for an unknown bare name, so the caller reports "not found"', () => {
    expect(resolveTargetArgs('nope', services())).toEqual({ site: 'nope' });
  });

  it('does not throw when the graph DB is unavailable', () => {
    const s = services(); s.graphService = undefined;
    expect(resolveTargetArgs('nope', s)).toEqual({ site: 'nope' });
  });
});

describe('classifyWpCliOp', () => {
  it.each([
    ['plugin list'], ['plugin get'], ['theme list'], ['theme get'], ['core version'],
    ['user list'], ['user get'], ['option get'], ['site health'],
    ['post list'], ['post get'], ['post-type list'], ['db export'],
  ])('classifies %s as a read', (c) => {
    expect(classifyWpCliOp(c.split(' '))).toBe('wpcli_read');
  });

  it.each([['plugin install x'], ['core update'], ['db import f.sql'], ['post delete 1']])(
    'classifies %s as a write', (c) => {
      expect(classifyWpCliOp(c.split(' '))).toBe('wpcli');
    });

  it('fails closed to write for an unknown command', () => {
    expect(classifyWpCliOp(['cron', 'event', 'run'])).toBe('wpcli');
    expect(classifyWpCliOp([])).toBe('wpcli');
  });

  it('is case-insensitive', () => {
    expect(classifyWpCliOp(['PLUGIN', 'LIST'])).toBe('wpcli_read');
  });
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/transport/resolve-target-args.test.ts
```
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Implement**

Create `src/main/transport/classify.ts` by moving the two declarations verbatim from `resolvers.ts:40-56`, adding `.toLowerCase()` on the join so the case-insensitivity test passes:

```ts
/** Read-only WP-CLI commands — these use the wpcli_read permission (allowed on every environment by default). */
const WPCLI_READ_COMMANDS = new Set([
  'plugin list', 'plugin get',
  'theme list', 'theme get',
  'core version',
  'user list', 'user get',
  'option get',
  'site health',
  'post list', 'post get',
  'post-type list',
  'db export',
]);

/**
 * Classify arbitrary WP-CLI argv as a read or a write, for the permission gate.
 *
 * FAILS CLOSED: anything not explicitly known to be read-only is treated as a
 * write, so an unrecognised command is refused on production rather than
 * permitted. Never invert this default.
 */
export function classifyWpCliOp(command: string[]): 'wpcli_read' | 'wpcli' {
  const key = command.slice(0, 2).join(' ').toLowerCase();
  return WPCLI_READ_COMMANDS.has(key) ? 'wpcli_read' : 'wpcli';
}
```

Create `src/main/transport/resolveTargetArgs.ts`:

```ts
import { parseTarget } from '../../common/target';
import { resolveSite } from '../mcp/site-resolver';
import type { NexusServices } from '../mcp/types';

/**
 * Translate a CLI-shaped target string into the args object resolveTransport
 * consumes (`site`, `install_name`, or `ssh_target`).
 *
 * THE BARE-NAME FALLBACK IS LOAD-BEARING. `nexus wp core version my-install`
 * with no prefix is a path users rely on: when a plain name is not a Local
 * site, it is looked up in the graph DB as an active WPE install and routed
 * remotely. resolveTarget does not do this — it keys off which argument was
 * supplied — so the behaviour lives here or nowhere. Deleting it breaks that
 * command silently, with a "site not found" error rather than a clue.
 *
 * A name that matches neither returns `{ site: name }` on purpose, so the
 * caller produces the familiar "Site not found" message.
 */
export function resolveTargetArgs(
  target: string,
  services: NexusServices,
): Record<string, unknown> {
  const parsed = parseTarget(target);

  if (parsed.type === 'external') return { ssh_target: target };

  if (parsed.type === 'wpe') {
    // installName may carry an account prefix; the transport wants the install only.
    const installName = parsed.installName!.split('/').pop() || parsed.installName!;
    return { install_name: installName };
  }

  const name = parsed.siteName!;
  if (resolveSite(name, services.siteData)) return { site: name };

  try {
    const db = services.graphService?.getDb?.();
    const row = db?.prepare(
      "SELECT name FROM sites WHERE source='wpe' AND LOWER(name)=? AND is_active=1 LIMIT 1",
    ).get(name.toLowerCase()) as { name?: string } | undefined;
    if (row?.name) return { install_name: row.name };
  } catch {
    // Graph DB unavailable or mid-migration — fall through to the local path,
    // which reports "not found". A lookup failure must not throw here.
  }

  return { site: name };
}
```

- [ ] **Step 4: Delete the originals from `resolvers.ts` in the same commit**

`classifyWpCliOp` and `WPCLI_READ_COMMANDS` were moved, not copied. Delete lines 40-56 of `src/main/graphql/resolvers.ts` and add:

```ts
import { classifyWpCliOp } from '../transport/classify';
```

The resolver's existing call sites (`resolvers.ts:1697`, `:1778`) keep working unchanged — same name, same signature. Do this now rather than in Task 4, so the two copies never coexist on a commit a reviewer sees.

- [ ] **Step 5: Run tests**

```bash
npx jest tests/unit/transport/ tests/unit/graphql/ && npx tsc --noEmit
```
Expected: PASS (21 new tests), clean typecheck. `grep -c "WPCLI_READ_COMMANDS" src/main/graphql/resolvers.ts` must return 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/resolveTargetArgs.ts src/main/transport/classify.ts src/main/graphql/resolvers.ts tests/unit/transport/resolve-target-args.test.ts
git commit -m "feat(transport): target-string mapper and shared op classifier"
```

---

## Task 3: `LocalTransport` refuses on a stopped site

**Files:**
- Modify: `src/main/transport/LocalTransport.ts:22-32`
- Test: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: `services.localServices.getSiteStatus(siteId)` (existing)
- Produces: no signature change; `runWpCli` now returns `{ success: false }` with a specific message when the site is not running.

`nexusWpCommand` checks site status before running locally (`resolvers.ts:1731`) and returns `Site "x" is halted. Start it first.` `LocalTransport` does not, so Task 4 would lose that message. Putting the check in the transport means **MCP tools gain it too**, which is the equivalence this spec is for.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/transport/conformance.test.ts`:

```ts
describe('LocalTransport — stopped site', () => {
  function svc(status: string) {
    return {
      wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ran', success: true }),
      getSiteStatus: jest.fn().mockReturnValue(status),
    } as any;
  }

  it('refuses with an actionable message when the site is not running', async () => {
    const s = svc('halted');
    const t = new LocalTransport('id-1', 'mysite', s);
    const res = await t.runWpCli(['core', 'version']);
    expect(res.success).toBe(false);
    expect(res.stdout).toContain('mysite');
    expect(res.stdout).toContain('halted');
    expect(res.stdout).toMatch(/start it first/i);
    expect(s.wpCliRun).not.toHaveBeenCalled();
  });

  it('runs normally when the site is running', async () => {
    const s = svc('running');
    const res = await new LocalTransport('id-1', 'mysite', s).runWpCli(['core', 'version']);
    expect(res.success).toBe(true);
    expect(s.wpCliRun).toHaveBeenCalled();
  });

  it('runs when the host cannot report status, rather than refusing', async () => {
    const s = { wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ran', success: true }) } as any;
    const res = await new LocalTransport('id-1', 'mysite', s).runWpCli(['core', 'version']);
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npx jest tests/unit/transport/conformance.test.ts -t "stopped site"
```
Expected: FAIL — the halted case runs the command and returns success.

- [ ] **Step 3: Implement**

Replace `LocalTransport.runWpCli`, keeping the existing arity docblock intact and adding the guard above it:

```ts
  async runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult> {
    // Checked here, not at the call site: nexusWpCommand used to do this and
    // MCP tools did not, so the same request gave different errors depending on
    // which surface asked. getSiteStatus is optional on the bridge — when it is
    // absent, run rather than refuse.
    const status = this.localServices.getSiteStatus?.(this.siteId);
    if (status && status !== 'running') {
      return {
        stdout: `Site "${this.siteName}" is ${status}. Start it first.`,
        success: false,
      };
    }

    // Call with two arguments when opts is absent. Passing an explicit
    // `undefined` third argument is runtime-equivalent but arity-visible:
    // Jest's toHaveBeenCalledWith is arity-strict, and pre-existing suites
    // (tests/main/wp-cli-tools.test.ts) assert the two-argument shape that
    // callers used before the transport migration. Do not collapse this.
    return opts === undefined
      ? this.localServices.wpCliRun(this.siteId, args)
      : this.localServices.wpCliRun(this.siteId, args, opts as any);
  }
```

Check the constructor's field name for the site name; if it is not `siteName`, use whatever it is rather than adding a field.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/transport/ tests/main/wp-cli-tools.test.ts && npx tsc --noEmit
```
Expected: PASS. `wp-cli-tools.test.ts` is arity-sensitive — it must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/LocalTransport.ts tests/unit/transport/conformance.test.ts
git commit -m "feat(transport): refuse WP-CLI on a stopped local site, in one place"
```

---

## Task 4: `nexusWpCommand` delegates to `resolveTransport`

**Files:**
- Modify: `src/main/graphql/resolvers.ts:40-56` (delete the moved declarations), `:1635-1826` (the resolver body)
- Test: `tests/unit/graphql/wp-command-resolver.test.ts` (new)

**Interfaces:**
- Consumes: `resolveTargetArgs`, `classifyWpCliOp` (Task 2); `resolveTransport(args, services, operation)` (existing)
- Produces: no GraphQL signature change — `nexusWpCommand(target: String!, command: [String!]!)` returns `{ success, error, stdout, stderr, exitCode }` exactly as before.

**This is the task that does the work.** All 17 `nexusWpCommand`-backed CLI commands gain external support, and the four drift defects in the spec's §1 table disappear together.

**The audit calls must survive.** The current body calls `auditDirectOperation` on both branches with `operation: 'cli.wp.command'`. `resolveTransport` does not audit and `ToolRegistry.call()`'s chokepoint is not in this path. Keep exactly one audit call covering both outcomes.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graphql/wp-command-resolver.test.ts`:

```ts
const auditMock = jest.fn();
jest.mock('../../../src/main/audit/auditDirectOperation', () => ({
  auditDirectOperation: (...a: any[]) => auditMock(...a),
}));
const resolveTransportMock = jest.fn();
jest.mock('../../../src/main/transport', () => ({
  ...jest.requireActual('../../../src/main/transport'),
  resolveTransport: (...a: any[]) => resolveTransportMock(...a),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';

function ctx(sites: string[] = []) {
  const s = Object.fromEntries(sites.map((n) => [n, { id: `id-${n}`, name: n }]));
  return {
    services: {
      localServices: { wpCliRun: jest.fn(), isSSHKeyAvailable: () => true },
      siteData: { getSites: () => s, getSite: (i: string) => (s as any)[i] ?? null },
      graphService: { getDb: () => undefined },
      registryStorage: { get: () => ({}), set: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    },
    registry: {},
  } as any;
}
const transport = (res: any) => ({ runWpCli: jest.fn().mockResolvedValue(res) });

beforeEach(() => { auditMock.mockReset(); resolveTransportMock.mockReset(); });

describe('nexusWpCommand', () => {
  it('routes an ssh: target through resolveTransport', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: '7.0.2', success: true }));
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(r.success).toBe(true);
    expect(r.stdout).toBe('7.0.2');
    expect(resolveTransportMock).toHaveBeenCalledWith(
      { ssh_target: 'ssh:box@production' }, expect.anything(), 'wpcli_read');
  });

  it('classifies a write and passes wpcli', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'ok', success: true }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(resolveTransportMock).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'wpcli');
  });

  it('returns the resolution error instead of throwing', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked: nope' }], isError: true });
    const r = await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Operation blocked');
    expect(r.exitCode).toBe(1);
  });

  it('audits on success', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'ok', success: true }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'cli.wp.command', outcome: 'success' });
  });

  it('audits on failure', async () => {
    resolveTransportMock.mockResolvedValue(transport({ stdout: 'boom', success: false }));
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['core', 'version'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ operation: 'cli.wp.command', outcome: 'failure' });
  });

  it('audits a refused resolution too — the attempt is the record', async () => {
    resolveTransportMock.mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true });
    await createResolvers(ctx()).Mutation.nexusWpCommand(
      null, { target: 'ssh:box@production', command: ['plugin', 'install', 'x'] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][1]).toMatchObject({ outcome: 'failure' });
  });
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/graphql/wp-command-resolver.test.ts
```
Expected: FAIL — the resolver never calls `resolveTransport`; the ssh case returns the old TypeError path.

- [ ] **Step 3: Implement**

Replace the entire `nexusWpCommand` body (`resolvers.ts:1635` to just before `nexusWpPluginList` at `:1827`) with:

```ts
      nexusWpCommand: async (_parent: ResolverParent, { target, command }: { target: string; command: string[] }) => {
        return withQueue(async () => {
          // One router for every target type. This resolver used to hand-roll
          // target resolution, a command blocklist and two permission-gate
          // calls; all three now live in resolveTransport, which is why an
          // ssh: target works here at all.
          const operation = classifyWpCliOp(command);
          const audit = (outcome: 'success' | 'failure', err?: string) =>
            auditDirectOperation(services, {
              operation: 'cli.wp.command',
              target,
              parameters: { target, command },
              outcome,
              error: err,
            });

          try {
            if (!services.localServices) {
              audit('failure', 'Local services not available');
              return { success: false, error: 'Local services not available', stdout: '', stderr: '', exitCode: 1 };
            }

            const args = resolveTargetArgs(target, services);
            const transport = await resolveTransport(args, services, operation);
            if ('content' in transport) {
              const msg = (transport.content?.[0] as any)?.text ?? 'Target could not be resolved';
              audit('failure', msg);
              return { success: false, error: msg, stdout: '', stderr: '', exitCode: 1 };
            }

            const result = await transport.runWpCli(command);
            // WpCliResult carries stdout + success always, and stderr/exitCode
            // optionally (local-services-bridge.ts:17-23 — "Not always present").
            // Transports that spawn ssh fold their error text into stdout, so
            // fall back to it rather than reporting an empty failure.
            const okRun = result.success || result.exitCode === 0;
            const failText = result.stderr || result.stdout || 'Command failed';
            audit(okRun ? 'success' : 'failure', okRun ? undefined : failText);
            return {
              success: okRun,
              error: okRun ? null : failText,
              stdout: result.stdout ?? '',
              stderr: result.stderr ?? '',
              exitCode: result.exitCode ?? (okRun ? 0 : 1),
            };
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            audit('failure', msg);
            return { success: false, error: msg, stdout: '', stderr: '', exitCode: 1 };
          }
        });
      },
```

Note on the return shape, already checked so you do not have to: `WpCliResult` (`mcp/local-services-bridge.ts:17-23`) is `{ stdout: string | null; success: boolean; stderr?: string | null; exitCode?: number }` — the last two are documented "Not always present". `ExternalSshTransport` and `WpeSshTransport` fold their error text into `stdout` and set neither, which is why the mapping above falls back through `stderr → stdout → 'Command failed'` and synthesises an exit code. Preserve `okRun`'s `|| result.exitCode === 0` clause; the old body had it and some bridge paths report success only that way.

Then delete from `resolvers.ts`:
- the `blockedRemoteCommands` array and all three uses
- both `isOperationAllowed` calls that this resolver owned, and their `getEffectiveSettings` / `WPE_INSTALL_CACHE` lookups

Add imports for `resolveTargetArgs`, `classifyWpCliOp` and `resolveTransport`. Leave the three `isOperationAllowed` calls belonging to *other* resolvers alone — Task 4 owns only `nexusWpCommand`.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/graphql/ tests/unit/transport/ && npx tsc --noEmit && npm run build
```
Expected: PASS and clean. Then confirm the drift is gone:

```bash
grep -n "blockedRemoteCommands" src/main/graphql/resolvers.ts   # expect: nothing
grep -c "isOperationAllowed(" src/main/graphql/resolvers.ts      # expect: 3, down from 5
```

- [ ] **Step 5: Commit**

```bash
git add src/main/graphql/resolvers.ts tests/unit/graphql/wp-command-resolver.test.ts
git commit -m "feat(graphql): nexusWpCommand delegates to resolveTransport"
```

---

## Task 5: Declare `ssh_target` and `wp_path` on the transport-backed tools

**Files:**
- Modify: the 15 tools in `src/main/mcp/modules/wp-cli/` that call `resolveTransport`
- Test: `tests/unit/mcp/tool-schemas.test.ts` (new)

**Interfaces:**
- Produces: no code change — `inputSchema.properties` gains two documented keys on 15 tools.

The capability already works: `resolveTransport` reads `args.ssh_target` first, and `McpServer.ts:303` passes `params.arguments` through with no schema validation and no stripping of unknown keys. Only discovery is missing.

The 15 tools: `wp_core_version`, `wp_core_update`, `wp_option_get`, `wp_plugin_list`, `wp_plugin_install`, `wp_plugin_activate`, `wp_plugin_deactivate`, `wp_plugin_update`, `wp_theme_list`, `wp_theme_activate`, `wp_user_list`, `wp_post_create`, `wp_post_update`, `wp_post_delete`, `wp_eval`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/tool-schemas.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '../../../src/main/mcp/modules/wp-cli');

/** Tools that route through resolveTransport must advertise ssh_target. */
function transportBackedFiles(): string[] {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !['index.ts', 'preflight.ts', 'remote-exec.ts', 'twin-fallback.ts'].includes(f))
    .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').includes('resolveTransport'));
}

describe('transport-backed tool schemas', () => {
  const files = transportBackedFiles();

  // Deliberately a floor, not an equality. Tasks 6-8 port four more tools onto
  // resolveTransport, which would break `toBe(15)` — and the rule this test
  // encodes is "every transport-backed tool advertises ssh_target", which must
  // keep holding as tools are added, not stop at a snapshot.
  it('finds at least the 15 transport-backed tools known today', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('%s declares ssh_target and wp_path', (f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    expect(src).toContain('ssh_target:');
    expect(src).toContain('wp_path:');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npx jest tests/unit/mcp/tool-schemas.test.ts
```
Expected: FAIL — 15 files lack both keys.

- [ ] **Step 3: Implement**

In each of the 15 files, add these two properties to `inputSchema.properties`, beside `site` and `install_name`:

```ts
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
```

Also extend each tool's `description` so an agent knows the third target type exists. For example `wp_core_version`'s currently reads "Works on local sites (site=) and remote WPE installs via SSH (install_name=)" — make it "…and external SSH hosts (ssh_target=)".

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/mcp/ && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wp-cli/ tests/unit/mcp/tool-schemas.test.ts
git commit -m "feat(mcp): declare ssh_target and wp_path on transport-backed tools"
```

---

## Task 6: Port `wp_site_health` onto `resolveTransport`

**Files:**
- Modify: `src/main/mcp/modules/wp-cli/site-health.ts`
- Test: `tests/unit/transport/conformance.test.ts` or the suite that already covers this tool

**Interfaces:**
- Consumes: `resolveTransport(args, services, 'wpcli_read')`
- Produces: `wp_site_health` accepting `site`, `install_name` or `ssh_target`

This is why `nexus wp health ssh:<alias>@production` fails today with `Site "undefined" not found.` — the tool calls `resolveSite`, ignores `ssh_target`, and the CLI tries it before the GraphQL fallback.

- [ ] **Step 1: Write the failing test**

Add to the tool's existing test file (or create `tests/unit/mcp/site-health-remote.test.ts`):

```ts
it('runs against an external SSH host instead of reporting "site not found"', async () => {
  const runWpCli = jest.fn().mockResolvedValue({ stdout: '7.0.2', success: true });
  jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue({ runWpCli } as any);
  const res = await siteHealthHandler.execute({ ssh_target: 'ssh:box@production' }, servicesMock);
  expect(res.isError).toBeFalsy();
  expect(JSON.stringify(res)).not.toContain('not found');
  expect(runWpCli).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify it fails**

Expected: FAIL with `Site "undefined" not found.`

- [ ] **Step 3: Implement**

Replace the `resolveSite` + `services.localServices!` pair with `resolveTransport(args, services, 'wpcli_read')`, returning the resolution result unchanged when `'content' in transport`. Each `wpCli.wpCliRun(site.id, [...])` becomes `transport.runWpCli([...])`.

Two things to preserve:
- `withSiteRunning` currently wraps the work. It takes a **local site id**, so it cannot apply to a remote target. Keep it on the local path only; skip it when the transport is not local (`transport.kind !== 'local'`).
- Update the description: it says "LOCAL SITES ONLY — use nexus_site_audit or wp_plugin_list for remote WPE installs." That stops being true.


**Also declare `ssh_target` and `wp_path` on this tool's `inputSchema`**, using the exact property blocks from Task 5. `tests/unit/mcp/tool-schemas.test.ts` discovers transport-backed tools dynamically, so porting a tool without adding the keys turns that suite red — which is the test doing its job.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/mcp/ tests/unit/transport/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wp-cli/site-health.ts tests/
git commit -m "feat(mcp): wp_site_health works on remote and external targets"
```

---

## Task 7: Port `wp_search_replace` onto `resolveTransport`

**Files:**
- Modify: `src/main/mcp/modules/wp-cli/search-replace.ts`
- Test: alongside the tool's existing tests

**Interfaces:**
- Consumes: `resolveTransport(args, services, 'wpcli')` — this is a write
- Produces: `wp_search_replace` accepting `site`, `install_name` or `ssh_target`

Argv-shaped and should port cleanly. It is also the most valuable of the four on a remote host: search-replace is how a domain migration is done.

- [ ] **Step 1: Write the failing test**

```ts
it('runs against an external SSH host', async () => {
  const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Made 3 replacements.', success: true });
  jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue({ runWpCli } as any);
  const res = await searchReplaceHandler.execute(
    { ssh_target: 'ssh:box@production', search: 'old.test', replace: 'new.test' }, servicesMock);
  expect(res.isError).toBeFalsy();
  expect(runWpCli.mock.calls[0][0]).toEqual(
    expect.arrayContaining(['search-replace', 'old.test', 'new.test']));
});

it('resolves as a write, so it is refused on production by default', async () => {
  const spy = jest.spyOn(transportModule, 'resolveTransport')
    .mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true } as any);
  await searchReplaceHandler.execute(
    { ssh_target: 'ssh:box@production', search: 'a', replace: 'b' }, servicesMock);
  expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'wpcli');
});
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

Swap `resolveSite`/`localServices` for `resolveTransport(args, services, 'wpcli')` and `transport.runWpCli([...])`. Keep any `--dry-run` default exactly as it is — do not change destructive-operation defaults in a refactor.


**Also declare `ssh_target` and `wp_path` on this tool's `inputSchema`**, using the exact property blocks from Task 5. `tests/unit/mcp/tool-schemas.test.ts` discovers transport-backed tools dynamically, so porting a tool without adding the keys turns that suite red — which is the test doing its job.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/mcp/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wp-cli/search-replace.ts tests/
git commit -m "feat(mcp): wp_search_replace works on remote and external targets"
```

---

## Task 8: `wp_db_export` and `wp_import_database`

**Files:**
- Modify: `src/main/mcp/modules/wp-cli/db-export.ts`, `src/main/mcp/modules/wp-cli/import-database.ts`

**Interfaces:**
- Consumes: `resolveTransport(args, services, 'wpcli_read')` for export, `'wpcli'` for import

**Read this before starting.** These two move files, and over SSH that means deciding where a dump lands and how it is transferred. The spec says explicitly: **if this is more than a target swap, stop and report `DONE_WITH_CONCERNS` with what you found, and leave the port unimplemented.** A file-transfer design does not belong in this plan and must not be improvised here.

- [ ] **Step 1: Determine which case you are in**

Read both tools. Answer in your report:
- Does the tool write to a path on the machine running Nexus, or ask WP-CLI to write on the target?
- For a remote target, would the dump land on the remote host with no way back?

If the answer is that a remote export leaves the file stranded on the remote host, that is the "more than a target swap" case. Stop and report.

- [ ] **Step 2: If it is a simple swap, write the failing test**

```ts
it('exports from an external SSH host', async () => {
  const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Exported to dump.sql', success: true });
  jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue({ runWpCli } as any);
  const res = await dbExportHandler.execute({ ssh_target: 'ssh:box@production' }, servicesMock);
  expect(res.isError).toBeFalsy();
  expect(runWpCli.mock.calls[0][0][0]).toBe('db');
});
```

- [ ] **Step 3: Implement, or report**

Port exactly as Tasks 6 and 7 did, or report `DONE_WITH_CONCERNS` with your Step 1 findings and change nothing.

**If you do port either tool, also declare `ssh_target` and `wp_path` on its `inputSchema`**, using the exact property blocks from Task 5. `tests/unit/mcp/tool-schemas.test.ts` discovers transport-backed tools dynamically, so porting a tool without adding the keys turns that suite red — which is the test doing its job.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/mcp/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/wp-cli/ tests/
git commit -m "feat(mcp): wp_db_export and wp_import_database reach remote targets"
```

---

## Task 9: The surface-equivalence regression matrix

**Files:**
- Create: `tests/unit/transport/surface-equivalence.test.ts`

**Interfaces:**
- Consumes: `resolveTargetArgs`, `classifyWpCliOp`, `REMOTE_POLICY`, `checkCommand`

This is the test that makes the spec's success criterion mean something, and the one that will catch the next drift. It asserts that a command's allow/refuse outcome depends on the *target and the command*, never on *which surface asked*.

- [ ] **Step 1: Write the test**

```ts
import { REMOTE_POLICY, checkCommand } from '../../../src/main/transport/policy';
import { classifyWpCliOp } from '../../../src/main/transport/classify';
import { isOperationAllowed, DEFAULT_OPERATION_PERMISSIONS } from '../../../src/main/mcp/utils/operation-permissions';

/** Every argv shape the CLI sends, from docs/wp-cli-surface-matrix.md §2. */
const CLI_COMMANDS: string[][] = [
  ['plugin','list'], ['plugin','install','x'], ['plugin','activate','x'],
  ['plugin','deactivate','x'], ['plugin','update','x'],
  ['theme','list'], ['theme','activate','x'],
  ['core','version'], ['core','update'],
  ['db','export'], ['db','import','f.sql'],
  ['search-replace','a','b'],
  ['post','create'], ['post','update','1'], ['post','delete','1'],
  ['user','list'], ['option','get','siteurl'], ['site','health'],
];

describe('surface equivalence', () => {
  it('no CLI command is blocked by the unified policy', () => {
    const blocked = CLI_COMMANDS.filter((c) => checkCommand(c, REMOTE_POLICY) !== null);
    expect(blocked).toEqual([]);
  });

  it('the arbitrary-code commands are blocked for every surface', () => {
    for (const c of [['eval','x'], ['eval-file','f'], ['shell'], ['db','query','x'], ['db','cli']]) {
      expect(checkCommand(c, REMOTE_POLICY)).not.toBeNull();
    }
  });

  it.each(CLI_COMMANDS)('classifies %j identically regardless of caller', (...c) => {
    const cmd = c as string[];
    expect(classifyWpCliOp(cmd)).toBe(classifyWpCliOp([...cmd]));
    expect(['wpcli', 'wpcli_read']).toContain(classifyWpCliOp(cmd));
  });

  it('refuses every write on production and permits every read', () => {
    const settings = { remoteOperationPermissions: DEFAULT_OPERATION_PERMISSIONS } as any;
    for (const cmd of CLI_COMMANDS) {
      const op = classifyWpCliOp(cmd);
      const allowed = isOperationAllowed(op, 'production', settings, 'wpe:x');
      expect(allowed).toBe(op === 'wpcli_read');
    }
  });

  it('permits reads and writes on staging', () => {
    const settings = { remoteOperationPermissions: DEFAULT_OPERATION_PERMISSIONS } as any;
    for (const cmd of CLI_COMMANDS) {
      expect(isOperationAllowed(classifyWpCliOp(cmd), 'staging', settings, 'wpe:x')).toBe(true);
    }
  });
});
```

Check the real export names of `isOperationAllowed` and `DEFAULT_OPERATION_PERMISSIONS` and the exact `settings` shape before writing — `getEffectiveSettings` may be the intended entry point. Adapt the fixture to what the module actually takes rather than adding a shim.

- [ ] **Step 2: Run it**

```bash
npx jest tests/unit/transport/surface-equivalence.test.ts
```
Expected: PASS. If the production assertion fails, the gate defaults changed and that is a finding — report it rather than relaxing the test.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/transport/surface-equivalence.test.ts
git commit -m "test(transport): surface-equivalence regression matrix"
```

---

## Task 10: Documentation and live verification

**Files:**
- Modify: `CLAUDE.md`, `docs/wp-cli-surface-matrix.md`, `docs/wp-cli-surface-matrix.html`, `docs/user-guide.md`

**This task is not done until the live run passes.** Everything above was tested against fakes.

- [ ] **Step 1: Full suite against the baseline**

```bash
npm rebuild better-sqlite3
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq
```
Expected: the same **12 failing suite names** as the baseline. Counts of 22 or 23 failures are both baseline — one test is flaky. Compare names.

- [ ] **Step 2: Update the surface matrix**

Both the `.md` and the `.html`. The CLI table's "Reaches external?" column becomes yes for every command that now routes through `resolveTransport`; the MCP table's local-only rows change for the tools ported in Tasks 6–8. Update the summary cards in the HTML. §4's limits table collapses to one policy row.

- [ ] **Step 3: Update CLAUDE.md**

The "External SSH Hosts" section says only four of 22 commands reach an external host and that three are read-only. Replace with the post-migration reality. Add to the same section:

```markdown
- **One router, one policy.** `resolveTransport` is the only place a target is
  resolved and a remote command policy applied. `nexusWpCommand` delegates to it
  via `resolveTargetArgs`. Do not add target resolution, a command blocklist or
  an `isOperationAllowed` call to a resolver — that is the drift this
  unification removed, and it is how the CLI and MCP surfaces diverged before.
- **`resolveTargetArgs` owns the bare-name → WPE fallback.** `nexus wp core
  version my-install` with no prefix depends on it. `resolveTarget` does not do
  this; it keys off which argument was supplied.
- **`resolveTransport` does not audit.** `nexusWpCommand` must keep calling
  `auditDirectOperation` itself, on both outcomes.
```

- [ ] **Step 4: Rebuild for Local and reload**

```bash
npm run rebuild
./dev-reload.sh
```

`npm test` compiles better-sqlite3 for system Node; Local needs the Electron binary. Run the suite *before* this step, not after.

- [ ] **Step 5: Live verification**

Against the registered Hostinger host. The first command is the headline — it fails today with a raw TypeError:

```bash
node bin/nexus.js wp option-get ssh:hostinger-test@production siteurl
node bin/nexus.js wp theme list ssh:hostinger-test@production
node bin/nexus.js wp user-list ssh:hostinger-test@production
node bin/nexus.js wp health ssh:hostinger-test@production
node bin/nexus.js wp core version ssh:hostinger-test@production
```

Then confirm the gate still fires on a write against a production-registered host — safe, because the slug does not exist:

```bash
node bin/nexus.js wp plugin update ssh:hostinger-test@development definitely-not-a-plugin
```
Expected: refused, naming `production` as the registered label.

And confirm no regression on Local — pick any running Local site:

```bash
node bin/nexus.js wp core version <local-site>
node bin/nexus.js wp plugin list <local-site>
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: wp surface is unified — one router, one policy"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 unify on blocklist-only; delete the whitelist | 1 |
| §2 comment recording when the reasoning dies | 1 (docblock) |
| §3 `nexusWpCommand` delegates | 4 |
| §3 the mapper, incl. the bare-name fallback | 2 |
| §3 `classifyWpCliOp` moves to the transport layer | 2 |
| §3 deletions (branches, blocklist, gates) | 4 step 3 |
| §3 stopped-site check must survive | 3 |
| §4 declare `ssh_target`/`wp_path` | 5 |
| §5 port `wp_site_health` | 6 |
| §5 port `wp_search_replace` | 7 |
| §5 the two db tools, with the split escape hatch | 8 |
| §7 regression matrix | 9 |
| §7 mapper tests, fallback the critical case | 2 |
| §7 equivalence tests | 9 |
| §7 five resurrected tools | 1 |
| §7 stopped local site | 3 |
| §7 live verification | 10 |
| §8 risk 1 bare-name fallback | 2 (named, tested) |
| §8 risk 2 stopped-site check | 3 |
| §8 risk 3 loosening comment | 1 |
| §8 risk 5 scope creep via §5 | 8 step 1 |

**Global constraint not in the spec but added here:** the audit calls. `nexusWpCommand` audits as `cli.wp.command` today and `resolveTransport` does not audit, so the migration could silently empty part of the compliance record. Task 4 has three tests for it. This is the plan's most important addition to the spec.

**Placeholder scan:** none. Facts verified against source while writing rather than recalled: 15 transport-backed tools (Task 5's test asserts exactly that number), `isOperationAllowed` appears 5 times in `resolvers.ts` today (Task 4 expects 3 after), `nexusWpPluginList` begins at `:1827` so that is where `nexusWpCommand` ends, and `WpCliResult`'s real shape (Task 4). Two places still tell the implementer to check rather than trust — `LocalTransport`'s site-name field in Task 3 and the `isOperationAllowed` fixture shape in Task 9 — because both are cheap to confirm and expensive to get wrong.

**Type consistency:** `resolveTargetArgs` returns `Record<string, unknown>` in Task 2 and is consumed as such in Task 4. `classifyWpCliOp` returns `'wpcli_read' | 'wpcli'`, matching `resolveTransport`'s third parameter. `REMOTE_POLICY` is the only policy name after Task 1, used in Tasks 1 and 9.
