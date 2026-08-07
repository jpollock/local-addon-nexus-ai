# Host-Key Trust-on-First-Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed live bug where a brand-new external SSH host fails every command with an opaque "Host key verification failed." — by classifying that failure with a real fingerprint, and letting a human approve it, without ever letting the CLI, an MCP tool, or `--yes` auto-trust a host's identity.

**Architecture:** Two new `ProbeFailureKind` values (`host-key-unknown`, `host-key-changed`) are classified from stderr text `probeExternalHost`'s Gate 1 already captures. The unknown case fetches a real fingerprint by connecting through the alias itself into an isolated temp `known_hosts` file (never `ssh-keyscan`, which cannot traverse a `ProxyJump`). The fingerprint flows through the existing `nexusHostProbe` GraphQL mutation and CLI failure-printing path unchanged — no new CLI code. The only new write path — actually trusting a key — is a brand-new Electron `ipcMain` channel, never added to the GraphQL schema, reachable only from a small new section in Local's Settings UI.

**Tech Stack:** TypeScript, Node `child_process`/`fs`, Electron IPC (`ipcMain`/`ipcRenderer`), GraphQL (graphql-js SDL), Jest.

## Global Constraints

- Trust is granted only from Local's renderer Settings UI. Never from the CLI, never from an
  MCP tool, and `--yes` never bypasses it — verified live that the renderer and CLI hit the
  identical HTTP GraphQL endpoint with the identical bearer token, so a GraphQL mutation the
  CLI "just doesn't call" is not a real boundary; only a true `ipcMain`/`ipcRenderer` channel is.
- A CHANGED host key (previously trusted, key no longer matches) is hard-refused on every
  surface, with no approval path anywhere. Never re-prompted.
- `buildExternalSshArgs`/`buildHostKeyCaptureArgs` must never pass `-F /dev/null` — external
  hosts depend entirely on the user's own `~/.ssh/config` (`ProxyJump`, port, user, identity).
- `ssh-keyscan` is not used anywhere in this plan — this build's `ssh-keyscan` cannot traverse
  a `ProxyJump`, which would silently break bastion-based hosts.
- No audit-log entry for the trust write — per existing precedent, `host add`/`host remove`
  mutate only local machine state and never reach `services.localServices` or a remote site;
  this write (`~/.ssh/known_hosts`, a file on the user's own machine) is the same class.
- Every new SSH invocation is built in `src/main/transport/ssh-args.ts` and must call
  `assertSafeSshAlias(alias)` — that module is the sole place an SSH invocation is constructed
  in this codebase.
- Re-verify the test baseline before each task's final commit. As of the last full run on this
  branch: `Test Suites: 12 failed, 280 passed, 292 total`, all 12 failures pre-existing and
  unrelated (confirmed via `git diff --stat` against files those suites touch). `npx tsc
  --noEmit` is clean. Do not let any task's change widen this baseline.

---

### Task 1: `hostKeyTrust.ts` — capture an offered host key, and trust it

**Files:**
- Create: `src/main/external/hostKeyTrust.ts`
- Modify: `src/main/transport/ssh-args.ts` (new `buildHostKeyCaptureArgs`, two new exported
  constants)
- Modify: `src/main/external/sshExec.ts` (`ResolvedSshConfig` gains `userKnownHostsFile`,
  `resolveSshConfig` parses it)
- Test: `tests/unit/external/host-key-trust.test.ts` (new)
- Test: `tests/unit/external/probe-external-host.test.ts` (update `resolveSshConfig` fixtures
  for the new field — existing exact-match `.toEqual()` assertions will otherwise fail)
- Test: `tests/unit/transport/external-ssh-args.test.ts` (new describe block for
  `buildHostKeyCaptureArgs`)

**Interfaces:**
- Consumes: nothing new — this is the foundational module.
- Produces:
  - `captureOfferedHostKey(alias: string, exec: SshExec, keygenExec?: KeygenExec):
    Promise<CapturedHostKey | null>` — `CapturedHostKey = { fingerprint: string; keyType:
    string; rawLine: string }`. Returns `null` on any failure (unreachable, no key received,
    unparseable fingerprint output) — callers must treat `null` as "could not determine",
    never as "trusted" or "changed".
  - `trustHostKey(userKnownHostsFile: string, rawLine: string): void` — appends `rawLine` to
    `userKnownHostsFile`, creating the parent directory if needed.
  - `KeygenExec = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr:
    string }>` — the injection seam for testing, mirroring the existing `SshExec` pattern in
    `sshExec.ts`.
  - `ResolvedSshConfig` (in `sshExec.ts`) gains `userKnownHostsFile: string` — Task 2 does not
    need it, but the IPC handler in Task 5 does.

- [ ] **Step 1: Write the failing tests for `buildHostKeyCaptureArgs`**

Add to `tests/unit/transport/external-ssh-args.test.ts`:

```ts
import { buildHostKeyCaptureArgs } from '../../../src/main/transport/ssh-args';

describe('buildHostKeyCaptureArgs', () => {
  it('does NOT pass -F /dev/null — must go through the alias\'s own ProxyJump/config', () => {
    const args = buildHostKeyCaptureArgs('acme-box', '/tmp/nexus-hostkey-test');
    expect(args).not.toContain('/dev/null');
    expect(args).not.toContain('-F');
  });

  it('pins the exact argv', () => {
    expect(buildHostKeyCaptureArgs('acme-box', '/tmp/nexus-hostkey-test')).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=/tmp/nexus-hostkey-test',
      'acme-box',
      'exit',
    ]);
  });

  it('rejects an unsafe alias', () => {
    expect(() => buildHostKeyCaptureArgs('-oProxyCommand=evil', '/tmp/x')).toThrow(/Invalid SSH host alias/);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/transport/external-ssh-args.test.ts -t "buildHostKeyCaptureArgs"`
Expected: FAIL — `buildHostKeyCaptureArgs` is not exported.

- [ ] **Step 3: Implement `buildHostKeyCaptureArgs`**

Add to `src/main/transport/ssh-args.ts`, after `buildExternalSshArgs` (before
`buildSshConfigDumpArgs`):

```ts
/** Seconds, not ms — matches ssh's own `-o ConnectTimeout=N` unit. */
export const HOST_KEY_CAPTURE_CONNECT_TIMEOUT_SEC = 10;
/** The whole capture is one trivial `exit` — short, like the connect-only gate it mirrors. */
export const HOST_KEY_CAPTURE_TIMEOUT_MS = 15000;

/**
 * Connect through the alias just far enough to receive its offered host key,
 * writing it to an ISOLATED temp known_hosts file rather than the real one.
 *
 * `StrictHostKeyChecking=accept-new` here does not grant real trust — it only
 * lets ssh proceed past the handshake so the key can be inspected. Confirmed
 * live: the key is written to `tempKnownHostsFile` even when the subsequent
 * `exit` fails to authenticate, because host-key exchange happens before auth.
 * Nothing is written to the caller's REAL known_hosts by this call.
 *
 * Must NOT pass -F /dev/null, for the same reason as buildExternalSshArgs:
 * this has to traverse whatever ProxyJump/port/user/identity the alias
 * specifies, which is also why ssh-keyscan (no ProxyJump support) cannot be
 * used for this instead.
 */
export function buildHostKeyCaptureArgs(alias: string, tempKnownHostsFile: string): string[] {
  assertSafeSshAlias(alias);
  return [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${HOST_KEY_CAPTURE_CONNECT_TIMEOUT_SEC}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${tempKnownHostsFile}`,
    alias,
    'exit',
  ];
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/transport/external-ssh-args.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `resolveSshConfig`'s new field**

In `tests/unit/external/probe-external-host.test.ts`, update the four existing
`resolveSshConfig` tests (each currently ends in a `.toEqual({...})` without
`userKnownHostsFile` — they will fail once Step 7 adds the field, which is the point):

```ts
describe('resolveSshConfig', () => {
  it('parses hostname, user, port and userKnownHostsFile from ssh -G', async () => {
    const cfg = await resolveSshConfig('example', execReturning(SSH_G_OUTPUT));
    expect(cfg).toEqual({
      hostname: '203.0.113.10', user: 'deploy', port: '2222',
      userKnownHostsFile: `${require('os').homedir()}/.ssh/known_hosts`,
    });
  });

  it('invokes ssh -G <alias> and nothing else', async () => {
    const seen: string[][] = [];
    await resolveSshConfig('example', execReturning(SSH_G_OUTPUT, seen));
    expect(seen).toEqual([['-G', 'example']]);
  });

  it('is case-insensitive on keys, as ssh -G output can vary', async () => {
    const cfg = await resolveSshConfig('example', execReturning('HostName 10.0.0.1\nUser bob\nPort 22'));
    expect(cfg.hostname).toBe('10.0.0.1');
    expect(cfg.user).toBe('bob');
    expect(cfg.port).toBe('22');
  });

  it('falls back to the alias and sane defaults when ssh -G yields nothing', async () => {
    const cfg = await resolveSshConfig('example', async () => ({ code: 0, stdout: '', stderr: 'boom' }));
    expect(cfg.hostname).toBe('example');
    expect(cfg.user).toBe('');
    expect(cfg.port).toBe('22');
    expect(cfg.userKnownHostsFile).toBe(`${require('os').homedir()}/.ssh/known_hosts`);
  });

  it('uses the FIRST path when ssh -G reports a space-separated list', async () => {
    const cfg = await resolveSshConfig('example',
      execReturning('HostName 10.0.0.1\nUser bob\nPort 22\nUserKnownHostsFile /custom/hosts /home/bob/.ssh/known_hosts2'));
    expect(cfg.userKnownHostsFile).toBe('/custom/hosts');
  });
});
```

- [ ] **Step 6: Run and verify they fail**

Run: `npx jest tests/unit/external/probe-external-host.test.ts -t "resolveSshConfig"`
Expected: FAIL — `userKnownHostsFile` is `undefined`.

- [ ] **Step 7: Implement the `resolveSshConfig` change**

In `src/main/external/sshExec.ts`, add near the top:

```ts
import * as path from 'path';
import * as os from 'os';
```

Change the interface and function:

```ts
export interface ResolvedSshConfig {
  hostname: string;
  user: string;
  port: string;
  /** First path when ssh -G reports a space-separated list — the file ssh itself would write to. */
  userKnownHostsFile: string;
}

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
  const knownHostsField = fields.get('userknownhostsfile');
  const userKnownHostsFile = knownHostsField
    ? knownHostsField.split(/\s+/)[0]
    : path.join(os.homedir(), '.ssh', 'known_hosts');
  return {
    hostname: fields.get('hostname') || alias,
    user: fields.get('user') || '',
    port: fields.get('port') || '22',
    userKnownHostsFile,
  };
}
```

- [ ] **Step 8: Run tests**

Run: `npx jest tests/unit/external/probe-external-host.test.ts -t "resolveSshConfig"`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for `hostKeyTrust.ts`**

Create `tests/unit/external/host-key-trust.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { captureOfferedHostKey, trustHostKey } from '../../../src/main/external/hostKeyTrust';
import type { SshExec } from '../../../src/main/external/sshExec';

const KEY_LINE = 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

/** Simulates the real capture invocation: writes KEY_LINE to whichever temp
 * file appears in the argv's UserKnownHostsFile= option, mirroring what a
 * real `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=<f>`
 * does on success. */
function execWriting(line: string | null): SshExec {
  return async (args) => {
    const opt = args.find((a) => a.startsWith('UserKnownHostsFile='));
    if (line !== null && opt) {
      fs.writeFileSync(opt.slice('UserKnownHostsFile='.length), line + '\n');
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

function keygenReturning(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: '' });
}

describe('captureOfferedHostKey', () => {
  it('returns the fingerprint, key type and raw line on success', async () => {
    const result = await captureOfferedHostKey(
      'example', execWriting(KEY_LINE),
      keygenReturning('256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU example.com (ED25519)'),
    );
    expect(result).toEqual({
      fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
      keyType: 'ED25519',
      rawLine: KEY_LINE,
    });
  });

  it('returns null when no key was ever written (host unreachable)', async () => {
    const result = await captureOfferedHostKey('example', execWriting(null), keygenReturning(''));
    expect(result).toBeNull();
  });

  it('returns null when ssh-keygen output cannot be parsed', async () => {
    const result = await captureOfferedHostKey('example', execWriting(KEY_LINE), keygenReturning('garbage'));
    expect(result).toBeNull();
  });

  it('cleans up its temp file whether it succeeds or fails', async () => {
    const seenPaths: string[] = [];
    const exec: SshExec = async (args) => {
      const opt = args.find((a) => a.startsWith('UserKnownHostsFile='))!;
      const p = opt.slice('UserKnownHostsFile='.length);
      seenPaths.push(p);
      fs.writeFileSync(p, KEY_LINE + '\n');
      return { code: 0, stdout: '', stderr: '' };
    };
    await captureOfferedHostKey('example', exec,
      keygenReturning('256 SHA256:abc example.com (ED25519)'));
    expect(seenPaths).toHaveLength(1);
    expect(fs.existsSync(seenPaths[0])).toBe(false);
  });

  it('rejects an unsafe alias before any exec runs', async () => {
    const exec = jest.fn();
    await expect(captureOfferedHostKey('-oProxyCommand=evil', exec as any, keygenReturning('')))
      .rejects.toThrow(/Invalid SSH host alias/);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('trustHostKey', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-known-hosts-test-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('appends the line to an existing file', () => {
    const file = path.join(dir, 'known_hosts');
    fs.writeFileSync(file, 'existing-host ssh-ed25519 AAAA...\n');
    trustHostKey(file, KEY_LINE);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toBe(`existing-host ssh-ed25519 AAAA...\n${KEY_LINE}\n`);
  });

  it('creates the file and parent directory when neither exists', () => {
    const file = path.join(dir, 'nested', '.ssh', 'known_hosts');
    trustHostKey(file, KEY_LINE);
    expect(fs.readFileSync(file, 'utf-8')).toBe(`${KEY_LINE}\n`);
  });
});
```

- [ ] **Step 10: Run and verify they fail**

Run: `npx jest tests/unit/external/host-key-trust.test.ts -v`
Expected: FAIL — `src/main/external/hostKeyTrust.ts` does not exist.

- [ ] **Step 11: Implement `hostKeyTrust.ts`**

Create `src/main/external/hostKeyTrust.ts`:

```ts
/**
 * Capture the SSH host key an alias offers, and — once a human has approved
 * it via Local's Settings UI — trust it. See
 * docs/superpowers/specs/2026-08-07-host-key-trust-on-first-use-design.md.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildHostKeyCaptureArgs, HOST_KEY_CAPTURE_TIMEOUT_MS, assertSafeSshAlias } from '../transport/ssh-args';
import type { SshExec } from './sshExec';

export interface CapturedHostKey {
  fingerprint: string;
  keyType: string;
  rawLine: string;
}

export type KeygenExec = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const defaultKeygenExec: KeygenExec = (args) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('ssh-keygen', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (err: Error) => resolve({ code: null, stdout: '', stderr: err.message }));
  });

/** `<bits> SHA256:<fingerprint> <host> (<TYPE>)` — ssh-keygen -lf's own format. */
const KEYGEN_FINGERPRINT_RE = /^\d+\s+(SHA256:\S+)\s+\S+\s+\(([A-Za-z0-9-]+)\)/;

/**
 * Fetch the host key an alias currently offers, without trusting it.
 *
 * Connects through the alias into an isolated temp known_hosts file (see
 * buildHostKeyCaptureArgs) so the offered key can be inspected before any
 * trust decision, then computes its fingerprint with `ssh-keygen -lf`.
 *
 * Returns null for ANY failure — unreachable host, no key received, or
 * unparseable ssh-keygen output. Callers must treat null as "could not
 * determine", never as "trusted" or "known to have changed".
 */
export async function captureOfferedHostKey(
  alias: string,
  exec: SshExec,
  keygenExec: KeygenExec = defaultKeygenExec,
): Promise<CapturedHostKey | null> {
  assertSafeSshAlias(alias);
  const tempFile = path.join(os.tmpdir(), `nexus-hostkey-${crypto.randomUUID()}`);
  try {
    await exec(buildHostKeyCaptureArgs(alias, tempFile), HOST_KEY_CAPTURE_TIMEOUT_MS);

    let rawLine: string;
    try {
      rawLine = fs.readFileSync(tempFile, 'utf-8').trim().split('\n')[0]?.trim() ?? '';
    } catch {
      return null;
    }
    if (!rawLine) return null;

    const fp = await keygenExec(['-lf', tempFile]);
    const m = KEYGEN_FINGERPRINT_RE.exec(fp.stdout.trim());
    if (!m) return null;

    return { fingerprint: m[1], keyType: m[2], rawLine };
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* never created, or already gone */ }
  }
}

/**
 * Append a raw known_hosts line to the real file, creating the parent
 * directory if needed. The ONLY function in this module that touches real
 * trust state — called exclusively from the TRUST_EXTERNAL_HOST_KEY IPC
 * handler (renderer-only; see ipc-handlers.ts).
 */
export function trustHostKey(userKnownHostsFile: string, rawLine: string): void {
  fs.mkdirSync(path.dirname(userKnownHostsFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(userKnownHostsFile, `${rawLine.trim()}\n`);
}
```

- [ ] **Step 12: Run tests**

Run: `npx jest tests/unit/external/host-key-trust.test.ts tests/unit/external/probe-external-host.test.ts tests/unit/transport/external-ssh-args.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 13: Commit**

```bash
git add src/main/external/hostKeyTrust.ts src/main/transport/ssh-args.ts src/main/external/sshExec.ts tests/unit/external/host-key-trust.test.ts tests/unit/external/probe-external-host.test.ts tests/unit/transport/external-ssh-args.test.ts
git commit -m "feat(external): capture and trust an offered SSH host key

New src/main/external/hostKeyTrust.ts fetches a host's offered key through
the alias itself (never ssh-keyscan, which cannot traverse a ProxyJump)
into an isolated temp known_hosts file, and can append it to the real one
once approved. trustHostKey is the only function that writes real trust
state -- Task 5 wires it to a renderer-only IPC channel, never GraphQL."
```

---

### Task 2: Classify `host-key-unknown` and `host-key-changed` in `probeExternalHost`'s Gate 1

**Files:**
- Modify: `src/main/external/probeExternalHost.ts`
- Test: `tests/unit/external/probe-external-host.test.ts`

**Interfaces:**
- Consumes: `captureOfferedHostKey` (Task 1, `src/main/external/hostKeyTrust.ts`).
- Produces: `ProbeFailureKind` gains `'host-key-unknown' | 'host-key-changed'`. `ProbeFailure`
  gains optional `fingerprint?: string` and `keyType?: string`, populated only for
  `'host-key-unknown'` when the capture succeeds.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/external/probe-external-host.test.ts`, inside the existing `describe('probeExternalHost — gate 1', ...)` block (add these `it`s alongside the existing ones — do not remove any):

```ts
jest.mock('../../../src/main/external/hostKeyTrust', () => ({
  captureOfferedHostKey: jest.fn(),
}));
```

(Place this `jest.mock` call at the TOP of the file, before the `import { probeExternalHost }`
line — Jest hoists `jest.mock` calls automatically, but keeping it visually with the other
top-level mocks avoids confusion for the next reader.)

```ts
import { captureOfferedHostKey } from '../../../src/main/external/hostKeyTrust';
const captureMock = captureOfferedHostKey as jest.Mock;

// ... inside describe('probeExternalHost — gate 1', ...):

it('classifies a changed host key and never calls captureOfferedHostKey for it', async () => {
  const bannerText = [
    '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
    'The fingerprint for the ED25519 key sent by the remote host is',
    'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.',
    'Host key verification failed.',
  ].join('\n');
  const r = await probeExternalHost('example', {
    exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: bannerText }]]),
  });
  expect(r.failure?.kind).toBe('host-key-changed');
  expect(r.failure?.detail).toContain('REMOTE HOST IDENTIFICATION HAS CHANGED');
  expect(r.failure?.fingerprint).toBeUndefined();
  expect(captureMock).not.toHaveBeenCalled();
});

it('classifies an unknown host key and includes the captured fingerprint', async () => {
  captureMock.mockResolvedValueOnce({ fingerprint: 'SHA256:abc123', keyType: 'ED25519', rawLine: 'x' });
  const r = await probeExternalHost('example', {
    exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'Host key verification failed.' }]]),
  });
  expect(r.failure?.kind).toBe('host-key-unknown');
  expect(r.failure?.fingerprint).toBe('SHA256:abc123');
  expect(r.failure?.keyType).toBe('ED25519');
  expect(r.failure?.remedy).toContain('SHA256:abc123');
  expect(r.failure?.remedy).toMatch(/Settings/i);
  expect(captureMock).toHaveBeenCalledWith('example', expect.any(Function));
});

it('reports an unknown host key honestly when the fingerprint cannot be captured', async () => {
  captureMock.mockResolvedValueOnce(null);
  const r = await probeExternalHost('example', {
    exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'Host key verification failed.' }]]),
  });
  expect(r.failure?.kind).toBe('host-key-unknown');
  expect(r.failure?.fingerprint).toBeUndefined();
  expect(r.failure?.remedy).toMatch(/could not fetch/i);
  expect(r.failure?.remedy).toContain('nexus host test example');
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/external/probe-external-host.test.ts -t "host key"`
Expected: FAIL — all three new cases currently fall into the generic `unreachable` branch.

- [ ] **Step 3: Implement**

In `src/main/external/probeExternalHost.ts`:

Add the import:

```ts
import { captureOfferedHostKey } from './hostKeyTrust';
```

Change `ProbeFailureKind` and `ProbeFailure`:

```ts
export type ProbeFailureKind =
  | 'alias-not-found'
  | 'auth-failed'
  | 'unreachable'
  | 'wp-cli-missing'
  | 'wordpress-not-found'
  | 'multiple-wordpress'
  | 'host-key-unknown'
  | 'host-key-changed';

export interface ProbeFailure {
  kind: ProbeFailureKind;
  /** ssh's or WP-CLI's own words, verbatim — that is what a user can search for. */
  detail: string;
  /** A command or concrete action, never advice. */
  remedy: string;
  /** Populated only for kind === 'host-key-unknown', and only when captureOfferedHostKey succeeded. */
  fingerprint?: string;
  /** Populated only alongside fingerprint. */
  keyType?: string;
}
```

Change `fail()` to accept the two new optional failure fields:

```ts
function fail(
  alias: string,
  resolved: ResolvedSshConfig,
  kind: ProbeFailureKind,
  detail: string,
  remedy: string,
  extra: Partial<ProbeReport> = {},
  failureExtra: Partial<Pick<ProbeFailure, 'fingerprint' | 'keyType'>> = {},
): ProbeReport {
  return { ok: false, alias, resolved, ...extra, failure: { kind, detail: detail.trim(), remedy, ...failureExtra } };
}
```

Insert two new branches in Gate 1, immediately before the final `return fail(alias, resolved, 'unreachable', ...)`:

```ts
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(detail)) {
      return fail(alias, resolved, 'host-key-changed', detail,
        `The key '${alias}' (${resolved.hostname}) now presents does not match what was trusted `
        + `before. This can mean the server was reinstalled or replaced, or that something is `
        + `intercepting your connection. Verify the new fingerprint against your hosting `
        + `provider's control panel or SSH access log before trusting it. If you're sure it's `
        + `legitimate, remove the stale entry yourself and re-run this command:\n\n`
        + `  ssh-keygen -R ${resolved.hostname}\n`);
    }

    if (/host key verification failed/i.test(detail)) {
      const captured = await captureOfferedHostKey(alias, exec);
      if (captured) {
        return fail(alias, resolved, 'host-key-unknown', detail,
          `New host key for '${alias}' (${resolved.hostname}):\n  ${captured.keyType} ${captured.fingerprint}\n\n`
          + `Approve it in Local → Settings → Nexus AI → External Hosts, then re-run this command.`,
          {}, { fingerprint: captured.fingerprint, keyType: captured.keyType });
      }
      return fail(alias, resolved, 'host-key-unknown', detail,
        `Could not fetch the host's key to display a fingerprint (the host may have become `
        + `unreachable) — re-run:\n  nexus host test ${alias}`);
    }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/external/probe-external-host.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/external/probeExternalHost.ts tests/unit/external/probe-external-host.test.ts
git commit -m "fix(external): classify host-key-unknown and host-key-changed in probeExternalHost

Replaces the opaque generic 'unreachable' failure a brand-new host hit on
its very first command. host-key-unknown captures a real fingerprint
through the alias itself and points at Settings for approval; a changed
key is hard-refused with no approval path, matching ssh's own model."
```

---

### Task 3: Hint text (no fingerprint) in `ExternalSshTransport.annotateFailure()`

**Files:**
- Modify: `src/main/transport/ExternalSshTransport.ts`
- Test: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this only changes hint text for `wp_*` commands and the schedulers,
  which have no approval path and must never auto-trust.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/transport/conformance.test.ts`, inside the existing
`describe('ExternalSshTransport', ...)` block:

```ts
it('hints that an unknown host key must be approved via nexus host test', async () => {
  spawnMock.mockImplementation(() => fakeProc({ code: 255, stderr: 'Host key verification failed.' }));
  const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
  expect(res.success).toBe(false);
  expect(res.stdout).toMatch(/nexus host test/i);
  expect(res.stdout).not.toMatch(/SHA256/); // no fingerprint fetch on this path
});

it('hints about a changed host key without offering to fix it automatically', async () => {
  spawnMock.mockImplementation(() => fakeProc({
    code: 255,
    stderr: 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.',
  }));
  const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
  expect(res.success).toBe(false);
  expect(res.stdout).toMatch(/reinstalled|intercepting/i);
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/transport/conformance.test.ts -t "host key"`
Expected: FAIL — both cases currently return the raw stderr unchanged.

- [ ] **Step 3: Implement**

In `src/main/transport/ExternalSshTransport.ts`, add two branches to `annotateFailure`, before
its final `return text;`:

```ts
function annotateFailure(stderr: string): string {
  const text = stderr.trim();
  if (/command not found|wp: not found/i.test(text)) {
    return `${text}\n\nHint: WP-CLI ('wp') was not found on the remote host's non-interactive `
      + `PATH. Run 'nexus host test <alias>' — it searches the usual locations and will tell you `
      + `whether WP-CLI is missing or just off PATH.`;
  }
  if (/does not seem to be a WordPress installation/i.test(text)) {
    return `${text}\n\nHint: pass --path=/path/to/wordpress if WordPress is not in the `
      + `SSH login directory.`;
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `${text}\n\nThis host's key no longer matches what was trusted before — this can mean `
      + `the server was reinstalled, or that something is intercepting your connection. Run `
      + `'nexus host test <alias>' for details before doing anything else.`;
  }
  if (/host key verification failed/i.test(text)) {
    return `${text}\n\nHint: this host's identity has never been verified. Run `
      + `'nexus host test <alias>' — it will show the key's fingerprint and where to approve it.`;
  }
  return text;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/transport/conformance.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/transport/ExternalSshTransport.ts tests/unit/transport/conformance.test.ts
git commit -m "fix(transport): hint at nexus host test for unknown/changed host keys

wp_* commands and the schedulers get an actionable message but never a
fingerprint (this function is synchronous and used inline in runWpCli) and
never a way to auto-trust -- only host test/host add can display a
fingerprint, and only Settings can approve one."
```

---

### Task 4: Widen `NexusHostProbeFailure` in the GraphQL schema

**Files:**
- Modify: `src/main/graphql/schema.ts`
- Test: `tests/unit/graphql/host-resolvers.test.ts`

**Interfaces:**
- Consumes: `ProbeFailure.fingerprint`/`keyType` (Task 2).
- Produces: `NexusHostProbeFailure.fingerprint: String` and `.keyType: String` — reachable via
  `nexusHostProbe`'s existing `report.failure` field. No resolver code changes: `toHostReport`
  (`src/main/graphql/resolvers.ts:151-166`) already does `failure: r.failure ?? null` — the
  whole object, not field-by-field — so new fields on `ProbeFailure` reach GraphQL automatically
  as long as the schema declares them.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/graphql/host-resolvers.test.ts` (uses the file's existing `probeMock`,
`failReport`, and `ctx()` helpers already defined at the top of the file):

```ts
it('passes fingerprint and keyType through from probeExternalHost, unmodified', async () => {
  probeMock.mockResolvedValueOnce({
    ok: false,
    alias: 'h1',
    resolved: { hostname: '203.0.113.10', user: 'deploy', port: '2222', userKnownHostsFile: '/x' },
    failure: {
      kind: 'host-key-unknown',
      detail: 'Host key verification failed.',
      remedy: 'New host key ...',
      fingerprint: 'SHA256:abc123',
      keyType: 'ED25519',
    },
  });
  const c = ctx();
  const r = await (createResolvers(c.context).Mutation as any).nexusHostProbe(null, { alias: 'h1' });
  expect(r.report.failure.fingerprint).toBe('SHA256:abc123');
  expect(r.report.failure.keyType).toBe('ED25519');
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/graphql/host-resolvers.test.ts -t "fingerprint"`
Expected: FAIL — this test calls the resolver function directly (not a real GraphQL server), so
it actually already passes at the JS level; it is the schema.ts change in Step 3 that a real
GraphQL query would need to expose these fields to a client. Run it anyway to confirm the
resolver-level plumbing, then proceed to Step 3 regardless — schema.ts is the part with no
existing test coverage.

- [ ] **Step 3: Implement**

In `src/main/graphql/schema.ts`, change the `NexusHostProbeFailure` type:

```graphql
  type NexusHostProbeFailure {
    "One of: alias-not-found, auth-failed, unreachable, wp-cli-missing, wordpress-not-found, multiple-wordpress, host-key-unknown, host-key-changed"
    kind: String!
    "ssh's or WP-CLI's own output, verbatim"
    detail: String!
    "The exact next command or action"
    remedy: String!
    "SHA256 fingerprint of a newly offered host key. Populated only when kind is host-key-unknown, and only when the key could be captured."
    fingerprint: String
    "Key type (e.g. ED25519, RSA) matching fingerprint. Populated only alongside fingerprint."
    keyType: String
  }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/graphql/host-resolvers.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/graphql/schema.ts tests/unit/graphql/host-resolvers.test.ts
git commit -m "feat(graphql): expose fingerprint/keyType on NexusHostProbeFailure

No resolver change needed -- toHostReport already passes the whole
failure object through unmodified. This lets the renderer's upcoming
Settings UI read a structured fingerprint instead of parsing remedy prose."
```

---

### Task 5: `TRUST_EXTERNAL_HOST_KEY` — the renderer-only IPC channel

**Files:**
- Modify: `src/common/constants.ts` (new `IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY`)
- Modify: `src/main/ipc-handlers.ts` (new handler)
- Test: `tests/unit/ipc/trust-external-host-key.test.ts` (new)

**Interfaces:**
- Consumes: `captureOfferedHostKey`, `trustHostKey` (Task 1); `resolveSshConfig` (Task 1, for
  `userKnownHostsFile`).
- Produces: IPC channel `TRUST_EXTERNAL_HOST_KEY` — `(alias: string) => Promise<{ success:
  boolean; error: string | null; fingerprint?: string }>`. **This channel is never added to
  `schema.ts` and never called from `src/cli/`.**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ipc/trust-external-host-key.test.ts`, following the same
`MockIpcMain`/`jest.mock('electron', ...)` pattern as `tests/unit/ipc/get-external-hosts.test.ts`:

```ts
const captureMock = jest.fn();
const trustMock = jest.fn();
jest.mock('../../../src/main/external/hostKeyTrust', () => ({
  captureOfferedHostKey: (...args: any[]) => captureMock(...args),
  trustHostKey: (...args: any[]) => trustMock(...args),
}));
const resolveMock = jest.fn();
jest.mock('../../../src/main/external/sshExec', () => ({
  resolveSshConfig: (...args: any[]) => resolveMock(...args),
  defaultSshExec: jest.fn(),
}));

class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op in tests */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

function register() {
  const noop = () => {};
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {},
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: { getDb: () => null },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

beforeEach(() => {
  captureMock.mockReset();
  trustMock.mockReset();
  resolveMock.mockReset();
  register();
});

describe('TRUST_EXTERNAL_HOST_KEY', () => {
  it('captures, trusts, and reports the trusted fingerprint on success', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result).toEqual({ success: true, error: null, fingerprint: 'SHA256:abc' });
    expect(trustMock).toHaveBeenCalledWith('/home/u/.ssh/known_hosts', 'h ssh-ed25519 AAAA');
  });

  it('reports failure and never calls trustHostKey when capture fails', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/home/u/.ssh/known_hosts' });
    captureMock.mockResolvedValue(null);

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not/i);
    expect(trustMock).not.toHaveBeenCalled();
  });

  it('reports failure when trustHostKey itself throws (e.g. permission error)', async () => {
    resolveMock.mockResolvedValue({ hostname: 'h', user: 'u', port: '22', userKnownHostsFile: '/root/.ssh/known_hosts' });
    captureMock.mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'h ssh-ed25519 AAAA' });
    trustMock.mockImplementation(() => { throw new Error('EACCES'); });

    const result = await mockIpc.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'acme-box');

    expect(result.success).toBe(false);
    expect(result.error).toContain('EACCES');
  });
});

describe('TRUST_EXTERNAL_HOST_KEY is never exposed over GraphQL', () => {
  it('does not appear anywhere in schema.ts', () => {
    const fs = require('fs');
    const schema = fs.readFileSync(require.resolve('../../../src/main/graphql/schema.ts'), 'utf-8');
    expect(schema).not.toMatch(/TRUST_EXTERNAL_HOST_KEY|trustExternalHostKey|nexusHostTrustKey/i);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/ipc/trust-external-host-key.test.ts -v`
Expected: FAIL — `IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY` is `undefined`, so `mockIpc.invoke`
throws "No handler registered for undefined".

- [ ] **Step 3: Add the channel constant**

In `src/common/constants.ts`, in the `IPC_CHANNELS` object, right after the existing
`GET_EXTERNAL_HOSTS` entry:

```ts
  // External SSH Hosts
  GET_EXTERNAL_HOSTS: `${ADDON_PREFIX}:get-external-hosts`,
  // Renderer-only: never add a matching GraphQL mutation. See
  // docs/superpowers/specs/2026-08-07-host-key-trust-on-first-use-design.md
  // for why a GraphQL mutation here would not actually be CLI-inaccessible.
  TRUST_EXTERNAL_HOST_KEY: `${ADDON_PREFIX}:trust-external-host-key`,
```

- [ ] **Step 4: Implement the handler**

In `src/main/ipc-handlers.ts`, add the imports near the other named imports at the top:

```ts
import { captureOfferedHostKey, trustHostKey } from './external/hostKeyTrust';
import { resolveSshConfig, defaultSshExec } from './external/sshExec';
```

Add the handler in `registerIpcHandlers`, immediately after the existing
`safeHandle(IPC_CHANNELS.GET_EXTERNAL_HOSTS, ...)` block:

```ts
  // Renderer-only. Deliberately NOT a GraphQL mutation and NOT called from
  // src/cli/ — see the constant's own comment in constants.ts. This is the
  // only function in the codebase that may call trustHostKey.
  safeHandle(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, async (_event: unknown, alias: string) => {
    try {
      const resolved = await resolveSshConfig(alias);
      const captured = await captureOfferedHostKey(alias, defaultSshExec);
      if (!captured) {
        return { success: false, error: `Could not fetch a host key for '${alias}' — it may have become unreachable.` };
      }
      trustHostKey(resolved.userKnownHostsFile, captured.rawLine);
      return { success: true, error: null, fingerprint: captured.fingerprint };
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) };
    }
  });
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/ipc/trust-external-host-key.test.ts tests/unit/ipc/get-external-hosts.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts tests/unit/ipc/trust-external-host-key.test.ts
git commit -m "feat(ipc): TRUST_EXTERNAL_HOST_KEY -- the only path that can trust a host key

Deliberately an ipcMain channel, not a GraphQL mutation: the renderer and
CLI hit the identical HTTP GraphQL endpoint with the identical token, so
a mutation the CLI 'just doesn't call' is not a real boundary. A test
pins that this channel never appears in schema.ts."
```

---

### Task 6: Approve/Dismiss UI in `SettingsTab.tsx`

**Files:**
- Modify: `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/SettingsTab.test.tsx`

**Interfaces:**
- Consumes: the existing `nexusHostProbe` GraphQL mutation (via `rendererGql`, already used
  elsewhere in this codebase — see `src/renderer/utils/rendererGql.ts`); the
  `TRUST_EXTERNAL_HOST_KEY` IPC channel (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/renderer/SettingsTab.test.tsx`, inside the existing
`describe('SettingsTab — external hosts', ...)` block:

```ts
it('checking an alias with an unknown host key shows the fingerprint and an Approve button', async () => {
  const mutateMock = jest.fn().mockResolvedValue({
    data: {
      nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'newbox', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:abc123', keyType: 'ED25519',
        } },
      },
    },
  });
  jest.spyOn(global as any, 'fetch').mockImplementation(() => Promise.resolve({
    json: () => Promise.resolve((mutateMock() as any).then ? undefined : undefined),
  } as any));
  // rendererGql posts to fetch and reads response.json() -- simulate that shape directly:
  (global as any).fetch = jest.fn().mockResolvedValue({
    json: async () => ({ data: { nexusHostProbe: {
      success: true, error: null,
      report: { ok: false, alias: 'newbox', failure: {
        kind: 'host-key-unknown', detail: 'x', remedy: 'y',
        fingerprint: 'SHA256:abc123', keyType: 'ED25519',
      } },
    } } }),
  });

  const electron = mockElectron({});
  const instance: any = new SettingsTab({ electron });
  (instance as any).mounted = true;
  spySetState(instance);
  await instance.loadAll();
  instance.setState({ hostKeyCheckAlias: 'newbox' });
  await instance.checkHostKey();
  const tree = instance.render();
  expect(textOf(tree)).toContain('SHA256:abc123');
  expect(textOf(tree)).toContain('ED25519');
  const approveButtons = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('Approve'));
  expect(approveButtons.length).toBeGreaterThan(0);
});

it('approving calls the TRUST_EXTERNAL_HOST_KEY IPC channel, not GraphQL', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({
    json: async () => ({ data: { nexusHostProbe: {
      success: true, error: null,
      report: { ok: false, alias: 'newbox', failure: {
        kind: 'host-key-unknown', detail: 'x', remedy: 'y',
        fingerprint: 'SHA256:abc123', keyType: 'ED25519',
      } },
    } } }),
  });
  const invokeMock = jest.fn().mockResolvedValue({ success: true, error: null, fingerprint: 'SHA256:abc123' });
  const electron = mockElectron({});
  electron.ipcRenderer.invoke = invokeMock;
  const instance: any = new SettingsTab({ electron });
  (instance as any).mounted = true;
  spySetState(instance);
  await instance.loadAll();
  instance.setState({ hostKeyCheckAlias: 'newbox' });
  await instance.checkHostKey();
  await instance.approveHostKey();
  expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'newbox');
});

it('a changed host key shows no Approve button', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({
    json: async () => ({ data: { nexusHostProbe: {
      success: true, error: null,
      report: { ok: false, alias: 'newbox', failure: {
        kind: 'host-key-changed', detail: 'REMOTE HOST IDENTIFICATION HAS CHANGED', remedy: 'contact your admin',
      } },
    } } }),
  });
  const electron = mockElectron({});
  const instance: any = new SettingsTab({ electron });
  (instance as any).mounted = true;
  spySetState(instance);
  await instance.loadAll();
  instance.setState({ hostKeyCheckAlias: 'newbox' });
  await instance.checkHostKey();
  const tree = instance.render();
  expect(textOf(tree)).toContain('contact your admin');
  expect(findAll(tree, (n) => n.type === 'button' && textOf(n).includes('Approve'))).toHaveLength(0);
});
```

Read the top of `tests/unit/renderer/SettingsTab.test.tsx` first to confirm the exact shape of
its `mockElectron` helper (it must already stub `ipcRenderer.invoke`) and to import
`IPC_CHANNELS` if not already imported in that file.

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx -t "host key"`
Expected: FAIL — `checkHostKey`/`approveHostKey` do not exist, and `hostKeyCheckAlias` is not a
recognized state key.

- [ ] **Step 3: Implement**

In `src/renderer/components/SettingsTab.tsx`:

Add to the component's state type and initial state (alongside the existing `externalHosts`,
`addingException` fields):

```ts
    hostKeyCheckAlias: '',
    hostKeyCheckResult: null as null | { ok: boolean; failureKind?: string; detail?: string; remedy?: string; fingerprint?: string; keyType?: string },
    hostKeyTrusting: false,
```

Add two methods near `loadAll`/`saveSetting`:

```ts
  async checkHostKey(): Promise<void> {
    const alias = this.state.hostKeyCheckAlias.trim();
    if (!alias) return;
    this.setState({ hostKeyCheckResult: null });
    try {
      const data = await rendererGql<{ nexusHostProbe: { success: boolean; error: string | null; report: any } }>(`
        mutation($alias: String!) {
          nexusHostProbe(alias: $alias) {
            success error
            report { ok alias failure { kind detail remedy fingerprint keyType } }
          }
        }
      `, { alias });
      const report = data.nexusHostProbe.report;
      if (!this.mounted) return;
      if (!report) {
        this.setState({ hostKeyCheckResult: { ok: false, detail: data.nexusHostProbe.error ?? 'No report returned.' } });
        return;
      }
      this.setState({
        hostKeyCheckResult: {
          ok: report.ok,
          failureKind: report.failure?.kind,
          detail: report.failure?.detail,
          remedy: report.failure?.remedy,
          fingerprint: report.failure?.fingerprint,
          keyType: report.failure?.keyType,
        },
      });
    } catch (e: any) {
      if (this.mounted) this.setState({ hostKeyCheckResult: { ok: false, detail: e?.message ?? String(e) } });
    }
  }

  async approveHostKey(): Promise<void> {
    const alias = this.state.hostKeyCheckAlias.trim();
    if (!alias) return;
    this.setState({ hostKeyTrusting: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, alias);
      if (!this.mounted) return;
      if (result.success) {
        this.setState({
          hostKeyCheckResult: { ok: true, detail: `Trusted. Run 'nexus host add ${alias}' to finish registration.` },
          hostKeyTrusting: false,
        });
      } else {
        this.setState({ hostKeyCheckResult: { ok: false, detail: result.error }, hostKeyTrusting: false });
      }
    } catch (e: any) {
      if (this.mounted) this.setState({ hostKeyCheckResult: { ok: false, detail: e?.message ?? String(e) }, hostKeyTrusting: false });
    }
  }
```

Add the import at the top of the file:

```ts
import { rendererGql } from '../utils/rendererGql';
```

Add the UI section, immediately after the existing External Hosts chip list block (right before
the `sublabel('External SSH Hosts')` block's closing, i.e. as its own new block that follows
it — insert after the `),` that closes the chip-list `React.createElement('div', ...)` and
before the next `React.createElement('div', { style: { ...cardStyle, ... } }, ...)` that starts
the refresh-schedule card):

```ts
      React.createElement('div', { style: { marginBottom: 10 } },
        React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } },
          React.createElement('input', {
            type: 'text',
            placeholder: 'alias to check',
            value: this.state.hostKeyCheckAlias,
            onChange: (e: any) => this.setState({ hostKeyCheckAlias: e.target.value }),
            style: { flex: 1, fontSize: 12, padding: '4px 8px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, color: 'inherit' },
          }),
          React.createElement('button', {
            onClick: () => this.checkHostKey(),
            style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
          }, 'Check'),
        ),
        this.state.hostKeyCheckResult && React.createElement('div', {
          style: { fontSize: 12, padding: '8px 10px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4 },
        },
          this.state.hostKeyCheckResult.ok
            ? React.createElement('div', {}, this.state.hostKeyCheckResult.detail || 'Already reachable — no key approval needed.')
            : this.state.hostKeyCheckResult.failureKind === 'host-key-unknown' && this.state.hostKeyCheckResult.fingerprint
              ? React.createElement('div', {},
                  React.createElement('div', {}, `${this.state.hostKeyCheckResult.keyType} ${this.state.hostKeyCheckResult.fingerprint}`),
                  React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                    React.createElement('button', {
                      disabled: this.state.hostKeyTrusting,
                      onClick: () => this.approveHostKey(),
                      style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
                    }, 'Approve'),
                    React.createElement('button', {
                      onClick: () => this.setState({ hostKeyCheckResult: null }),
                      style: { fontSize: 12, padding: '4px 10px', borderRadius: 4 },
                    }, 'Dismiss'),
                  ),
                )
              : React.createElement('div', {}, this.state.hostKeyCheckResult.remedy || this.state.hostKeyCheckResult.detail),
        ),
      ),
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsTab.tsx tests/unit/renderer/SettingsTab.test.tsx
git commit -m "feat(renderer): Approve/Dismiss UI for unknown external host keys

Check reuses the existing nexusHostProbe mutation the CLI already calls;
Approve calls TRUST_EXTERNAL_HOST_KEY over IPC, never GraphQL. A changed
host key shows detail/remedy as plain text with no Approve option."
```

---

### Task 7: Docs and full-suite verification

**Files:**
- Modify: `CLAUDE.md` (External SSH Hosts section)
- No test file — this task is verification, not new behavior.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Update CLAUDE.md**

In the `## External SSH Hosts` section of `CLAUDE.md`, add a new bullet (alongside the existing
ones on probing, registration, and the environment gate):

```markdown
- **A brand-new host's first command fails with a real fingerprint, not an opaque error.**
  `probeExternalHost`'s Gate 1 classifies `Host key verification failed.` as
  `host-key-unknown` and fetches the offered key by connecting through the alias itself into an
  isolated temp `known_hosts` file — never `ssh-keyscan`, which cannot traverse a `ProxyJump`
  and would silently break every bastion-based host. A previously-trusted host whose key later
  changes is `host-key-changed` and is hard-refused everywhere, with no approval path on any
  surface — matching ssh's own model of never re-prompting past a real MITM/reinstall warning.
  **Approving a new key is possible only from Local's Settings UI**, via a genuine
  `ipcMain`/`ipcRenderer` channel (`TRUST_EXTERNAL_HOST_KEY`) that is deliberately never added
  to the GraphQL schema and never called from `src/cli/`. This is not a CLI convention — the
  renderer and CLI hit the identical HTTP GraphQL endpoint with the identical bearer token
  (`rendererGql.ts` reads the same `graphql-connection-info.json` the CLI does), so a GraphQL
  mutation the CLI "just doesn't call" would not be a real boundary; only a true IPC channel is.
  `host test`/`host add` show the fingerprint (read-only, via the same `nexusHostProbe` mutation
  they already call) and point at Settings — neither has a `y/n` prompt, and `--yes` never
  bypasses this.
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest 2>&1 | tail -8
npx tsc --noEmit
```

Expected: the same 12 pre-existing, unrelated failing suites as the plan's Global Constraints
baseline (re-verify the exact current count first — it may have shifted slightly from other
work on this branch; what matters is that this plan's tasks introduce zero new failures), and a
clean `tsc`.

- [ ] **Step 3: Live verification (manual, if a real external host is available)**

Against a real, never-before-connected SSH alias:

```bash
nexus host test <brand-new-alias>
```

Confirm the output shows a real `SHA256:...` fingerprint and points at Settings, not the old
opaque "Check the host is up..." message. Then, in Local's Settings → Nexus AI, use the new
"Check"/"Approve" UI for the same alias, confirm the entry appears in `~/.ssh/known_hosts`
afterward, and re-run `nexus host test <alias>` to confirm it now proceeds past Gate 1.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document host-key trust-on-first-use in CLAUDE.md"
```
