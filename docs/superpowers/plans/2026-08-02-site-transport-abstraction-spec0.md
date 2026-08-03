# Site Transport Abstraction (Spec 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five ad-hoc WP-CLI execution paths and three duplicate target parsers with a single `SiteTransport` abstraction and one shared parser, changing no observable behavior.

**Architecture:** A `SiteTransport` interface (`runWpCli`, `deleteRemoteFile`, `supports`, `probe`) with two implementations — `LocalTransport` wrapping Local's `wpCliRun`, and `WpeSshTransport` wrapping the existing SSH shell-out. A separate policy layer wraps any transport and receives each caller's *current* guard rules as a parameter, so the existing MCP/GraphQL divergence is preserved rather than accidentally unified. Target parsing collapses into `src/common/target.ts`.

**Tech Stack:** TypeScript, Node 22.16, Jest + ts-jest, Electron 42.2.0 (runtime only), `child_process.spawn` for SSH.

**Spec:** `docs/superpowers/specs/2026-08-02-site-transport-abstraction-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Zero behavior change.** No task may alter the command sent to a remote host, the shape of any returned result, or any user-visible error text. Where two callers currently behave differently, preserve both.
- **Never `git push`, `npm version`, or `git tag`.** Commit locally only. This overrides any instinct to "finish" the work.
- **Tests run against the system-Node build of `better-sqlite3`.** Run `npm install` before testing; `npm run rebuild` only before loading in Local. Never interleave the two in one session.
- **Do not change `better-sqlite3` from 12.11.1.**
- **Preserve exactly:** the 35 000 ms SSH timeout; `ControlMaster=auto` / `ControlPath=/tmp/ssh-nexus-%C` / `ControlPersist=30s` multiplexing; resolve-never-reject semantics on both SSH functions; Sentinel's 300-character error truncation; the deliberate WP-CLI bypass for `rm`.
- **Explicitly out of scope** (the spec justifies each): unifying MCP vs GraphQL command policy; fixing the five MCP tools with unreachable remote paths; the ~25 ad-hoc `target.endsWith('@local')` CLI checks; deleting `environment-filter.ts`; validating `installName` from the renderer.
- **Two SSH result shapes differ on failure and must stay different.** `remoteWpCliRun` returns `stderr || 'SSH exited with code N'`; `remoteSshRaw` returns `stdout || stderr`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/common/target.ts` | The single `parseTarget` + `requireLocalTarget` / `requireWpeTarget` / `formatTarget` |
| `src/main/transport/types.ts` | `SiteTransport`, `TransportKind`, `Capability`, `SiteRef`, `RunOpts`, `ProbeResult`, `DeleteResult` |
| `src/main/transport/ssh-args.ts` | Pure SSH argv/command builders extracted from the two duplicates |
| `src/main/transport/WpeSshTransport.ts` | SSH transport for WPE installs |
| `src/main/transport/LocalTransport.ts` | Transport for Local sites |
| `src/main/transport/policy.ts` | Guard layer wrapping any transport; takes rules as a parameter |
| `src/main/transport/resolve.ts` | `resolveTransport(args, services, operation)` |
| `src/main/transport/index.ts` | Barrel export |

**Modified:** `src/cli/utils/target.ts`, `src/main/graphql/resolver-utils.ts`, `src/main/graphql/resolvers.ts`, `src/main/mcp/local-services-bridge.ts`, `src/main/sentinel/SentinelExecutor.ts`, the 15 tool files in `src/main/mcp/modules/wp-cli/`, and ~6 direct callers.

**Tests created:** `tests/unit/transport/ssh-argv-characterization.test.ts`, `tests/unit/sentinel/sentinel-executor.test.ts`, `tests/unit/common/target.test.ts`, `tests/unit/transport/ssh-args.test.ts`, `tests/unit/transport/conformance.test.ts`, `tests/unit/transport/tool-dispatch.test.ts`.

---

### Task 1: Baseline and golden-argv characterization

Pins the exact `spawn('ssh', …)` argv of both duplicated SSH implementations **before** anything moves. If the argv is byte-identical after the refactor, SSH behavior is identical by construction.

**Files:**
- Create: `tests/unit/transport/ssh-argv-characterization.test.ts`
- Read only (do not modify): `src/main/mcp/local-services-bridge.ts:831`, `src/main/sentinel/SentinelExecutor.ts:19`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the exported constant `SHARED_SSH_OPTS` used again in Task 5's test

- [ ] **Step 1: Record the pre-existing test baseline**

```bash
npm install
npm test 2>&1 | tail -40 | tee /tmp/nexus-spec0-baseline.txt
```

This repo has known pre-existing failures from native modules. Write the failing suite names into the commit message in Step 5 so later tasks can tell old breakage from new.

- [ ] **Step 2: Write the characterization test**

Create `tests/unit/transport/ssh-argv-characterization.test.ts`:

```ts
/**
 * Golden-argv characterization for the two duplicated SSH implementations.
 * Written BEFORE the transport refactor; must pass UNCHANGED after it.
 */
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { createLocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import { executeSentinelCommands } from '../../../src/main/sentinel/SentinelExecutor';

const EXPECTED_KEY = path.join(
  os.homedir(), 'Library', 'Application Support', 'Local', 'ssh', 'wpe-connect',
);

export const SHARED_SSH_OPTS = [
  '-F', '/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
  '-o', 'ServerAliveInterval=60',
  '-o', 'ServerAliveCountMax=120',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ControlMaster=auto',
  '-o', 'ControlPath=/tmp/ssh-nexus-%C',
  '-o', 'ControlPersist=30s',
  '-i', EXPECTED_KEY,
];

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

describe('WPE SSH argv — golden characterization', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  describe('remoteWpCliRun (local-services-bridge)', () => {
    const bridge = () => createLocalServicesBridge({} as any);

    it('builds the exact ssh argv, with skip flags by default', async () => {
      await bridge().remoteWpCliRun('acmeprod', ['plugin', 'list', '--format=json']);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnMock.mock.calls[0];
      expect(cmd).toBe('ssh');
      expect(args).toEqual([
        ...SHARED_SSH_OPTS,
        'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
        "wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'",
      ]);
      expect(opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 });
    });

    it('omits skip flags when skipPlugins is explicitly false', async () => {
      await bridge().remoteWpCliRun('acmeprod', ['post', 'list'], { skipPlugins: false });
      expect(spawnMock.mock.calls[0][1].at(-1)).toBe("wp 'post' 'list'");
    });

    it('shell-escapes embedded single quotes', async () => {
      await bridge().remoteWpCliRun('acmeprod', ['option', 'update', 'blogname', "Bob's Site"]);
      expect(spawnMock.mock.calls[0][1].at(-1))
        .toBe("wp --skip-plugins --skip-themes 'option' 'update' 'blogname' 'Bob'\\''s Site'");
    });

    it('on non-zero exit returns stderr in stdout (NOT stdout)', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'partial', stderr: 'boom' }));
      const result = await bridge().remoteWpCliRun('acmeprod', ['core', 'version']);
      expect(result).toEqual({ stdout: 'boom', success: false });
    });

    it('on non-zero exit with no stderr reports the exit code', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 7 }));
      const result = await bridge().remoteWpCliRun('acmeprod', ['core', 'version']);
      expect(result).toEqual({ stdout: 'SSH exited with code 7', success: false });
    });

    it('resolves (never rejects) on spawn error', async () => {
      spawnMock.mockImplementation(() => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setImmediate(() => proc.emit('error', new Error('ENOENT')));
        return proc;
      });
      await expect(bridge().remoteWpCliRun('acmeprod', ['core', 'version']))
        .resolves.toEqual({ stdout: 'ENOENT', success: false });
    });
  });

  describe('remoteSshRaw (SentinelExecutor)', () => {
    const stubServices: any = { remoteWpCliRun: jest.fn() };

    it('builds the same ssh argv with a bare rm command', async () => {
      await executeSentinelCommands('acmeprod', ['rm wp-content/mu-plugins/evil.php'], stubServices);

      const [cmd, args, opts] = spawnMock.mock.calls[0];
      expect(cmd).toBe('ssh');
      expect(args).toEqual([
        ...SHARED_SSH_OPTS,
        'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
        "rm -f '/nas/content/live/acmeprod/wp-content/mu-plugins/evil.php'",
      ]);
      expect(opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 });
    });

    it('on failure prefers stdout over stderr — the OPPOSITE of remoteWpCliRun', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'from-stdout', stderr: 'from-stderr' }));
      const res = await executeSentinelCommands('acmeprod', ['rm evil.php'], stubServices);
      expect(res.success).toBe(false);
      expect(res.steps[0].error).toBe('from-stdout');
    });
  });
});
```

- [ ] **Step 3: Run the test — expect PASS**

```bash
npx jest tests/unit/transport/ssh-argv-characterization.test.ts -v
```

Expected: all 8 tests PASS. This test characterizes code that already exists, so a failure means the assertion is wrong, not the code. Fix the assertion to match reality — **do not change source in this task.**

- [ ] **Step 4: Confirm no baseline regression**

```bash
npm test 2>&1 | tail -40
```

Expected: identical failures to `/tmp/nexus-spec0-baseline.txt`, plus 8 new passes.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/transport/ssh-argv-characterization.test.ts
git commit -m "test: pin WPE SSH argv before transport refactor

Golden characterization of both duplicated SSH implementations. Must
pass unchanged after the refactor. Also records that the two disagree
on failure: remoteWpCliRun returns stderr, remoteSshRaw returns stdout.

Pre-existing baseline failures: <paste suite names from Step 1>"
```

---

### Task 2: SentinelExecutor behavioral characterization

Task 1 pinned Sentinel's argv. This pins the rest of its contract — the parts with zero coverage today.

**Files:**
- Create: `tests/unit/sentinel/sentinel-executor.test.ts`
- Read only: `src/main/sentinel/SentinelExecutor.ts:56-115`

**Interfaces:**
- Consumes: the `fakeProc` / `spawnMock` pattern from Task 1
- Produces: nothing consumed by later tasks; it is a safety net for Task 11

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sentinel/sentinel-executor.test.ts`:

```ts
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { executeSentinelCommands } from '../../../src/main/sentinel/SentinelExecutor';

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

function stubServices(result: any = { stdout: 'done', success: true }) {
  return { remoteWpCliRun: jest.fn(async () => result) } as any;
}

describe('executeSentinelCommands', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  it('skips full-line comments and blank lines without spawning', async () => {
    const res = await executeSentinelCommands('acme', ['# a note', '', '   '], stubServices());
    expect(spawnMock).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.steps).toHaveLength(3);
    expect(res.steps.every(s => s.ok && s.durationMs === 0)).toBe(true);
  });

  it('strips inline comments before dispatch', async () => {
    await executeSentinelCommands('acme', ['rm evil.php   # remove webshell'], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/evil.php'");
  });

  it('strips rm flags when building the NAS path', async () => {
    await executeSentinelCommands('acme', ['rm -rf -v wp-content/uploads/x.php'], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/uploads/x.php'");
  });

  it('escapes single quotes in the deletion path', async () => {
    await executeSentinelCommands('acme', ["rm wp-content/it's.php"], stubServices());
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/wp-content/it'\\''s.php'");
  });

  it('truncates rm failure output to 300 characters', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'x'.repeat(500) }));
    const res = await executeSentinelCommands('acme', ['rm evil.php'], stubServices());
    expect(res.steps[0].error).toHaveLength(300);
    expect(res.success).toBe(false);
  });

  it('strips a leading "wp" and routes non-rm commands to remoteWpCliRun', async () => {
    const services = stubServices();
    await executeSentinelCommands('acme', ['wp plugin list --format=json'], services);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(services.remoteWpCliRun).toHaveBeenCalledWith('acme', ['plugin', 'list', '--format=json']);
  });

  it('marks the run failed but continues after a failing step', async () => {
    const services = stubServices({ stdout: 'nope', stderr: 'bad', success: false });
    const res = await executeSentinelCommands('acme', ['wp plugin list', 'wp core version'], services);
    expect(res.success).toBe(false);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].error).toBe('bad');
  });

  it('never rejects when the underlying call throws', async () => {
    const services = { remoteWpCliRun: jest.fn(async () => { throw new Error('kaboom'); }) } as any;
    const res = await executeSentinelCommands('acme', ['wp core version'], services);
    expect(res.success).toBe(false);
    expect(res.steps[0].error).toBe('kaboom');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest tests/unit/sentinel/sentinel-executor.test.ts -v
```

Expected: PASS. These characterize existing behavior. If one fails, the assertion is wrong — correct the assertion, not `SentinelExecutor.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/sentinel/sentinel-executor.test.ts
git commit -m "test: characterize SentinelExecutor before folding it onto a transport

Covers comment stripping, rm-flag stripping, NAS path escaping, 300-char
truncation, wp-prefix stripping, failure aggregation and never-reject.
SentinelExecutor had zero coverage; Task 11 migrates it."
```

---

### Task 3: The unified target parser

One implementation. The CLI's richer error text is preserved behind a flag rather than imposed on GraphQL callers — that would be a user-visible behavior change.

**Files:**
- Create: `src/common/target.ts`
- Create: `tests/unit/common/target.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type TargetEnvironment = 'production' | 'staging' | 'development'`
  - `interface ParsedTarget { type: 'local'|'wpe'; original: string; siteName?: string; account?: string; installName?: string; environment?: TargetEnvironment }`
  - `parseTarget(target: string, opts?: { verboseErrors?: boolean }): ParsedTarget`
  - `requireLocalTarget(target: string): string`
  - `requireWpeTarget(target: string): { account: string; installName: string; installId: string; environment: string }`
  - `formatTarget(parsed: ParsedTarget): string`

**Note on the skew:** the CLI stored regex group 2 as `installId`, both server copies as `installName` — same value, different name. The unified shape uses `installName`. `requireWpeTarget` returns **both**, with `installId` a deprecated alias, so no CLI call site changes in this refactor.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/common/target.test.ts`:

```ts
import {
  parseTarget, requireLocalTarget, requireWpeTarget, formatTarget,
} from '../../../src/common/target';

describe('parseTarget', () => {
  it('parses an explicit local target', () => {
    expect(parseTarget('mysite@local')).toEqual({
      type: 'local', original: 'mysite@local', siteName: 'mysite',
    });
  });

  it('treats a bare name as local', () => {
    expect(parseTarget('mysite')).toEqual({
      type: 'local', original: 'mysite', siteName: 'mysite',
    });
  });

  it('parses a full WPE target into installName', () => {
    expect(parseTarget('wpe:acct/myinstall@production')).toEqual({
      type: 'wpe',
      original: 'wpe:acct/myinstall@production',
      account: 'acct',
      installName: 'myinstall',
      environment: 'production',
    });
  });

  it('lazily matches so the install portion may contain slashes', () => {
    expect(parseTarget('wpe:acct/a/b@staging').installName).toBe('a/b');
  });

  it.each(['production', 'staging', 'development'])('accepts %s', (env) => {
    expect(parseTarget(`wpe:a/b@${env}`).environment).toBe(env);
  });

  it('throws terse text for an incomplete WPE target by default', () => {
    expect(() => parseTarget('wpe:acct/inst'))
      .toThrow('Incomplete WPE target: wpe:acct/inst. Expected wpe:account/install@environment');
  });

  it('throws verbose text for an incomplete WPE target when asked', () => {
    expect(() => parseTarget('wpe:acct/inst', { verboseErrors: true }))
      .toThrow(/Expected: wpe:account\/install@environment/);
  });

  it('throws terse text for invalid syntax by default', () => {
    expect(() => parseTarget('mysite@production'))
      .toThrow("Invalid target syntax: mysite@production. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'");
  });

  it('throws the shorthand-needs-a-link hint only in verbose mode', () => {
    expect(() => parseTarget('mysite@production', { verboseErrors: true }))
      .toThrow(/Shorthand syntax 'mysite@production' requires a link/);
  });

  it('throws terse text for an unknown @suffix in verbose mode too', () => {
    expect(() => parseTarget('mysite@nonsense', { verboseErrors: true }))
      .toThrow(/Invalid target syntax/);
  });
});

describe('requireLocalTarget', () => {
  it('returns the site name', () => {
    expect(requireLocalTarget('mysite@local')).toBe('mysite');
  });
  it('rejects a WPE target', () => {
    expect(() => requireLocalTarget('wpe:a/b@production')).toThrow(/Expected local target/);
  });
});

describe('requireWpeTarget', () => {
  it('returns installName and the deprecated installId alias', () => {
    expect(requireWpeTarget('wpe:acct/inst@staging')).toEqual({
      account: 'acct', installName: 'inst', installId: 'inst', environment: 'staging',
    });
  });
  it('rejects a local target', () => {
    expect(() => requireWpeTarget('mysite@local')).toThrow(/Expected WPE target/);
  });
});

describe('formatTarget', () => {
  it('formats local', () => {
    expect(formatTarget(parseTarget('mysite@local'))).toBe('mysite@local');
  });
  it('formats wpe', () => {
    expect(formatTarget(parseTarget('wpe:a/b@production'))).toBe('wpe:a/b@production');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/common/target.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/common/target'`.

- [ ] **Step 3: Write the implementation**

Create `src/common/target.ts`:

```ts
/**
 * The single target parser. Replaces three copies that had already skewed:
 * the CLI stored regex group 2 as `installId`, both server copies as
 * `installName`. The unified shape uses `installName`.
 *
 * `verboseErrors` preserves the CLI's richer messages without imposing them
 * on GraphQL callers, whose error text is user-visible.
 */

export type TargetEnvironment = 'production' | 'staging' | 'development';

export interface ParsedTarget {
  type: 'local' | 'wpe';
  original: string;
  siteName?: string;
  account?: string;
  /** For WPE: the install portion. May contain slashes (the regex is lazy). */
  installName?: string;
  environment?: TargetEnvironment;
}

export interface ParseTargetOptions {
  /** CLI passes true for actionable multi-line errors; servers keep terse legacy text. */
  verboseErrors?: boolean;
}

const ENVIRONMENTS: readonly string[] = ['production', 'staging', 'development'];

export function parseTarget(target: string, opts: ParseTargetOptions = {}): ParsedTarget {
  const verbose = opts.verboseErrors ?? false;

  if (target.endsWith('@local')) {
    return { type: 'local', original: target, siteName: target.replace('@local', '') };
  }

  const wpeMatch = target.match(/^wpe:(.+?)\/(.+?)@(production|staging|development)$/);
  if (wpeMatch) {
    return {
      type: 'wpe',
      original: target,
      account: wpeMatch[1],
      installName: wpeMatch[2],
      environment: wpeMatch[3] as TargetEnvironment,
    };
  }

  if (target.startsWith('wpe:')) {
    throw new Error(
      verbose
        ? `Incomplete WPE target: ${target}\n\n` +
          `Expected: wpe:account/install@environment\n` +
          `Environments: production, staging, development`
        : `Incomplete WPE target: ${target}. Expected wpe:account/install@environment`,
    );
  }

  if (!target.includes('@')) {
    return { type: 'local', original: target, siteName: target };
  }

  if (verbose) {
    const [siteName, env] = target.split('@');
    if (ENVIRONMENTS.includes(env)) {
      throw new Error(
        `Shorthand syntax '${target}' requires a link.\n\n` +
          `Site '${siteName}' is not linked to environment '${env}'.\n` +
          `Use full syntax: wpe:account/install@${env}\n` +
          `Or create link: nexus sync pull ${siteName}@local --from=wpe:account/install@${env}`,
      );
    }
  }

  throw new Error(
    verbose
      ? `Invalid target syntax: ${target}\n\n` +
        `Expected formats:\n` +
        `  Plain:  mysite\n` +
        `  Local:  mysite@local\n` +
        `  WPE:    wpe:account/install@environment\n\n` +
        `Environments: production, staging, development`
      : `Invalid target syntax: ${target}. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'`,
  );
}

export function requireLocalTarget(target: string, opts?: ParseTargetOptions): string {
  const parsed = parseTarget(target, opts);
  if (parsed.type !== 'local') {
    throw new Error(`Expected local target (e.g., mysite@local), got: ${target}`);
  }
  return parsed.siteName!;
}

export function requireWpeTarget(target: string, opts?: ParseTargetOptions): {
  account: string;
  installName: string;
  /** @deprecated Alias of installName, kept so existing CLI call sites need no change. */
  installId: string;
  environment: string;
} {
  const parsed = parseTarget(target, opts);
  if (parsed.type !== 'wpe') {
    throw new Error(`Expected WPE target (e.g., wpe:account/install@production), got: ${target}`);
  }
  return {
    account: parsed.account!,
    installName: parsed.installName!,
    installId: parsed.installName!,
    environment: parsed.environment!,
  };
}

export function formatTarget(parsed: ParsedTarget): string {
  if (parsed.type === 'local') return `${parsed.siteName}@local`;
  return `wpe:${parsed.account}/${parsed.installName}@${parsed.environment}`;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx jest tests/unit/common/target.test.ts -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/common/target.ts tests/unit/common/target.test.ts
git commit -m "feat(target): add unified target parser in src/common

One implementation to replace three copies. Resolves the installId vs
installName skew in favour of installName; requireWpeTarget still returns
installId as a deprecated alias so no CLI call site changes yet.
CLI error verbosity is preserved behind a flag rather than imposed on
GraphQL callers, whose error text is user-visible."
```

---

### Task 4: Retire the three parser copies

**Files:**
- Modify: `src/cli/utils/target.ts` (replace body with re-exports)
- Modify: `src/main/graphql/resolver-utils.ts:38-90` (replace `ParsedTarget` + `parseTarget`)
- Modify: `src/main/graphql/resolvers.ts:92-130` (delete local `parseTarget`, import instead)

**Interfaces:**
- Consumes: everything Task 3 produced
- Produces: no new symbols; all three modules now re-export the shared ones

- [ ] **Step 1: Rewrite the CLI module as a verbose-mode adapter**

Replace the entire contents of `src/cli/utils/target.ts`:

```ts
/**
 * CLI target parsing. Thin adapter over src/common/target.ts that defaults to
 * verbose, actionable error messages. The implementation lives in common/ so
 * the CLI and the GraphQL server cannot drift apart again.
 */
import {
  parseTarget as parseTargetShared,
  requireLocalTarget as requireLocalTargetShared,
  requireWpeTarget as requireWpeTargetShared,
  formatTarget,
} from '../../common/target';

export type { ParsedTarget, TargetEnvironment } from '../../common/target';
export { formatTarget };

export function parseTarget(target: string) {
  return parseTargetShared(target, { verboseErrors: true });
}

export function requireLocalTarget(target: string) {
  return requireLocalTargetShared(target, { verboseErrors: true });
}

export function requireWpeTarget(target: string) {
  return requireWpeTargetShared(target, { verboseErrors: true });
}
```

- [ ] **Step 2: Point `resolver-utils.ts` at the shared parser**

In `src/main/graphql/resolver-utils.ts`, delete the `ParsedTarget` interface and the `parseTarget` function (roughly lines 38–90) and add near the top:

```ts
import { parseTarget as parseTargetShared } from '../../common/target';
export type { ParsedTarget } from '../../common/target';

/** Server-side parsing keeps the terse legacy error text (user-visible via GraphQL). */
export function parseTarget(target: string) {
  return parseTargetShared(target);
}
```

- [ ] **Step 3: Delete the duplicate in `resolvers.ts`**

Remove the local `function parseTarget(...)` at `src/main/graphql/resolvers.ts:92` entirely, and ensure the file imports it from `./resolver-utils` instead. Check what `resolvers.ts` already imports from that module and extend the existing import rather than adding a second one:

```bash
grep -n "from './resolver-utils'" src/main/graphql/resolvers.ts
```

- [ ] **Step 4: Verify no stale references and that types still compile**

```bash
grep -rn "installId" src/cli/utils/target.ts src/main/graphql/resolver-utils.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: the grep shows nothing in those two files; `tsc` reports no errors. If `tsc` complains about `parsed.installId` anywhere in `src/main/`, change it to `parsed.installName` — the server copies never populated `installId`, so any such read was already `undefined`.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -40
```

Expected: same failures as the Task 1 baseline. No new ones.

- [ ] **Step 6: Commit**

```bash
git add src/cli/utils/target.ts src/main/graphql/resolver-utils.ts src/main/graphql/resolvers.ts
git commit -m "refactor(target): retire three duplicate parseTarget copies

All three now delegate to src/common/target.ts. CLI keeps verbose errors,
GraphQL keeps terse ones, so no user-visible text changes."
```

---

### Task 5: Transport types and extracted SSH builders

**Files:**
- Create: `src/main/transport/types.ts`
- Create: `src/main/transport/ssh-args.ts`
- Create: `tests/unit/transport/ssh-args.test.ts`

**Interfaces:**
- Consumes: `SHARED_SSH_OPTS` from Task 1's test
- Produces:
  - `type TransportKind = 'local' | 'wpe-ssh' | 'external-ssh' | 'external-rest'`
  - `type Capability = 'wp-cli' | 'arbitrary-options' | 'db-query' | 'eval' | 'search-replace' | 'core-update' | 'theme-activate'`
  - `interface SiteRef { kind: 'local'; siteId: string } | { kind: 'wpe'; installName: string }`
  - `interface RunOpts { skipPlugins?: boolean; timeoutMs?: number }`
  - `interface ProbeResult { reachable: boolean; wpCliVersion?: string; wpVersion?: string; detail?: string }`
  - `interface DeleteResult { success: boolean; output: string }`
  - `interface SiteTransport { … }`
  - `buildWpeSshArgs(installName, remoteCommand, keyPath?): string[]`
  - `buildWpCliCommand(args, opts?): string`
  - `escapeShellArg(arg): string`
  - `wpeSshKeyPath(): string`
  - `WPE_SSH_TIMEOUT_MS = 35000`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/transport/ssh-args.test.ts`:

```ts
import * as path from 'path';
import * as os from 'os';
import {
  buildWpeSshArgs, buildWpCliCommand, escapeShellArg, wpeSshKeyPath, WPE_SSH_TIMEOUT_MS,
} from '../../../src/main/transport/ssh-args';

const STUB_KEY = '/stub/ssh/wpe-connect';

describe('escapeShellArg', () => {
  it('wraps in single quotes', () => {
    expect(escapeShellArg('plugin')).toBe("'plugin'");
  });
  it('escapes embedded single quotes', () => {
    expect(escapeShellArg("Bob's")).toBe("'Bob'\\''s'");
  });
});

describe('buildWpCliCommand', () => {
  it('adds skip flags by default', () => {
    expect(buildWpCliCommand(['plugin', 'list', '--format=json']))
      .toBe("wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'");
  });
  it('omits skip flags when skipPlugins is false', () => {
    expect(buildWpCliCommand(['post', 'list'], { skipPlugins: false }))
      .toBe("wp 'post' 'list'");
  });
});

describe('buildWpeSshArgs', () => {
  it('produces the pinned argv', () => {
    expect(buildWpeSshArgs('acmeprod', 'rm -f /tmp/x', STUB_KEY)).toEqual([
      '-F', '/dev/null',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
      '-o', 'ServerAliveInterval=60',
      '-o', 'ServerAliveCountMax=120',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPath=/tmp/ssh-nexus-%C',
      '-o', 'ControlPersist=30s',
      '-i', STUB_KEY,
      'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
      'rm -f /tmp/x',
    ]);
  });

  it('defaults the key path to the Local userData location', () => {
    expect(buildWpeSshArgs('a', 'true').at(-3))
      .toBe(path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'ssh', 'wpe-connect'));
  });
});

describe('wpeSshKeyPath', () => {
  afterEach(() => { delete (process as any).electronPaths; });

  it('prefers electronPaths.userDataPath when Local provides it', () => {
    (process as any).electronPaths = { userDataPath: '/custom/userdata' };
    expect(wpeSshKeyPath()).toBe(path.join('/custom/userdata', 'ssh', 'wpe-connect'));
  });
});

it('pins the SSH timeout', () => {
  expect(WPE_SSH_TIMEOUT_MS).toBe(35000);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/transport/ssh-args.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `ssh-args.ts`**

Create `src/main/transport/ssh-args.ts`:

```ts
/**
 * Pure builders for WP Engine SSH invocations. Extracted verbatim from the two
 * duplicated implementations (local-services-bridge remoteWpCliRun and
 * SentinelExecutor remoteSshRaw) so both can share one definition.
 *
 * The argv here is pinned by tests/unit/transport/ssh-argv-characterization.test.ts.
 * Changing it changes how Nexus reaches every production install — don't, casually.
 */
import * as path from 'path';
import * as os from 'os';

/** WPE SSH cold-start runs 13–30s; ControlMaster reuse brings later calls to 1–3s. */
export const WPE_SSH_TIMEOUT_MS = 35000;

export function wpeSshKeyPath(): string {
  const userDataPath = (process as any).electronPaths?.userDataPath
    ?? path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  return path.join(userDataPath, 'ssh', 'wpe-connect');
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function buildWpCliCommand(args: string[], opts?: { skipPlugins?: boolean }): string {
  const skipFlags = opts?.skipPlugins === false ? '' : '--skip-plugins --skip-themes';
  return `wp ${skipFlags} ${args.map(escapeShellArg).join(' ')}`.trim();
}

export function buildWpeSshArgs(
  installName: string,
  remoteCommand: string,
  keyPath: string = wpeSshKeyPath(),
): string[] {
  return [
    '-F', '/dev/null',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
    '-o', 'ServerAliveInterval=60',
    '-o', 'ServerAliveCountMax=120',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=/tmp/ssh-nexus-%C',
    '-o', 'ControlPersist=30s',
    '-i', keyPath,
    `local+ssh+${installName}@${installName}.ssh.wpengine.net`,
    remoteCommand,
  ];
}
```

- [ ] **Step 4: Write `types.ts`**

Create `src/main/transport/types.ts`:

```ts
import type { WpCliResult } from '../mcp/local-services-bridge';

export type TransportKind = 'local' | 'wpe-ssh' | 'external-ssh' | 'external-rest';

/**
 * Seeded with only the tokens the 15 existing wp-cli tools need. Deliberately
 * NOT exhaustive — Spec 2 enumerates it properly once the REST surface makes the
 * distinctions load-bearing. Do not invent tokens no caller checks.
 */
export type Capability =
  | 'wp-cli'
  | 'arbitrary-options'
  | 'db-query'
  | 'eval'
  | 'search-replace'
  | 'core-update'
  | 'theme-activate';

export type SiteRef =
  | { kind: 'local'; siteId: string; siteName: string }
  | { kind: 'wpe'; installName: string };

export interface RunOpts {
  skipPlugins?: boolean;
  timeoutMs?: number;
}

export interface ProbeResult {
  reachable: boolean;
  wpCliVersion?: string;
  wpVersion?: string;
  detail?: string;
}

export interface DeleteResult {
  success: boolean;
  output: string;
}

export interface SiteTransport {
  readonly kind: TransportKind;
  readonly siteRef: SiteRef;

  /** Never rejects. Failures surface as { success: false }. */
  runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult>;

  /**
   * Delete a file without going through WP-CLI. Exists because WP-CLI loads
   * MU-plugins even with --skip-plugins, so a webshell in mu-plugins/ runs
   * before unlink() and poisons every later command.
   */
  deleteRemoteFile(absolutePath: string): Promise<DeleteResult>;

  supports(cap: Capability): boolean;
  probe(): Promise<ProbeResult>;
}
```

- [ ] **Step 5: Run both transport tests**

```bash
npx jest tests/unit/transport/ -v
npx tsc --noEmit -p tsconfig.json
```

Expected: `ssh-args.test.ts` all PASS; the Task 1 characterization test still PASSES unchanged; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/ tests/unit/transport/ssh-args.test.ts
git commit -m "feat(transport): add SiteTransport types and extract SSH builders

Pure argv/command builders lifted verbatim from the two duplicates.
Capability is seeded, not exhaustive — Spec 2 enumerates it."
```

---

### Task 6: `WpeSshTransport`

**Files:**
- Create: `src/main/transport/WpeSshTransport.ts`
- Create: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: everything from Task 5
- Produces: `class WpeSshTransport implements SiteTransport`, constructor `(installName: string)`; and `runTransportConformance(name: string, factory: () => SiteTransport)` exported from the conformance test for reuse in Task 7

- [ ] **Step 1: Write the failing conformance test**

Create `tests/unit/transport/conformance.test.ts`:

```ts
/**
 * Shared conformance suite. Every SiteTransport implementation must pass it.
 * Spec 1 and Spec 2 transports plug in here — a new transport is "done" when
 * this passes.
 */
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import type { SiteTransport } from '../../../src/main/transport/types';
import { WpeSshTransport } from '../../../src/main/transport/WpeSshTransport';

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

export function runTransportConformance(name: string, factory: () => SiteTransport) {
  describe(`SiteTransport conformance — ${name}`, () => {
    it('exposes a stable kind and siteRef', () => {
      const t = factory();
      expect(typeof t.kind).toBe('string');
      expect(t.siteRef).toBeDefined();
    });

    it('supports() answers every seeded capability without throwing', () => {
      const t = factory();
      for (const cap of ['wp-cli', 'arbitrary-options', 'db-query', 'eval',
                         'search-replace', 'core-update', 'theme-activate'] as const) {
        expect(typeof t.supports(cap)).toBe('boolean');
      }
    });

    it('runWpCli resolves rather than rejecting on failure', async () => {
      const t = factory();
      await expect(t.runWpCli(['core', 'version'])).resolves.toHaveProperty('success');
    });

    it('probe() resolves with a reachable flag', async () => {
      await expect(factory().probe()).resolves.toHaveProperty('reachable');
    });
  });
}

describe('WpeSshTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  runTransportConformance('WpeSshTransport', () => new WpeSshTransport('acmeprod'));

  it('runWpCli sends the same argv the legacy path did', async () => {
    await new WpeSshTransport('acmeprod').runWpCli(['plugin', 'list', '--format=json']);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args.at(-2)).toBe('local+ssh+acmeprod@acmeprod.ssh.wpengine.net');
    expect(args.at(-1)).toBe("wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'");
    expect(opts.timeout).toBe(35000);
  });

  it('runWpCli returns stderr on failure (legacy remoteWpCliRun shape)', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'partial', stderr: 'boom' }));
    await expect(new WpeSshTransport('acmeprod').runWpCli(['core', 'version']))
      .resolves.toEqual({ stdout: 'boom', success: false });
  });

  it('deleteRemoteFile issues a bare rm -f and returns stdout on failure (legacy remoteSshRaw shape)', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'from-stdout', stderr: 'from-stderr' }));
    const res = await new WpeSshTransport('acmeprod')
      .deleteRemoteFile('/nas/content/live/acmeprod/evil.php');
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acmeprod/evil.php'");
    expect(res).toEqual({ success: false, output: 'from-stdout' });
  });

  it('deleteRemoteFile escapes single quotes in the path', async () => {
    await new WpeSshTransport('acme').deleteRemoteFile("/nas/content/live/acme/it's.php");
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/it'\\''s.php'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/transport/conformance.test.ts
```

Expected: FAIL — `WpeSshTransport` module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/transport/WpeSshTransport.ts`:

```ts
import { spawn } from 'child_process';
import type { WpCliResult } from '../mcp/local-services-bridge';
import type {
  Capability, DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';
import {
  buildWpCliCommand, buildWpeSshArgs, escapeShellArg, WPE_SSH_TIMEOUT_MS,
} from './ssh-args';

type RawSshResult = { code: number | null; stdout: string; stderr: string; spawnError?: string };

function runSsh(installName: string, remoteCommand: string): Promise<RawSshResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', buildWpeSshArgs(installName, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: WPE_SSH_TIMEOUT_MS,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });
}

export class WpeSshTransport implements SiteTransport {
  readonly kind: TransportKind = 'wpe-ssh';
  readonly siteRef: SiteRef;

  constructor(private readonly installName: string) {
    this.siteRef = { kind: 'wpe', installName };
  }

  /** SSH + WP-CLI can do everything the seeded capability list covers. */
  supports(_cap: Capability): boolean {
    return true;
  }

  async runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult> {
    const res = await runSsh(this.installName, buildWpCliCommand(args, opts));
    if (res.spawnError !== undefined) return { stdout: res.spawnError, success: false };
    if (res.code === 0) return { stdout: res.stdout, success: true };
    // Legacy shape: prefer stderr, fall back to the exit code.
    return { stdout: res.stderr || `SSH exited with code ${res.code}`, success: false };
  }

  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    const res = await runSsh(this.installName, `rm -f ${escapeShellArg(absolutePath)}`);
    if (res.spawnError !== undefined) return { success: false, output: res.spawnError };
    // Legacy shape: prefer stdout — deliberately the opposite of runWpCli.
    return { success: res.code === 0, output: res.stdout || res.stderr };
  }

  async probe(): Promise<ProbeResult> {
    const res = await this.runWpCli(['cli', 'version']);
    return res.success
      ? { reachable: true, wpCliVersion: (res.stdout ?? '').trim() }
      : { reachable: false, detail: res.stdout ?? undefined };
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx jest tests/unit/transport/ -v
```

Expected: conformance and ssh-args PASS; Task 1's characterization test still PASSES unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/WpeSshTransport.ts tests/unit/transport/conformance.test.ts
git commit -m "feat(transport): add WpeSshTransport and shared conformance suite

Preserves both legacy failure shapes exactly: runWpCli prefers stderr,
deleteRemoteFile prefers stdout. The conformance suite is the gate every
future transport must pass."
```

---

### Task 7: `LocalTransport`

**Files:**
- Create: `src/main/transport/LocalTransport.ts`
- Create: `src/main/transport/index.ts`
- Modify: `tests/unit/transport/conformance.test.ts` (add a `LocalTransport` block)

**Interfaces:**
- Consumes: Task 5 types, Task 6's `runTransportConformance`
- Produces: `class LocalTransport implements SiteTransport`, constructor `(siteId: string, siteName: string, localServices: LocalServicesBridge)`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/transport/conformance.test.ts`:

```ts
import { LocalTransport } from '../../../src/main/transport/LocalTransport';

describe('LocalTransport', () => {
  const services = () => ({
    wpCliRun: jest.fn(async () => ({ stdout: 'WordPress 6.8', success: true })),
  }) as any;

  runTransportConformance('LocalTransport', () =>
    new LocalTransport('site-1', 'Test Site', services()));

  it('delegates runWpCli to localServices with the site id', async () => {
    const s = services();
    await new LocalTransport('site-1', 'Test Site', s).runWpCli(['core', 'version']);
    expect(s.wpCliRun).toHaveBeenCalledWith('site-1', ['core', 'version'], undefined);
  });

  it('passes timeoutMs through', async () => {
    const s = services();
    await new LocalTransport('site-1', 'Test Site', s).runWpCli(['core', 'version'], { timeoutMs: 5000 });
    expect(s.wpCliRun).toHaveBeenCalledWith('site-1', ['core', 'version'], { timeoutMs: 5000 });
  });

  it('refuses deleteRemoteFile — local sites have no remote filesystem', async () => {
    const res = await new LocalTransport('site-1', 'Test Site', services())
      .deleteRemoteFile('/tmp/x');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not supported/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/transport/conformance.test.ts
```

Expected: FAIL — `LocalTransport` module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/transport/LocalTransport.ts`:

```ts
import type { LocalServicesBridge, WpCliResult } from '../mcp/local-services-bridge';
import type {
  Capability, DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';

export class LocalTransport implements SiteTransport {
  readonly kind: TransportKind = 'local';
  readonly siteRef: SiteRef;

  constructor(
    private readonly siteId: string,
    siteName: string,
    private readonly localServices: LocalServicesBridge,
  ) {
    this.siteRef = { kind: 'local', siteId, siteName };
  }

  supports(_cap: Capability): boolean {
    return true;
  }

  runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult> {
    return this.localServices.wpCliRun(this.siteId, args, opts as any);
  }

  /**
   * Local sites have no remote filesystem. Sentinel's raw-delete path is
   * WPE-only; this exists to satisfy the interface, not to be called.
   */
  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    return {
      success: false,
      output: `deleteRemoteFile is not supported on local sites (path: ${absolutePath})`,
    };
  }

  async probe(): Promise<ProbeResult> {
    const res = await this.runWpCli(['cli', 'version']);
    return res.success
      ? { reachable: true, wpCliVersion: (res.stdout ?? '').trim() }
      : { reachable: false, detail: res.stdout ?? undefined };
  }
}
```

Create `src/main/transport/index.ts`:

```ts
export * from './types';
export * from './ssh-args';
export { WpeSshTransport } from './WpeSshTransport';
export { LocalTransport } from './LocalTransport';
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx jest tests/unit/transport/ -v
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/LocalTransport.ts src/main/transport/index.ts tests/unit/transport/conformance.test.ts
git commit -m "feat(transport): add LocalTransport, both implementations pass conformance"
```

---

### Task 8: Policy layer and `resolveTransport`

The guard moves onto the transport, but **takes each caller's rules as a parameter**. Unifying MCP and GraphQL policy is explicitly a later spec.

**Files:**
- Create: `src/main/transport/policy.ts`
- Create: `src/main/transport/resolve.ts`
- Modify: `src/main/transport/index.ts` (export both)
- Create: `tests/unit/transport/policy.test.ts`

**Interfaces:**
- Consumes: Task 5–7
- Produces:
  - `interface CommandPolicy { blocked: string[]; allowed?: Set<string> }`
  - `MCP_REMOTE_POLICY` and `GRAPHQL_REMOTE_POLICY` constants
  - `checkCommand(args: string[], policy: CommandPolicy): string | null`
  - `resolveTransport(args, services, operation): Promise<SiteTransport | McpToolResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/transport/policy.test.ts`:

```ts
import {
  checkCommand, MCP_REMOTE_POLICY, GRAPHQL_REMOTE_POLICY,
} from '../../../src/main/transport/policy';

describe('MCP_REMOTE_POLICY (blocklist + whitelist)', () => {
  it('allows a whitelisted command', () => {
    expect(checkCommand(['plugin', 'list'], MCP_REMOTE_POLICY)).toBeNull();
  });
  it('blocks eval', () => {
    expect(checkCommand(['eval', '<?php'], MCP_REMOTE_POLICY)).toBe('eval');
  });
  it('blocks db cli', () => {
    expect(checkCommand(['db', 'cli'], MCP_REMOTE_POLICY)).toBe('db cli');
  });
  it('rejects a non-whitelisted command', () => {
    expect(checkCommand(['core', 'update'], MCP_REMOTE_POLICY))
      .toMatch(/not allowed for remote execution/);
  });
});

describe('GRAPHQL_REMOTE_POLICY (blocklist only)', () => {
  it('allows core update — no whitelist on this path', () => {
    expect(checkCommand(['core', 'update'], GRAPHQL_REMOTE_POLICY)).toBeNull();
  });
  it('blocks eval', () => {
    expect(checkCommand(['eval', '<?php'], GRAPHQL_REMOTE_POLICY)).toBe('eval');
  });
  it('does NOT block db cli — the GraphQL blocklist omits it, preserved deliberately', () => {
    expect(checkCommand(['db', 'cli'], GRAPHQL_REMOTE_POLICY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest tests/unit/transport/policy.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `policy.ts`**

Create `src/main/transport/policy.ts`:

```ts
/**
 * Command policy for remote execution.
 *
 * The MCP and GraphQL paths enforce DIFFERENT rules today: MCP applies a
 * 14-command whitelist plus a 5-entry blocklist; GraphQL applies a 4-entry
 * blocklist and no whitelist. That divergence is real and load-bearing — the
 * CLI relies on operations the MCP whitelist forbids, and five MCP tools have
 * remote paths that can never succeed because of it.
 *
 * Spec 0 PRESERVES the divergence. Unifying it is a separate spec with its own
 * decisions. Do not "tidy" these two constants into one.
 */

export interface CommandPolicy {
  /** Substring/prefix blocklist, matched against the joined lowercase command. */
  blocked: string[];
  /** Optional whitelist of `"<arg0> <arg1>"` pairs. Absent means no whitelist. */
  allowed?: Set<string>;
}

export const MCP_REMOTE_POLICY: CommandPolicy = {
  blocked: ['eval', 'eval-file', 'shell', 'db query', 'db cli'],
  allowed: new Set([
    'plugin list', 'plugin install', 'plugin activate', 'plugin deactivate', 'plugin update',
    'theme list',
    'core version',
    'user list',
    'option get',
    'site health',
    'post list', 'post get', 'post-type list',
  ]),
};

export const GRAPHQL_REMOTE_POLICY: CommandPolicy = {
  blocked: ['db query', 'eval', 'eval-file', 'shell'],
};

/** Returns null when permitted, or a human-readable reason when refused. */
export function checkCommand(args: string[], policy: CommandPolicy): string | null {
  const joined = args.join(' ').toLowerCase();

  for (const blocked of policy.blocked) {
    if (joined.startsWith(blocked) || joined.includes(` ${blocked}`)) return blocked;
  }

  if (policy.allowed && args.length >= 2) {
    const command = `${args[0]} ${args[1]}`.toLowerCase();
    if (!policy.allowed.has(command)) {
      return `Command "${command}" not allowed for remote execution. Use local WP-CLI for advanced operations.`;
    }
  }

  return null;
}
```

- [ ] **Step 4: Write `resolve.ts`**

Create `src/main/transport/resolve.ts`. It reuses the existing `resolveTarget` so that environment gating, SSH-key checks and CAPI lookups keep working exactly as they do now, then wraps the result in a transport:

```ts
import type { NexusServices, McpToolResult } from '../mcp/types';
import { resolveTarget } from '../mcp/modules/wp-cli/remote-exec';
import type { SiteTransport } from './types';
import { WpeSshTransport } from './WpeSshTransport';
import { LocalTransport } from './LocalTransport';

/**
 * Resolve MCP tool args to a transport. Delegates target resolution (and
 * therefore the environment gate, SSH-key check and CAPI lookup) to the
 * existing resolveTarget so none of that behavior moves in Spec 0.
 *
 * Returns an McpToolResult when resolution fails, matching resolveTarget's
 * existing contract — callers keep using `if ('content' in x) return x`.
 */
export async function resolveTransport(
  args: Record<string, unknown>,
  services: NexusServices,
  operation: string,
): Promise<SiteTransport | McpToolResult> {
  const target = await resolveTarget(args as any, services, operation as any);
  if ('content' in target) return target;

  if (target.type === 'remote') {
    return new WpeSshTransport(target.installName);
  }
  return new LocalTransport(target.site.id, target.site.name, services.localServices!);
}
```

Add to `src/main/transport/index.ts`:

```ts
export * from './policy';
export { resolveTransport } from './resolve';
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/transport/ -v
npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS, `tsc` clean. If `NexusServices` / `McpToolResult` are not exported from `../mcp/types`, run `grep -n "export" src/main/mcp/types.ts | head -20` and import from the correct path.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/policy.ts src/main/transport/resolve.ts src/main/transport/index.ts tests/unit/transport/policy.test.ts
git commit -m "feat(transport): add parameterised policy layer and resolveTransport

Policy is a PARAMETER, not a single global rule: MCP keeps its whitelist,
GraphQL keeps its blocklist-only behaviour including the missing 'db cli'
entry. Tests pin the divergence so it cannot be tidied away by accident."
```

---

### Task 9: Migrate the 15 wp-cli tools

**Files:**
- Modify: all 15 tool files in `src/main/mcp/modules/wp-cli/` that import `resolveTarget`
- Create: `tests/unit/transport/tool-dispatch.test.ts`

**Interfaces:**
- Consumes: `resolveTransport` from Task 8
- Produces: no new symbols

- [ ] **Step 1: Produce the exact dispatch table**

The table below must reflect reality, not memory. Generate it:

```bash
cd src/main/mcp/modules/wp-cli
grep -n -A4 "remoteWpCliRun(" *.ts | grep -v "^remote-exec.ts" > /tmp/nexus-remote-args.txt
cat /tmp/nexus-remote-args.txt
```

Record, for each tool file, the literal argument array passed on the remote branch. Two known entries to check your reading against: `user-list.ts` uses `['user', 'list', '--format=json']`; `core-version.ts` uses `['core', 'version']`.

- [ ] **Step 2: Write the failing table-driven test**

Create `tests/unit/transport/tool-dispatch.test.ts`. Fill `CASES` from Step 1's output — one row per tool, using the literal array you recorded:

```ts
/**
 * Table-driven dispatch test across every wp-cli tool. Asserts each tool sends
 * the same WP-CLI args on the remote branch after the transport migration.
 *
 * If a tool builds genuinely different args per side (rather than merely
 * dispatching differently), it will fail here — that is the point. Handle such
 * tools explicitly rather than forcing them into the table.
 */
import { userListHandler } from '../../../src/main/mcp/modules/wp-cli/user-list';
import { coreVersionHandler } from '../../../src/main/mcp/modules/wp-cli/core-version';
// …import the remaining handlers recorded in Step 1

const CASES: Array<{ name: string; handler: any; args: Record<string, unknown>; expected: string[] }> = [
  { name: 'wp_user_list', handler: userListHandler, args: { install_name: 'acmeprod' },
    expected: ['user', 'list', '--format=json'] },
  { name: 'wp_core_version', handler: coreVersionHandler, args: { install_name: 'acmeprod' },
    expected: ['core', 'version'] },
  // …one row per remaining tool, from Step 1
];

function makeServices(capture: { args?: string[] }) {
  return {
    localServices: {
      isSSHKeyAvailable: () => true,
      remoteWpCliRun: jest.fn(async (_install: string, args: string[]) => {
        capture.args = args;
        return { stdout: '[]', success: true };
      }),
      resolveWpeInstall: jest.fn(async () => null),
    },
    siteData: { getSites: () => ({}) },
    registryStorage: {
      get: () => ({
        installs: [{ installName: 'acmeprod', environment: 'staging' }],
        syncedAt: Date.now(),
      }),
    },
    graphService: { getDb: () => null },
  } as any;
}

describe('wp-cli tool remote dispatch', () => {
  it.each(CASES)('$name sends the expected WP-CLI args', async ({ handler, args, expected }) => {
    const capture: { args?: string[] } = {};
    await handler.execute(args, makeServices(capture));
    expect(capture.args).toEqual(expected);
  });
});
```

Note the fixture uses `environment: 'staging'` because the environment gate excludes production by default — a production fixture would be refused before dispatch.

- [ ] **Step 3: Run it — expect PASS before any source change**

```bash
npx jest tests/unit/transport/tool-dispatch.test.ts -v
```

Expected: PASS against the current code. Any row that fails means your table is wrong, or that tool builds different args per side — investigate and correct the table before touching source.

- [ ] **Step 4: Migrate each tool**

For each file, replace the target resolution and remote branch. Before, in `user-list.ts`:

```ts
const target = await resolveTarget(args, services, 'wpcli_read');
if ('content' in target) return target;

if (target.type === 'remote') {
  const result = await remoteWpCliRun(target.installName, ['user', 'list', '--format=json'], services);
  …
}
return withSiteRunning(target.site.id, services, async () => {
  const result = await services.localServices!.wpCliRun(target.site.id, ['user', 'list', '--format=json']);
  …
});
```

After:

```ts
const transport = await resolveTransport(args, services, 'wpcli_read');
if ('content' in transport) return transport;

const blocked = checkCommand(['user', 'list', '--format=json'], MCP_REMOTE_POLICY);
if (transport.kind === 'wpe-ssh' && blocked) {
  return error(`Command "${blocked}" is blocked for security reasons on remote sites.`);
}

const result = await transport.runWpCli(['user', 'list', '--format=json']);
```

Keep each tool's *presentation* branch as-is where it differs by side — `user-list.ts` prefixes the remote heading with the install name, and that is observable output. Branch on `transport.kind` for formatting only, never for execution.

Migrate one file, run the dispatch test, then move to the next. Do not batch all 15 before testing.

- [ ] **Step 5: Full suite and typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -40
```

Expected: baseline failures only. The Task 1 characterization test must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/modules/wp-cli/ tests/unit/transport/tool-dispatch.test.ts
git commit -m "refactor(wp-cli): migrate 15 tools from target branching to transports

Each tool now resolves a SiteTransport and calls runWpCli. Presentation
still branches on kind where output legitimately differs by side.
Table-driven dispatch test pins the WP-CLI args for every tool."
```

---

### Task 10: Route the guard-bypassing direct callers

Six call sites reach `localServices.remoteWpCliRun` directly, skipping the whitelist wrapper. Routing them through a transport closes that gap **without changing which commands they may run** — they get `GRAPHQL_REMOTE_POLICY`, matching their current effective behavior of no whitelist.

**Files:**
- Modify: `src/main/ipc-handlers.ts:3464`
- Modify: `src/main/content/RemoteContentExtractor.ts:43`
- Modify: `src/main/mcp/modules/wpe/deep-refresh.ts` (~15 calls)
- Modify: `src/main/mcp/modules/wpe/wait-for-ssh.ts:72`
- Modify: `src/main/graphql/resolvers.ts:1262-1263`
- Modify: `src/main/graphql/resolvers/wp-cli.ts:81,147`

**Interfaces:**
- Consumes: `WpeSshTransport`, `GRAPHQL_REMOTE_POLICY`, `checkCommand`
- Produces: nothing new

- [ ] **Step 1: Confirm the exact call sites**

```bash
grep -rn "localServices\.remoteWpCliRun\|localServices!\.remoteWpCliRun" src/ | grep -v "src/main/transport/"
```

Work from this output, not the line numbers above — they drift.

- [ ] **Step 2: Replace each call**

Before:

```ts
const result = await services.localServices.remoteWpCliRun(installName, args);
```

After:

```ts
const result = await new WpeSshTransport(installName).runWpCli(args);
```

`resolvers/wp-cli.ts` is unreferenced (see the spec, §3.7) but must be kept in sync so the pending resolver split does not regress. Migrate it identically.

Leave `deep-refresh.ts`'s existing `isOperationAllowed` calls exactly where they are — the transport does not perform environment gating.

- [ ] **Step 3: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -40
```

- [ ] **Step 4: Confirm the bridge method now has no callers outside the transport**

```bash
grep -rn "remoteWpCliRun" src/ | grep -v "src/main/transport/" | grep -v "local-services-bridge.ts"
```

Expected: only `remote-exec.ts`'s wrapper (removed in Task 12) and type declarations.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(transport): route direct remoteWpCliRun callers through WpeSshTransport

Closes the whitelist-bypass gap structurally without changing which
commands any caller may run. resolvers/wp-cli.ts migrated in step with
resolvers.ts despite being unreferenced, so the pending split cannot
silently regress."
```

---

### Task 11: Fold `SentinelExecutor` onto the transport

**Files:**
- Modify: `src/main/sentinel/SentinelExecutor.ts` (delete `remoteSshRaw`, lines 16–54)

**Interfaces:**
- Consumes: `WpeSshTransport.deleteRemoteFile`, `WpeSshTransport.runWpCli`
- Produces: nothing new; `executeSentinelCommands` keeps its exact signature

- [ ] **Step 1: Confirm the safety net is green**

```bash
npx jest tests/unit/sentinel/sentinel-executor.test.ts tests/unit/transport/ssh-argv-characterization.test.ts -v
```

Expected: all PASS. **Do not proceed if any fail** — these are the only protection this file has.

- [ ] **Step 2: Delete `remoteSshRaw` and rewrite the two dispatch branches**

Remove the entire `remoteSshRaw` function (lines 16–54) and its `spawn` / `path` / `os` imports if now unused. Add:

```ts
import { WpeSshTransport } from '../transport/WpeSshTransport';
```

Replace the `rm` branch body:

```ts
const relPath = cleanCommand.replace(/^rm\s+(-\S+\s+)*/, '').trim();
const nasPath = `/nas/content/live/${installName}/${relPath}`;
const result = await new WpeSshTransport(installName).deleteRemoteFile(nasPath);
const ok = result.success;
steps.push({
  command,
  ok,
  durationMs: Date.now() - start,
  error: ok ? undefined : result.output.slice(0, 300),
});
if (!ok) allOk = false;
```

Note the escaping moved into `deleteRemoteFile`, so the local `escapedPath` line goes away. The WP-CLI branch keeps calling `localServices.remoteWpCliRun` — Task 12 decides that method's fate.

- [ ] **Step 3: Run the characterization tests — expect PASS, unchanged**

```bash
npx jest tests/unit/sentinel/ tests/unit/transport/ -v
```

Expected: every test passes **without edits**. If a test needed changing to pass, behavior changed — revert and reconcile.

- [ ] **Step 4: Full suite**

```bash
npm test 2>&1 | tail -40
```

- [ ] **Step 5: Commit**

```bash
git add src/main/sentinel/SentinelExecutor.ts
git commit -m "refactor(sentinel): fold remoteSshRaw into WpeSshTransport.deleteRemoteFile

Removes the last duplicated SSH argument construction. Characterization
tests from Tasks 1-2 pass unchanged, including the deliberate
stdout-over-stderr failure shape and 300-char truncation."
```

---

### Task 12: Delete dead duplicates and verify

**Files:**
- Modify: `src/main/mcp/modules/wp-cli/remote-exec.ts` (remove the now-unused `remoteWpCliRun` wrapper and, if unreferenced, `isBlockedCommand` / `ALLOWED_REMOTE_COMMANDS` / `BLOCKED_COMMANDS`)
- Modify: `src/main/mcp/local-services-bridge.ts` (delegate `remoteWpCliRun` to `WpeSshTransport`)

**Interfaces:**
- Consumes: everything prior
- Produces: nothing new

- [ ] **Step 1: Delegate the bridge method rather than deleting it**

`localServices.remoteWpCliRun` is part of the bridge's public surface and Sentinel's WP-CLI branch still uses it. Replace its body in `src/main/mcp/local-services-bridge.ts` (the whole implementation at ~line 831):

```ts
async remoteWpCliRun(installName: string, args: string[], opts?: { skipPlugins?: boolean }): Promise<WpCliResult> {
  // Implementation lives in WpeSshTransport; this remains as the bridge-facing
  // entry point so existing consumers keep working.
  const { WpeSshTransport } = await import('../transport/WpeSshTransport');
  return new WpeSshTransport(installName).runWpCli(args, opts);
},
```

Use a dynamic import only if a static one creates a cycle; check with `npx tsc --noEmit` and prefer a static top-level import when it compiles cleanly.

- [ ] **Step 2: Remove the superseded wrapper**

In `src/main/mcp/modules/wp-cli/remote-exec.ts`, delete the `remoteWpCliRun` wrapper (from `export async function remoteWpCliRun` to the end of that function). Then check whether the policy constants are still referenced:

```bash
grep -rn "isBlockedCommand\|ALLOWED_REMOTE_COMMANDS\|BLOCKED_COMMANDS" src/ tests/
```

Delete any that now have no callers. **Keep `resolveTarget`** — `resolveTransport` delegates to it. If a test references a deleted symbol, update the test to use `checkCommand` with `MCP_REMOTE_POLICY` instead.

- [ ] **Step 3: Confirm the duplication is actually gone**

```bash
grep -rn "ssh.wpengine.net\|local+ssh+\|ControlPath=/tmp/ssh-nexus" src/
```

Expected: hits only in `src/main/transport/ssh-args.ts`. Any other hit is a surviving duplicate.

- [ ] **Step 4: Full verification**

```bash
npx tsc --noEmit -p tsconfig.json
npm test 2>&1 | tail -40
```

Expected: identical failures to `/tmp/nexus-spec0-baseline.txt` — no more, no fewer — plus all new tests passing.

- [ ] **Step 5: Manual verification (cannot be automated)**

CI has no live-SSH coverage. Before considering Spec 0 done, with Local running and a WPE account connected:

```bash
npm run build && npm run rebuild
./dev-reload.sh
nexus wp core version <a-staging-install>
nexus wp plugin list <a-staging-install>
```

Both must return real data. Then confirm the Sentinel remediation path still deletes a file — use a **staging** install and a file you created for the purpose, never production.

Record the results in the commit message. If Sentinel's delete cannot be safely exercised, say so explicitly rather than implying it was verified.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor(transport): remove superseded SSH duplicates

localServices.remoteWpCliRun now delegates to WpeSshTransport; the
remote-exec wrapper is gone. Only src/main/transport/ssh-args.ts knows
how to build a WPE SSH invocation.

Manual verification: <record what you actually ran and what happened>"
```

---

## Self-Review

**Spec coverage.** §2.3 interface → Tasks 5–7. §3.1 five execution paths → Tasks 6, 7, 10, 11, 12. §3.2 three parsers → Tasks 3–4. §3.3 fifteen tools → Task 9. §3.5 Sentinel → Tasks 2, 11. §4.1 path mapping → Tasks 6–12. §4.2 policy preserved → Task 8. §4.3 seven-step order → Tasks 1–12 in sequence. §5 all three proofs → Tasks 1 (golden argv), 6–7 (conformance), 9 (table-driven). §6 out-of-scope → Global Constraints. §7 risks → Task 11 Step 1 gate, Task 12 Step 5 manual verification.

**Deliberately not covered**, matching spec §6: policy unification, the five dead remote tools, the ~25 ad-hoc CLI checks, deleting `environment-filter.ts`, renderer-side `installName` validation.

**Known unknowns from spec §4.4** are handled inline rather than assumed away: the parser skew is resolved in Task 3 (`installName`, with `installId` as a deprecated alias); per-side argument construction is surfaced by Task 9 Step 3 failing loudly; the ad-hoc CLI checks are left alone by Global Constraints.

**Type consistency.** `SiteTransport`, `TransportKind`, `Capability`, `SiteRef`, `RunOpts`, `ProbeResult`, `DeleteResult` are defined once in Task 5 and used unchanged in 6–9. `checkCommand` / `CommandPolicy` defined in Task 8, used in 9–10. `ParsedTarget.installName` defined in Task 3, used in 4. `deleteRemoteFile` returns `DeleteResult { success, output }` in Tasks 5, 6, 7 and is consumed as `result.output` in Task 11.

**One caveat to flag at execution time:** Task 9's `CASES` table is generated in Step 1 rather than written here, because the literal argument arrays for 13 of the 15 tools were not read during planning. Guessing them would have been worse than instructing their extraction — Step 3 fails loudly if the table is wrong.
