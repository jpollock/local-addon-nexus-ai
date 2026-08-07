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

- **Trust is granted only during an explicit `nexus host add` / `nexus host test`.** A
  scheduled refresh or a `wp_*` command against an alias whose key was never confirmed
  continues to fail — with a better message pointing at `host test`/`host add` — rather than
  silently trusting a key as a side effect of an unattended background job.
- **New/unknown host: show the fingerprint, ask y/n.** Mirrors ssh's own default TOFU prompt.
  Preserves the actual security property TOFU confirmation exists for.
- **`--yes` (host add's existing flag) also covers the host-key prompt.** One flag, one
  meaning ("don't prompt me"); a scripted/CI `host add --yes` auto-trusts the offered key like
  WP Engine's `accept-new`, but the trusted fingerprint is still printed so the run is
  auditable after the fact.
- **A CHANGED host key (previously trusted, key no longer matches) is hard-refused, never
  re-prompted.** Matches ssh's own model: prompting on a changed key invites clicking through
  a real MITM/host-reinstall warning.
- **No MCP tool.** Matches `nexusHostAdd`/`nexusHostProbe` today — this is GraphQL + CLI only.
  An agent must never be the one accepting a host's identity.

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
line. The temp file is discarded either way (confirm or decline); nothing is written to the
real `known_hosts` until the user (or `--yes`) has confirmed.

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
  only — `wp_*` commands and the schedulers never auto-trust).
- `nexusHostProbe(alias, path, autoTrustNewHostKey: Boolean)` — new optional input. When the
  probe fails with `host-key-unknown` and this is `true`, the resolver captures the offered
  key, appends it to the real `known_hosts`, and re-runs the probe once before returning. One
  round trip, whether triggered by `--yes` or by an interactive "yes" the CLI already
  collected.
- New mutation `nexusHostKeyFingerprint(alias: String!): NexusHostKeyFingerprintResult!` —
  capture-only, never writes. `{ success, error, fingerprint, keyType }`. Used solely to show
  the fingerprint before asking.
- New module `src/main/external/hostKeyTrust.ts`: `captureOfferedHostKey(alias, exec)` (the
  temp-file capture + `ssh-keygen -lf` parse) and `trustHostKey(userKnownHostsFile, rawLine)`
  (the append). New builder `buildHostKeyCaptureArgs(alias, tempFilePath)` in `ssh-args.ts`,
  following the same family/docblock discipline as the existing builders (calls
  `assertSafeSshAlias` — mandatory, since this module is the sole place an SSH invocation is
  constructed).

## CLI flow (`host test` / `host add`, both identical here)

1. Probe as today.
2. `ok: true` → unchanged behavior.
3. `failure.kind === 'host-key-changed'` → print `failure.detail` (already contains ssh's
   fingerprint + banner) and `failure.remedy`, exit 1. Never prompts.
4. `failure.kind === 'host-key-unknown'`:
   - `--yes` → call `nexusHostProbe` again with `autoTrustNewHostKey: true`; print the
     fingerprint that was trusted; continue with the resulting report.
   - Interactive → call `nexusHostKeyFingerprint`, show
     `New host key for '<alias>' (<hostname>):\n  <type> <fingerprint>\nTrust and continue? (y/n)`
     via the existing `confirm()` helper; on yes, same `autoTrustNewHostKey: true` call as
     above; on no, print `Cancelled — host key not trusted.` and exit 1.
   - `--json` (non-interactive, no `-y`) behaves like `--yes` for this prompt specifically
     (matches existing `--json` == `quiet` semantics elsewhere in `host add`), and includes the
     trusted fingerprint in the JSON envelope.

## Testing

- Unit: `probeExternalHost`'s new classification, using the existing injectable `SshExec` —
  feed exact stderr text captured live (`Host key verification failed.` /
  the `REMOTE HOST IDENTIFICATION HAS CHANGED!` banner) as fixtures.
- Unit: `captureOfferedHostKey`/`trustHostKey` against a fake `SshExec` and a temp directory —
  no real network access in tests.
- Unit: `annotateFailure`'s two new hint branches.
- Integration-shaped test (still using the fake exec, not a real SSH connection): full
  `nexusHostProbe(..., autoTrustNewHostKey: true)` round trip — unknown-key failure → capture →
  trust → re-probe succeeds.
- CLI: extend `host.ts` tests for the three post-probe branches (`--yes`, interactive
  confirm/decline, `--json`).

## Out of scope

- `wp_*` commands and the two content/metadata refresh schedulers gain the improved hint text
  but never auto-trust — deliberately, per the "explicit action only" decision above.
- No change to WP Engine's `accept-new` behavior — this only touches the external-host
  builders and the `host add`/`host test` flow.
