# External SSH Hosts — Design (Spec 1)

**Date:** 2026-08-02
**Status:** Approved, not yet implemented
**Depends on:** Spec 0 — Site Transport Abstraction
(`2026-08-02-site-transport-abstraction-design.md`), implemented on
`feat/site-transport-abstraction` (unmerged at time of writing)
**Sequence:** Spec 1 of the transport series. Spec 2 adds a REST transport.

---

## 1. Goal

Let Nexus manage a WordPress site on any SSH-reachable host — a VPS, a
DigitalOcean droplet, a cPanel box — not only Local sites and WP Engine
installs. This is the question that started the series: *"If I have SSH into
another host, would it work there as well?"* Today it does not: every remote
path was hardcoded to WP Engine's SSH gateway. Spec 0 removed that hardcoding.
Spec 1 uses the seam.

### Decisions inherited from Spec 0's brainstorm

These were settled during the Spec 0 design conversation and are not reopened:

- **Universal fleet manager**, not a migration on-ramp. External sites are
  permanent residents, not visitors.
- **Full `wp_*` parity** over SSH. Platform tools (`wpe_*`, `local_*`) are
  structurally absent, not unimplemented.
- **Reuse `~/.ssh/config` aliases** as the primary credential path; an explicit
  host/port/user/key form is the fallback. No key material is ever stored.
- **Always ship a pinned `wp-cli.phar`** rather than trusting whatever the host
  has, so behaviour does not vary with the remote's WP-CLI version.
- **Environment captured at registration**, defaulting to production.

### Scope

Design the **full taxonomy**; implement only the **WordPress slice**. `platform`
is stored but only ever written as `'wordpress'`; no Laravel/Ghost/Drupal code
exists. The shape can grow without a rewrite, and no speculative abstraction
ships.

---

## 2. The landmine that shapes this spec

`sites.source` is added by migration as `TEXT DEFAULT "local"`
(`GraphService.ts:191`) and the codebase treats it as a closed two-value union.
**52 queries filter on it. Eleven of those, across six files, use
`source != 'local'` as a synonym for "is a WP Engine install":**

- `mcp/modules/fleet/fleet-summary.ts:36,41`
- `mcp/modules/fleet/find-sites-with-plugin.ts:75,95`
- `mcp/modules/fleet/find-sites-with-theme.ts:80,98`
- `mcp/modules/fleet-intelligence/fleet-plugins.ts:88`
- `ipc-handlers.ts:465,1833`
- `assistant/AssistantService.ts:23`

Adding any third source value silently reclassifies external sites as WP Engine
installs. Nothing throws. Fleet summaries, plugin and theme audits, and — worst
— `AssistantService.ts:23`, which decides *whether the user is a WP Engine
customer at all* and therefore how the assistant frames every fleet answer,
would all be quietly wrong.

**Task 0 fixes all eleven to explicit `= 'wpe'`, verified, before any code can
write `host='external'`.** This is a blocking prerequisite, not cleanup.

This was found by grepping, not by reasoning about which surfaces "should" be
affected. Spec 0 was twice wrong in exactly that way — see its §9.

---

## 3. Data model

### Stored on `sites` (three additive columns)

| Column | Values | Purpose |
|---|---|---|
| `platform` | `'wordpress'` (only value written) | What software runs. Gates which tool vocabulary applies. |
| `host` | `'local'` \| `'wpe'` \| `'external'` | Who operates the infrastructure. Spec 0's **axis-2 key**: decides which platform tools exist. |
| `environment` | `'development'` \| `'staging'` \| `'production'` | Feeds the existing gate unchanged. |

### Derived, never stored

Storing any of these invites the drift this spec exists to remove.

- **`location`** (`local` \| `remote`) — from transport kind.
- **`capabilities`** — transport decides WordPress ops, host decides platform ops.
- **`transport`** — resolved per call from `host` plus the connection profile.

### Designed, not implemented

The **site ↔ instance** hierarchy. WPE already models site→installs, and a
Local↔WPE link is the same shape. An external host is a single instance, so
Spec 1 gains nothing. A later spec can adopt it.

### Backfill

- `source='local'` → `host='local'`, `environment='development'`
- `source='wpe'` → `host='wpe'`, environment from `WPE_INSTALL_CACHE`,
  defaulting to `'production'` (the gate's existing safe default)
- `platform='wordpress'` for every row

`source` is retained, still written, and gains `'external'`. It is now redundant
with `host` — accepted, documented debt. Retiring it means migrating 52 filters,
which would double this spec. A follow-up can do it.

### Local sites always get `environment='development'`

Not inherited from a linked WPE install. Three reasons:

1. The mirrored environment is **already stored** — `hostConnections[].remoteSiteEnv`,
   read by `resolveWpeInstall` (`local-services-bridge.ts:838`). Inheriting
   duplicates an existing fact into a third location that can drift.
2. Inheriting makes the column mean "risk class" for remote sites and "what I
   mirror" for local ones — a different question depending on host and link state.
3. `normaliseEnv` maps anything unrecognised to `'production'`. A link missing
   `remoteSiteEnv` would silently lock a local site to the most restrictive
   setting, with no error.

`'development'` is also the benign value if anyone ever wires local sites into a
gate by accident.

---

## 4. The scoping guarantee

**The permission gate applies when `host ∈ {wpe, external}` and never when
`host='local'`.** Explicit, and covered by a test that fails if local sites are
routed through `isOperationAllowed`.

This is what actually satisfies the motivating requirement: *lock down writes on
WP Engine development installs without losing the ability to work locally.* The
environment label does not deliver it. If a user sets
`wpcli: { development: false }`, a local site labelled `'development'` is equally
blocked — whether that label was a default or inherited. Only host scoping helps.

The existing settings are already WPE-scoped by name, and their exceptions key on
`installName`, which a local site does not have. Applying them to local sites is
a category error regardless of the label.

### Settings rename

External hosts need the same per-environment control, but the settings are
WPE-named and key on something external hosts lack.

- `wpeOperationPermissions` → `remoteOperationPermissions`
- `wpeSiteExceptions` → `remoteSiteExceptions`, keyed on a **target ref** —
  `wpe:<installName>` or `ssh:<alias>` — instead of a bare `installName`

`migrateFromLegacyEnvFilter` in `operation-permissions.ts` is the precedent for
performing this migration without losing user configuration.

---

## 5. Transport and connection

`ExternalSshTransport implements SiteTransport`, `kind: 'external-ssh'` — the
third implementation, admitted only after the conformance suite is hardened (§8).

### The inverted SSH-config rule

`WpeSshTransport` passes `-F /dev/null` to **deliberately ignore** the user's SSH
config, so WPE connections are reproducible regardless of local setup.
`ExternalSshTransport` must do the **opposite**: invoke `ssh <alias> '<cmd>'` and
let `~/.ssh/config` supply host, user, key, port, `ProxyJump`, and agent
settings.

That inheritance is the whole reason alias-based credentials were chosen —
bastions and jump hosts work with no extra code, and no key material is stored.
Copying `-F /dev/null` into the external transport would silently break every
non-trivial SSH setup, and is the single easiest mistake to make here.

### Connection profile

RegistryStorage, following the `IW_SITE_BINDINGS` precedent
(`common/constants.ts:306`):

```ts
{
  alias: string;              // ~/.ssh/config Host entry — the credential path
  wpPath: string;             // discovered at registration; passed as --path=
  environment: 'development' | 'staging' | 'production';
  phar: { path: string; version: string; uploadedAt: number };
  indexContent: boolean;      // opt-in, default false
}
```

No key material, ever. The explicit-form fallback stores a key *path*, never
contents.

### Invocation

`php <phar.path> --path=<wpPath> <escaped args>`, reusing `escapeShellArg`. A new
`buildExternalSshArgs` sits beside `buildWpeSshArgs` in `ssh-args.ts`, so that
module remains the **only** place constructing an SSH invocation — the property
Spec 0's Task 12 established and proved by grep.

---

## 6. Registration

`nexus host add <alias>` — probe and confirm:

1. **Resolve the alias** in `~/.ssh/config`; if absent, offer the explicit form.
2. **Connect** (`ssh <alias> 'echo ok'`), failing fast and surfacing ssh's own
   stderr verbatim — "Permission denied (publickey)" beats a paraphrase.
3. **Locate WordPress** — bounded `wp-config.php` search across `~`,
   `~/public_html`, `/var/www/html`, `/srv/www`, with `-maxdepth` so we never
   walk a whole filesystem. Multiple hits → ask which. None → prompt for a path.
4. **Read** WP and PHP versions from that root.
5. **Check for an existing `wp`** — informational only; we ship our own.
6. **Ask consent, then upload** the pinned phar to `~/.nexus/`. This writes to
   someone's server, so it is an explicit yes/no, never a side effect.
7. **Confirm the environment label**, defaulting to `production`.
8. **Summarise, confirm, persist** — profile to RegistryStorage, row to `sites`.

Two failure modes to design for rather than discover: **`php` missing** on the
remote is a hard stop (the phar needs it), and **`~/.nexus/` not writable** —
common on locked-down shared hosting — must offer an alternate path rather than
failing outright.

---

## 7. Capability boundary and command policy

`host='external'` has **no platform provider**: every `wpe_*` and `local_*` tool
is structurally absent. All `wp_*` tools work through the transport.

### External hosts get a blocklist-only policy

`resolveTransport` currently wraps remote transports in `MCP_REMOTE_POLICY`,
whose 14-command whitelist is precisely what makes five MCP tools permanently
dead on WPE (Spec 0 §3.4). Applying it to external hosts would contradict the
full-parity decision and reproduce those five dead tools on day one.

External hosts therefore get **`EXTERNAL_REMOTE_POLICY`** — blocklist only
(`eval`, `eval-file`, `shell`, `db query`, `db cli`), no whitelist.

This makes external hosts more permissive than WPE-via-MCP. That is deliberate:
the whitelist is vestigial, the user explicitly registered and labelled the host,
and the environment gate still applies. Registration defaults to `production`, so
write operations are refused until the user deliberately labels a host
development/staging or adds an exception.

**Do not "unify" this with `MCP_REMOTE_POLICY`.** Spec 0 preserved a real
MCP/GraphQL policy divergence for the same reason: unification is a separate,
explicit decision with its own spec.

---

## 8. Testing

**Task 1 hardens the conformance suite** before it admits a third transport. Two
Spec 0 reviewers independently judged it too loose to be the gate this series
designates it: an implementation passes today if `runWpCli` returns
`{success:true, stdout:<anything>}` and `probe()` returns `{reachable:true}`.
Untested: failure paths, timeout propagation, spawn error, multi-call state,
`supports()` honesty. Doing this first — informed by what a real third transport
needs to prove — is why it is Task 1 and not an afterthought.

Also required:

- **Golden-argv test** for external SSH construction, mirroring the one that made
  Spec 0 provable. It must assert that `-F /dev/null` is **absent**.
- **Table-driven dispatch** extended to an external target.
- **Scoping-guarantee test** asserting local sites never reach
  `isOperationAllowed`.
- **Landmine regression test** that greps the source for `source != 'local'` and
  fails if it reappears. Unusual, but the pattern is invisible to type checking
  and silently corrupts fleet intelligence; a lint-shaped test is the only thing
  that catches its return.

Manual verification will be required for the same reason it was in Spec 0: no CI
coverage exists for real SSH. At minimum, register a real non-WPE host, run
`wp core version` and `wp plugin list` against it, and confirm a `wpe_*` tool is
absent rather than failing.

---

## 9. Out of scope

| Item | Reason |
|---|---|
| REST transport | Spec 2 |
| Non-WordPress platforms | `platform` is stored but only `'wordpress'` is written |
| Site ↔ instance hierarchy | Designed in §3; no Spec 1 need |
| Retiring `source` | 52 filters; would double this spec |
| Unifying `MCP_REMOTE_POLICY` with the external policy | Separate explicit decision (§7) |
| Fixing the five dead WPE MCP tools | Policy-unification spec |
| Content indexing on by default | Opt-in per host; pulling every post over SSH and embedding it is a real cost the user should choose |

---

## 9a. Plan A outcome — the landmine class is wider than §2 said

Plan A shipped (branch `feat/site-taxonomy-foundation`, 8 commits on top of
Spec 0). It fixed the eleven SQL queries, hardened the conformance suite, added
`platform`/`host` with backfill, renamed the permission settings, and made the
local exemption explicit.

**But §2 scoped the landmine hunt to SQL, and that was too narrow.** The final
whole-branch review found the same bug class in TypeScript, which the
source-scanning test does not look for:

- **Nine collapsing ternaries** of the form
  `source: row.source === 'local' ? 'local' : 'wpe'` —
  `AssistantService.ts:180,227,250,292`; `metadataSearch.ts:169,192,222,270,291`.
  Each relabels an external site as WP Engine. They exist because the target
  type is the closed union, so they cannot be fixed by renaming alone.
- **Closed `'local' | 'wpe'` unions** at `types.ts:432,497`, `schemas.ts:453`,
  `target.ts:13`, `GraphService.ts:461`, plus `cli/commands/system.ts:19`.

**Consequence: the branch is NOT yet able to admit `host='external'`, and that
is correct — widening the union is Plan B's first job, not Plan A's.** Plan B
must widen the union *before* anything writes the new value, and extend the
scanner in `tests/unit/graph/source-semantics.test.ts` to cover the ternary
form as well as the SQL form.

Two further items Plan A left for Plan B:

- `upsertSite` now writes `platform`/`host` (fixed in the Plan A fix wave), but
  nothing writes `'external'` yet.
- `remoteOperationPermissions` / `remoteSiteExceptions` persist and take read
  precedence, but no UI or `nexus settings reset` manages them. Plan B ships
  that surface. Until then a value set via CLI or MCP shadows the Preferences
  UI. The sharpest edge — an empty array suppressing all exceptions — was fixed.

## 10. Risks

1. **The eleven landmine queries.** Highest severity: silent, type-invisible, and
   corrupts the assistant's model of whether the user is a WPE customer.
   Mitigated by Task 0 plus the lint-shaped regression test.
2. **Copying `-F /dev/null` into the external transport.** Would break every
   bastion, jump host, and agent-based setup, and would look like a network
   problem rather than a code defect. Mitigated by an explicit golden-argv
   assertion that the flag is absent.
3. **Settings migration.** Renaming `wpeOperationPermissions` risks silently
   dropping a user's configured permissions. Needs the same care as
   `migrateFromLegacyEnvFilter`, and a test that a pre-rename config survives.
4. **Writing the phar to someone's server.** Mitigated by explicit consent at
   registration and a documented uninstall path.
5. **Spec 0 is unmerged.** This branches from `feat/site-transport-abstraction`,
   which has passed review and live verification but has not landed on `main`.
   If Spec 0 changes during merge, Spec 1 must rebase.
