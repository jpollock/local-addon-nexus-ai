# Host-Key Trust-on-First-Use — Design

## Problem

`buildExternalSshArgs` sets no `StrictHostKeyChecking` option, so every external SSH
connection uses the user's own `~/.ssh/config` default (`ask` on most systems). Under
`BatchMode=yes` (required so a non-interactive spawn never hangs waiting for a prompt), `ask`
mode with no tty just refuses immediately. Confirmed live against a genuinely new SiteGround
alias (`jeremyp114`, zero `known_hosts` entries): the very first command against any brand-new
host fails with `Host key verification failed.` and no guidance. Every host a user adds for the
first time will hit this — it is not host-specific.

`buildWpeSshArgs` (the WP Engine builder) already sets `StrictHostKeyChecking=accept-new`, so
this asymmetry was suspected to be deliberate. Verified it is not: no test or doc comment
discusses `StrictHostKeyChecking` in the context of `buildExternalSshArgs` — every existing
reference is WP-Engine-only. The omission is a gap, not a considered choice.

## Decisions made

- **Trust is granted only during an explicit, human-initiated action** — never as a side
  effect of a scheduled refresh or a `wp_*` command against an alias whose key was never
  confirmed. Those continue to fail, with a better message pointing at where to go, rather than
  silently trusting a key.
- **New/unknown host: show the fingerprint, require explicit approval.** Mirrors ssh's own
  default TOFU prompt. Preserves the actual security property TOFU confirmation exists for.
- **A CHANGED host key (previously trusted, key no longer matches) is hard-refused everywhere,
  never re-prompted, never approvable through any surface.** Matches ssh's own model: prompting
  on a changed key invites clicking through a real MITM/host-reinstall warning.
- **The trust-granting action is reachable only from Local's renderer UI, never from the CLI,
  MCP, or any GraphQL mutation, and `--yes` never bypasses it.** This is a stronger constraint
  than "no MCP tool" alone (the earlier draft of this spec stopped there) — see the next
  section for why that turned out not to be enough.

## Why "just don't wire it into the CLI" isn't sufficient

The first draft of this spec planned a `nexusHostProbe(..., autoTrustNewHostKey: Boolean)`
GraphQL input and an interactive CLI `y/n` prompt, reasoning that skipping an MCP tool was
enough to keep an agent from being the one accepting a host's identity.

That's wrong, checked against how this codebase actually reaches GraphQL:
`src/cli/utils/graphql.ts` (CLI) and `src/renderer/utils/rendererGql.ts` (renderer) both read
the exact same `graphql-connection-info.json` and POST to the exact same local HTTP endpoint
with the exact same bearer token — `rendererGql.ts`'s own docblock says this was deliberate, to
avoid needing a real IPC channel. There is no way for a resolver to tell a renderer-originated
call apart from a CLI-originated one, or from a raw `curl` using the same token file. So "the
CLI source code just doesn't call this mutation" is not a boundary — anything that can read that
token file (which is anything with shell access to the user's own machine, including an
agent's Bash tool) can call any GraphQL mutation directly, CLI code notwithstanding.

Two consequences:

1. **The write action cannot be a GraphQL mutation at all.** It has to be a genuine Electron
   `ipcMain.handle` / `ipcRenderer.invoke` channel — Chromium's internal process IPC, which is
   not a network socket and is not reachable by any external process. This is an existing,
   established pattern in this codebase (`ipc-handlers.ts`, `safeHandle`, `IPC_CHANNELS.*`) —
   not new plumbing, just not the pattern `nexusHostProbe`/`nexusHostAdd` happen to use.
2. **This is not, and cannot be, a defense against a fully adversarial agent with raw Bash
   access to the machine.** Such an agent could always `echo <key-line> >> ~/.ssh/known_hosts`
   directly — no application-level API design prevents that, and reasoning as though it did
   would be a false sense of security bought at real engineering cost. What *is* achievable and
   worth doing: don't let an agent following this codebase's own sanctioned interface (the
   `nexus` CLI, built specifically for Claude Code skills) blindly auto-approve a host's
   identity as a side effect of "just get this working." That is the actual goal, and an
   IPC-only write action fully achieves it — the CLI has no path to it, sanctioned or otherwise.

The read-only fingerprint *display* is harmless by contrast — it grants no trust, it only shows
public key material — so it stays a normal GraphQL query, reachable by both the CLI (for its
informational message) and the renderer (to populate the approval UI).

## Detection — reusing the existing connection attempt

`probeExternalHost`'s Gate 1 already attempts a real connection (`echo nexus-ok`) and
classifies the failure by matching stderr text (`could not resolve hostname`,
`permission denied`, else generic `unreachable`). Verified live, the two host-key cases have
distinct, reliable stderr signatures:

- **New/unknown host, batch mode**: `Host key verification failed.` — no fingerprint shown
  (the interactive prompt that would normally show one is suppressed entirely under
  `BatchMode=yes`).
- **Changed host key**: a `REMOTE HOST IDENTIFICATION HAS CHANGED!` banner, which *already
  includes* the offending key's `SHA256:...` fingerprint.

Two new `ProbeFailureKind` values are added — `host-key-unknown` and `host-key-changed` —
classified from the same stderr text Gate 1 already captures. No new connection attempt is
needed to tell an already-trusted host from these two cases; only the new-host case needs a
second, separate step to actually obtain the fingerprint (see below).

## Fetching the fingerprint — through the alias, not `ssh-keyscan`

`ssh-keyscan` was the obvious first choice but this OpenSSH build's `ssh-keyscan` has no
`-F`/config-file support — it cannot traverse a `ProxyJump`, so it would silently fail (or
worse, probe the wrong host) for every bastion-based external host, which CLAUDE.md explicitly
documents as a supported configuration (`ProxyJump and agent settings` carried by the alias).

Verified instead: connecting through the real `ssh` binary and the alias itself, with
`-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=<temp file>` and a trivial remote
command (`exit`), writes the offered key into the temp file *before* authentication is
attempted — confirmed live, including in the case where authentication then fails. This
naturally traverses whatever `ProxyJump`/port/user/identity the alias specifies, because it is
the same `ssh` invocation family as every other builder in `ssh-args.ts`. `ssh-keygen -lf
<tempfile>` then produces the human-readable `<bits> SHA256:<fingerprint> <host> (<type>)`
line. The temp file is discarded either way (approve or not); nothing is written to the real
`known_hosts` until the renderer's approval action runs.

## Where the trust is recorded

`ssh -G <alias>` already exposes `userknownhostsfile` (verified live — can be a
space-separated list if the user's own config sets one). `ResolvedSshConfig` gains this field;
the trusted line is appended to the *first* path in that list, falling back to
`~/.ssh/known_hosts` only if the field is empty. This matters because a `Host` block with its
own `UserKnownHostsFile` would otherwise have Nexus "trust" a file ssh never actually reads for
that alias, and every future connection would fail identically despite Nexus reporting success.

Per CLAUDE.md's existing precedent for `host add`/`host remove` ("mutate only local addon state
and never reach `services.localServices`"), this write is **not audited** — it touches only a
file on the user's own machine (`~/.ssh/known_hosts`), never a remote site or
`services.localServices`.

## API surface

- `probeExternalHost` / `ProbeFailureKind` gains `'host-key-unknown' | 'host-key-changed'`.
  `ExternalSshTransport.annotateFailure()` gets the same two stderr classifications (hint text
  only — `wp_*` commands and the schedulers never auto-trust, and have no path to approve
  anything).
- New GraphQL query `nexusHostKeyFingerprint(alias: String!): NexusHostKeyFingerprintResult!`
  — read-only, never writes. Runs the Gate-1-equivalent connectivity check and returns a
  discriminated status: `{ status: 'already-trusted' | 'unknown' | 'changed' | 'error',
  fingerprint, keyType, detail, remedy }` (fields populated per status — `fingerprint`/`keyType`
  only for `unknown`, `detail`/`remedy` for `changed`/`error`). Reachable by both the CLI (for
  its informational message) and the renderer (to populate the approval UI) — it's inert either
  way.
- New Electron IPC channel `TRUST_EXTERNAL_HOST_KEY` (added to `IPC_CHANNELS`, handled via
  `safeHandle` in `ipc-handlers.ts`) — `(alias: string) => Promise<{ success: boolean; error:
  string | null; fingerprint?: string }>`. Re-runs the capture (cheap, one more SSH round trip;
  simpler and safer than trusting a value that already crossed a process boundary once) and
  appends to the real `known_hosts`. **Not added to the GraphQL schema, not callable from the
  CLI, not exposed as an MCP tool.** Invoked only from the renderer via the existing
  preload-bridge pattern, wired to a button in `SettingsTab.tsx`.
- New module `src/main/external/hostKeyTrust.ts`: `captureOfferedHostKey(alias, exec)` (the
  temp-file capture + `ssh-keygen -lf` parse, shared by both the query and the IPC handler) and
  `trustHostKey(userKnownHostsFile, rawLine)` (the append, called only from the IPC handler).
  New builder `buildHostKeyCaptureArgs(alias, tempFilePath)` in `ssh-args.ts`, following the
  same family/docblock discipline as the existing builders (calls `assertSafeSshAlias` —
  mandatory, since this module is the sole place an SSH invocation is constructed).

## CLI flow (`host test` / `host add`, both identical here)

1. Probe as today.
2. `ok: true` → unchanged behavior.
3. `failure.kind === 'host-key-changed'` → print `failure.detail` (already contains ssh's
   fingerprint + banner) and `failure.remedy`, exit 1. No approval path exists for this case,
   on any surface.
4. `failure.kind === 'host-key-unknown'` → call `nexusHostKeyFingerprint(alias)` and print:
   ```
   New host key for '<alias>' (<hostname>):
     <keyType> <fingerprint>

   Approve it in Local → Settings → Nexus AI → External Hosts, then re-run this command.
   ```
   Exit 1. No `y/n` prompt, no `--yes`/`--json` bypass — `--yes` continues to mean only what it
   already means for `host add`'s unrelated multi-site confirmation.

## Renderer flow (new, small — `SettingsTab.tsx`)

A new section alongside the existing External Hosts card: an alias text field and a "Check"
button.

1. Check → calls `nexusHostKeyFingerprint(alias)`.
2. `already-trusted` → "This host's key is already trusted."
3. `unknown` → show `<keyType> <fingerprint>` with an **Approve** and a **Dismiss** button.
   Approve → calls the `TRUST_EXTERNAL_HOST_KEY` IPC channel → on success, show "Trusted. Run
   `nexus host add <alias>` to finish registration." Dismiss → clear the state, nothing written.
4. `changed` / `error` → show `detail`/`remedy` as plain text. No approve option.

This UI does not replace or duplicate `host add`'s registration flow (site discovery, slug
picking, environment labeling) — it does exactly one thing, approving a host's identity, and
sends the user back to the CLI to finish.

## Testing

- Unit: `probeExternalHost`'s new classification, using the existing injectable `SshExec` —
  feed exact stderr text captured live (`Host key verification failed.` /
  the `REMOTE HOST IDENTIFICATION HAS CHANGED!` banner) as fixtures.
- Unit: `captureOfferedHostKey`/`trustHostKey` against a fake `SshExec` and a temp directory —
  no real network access in tests.
- Unit: `annotateFailure`'s two new hint branches.
- Unit: `nexusHostKeyFingerprint` resolver — all four status branches.
- Unit: the `TRUST_EXTERNAL_HOST_KEY` IPC handler — capture + append, and that it is registered
  only as an IPC channel (grep-based test asserting it never appears in `schema.ts`'s mutation
  list, so a future refactor can't silently promote it back into GraphQL).
- CLI: `host.ts` tests for the `host-key-unknown` and `host-key-changed` message paths — assert
  neither ever prompts or writes.
- Renderer: `SettingsTab.test.tsx` — the four status branches and the Approve/Dismiss actions.

## Out of scope

- `wp_*` commands and the two content/metadata refresh schedulers gain the improved hint text
  but never auto-trust and have no approval path — deliberately.
- No change to WP Engine's `accept-new` behavior — this only touches the external-host
  builders and the `host add`/`host test`/Settings flow.
