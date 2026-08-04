# External Host Registration (Plan B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `nexus host add/list/remove/test` — register a WordPress site on an SSH-reachable host by probing it, and make the probe's findings actually reach later commands.

**Architecture:** One reusable `probeExternalHost()` in the main process, exposed over GraphQL, with a thin CLI on top. The probe is `ssh -G` for resolution, then four short-circuiting gates: connect, locate WP-CLI, discover the WordPress root, verify it. Everything it discovers is persisted to `ExternalSiteProfile` and read back by `resolveTransport`, so `--path` becomes unnecessary after registration.

**Tech Stack:** TypeScript, Node `child_process.spawn`, Commander (CLI), GraphQL (internal transport), Jest.

**Spec:** `docs/superpowers/specs/2026-08-04-external-host-registration-design.md`

**Branch:** stack a new branch on `feat/external-sites-fleet`.

## Global Constraints

- **Nexus never writes to the user's server.** No uploads, no phar, no `ssh-copy-id` execution. Detect, search, instruct. (Spec §2, §5)
- **No SSH key material is ever stored.** The `~/.ssh/config` alias is the credential path. (Spec 1, inherited)
- **`buildExternalSshArgs` must never pass `-F /dev/null`.** The WPE builder does; this one must not. See the INVERTED RULE docblock at `src/main/transport/ssh-args.ts:97`.
- **`ssh-args.ts` stays the only place an SSH invocation is constructed.** New argv shapes get a builder there; no module hand-assembles ssh arguments. (Spec 0 Task 12)
- **`ssh -G` is resolution, never validation.** It exits 0 for an unconfigured alias and returns defaults. No config-membership gate. (Spec §3 step 0)
- **Every user-supplied value interpolated into a remote command is passed through `escapeShellArg`.** That means `--path` values and WP-CLI binary paths.
- **The probe's remote commands are a closed, hardcoded set.** They are read-only and never composed from user input beyond the escaped values above.
- The three permission policies stay separate: `MCP_REMOTE_POLICY`, `GRAPHQL_REMOTE_POLICY`, `EXTERNAL_REMOTE_POLICY`. Do not unify.
- `SiteSource` is `'local' | 'wpe' | 'external'`. Never write `=== 'wpe'` as a binary discriminator, and never `source != 'local'` to mean "is WPE" — `tests/unit/fleet/source-semantics.test.ts` forbids it.
- CLI stays scriptable: every prompt has a flag. Agents cannot answer prompts.
- `npm test` baseline before starting: **12 failed suites / 22 failed tests**, all pre-existing native-module failures. Compare failing suite **names**, not counts.

---

## Two additions beyond the spec text

Both were found while checking the spec against the code. They are in scope — each is the difference between B2 working and B2 being decorative — but they are called out because a reviewer reading only the spec will not find them there.

1. **`resolveTransport` must read the stored profile.** Today `src/main/transport/resolve.ts:50` takes `wpPath` only from `args.wp_path`. The profile B1 writes is never read back, so a registered host still requires `--path` on every command. Task 5 fixes this. Without it, `host add` discovers a path and then throws it away.
2. **The probe reads `siteurl` to fill `domain`.** B1's upsert writes `domain: parsed.alias` with the comment *"until B2's registration probe can fill it in"* (`tool-registry.ts:50-51`). Gate 4 picks it up. It is **non-fatal** — `wp option get siteurl` needs a working DB connection, and a broken DB must not block registering a reachable host.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/main/transport/ssh-args.ts` | **Modify.** Add `wpCliBin` to the WP-CLI builder, `connectTimeoutSec` to the SSH builder, and a `ssh -G` builder. |
| `src/main/external/externalSiteStore.ts` | **Modify.** Add `wpCliPath?`, its merge rule, and `removeExternalProfile`. |
| `src/main/external/sshExec.ts` | **New.** The injectable ssh primitive both the probe's helpers share. |
| `src/main/external/probeExternalHost.ts` | **New.** Step 0 + the four gates. Pure logic over `SshExec`. |
| `src/main/transport/ExternalSshTransport.ts` | **Modify.** Carry `wpCliBin` into the command. |
| `src/main/transport/resolve.ts` | **Modify.** Fall back to the stored profile for `wpPath` and `wpCliPath`. |
| `src/main/graphql/schema.ts` | **Modify.** Four mutations and their result types. |
| `src/main/graphql/resolvers.ts` | **Modify.** Four resolvers. |
| `src/cli/commands/host.ts` | **New.** `add` / `test` / `list` / `remove`. |
| `src/cli/index.ts` | **Modify.** Register `hostCommand`. |
| `tests/unit/external/probe-external-host.test.ts` | **New.** Gate-by-gate coverage. |
| `tests/unit/external/external-site-store.test.ts` | **Modify.** `wpCliPath` merge, `removeExternalProfile`. |
| `tests/unit/transport/external-ssh-args.test.ts` | **Modify.** New builder parameters. |
| `tests/unit/transport/external-ssh-resolution.test.ts` | **Modify.** Profile fallback. |

---

## Task 1: SSH argument builders

**Files:**
- Modify: `src/main/transport/ssh-args.ts:92-95` (`buildExternalWpCliCommand`), `:112-118` (`buildExternalSshArgs`)
- Test: `tests/unit/transport/external-ssh-args.test.ts`

**Interfaces:**
- Produces: `buildExternalWpCliCommand(args: string[], wpPath?: string, wpCliBin?: string): string`; `buildExternalSshArgs(alias: string, remoteCommand: string, opts?: { connectTimeoutSec?: number }): string[]`; `buildSshConfigDumpArgs(alias: string): string[]`

`wpCliBin` goes **third**, after `wpPath`. Inserting it second would silently transpose the argument at the one existing call site (`ExternalSshTransport.ts:68`) — it compiles, because both parameters are `string | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/transport/external-ssh-args.test.ts`:

```ts
describe('buildExternalWpCliCommand — wpCliBin', () => {
  it('defaults to bare wp when no binary is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version'])).toBe("wp 'core' 'version'");
  });

  it('uses and escapes an explicit binary path', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], undefined, '/opt/cpanel/composer/bin/wp'))
      .toBe("'/opt/cpanel/composer/bin/wp' 'core' 'version'");
  });

  it('keeps wpCliBin third so wpPath is not transposed', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], '/home/u/public_html', '/usr/local/bin/wp'))
      .toBe("'/usr/local/bin/wp' --path='/home/u/public_html' 'core' 'version'");
  });

  it('escapes a binary path containing a quote', () => {
    expect(buildExternalWpCliCommand(['x'], undefined, "/tmp/w'p"))
      .toBe("'/tmp/w'\\''p' 'x'");
  });
});

describe('buildExternalSshArgs — connectTimeoutSec', () => {
  it('omits ConnectTimeout by default', () => {
    expect(buildExternalSshArgs('h1', 'echo ok')).toEqual(['-o', 'BatchMode=yes', 'h1', 'echo ok']);
  });

  it('inserts ConnectTimeout before the alias when asked', () => {
    expect(buildExternalSshArgs('h1', 'echo ok', { connectTimeoutSec: 10 }))
      .toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'h1', 'echo ok']);
  });

  it('still never passes -F /dev/null', () => {
    expect(buildExternalSshArgs('h1', 'echo ok', { connectTimeoutSec: 10 })).not.toContain('-F');
  });
});

describe('buildSshConfigDumpArgs', () => {
  it('asks ssh to dump the resolved config for the alias', () => {
    expect(buildSshConfigDumpArgs('h1')).toEqual(['-G', 'h1']);
  });

  it('does not pass -F /dev/null', () => {
    expect(buildSshConfigDumpArgs('h1')).not.toContain('-F');
  });
});
```

Add `buildSshConfigDumpArgs` to the existing import at the top of that file.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/transport/external-ssh-args.test.ts
```
Expected: FAIL — `buildSshConfigDumpArgs is not a function`, and the `wpCliBin`/`connectTimeoutSec` cases return the un-parameterised strings.

- [ ] **Step 3: Implement**

Replace `buildExternalWpCliCommand` (keep the existing docblock above it, and add the new paragraph):

```ts
/**
 * ... existing docblock ...
 *
 * `wpCliBin` is the absolute path to WP-CLI when it is not on the remote's
 * non-interactive PATH — the common failure, since ~/.bashrc frequently
 * early-returns when there is no tty. Undefined means plain `wp`. It is third,
 * not second: swapping it with wpPath compiles (both are `string | undefined`)
 * and silently transposes the one existing call site.
 */
export function buildExternalWpCliCommand(args: string[], wpPath?: string, wpCliBin?: string): string {
  const bin = wpCliBin ? escapeShellArg(wpCliBin) : 'wp';
  const pathFlag = wpPath ? `--path=${escapeShellArg(wpPath)} ` : '';
  return `${bin} ${pathFlag}${args.map(escapeShellArg).join(' ')}`.trim();
}
```

Replace `buildExternalSshArgs`'s body (keep the whole INVERTED RULE docblock; append the ConnectTimeout paragraph to it):

```ts
/**
 * ... existing INVERTED RULE docblock ...
 *
 * connectTimeoutSec bounds the TCP connect only, not the session. The probe
 * sets it so an unreachable host fails while the user is watching instead of
 * waiting out the full spawn timeout.
 */
export function buildExternalSshArgs(
  alias: string,
  remoteCommand: string,
  opts?: { connectTimeoutSec?: number },
): string[] {
  const connectTimeout = opts?.connectTimeoutSec
    ? ['-o', `ConnectTimeout=${opts.connectTimeoutSec}`]
    : [];
  return [
    '-o', 'BatchMode=yes',
    ...connectTimeout,
    alias,
    remoteCommand,
  ];
}

/**
 * Ask ssh to print the config it would use for an alias (hostname, user, port).
 *
 * Resolution, NOT validation: `ssh -G` exits 0 for an alias that appears in no
 * config file, returning the literal alias as hostname, the local username, and
 * port 22. It cannot distinguish a configured alias from a typo, so nothing may
 * gate on its exit code. Its output exists to build an accurate ssh-copy-id
 * remedy; connectivity is what actually validates the alias.
 *
 * No -F /dev/null, for the same reason as buildExternalSshArgs.
 */
export function buildSshConfigDumpArgs(alias: string): string[] {
  return ['-G', alias];
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/transport/external-ssh-args.test.ts tests/unit/transport/ssh-argv-characterization.test.ts
```
Expected: PASS, including the WPE characterization suite — the WPE argv must be byte-identical.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/ssh-args.ts tests/unit/transport/external-ssh-args.test.ts
git commit -m "feat(transport): parameterise WP-CLI binary and ssh ConnectTimeout"
```

---

## Task 2: Profile store — `wpCliPath` and removal

**Files:**
- Modify: `src/main/external/externalSiteStore.ts`
- Test: `tests/unit/external/external-site-store.test.ts`

**Interfaces:**
- Consumes: `ExternalSiteProfile`, `upsertExternalProfile` (existing)
- Produces: `ExternalSiteProfile.wpCliPath?: string`; `removeExternalProfile(storage: Storage, alias: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/external/external-site-store.test.ts` (reuse whatever in-memory storage double the file already defines):

```ts
describe('wpCliPath', () => {
  it('round-trips an absolute WP-CLI path', () => {
    const s = makeStorage();
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is not erased by a later upsert that omits it', () => {
    const s = makeStorage();
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 2, lastSeenAt: 2 });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is replaced when a later upsert supplies a different one', () => {
    const s = makeStorage();
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/opt/wp',
      firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/opt/wp');
  });
});

describe('removeExternalProfile', () => {
  it('removes only the named alias and reports true', () => {
    const s = makeStorage();
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'h2', environment: 'staging', firstSeenAt: 1, lastSeenAt: 1 });
    expect(removeExternalProfile(s, 'h1')).toBe(true);
    expect(getExternalProfile(s, 'h1')).toBeNull();
    expect(getExternalProfile(s, 'h2')).not.toBeNull();
  });

  it('reports false for an unknown alias and writes nothing', () => {
    const s = makeStorage();
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    const writesBefore = s.writeCount;
    expect(removeExternalProfile(s, 'nope')).toBe(false);
    expect(s.writeCount).toBe(writesBefore);
    expect(listExternalProfiles(s)).toHaveLength(1);
  });
});
```

If the file's storage double does not already count writes, add a `writeCount` counter to it, incremented in `set`.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/external/external-site-store.test.ts
```
Expected: FAIL — `removeExternalProfile is not a function`; the omit-test fails because `wpCliPath` is dropped.

- [ ] **Step 3: Implement**

Add the field to the interface, after `wpPath`:

```ts
  /**
   * Absolute path to WP-CLI, stored only when it is NOT on the remote's
   * non-interactive PATH. Undefined means plain `wp` works. Discovered by the
   * registration probe; without persisting it, every later command repeats the
   * same "wp: command not found" the probe already diagnosed.
   */
  wpCliPath?: string;
```

Extend the merge in `upsertExternalProfile` and its docblock:

```ts
 * `wpPath` and `wpCliPath` are only replaced when the incoming profile supplies
 * them: a command run without --path, or a sighting that never probed for the
 * binary, must not erase what registration discovered.
 */
export function upsertExternalProfile(storage: Storage, profile: ExternalSiteProfile): void {
  const all = readAll(storage);
  const existing = all[profile.alias];
  all[profile.alias] = {
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    wpPath: profile.wpPath ?? existing?.wpPath,
    wpCliPath: profile.wpCliPath ?? existing?.wpCliPath,
  };
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
}

/**
 * Forget a host. Returns false when the alias was not registered, and writes
 * nothing in that case — a no-op must not rewrite the whole record.
 */
export function removeExternalProfile(storage: Storage, alias: string): boolean {
  const all = readAll(storage);
  if (!(alias in all)) return false;
  delete all[alias];
  storage.set(STORAGE_KEYS.EXTERNAL_SITE_PROFILES, all);
  return true;
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/external/
```
Expected: PASS, including the existing `lazy-upsert.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main/external/externalSiteStore.ts tests/unit/external/external-site-store.test.ts
git commit -m "feat(external): store discovered WP-CLI path, add profile removal"
```

---

## Task 3: The ssh exec primitive and `resolveSshConfig`

**Files:**
- Create: `src/main/external/sshExec.ts`
- Test: `tests/unit/external/probe-external-host.test.ts` (new; grows through Task 4)

**Interfaces:**
- Consumes: `buildSshConfigDumpArgs` (Task 1)
- Produces: `RawSshResult`, `SshExec`, `defaultSshExec`, `resolveSshConfig(alias: string, exec?: SshExec): Promise<ResolvedSshConfig>`, `ResolvedSshConfig`

`SshExec` takes the full argv so tests assert the exact arguments — that is what catches an escaping mistake. Injection rather than `jest.mock('child_process')`: the probe makes six or more calls with different argv, and driving that through a mocked EventEmitter is brittle.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/external/probe-external-host.test.ts`:

```ts
import { resolveSshConfig } from '../../../src/main/external/sshExec';
import type { SshExec } from '../../../src/main/external/sshExec';

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

function execReturning(stdout: string, seen: string[][] = []): SshExec {
  return async (args) => { seen.push(args); return ok(stdout); };
}

const SSH_G_OUTPUT = [
  'host example',
  'user deploy',
  'hostname 203.0.113.10',
  'port 2222',
  'identityfile ~/.ssh/id_ed25519',
].join('\n');

describe('resolveSshConfig', () => {
  it('parses hostname, user and port from ssh -G', async () => {
    const cfg = await resolveSshConfig('example', execReturning(SSH_G_OUTPUT));
    expect(cfg).toEqual({ hostname: '203.0.113.10', user: 'deploy', port: '2222' });
  });

  it('invokes ssh -G <alias> and nothing else', async () => {
    const seen: string[][] = [];
    await resolveSshConfig('example', execReturning(SSH_G_OUTPUT, seen));
    expect(seen).toEqual([['-G', 'example']]);
  });

  it('is case-insensitive on keys, as ssh -G output can vary', async () => {
    const cfg = await resolveSshConfig('example', execReturning('HostName 10.0.0.1\nUser bob\nPort 22'));
    expect(cfg).toEqual({ hostname: '10.0.0.1', user: 'bob', port: '22' });
  });

  it('falls back to the alias and sane defaults when ssh -G yields nothing', async () => {
    const cfg = await resolveSshConfig('example', async () => ({ code: 255, stdout: '', stderr: 'boom' }));
    expect(cfg).toEqual({ hostname: 'example', user: '', port: '22' });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
npx jest tests/unit/external/probe-external-host.test.ts
```
Expected: FAIL — cannot resolve `src/main/external/sshExec`.

- [ ] **Step 3: Implement**

Create `src/main/external/sshExec.ts`:

```ts
import { spawn } from 'child_process';
import { buildSshConfigDumpArgs } from '../transport/ssh-args';

export interface RawSshResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

/**
 * Spawn ssh with an exact argv and collect the result.
 *
 * Injected rather than mocked so tests can assert the argv itself — the escaping
 * of a --path value is only visible there.
 */
export type SshExec = (args: string[], timeoutMs: number) => Promise<RawSshResult>;

export const defaultSshExec: SshExec = (args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) =>
      resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });

export interface ResolvedSshConfig {
  hostname: string;
  user: string;
  port: string;
}

export const SSH_CONFIG_DUMP_TIMEOUT_MS = 5000;

/**
 * What ssh will actually use for this alias.
 *
 * RESOLUTION, NOT VALIDATION. `ssh -G` exits 0 for an alias in no config file,
 * echoing the alias back as hostname with the local username and port 22, so a
 * successful call proves nothing about whether the alias is configured. Its job
 * is to make the ssh-copy-id remedy correct; connectivity is the real gate.
 */
export async function resolveSshConfig(
  alias: string,
  exec: SshExec = defaultSshExec,
): Promise<ResolvedSshConfig> {
  const res = await exec(buildSshConfigDumpArgs(alias), SSH_CONFIG_DUMP_TIMEOUT_MS);
  const fields = new Map<string, string>();
  for (const line of res.stdout.split('\n')) {
    const m = /^\s*(\S+)\s+(.*)$/.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      if (!fields.has(key)) fields.set(key, m[2].trim());
    }
  }
  return {
    hostname: fields.get('hostname') || alias,
    user: fields.get('user') || '',
    port: fields.get('port') || '22',
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/external/probe-external-host.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/external/sshExec.ts tests/unit/external/probe-external-host.test.ts
git commit -m "feat(external): injectable ssh exec and ssh -G config resolution"
```

---

## Task 4: `probeExternalHost` — the four gates

**Files:**
- Create: `src/main/external/probeExternalHost.ts`
- Modify: `tests/unit/external/probe-external-host.test.ts`

**Interfaces:**
- Consumes: `SshExec`, `defaultSshExec`, `resolveSshConfig`, `ResolvedSshConfig` (Task 3); `buildExternalSshArgs`, `buildExternalWpCliCommand`, `escapeShellArg` (Task 1)
- Produces: `probeExternalHost(alias: string, opts?: ProbeOptions): Promise<ProbeReport>`, `ProbeReport`, `ProbeFailureKind`, `ProbeOptions`

The gates short-circuit in order. Gate 1's `auth-failed` remedy is the highest-value output in the whole plan — it is what a password-only host produces, which is the first thing a real user hits.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/external/probe-external-host.test.ts`:

```ts
import { probeExternalHost } from '../../../src/main/external/probeExternalHost';

/**
 * Route fake results by matching the remote command (the last argv element).
 * `-G` is matched separately since it carries no remote command.
 */
function router(routes: Array<[RegExp, RawSshResult]>, seen: string[][] = []): SshExec {
  return async (args) => {
    seen.push(args);
    if (args[0] === '-G') return ok(SSH_G_OUTPUT);
    const remote = args[args.length - 1];
    for (const [re, res] of routes) if (re.test(remote)) return res;
    return { code: 127, stdout: '', stderr: 'unrouted: ' + remote };
  };
}

const CONNECT_OK: [RegExp, RawSshResult] = [/echo nexus-ok/, ok('nexus-ok\n')];
const WP_ON_PATH: [RegExp, RawSshResult] = [/command -v wp/, ok('/usr/bin/wp\n')];
const WP_VERSION: [RegExp, RawSshResult] = [/--version/, ok('WP-CLI 2.12.0\n')];
const FIND_ONE: [RegExp, RawSshResult] = [/wp-config\.php/, ok('/home/u/public_html/wp-config.php\n')];
const CORE_VERSION: [RegExp, RawSshResult] = [/'core' 'version'/, ok('6.8.1\n')];
const SITEURL: [RegExp, RawSshResult] = [/'option' 'get' 'siteurl'/, ok('https://example.com\n')];

const HAPPY = [CONNECT_OK, WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL];

describe('probeExternalHost — happy path', () => {
  it('reports ok with everything it discovered', async () => {
    const r = await probeExternalHost('example', { exec: router(HAPPY) });
    expect(r.ok).toBe(true);
    expect(r.failure).toBeUndefined();
    expect(r.wpPath).toBe('/home/u/public_html');
    expect(r.wpVersion).toBe('6.8.1');
    expect(r.wpCliVersion).toBe('2.12.0');
    expect(r.siteUrl).toBe('https://example.com');
    expect(r.resolved).toEqual({ hostname: '203.0.113.10', user: 'deploy', port: '2222' });
  });

  it('leaves wpCliPath undefined when wp is on PATH', async () => {
    const r = await probeExternalHost('example', { exec: router(HAPPY) });
    expect(r.wpCliPath).toBeUndefined();
  });

  it('skips discovery when a path is supplied, and escapes it', async () => {
    const seen: string[][] = [];
    const r = await probeExternalHost('example', {
      wpPath: "/home/u/o'brien",
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, CORE_VERSION, SITEURL], seen),
    });
    expect(r.ok).toBe(true);
    expect(r.wpPath).toBe("/home/u/o'brien");
    const remotes = seen.map((a) => a[a.length - 1]);
    expect(remotes.some((c) => /wp-config\.php/.test(c))).toBe(false);
    expect(remotes.some((c) => c.includes("--path='/home/u/o'\\''brien'"))).toBe(true);
  });

  it('survives a siteurl failure — a broken DB must not block registration', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION,
        [/'option' 'get' 'siteurl'/, { code: 1, stdout: '', stderr: 'Error establishing a database connection' }]]),
    });
    expect(r.ok).toBe(true);
    expect(r.siteUrl).toBeUndefined();
  });
});

describe('probeExternalHost — gate 1', () => {
  it('diagnoses password-only auth with a pasteable ssh-copy-id line', async () => {
    const r = await probeExternalHost('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'deploy@203.0.113.10: Permission denied (publickey,password).' }]]),
    });
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe('auth-failed');
    // Must carry the RESOLVED user and port, not the alias.
    expect(r.failure?.remedy).toContain('ssh-copy-id');
    expect(r.failure?.remedy).toContain('-p 2222');
    expect(r.failure?.remedy).toContain('deploy@203.0.113.10');
    expect(r.failure?.remedy).not.toContain('example@');
    // ssh's own words survive — that is what a user searches for.
    expect(r.failure?.detail).toContain('Permission denied (publickey,password)');
  });

  it('diagnoses an unconfigured alias at gate 1, not before it', async () => {
    const seen: string[][] = [];
    const r = await probeExternalHost('typo', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: Could not resolve hostname typo: nodename nor servname provided' }]], seen),
    });
    expect(r.failure?.kind).toBe('alias-not-found');
    expect(r.failure?.remedy).toContain('~/.ssh/config');
    // ssh -G ran, and did NOT reject the alias by itself.
    expect(seen[0]).toEqual(['-G', 'typo']);
    expect(seen.some((a) => /echo nexus-ok/.test(a[a.length - 1]))).toBe(true);
  });

  it('reports anything else as unreachable with stderr verbatim', async () => {
    const r = await probeExternalHost('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: connect to host port 22: Connection refused' }]]),
    });
    expect(r.failure?.kind).toBe('unreachable');
    expect(r.failure?.detail).toContain('Connection refused');
  });

  it('reports a local spawn failure as unreachable', async () => {
    const r = await probeExternalHost('example', {
      exec: async (args) => (args[0] === '-G'
        ? ok(SSH_G_OUTPUT)
        : { code: null, stdout: '', stderr: '', spawnError: 'spawn ssh ENOENT' }),
    });
    expect(r.failure?.kind).toBe('unreachable');
    expect(r.failure?.detail).toContain('ENOENT');
  });
});

describe('probeExternalHost — gate 2', () => {
  it('falls back to known locations when wp is off PATH, and stores the path', async () => {
    const r = await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, ok('/opt/cpanel/composer/bin/wp\n')],
        WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL,
      ]),
    });
    expect(r.ok).toBe(true);
    expect(r.wpCliPath).toBe('/opt/cpanel/composer/bin/wp');
  });

  it('uses the discovered binary for every later command', async () => {
    const seen: string[][] = [];
    await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, ok('/opt/cpanel/composer/bin/wp\n')],
        WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL,
      ], seen),
    });
    const coreCall = seen.map((a) => a[a.length - 1]).find((c) => /'core' 'version'/.test(c))!;
    expect(coreCall.startsWith("'/opt/cpanel/composer/bin/wp' ")).toBe(true);
  });

  it('refuses with an install command when WP-CLI is genuinely absent', async () => {
    const r = await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, { code: 1, stdout: '', stderr: '' }],
      ]),
    });
    expect(r.failure?.kind).toBe('wp-cli-missing');
    expect(r.failure?.remedy).toContain('wp-cli.phar');
    expect(r.ok).toBe(false);
  });
});

describe('probeExternalHost — gate 3', () => {
  it('finds WordPress under ~/domains/<site>/public_html', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/domains/example.com/public_html/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.wpPath).toBe('/home/u/domains/example.com/public_html');
  });

  it('asks for --path when nothing is found', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, [/wp-config\.php/, { code: 1, stdout: '', stderr: '' }]]),
    });
    expect(r.failure?.kind).toBe('wordpress-not-found');
    expect(r.failure?.remedy).toContain('--path');
  });

  it('lists every candidate and refuses when several are found', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/a/wp-config.php\n/home/u/b/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.failure?.kind).toBe('multiple-wordpress');
    expect(r.candidates).toEqual(['/home/u/a', '/home/u/b']);
    expect(r.failure?.remedy).toContain('--path');
  });

  it('deduplicates repeated roots rather than calling them ambiguous', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/a/wp-config.php\n/home/u/a/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.ok).toBe(true);
    expect(r.wpPath).toBe('/home/u/a');
  });
});

describe('probeExternalHost — gate 4', () => {
  it("reports WP-CLI's own message when the path is not WordPress", async () => {
    const r = await probeExternalHost('example', {
      wpPath: '/home/u/empty',
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/'core' 'version'/, { code: 1, stdout: '', stderr: "Error: This does not seem to be a WordPress installation." }]]),
    });
    expect(r.failure?.kind).toBe('wordpress-not-found');
    expect(r.failure?.detail).toContain('does not seem to be a WordPress installation');
  });
});
```

Add `RawSshResult` to the `sshExec` import at the top of the file.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/external/probe-external-host.test.ts
```
Expected: FAIL — cannot resolve `src/main/external/probeExternalHost`.

- [ ] **Step 3: Implement**

Create `src/main/external/probeExternalHost.ts`:

```ts
import { buildExternalSshArgs, buildExternalWpCliCommand, escapeShellArg } from '../transport/ssh-args';
import { defaultSshExec, resolveSshConfig } from './sshExec';
import type { RawSshResult, ResolvedSshConfig, SshExec } from './sshExec';

export type ProbeFailureKind =
  | 'alias-not-found'
  | 'auth-failed'
  | 'unreachable'
  | 'wp-cli-missing'
  | 'wordpress-not-found'
  | 'multiple-wordpress';

export interface ProbeFailure {
  kind: ProbeFailureKind;
  /** ssh's or WP-CLI's own words, verbatim — that is what a user can search for. */
  detail: string;
  /** A command or concrete action, never advice. */
  remedy: string;
}

export interface ProbeReport {
  ok: boolean;
  alias: string;
  resolved: ResolvedSshConfig;
  /** Absolute path to WP-CLI when it is off PATH. Undefined means plain `wp`. */
  wpCliPath?: string;
  wpCliVersion?: string;
  wpPath?: string;
  wpVersion?: string;
  /** From `option get siteurl`. Absent when the DB is unreachable — not a failure. */
  siteUrl?: string;
  /** WordPress roots found when discovery was ambiguous. */
  candidates?: string[];
  failure?: ProbeFailure;
}

export interface ProbeOptions {
  wpPath?: string;
  exec?: SshExec;
}

const CONNECT_TIMEOUT_SEC = 10;
const STEP_TIMEOUT_MS = 20000;
/** Discovery walks the filesystem; it gets longer than a command that just prints. */
const DISCOVERY_TIMEOUT_MS = 30000;

/** Roots searched for wp-config.php, and the depth limit. Never an unbounded walk. */
const SEARCH_ROOTS = ['"$HOME"', '/var/www/html', '/srv/www'];
/**
 * 4, because Hostinger's layout is ~/domains/<site>/public_html/wp-config.php —
 * exactly four levels below $HOME. Three would miss the case that motivated
 * discovery in the first place.
 */
const SEARCH_MAXDEPTH = 4;

/**
 * Where WP-CLI hides when the login shell's PATH is not the non-interactive
 * PATH — the likelier failure by far, since ~/.bashrc commonly early-returns
 * when there is no tty.
 */
const WP_CLI_FALLBACK_PATHS = [
  '/usr/local/bin/wp',
  '"$HOME/bin/wp"',
  '/opt/cpanel/composer/bin/wp',
  '/usr/bin/wp',
];

const WP_CLI_INSTALL_REMEDY =
  'Install WP-CLI on the host, then re-run:\n'
  + '  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n'
  + '  chmod +x wp-cli.phar && sudo mv wp-cli.phar /usr/local/bin/wp\n'
  + 'Nexus does not install anything on your server.';

function fail(
  alias: string,
  resolved: ResolvedSshConfig,
  kind: ProbeFailureKind,
  detail: string,
  remedy: string,
  extra: Partial<ProbeReport> = {},
): ProbeReport {
  return { ok: false, alias, resolved, ...extra, failure: { kind, detail: detail.trim(), remedy } };
}

/** Text a caller should treat as the reason, whether ssh failed locally or remotely. */
function reason(res: RawSshResult): string {
  return (res.spawnError ?? res.stderr ?? '').trim();
}

export async function probeExternalHost(alias: string, opts: ProbeOptions = {}): Promise<ProbeReport> {
  const exec = opts.exec ?? defaultSshExec;
  const resolved = await resolveSshConfig(alias, exec);

  const run = (command: string, timeoutMs = STEP_TIMEOUT_MS) =>
    exec(buildExternalSshArgs(alias, command, { connectTimeoutSec: CONNECT_TIMEOUT_SEC }), timeoutMs);

  // ---- Gate 1: can we connect at all? -------------------------------------
  const connect = await run('echo nexus-ok');
  if (connect.code !== 0 || !connect.stdout.includes('nexus-ok')) {
    const detail = reason(connect) || `ssh exited with code ${connect.code}`;

    if (/could not resolve hostname/i.test(detail)) {
      return fail(alias, resolved, 'alias-not-found', detail,
        `'${alias}' is not a host ssh can reach. If it is meant to be an SSH alias, add it to ~/.ssh/config:\n\n`
        + `  Host ${alias}\n`
        + `      HostName <server-ip-or-domain>\n`
        + `      User <ssh-username>\n`
        + `      Port 22\n\n`
        + `Then re-run: nexus host test ${alias}`);
    }

    if (/permission denied/i.test(detail)) {
      const account = resolved.user ? `${resolved.user}@${resolved.hostname}` : resolved.hostname;
      return fail(alias, resolved, 'auth-failed', detail,
        `Key-based login is not set up. Copy your public key to the host (it will ask for your password once):\n\n`
        + `  ssh-copy-id -i ~/.ssh/id_ed25519.pub -p ${resolved.port} ${account}\n\n`
        + `Then re-run: nexus host test ${alias}\n`
        + `Nexus does not run this for you — it will not handle your password.`);
    }

    return fail(alias, resolved, 'unreachable', detail,
      `Check the host is up and the alias is right:\n  ssh -v ${alias}`);
  }

  // ---- Gate 2: locate WP-CLI ----------------------------------------------
  let wpCliPath: string | undefined;
  const onPath = await run('command -v wp 2>/dev/null');
  if (onPath.code !== 0 || !onPath.stdout.trim()) {
    // Not on the non-interactive PATH. Look where it usually is before
    // concluding it is absent — Nexus never installs it either way.
    const search = `for p in ${WP_CLI_FALLBACK_PATHS.join(' ')}; do [ -x "$p" ] && printf '%s\\n' "$p" && break; done`;
    const found = await run(search);
    const hit = found.stdout.trim().split('\n')[0]?.trim();
    if (!hit) {
      return fail(alias, resolved, 'wp-cli-missing',
        reason(onPath) || 'wp: command not found', WP_CLI_INSTALL_REMEDY);
    }
    wpCliPath = hit;
  }

  const wpCli = (args: string[], wpPath?: string) =>
    buildExternalWpCliCommand(args, wpPath, wpCliPath);

  const cliVersion = await run(wpCli(['--version']));
  const wpCliVersion = /WP-CLI\s+(\S+)/i.exec(cliVersion.stdout)?.[1];

  // ---- Gate 3: find the WordPress root ------------------------------------
  let wpPath = opts.wpPath;
  let candidates: string[] | undefined;

  if (!wpPath) {
    // Bounded: fixed roots, fixed depth. `2>/dev/null` swallows unreadable and
    // nonexistent roots, so the exit code is meaningless here — judge by output.
    const find =
      `find ${SEARCH_ROOTS.join(' ')} -maxdepth ${SEARCH_MAXDEPTH} -name wp-config.php -type f 2>/dev/null | head -20`;
    const found = await run(find, DISCOVERY_TIMEOUT_MS);
    const roots = Array.from(new Set(
      found.stdout.split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((f) => f.replace(/\/wp-config\.php$/, '')),
    ));

    if (roots.length === 0) {
      return fail(alias, resolved, 'wordpress-not-found',
        `No wp-config.php found within ${SEARCH_MAXDEPTH} levels of ${SEARCH_ROOTS.join(', ')}.`,
        `Point Nexus at it directly:\n  nexus host add ${alias} --path /absolute/path/to/wordpress`,
        { wpCliPath, wpCliVersion });
    }
    if (roots.length > 1) {
      return fail(alias, resolved, 'multiple-wordpress',
        `Found ${roots.length} WordPress installations:\n${roots.map((r) => `  ${r}`).join('\n')}`,
        `Choose one:\n  nexus host add ${alias} --path ${roots[0]}`,
        { wpCliPath, wpCliVersion, candidates: roots });
    }
    wpPath = roots[0];
    candidates = roots;
  }

  // ---- Gate 4: is it really WordPress? ------------------------------------
  const core = await run(wpCli(['core', 'version'], wpPath));
  if (core.code !== 0) {
    return fail(alias, resolved, 'wordpress-not-found',
      reason(core) || `wp core version exited with code ${core.code}`,
      `Check the path, then re-run:\n  nexus host add ${alias} --path <correct-path>`,
      { wpCliPath, wpCliVersion, wpPath, candidates });
  }

  // Best-effort. `option get` needs a working DB connection, and a broken DB is
  // not a reason to refuse a host whose files and WP-CLI are fine.
  const site = await run(wpCli(['option', 'get', 'siteurl'], wpPath));
  const siteUrl = site.code === 0 ? site.stdout.trim() || undefined : undefined;

  return {
    ok: true,
    alias,
    resolved,
    wpCliPath,
    wpCliVersion,
    wpPath,
    wpVersion: core.stdout.trim(),
    siteUrl,
    candidates,
  };
}
```

Note `escapeShellArg` is imported for symmetry with the builders but all escaping happens inside `buildExternalWpCliCommand`; if the implementer finds no direct use, drop it from the import rather than leaving it unused.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/external/probe-external-host.test.ts
npx tsc --noEmit
```
Expected: PASS, and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/main/external/probeExternalHost.ts tests/unit/external/probe-external-host.test.ts
git commit -m "feat(external): host probe with per-failure diagnoses and remedies"
```

---

## Task 5: Wire discoveries into the transport

**Files:**
- Modify: `src/main/transport/ExternalSshTransport.ts:33-45` (`annotateFailure`), `:58` (constructor), `:68` (call)
- Modify: `src/main/transport/resolve.ts:50-51`
- Test: `tests/unit/transport/external-ssh-resolution.test.ts`

**Interfaces:**
- Consumes: `buildExternalWpCliCommand(args, wpPath, wpCliBin)` (Task 1); `getExternalProfile` (existing)
- Produces: `new ExternalSshTransport(alias, wpPath?, wpCliBin?)`

**This task is why registration is worth anything.** Without it the probe discovers a path and a binary, stores them, and no later command ever reads them back.

Precedence: an explicit `--path` beats the stored profile. The user typing a path means it for this call.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/transport/external-ssh-resolution.test.ts`, following that file's existing `services` fixture shape:

```ts
describe('resolveTransport — stored external profile', () => {
  function servicesWithProfile(profile: any) {
    const store: Record<string, unknown> = {};
    // STORAGE_KEYS.EXTERNAL_SITE_PROFILES is `nexus-ai_external_site_profiles`
    // (src/common/constants.ts:307). Import the constant; never hardcode it.
    if (profile) store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = { [profile.alias]: profile };
    return {
      registryStorage: {
        get: (k: string) => store[k],
        set: (k: string, v: unknown) => { store[k] = v; },
      },
    } as any;
  }

  it('uses the stored wpPath when no --path is given', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpPath: '/home/u/public_html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t: any = await resolveTransport({ ssh_target: 'ssh:h1@production' }, services, 'wp_core_version');
    expect(t.wpPath ?? t.inner?.wpPath).toBe('/home/u/public_html');
  });

  it('lets an explicit wp_path override the stored one', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpPath: '/home/u/public_html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t: any = await resolveTransport(
      { ssh_target: 'ssh:h1@production', wp_path: '/srv/other' }, services, 'wp_core_version');
    expect(t.wpPath ?? t.inner?.wpPath).toBe('/srv/other');
  });

  it('passes the stored wpCliPath through', async () => {
    const services = servicesWithProfile({
      alias: 'h1', wpCliPath: '/opt/cpanel/composer/bin/wp', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    const t: any = await resolveTransport({ ssh_target: 'ssh:h1@production' }, services, 'wp_core_version');
    expect(t.wpCliBin ?? t.inner?.wpCliBin).toBe('/opt/cpanel/composer/bin/wp');
  });

  it('resolves an unregistered alias without throwing', async () => {
    const t: any = await resolveTransport(
      { ssh_target: 'ssh:unknown@production' }, servicesWithProfile(null), 'wp_core_version');
    expect(t).toBeDefined();
    expect('content' in t).toBe(false);
  });
});
```

Add `import { STORAGE_KEYS } from '../../../src/common/constants';` to the test file.

Two notes for the implementer. The constructor fields are `private readonly`, so read them through `as any` or make them `readonly` (not `private`) — do not add getters just for tests. And `withPolicy` may return a wrapper; the `t.x ?? t.inner?.x` form covers both, but if the wrapper's property name differs, fix the assertion to match reality rather than adding a passthrough.

- [ ] **Step 2: Run and verify they fail**

```bash
npx jest tests/unit/transport/external-ssh-resolution.test.ts
```
Expected: FAIL — the stored `wpPath` is ignored and `wpCliBin` does not exist.

- [ ] **Step 3: Implement**

In `ExternalSshTransport.ts`, extend the constructor and the call:

```ts
  constructor(
    private readonly alias: string,
    private readonly wpPath?: string,
    /** Absolute WP-CLI path when it is off the remote's PATH; undefined means `wp`. */
    private readonly wpCliBin?: string,
  ) {
    this.siteRef = { kind: 'external', alias };
  }
```

```ts
    const res = await runSsh(this.alias, buildExternalWpCliCommand(args, this.wpPath, this.wpCliBin));
```

Replace the stale hint in `annotateFailure` — WP-CLI location is no longer an unimplemented gap:

```ts
  if (/command not found|wp: not found/i.test(text)) {
    return `${text}\n\nHint: WP-CLI ('wp') was not found on the remote host's non-interactive `
      + `PATH. Run 'nexus host test <alias>' — it searches the usual locations and will tell you `
      + `whether WP-CLI is missing or just off PATH.`;
  }
```

In `resolve.ts`, replace lines 50-51:

```ts
    // Registration (nexus host add) stores what the probe discovered. Reading it
    // back here is the whole point: otherwise a registered host still needs
    // --path on every command. An explicit wp_path wins — the user meant it.
    const storage = (services as any).registryStorage;
    const profile = storage ? getExternalProfile(storage, parsed.alias) : null;
    const explicitPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;
    const wpPath = explicitPath ?? profile?.wpPath;
    return withPolicy(
      new ExternalSshTransport(parsed.alias, wpPath, profile?.wpCliPath),
      EXTERNAL_REMOTE_POLICY,
    );
```

Add the import at the top of `resolve.ts`:

```ts
import { getExternalProfile } from '../external/externalSiteStore';
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/transport/ tests/unit/external/
npx tsc --noEmit
```
Expected: PASS, including `conformance.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/ExternalSshTransport.ts src/main/transport/resolve.ts tests/unit/transport/external-ssh-resolution.test.ts
git commit -m "feat(transport): read stored wpPath and WP-CLI path back from the profile"
```

---

## Task 6: GraphQL surface

**Files:**
- Modify: `src/main/graphql/schema.ts` (append a new `extend type Mutation` block plus types, following the existing pattern at `:1667`)
- Modify: `src/main/graphql/resolvers.ts` (add to the `Mutation` resolver map, beside `nexusWpCommand` at `:1611`)

**Interfaces:**
- Consumes: `probeExternalHost` (Task 4); `externalSiteId`, `upsertExternalProfile`, `listExternalProfiles`, `removeExternalProfile`, `getExternalProfile` (Task 2)
- Produces: mutations `nexusHostProbe`, `nexusHostAdd`, `nexusHostList`, `nexusHostRemove`

This project puts read operations under `Mutation` too (`nexusSitesList`, `:779`) — follow that, do not invent a `Query` convention here.

Not audited: the probe's remote commands are read-only, and add/remove mutate only local addon state. Per CLAUDE.md, `auditDirectOperation` is for mutating operations that reach `services.localServices`; these do not.

- [ ] **Step 1: Add the schema**

Append to `src/main/graphql/schema.ts`:

```graphql
  type NexusHostProbeFailure {
    "One of: alias-not-found, auth-failed, unreachable, wp-cli-missing, wordpress-not-found, multiple-wordpress"
    kind: String!
    "ssh's or WP-CLI's own output, verbatim"
    detail: String!
    "The exact next command or action"
    remedy: String!
  }

  type NexusHostProbeReport {
    ok: Boolean!
    alias: String!
    "Resolved by ssh -G. Defaults when the alias is not in ~/.ssh/config."
    hostname: String!
    user: String!
    port: String!
    "Absolute WP-CLI path when off PATH; null means plain wp works"
    wpCliPath: String
    wpCliVersion: String
    wpPath: String
    wpVersion: String
    siteUrl: String
    "WordPress roots found when discovery was ambiguous"
    candidates: [String!]
    failure: NexusHostProbeFailure
  }

  type NexusHostEntry {
    alias: String!
    wpPath: String
    wpCliPath: String
    environment: String!
    firstSeenAt: Float!
    lastSeenAt: Float!
  }

  type NexusHostProbeResult {
    success: Boolean!
    error: String
    report: NexusHostProbeReport
  }

  type NexusHostAddResult {
    success: Boolean!
    error: String
    report: NexusHostProbeReport
    registered: Boolean!
  }

  type NexusHostListResult {
    success: Boolean!
    error: String
    hosts: [NexusHostEntry!]!
  }

  type NexusHostRemoveResult {
    success: Boolean!
    error: String
    removed: Boolean!
  }

  extend type Mutation {
    "Probe an external SSH host. Persists nothing."
    nexusHostProbe(alias: String!, path: String): NexusHostProbeResult!
    "Probe an external SSH host and register it on success."
    nexusHostAdd(alias: String!, path: String, environment: String): NexusHostAddResult!
    "List registered external SSH hosts."
    nexusHostList: NexusHostListResult!
    "Forget an external SSH host."
    nexusHostRemove(alias: String!): NexusHostRemoveResult!
  }
```

`Float` for epoch timestamps, matching `lastIndexed: Float` at `:39`. GraphQL `Int` is 32-bit and epoch milliseconds overflow it.

- [ ] **Step 2: Add the resolvers**

Add to the `Mutation` map in `resolvers.ts`:

```ts
      nexusHostProbe: async (_p: ResolverParent, { alias, path }: { alias: string; path?: string }) => {
        return withQueue(async () => {
          try {
            const { probeExternalHost } = require('../external/probeExternalHost');
            const report = await probeExternalHost(alias, { wpPath: path ?? undefined });
            return { success: true, error: null, report: toHostReport(report) };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), report: null };
          }
        });
      },

      nexusHostAdd: async (
        _p: ResolverParent,
        { alias, path, environment }: { alias: string; path?: string; environment?: string },
      ) => {
        return withQueue(async () => {
          try {
            const env = environment ?? 'production';
            if (!['production', 'staging', 'development'].includes(env)) {
              return {
                success: false, registered: false, report: null,
                error: `Invalid environment '${env}'. Expected production, staging or development.`,
              };
            }
            const storage = (services as any).registryStorage;
            if (!storage) {
              return { success: false, registered: false, report: null, error: 'Storage not available' };
            }

            const { probeExternalHost } = require('../external/probeExternalHost');
            const report = await probeExternalHost(alias, { wpPath: path ?? undefined });

            // Refuse on any probe failure: a typo must not litter the fleet with
            // hosts that were never reachable.
            if (!report.ok) {
              return { success: true, registered: false, report: toHostReport(report), error: null };
            }

            const { externalSiteId, upsertExternalProfile } = require('../external/externalSiteStore');
            const now = Date.now();
            upsertExternalProfile(storage, {
              alias,
              wpPath: report.wpPath,
              wpCliPath: report.wpCliPath,
              environment: env,
              firstSeenAt: now,
              lastSeenAt: now,
            });

            let domain = alias;
            if (report.siteUrl) {
              try { domain = new URL(report.siteUrl).hostname || alias; } catch { /* keep alias */ }
            }

            await (services as any).graphService?.upsertSite({
              id: externalSiteId(alias),
              name: alias,
              domain,
              source: 'external',
              host: 'external',
              environment: env,
              wp_version: report.wpVersion,
              is_active: true,
              created_at: now,
              updated_at: now,
              last_sync_at: now,
            });

            return { success: true, registered: true, report: toHostReport(report), error: null };
          } catch (e: any) {
            return { success: false, registered: false, report: null, error: e?.message ?? String(e) };
          }
        });
      },

      nexusHostList: async () => {
        try {
          const storage = (services as any).registryStorage;
          if (!storage) return { success: false, error: 'Storage not available', hosts: [] };
          const { listExternalProfiles } = require('../external/externalSiteStore');
          return { success: true, error: null, hosts: listExternalProfiles(storage) };
        } catch (e: any) {
          return { success: false, error: e?.message ?? String(e), hosts: [] };
        }
      },

      nexusHostRemove: async (_p: ResolverParent, { alias }: { alias: string }) => {
        return withQueue(async () => {
          try {
            const storage = (services as any).registryStorage;
            if (!storage) return { success: false, error: 'Storage not available', removed: false };
            const { externalSiteId, removeExternalProfile, getExternalProfile } =
              require('../external/externalSiteStore');

            const profile = getExternalProfile(storage, alias);
            const removed = removeExternalProfile(storage, alias);

            // Deactivate rather than delete: GraphService has no per-site delete,
            // and its retention sweep already hard-deletes inactive sites and
            // their content once they age out. A later re-add revives the row.
            if (removed && profile) {
              const now = Date.now();
              await (services as any).graphService?.upsertSite({
                id: externalSiteId(alias),
                name: alias,
                domain: alias,
                source: 'external',
                host: 'external',
                environment: profile.environment,
                is_active: false,
                created_at: profile.firstSeenAt,
                updated_at: now,
              });
            }

            return { success: true, error: null, removed };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), removed: false };
          }
        });
      },
```

Add this helper near the other module-level helpers in `resolvers.ts` (flattening `resolved` into the three scalar fields the schema declares):

```ts
/** Flatten a ProbeReport into the GraphQL shape. */
function toHostReport(r: any) {
  return {
    ok: r.ok,
    alias: r.alias,
    hostname: r.resolved?.hostname ?? r.alias,
    user: r.resolved?.user ?? '',
    port: r.resolved?.port ?? '22',
    wpCliPath: r.wpCliPath ?? null,
    wpCliVersion: r.wpCliVersion ?? null,
    wpPath: r.wpPath ?? null,
    wpVersion: r.wpVersion ?? null,
    siteUrl: r.siteUrl ?? null,
    candidates: r.candidates ?? null,
    failure: r.failure ?? null,
  };
}
```

`nexusHostAdd` returns `success: true, registered: false` on a probe failure — the mutation worked, the host did not qualify. `success: false` is reserved for the mutation itself failing. The CLI distinguishes them.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts
git commit -m "feat(graphql): nexusHostProbe/Add/List/Remove mutations"
```

---

## Task 7: The `nexus host` CLI

**Files:**
- Create: `src/cli/commands/host.ts`
- Modify: `src/cli/index.ts:28` (import), `:60` (register)

**Interfaces:**
- Consumes: the four mutations from Task 6; `getClient` from `../utils/graphql`
- Produces: `export const hostCommand`

Every prompt has a flag (`--yes`), because agents drive this CLI and cannot answer prompts. Follow the `readline` pattern from `src/cli/commands/ai.ts:25` — no new dependency.

- [ ] **Step 1: Implement**

Create `src/cli/commands/host.ts`:

```ts
/**
 * External Host Commands
 *
 * Register WordPress sites on SSH-reachable hosts that are not WP Engine and
 * not Local. The ~/.ssh/config alias is the credential path — Nexus stores no
 * key material, and never writes anything to your server.
 */

import { Command } from 'commander';
import * as readline from 'readline';
import { getClient } from '../utils/graphql';

const hostCommand = new Command('host').description('External SSH host management');

const PROBE_FIELDS = `
  ok
  alias
  hostname
  user
  port
  wpCliPath
  wpCliVersion
  wpPath
  wpVersion
  siteUrl
  candidates
  failure { kind detail remedy }
`;

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt(rl, `${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function printReport(r: any): void {
  console.log(`\n  Host        ${r.user ? `${r.user}@` : ''}${r.hostname}:${r.port}`);
  if (r.wpCliVersion) console.log(`  WP-CLI      ${r.wpCliVersion}${r.wpCliPath ? `  (${r.wpCliPath})` : ''}`);
  if (r.wpPath) console.log(`  WordPress   ${r.wpPath}`);
  if (r.wpVersion) console.log(`  Version     ${r.wpVersion}`);
  if (r.siteUrl) console.log(`  Site URL    ${r.siteUrl}`);
  console.log('');
}

function printFailure(r: any): void {
  console.error(`\n✗ ${r.alias}: ${r.failure.kind}\n`);
  console.error(r.failure.detail.split('\n').map((l: string) => `  ${l}`).join('\n'));
  console.error(`\n${r.failure.remedy}\n`);
}

// ============================================================================
// host test
// ============================================================================

hostCommand
  .command('test <alias>')
  .description('Check an SSH host without registering it')
  .option('--path <dir>', 'WordPress root (skips discovery)')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: 120000 });
      const result = await client.mutate<{ nexusHostProbe: any }>(`
        mutation($alias: String!, $path: String) {
          nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
        }
      `, { alias, path: options.path ?? null });

      const { success, error, report } = result.nexusHostProbe;
      if (options.json) {
        console.log(JSON.stringify(report ?? { error }, null, 2));
        process.exit(success && report?.ok ? 0 : 1);
      }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!report.ok) { printFailure(report); process.exit(1); }

      console.log(`\n✓ ${alias} is reachable and running WordPress.`);
      printReport(report);
      console.log(`  Register it with: nexus host add ${alias}\n`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host add
// ============================================================================

hostCommand
  .command('add <alias>')
  .description('Probe an SSH host and add it to the fleet')
  .option('--path <dir>', 'WordPress root (skips discovery)')
  .option('--env <environment>', 'production | staging | development', 'production')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(async (alias, options) => {
    try {
      const client = getClient({ timeout: 120000 });

      if (!options.yes && !options.json) {
        console.log(`\nProbing ${alias}...`);
        const probe = await client.mutate<{ nexusHostProbe: any }>(`
          mutation($alias: String!, $path: String) {
            nexusHostProbe(alias: $alias, path: $path) { success error report { ${PROBE_FIELDS} } }
          }
        `, { alias, path: options.path ?? null });

        const pr = probe.nexusHostProbe;
        if (!pr.success) { console.error(`✗ ${pr.error}`); process.exit(1); }
        if (!pr.report.ok) { printFailure(pr.report); process.exit(1); }

        printReport(pr.report);
        console.log(`  Environment ${options.env}   (writes are refused on production by default)`);
        if (!(await confirm(`\nAdd ${alias} to the fleet?`))) {
          console.log('Cancelled.');
          process.exit(0);
        }
        // The probe re-runs inside nexusHostAdd. Two round trips, but the
        // alternative is a mutation that persists whatever a stale earlier
        // probe found.
      }

      const result = await client.mutate<{ nexusHostAdd: any }>(`
        mutation($alias: String!, $path: String, $environment: String) {
          nexusHostAdd(alias: $alias, path: $path, environment: $environment) {
            success error registered report { ${PROBE_FIELDS} }
          }
        }
      `, { alias, path: options.path ?? null, environment: options.env });

      const { success, error, registered, report } = result.nexusHostAdd;
      if (options.json) {
        console.log(JSON.stringify({ registered, report, error }, null, 2));
        process.exit(registered ? 0 : 1);
      }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!registered) { printFailure(report); process.exit(1); }

      console.log(`\n✓ Added ${alias} to the fleet.`);
      printReport(report);
      console.log(`  Try: nexus wp core version ssh:${alias}@${options.env}\n`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host list
// ============================================================================

hostCommand
  .command('list')
  .description('List registered external SSH hosts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusHostList: any }>(`
        mutation {
          nexusHostList {
            success error
            hosts { alias wpPath wpCliPath environment firstSeenAt lastSeenAt }
          }
        }
      `, {});

      const { success, error, hosts } = result.nexusHostList;
      if (options.json) { console.log(JSON.stringify(hosts, null, 2)); return; }
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }

      if (hosts.length === 0) {
        console.log('\nNo external hosts registered.\n  Add one: nexus host add <ssh-alias>\n');
        return;
      }

      console.log(`\n${hosts.length} external host${hosts.length === 1 ? '' : 's'}:\n`);
      for (const h of hosts) {
        console.log(`  ${h.alias}  [${h.environment}]`);
        console.log(`    path       ${h.wpPath ?? '(not set — pass --path)'}`);
        if (h.wpCliPath) console.log(`    wp-cli     ${h.wpCliPath}`);
        console.log(`    last seen  ${new Date(h.lastSeenAt).toLocaleString()}`);
      }
      console.log('');
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// host remove
// ============================================================================

hostCommand
  .command('remove <alias>')
  .description('Forget an external SSH host')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (alias, options) => {
    try {
      if (!options.yes && !(await confirm(`Remove ${alias} from the fleet?`))) {
        console.log('Cancelled.');
        process.exit(0);
      }

      const client = getClient();
      const result = await client.mutate<{ nexusHostRemove: any }>(`
        mutation($alias: String!) { nexusHostRemove(alias: $alias) { success error removed } }
      `, { alias });

      const { success, error, removed } = result.nexusHostRemove;
      if (!success) { console.error(`✗ ${error}`); process.exit(1); }
      if (!removed) { console.error(`✗ ${alias} is not registered.`); process.exit(1); }
      console.log(`✓ Removed ${alias}.`);
    } catch (e: any) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  });

export { hostCommand };
```

`getClient(options?: { timeout?: number })` and `client.mutate<T>(mutation, variables)` are both as written — verified at `src/cli/utils/graphql.ts:142` and `:134`.

- [ ] **Step 2: Register it**

In `src/cli/index.ts`, add beside the other imports and registrations:

```ts
import { hostCommand } from './commands/host';
```
```ts
program.addCommand(hostCommand);
```

- [ ] **Step 3: Build and smoke-test the help output**

```bash
npm run build
node bin/nexus.js host --help
node bin/nexus.js host add --help
```
Expected: all four subcommands listed; `add` shows `--path`, `--env`, `-y`, `--json`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/host.ts src/cli/index.ts
git commit -m "feat(cli): nexus host add/test/list/remove"
```

---

## Task 8: Documentation and live verification

**Files:**
- Modify: `CLAUDE.md` (a short note under a new "External SSH Hosts" heading)
- Modify: whichever CLI reference doc lists commands — check `docs/` for the file that documents `nexus wpe` and follow it

**This task is not done until the manual run against the live Hostinger host passes.** Every gate here was tested against a fake `SshExec`; none of it has met a real server.

- [ ] **Step 1: Document the invariants**

Add to `CLAUDE.md`:

```markdown
## External SSH Hosts

Sites that are neither Local nor WP Engine, reached by a `~/.ssh/config` alias.
Target syntax: `ssh:<alias>@<production|staging|development>`.

- **Nexus never writes to the user's server.** No WP-CLI upload, no
  `ssh-copy-id` execution. The probe detects, searches known locations, and
  prints the command for the user to run. Do not add an upload path.
- **No key material is stored.** The alias carries host, user, port, key,
  ProxyJump and agent settings. This is why `buildExternalSshArgs` must never
  pass `-F /dev/null` — the WPE builder does, deliberately, and copying that
  across breaks every bastion setup while looking like a network fault.
- **`ssh -G` resolves, it does not validate.** It exits 0 for an alias in no
  config file, echoing the alias back as hostname with the local username and
  port 22. Nothing may gate on its exit code; connectivity is the real gate.
- **The probe stores `wpPath` and `wpCliPath`, and `resolveTransport` reads
  them back.** If you add a new field the probe discovers, wire it through
  `resolve.ts` too or it is write-only.
- Probe commands are read-only, so they are not audited. `host add`/`remove`
  mutate only local addon state and never reach `services.localServices`.
```

- [ ] **Step 2: Full test suite**

```bash
npm test 2>&1 | tail -40
```
Expected: the same **12 failed suites / 22 failed tests** baseline. Compare failing suite **names** against the baseline list — a count that matches while the names differ is a regression plus a coincidence.

- [ ] **Step 3: Rebuild for Local and restart**

```bash
npm run rebuild
./dev-reload.sh
```

`npm test` compiles better-sqlite3 for system Node; Local needs the Electron binary. Skipping `npm run rebuild` produces a `NODE_MODULE_VERSION` error on load.

- [ ] **Step 4: Live verification against the Hostinger host**

Run each and record the actual output:

```bash
node bin/nexus.js host test <alias>          # discovery, from a login dir that is NOT the web root
node bin/nexus.js host add <alias> --yes
node bin/nexus.js host list
node bin/nexus.js wp core version ssh:<alias>@production   # NO --path — proves Task 5
node bin/nexus.js host remove <alias> --yes
node bin/nexus.js host list
```

The fourth is the one that proves the plan's central claim: after registration, `--path` is no longer needed.

- [ ] **Step 5: Verify the auth diagnosis against a real refusal**

The most important message in this feature, and the only way to know it is right:

1. Temporarily rename `~/.ssh/authorized_keys` on the host (or comment out the key).
2. `node bin/nexus.js host test <alias>`
3. Confirm it reports `auth-failed`, and that the printed `ssh-copy-id` line carries the **real** user and port — then actually paste and run it.
4. Restore the key file.

A unit test with a fixture proves the string is assembled; only this proves it is correct.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs(external): document host registration invariants"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 never write to the server | Task 4 (`WP_CLI_INSTALL_REMEDY`), Task 8 (CLAUDE.md) |
| §3 `ProbeReport` shape | Task 4 |
| §3 step 0, resolution not validation | Task 3 |
| §3 gate 1 connect / auth / unreachable | Task 4 |
| §3 gate 2 WP-CLI locate | Task 4 |
| §3 gate 3 bounded discovery | Task 4 |
| §3 gate 4 verify | Task 4 |
| §3 `wpCliPath` consequence | Tasks 1, 2, 5 |
| §4 `host add` | Tasks 6, 7 |
| §4 `host test` | Tasks 6, 7 |
| §4 `host list` | Tasks 6, 7 |
| §4 `host remove` (both stores) | Tasks 2, 6, 7 |
| §5 verbatim stderr, remedy is a command | Task 4 |
| §5 Nexus does not run `ssh-copy-id` | Task 4 remedy text |
| §6 per-gate tests, auth remedy, off-PATH, search shapes | Tasks 3, 4 |
| §6 command-level: add persists only on success | Task 6 (`if (!report.ok)` returns `registered: false`) |
| §6 add is idempotent | Task 2 merge rules + Task 8 live run |
| §6 manual Hostinger verification | Task 8 |
| §8 risk 1 auth remedy exactness | Task 4 test with non-default user/port; Task 8 step 5 |
| §8 risk 2 transport blast radius | Task 1 step 4 runs the WPE characterization suite |
| §8 risk 3 two creation paths | Task 6 `nexusHostRemove` deactivates whatever row exists |
| §8 risk 4 slow search | Task 4 `SEARCH_MAXDEPTH`, fixed roots, `head -20` |

**Gaps against the spec, deliberate:** §6 asks for command-level tests that `test` never persists and that `remove` clears both stores. Those live in the GraphQL resolvers, which this codebase does not unit-test (there is no resolver test harness); they are covered by the Task 8 live run instead. If the implementer finds an existing resolver test harness, add them there.

**Type consistency:** `ProbeReport.resolved` is a nested object in TypeScript and three flat scalars in GraphQL — `toHostReport` is the only bridge, and Task 6 defines it. `ExternalSiteProfile.wpCliPath` (store) maps to `ExternalSshTransport`'s `wpCliBin` (constructor) and `buildExternalWpCliCommand`'s `wpCliBin` (third parameter); the names differ because one is a stored fact and the other is an argument, and Task 5 is where they meet.

**Placeholders:** none. Every signature the plan calls into was read from source, not recalled: `client.mutate`/`getClient` (`src/cli/utils/graphql.ts:134,142`), `STORAGE_KEYS.EXTERNAL_SITE_PROFILES` (`src/common/constants.ts:307`), `upsertSite` (`GraphService.ts:339`), the retention sweep (`:1035`), `withQueue` (`resolvers.ts:32`), and `Float` for epoch timestamps (`schema.ts:39`).
