# External SSH Walking Skeleton — Design (Milestone 1)

**Date:** 2026-08-02
**Status:** Approved, not yet implemented
**Depends on:** Spec 0 (`2026-08-02-site-transport-abstraction-design.md`) and
Plan A (`2026-08-02-external-ssh-planA-foundation.md`), both implemented and
both **unmerged** — branch `feat/site-taxonomy-foundation`, which stacks on
`feat/site-transport-abstraction`.
**Carved out of:** Spec 1 (`2026-08-02-external-ssh-hosts-design.md`)

---

## 1. Purpose

Run one real WP-CLI command against one real external SSH host, end to end,
with the smallest possible change.

This exists to answer a single question before more design is written: **does
SSH to an arbitrary host actually work through the `SiteTransport`
abstraction?** Everything in Spec 1 downstream of that — registration, the phar,
fleet integration, the UI — is wasted if the answer is no.

The second reason is empirical. Three times in this series a plan written ahead
of contact with real code encoded a wrong assumption: "~6 direct callers" that
were 44; an `environment` column asserted to exist that did not exist *yet* at
the point the migration ran; a landmine class scoped to SQL that also lived in
TypeScript. A skeleton run against a real host will teach us more about
registration than more upfront design will.

**Success criterion:** `nexus wp core version ssh:<alias>@<environment>` returns
a real WordPress version from a real non-WP-Engine host.

### Explicitly not in scope

No persistence. No `sites` row, no graph.db entry, no fleet views, and
`host='external'` is **never written**. The nine collapsing ternaries and eleven
remaining `'local' | 'wpe'` unions recorded in Spec 1 §9a stay untouched — not
addressing them is what keeps this small. No registration, no `nexus host add`,
no phar upload, no wp-config discovery, no connection-profile storage.

---

## 2. Inherited decisions

From the Spec 1 brainstorm; not reopened here:

- `ssh:<alias>@<environment>` target syntax, mirroring `wpe:account/install@env`
- `~/.ssh/config` aliases as the credential path; no key material stored
- Full `wp_*` parity; platform tools structurally absent
- The environment label drives the existing permission gate

### Decisions specific to this skeleton

- **A new `ssh_target` arg**, not declared in any tool's `inputSchema`.
  `resolveTransport` consumes it before `resolveTarget` ever runs. This keeps
  all 15 wp-cli tools untouched. Plan B promotes it to a declared field so MCP
  clients can discover it; until then only the CLI drives it.
  Rejected: overloading `install_name` with an `ssh:` prefix — that is the same
  one-field-two-meanings conflation that produced the `source != 'local'`
  landmines.
- **Require `wp` on the remote's PATH.** No phar upload. A missing binary fails
  with a clear message. Accepted cost: this does **not** validate Spec 1's
  "always ship our own phar" decision, which remains untested until Milestone 3.
- **`wp_path` is optional.** Absent, we run bare `wp` and let WP-CLI search
  upward from the SSH login directory — the web root on many hosts, so the happy
  path needs no flag at all. Present, we pass `--path=`.

---

## 3. Architecture

### Target parsing

A third branch in `src/common/target.ts`, beside `@local` and `wpe:`:

```
ssh:<alias>@<production|staging|development>
```

`ParsedTarget.type` widens from `'local' | 'wpe'` to include `'external'`, and
gains `alias?: string`. **This is the only union this milestone widens.** The
other eleven listed in Spec 1 §9a belong to Plan B, and leaving them is
deliberate: nothing here writes a persisted site, so nothing reaches them.

Malformed `ssh:` targets throw in the same shape as malformed `wpe:` ones, and
the verbose/terse error split established in Plan A is preserved.

### Arg plumbing

`targetToMcpArgs` (`src/cli/utils/mcp-client.ts`) gains an `ssh:` case,
producing `{ ssh_target: '<full target string>', wp_path?: string }`.

`resolveTransport` (`src/main/transport/resolve.ts`) checks `args.ssh_target`
**first** and returns early. Existing local and WPE resolution is not entered
and therefore cannot regress.

### `ExternalSshTransport`

`kind: 'external-ssh'`. `siteRef: { kind: 'external', alias }` — `SiteRef`
widens to admit it.

**The inverted SSH-config rule, which is the easiest thing to get wrong here.**
`WpeSshTransport` passes `-F /dev/null` to *deliberately ignore* the user's SSH
config, so WPE connections are reproducible regardless of local setup.
`ExternalSshTransport` must do the **opposite**: `ssh <alias> '<command>'`,
inheriting host, user, port, key, `ProxyJump` and agent settings from
`~/.ssh/config`. That inheritance is the entire reason alias-based credentials
were chosen — bastions and jump hosts work with no extra code and no stored
keys. Copying `-F /dev/null` across would silently break every non-trivial SSH
setup and would present as a network problem rather than a code defect. The
golden-argv test asserts the flag is **absent**.

Remote command: `wp [--path=<wpPath>] <escaped args>`, reusing `escapeShellArg`.
`buildExternalSshArgs` sits beside `buildWpeSshArgs` in `ssh-args.ts`, keeping
that module the only place an SSH invocation is constructed — the property Spec
0 Task 12 established and proved by grep.

`deleteRemoteFile` refuses, as `LocalTransport` does: Sentinel's raw-delete path
is WP-Engine-only. `supports()` returns true for every seeded capability — this
is full WP-CLI. `probe()` runs `wp cli version`.

### Policy

A new `EXTERNAL_REMOTE_POLICY`: blocklist only (`eval`, `eval-file`, `shell`,
`db query`, `db cli`), **no whitelist**.

Applying `MCP_REMOTE_POLICY`'s 14-command whitelist would reproduce, on day one,
the five permanently-dead MCP tools documented in Spec 0 §3.4, and would
contradict the full-parity decision. External hosts are therefore more
permissive than WPE-via-MCP. That is deliberate: the whitelist is vestigial, the
user named the host explicitly, and the environment gate still applies.

**Do not unify this with the other two policies.** Spec 0 preserved a real
MCP/GraphQL divergence for the same reason; unification is a separate decision
with its own spec.

### The permission gate applies unchanged

The environment comes from the target. `isOperationAllowed(operation,
environment, settings, 'ssh:<alias>')` runs exactly as for a WPE install, using
Plan A's `remoteSiteExceptions` target-ref keying. With `@production`, reads are
permitted and writes are refused by default — usefully exercising Plan A's gate
against a genuinely new host type. `isGatedHost` is satisfied trivially, since
external is not local.

---

## 4. Files

| Path | Change |
|---|---|
| `src/common/target.ts` | widen `type`, add `alias`, add the `ssh:` branch |
| `src/main/transport/types.ts` | widen `SiteRef` for `{ kind: 'external' }` |
| `src/main/transport/ssh-args.ts` | add `buildExternalSshArgs` |
| `src/main/transport/ExternalSshTransport.ts` | **new** |
| `src/main/transport/policy.ts` | add `EXTERNAL_REMOTE_POLICY` |
| `src/main/transport/resolve.ts` | early `ssh_target` branch |
| `src/cli/utils/mcp-client.ts` | `ssh:` case in `targetToMcpArgs` |
| `src/cli/commands/wp.ts` | `--path` on the two exercised commands |

Eight files. None of the 15 wp-cli tools change.

---

## 5. Errors

Surface ssh's own stderr verbatim rather than paraphrasing it — "Permission
denied (publickey)" and "Could not resolve hostname" are more actionable than
"could not connect", and they are what a user will search for.

- **Alias not in `~/.ssh/config`** — ssh reports it; pass it through with a note
  naming the file.
- **`wp` not found on the remote** — detectable in stderr; add a hint that
  automatic WP-CLI provisioning is not yet implemented, so the user knows it is
  a known gap rather than a bug.
- **WordPress not found at the path** — WP-CLI's own error; add a hint
  suggesting `--path`.

---

## 6. Testing

- **Parser tests** for `ssh:alias@env` across all three environments, plus
  malformed forms, in both verbose and terse error modes.
- **Golden-argv test** pinning the exact invocation, and asserting
  `-F /dev/null` is **absent**. This is the highest-value test here: it is the
  one mistake that would look like a network fault.
- **Conformance suite** — `ExternalSshTransport` must pass the hardened gate
  from Plan A Task 2, supplying both `ok` and `failing` fixtures. This is the
  first real exercise of that gate against a third implementation, and is a
  test of the gate as much as of the transport.
- **Policy test** proving external gets no whitelist: `core update` is permitted
  by `EXTERNAL_REMOTE_POLICY` while `MCP_REMOTE_POLICY` refuses it.
- **Manual verification against a real host** — the actual point of the
  milestone. Nothing here is proven until `nexus wp core version
  ssh:<alias>@<environment>` returns a real version from a real box.

---

## 7. What we learn, and what comes next

If it works: the transport abstraction holds for arbitrary hosts, and Plan B
proceeds to widen the remaining unions, add persistence, and build registration.

If it does not: we have spent eight files finding out, rather than a full plan.

Either way the skeleton should tell us things registration design needs and
cannot currently guess — whether the login directory is usually the web root,
how often `wp` is actually present, what real-world SSH failure output looks
like, and whether `--path` is the common case or the exception.

**This code is a probe, not a foundation.** Plan B is free to replace any of it
— particularly the undeclared `ssh_target` arg, which becomes a proper
`inputSchema` field once MCP clients need it.
