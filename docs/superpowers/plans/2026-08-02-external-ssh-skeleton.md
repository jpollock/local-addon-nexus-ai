# External SSH Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one real WP-CLI command against one real external SSH host via `ssh:<alias>@<environment>`.

**Architecture:** A third `SiteTransport` implementation beside the existing Local and WPE-SSH ones. The target string gains an `ssh:` branch in the shared parser; the CLI passes it through as a new `ssh_target` argument that `resolveTransport` consumes before its existing resolution path runs. Nothing is persisted — no database row, no fleet integration, no registration.

**Tech Stack:** TypeScript, Node `child_process.spawn`, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-08-02-external-ssh-skeleton-design.md`
**Branch from:** `feat/site-taxonomy-foundation` (Plan A), which itself stacks on `feat/site-transport-abstraction` (Spec 0). Both are unmerged.

## Global Constraints

Every task's requirements implicitly include this section.

- **`ExternalSshTransport` must NOT pass `-F /dev/null`.** `buildWpeSshArgs` passes it deliberately so WPE connections ignore the user's SSH config and stay reproducible. This transport depends on that config entirely — the alias supplies host, user, port, key, `ProxyJump` and agent settings. Adding the flag would break every bastion and jump-host setup and would present as a network fault, not a code defect. A test asserts its absence.
- **Nothing is persisted.** No `sites` row, no graph.db write, `host='external'` is never written. Do not widen any union other than `ParsedTarget.type` and `SiteRef`.
- **None of the 15 wp-cli tools change.** If a task seems to require editing one, stop and report — the `ssh_target` design exists specifically to avoid that.
- **Never `git push`, `npm version`, or `git tag`.** Commit locally only.
- **Baseline: 12 failed suites / 22 failed tests** pre-exist from native modules. Add none. Verify by comparing failing-suite **names**, not counts.
- **If a run shows `NODE_MODULE_VERSION 146 ... requires 141`**, or a wave of database-suite failures: run `npm rebuild better-sqlite3`. Not `npm install` — it will not rebuild an already-installed package. Never `npm run rebuild` — that builds for Electron and breaks testing.
- **This code is a probe, not a foundation.** Plan B may replace any of it, particularly the undeclared `ssh_target` arg.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/main/transport/ExternalSshTransport.ts` | The third `SiteTransport` — SSH via `~/.ssh/config` alias |
| `tests/unit/transport/external-ssh-args.test.ts` | Golden argv, including the `-F /dev/null` absence assertion |

**Modified:**

| Path | Change |
|---|---|
| `src/common/target.ts` | widen `ParsedTarget.type`, add `alias`, add the `ssh:` branch |
| `src/main/transport/types.ts` | widen `SiteRef` with `{ kind: 'external'; alias }` |
| `src/main/transport/ssh-args.ts` | add `buildExternalSshArgs`, `buildExternalWpCliCommand`, `EXTERNAL_SSH_TIMEOUT_MS` |
| `src/main/transport/policy.ts` | add `EXTERNAL_REMOTE_POLICY` |
| `src/main/transport/resolve.ts` | early `ssh_target` branch |
| `src/main/transport/index.ts` | export the new transport |
| `src/cli/utils/mcp-client.ts` | `ssh:` case in `targetToMcpArgs` |
| `src/cli/commands/wp.ts` | `--path` option on the two exercised commands |
| `tests/unit/common/target.test.ts` | parser cases |
| `tests/unit/transport/conformance.test.ts` | register the third transport |
| `tests/unit/transport/policy.test.ts` | external-policy cases |

---

### Task 1: Parse `ssh:<alias>@<environment>`

**Files:**
- Modify: `src/common/target.ts`
- Test: `tests/unit/common/target.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ParsedTarget.type` widened to `'local' | 'wpe' | 'external'`, plus `alias?: string`. An external target parses to `{ type: 'external', original, alias, environment }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/common/target.test.ts`:

```ts
describe('parseTarget — external SSH targets', () => {
  it.each(['production', 'staging', 'development'])('parses ssh:alias@%s', (env) => {
    expect(parseTarget(`ssh:acme-box@${env}`)).toEqual({
      type: 'external',
      original: `ssh:acme-box@${env}`,
      alias: 'acme-box',
      environment: env,
    });
  });

  it('accepts aliases containing dots, dashes and underscores', () => {
    expect(parseTarget('ssh:web-01.prod_eu@production').alias).toBe('web-01.prod_eu');
  });

  it('throws terse text for an ssh: target with no environment', () => {
    expect(() => parseTarget('ssh:acme-box'))
      .toThrow('Incomplete SSH target: ssh:acme-box. Expected ssh:alias@environment');
  });

  it('throws verbose text when asked', () => {
    expect(() => parseTarget('ssh:acme-box', { verboseErrors: true }))
      .toThrow(/Expected: ssh:alias@environment/);
  });

  it('rejects ssh:alias@local — local is not a deployment environment', () => {
    expect(() => parseTarget('ssh:acme-box@local')).toThrow(/Incomplete SSH target/);
  });

  it('leaves existing target forms untouched', () => {
    expect(parseTarget('mysite@local').type).toBe('local');
    expect(parseTarget('wpe:acct/inst@production').type).toBe('wpe');
    expect(parseTarget('barename').type).toBe('local');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest tests/unit/common/target.test.ts -t 'external SSH targets'
```

Expected: FAIL — `ssh:acme-box@production` currently falls through to the invalid-syntax throw.

- [ ] **Step 3: Widen the interface**

In `src/common/target.ts`:

```ts
export interface ParsedTarget {
  type: 'local' | 'wpe' | 'external';
  original: string;
  siteName?: string;
  account?: string;
  /** For WPE: the install portion. May contain slashes (the regex is lazy). */
  installName?: string;
  /** For external SSH hosts: the ~/.ssh/config Host alias. */
  alias?: string;
  environment?: TargetEnvironment;
}
```

- [ ] **Step 4: Add the branch — placement matters**

Insert **before** the `@local` check, as the first branch inside `parseTarget`:

```ts
  // Checked FIRST, ahead of the @local suffix test. `ssh:x@local` would
  // otherwise match endsWith('@local') and silently parse as a local site
  // named "ssh:x". Ordering it here turns that into a clear error instead.
  const sshMatch = target.match(/^ssh:(.+?)@(production|staging|development)$/);
  if (sshMatch) {
    return {
      type: 'external',
      original: target,
      alias: sshMatch[1],
      environment: sshMatch[2] as TargetEnvironment,
    };
  }

  if (target.startsWith('ssh:')) {
    throw new Error(
      verbose
        ? `Incomplete SSH target: ${target}\n\n` +
          `Expected: ssh:alias@environment\n` +
          `Environments: production, staging, development`
        : `Incomplete SSH target: ${target}. Expected ssh:alias@environment`,
    );
  }
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/common/target.test.ts -v
npx tsc --noEmit -p tsconfig.json
```

Expected: all pass. `tsc` may flag exhaustiveness in code that switches on `ParsedTarget.type` — if it does, report the locations rather than editing them; that is Plan B's union-widening work, not this task's.

- [ ] **Step 6: Commit**

```bash
git add src/common/target.ts tests/unit/common/target.test.ts
git commit -m "feat(target): parse ssh:alias@environment targets

Third branch beside @local and wpe:. Checked first so ssh:x@local errors
clearly instead of parsing as a local site named 'ssh:x'.

Widens ParsedTarget.type only — the other unions listed in the Spec 1
outcome section belong to Plan B."
```

---

### Task 2: SSH argument builders for external hosts

**Files:**
- Modify: `src/main/transport/ssh-args.ts`
- Modify: `src/main/transport/types.ts`
- Test: `tests/unit/transport/external-ssh-args.test.ts` (create)

**Interfaces:**
- Consumes: `escapeShellArg` from `ssh-args.ts`
- Produces:
  - `EXTERNAL_SSH_TIMEOUT_MS = 20000`
  - `buildExternalWpCliCommand(args: string[], wpPath?: string): string`
  - `buildExternalSshArgs(alias: string, remoteCommand: string): string[]`
  - `SiteRef` widened with `{ kind: 'external'; alias: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/transport/external-ssh-args.test.ts`:

```ts
import {
  buildExternalSshArgs,
  buildExternalWpCliCommand,
  EXTERNAL_SSH_TIMEOUT_MS,
} from '../../../src/main/transport/ssh-args';

describe('buildExternalSshArgs', () => {
  it('does NOT pass -F /dev/null — external hosts depend on ~/.ssh/config', () => {
    // The single most important assertion in this milestone. buildWpeSshArgs
    // passes -F /dev/null deliberately so WPE connections ignore the user's
    // config. Copying that here would break every bastion, jump host and
    // agent-auth setup, and would look like a network fault rather than a bug.
    const args = buildExternalSshArgs('acme-box', 'wp core version');
    expect(args).not.toContain('/dev/null');
    expect(args).not.toContain('-F');
  });

  it('pins the exact argv', () => {
    expect(buildExternalSshArgs('acme-box', 'wp core version')).toEqual([
      '-o', 'BatchMode=yes',
      'acme-box',
      'wp core version',
    ]);
  });

  it('passes the alias through verbatim so ssh_config resolves it', () => {
    expect(buildExternalSshArgs('web-01.prod_eu', 'true').at(-2)).toBe('web-01.prod_eu');
  });
});

describe('buildExternalWpCliCommand', () => {
  it('builds a bare wp command when no path is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version']))
      .toBe("wp 'core' 'version'");
  });

  it('adds --path when one is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], '/var/www/html'))
      .toBe("wp --path='/var/www/html' 'core' 'version'");
  });

  it('does NOT add --skip-plugins/--skip-themes', () => {
    // Those exist for WPE's mu-plugin environment. An arbitrary host gets plain wp.
    expect(buildExternalWpCliCommand(['plugin', 'list'])).not.toContain('--skip-plugins');
  });

  it('escapes embedded single quotes in args and path', () => {
    expect(buildExternalWpCliCommand(['option', 'update', 'x', "Bob's"]))
      .toBe("wp 'option' 'update' 'x' 'Bob'\\''s'");
    expect(buildExternalWpCliCommand(['core', 'version'], "/srv/it's"))
      .toBe("wp --path='/srv/it'\\''s' 'core' 'version'");
  });
});

it('pins the external SSH timeout', () => {
  expect(EXTERNAL_SSH_TIMEOUT_MS).toBe(20000);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest tests/unit/transport/external-ssh-args.test.ts
```

Expected: FAIL — none of the three symbols exist.

- [ ] **Step 3: Add the builders**

Append to `src/main/transport/ssh-args.ts`:

```ts
/**
 * Shorter than WPE's 35s: there is no managed-hosting cold start to wait for,
 * and a hung SSH to an unreachable box should fail while the user is watching.
 */
export const EXTERNAL_SSH_TIMEOUT_MS = 20000;

/**
 * WP-CLI command for an arbitrary host.
 *
 * No --skip-plugins/--skip-themes: those exist for WP Engine's mu-plugin
 * environment, and suppressing plugins on someone else's host would change what
 * `wp` reports without them asking.
 *
 * `wpPath` is optional. Omitted, WP-CLI searches upward from the SSH login
 * directory — which is the web root on many hosts, so the common case needs no
 * flag at all.
 */
export function buildExternalWpCliCommand(args: string[], wpPath?: string): string {
  const pathFlag = wpPath ? `--path=${escapeShellArg(wpPath)} ` : '';
  return `wp ${pathFlag}${args.map(escapeShellArg).join(' ')}`.trim();
}

/**
 * INVERTED RULE — read before changing.
 *
 * This must NOT pass `-F /dev/null`. buildWpeSshArgs passes it deliberately so
 * WP Engine connections ignore the user's SSH config and stay reproducible.
 * This function depends on that config entirely: the alias supplies host, user,
 * port, key, ProxyJump and agent settings, which is the whole reason
 * alias-based credentials were chosen and why no key material is stored.
 *
 * Adding -F /dev/null here would break every bastion and jump-host setup and
 * would present as a network fault rather than a code defect.
 *
 * BatchMode=yes prevents ssh prompting for a password on a non-tty, which would
 * hang the spawn until the timeout instead of failing immediately.
 */
export function buildExternalSshArgs(alias: string, remoteCommand: string): string[] {
  return [
    '-o', 'BatchMode=yes',
    alias,
    remoteCommand,
  ];
}
```

- [ ] **Step 4: Widen `SiteRef`**

In `src/main/transport/types.ts`:

```ts
export type SiteRef =
  | { kind: 'local'; siteId: string; siteName: string }
  | { kind: 'wpe'; installName: string }
  | { kind: 'external'; alias: string };
```

`TransportKind` already includes `'external-ssh'` — do not change it.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/transport/ -v
npx tsc --noEmit -p tsconfig.json
```

Expected: new tests pass; existing transport tests including `ssh-argv-characterization.test.ts` pass **unmodified**. `tsc` may flag places narrowing `SiteRef` — report locations rather than editing.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/ssh-args.ts src/main/transport/types.ts tests/unit/transport/external-ssh-args.test.ts
git commit -m "feat(transport): add external SSH argument builders

buildExternalSshArgs deliberately omits -F /dev/null — external hosts
depend on ~/.ssh/config for host, user, port, key, ProxyJump and agent
settings. A test asserts the flag's absence, since copying it from the WPE
builder would break bastions and look like a network fault.

BatchMode=yes so a password-prompting host fails fast instead of hanging."
```

---

### Task 3: `ExternalSshTransport`

**Files:**
- Create: `src/main/transport/ExternalSshTransport.ts`
- Modify: `src/main/transport/index.ts`
- Test: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: `buildExternalSshArgs`, `buildExternalWpCliCommand`, `EXTERNAL_SSH_TIMEOUT_MS`, `SiteRef`
- Produces: `class ExternalSshTransport implements SiteTransport`, constructor `(alias: string, wpPath?: string)`

- [ ] **Step 1: Register it with the conformance gate**

Append to `tests/unit/transport/conformance.test.ts`. The `spawnMock`/`fakeProc` helpers already exist at the top of that file:

```ts
import { ExternalSshTransport } from '../../../src/main/transport/ExternalSshTransport';

describe('ExternalSshTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  runTransportConformance('ExternalSshTransport', {
    ok: () => {
      spawnMock.mockImplementation(() => fakeProc({ stdout: 'WordPress 6.8' }));
      return new ExternalSshTransport('acme-box');
    },
    failing: () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stderr: 'ssh: connect refused' }));
      return new ExternalSshTransport('acme-box');
    },
  });

  it('invokes ssh with the alias and a bare wp command', async () => {
    await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toEqual(['-o', 'BatchMode=yes', 'acme-box', "wp 'core' 'version'"]);
    expect(opts.timeout).toBe(20000);
  });

  it('passes --path through when constructed with one', async () => {
    await new ExternalSshTransport('acme-box', '/var/www/html').runWpCli(['core', 'version']);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("wp --path='/var/www/html' 'core' 'version'");
  });

  it('hints about WP-CLI provisioning when wp is missing', async () => {
    spawnMock.mockImplementation(() =>
      fakeProc({ code: 127, stderr: 'bash: wp: command not found' }));
    const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    expect(res.success).toBe(false);
    expect(res.stdout).toMatch(/not implemented yet/i);
  });

  it('hints about --path when WordPress is not found', async () => {
    spawnMock.mockImplementation(() => fakeProc({
      code: 1, stderr: 'Error: This does not seem to be a WordPress installation.',
    }));
    const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    expect(res.stdout).toMatch(/--path=/);
  });

  it('refuses deleteRemoteFile — Sentinel remediation is WP Engine only', async () => {
    const res = await new ExternalSshTransport('acme-box').deleteRemoteFile('/tmp/x');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not supported/i);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest tests/unit/transport/conformance.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the transport**

Create `src/main/transport/ExternalSshTransport.ts`:

```ts
import { spawn } from 'child_process';
import type { WpCliResult } from '../mcp/local-services-bridge';
import type {
  Capability, DeleteResult, ProbeResult, RunOpts, SiteRef, SiteTransport, TransportKind,
} from './types';
import {
  buildExternalSshArgs, buildExternalWpCliCommand, EXTERNAL_SSH_TIMEOUT_MS,
} from './ssh-args';

type RawSshResult = { code: number | null; stdout: string; stderr: string; spawnError?: string };

function runSsh(alias: string, remoteCommand: string): Promise<RawSshResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh', buildExternalSshArgs(alias, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: EXTERNAL_SSH_TIMEOUT_MS,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: '', spawnError: err.message }));
  });
}

/**
 * Turn two common remote failures into actionable messages. Both are expected
 * in this milestone — WP-CLI provisioning and wp-config discovery are
 * deliberately deferred — so the user should be told it is a known gap rather
 * than left guessing at a bug.
 */
function annotateFailure(stderr: string): string {
  const text = stderr.trim();
  if (/command not found|wp: not found/i.test(text)) {
    return `${text}\n\nHint: WP-CLI ('wp') was not found on the remote host. `
      + `Automatic WP-CLI provisioning is not implemented yet — install WP-CLI on the host, `
      + `or make sure it is on the login shell's PATH.`;
  }
  if (/does not seem to be a WordPress installation/i.test(text)) {
    return `${text}\n\nHint: pass --path=/path/to/wordpress if WordPress is not in the `
      + `SSH login directory.`;
  }
  return text;
}

/**
 * WP-CLI over SSH to an arbitrary host, addressed by a ~/.ssh/config alias.
 *
 * Deliberately holds no credentials: the alias carries host, user, port, key,
 * ProxyJump and agent settings. See buildExternalSshArgs for why this transport
 * must not pass -F /dev/null.
 */
export class ExternalSshTransport implements SiteTransport {
  readonly kind: TransportKind = 'external-ssh';
  readonly siteRef: SiteRef;

  constructor(private readonly alias: string, private readonly wpPath?: string) {
    this.siteRef = { kind: 'external', alias };
  }

  /** SSH + WP-CLI covers every seeded capability. */
  supports(_cap: Capability): boolean {
    return true;
  }

  async runWpCli(args: string[], _opts?: RunOpts): Promise<WpCliResult> {
    const res = await runSsh(this.alias, buildExternalWpCliCommand(args, this.wpPath));
    if (res.spawnError !== undefined) return { stdout: res.spawnError, success: false };
    if (res.code === 0) return { stdout: res.stdout, success: true };
    return {
      stdout: annotateFailure(res.stderr) || `SSH exited with code ${res.code}`,
      success: false,
    };
  }

  /**
   * Refused. Sentinel's raw-delete path targets WP Engine's /nas/content/live
   * layout and is WPE-only; nothing should be unlinking files on an arbitrary
   * host in this milestone.
   */
  async deleteRemoteFile(absolutePath: string): Promise<DeleteResult> {
    return {
      success: false,
      output: `deleteRemoteFile is not supported on external SSH hosts (path: ${absolutePath})`,
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

- [ ] **Step 4: Export it**

Add to `src/main/transport/index.ts`:

```ts
export { ExternalSshTransport } from './ExternalSshTransport';
```

- [ ] **Step 5: Run tests**

```bash
npx jest tests/unit/transport/ -v
npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, including the full conformance gate against the third implementation. `ssh-argv-characterization.test.ts` must pass unmodified.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/ExternalSshTransport.ts src/main/transport/index.ts tests/unit/transport/conformance.test.ts
git commit -m "feat(transport): add ExternalSshTransport

Third SiteTransport, passing the hardened conformance gate with both ok
and failing fixtures — the gate's first real exercise against an
implementation it was not written alongside.

Annotates two expected failures (wp missing, WordPress not found) with
hints naming the deferred work, so a known gap does not read as a bug.
deleteRemoteFile refuses: Sentinel remediation is WP Engine only."
```

---

### Task 4: `EXTERNAL_REMOTE_POLICY`

**Files:**
- Modify: `src/main/transport/policy.ts`
- Test: `tests/unit/transport/policy.test.ts`

**Interfaces:**
- Consumes: `CommandPolicy`, `checkCommand` from `policy.ts`
- Produces: `EXTERNAL_REMOTE_POLICY: CommandPolicy`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/transport/policy.test.ts`:

```ts
import { EXTERNAL_REMOTE_POLICY } from '../../../src/main/transport/policy';

describe('EXTERNAL_REMOTE_POLICY (blocklist only, no whitelist)', () => {
  it('blocks the dangerous five', () => {
    expect(checkCommand(['eval', '<?php'], EXTERNAL_REMOTE_POLICY)).toBe('eval');
    expect(checkCommand(['shell'], EXTERNAL_REMOTE_POLICY)).toBe('shell');
    expect(checkCommand(['db', 'cli'], EXTERNAL_REMOTE_POLICY)).toBe('db cli');
  });

  it('permits core update — which MCP_REMOTE_POLICY refuses', () => {
    // The divergence is the point. Applying MCP's 14-command whitelist to
    // external hosts would reproduce, on day one, the five permanently-dead
    // MCP tools and contradict the full-parity decision.
    expect(checkCommand(['core', 'update'], EXTERNAL_REMOTE_POLICY)).toBeNull();
    expect(checkCommand(['core', 'update'], MCP_REMOTE_POLICY))
      .toMatch(/not allowed for remote execution/);
  });

  it('permits post create and theme activate — also refused by MCP', () => {
    expect(checkCommand(['post', 'create'], EXTERNAL_REMOTE_POLICY)).toBeNull();
    expect(checkCommand(['theme', 'activate', 'x'], EXTERNAL_REMOTE_POLICY)).toBeNull();
  });

  it('has no whitelist at all', () => {
    expect(EXTERNAL_REMOTE_POLICY.allowed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest tests/unit/transport/policy.test.ts
```

Expected: FAIL — `EXTERNAL_REMOTE_POLICY` is not exported.

- [ ] **Step 3: Add the policy**

Append to `src/main/transport/policy.ts`, after `GRAPHQL_REMOTE_POLICY`:

```ts
/**
 * Policy for arbitrary SSH hosts: blocklist only, deliberately no whitelist.
 *
 * MCP_REMOTE_POLICY's 14-command whitelist is what makes five MCP tools
 * permanently dead on WP Engine. Applying it here would reproduce that on day
 * one and contradict the full-parity decision for external hosts.
 *
 * External hosts are therefore more permissive than WPE-via-MCP. That is
 * intended: the whitelist is vestigial, the user named the host explicitly, and
 * the environment gate still applies — registration defaults to production, so
 * writes are refused until a host is deliberately labelled otherwise.
 *
 * Do NOT unify this with the other two policies. That is a separate decision
 * with its own spec.
 */
export const EXTERNAL_REMOTE_POLICY: CommandPolicy = {
  blocked: ['eval', 'eval-file', 'shell', 'db query', 'db cli'],
};
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/transport/policy.test.ts -v
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/policy.ts tests/unit/transport/policy.test.ts
git commit -m "feat(transport): add EXTERNAL_REMOTE_POLICY

Blocklist only, no whitelist. Applying MCP's 14-command whitelist to
external hosts would reproduce the five permanently-dead MCP tools on day
one and contradict full parity. Tests pin the divergence so it cannot be
tidied away."
```

---

### Task 5: Wire the CLI through to the transport

**Files:**
- Modify: `src/main/transport/resolve.ts`
- Modify: `src/cli/utils/mcp-client.ts`
- Modify: `src/cli/commands/wp.ts`

**Interfaces:**
- Consumes: `parseTarget`, `ExternalSshTransport`, `EXTERNAL_REMOTE_POLICY`, `withPolicy`, `isOperationAllowed`, `getEffectiveSettings`
- Produces: `resolveTransport` handles `args.ssh_target` and `args.wp_path`; `targetToMcpArgs` emits `{ ssh_target }` for `ssh:` targets

- [ ] **Step 1: Add the `ssh_target` branch to `resolveTransport`**

In `src/main/transport/resolve.ts`, add these imports:

```ts
import { parseTarget } from '../../common/target';
import { error } from '../mcp/modules/wp-cli/preflight';
import { isOperationAllowed, getEffectiveSettings } from '../mcp/utils/operation-permissions';
import { ExternalSshTransport } from './ExternalSshTransport';
import { withPolicy, MCP_REMOTE_POLICY, EXTERNAL_REMOTE_POLICY } from './policy';
```

Then insert this as the **first** thing inside `resolveTransport`, before the `resolveTarget` call:

```ts
  // External SSH hosts arrive as an undeclared `ssh_target` arg from the CLI.
  // Handled before resolveTarget so no existing local/WPE resolution runs and
  // therefore none of it can regress. The arg is intentionally absent from every
  // tool's inputSchema in this milestone; Plan B promotes it.
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

    // Same gate as WP Engine installs, keyed on an ssh: target ref.
    const settings = getEffectiveSettings((services as any).registryStorage);
    if (!isOperationAllowed(operation as any, parsed.environment, settings, `ssh:${parsed.alias}`)) {
      return error(
        `Operation blocked: not permitted on "${parsed.environment}" environments. `
        + `Adjust in Nexus AI → Settings → WP Engine Access.`,
      );
    }

    const wpPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;
    return withPolicy(new ExternalSshTransport(parsed.alias, wpPath), EXTERNAL_REMOTE_POLICY);
  }
```

- [ ] **Step 2: Add the `ssh:` case to `targetToMcpArgs`**

In `src/cli/utils/mcp-client.ts`, insert as the **first** check inside `targetToMcpArgs`, before the `@local` test — matching the parser's ordering so `ssh:x@local` cannot be mistaken for a local site:

```ts
  if (target.startsWith('ssh:')) {
    // Passed whole; resolveTransport parses it. wp_path is added separately by
    // the calling command from its --path option.
    return { ssh_target: target };
  }
```

- [ ] **Step 3: Add `--path` to the two exercised commands**

In `src/cli/commands/wp.ts`, the `core version` command is registered around line 345 and `plugin list` around line 21. Add `.option('--path <dir>', 'WordPress root on an external SSH host')` to each, and merge it into the MCP args at the `callMcpTool` sites (lines ~351 and ~32 respectively):

```ts
        const mcpArgs = targetToMcpArgs(target);
        if (options.path) mcpArgs.wp_path = options.path;
        const { text, isError } = await callMcpTool('wp_core_version', mcpArgs);
```

Do the same for `wp_plugin_list`. Leave every other subcommand untouched.

- [ ] **Step 4: Typecheck and run the transport and target suites**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest tests/unit/transport/ tests/unit/common/target.test.ts -v
```

Expected: clean. (`error` is confirmed exported from `src/main/mcp/modules/wp-cli/preflight.ts:25`, the same source `remote-exec.ts` imports it from.)

- [ ] **Step 5: Full suite**

```bash
npm test 2>&1 | tail -20
```

Expected: **12 failed suites / 22 failed tests**. Compare failing-suite **names** against that baseline, not just counts, and report both.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/resolve.ts src/cli/utils/mcp-client.ts src/cli/commands/wp.ts
git commit -m "feat: wire ssh: targets from CLI through to ExternalSshTransport

resolveTransport handles ssh_target before resolveTarget runs, so existing
local and WPE resolution cannot regress. The environment gate applies with
an ssh:<alias> target ref, so production writes are refused by default.

--path added to the two exercised commands only. No wp-cli tool changed."
```

---

### Task 6: Manual verification against a real host

**This task is human-run.** No agent can complete it: it needs a real SSH host and real credentials. It is the entire point of the milestone — nothing above proves anything until this passes.

**Files:** none.

- [ ] **Step 1: Confirm the alias works outside Nexus first**

```bash
ssh <alias> 'wp --version'
```

If that fails, fix `~/.ssh/config` before going further — Nexus cannot do better than plain ssh.

- [ ] **Step 2: Build and run a read command**

```bash
npm run build
node bin/nexus.js wp core version ssh:<alias>@staging
```

Expected: a real WordPress version. If WordPress is not in the login directory:

```bash
node bin/nexus.js wp core version ssh:<alias>@staging --path=/var/www/html
```

- [ ] **Step 3: Run the second command**

```bash
node bin/nexus.js wp plugin list ssh:<alias>@staging
```

- [ ] **Step 4: Confirm the environment gate bites**

```bash
node bin/nexus.js wp core version ssh:<alias>@production
```

Expected: succeeds — `wpcli_read` is permitted on production by default. Reads working while writes would be refused is the correct posture.

- [ ] **Step 5: Record what you learned**

The skeleton exists to inform registration design. Note specifically: was the SSH login directory the web root, or was `--path` needed? Was `wp` already installed? What did failure output actually look like? Those answers shape Milestone 3 more than further design will.

---

## Self-Review

**Spec coverage.** §3 target parsing → Task 1. §3 arg plumbing → Task 5. §3 `ExternalSshTransport` and the inverted SSH-config rule → Tasks 2–3. §3 policy → Task 4. §3 permission gate → Task 5 Step 1. §4 all eight files → Tasks 1–5. §5 errors → Task 3's `annotateFailure`. §6 testing → parser (T1), golden argv (T2), conformance (T3), policy (T4), manual (T6).

**Placeholder scan:** none. Every code step carries the code; every command is exact.

**Type consistency.** `ParsedTarget.type`/`alias` defined in Task 1, consumed in Task 5. `buildExternalSshArgs`, `buildExternalWpCliCommand`, `EXTERNAL_SSH_TIMEOUT_MS` and the widened `SiteRef` defined in Task 2, consumed in Task 3. `ExternalSshTransport(alias, wpPath?)` defined in Task 3, constructed in Task 5. `EXTERNAL_REMOTE_POLICY` defined in Task 4, applied in Task 5.

**Two things to expect at execution time.** Widening `ParsedTarget.type` and `SiteRef` may surface `tsc` exhaustiveness errors in code that narrows on them — Tasks 1 and 2 both say to report locations rather than edit, because fixing them is Plan B's union work and would silently expand this milestone. Every code reference in this plan was verified against the tree while writing it: `error` at `preflight.ts:25`, the two CLI subcommand registrations at `wp.ts:21` and `wp.ts:345`, and the `spawnMock`/`fakeProc` helpers at `conformance.test.ts:8,15`.
