# External Host Registration — Design (Plan B2)

**Date:** 2026-08-04
**Status:** Approved, not yet implemented
**Parent spec:** `2026-08-02-external-ssh-hosts-design.md` — §6 sketched this flow, §9b amended it. This document supersedes both for registration, and amends §9b again (see §2).
**Depends on:** Spec 0 (transport), Plan A (taxonomy + permissions), the walking skeleton (`ExternalSshTransport`), and Plan B1 (persistence) — all implemented, all unmerged.

---

## 1. Purpose

Let a user register a WordPress site on an SSH-reachable host without knowing its WordPress path in advance, and tell them precisely what is wrong when it does not work.

Today an external host is usable only by hand-typing
`ssh:<alias>@<environment> --path=/absolute/path`, and Plan B1 adds it to the fleet
opportunistically once such a command succeeds. That works — it was verified against a
live Hostinger host — but it requires the user to already know the path, and it gives
them nothing when SSH itself is misconfigured, which is the first thing they actually hit.

**Success criterion:** `nexus host add <alias>` discovers the WordPress path, verifies the
host end to end, and registers it — or refuses with a diagnosis naming the exact next
command to run.

---

## 2. Amendment to Spec 1 §9b — no phar, ever

§9b Amendment 1 changed the WP-CLI strategy from "always ship our own pinned
`wp-cli.phar`" to "detect, then offer to upload". **That was still too far. Nexus will
never write to the user's server.**

Two reasons, one evidential and one diagnostic:

- **The evidence.** The first real third-party host tested had WP-CLI 2.12.0 preinstalled
  and current. Managed WordPress hosting generally ships it. The population with SSH but
  no WP-CLI is mostly bare VPS users, who can run the two-line official install
  themselves.
- **The diagnosis.** The likelier failure is not that `wp` is absent but that it is **not
  on the PATH of a non-interactive shell** — `~/.bashrc` commonly early-returns when there
  is no tty. Uploading a phar would not fix that. It would solve a problem most users do
  not have while creating one they would care about: an unexplained executable on a
  production server, with no uninstall story, that a security review will ask about.

So: detect, search, and instruct. Never upload.

---

## 3. Architecture — one probe, four endings

Every command is the same probe with a different ending. `test` prints the report, `add`
prints it and persists, `list` reads what was persisted, `remove` undoes it. Factoring the
probe first is what makes `test` nearly free.

```ts
probeExternalHost(alias: string, opts?: { wpPath?: string }): Promise<ProbeReport>
```

```ts
interface ProbeReport {
  ok: boolean;
  alias: string;
  resolved: { hostname: string; user: string; port: string };  // from `ssh -G`
  wpCliPath?: string;      // absolute path when found off-PATH; undefined means plain `wp`
  wpCliVersion?: string;
  wpPath?: string;         // discovered or supplied WordPress root
  wpVersion?: string;
  candidates?: string[];   // set when the search found more than one wp-config.php
  failure?: {
    kind: 'alias-not-found' | 'auth-failed' | 'unreachable'
        | 'wp-cli-missing' | 'wordpress-not-found' | 'multiple-wordpress';
    detail: string;        // ssh's own stderr where available, verbatim
    remedy: string;        // the exact next command or action
  };
}
```

### Step 0 — resolve, do not validate

`ssh -G <alias>` prints the config ssh will actually use: `hostname`, `user`, `port`,
`identityfile`. Run it first and keep the result, because the `ssh-copy-id` remedy is
worthless without the real user and port.

**It is not a validity check.** `ssh -G` exits 0 for an alias that appears in no config
file, returning defaults — the literal alias as `hostname`, the local username as `user`,
port 22. It cannot tell a configured alias from a typo.

The obvious repair — parse `~/.ssh/config` and require a matching `Host` block — is worse.
It means implementing `Include`, `Match`, and wildcard semantics correctly, and it would
reject a plain resolvable hostname, which ssh accepts and which is a legitimate thing for a
user to type. So there is no config-membership gate. Connectivity is the first gate, and an
unconfigured alias surfaces there as ssh's own `Could not resolve hostname` — which is both
the accurate diagnosis and the message a user can search for.

### The four gates, in order

Each short-circuits on failure. Order matters: it is cheapest-and-most-likely first, so a
user with broken auth is told about auth rather than about WordPress.

| # | Gate | Failure → remedy |
|---|---|---|
| 1 | `ssh -o BatchMode=yes -o ConnectTimeout=10 <alias> 'echo nexus-ok'` | stderr matches `Could not resolve hostname` → **`alias-not-found`**, naming `~/.ssh/config` and showing the `Host` block to add. stderr matches `Permission denied` → **`auth-failed`**, with the exact `ssh-copy-id -i ~/.ssh/id_ed25519.pub -p <port> <user>@<hostname>` line built from step 0. Anything else → `unreachable`, stderr verbatim |
| 2 | `command -v wp`, then the known locations | `wp-cli-missing` → the official install command |
| 3 | Bounded `wp-config.php` search, skipped when `--path` is given | none → `wordpress-not-found`, re-run with `--path`. Several → `multiple-wordpress`, list them and require `--path` |
| 4 | `wp core version --path=<root>` | `wordpress-not-found` with WP-CLI's own message |

**Gate 1 is the one that matters most.** Password-only SSH is the first thing a real user
hits — Hostinger enables SSH with password auth and keys are opt-in through its control
panel. `BatchMode=yes` makes this fail fast instead of hanging on a password prompt, and
the remedy has to be a line the user can paste.

**Gate 3's search is bounded.** `wp-config.php` under `~`, `~/public_html`,
`~/domains/*/public_html`, `/var/www/html`, `/srv/www`, with a `-maxdepth` limit. It must
never walk an entire filesystem. The `~/domains/*/public_html` entry exists because that is
where Hostinger puts it, and the login directory is `~` — which is exactly why discovery
is mandatory rather than a convenience.

### Gate 2 has a consequence beyond the CLI

If `wp` is found at an absolute path off the PATH, that path must be **stored and used**,
or every later command fails the same way registration would have. So:

- `ExternalSiteProfile` gains `wpCliPath?: string`.
- `buildExternalWpCliCommand(args: string[], wpPath?: string)`
  (`ssh-args.ts:92`) gains a third parameter `wpCliBin?: string`, defaulting to `'wp'`,
  and stops hardcoding the binary. Third, not second — inserting it ahead of `wpPath`
  would silently transpose the argument at the one existing call site.
- `ExternalSshTransport` (`:68`) carries it from its constructor into that call.

**B2 therefore modifies the transport, not only the CLI.** This is the real cost of
dropping the phar, and it is worth paying: it fixes the failure that would actually occur
instead of the one we assumed.

---

## 4. Commands

All four are interactive by default with a flag for every prompt, so the whole flow is one
scriptable line. That matters beyond convenience: this CLI is driven by agents, which
cannot answer prompts. The existing hand-rolled `readline` helpers in
`src/cli/commands/ai.ts:25` (`prompt`) are the pattern to follow — no new dependency.

### `nexus host add <alias> [--path <dir>] [--env <environment>] [--yes]`

Probe, show what was found, confirm, persist. **Refuses to register on any probe failure**
— the same principle B1 chose, so a typo cannot litter the fleet with hosts that were
never reachable.

Persisting means both: `upsertExternalProfile` for the connection details, and a `sites`
row via `upsertSite` with `source` and `host` both `'external'` — the same shape B1's lazy
upsert writes and which was verified live.

**Idempotent.** Re-running merges through the existing profile semantics: `firstSeenAt`
survives, and a run without `--path` does not erase a path already discovered.

Environment defaults to `production`, which is what the permission gate treats as most
restrictive. Writes are therefore refused until the user deliberately labels a host
otherwise — matching WP Engine behaviour.

### `nexus host test <alias> [--path <dir>]`

The identical probe, printed, persisting nothing. Useful when a registered host stops
working, and cheap because the probe is already a unit.

### `nexus host list`

Reads `listExternalProfiles`. Shows alias, WordPress path, environment, and last seen.

Importantly it includes hosts the user never registered — B1's lazy upsert adds a host on
first successful use, so `list` is the only way to see what accumulated that way.

### `nexus host remove <alias> [--yes]`

Two stores, so two deletions:

- **The profile.** `externalSiteStore` currently exports only `getExternalProfile`,
  `listExternalProfiles` and `upsertExternalProfile` — B2 adds `removeExternalProfile`.
- **The `sites` row.** Set `is_active = 0` rather than deleting. That is the existing
  convention: `GraphService` has no per-site delete, only whole-row `upsertSite`
  (`:339`), and its retention sweep already hard-deletes inactive sites and their
  content once they age past the cutoff (`:1035`). Marking inactive therefore reuses a
  path that works, and a re-`add` of the same alias revives the row instead of orphaning
  its history.

`remove` is currently the only way to undo *either* registration path, which is why it
ships in B2 rather than later.

---

## 5. Errors

Surface ssh's own stderr verbatim rather than paraphrasing. "Permission denied
(publickey,password)" is what the user will search for; "could not connect" is not.

Every failure carries a `remedy` that is a command or a concrete action, never advice.
The password-auth case must produce a pasteable `ssh-copy-id` line with the right port and
user, taken from step 0's `ssh -G` output rather than from the alias string.

Nexus does **not** run `ssh-copy-id` itself. Doing so would mean prompting for and handling
the user's password — a materially larger security surface than anything else in this
design, and the reason `promptHidden` exists in `ai.ts` is not a reason to reach for it
here.

---

## 6. Testing

- **Per-gate unit tests** with `spawn` mocked, one per failure branch. The `auth-failed`
  branch matters most: feed it a `ssh -G` fixture with a non-default user and port and
  assert both appear in the `ssh-copy-id` remedy. A test that only checks the string
  contains `ssh-copy-id` would pass on the exact bug Risk 1 names.
- **Step 0 is resolution, not validation** — a test asserting a probe for an unconfigured
  alias reaches gate 1 and fails there as `alias-not-found`, rather than being rejected
  up front. This pins the behaviour that `ssh -G`'s exit code cannot detect.
- **Search tests** for gate 3: none found, one found, several found — including the
  `~/domains/*/public_html` shape, since that is the real-world case that disproved the
  original assumption.
- **Off-PATH WP-CLI**: assert the discovered absolute path reaches the transport and is
  used in the executed command, not silently dropped.
- **Command-level**: `add` persists only on full success; `test` never persists; `remove`
  clears both the profile and the row; `add` twice is idempotent.
- **Manual, against the live Hostinger host** — including deliberately removing the
  authorized key to confirm the auth diagnosis is the one intended. That is the only way to
  know the most important message in this design is correct.

---

## 7. Out of scope

| Item | Reason |
|---|---|
| Uploading WP-CLI | §2 — never write to the user's server |
| Running `ssh-copy-id` for the user | §5 — password handling |
| A UI surface for registration | CLI first; the fleet UI already shows the resulting site |
| Content indexing for external sites | Opt-in per Spec 1; unchanged here |
| `nexus fleet health` showing external sites | It routes to the `nexusFleetHealth` GraphQL resolver, among the ~42 queries B1 left out of scope. Worth fixing, but it is fleet-visibility work rather than registration |
| Retiring `source` | Later spec |

---

## 8. Risks

1. **The auth remedy must be exactly right.** It is the message most users will see first,
   and a wrong port or user makes it useless. It comes from `ssh -G`, not from splitting
   the alias, and it is verified manually.
2. **The transport change reaches beyond registration.** Adding a binary parameter to
   `buildExternalWpCliCommand` touches the module that Spec 0 established as the only
   place an SSH invocation is constructed. The golden-argv tests there are the guard, and
   the WPE builder must remain untouched.
3. **Two paths now create site rows** — explicit registration and B1's lazy upsert. They
   converge on the same store and the same row shape, but `remove` must handle rows from
   either origin.
4. **The bounded search could still be slow** on a host with a large home directory. The
   `-maxdepth` limit is the mitigation; if it proves inadequate, prompting for the path is
   the fallback, not an unbounded search.
