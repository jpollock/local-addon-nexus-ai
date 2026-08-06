# External Host Connection/Site Model — Design

**Date:** 2026-08-06
**Status:** Draft for review
**Depends on:** Spec 0 (`SiteTransport`), Spec 1 (external SSH registration), the fleet-visibility
plan, Spec 4a/4b (external metadata/content refresh)
**Blocks:** Spec 2b (`external-rest` channel) — its design assumes one profile = one site

> **Verification.** Every file:line citation below was read from source on 2026-08-06. The
> multi-root failure at `probeExternalHost.ts:198-209` was reproduced live against the
> registered alias `hostinger-test`, which really does have two WordPress installs. The security
> gate at `resolve.ts:40-65` was traced end to end, not assumed. `account_id`'s existing shape
> (`GraphService.ts:55,219-226,343,369`) was confirmed generic and unused by any external
> write today — this design's storage section adds nothing new, it starts writing a column that
> already exists and is already indexed.

---

## 1. Problem

`ssh:<alias>` is modeled as one site: `externalSiteId(alias) = "ssh:${alias}"`
(`externalSiteStore.ts:27-29`), one graph row per alias, one entry in the alias-keyed connection
profile map. This is wrong the moment an alias reaches more than one WordPress install, which is
not a hypothetical:

```
$ nexus host test hostinger-test
✗ hostinger-test: multiple-wordpress
  Found 2 WordPress installations:
    /home/u923874259/domains/palegreen-capybara-114180.hostingersite.com/public_html
    /home/u923874259/domains/mediumslateblue-hyena-983322.hostingersite.com/public_html
```

Today `nexus host add hostinger-test` can register exactly one of these two real sites. The other
is invisible to every fleet surface — not counted, not scoreable, not searchable — for no reason
other than the id scheme has nowhere to put it.

The correct shape already exists in this codebase for WP Engine: `wpe:<account>/<install>@
<environment>` separates the account (the connection: CAPI credentials, one WP Engine login) from
the install (the site: one WordPress instance under it). `ssh:<alias>` needs the same split:
**the alias is a connection, not a site.**

## 2. Scope

**In:** the id scheme, storage split, target grammar, registration flow, removal semantics, and
every existing consumer whose behavior depends on the old one-alias-one-site assumption.

**Out**, named explicitly so they don't creep in:
- The host-key trust-on-first-use gap (a first-time connection to an unknown host fails with
  "Host key verification failed" and no guidance) — a real, separately-discovered UX gap, not a
  data-model problem.
- The probe's fixed `SEARCH_ROOTS` failing to find WordPress on hosts whose layout doesn't match
  (confirmed against a real SiteGround connection) — a discovery-heuristic problem, not this one.
- The `external-rest` channel itself (Spec 2b) — this design only removes the blocker.
- A command-template mechanism for hosts whose WP-CLI needs a wrapper invocation (`gp wp`,
  `terminus remote:wp <site> -- `) rather than a binary substitution — a transport-layer gap,
  independent of how many sites a connection has.

## 3. The corrected model

| Concept | Identity | Holds |
|---|---|---|
| **Connection** | `~/.ssh/config` alias | Reachability, discovered shell details (`wpCliPath`), how many sites are registered under it |
| **Site** | one discovered WordPress install | Domain, environment, per-site `wpPath`, all L1/L2/L3 data — everything a graph `sites` row already carries |

**Target syntax:**

```
ssh:<alias>/<site>@<environment>      # canonical — always valid
ssh:<alias>@<environment>             # shorthand — valid only when the connection has exactly one site
```

Mirrors `wpe:<account>/<install>@<environment>` deliberately — same shape, same reason: an
addressable connection can have more than one addressable thing under it.

**The shorthand is an input convenience, never an output.** `nexus_list_sites`, `sites list`,
`host list`, and every error message print the full `/<site>` form. A human at a terminal or an
agent that already knows there's exactly one site can use the short form; nothing that has been
printed or scripted breaks the day a second site is added, because nothing durable was ever
printed short.

## 4. Storage — no new tables

**Connection** stays in `externalSiteStore.ts`'s existing registryStorage map
(`STORAGE_KEYS.EXTERNAL_SITE_PROFILES`, keyed by alias), trimmed to connection-scoped fields:

```ts
export interface ExternalConnectionProfile {
  alias: string;
  /** Absolute path to WP-CLI, shared by every site under this connection unless a site overrides it. */
  wpCliPath?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}
```

`wpPath` and `environment` are removed from this type — both move to the site.

**Site** is a graph `sites` row exactly as today, with two changes:

- `id = ssh:<alias>/<site>` (was `ssh:<alias>`)
- **`account_id` is set to the alias.** This column already exists, is already `TEXT` with no
  foreign-key typing, is already indexed (`idx_sites_account`, `GraphService.ts:224`), and already
  means exactly this concept for WP Engine rows — "the parent group this site belongs to." Zero
  migration. "List every site under connection X" and "remove every site under connection X"
  (§7) become `WHERE account_id = ?` — an indexed equality lookup, not a string-prefix match on
  the id.

A site may carry its own `wpCliPath`, overriding the connection's. Confirmed worth keeping: the
27-host survey (`/tmp/ssh-matrix.tsv`) documents PHP-version switching as a per-domain SPanel
setting on ScalaHosting, so a WP-CLI invocation difference between two sites on one login is a
real, sourced case, not speculative.

## 5. Registration flow

**The probe needs no change.** `probeExternalHost.ts:198-209` already returns every discovered
root as `candidates` when it finds more than one — the *data* already flows back, only the CLI
currently treats it as a terminal failure instead of using it.

`nexus host add <alias>`:

1. Probe as today. Zero or one root: unchanged behavior (fail with the existing guidance, or
   proceed with that one path).
2. More than one root: for **each** candidate path, run the existing single-path probe again
   (`probeExternalHost(alias, { wpPath: candidatePath })` — the same function, no new logic) to
   get its domain and WP version, then present a checklist:
   ```
   Found 2 WordPress installations on 'hostinger-test':
     [x] mediumslateblue-hyena-983322.hostingersite.com   → site name: mediumslateblue-hyena
     [ ] palegreen-capybara-114180.hostingersite.com      → site name: palegreen-capybara
   Environment for each selected site [production]:
   ```
   The suggested site name is the first label of the discovered domain, editable inline. `-y`
   registers everything found with the suggested names and default environment, matching the
   existing `-y, --yes` convention (`host.ts:165`) — non-interactive automation keeps working.
3. Selecting nothing is valid. A connection with zero sites is the correct end state for a host
   with no SSH-reachable WordPress at all (Pantheon, per the 27-host survey — no shell exists, so
   there is nothing to register until Spec 2b's REST channel can add a site here directly).
4. Re-running `host add <alias>` on an already-registered connection re-probes and offers only
   **newly** discovered roots; sites already registered are left untouched.

## 6. Target parsing

`src/common/target.ts`'s `ssh:` branch gains an optional `/<site>` segment:

```ts
const sshMatch = target.match(/^ssh:([^/@]+)(?:\/([^@]+))?@(production|staging|development)$/);
if (sshMatch) {
  return {
    type: 'external',
    original: target,
    alias: sshMatch[1],
    site: sshMatch[2],           // undefined ⇒ bare shorthand
    environment: sshMatch[3],
  };
}
```

`ParsedTarget.site?: string` is additive — every existing WPE/local branch is untouched.

## 7. `resolveTransport` — the security-critical rework

This is the piece that must be gotten exactly right, because it is where a permission gate lives
today. Read `resolve.ts:23-77` in full before touching it.

**Today:** look up the connection profile by alias, compute `gatedEnv = mostRestrictiveOf(
target-string environment, profile.environment)`, gate on that, *then* build the transport. The
existing comment is explicit about why the lookup happens before the gate: *"a host registered
`--env production` stayed writable when addressed as `ssh:<alias>@development`"* was the bug this
ordering fixed. That property must survive unchanged.

**After this change**, `environment` is per-site, so the comparison must be against the
**resolved site's** registered environment, not the connection's. Resolution therefore has to
happen before the gate, in the same position the profile lookup occupies today:

1. Parse the target → `{alias, site?, environment}`.
2. Look up the connection profile by alias (unchanged — still gives `wpCliPath`).
3. **Resolve the site**, from the graph (`sites WHERE account_id = ? AND source = 'external' AND
   is_active = 1`, plus `AND name = ?` when `site` was given):
   - `site` given, found → that row.
   - `site` given, not found → `error('No site "<site>" registered on connection "<alias>".')`.
   - `site` omitted, exactly one active row → that row (the shorthand).
   - `site` omitted, zero rows → `error('Connection "<alias>" has no registered sites. Run
     nexus host add <alias>.')`.
   - `site` omitted, more than one row → the established disambiguation pattern: name every site,
     tell the caller to add `/<site>`.
4. `gatedEnv = mostRestrictiveOf(parsed.environment, resolvedSite.environment)`. Gate as today.
5. `wpPath = explicit wp_path arg ?? resolvedSite.wpPath`. `wpCliPath = resolvedSite.wpCliPath ??
   connectionProfile.wpCliPath`.
6. Build `ExternalSshTransport(alias, wpPath, wpCliPath)` — unchanged.

Step 3 needs `services.graphService`, which `resolveTransport`'s external branch does not
currently read (only `registryStorage`). This is not a new pattern in the codebase — `resolveAnySite`
and `resolveWpeGraphSite` already do inline `db.prepare(...)` site lookups — it is new *to this
function*.

## 8. The lazy "sighting" upsert changes behavior — call this out explicitly

`tool-registry.ts:20-75` (`maybeUpsertExternalSite`) currently **unconditionally creates a site
row** for any alias a successful command happened to touch — this is how a host becomes visible
in the fleet without ever running `nexus host add`. That silent auto-registration is the thing
§5 deliberately replaced with an explicit, named, per-site picker step.

**After this change, sighting must not create a new site.** It may only refresh `last_sync_at`
and the freshness-protected fields (`domain`, `environment` — same write-gate reasoning as today,
`externalSiteStore.ts:61-76`) on a site that **already resolved successfully** — which, given §7,
means `resolveTransport` already proved the site exists before the command ran. If resolution
fails (zero or ambiguous sites), the command already errored in §7 and `maybeUpsertExternalSite`
is never reached with anything to sight.

**Consequence, stated plainly:** `nexus wp core version ssh:newalias@production` against an alias
that has never been through `nexus host add` will now fail with "Connection has no registered
sites," where today it silently creates a phantom site row with no discovered domain. This is the
intended behavior, not a regression — a `sites` row should mean "the user (or the picker) named
this," never "something happened to reference this string once."

## 9. Removal

- `nexus host remove <alias>` — one connection, everything under it. Soft-deletes every row where
  `account_id = alias AND source = 'external'` (`is_active = 0`, matching the existing per-row
  soft-delete convention at `resolvers.ts:5568`), then removes the connection profile.
- **New:** `nexus host remove-site <alias>/<site>` — soft-deletes exactly that row, leaves the
  connection and its other sites untouched.

## 10. Migration

**None.** Per the decision made when this was discussed: `hostinger-test`, the only external host
currently registered anywhere, is re-registered from scratch under the new flow. Its collected
plugin/theme/PHP data and vector-store index re-populate on the next refresh/index cycle. No code
converts old-shape rows to new-shape rows.

## 11. Consumers requiring a change — verified inventory, not a guess

Grepped every call site of `externalSiteId(` (the function whose signature changes) plus every
place a target string is *reconstructed* from a graph row rather than parsed from user input,
since reconstruction is where the alias/site conflation is easiest to miss.

| File:line | What it does today | What changes |
|---|---|---|
| `externalSiteStore.ts:27` | `externalSiteId(alias)` | Becomes `externalSiteId(alias, site)` → `ssh:${alias}/${site}` |
| `tool-registry.ts:55` (`maybeUpsertExternalSite`) | Unconditionally upserts a site for any sighted alias | §8 — refresh only, never create |
| `resolvers.ts:537` / `resolvers/sites.ts:202` (`nexusSitesGet`, live + dormant copy) | Looks up one row by `externalSiteId(alias)` | Must resolve alias **and** site per §7's rule; dormant copy resynced per the established `resolvers/wpe.ts` policy (CLAUDE.md), same as Task 13 of the prior plan |
| `resolvers.ts:2644` | Health lookup keyed on `externalSiteId(alias)` | Same site-resolution rule as §7 |
| `resolvers.ts:5515` (`nexusHostAdd`/probe-apply) | Writes one row per alias, no `account_id` set | Becomes N writes (one per selected candidate), each with `account_id = alias`, `id = ssh:${alias}/${site}` |
| `resolvers.ts:5568` (`nexusHostRemove`) | Soft-deletes one row by `externalSiteId(alias)` | Soft-deletes every row `WHERE account_id = alias` (§9) |
| `ExternalRefreshScheduler.ts:116` | Reconstructs `` `ssh:${row.name}@${row.environment}` `` — **wrong after this change**, since `row.name` becomes the site slug, not the alias | `` `ssh:${row.account_id}/${row.name}@${row.environment}` `` |
| `ExternalContentIndexScheduler.ts` (same pattern, confirmed present) | Same reconstruction bug | Same fix |
| `ExternalRefreshScheduler.ts:99` / `ExternalContentIndexScheduler.ts:128` (selection query) | `WHERE source='external' AND is_active=1` | **No change** — a site is still just a `sites` row; the scheduler never parses the id |
| `nexus_list_sites`, Data Completeness, fleet health, `nexus fleet *`, content search | All operate on `sites` rows via `source`/`is_active`, never parse the id structure | **No change** — confirmed by reading, not assumed, since this is the finding that keeps this design's blast radius from being much larger |

## 12. Testing

- **Registration:** single root unchanged; multiple roots produces a checklist with correct
  per-candidate domain/suggested-slug (via the reused single-path probe); `-y` registers all with
  defaults; zero selected leaves a connection with zero sites; re-running `host add` on an
  existing connection offers only new roots.
- **Target parsing:** `ssh:<alias>/<site>@<env>` parses to `{alias, site, environment}`; bare
  form parses with `site: undefined`; malformed forms still throw as today.
- **`resolveTransport` — this is the security-relevant surface, test it as such:**
  - a site registered `--env production`, addressed via the bare shorthand with a `@development`
    suffix, is still gated as production (the exact regression §7 must not reintroduce).
  - the same, addressed via the full `/<site>@development` form.
  - zero sites under a connection → the "no registered sites" error, gate never runs.
  - two or more sites, bare form → disambiguation error naming both, gate never runs for either.
  - a `/<site>` naming a site that doesn't exist under that connection → not-found, distinct from
    the zero-sites and ambiguous cases.
- **Sighting:** a successful command against an existing site updates its `last_sync_at` and
  preserves `domain`/`environment` per the existing write-gate tests; a command against an
  unregistered alias or an ambiguous bare target never reaches the sighting code path at all
  (assert `upsertSite` is not called, not just that the visible output is an error).
- **Removal:** `host remove <alias>` deactivates every site with that `account_id`, confirmed via
  a two-site fixture; `host remove-site` deactivates exactly one, leaves the sibling active.
- **Scheduler reconstruction:** both schedulers build a resolvable target from `account_id` +
  `name`, not `name` alone — regression-pin this specifically, since it is the kind of bug that
  only shows up against a two-site connection and every existing fixture has one site.

## 13. Risks

1. **`resolveTransport`'s gate is the single highest-consequence surface in this design.** A
   mistake here reopens the exact environment-downgrade bug the current code's own comments
   record having fixed once already. Test it adversarially, not just happily.
2. **Every existing consumer that reconstructs a target string from a graph row, not just the two
   schedulers found here, is a candidate for the same bug.** §11's grep covered `externalSiteId(`
   call sites and the two known schedulers; a broader grep for the string pattern `` `ssh:${ ``
   should be run again immediately before implementation, since this design's own writing process
   is not a substitute for that check at execution time.
3. **The sighting-behavior change (§8) is a visible behavior change for anyone who has been
   relying on phantom auto-registration.** There is currently exactly one external host anywhere,
   so the blast radius is effectively zero today — but it should be called out in release notes if
   this ships past this dev machine, since it changes what happens with no code change on the
   caller's side.

## 14. Appendix — decisions made during design, for the record

- Registration: **list discovered sites, let the user pick** (not auto-register-all, not a
  separate two-step connection/site flow).
- Site identifier: **auto-suggested slug from the domain, editable at pick-time.**
- Migration: **none — re-register.**
- Environment: **per-site**, not per-connection.
- Removal: **`host remove` cascades to every site; `host remove-site` is the scoped-down command.**
- Target shorthand: **accepted as input when unambiguous; never emitted in output.**
