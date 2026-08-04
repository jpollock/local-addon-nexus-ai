# WP Surface Unification — Design (Spec 3)

**Date:** 2026-08-04
**Status:** Approved in conversation, not yet implemented
**Branch:** `feat/non-wpe-host-support`
**Supersedes:** the framing in Spec 1 §1 of "full `wp_*` parity" as a feature-count goal.

**Evidence base — read at least the first before implementing:**
- `docs/wp-cli-surface-matrix.md` — every `wp` command and tool, how each is serviced, what limits apply
- `docs/cli-mcp-equivalence-inventory.md` — why this is a structural problem, not a feature gap

---

## 1. Goal

Make the `wp` surface **one implementation** reached by two front doors, so that CLI
and MCP are equivalent by construction rather than by audit.

External SSH host support is the consequence, not the objective. Today 3 of 22 `wp`
commands reach an external host; after this, all of them do — but that falls out of
the unification rather than being plumbed in separately.

### Why not a feature-parity pass

The obvious alternative is to enumerate what each surface can do and close the gaps.
The inventory says why that fails: ~6 of 133 GraphQL resolvers share an implementation
with the MCP tool doing the same job. A parity list would be correct the day it was
written and would start drifting immediately, because nothing structural stops the
next resolver being written twice.

Every defect found on this surface has the same shape — the second implementation
didn't get the update:

| Defect | Evidence |
|---|---|
| Policy drift | MCP applies a 14-command whitelist, GraphQL a 4-item blocklist. Five MCP tools are permanently dead on WP Engine. A human at the CLI can do things an agent cannot, on the same install. |
| Capability drift | `resolveTransport` learned about external hosts; `nexusWpCommand` did not. |
| Gate drift | `nexusWpCommand` re-implements the permission gate inline at two call sites with hand-derived arguments. |
| Silent failure | An `ssh:` target through `nexusWpCommand` dies with `Cannot read properties of undefined (reading 'split')`. |

### Success criteria

1. Every `wp` CLI command and its MCP counterpart reach the same targets under the
   same rules.
2. All 22 `wp` CLI commands work against an external SSH host, except where a
   command is meaningless there.
3. `nexusWpCommand` contains no target resolution, no policy list and no permission
   gate of its own.
4. No capability regression on Local or WP Engine. This is the constraint that
   shapes §2.

---

## 2. One remote command policy

**Decision: unify on blocklist-only. Delete the whitelist.**

`MCP_REMOTE_POLICY` and `GRAPHQL_REMOTE_POLICY` collapse into a single `REMOTE_POLICY`:
blocked = `eval`, `eval-file`, `shell`, `db query`, `db cli`. No whitelist.
`EXTERNAL_REMOTE_POLICY` becomes the same object — it already carries exactly these
five.

### Why this direction and not the other

Unifying *upward* onto MCP's whitelist was measured, not guessed: every argv the CLI
sends was scored against it, and **8 of the 17** `nexusWpCommand` commands would break
on WP Engine — `theme activate`, `core update`, `db export`, `db import`,
`search-replace`, `post create`, `post update`, `post delete`. That is a capability
regression for existing users, which success criterion 4 forbids.

### Why the loosening is bounded

Removing a whitelist sounds like it opens the door to arbitrary destructive commands.
It does not, and the reason is structural: **no MCP tool takes an arbitrary command
array.** Every tool emits a fixed command shape, and the one free-form tool
(`wp_eval`) is in the blocklist. So the change grants agents exactly five tools —
`core update`, `theme activate`, `post create`, `post update`, `post delete` — and
nothing else. Those are capabilities a human at the CLI already has today.

The CLI gains nothing and loses `db cli`, which is absent from its inline blocklist
today and would hang an SSH session anyway.

`MCP_REMOTE_POLICY` has exactly one consumer (`transport/resolve.ts:87`).
`GRAPHQL_REMOTE_POLICY` has none and is deleted.

### What still protects production

The permission gate, unchanged, and already identical for WPE and external:

| operation | development | staging | production |
|---|---|---|---|
| `wpcli_read` | yes | yes | yes |
| `wpcli` | yes | yes | **no** |
| `push` | yes | yes | **no** |
| `delete` | **no** | **no** | **no** |

Note for anyone auditing this: `wpeAllowedEnvironments` is **not** a protection.
`mcp/utils/environment-filter.ts` has zero callers outside its own tests — it was
superseded by the table above and never deleted. Do not cite it.

---

## 3. `nexusWpCommand` migrates onto `resolveTransport`

The resolver keeps its GraphQL signature — `nexusWpCommand(target: String!, command:
[String!]!)` — and loses its body. It becomes: map the target string to transport
args, resolve, run.

### The mapper is the actual work

`resolveTransport` consumes an **args object** (`args.site`, `args.install_name`,
`args.ssh_target`); `nexusWpCommand` receives a **target string**. Bridging them is a
new, small, testable unit:

```
resolveTargetArgs(target: string, services): Record<string, unknown>
  'ssh:<alias>@<env>'   → { ssh_target: target }
  'wpe:<acct>/<inst>@e' → { install_name: parsed.installName }
  '<name>@local'        → { site: parsed.siteName }
  '<bare name>'         → { site: name }, falling back to
                          { install_name: <wpe row> } when the name is not a
                          Local site but is an active WPE install in the graph DB
```

**The bare-name fallback is the migration's one genuine hazard.**
`nexusWpCommand` currently implements it inline (`resolvers.ts:1666-1699`): if a plain
name is not a Local site, it queries the graph DB for an active WPE install of that
name and switches to the remote path. `resolveTarget` does **not** do this — it keys
off which argument was supplied. Lose the fallback and `nexus wp core version
my-wpe-install` silently stops working. It must move into the mapper and be tested
directly.

The operation comes from `classifyWpCliOp(command)`, which already exists at
`resolvers.ts:53`, keys on the first two argv tokens, and fails closed to `wpcli`. It
moves to the transport layer beside the policy so both surfaces share it.

### What gets deleted

- the `parsed.type === 'local'` / WPE branches
- `blockedRemoteCommands` and its three use sites
- both inline `isOperationAllowed` calls and their hand-derived environment lookups
- the inline `isSSHKeyAvailable` checks — `resolveTarget` already does this

### What must survive

The local branch also checks site status before running (`getSiteStatus`) and returns
a specific error when a site is stopped. `LocalTransport` does not do this. Either the
check moves into the mapper or `LocalTransport` gains it; a stopped Local site must
not degrade into a raw WP-CLI failure.

---

## 4. Declare `ssh_target` and `wp_path` on the transport-backed tools

15 tools use `resolveTransport` and therefore already work against external hosts —
`resolveTransport` reads `args.ssh_target` before anything else, and `McpServer.ts:303`
passes `params.arguments` through with no schema validation and no stripping of
unknown keys.

So the capability exists and only discovery is missing: an agent that already knows
the parameter name can drive those tools today, but cannot learn it from the schema.

Adding `ssh_target` and `wp_path` to those 15 `inputSchema` blocks is mechanical and
unlocks all of them. This is the whole agent story for external hosts.

---

## 5. Port the four local-only tools

`wp_db_export`, `wp_import_database`, `wp_search_replace` and `wp_site_health` call
`resolveSite` rather than `resolveTransport`, so they are Local-only. Their CLI
counterparts reach WP Engine through `nexusWpCommand`'s arbitrary argv, and after §3
would reach external hosts too — leaving the CLI able to do four things an agent
cannot. That is the asymmetry this spec exists to remove, so they are in scope.

Two are more than a target swap:

- **`wp_site_health`** is the reason `nexus wp health ssh:<alias>@production` fails
  today with `Site "undefined" not found.` It composes several WP-CLI calls; porting
  it is mostly mechanical.
- **`wp_db_export` and `wp_import_database`** move files. Over SSH that means deciding
  where the dump lands and how it is transferred. **If that proves larger than a
  target swap, split it into its own task and say so** — do not smuggle a file-transfer
  design into this spec.
- **`wp_search_replace`** is argv-shaped and should port cleanly. It is also the most
  valuable of the four on a remote host, since it is how a domain migration is done.

---

## 6. Out of scope

| Item | Reason |
|---|---|
| Converting the other ~127 duplicate resolvers | Overwhelmingly local-only operations where drift is cosmetic. All eight safety-relevant duplication sites are in this slice. Convert the rest opportunistically. |
| Fleet visibility for external sites | 6 MCP modules and 11 resolver queries still filter `source='wpe'`. Real, independent, mechanical — its own slice, finishing Plan B1. |
| `content` and `ai` commands against external hosts | Product decisions, not debt. Spec 1 deferred content indexing deliberately on cost grounds. |
| `sites` and `wpe` commands against external hosts | Structurally absent by design — Local lifecycle and WPE platform respectively. You cannot start someone else's VPS. |
| Moving CLI commands onto the MCP path | Unnecessary once §3 lands: both routes reach the same implementation, so the remaining difference is latency and output format, not capability. |
| `db scan` / `clean` / `report` | The db-scanner is local-only by its own design. |

---

## 7. Testing

**The regression matrix is the load-bearing test.** Every argv shape the CLI sends,
against every target type, asserting the same allow/refuse outcome before and after.
The eight commands that MCP's whitelist would have broken on WP Engine are the ones
that must be proven still working.

Beyond that:

- **Mapper unit tests**, one per branch, with the **bare-name → WPE fallback** as the
  case that matters most. A test must fail if that fallback is dropped.
- **Equivalence tests** — for each of the 19 tools, assert the CLI route and the MCP
  route produce the same allow/refuse decision for the same target and command. This
  is the test that makes success criterion 1 mean something, and it is the one that
  will catch the next drift.
- **The five resurrected tools** — assert `core update`, `theme activate`,
  `post create/update/delete` now succeed against WP Engine where they previously
  returned a policy refusal.
- **Stopped Local site** — assert the specific error survives the migration rather
  than degrading into a raw WP-CLI failure.
- **Live verification against the Hostinger host**, as B2 did. A `wp` command that
  previously failed with a TypeError — `nexus wp option-get ssh:<alias>@production
  siteurl` is the one already observed — must return a real value.

---

## 8. Risks

1. **The bare-name WPE fallback.** Silent, and it breaks a path users rely on
   (`nexus wp core version my-install` with no prefix). Mitigated by moving it into
   the mapper with its own test; §3 names it as the hazard.
2. **The stopped-site status check.** Same shape, smaller blast radius.
3. **Unifying the policy is a real loosening for agents**, even though bounded to five
   tools by the absence of an arbitrary-argv tool. If a future MCP tool ever accepts a
   free-form command array, that reasoning dies and the whitelist question reopens.
   Worth a comment on `REMOTE_POLICY` saying so.
4. **`resolvers.ts` is 5,650 lines.** This change deletes from it rather than adding,
   but the file is already flagged as weight-bearing debt and the in-progress
   `resolvers/` split remains unreferenced.
5. **Scope creep via §5.** The database file-movers are the likely place. The spec
   says to split rather than absorb.
