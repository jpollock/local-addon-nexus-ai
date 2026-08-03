# Site Transport Abstraction — Design (Spec 0)

**Date:** 2026-08-02
**Status:** Approved, not yet implemented
**Sequence:** Spec 0 of 3 (Spec 1 — external SSH hosts; Spec 2 — external REST hosts)

---

## 1. Origin and scope decision

A user asked whether Nexus could manage a WordPress site on a host they can SSH
into. It cannot: every remote path is hardcoded to WP Engine's SSH gateway
(`local+ssh+<install>@<install>.ssh.wpengine.net`, key at
`{userData}/ssh/wpe-connect`), and the site source model is a closed
`'local' | 'wpe'` union.

The motivation was initially framed as a **migration on-ramp**. Through design
discussion the requirements settled on a permanent site type with full `wp_*`
parity, two transports, fleet inclusion, and its own safety policy. That is a
**universal fleet manager**, not an on-ramp — roughly 3–4× the build. This is
recorded deliberately so the escalation is a decision rather than a drift.
Migration/pull is a possible later phase, not the goal.

**Pulling a non-WPE host into Local is explicitly out of scope**, and not
because it is impossible — `rsync` + `mysqldump` over SSH into Local's import
path is mechanically the same shape as the existing WPE pull. It is out of scope
because WPE installs are uniform (known wp-config location, DB credentials, PHP
version, directory layout) while arbitrary hosts are a long tail: DB on a
separate managed host, media offloaded to S3, symlinked mu-plugins, PHP
mismatch. Transport is not the hard part; knowing what you are pulling is.
Assessment must come first and will determine whether pull is worth building.

### Decomposition

| Spec | Contents |
|---|---|
| **0 (this doc)** | `SiteTransport` abstraction; migrate Local + WPE-SSH onto it. **Zero behavior change.** |
| 1 | `ExternalSshTransport` — arbitrary SSH hosts, full `wp_*` parity |
| 2 | `ExternalRestTransport` — WP REST API + application password |

Spec 0 is sequenced first and standalone so that a regression in existing WPE
paths is unambiguously attributable to the refactor rather than to new features.

---

## 2. Architecture

### 2.1 Two axes, not one

Site capabilities divide along a line that already exists in the codebase's tool
naming:

| | **Axis 1 — `SiteTransport`** (WordPress ops, `wp_*`) | **Axis 2 — platform** (host ops, `local_*` / `wpe_*`) |
|---|---|---|
| Local site | Local `wpCliRun` | Local APIs — start/stop/clone/PHP version/trust-SSL |
| WPE install | SSH → WP-CLI | CAPI — backups, cache, domains, SSL, usage |
| External SSH *(Spec 1)* | SSH alias → pinned `wp-cli.phar` | *none* |
| External REST *(Spec 2)* | REST + application password | *none* |

**CAPI is deliberately not a transport.** Axis 1 implementations are answers to
one question — *how do I execute an operation against a WordPress site* — and are
genuinely interchangeable. CAPI answers a different question: *what does the
hosting platform say about this install*. There is no equivalence to trade on;
CAPI cannot run WP-CLI and SSH cannot purge WPE's edge cache. Forcing CAPI into
`SiteTransport` yields an implementation whose `runWpCli()` throws
unconditionally and whose `supports()` is uniformly false — a union wearing a
polymorphism costume.

The payoff is a principled answer to "what can an external site do?": it has a
transport but no platform, so every `wp_*` tool works and every platform tool is
**structurally absent rather than unimplemented**. No per-tool explanation, and
no half-working `wpe_create_backup` against a DigitalOcean box.

### 2.2 Axis 2 is deliberately thin in Spec 0

The pain in the current code is entirely on axis 1: 15 tool files branching on
target type, five execution paths, three duplicate parsers. The `wpe_*` and
`local_*` tools have **no branching problem** — each is already hardcoded to
exactly one platform. A full `PlatformProvider` polymorphism would be
speculative.

Spec 0 therefore formalises axis 2 as a single descriptor —
`platformOf(site) → 'local' | 'wpe' | 'none'` — which Spec 1 uses to reject
platform tools on external sites. Everything else is deferred until a concrete
need appears.

### 2.3 The interface

Location: `src/main/transport/`.

```ts
export type TransportKind = 'local' | 'wpe-ssh' | 'external-ssh' | 'external-rest';

export interface SiteTransport {
  readonly kind: TransportKind;
  readonly siteRef: SiteRef;                    // stable identity for audit/logging

  runWpCli(args: string[], opts?: RunOpts): Promise<WpCliResult>;
  deleteRemoteFile(path: string): Promise<DeleteResult>;   // Sentinel; deliberately NOT via WP-CLI
  supports(cap: Capability): boolean;
  probe(): Promise<ProbeResult>;                // reachable? wp-cli version? wp version?
}
```

Spec 0 ships exactly two implementations: `LocalTransport` (wrapping
`localServices.wpCliRun`, `local-services-bridge.ts:463`) and `WpeSshTransport`
(wrapping `local-services-bridge.ts:831`).

**On `supports()`:** in Spec 0 it returns `true` for every capability on both
implementations, because both are full WP-CLI. This is not dead weight — it
exists so Spec 2 does not have to reopen all 15 tool files to add capability
gating. Paying for it now is the cheaper of the two options.

`Capability` is seeded in Spec 0 with only the tokens the 15 existing tools need
(`wp-cli`, `arbitrary-options`, `db-query`, `eval`, `search-replace`,
`core-update`, `theme-activate`) and is **not** intended to be complete. Spec 2
enumerates it properly, once the REST surface makes the distinctions load-bearing.
Spec 0 should not invent capability tokens that no caller checks.

**On `deleteRemoteFile()`:** `SentinelExecutor` needs one operation that
`runWpCli()` cannot express (see §3.5). A narrow primitive is chosen over a
general `exec(raw)` because a general raw-shell method would have to exist on
*every* transport — including, in Spec 1, someone's production server.

---

## 3. Current-state findings

Everything in this section was verified against the tree at `main` as of
2026-08-02. It is recorded because several items contradict what the codebase
and its docs appear to say.

### 3.1 Five WP-CLI execution paths

1. `local-services-bridge.ts:831` `remoteWpCliRun()` — the real SSH
   implementation; hardcodes `local+ssh+${installName}` @
   `${installName}.ssh.wpengine.net`, key `{userData}/ssh/wpe-connect`.
2. `local-services-bridge.ts:463` `wpCliRun(siteId, args)` — local execution.
3. `remote-exec.ts:178` `remoteWpCliRun()` — thin whitelist wrapper over (1);
   only MCP tools use it.
4. `SentinelExecutor.ts:19` `remoteSshRaw()` — near byte-for-byte duplicate of
   (1)'s SSH argument construction, bypassing WP-CLI entirely.
5. ~6 direct callers of `localServices.remoteWpCliRun` that skip (3) and its
   whitelist: `ipc-handlers.ts:3464`, `RemoteContentExtractor.ts:43`,
   `wpe/deep-refresh.ts` (~15 calls), `wpe/wait-for-ssh.ts:72`,
   `resolvers.ts:1262-1263`, `resolvers/wp-cli.ts:81,147`.

### 3.2 Three duplicate target parsers

| Location | Scope |
|---|---|
| `src/cli/utils/target.ts:23` | CLI-side validation (~40 call sites) |
| `src/main/graphql/resolver-utils.ts:52` | GraphQL server |
| `src/main/graphql/resolvers.ts:92` | copy-paste duplicate of the above (~58 call sites) |

Plus a fourth translator, `src/cli/utils/mcp-client.ts:119` `targetToMcpArgs()`.

**They have already skewed:** the CLI shape carries `installId`, the server shape
carries `installName`. Unifying therefore requires picking one, which is a small
behavior decision rather than pure deduplication.

Recognised forms are identical across all three: `name@local`;
`wpe:account/install@(production|staging|development)`; bare `name` → local.
The suffix is optional.

### 3.3 The resolved-target union

`src/main/mcp/modules/wp-cli/remote-exec.ts:63-74`:

```ts
export interface LocalTarget  { type: 'local';  site: LocalSiteInfo; }
export interface RemoteTarget { type: 'remote'; installName: string; installInfo: WpeInstallInfo; }
export type ResolvedTarget = LocalTarget | RemoteTarget;
```

Consumed by **15 MCP tool files** in `src/main/mcp/modules/wp-cli/`, each doing a
binary `if (target.type === 'remote')` branch. The union is never
exhaustiveness-checked, so adding a third variant creates 15 silent holes.

### 3.4 MCP and CLI are not functionally equivalent

There is **no raw WP-CLI passthrough** in the CLI. All 22 subcommands in
`src/cli/commands/wp.ts` are structured; there is no catch-all, no
`allowUnknownOption`, no `-- <args>`. The generic arbitrary-command surface
exists only as the GraphQL mutation `nexusWpCommand(target, command: [String])`,
which the CLI invokes with hardcoded arrays.

The CLI is a **hybrid**, routing different subcommands to different backends —
`wp plugin list` → MCP (`wp.ts:32`), `wp plugin install/activate/deactivate` →
GraphQL (`:118,151,182`), `wp plugin update` → MCP with GraphQL fallback
(`:223,250`). Which guard applies depends on which subcommand was typed.

Guards on remote WPE installs:

| | MCP (`remote-exec.ts:178`) | GraphQL (`resolvers.ts:1663`, live) |
|---|---|---|
| Blocklist | 5 — incl. `db cli` | 4 — **`db cli` missing** (`:1679`) |
| Whitelist | **14 commands** (`ALLOWED_REMOTE_COMMANDS`) | **none** |
| Environment gate | yes (`:118,140`) | yes (`classifyWpCliOp` + `isOperationAllowed`, `:1726`) |
| Audit | ToolRegistry chokepoint | `auditDirectOperation` |

**Consequence — five MCP tools have unreachable remote code paths.**
`wp_core_update`, `wp_theme_activate`, `wp_post_create`, `wp_post_update` and
`wp_post_delete` all call `remoteWpCliRun` (`core-update.ts:40`,
`theme-activate.ts:40`, `post-create.ts:69`, …), but `core update`,
`theme activate` and `post create` are absent from `ALLOWED_REMOTE_COMMANDS`.
They return "Command not allowed for remote execution" every time, while the
same operations succeed through the CLI's GraphQL route. This is a live bug, not
merely an inconsistency.

### 3.5 SentinelExecutor

Blast radius is small: **one call site** (`ipc-handlers.ts:51` import,
`:4775` `nexus:sentinel:execute`), and `remoteSshRaw` is used for exactly **one
command shape** — `rm -f '<escaped>'` against
`/nas/content/live/<installName>/<rel>` (`SentinelExecutor.ts:77-84`).
Everything else routes to `localServices.remoteWpCliRun` (`:98`). Sentinel's
scanning does not touch the live site at all; Tier 2 clones the install into a
local sandbox and runs `wp_eval` probes there.

Behaviour that must be preserved exactly:

- **Resolve-never-reject** semantics (differs from the WP-CLI path, which throws)
- 35 s timeout
- `ControlMaster=auto` / `ControlPath=/tmp/ssh-nexus-%C` / `ControlPersist=30s`
  multiplexing — performance depends on it
- Deliberate WP-CLI bypass (comment at `:16-18`): loading MU-plugins on a
  possibly-compromised site is the thing being avoided
- 300-char output truncation (`:90`)

**It has zero test coverage and SSH is never mocked.** Nothing in CI breaks if it
changes, and nothing in CI catches it if it breaks.

### 3.6 `environment-filter.ts` is dead code

All five exports of `src/main/mcp/utils/environment-filter.ts`
(`DEFAULT_WPE_ALLOWED_ENVIRONMENTS`, `isWpeEnvironmentAllowed`,
`checkWpeInstallEnvironmentAccess`, `checkWpeInstallIdEnvironmentAccess`,
`checkKnownEnvironmentAccess`) have **zero callers** anywhere in `src/`.

The live gate is `src/main/mcp/utils/operation-permissions.ts::isOperationAllowed`,
with ~20 call sites across `mcp/modules/wpe/*`, `remote-exec.ts`, `resolvers.ts`
and `WPESyncService.ts`. The presence of `migrateFromLegacyEnvFilter` in that
file confirms `environment-filter.ts` is superseded legacy.

**CLAUDE.md's "Known Pitfalls" still directs readers to the dead file.** This
should be corrected separately from this work. The practical implication for
Spec 1 is favourable: extending the environment gate to external hosts means
extending a live, well-wired mechanism, not building one.

### 3.7 Drifted unreferenced resolver

`src/main/index.ts:50` imports `createResolvers` from `./graphql/resolvers`,
which resolves to `resolvers.ts` (the file) rather than `resolvers/index.ts`
(the directory). `src/main/graphql/resolvers/wp-cli.ts` is therefore
**unreferenced** — and its copy of `nexusWpCommand` is missing **both** the
`isOperationAllowed` environment gate and the `auditDirectOperation` call that
the live copy has.

CLAUDE.md documents this hazard for `resolvers/wpe.ts`; it applies equally to
`resolvers/wp-cli.ts` and is not currently recorded. If the resolver split lands
as-is, the highest-blast-radius path in the addon silently loses its environment
gate and its audit entry.

---

## 4. Migration mechanics

### 4.1 Path mapping

| Today | After |
|---|---|
| `local-services-bridge.ts:831` `remoteWpCliRun` | `WpeSshTransport.runWpCli()` |
| `local-services-bridge.ts:463` `wpCliRun` | `LocalTransport.runWpCli()` |
| `SentinelExecutor.ts:19` `remoteSshRaw` | `WpeSshTransport.deleteRemoteFile()` |
| `remote-exec.ts:178` whitelist wrapper | policy layer wrapping **any** transport — it is not SSH-specific and should not be named as if it were |
| ~6 guard-bypassing direct callers | routed through transport + policy layer |

The fourth row closes a real gap: today the whitelist guards only the MCP path,
so direct callers of `localServices.remoteWpCliRun` skip it entirely.

The 15 tool files each lose their `if (target.type === 'remote')` branch in
favour of `resolveTransport(args)` → `t.runWpCli([...])`.

### 4.2 Policy is preserved, not unified

Moving the guard onto the transport fixes the **bypass** problem. It does **not**
imply a single policy. Unifying onto the whitelist would break CLI operations
that work today; unifying onto the blocklist would widen what MCP and agents can
do on production installs. Either is a behavior change and collides with Spec 0's
core promise.

**Therefore:** the transport *hosts* the guard but takes a **policy parameter**,
and each caller passes exactly what it enforces today. Policy unification — and
the five dead remote tools in §3.4 — become a separate, explicit spec.

### 4.3 Order of operations

Each step is independently verifiable:

1. Characterization tests for `SentinelExecutor` and any untested execution path
2. Unified `parseTarget` → `src/common/target.ts`; delete the three copies
3. `SiteTransport` + `LocalTransport` + `WpeSshTransport`
4. Migrate the 15 tool files
5. Migrate the ~6 guard-bypassing callers
6. Fold in `SentinelExecutor`
7. Delete dead code

### 4.4 Known unknowns

Named rather than papered over; each could turn "mechanical" into "decision":

- **Parser skew** (§3.2) — unifying means picking `installId` or `installName`.
- **Per-side argument construction** — some of the 15 tools may build genuinely
  different WP-CLI args per side, not merely dispatch differently. Those will not
  collapse cleanly; the table-driven test in §5 is designed to surface them.
- **~25 ad-hoc CLI target checks** — `target.endsWith('@local')` instead of
  calling the parser (`sites.ts:146,200,250,508`, `sync.ts:24,96,213`,
  `wpe.ts:333,382`). **Deliberately left alone in Spec 0**: they are CLI-side
  string checks that never touch a transport, and routing them through the parser
  *is* a behavior change. They become genuinely wrong once external targets
  exist, so they belong to Spec 1.

---

## 5. Zero-behavior-change proof and test strategy

**The contract.** For every existing caller, three things must be identical
before and after: the exact command executed on the far end, the shape of the
result (including error/success semantics), and timing/connection
characteristics.

**Proof 1 — golden-argv tests.** The most likely silent breakage is SSH argument
construction, which is currently untested. Extract the argv builder and snapshot
the precise `spawn('ssh', [...])` array for a representative input set, for both
`remoteWpCliRun` and `remoteSshRaw`. This pins host/user format, `-F /dev/null`,
`IdentitiesOnly`, `ControlMaster`/`ControlPath`/`ControlPersist=30s`, the `-i`
key path, and the 35 s timeout. Written **before** the refactor, run unchanged
after: byte-identical argv makes SSH behavior identical by construction rather
than by inspection.

**Proof 2 — transport conformance suite.** One shared suite every
implementation must pass, run against `LocalTransport` and `WpeSshTransport`
now and against Spec 1/2 transports later. A new transport is "done" when it
passes.

It must **pin the resolve-never-reject inconsistency rather than smooth it
over** (§3.5). Fixing that during Spec 0 would be a behavior change wearing a
refactor's clothes. Record it as deliberate debt with a follow-up.

**Proof 3 — table-driven tool tests.** One parameterized suite over all 15 tools
asserting the expected WP-CLI args for both a local and a remote target, with the
transport mocked. This also flushes out known-unknown #2 in §4.4.

**Baseline discipline.** Run the full suite and record results *before* starting;
this repo has pre-existing native-module failures and a wide refactor is exactly
where "was that already broken?" wastes an afternoon. Tests run against the
system-Node build of `better-sqlite3` — `npm install` before testing,
`npm run rebuild` before loading in Local, never interleaved.

**What this cannot prove.** There is no CI coverage of real SSH against a live
WPE install and there will not be. Two paths require manual verification before
merge: a representative `wp_*` command against a real WPE install, and Sentinel's
file-delete remediation. The latter is the riskiest item in Spec 0 — no coverage
today, live production target, and the golden-argv test proves the command is
*identical*, not that it is *correct*.

---

## 6. Out of scope for Spec 0

| Item | Reason |
|---|---|
| Any new site source value | Spec 1 |
| External hosts, `ssh_config` reuse, pinned `wp-cli.phar` | Spec 1 |
| REST transport, capability matrix enforcement | Spec 2 |
| Unifying MCP/GraphQL policy; fixing the 5 dead remote tools | Behavior change — own spec (§4.2) |
| Fixing resolve-never-reject inconsistency | Behavior change — deliberate debt (§5) |
| ~25 ad-hoc CLI `endsWith('@local')` checks | Behavior change; belongs to Spec 1 (§4.4) |
| Deleting `environment-filter.ts`; correcting CLAUDE.md | Unrelated cleanup (§3.6) |
| `installName` reaching SSH unvalidated from the renderer | Pre-existing; deserves its own security review |
| Pulling non-WPE sites into Local | §1 |

---

## 7. Risks

1. **Sentinel regression on live production.** Highest-severity item: no existing
   coverage, live target, remediation path. Mitigated by characterization tests
   written first (step 1) plus mandatory manual verification.
2. **Parser unification is the widest blast radius** (~98 call sites). Low risk
   per site but high volume, and the existing skew forces a decision.
3. **Silent policy change.** The single largest way to violate Spec 0's promise
   would be to accidentally unify guards while moving them. §4.2 exists
   specifically to prevent this.
4. **Interface shaped too narrowly.** If `SiteTransport` is designed only around
   what Local and WPE-SSH need, Spec 1/2 will force a second refactor. Mitigated
   by including `supports()` and `probe()` now, before there is a consumer.

---

## 8. What Specs 1 and 2 will need

Recorded here because it justifies interface decisions made above.

**Spec 1 — external SSH.** A third source value beyond `local | wpe`; connection
resolution that prefers a user's existing `~/.ssh/config` alias (inheriting
`ProxyJump`, bastions and agent auth for free, and storing no key material),
with an explicit host/port/user/key form only as fallback; a pinned
`wp-cli.phar` uploaded to a Nexus-owned directory on the host so behavior does
not vary with whatever WP-CLI the host happens to have; an environment label
captured at registration, defaulting to production, feeding the live
`isOperationAllowed` gate; and full `wp_*` parity with all platform tools
structurally absent.

**Spec 2 — external REST.** Application-password auth, and real capability
gating. Core WP REST provides content CRUD, users, plugins (list/activate/
deactivate/install), themes (list only), site-health tests and a whitelist of
settings. It provides **no** arbitrary `wp_option_get`, **no** DB scanner (needs
`$wpdb`), **no** `wp_eval`, **no** search-replace, **no** theme activate, **no**
core update, and no clean exposure of the WP version. Full parity is achievable
over SSH and structurally impossible over REST — hence `supports()`.

A later extension worth noting: `wp_list_abilities` / `wp_run_ability` are
already wired to the WP 7.0 Abilities API, which is a legitimate route to a
richer REST surface without inventing a proprietary plugin. It is not Spec 2
material, since a site being migrated away from is unlikely to be on WP 7.0.

### 8.1 `wpe-rest` — coherent, deliberately deferred

Reaching a **WPE** install over REST rather than SSH is a legitimate member of
axis 1, and its coherence is a useful check that the seam is in the right place.
It is deliberately absent from `TransportKind` for now:

- No identified need — the driving requirement was non-WPE hosts.
- The credential story is worse. SSH covers every install with the single
  `wpe-connect` key from Local's Connect flow; REST needs an application
  password provisioned per install, across a fleet that is ~300 installs today.
- It is a structurally weaker transport (see Spec 2 above) for a host where a
  stronger one already works.
- Whether WPE's platform rules permit the required REST endpoints is **unverified**.

**Adding it later is cheap, by construction.** Nothing branches on
`TransportKind` — tools call `transport.runWpCli()`, and `kind` exists only for
logging, audit and telemetry. The absence of exhaustive switches on it is the
point of this refactor, so a fifth value costs a line plus an implementation.

**Trigger condition to revisit:** fleet-scale reads. `WPESyncService` sweeps
installs via `isOperationAllowed('wpcli_read', …)` (`:191`, `:879`), and each is
an SSH spawn plus WP-CLI bootstrap — seconds apiece across hundreds of installs.
If that sweep is measured and found to be SSH-bound, a read-only `wpe-rest`
transport becomes a real performance argument. Two caveats: drive it from
measured sync times rather than intuition, and check first whether part of what
the sweep collects is better served by CAPI on axis 2 — though plugins, themes
and options are WordPress-internal, so CAPI cannot supply those.

---

## 9. Implementation outcome (added 2026-08-02, after Spec 0 shipped)

Spec 0 is implemented on `feat/site-transport-abstraction`. Two current-state
claims above were **wrong** and are corrected here rather than edited in place,
so the error is visible:

- **§3.1 item 5 said "~6 direct callers."** The real figure is **44 call sites
  across 8 files**: `deep-refresh.ts` (16), `resolvers.ts` (11),
  `resolvers/twin.ts` (7), `WPESyncService.ts` (4), `resolvers/wp-cli.ts` (2),
  `WpeRefreshScheduler.ts` (2), `RemoteContentExtractor.ts` (1),
  `wait-for-ssh.ts` (1). Three of those files were not listed at all. The
  undercount came from reasoning about which surfaces "should" be affected
  instead of grepping — the same failure mode this project's CLAUDE.md warns
  about for audit coverage.
- **§3.2's parser skew is resolved.** `installName` is now canonical in
  `src/common/target.ts`; `requireWpeTarget` still returns `installId` as a
  deprecated alias so CLI call sites needed no change.

§3.4 (five unreachable remote tools), §3.6 (`environment-filter.ts` dead), and
§3.7 (`resolvers/wp-cli.ts` unreferenced, missing its gate and audit) were
re-verified during implementation and **remain accurate**.

### What Spec 1 must do before adding a third transport

- **Harden the conformance suite first.** Two reviewers independently judged
  `tests/unit/transport/conformance.test.ts` too loose to be the gate this
  document designates it. A broken implementation passes today if `runWpCli`
  returns `{success:true, stdout:<anything>}` and `probe()` returns
  `{reachable:true}`. Untested: failure paths, timeout propagation, spawn error,
  multi-call state. The real Spec 0 protection is the per-implementation tests
  plus the two characterization suites — which do not extend to a new transport.
- **The whitelist bypass moved; it did not close.** Task 10 was deliberately
  skipped: `localServices.remoteWpCliRun` now delegates to `WpeSshTransport`, so
  all 44 sites route through the transport, but none is policy-guarded — exactly
  as before. Closing that needs the policy-unification spec, not Spec 1.
- **Two hazards are commented in code, not fixed**, because fixing them would
  have been behaviour change: `GRAPHQL_REMOTE_POLICY` is unconsumed and its
  matching is stricter than the inline checks it models
  (`startsWith || includes(' ' + x)` vs `startsWith` only); and
  `buildWpCliCommand`'s skip-flag ternary is all-or-nothing, so `skipThemes` is
  accepted by `RunOpts` but ignored — if `theme activate` is ever whitelisted for
  remote, it loses **both** skip flags.
