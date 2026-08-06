## CRITICAL: No Releases Without Explicit Permission

**NEVER do any of the following unless the user explicitly says "push", "release", "deploy", or "ship":**

- `npm version` (bumping version)
- `git tag`
- `git push` (to any remote)
- `git push origin v*` (release tags)
- Triggering CI releases

**This applies even when:**
- Merging branches
- "Finalizing" work
- The task seems complete
- Docs are done and tests pass

**Wait for the user to explicitly say to proceed with any of the above.**

---

## Native Modules & Electron

**TL;DR:** Manual rebuild required when switching contexts.

**The addon uses better-sqlite3** (native module):
- Tests use system Node.js (MODULE_VERSION 127)
- Local uses Electron Node.js (MODULE_VERSION 146)
- **Different binaries required** — one context breaks the other

**Workflow:**
```bash
npm install        # For tests (compiles for system Node)
npm run rebuild    # For Local (recompiles for Electron)
```

**After `npm install`, always run `npm run rebuild` before loading in Local.**

**NO postinstall hook** — it breaks `npm install` from shell (electron-rebuild fails in wrong context).

**If you see NODE_MODULE_VERSION error in Local:**
1. Run `npm run rebuild`
2. Restart Local and reload addon
3. If still fails: Check Xcode Command Line Tools (`xcode-select --install`)

**See:** `docs/NATIVE_MODULES.md` for details.

**Key versions:**
- better-sqlite3: 12.11.1 (don't change this)
- Electron (Local): 42.2.0
- System Node: 22.16.0

**node-abi registry patch required**: `@electron/rebuild`'s bundled `node-abi` doesn't know about Electron 42.2.0 yet. Both registry files need a manual patch with `"future": true` (NOT `false` — the boundary check requires it to be the last future entry):
```bash
for regPath in \
  "node_modules/node-abi/abi_registry.json" \
  "node_modules/@electron/rebuild/node_modules/node-abi/abi_registry.json"; do
  node -e "
    const fs = require('fs');
    const reg = JSON.parse(fs.readFileSync('$regPath', 'utf8'));
    const filtered = reg.filter(e => e.target !== '42.2.0');
    filtered.push({ abi: '146', future: true, lts: false, runtime: 'electron', target: '42.2.0' });
    fs.writeFileSync('$regPath', JSON.stringify(filtered, null, 2));
  "
done
npm run rebuild
```

---

## Jest & Open Handles

**`npm test` exits cleanly.** `jest.config.js` has `forceExit: true` intentionally.

Native modules (sqlite-vec, onnxruntime) can register background threads/handles with Node's event loop at import time that Jest's sandbox cannot drain naturally. `forceExit: true` makes Jest exit once all tests complete instead of hanging; `detectOpenHandles: true` keeps any such handle visible so a *new*, real leak isn't silently masked.

> Historical: this note used to describe LanceDB's `CustomGC` handle. The vector store was migrated from LanceDB to **sqlite-vec** (`src/main/vector-store/SqliteVecStore.ts`) and `@lancedb/lancedb` is no longer a dependency, so that handle no longer appears — but the native-module rationale for `forceExit` still stands.

**See:** `docs/NATIVE_MODULES.md` for details.

---

## Scheduler Settings — Non-Reactivity

**`HaltedSiteRefreshScheduler` and `WpeRefreshScheduler` read interval settings once at startup**, then become reactive via `onSettingsUpdated` callback (which calls `scheduler.restart(newIntervalMs)`). If you add a new scheduler with a settings-driven interval, wire it into the `onSettingsUpdated` block in `src/main/index.ts:~660`.

**Default values for WPE sync settings:**
- `wpeSyncAutoEnabled` — **false** (opt-in). The type comment used to say "default: true" — that was wrong.
- `wpeRefreshAutoEnabled` — **false** (opt-in). Same issue.
- `haltedSiteRefreshIntervalHours` — 24h (always runs, no enable toggle needed)

---

## WP AI Plugin Compatibility (wp-plugins/ai-provider-for-local-gateway)

**Connector approval bypass**: The MU plugin template (`src/main/ai-gateway/mu-plugin-template.ts`) injects an `option_wpai_connector_approvals` filter that pre-approves `ai/ai.php`, `nexus-ai-connector/nexus-ai-connector.php`, and `ai-provider-for-local-gateway/plugin.php` for the `local-gateway` connector. This is intentional for local development — the gateway token is the auth layer. Do not remove without understanding the connector-approval experiment.

**Model capabilities**: `LocalGatewayModelMetadataDirectory` must declare `OptionEnum::outputSchema()` for JSON-response abilities (editorial notes, etc.) and `OptionEnum::functionDeclarations()` for tool-use abilities. Missing options cause `is_supported_for_text_generation()` to silently return false.

**MU plugin no longer sets WP_DEBUG**: Removed in May 2026. Previously forced `WP_DEBUG_LOG=true` on every managed site, which made `wp-content/debug.log` grow unbounded and exposed PHP errors via HTTP.

---

## External SSH Hosts

Sites that are neither Local nor WP Engine, reached by a `~/.ssh/config` alias.
Target syntax: `ssh:<alias>@<production|staging|development>`.

- **Nexus never writes to the user's server.** No WP-CLI upload, no
  `ssh-copy-id` execution. The probe detects, searches known locations, and
  prints the command for the user to run. Do not add an upload path.
- **No key material is stored.** The alias carries host, user, port, key,
  ProxyJump and agent settings. This is why `buildExternalSshArgs` must never
  pass `-F /dev/null` — the WPE builder does, deliberately, and copying that
  across breaks every bastion setup while looking like a network fault.
- **`ssh -G` resolves, it does not validate.** It exits 0 for an alias in no
  config file, echoing the alias back as hostname with the local username and
  port 22. Nothing may gate on its exit code; connectivity is the real gate.
- **The probe stores `wpPath` and `wpCliPath`, and `resolveTransport` reads
  them back.** If you add a new field the probe discovers, wire it through
  `resolve.ts` too or it is write-only.
- Probe commands are read-only, so they are not audited. `host add`/`remove`
  mutate only local addon state and never reach `services.localServices`.
- **The registered `environment` is a write gate, and it has two sources.**
  `resolveTransport` gates on the **more restrictive** of the label stored by
  `nexus host add` and the suffix on the caller's target string
  (`mostRestrictiveEnvironment`, `mcp/utils/operation-permissions.ts`;
  `development` < `staging` < `production`). Gating on the target alone let a
  host registered `--env production` be written to by addressing it as
  `ssh:<alias>@development`. For the same reason `upsertExternalProfile`'s
  **lazy** writes (`source: 'sighting'`, the default) can never change a
  registered environment — only `nexus host add` (`source: 'registration'`)
  can. Omitting `--env` means *unspecified*: an existing host keeps its label,
  and only a new one defaults to `production`.
  **A `@staging` suffix on a target no longer loosens the permission gate** —
  it cannot override a host registered as `production`. This is deliberate: the
  environment now comes from the install cache (for WPE) or the most restrictive
  of the registered label and the typed suffix (for external).
- **18 of the 22 `nexus wp` subcommands reach an external host** (every command
  routed through `nexusWpCommand`), up from 3 before the unification.
  `nexusWpCommand` now delegates to `resolveTransport` via `resolveTargetArgs`,
  so an `ssh:` target works on all of them. Four are MCP-first (`wp plugin list`,
  `wp plugin update`, `wp core version`, `wp health`), trying `callMcpTool` and
  falling back to GraphQL when MCP is unreachable; the other 14 go straight through
  `nexusWpCommand`. All `resolveTransport`-backed MCP tools now declare
  `ssh_target` and `wp_path` in their `inputSchema`, so agents can discover them.
  The 4 that do NOT work: `db scan/clean/report` (local-only by design, separate
  resolvers) and `users` (reads the graph DB, not WP-CLI). `wp health` used to
  fail with `Site "undefined" not found.` because `wp_site_health` was local-only;
  it was ported onto `resolveTransport` and now works on all three targets.
- **The probe bypasses both `withPolicy(EXTERNAL_REMOTE_POLICY)` and
  `isOperationAllowed`.** `probeExternalHost` calls `sshExec` directly, so
  neither layer is in its path. This is accepted, not overlooked: its command
  set is **closed and read-only** (`echo`, `command -v wp`, a fixed
  `[ -x ]` loop, `wp --version`, a bounded `find`, `wp core version`,
  `wp option get siteurl`), and `wpcli_read` is permitted on every environment
  by default, so the gate would refuse nothing it currently runs. The one real
  consequence: a `remoteSiteExceptions` entry denying `ssh:<alias>` does **not**
  stop `nexus host test` from SSHing to that host. If the probe ever gains a
  caller-influenced or mutating command, that reasoning dies with it and it must
  be routed through the policy and the gate like every other remote call.
- **Aliases are format-validated in `ssh-args.ts`** (`assertSafeSshAlias`,
  `^[A-Za-z0-9][A-Za-z0-9._-]*$`), not per command. ssh reads its first
  non-option argument as the host, so a leading `-` makes the alias an
  *option* — `-oProxyCommand=…` in argv position is local command execution.
  Enforced at the argv builders because they are the only place an SSH
  invocation is constructed, so every entry point passes through them.
- **One router, one policy.** `resolveTransport` is the only place a target is
  resolved and a remote command policy applied. `nexusWpCommand` delegates to it
  via `resolveTargetArgs`. Do not add target resolution, a command blocklist or
  an `isOperationAllowed` call to a resolver — that is the drift this
  unification removed, and it is how the CLI and MCP surfaces diverged before.
- **`resolveTargetArgs` owns the bare-name → WPE fallback.** `nexus wp core
  version my-install` with no prefix depends on it. `resolveTarget` does not do
  this; it keys off which argument was supplied.
- **`resolveTransport` does not audit.** `nexusWpCommand` must keep calling
  `auditDirectOperation` itself, on both outcomes.
- **Fleet means local + WPE + SSH.** The graph `sites` table holds all three
  (`source` is `'local' | 'wpe' | 'external'`). A fleet query must cover the
  external source — `source='wpe'` alone is the bug this plan removed, and
  `source != 'local'` is forbidden (it silently absorbs any future source; see
  `source-semantics.test.ts`). **But the list is not always all three.** Every
  fleet resolver here filters `source IN ('wpe','external')`, deliberately,
  **because local sites are merged in from Local's own store** (see "Fleet
  counts" below) — adding `'local'` to those queries reintroduces a
  double-count. Use `IN ('local','wpe','external')` only where the graph is the
  *sole* source for the query, e.g. `resolveWpeGraphSite`'s bare-name lookup.
  Queries keying on `remote_install_id`, `wpe_site_id`, `account_id` or CAPI
  are WP Engine by nature and stay as they are.
- **A coverage metric's numerator and denominator must span the same source
  set.** `fleet_overview` counted `wp_version` across WPE + external and
  divided by the WPE-only count, inside a line labelled "(CAPI)". For a user
  with SSH hosts and no WP Engine account it printed `1 of 0`.
- **External hosts refresh only if the user opts in.** Historically nothing
  populated their plugin and theme rows, so they appeared in fleet views with
  empty data until a command was run against them; the refresh schedule was left
  as an open product decision. **That decision has since been made** — see
  "External host metadata refresh" below for `ExternalRefreshScheduler`. It is
  off by default, so an un-opted-in user still sees the empty-data behaviour
  described here, and `nexus host refresh <alias>` is the manual path.
- **Fleet-wide discovery now includes external hosts.** `nexus_list_sites` (the
  MCP tool agents are told to call first) and the `nexus://fleet/state` resource
  both now query `graph.db WHERE source='external'` — before this fix, a
  registered host was invisible to both, and a chat agent would confidently
  report it as "not registered" even though it was. `nexusContentSearchAll`,
  `nexusResolveTarget`, `SITE_FINDER_APPLY`, `GET_FLEET_SUMMARY`,
  `GET_FLEET_PLUGINS`, and several fleet-scoped MCP tools
  (`get_all_site_documents`, `compare_sites`, `detect_drift`, `get_site_health`)
  had the same class of gap and are fixed the same way.

---

## Fleet counts — what is real and what is not

**Local's store and the graph disagree, and each is authoritative for different
things.** A local site only gets a graph row once indexed, and nothing
reconciles the two. So: **count local sites from Local's own store, and count
WPE and external from the graph.** A fleet count taken purely from the graph
undercounts local badly; one taken purely from Local's store misses every
remote site.

**There are THREE site populations across the fleet resolvers, not two — and
they disagree with each other:**

| population | read via | used by | measured 2026-08-04 |
|---|---|---|---|
| Local's site store | `services.siteData.getSites()` | `nexusFleetHealth`'s `localSites` | 118, all Local |
| twin cache | `services.twinService.getAll()` | `nexusFleetSummary`, `fleet_overview` | Local only |
| content index | `services.indexRegistry.listAll()` filtered to `state === 'indexed'` | the health scores in `nexusFleetHealth` | 423 — **297 of them WPE install ids**, not Local |

Only the first is the count of Local sites. **The third is not a Local
population** — it is easy to assume it is, because `calculateMaintenance` keys
`indexRegistry` by Local site id, but WPE installs get indexed too and 70% of
its entries are theirs. `healthyCount` / `warningCount` / `criticalCount` are
computed over it, so they are neither a fleet figure nor a Local figure;
`sitesScored` is their denominator and must be printed with them.

Two pre-existing defects live in that loop and are not yet fixed:
`localSiteData[entry.siteId]` misses for every WPE entry (so `domain` is `''`
and `phpVersion` falls back to a fabricated `'8.0'`), and `calculateAllScores`
uses the default all-five factor set, so maintenance and activity score 0 for
those same entries — the exact defect the per-target factor list fixes in
`nexusFleetSiteHealth`. Fixing this means giving `calculateAllScores` a
per-target factor list too.

**Measure, do not copy the numbers.** This section previously carried "71 Local
sites" and "312 of 403", both stale, and both propagated into derived claims.
Measured 2026-08-04: `sites.json` **113** Local sites, graph `source='local'`
**33** rows, **365** active rows total (331 WPE + 33 local + 1 external), of
which **312** have plugin rows and **249** have theme rows. Re-run the counts
before quoting them:

```bash
node -e "const D=require('better-sqlite3');const p=require('os').homedir()+'/Library/Application Support/Local/nexus-ai/graph.db';const db=new D(p,{readonly:true});
console.log(db.prepare('SELECT source,is_active,COUNT(*) c FROM sites GROUP BY source,is_active').all());
console.log(db.prepare('SELECT COUNT(DISTINCT p.site_id) c FROM plugins p JOIN sites s ON s.id=p.site_id WHERE s.is_active=1').all());"
```

Consequence: `runningSites + haltedSites === localSites`, and neither sums to
`totalSites`. That is correct — `getSiteStatus` is a Local concept and Nexus
does not start or stop a remote host.

**Update availability is not persisted anywhere.** Neither `plugins` nor
`themes` has an `update_version` / `latest_version` column, and
`GraphService.upsertPlugin` writes only eight columns across 11 call sites.
Every `updateAvailable` in the codebase is computed live from WP-CLI's
`update_version` at query time, or from a live wp.org lookup in
`SiteDataResolver`. Fleet-wide outdated counts therefore **cannot** be served
from the graph, and are reported as `null` — never `0`. A `0` in an *outdated*
field reads as an all-clear on the one number a user acts on. If you add
persistence for this, it needs a column, a migration, all 11 writers, and a
staleness policy.

**Plugin and theme totals cover only sites the graph has scanned** — 312 of the
365 active rows have plugin rows, 249 have theme rows. Report the coverage
(`sitesWithPluginData` / `sitesWithThemeData`), do not imply a complete count.
Do not name such a count "indexed": in this codebase `indexed` already means
the content index (`indexRegistry`, `state === 'indexed'`), which is a
different population and the one that feeds the health scores.

**Health scoring is Local-shaped. Evaluate a factor only where its inputs exist
for that target.** `calculateScore` takes an optional factor list and
renormalises the weights **inside** the calculator;
`SiteHealth.factorsEvaluated` reports the basis, and the CLI names the factors
whenever fewer than five were used.

| target | factors | why the rest are excluded |
|---|---|---|
| local | all five | all inputs present |
| wpe | `security`, `performance` | plugin rows exist (312 of 365 active rows) |
| external | **none** unless refreshed — `score` and `status` are `null` | until a refresh runs: 0 plugin rows, no `php_version`, no `site_url` |

- `calculateMaintenance` reads `indexRegistry` keyed by Local site id and
  `calculateActivity` reads local-only event and content tables, so both score
  **0** for any remote target — 35% of the weight, enough to render a healthy
  production install `critical` with "has never been indexed" as its top issue.
- `calculateStability` counts failed `event_queue` rows. Live, `event_queue`
  holds 4 rows, **all local**, and its only writer is `HttpEventInterface.ts`,
  fed by the MU-plugin webhook that exists only on Local sites. A remote site
  can never have an event, so the factor was a constant **100 awarded for
  having no data** — the same defect as maintenance/activity with the sign
  flipped, which is why it survived a round of review.
- For an **external** host, `security` and `performance` were being scored off
  a plugin list that was, at the time, permanently empty: zero rows earned
  full plugin-hygiene credit *and* produced "No security plugin detected", in
  the same response that returns `plugins: null`. An external host with no
  collected data is therefore not scored at all. `calculateScore` **throws** on
  an empty factor list — a score over zero factors is not a low score, it is not
  a score.
- **External hosts now have a refresh mechanism** (`ExternalRefreshScheduler` /
  `nexus host refresh`, see below), so the list is widened *per host, from the
  data actually present*: `externalScoreable = hasPlugins && !!row.php_version`
  (`resolvers.ts`). A refreshed host is scored on `security` + `performance`
  like a WPE install; an unrefreshed one is still not scored. Do not widen it
  unconditionally — the gate is data presence, not host class. Note that a host
  whose PHP blocks `proc_open` never satisfies the `php_version` half (see
  below), so it stays unscored no matter how many refreshes run.

**Never default an unknown input to a plausible value to keep a score
computable.** `phpVersion: row.php_version || '8.0'` invented a version for 46
of 331 active WPE installs and the one external row, collecting 20/25 security
and 30/40 performance points for it — ~27% of a remote site's score, invented
for 14% of production installs. The calculator already has the honest path
(`scorePhpVersion(undefined)` → `PHP version unknown`). Pass `undefined`. (The
identical default on the *local* path is pre-existing and left alone: Local's
store supplies a real version there.)

**The HTTPS check reads `site_url`, not `domain`.** Domains are stored bare —
zero of 365 active rows carry a scheme — so `domain.startsWith('https')` used
to fire "Site is not using HTTPS" on 100% of sites, wrongly, including every
WPE install. `site_url` carries a real scheme (273 of 331 WPE rows: 240 https,
29 http). When neither carries a scheme the check emits **no issue and no
penalty**: unknown is not insecure.

**Names collide across sources.** `goldenecomm`, `jpp0413p`, `myloop`,
`psbtest2` and `testjppstg` each exist as both a `wpe` install and a Local
site. Any name-keyed query must constrain by `source`, and a bare-name lookup
that cannot disambiguate must decline rather than pick — see
`resolveTargetArgs`, which throws with the three disambiguated forms;
`wp_core_version`'s cached fallback, which returns nothing when a name matches
more than one row; and `search_site_content` / `describe_site_fields`, which
list the matches and refuse. An unordered `... AND name=? LIMIT 1` is not a
lookup, it is a coin toss.

**`nexus host remove` soft-deletes.** It sets `is_active = 0` and resets
`domain` back to the alias; there is no per-site delete in `GraphService`, and
the retention sweep hard-deletes inactive rows later. So **every** external
lookup needs `is_active = 1` — `sites list`, `sites get`, and
`nexusFleetSiteHealth` all did not, and a removed host kept appearing (with a
clobbered domain) after `host list` had stopped showing it. One exception is
known and deliberate: `resolveWpeGraphSite`'s bare-name fallback still has no
`is_active` filter for any source, WPE included; adding one there would also
change bare-name resolution for deactivated WPE installs and wants its own
change.

**External hosts refresh on an opt-in timer.** `ExternalRefreshScheduler`
(`src/main/startup/ExternalRefreshScheduler.ts`) collects the same L1+L2 set
`WpeRefreshScheduler` does, gated on `externalRefreshAutoEnabled` (**default
false**) with `externalRefreshIntervalHours` (default 24). `nexus host refresh
<alias>` runs one host on demand regardless of the setting.

It collects in **four batched SSH round trips**, not sixteen calls:
`buildExternalWpCliBatch` joins commands with indexed `<<<NEXUS:N>>>`
delimiters. This exists because `buildExternalSshArgs` sets no `ControlMaster`
and must not — shared hosting commonly caps `MaxSessions`, a command-line `-o`
overrides the user's own `~/.ssh/config`, and `ControlPersist` would hold a
socket open to a third party's production server. A batch's exit code is only
its last sub-command's, so **nothing may gate on it** — the indexed parse is the
source of truth.

`php_version` comes from `wp --info` (JSON first, `PHP version:` line as
fallback), because WP Engine's CAPI has no external equivalent and `wp eval` is
blocked by `REMOTE_POLICY`.

**`wp --info` requires `proc_open`, and shared hosts commonly disable it** —
`disable_functions=proc_open` makes it fail with `Cannot do 'Process::run': The
PHP functions proc_open() and/or proc_close() are disabled.` (verified against a
real registered host). On such a host `php_version` stays **permanently** NULL —
it will not eventually populate on a later refresh cycle — and because
`externalScoreable` requires it, the host is never scored. That is a known design
gap, not a data defect: NULL is the honest answer and must never become a
fabricated `'8.0'`. An alternative PHP-version source needs its own design.

**Settings written through the GraphQL mutation are reactive.**
`nexusUpdateSettings` calls `services.onSettingsUpdated?.()` after a successful
write (the same closure `src/main/index.ts` hands the IPC handler), so
`nexus settings set externalRefreshAutoEnabled true` starts the scheduler
immediately. Before that wiring, only the IPC path was reactive and the CLI —
the *only* way to set this, as no renderer UI row exists — silently required a
Local restart. A new settings-driven scheduler must be wired into
`onSettingsUpdated`, not into one caller of it.

**Batched calls get their own timeout.** `EXTERNAL_SSH_BATCH_TIMEOUT_MS` (60s)
is separate from `EXTERNAL_SSH_TIMEOUT_MS` (20s, sized for one command): Batch A
is 18 invocations and measured 22–23.5s on a real host, i.e. over the
single-command budget. `runWpCliBatch` also logs a warning naming how many
sections were lost when a batch does time out, because the honest-NULL result is
otherwise invisible until someone inspects the database.

**Anything that did not parse is written NULL, never a default**, and a host
that failed keeps its previous data — `writeExternalHostData` enforces both.
`php_version` must never fall back to `'8.0'`.

Selection filters `is_active = 1`, because `nexusHostRemove` soft-deletes and a
removed host must never be reconnected to.

**L3 (content indexing) is now implemented for external hosts.** This section
used to say it was not (Spec 4b) and that Data Completeness always showed 0%
Searchable for them — that was true until the scheduler and manual command
below shipped; it is stale now that a host has been indexed at least once.

**External hosts now content-index too, on their own opt-in schedule.**
`ExternalContentIndexScheduler` (`src/main/startup/ExternalContentIndexScheduler.ts`) is
independent of `ExternalRefreshScheduler` — a separate SSH session per host, because external
SSH has no `ControlMaster` to piggyback a combined cycle onto the way `WPESyncService.syncContent`
does for WP Engine. Gated on `externalContentIndexAutoEnabled` (**default false**) with
`externalContentIndexIntervalHours` (default 24). `nexus host index <alias>` runs one host on
demand regardless of the setting.

**Vector-store site ids strip the colon.** `ssh:<alias>` fails `SqliteVecStore`'s
`^[a-zA-Z0-9_-]+$` table-name validation; `vectorSiteId()` translates it to `ssh_<alias>` only
at that boundary. The graph `content` table and `IndexRegistry` keep the real `ssh:<alias>` id.

**Vector document metadata says `source: 'external'`, never `'wpe'`.** Copying WP Engine's
hardcoded constant here would silently mislabel every external host's indexed content — this is
the specific regression `ExternalContentIndexService`'s own test suite pins.

---

## Logging & Audit

**Two audit files**, both under `~/Library/Application Support/Local/nexus-ai/`,
both JSONL, mode 0600, both rotated:

| File | Written by | Contents |
|---|---|---|
| `operation-audit.log` | `OperationAuditLog` (`src/main/audit/OperationAuditLog.ts`) | One line per Tier 2/3 **mutating** operation. The compliance record. Written synchronously — an entry lost because the process died defeats the purpose. |
| `audit.log` | `createAuditLogger` (`src/main/mcp/audit.ts`) | In-memory buffer of **all** tiers, flushed on `before-quit` and every 5 minutes from `src/main/index.ts`. Higher volume. |

### The three writers

There are **three** places that write `operation-audit.log`, not two:

1. **`ToolRegistry.call()`** (`src/main/mcp/tool-registry.ts`) — the chokepoint
   for every MCP tool call, on both the success path and the `catch` branch.
   MCP tools, the chat assistant, the 8 GraphQL resolvers that call
   `registry.call(...)`, and agent-internal tool calls (via `NexusToolProvider`)
   all funnel through here.
2. **`AgentDispatcher.dispatch()`** (`src/main/agent-runtime/AgentDispatcher.ts`)
   — its *own separate* write. Agent-contributed tools dispatch straight to
   `dispatchFunction`/`dispatchRun` and never reach `ToolRegistry.call()`.
3. **`auditDirectOperation()`** (`src/main/audit/auditDirectOperation.ts`) — the
   entry point for mutating GraphQL resolvers and IPC handlers that call
   `services.localServices` directly and therefore reach neither chokepoint.
   That is roughly thirty paths, including arbitrary WP-CLI against production
   WP Engine installs and `DELETE /installs/{id}`.

`McpSafetyWrapper.auditLog()` (`src/main/mcp/mcp-safety-wrapper.ts`) writes
**in-memory only** — durable responsibility moved to `ToolRegistry.call()`,
which `callWithSafety()` calls beneath it; writing in both would double-log
every MCP-routed call.

### Rules for new code

- A new **tool** must route through `ToolRegistry.call()` or
  `AgentDispatcher.dispatch()`. Do not hand-instrument it — the chokepoint
  already covers it, and a second write double-logs.
- A new **mutating resolver or IPC handler** that calls `services.localServices`
  directly must call `auditDirectOperation(services, {...})` on both the success
  and failure path. Do **not** hand-roll an audit entry: thirty divergent copies
  is exactly the drift the chokepoint design exists to prevent, and it is how
  the original "audit never recorded anything" bug survived.
- Read-only paths are not audited — they would swamp the file with no
  compliance value. `auditDirectOperation` has no tier gate for the same reason:
  only call it for things that mutate, which makes them Tier 2/3 by nature.
  `nexusWpPluginList` is the worked example: it shares a module and a router
  with the audited `nexusWpCommand`, and is still not audited, for the only
  reason needed — `plugin list` cannot mutate. Volume does not enter into it
  (that resolver has exactly one caller, `src/cli/commands/wp.ts:49`); "cannot
  mutate" is sufficient on its own.
- An operation refused by `isOperationAllowed` now audits the refusal as
  `outcome: 'failure'` in `nexusWpCommand`. The resolver itself audits;
  `resolveTransport` does not.

**Naming:** `<surface>.<resource>.<action>`, lowercase, dot-separated —
`cli.wp.command`, `wpe.install.delete`, `wpe.install.copy`, `wpe.user.create`,
`ipc.wp.core.update`, `bulk.plugin.update`. `target` is the install name, site
id, or other resource identifier. (Chokepoint writes use the raw tool name, e.g.
`wpe_delete_install`, so both shapes appear in the file.)

**`cli.wp.command` entry shape:**
- `operation`: `'cli.wp.command'`
- `target`: the raw target string
- `parameters`: `{ target, command: string[], resolved?: SiteRef }`
- `resolved` (when present): `{kind:'wpe',installName}`, `{kind:'local',siteId,siteName}`,
  or `{kind:'external',alias}` — the resolved identity, so a bare-name run
  against a production install is distinguishable from a local one in the audit trail
- `outcome`: `'success' | 'failure'`
- `error` (on failure): the error message

### Coverage — and the known gaps

**Covered:** all MCP tools (chokepoint 1); all agent-contributed tools
(chokepoint 2); every mutating WPE CAPI resolver in `resolvers.ts` and
`resolvers/wpe.ts` (user/site/install/domain/SSL/SSH-key create-update-delete,
`install_copy`, cache purge, backup create); `nexusWpCommand` on local, WP
Engine and external SSH targets (it lives in `resolvers/wp-cli.ts`, which
resolvers.ts spreads rather than duplicates — its read-only sibling
`nexusWpPluginList` is deliberately not audited);
IPC `UPGRADE_WP`, `REMOVE_WP_AI` plugin deactivation, `WPE_DIAGNOSE` remote
WP-CLI, `nexus:sentinel:execute`; `BulkOperationManager` per-site plugin updates.

**Known gaps — do not assume completeness:**

- `nexusWpeDomainCheck` (`/domains/{id}/check_status`) is POST-shaped but a
  read-only DNS check, so it is deliberately not audited.
- `nexus:sentinel:execute-sandbox` runs WP-CLI against a *local* sandbox site
  (not the production install) and is not audited.
- IPC handlers that mutate local site state — `START_SITE` / `STOP_SITE`,
  `SETUP_AI`, `SWITCH_AI_PROVIDER`, `STORAGE_CLEANUP`, `RESET_AND_REFRESH`,
  `RESET_CONTENT_INDEX`, `FACTORY_RESET`, `WPE_PULL_TO_LOCAL`, and the
  saved-query / site-group CRUD channels — are not routed through
  `auditDirectOperation`. Note `WPE_PULL_TO_LOCAL` *does* write to the separate
  `AuditLogger` store (see "Three sinks" below), just not to
  `operation-audit.log`.
- `src/main/graphql/resolvers/wpe.ts` is instrumented but **currently
  unreferenced** — `createResolvers` in `resolvers.ts` wins module resolution
  for `./graphql/resolvers`. It is kept in sync so the in-progress split does
  not silently lose the audit trail when it lands.

**How this list has been wrong before.** It previously scoped the remaining gap
to "IPC handlers that mutate *local* site state" and asserted production-WPE
paths were prioritised first. `nexus:sentinel:execute` disproved that: it ran
arbitrary WP-CLI over SSH against a production install *and* raw
`rm -f /nas/content/live/<install>/<path>`, and was not audited at all. It is
audited now. Before adding a coverage claim here, grep for the surface rather
than reasoning about which wave "should" have covered it.

### Three sinks, not one

There are three durable audit writers, and they are easy to confuse:

| file | writer | location |
|---|---|---|
| `operation-audit.log` | `audit/OperationAuditLog.ts` | `nexus-ai/` (JSONL, rotated) |
| `audit.log` | `mcp/audit.ts` `createAuditLogger` | `nexus-ai/` (JSONL, rotated) |
| `nexus_audit_logs.json` | `audit/AuditLogger.ts` via `registryStorage` | Local's `userData` (1000-entry cap) |

All three redact inside `log()`. The third one did not until Aug 2026 — it wrote
`params` and `error` completely unmasked across 24 write sites, seven of which
pass the raw IPC request object through on failure. It is also hardened to 0600
after each write, best-effort, because `RegistryStorage` exposes only get/set
and cannot carry a mode.

### Redaction

`parameters`, `error` **and** `target` are redacted inside
`OperationAuditLog.log()` (via `redactParams` / `maskSecretsInString` from
`src/main/mcp/audit.ts`), never at the call site, so a new call site cannot leak
credentials by forgetting. `mcp/audit.ts`'s logger does the same for `params`,
`error` and `toolName`.

**Withholding is the primary defense; masking is the backstop.** Parameters
whose value is *executed syntax the caller composes freely* are not masked at
all — they are **withheld**, replaced by
`[WITHHELD: freeform input, 412 chars]` (arrays also carry an element count).
The list is in `FREEFORM_FIELDS` (`src/main/mcp/audit.ts`): `code`, `command`,
`commands`, `args`, `argv`, `query`, `sql`, `script`, `patch`.

Why: four review rounds found four credential-exposure paths on this branch and
**every one was a freeform command surface** — `wp_eval`'s `code`,
`nexusWpCommand`'s argv, `SentinelExecutor`'s command strings. Not one was a
structured tool parameter. Masking arbitrary command syntax correctly is a
losing game; the syntax is no longer written.

- Matched by **parameter name**, inside the shared redaction walk, so all three
  sinks get it and no call site can leak by forgetting. Both dispatch
  chokepoints spread `...args` verbatim, so a tool-scoped list would silently
  miss every tool added later.
- Names are normalised (lowercased, `_`/`-` stripped). Matching is **exact, not
  tokenised** — tokenising `code` would withhold `statusCode` and `zipCode`.
- **Withheld, not deleted.** A vanished key reads as an operation that took no
  arguments. Length is kept; a content hash deliberately is **not** — the
  `operation` name pins the command template and the char count pins the
  length, so a short digest would be a guess-confirmation oracle against
  exactly the credential being withheld.
- **Not** on the list, and left to masking: `search`/`replace`,
  `title`/`content`, `prompt`/`system`, `input` (`wp_run_ability` — a
  structured bag, still redacted key by key), `value`, `option`. These are
  structured parameters or body text, not composed syntax.
- Adding a new freeform surface? **Add its parameter name to
  `FREEFORM_FIELDS`.** The masking layers below are the net if you forget, but
  they are the net, not the plan.

Three masking layers remain underneath, unchanged in role:

- **Key-name** — substring matches (`password`, `token`, `secret`, `api_key`,
  `access_key`, `private_key`, `credential`, `authorization`, `bearer`,
  `signature`) plus token matches for short words that are unsafe as substrings
  (`pass`, `pwd`, `auth`, `salt`, `cookie`, `session`). Token matching is why
  `author` and `monkey` are no longer redacted as collateral.
  **`key`, `keys`, `certificate` and `cert` are deliberately NOT key-name
  matches.** Tokenizing `key` inverted the log's meaning rather than protecting
  anything: `{key: 'wpeOperationPermissions.wpcli.production', value: 'true'}`
  logged the *name* as `[REDACTED]` and kept the value. It also destroyed SSH
  **public** keys and `{sshKeyId}`, where "which key was authorized or revoked"
  is the entire point of the entry. Names that genuinely signal a secret still
  match; value shape decides the rest.
- **Value-shape** — runs on every string regardless of key name: PEM blocks,
  `sk-`/`sk_`/`rk_`/`pk_`/`key-` vendor keys, `ghp_`/`github_pat_`,
  AWS/Google/Slack keys, `Bearer` headers, `user:pass@host` connection strings,
  inline `password=` assignments, PHP `define('DB_PASSWORD', '…')`, opaque
  alphanumeric runs of **20+** chars, and password-shaped tokens carrying all
  four character classes. Strings are **not** truncated — rotation bounds file
  size instead.
- **Positional** — a credential is often a *separate token* from the name that
  identifies it, which neither layer above can see. Both argv arrays
  (`['config','set','DB_PASSWORD','x']`) and whole command strings
  (`'wp config set DB_PASSWORD x'`) mask the token following a sensitive name,
  plus separated flags (`--user_pass x`). The name is preserved.
  Two shape-specific notes:
  - Attached `-p<secret>` works on **argv arrays only** — it is an element-wise
    rule in `redactArray`, and there is no command-string equivalent. (This
    used to be documented as covering "both argv arrays and whole command
    strings"; it never did.) It also no longer fires on every `-p…` element:
    `-path`, `-post-type` and `-p1` are left alone, at the cost of missing an
    all-lowercase-alphabetic password attached to `-p`.
  - Positional masking is armed only by a **bare token**, never by a whole
    command line. An element containing a space is a command line, not a name;
    arming on one destroyed the element that followed it.

**The 20-char threshold is measured, not guessed.** It was 40, which only ever
caught SHA-1-length hashes: ten of ten realistic credentials in the 16–36 char
band were written to disk verbatim. Lowering it trades false negatives against
false positives, so if you change it, re-measure **both** directions — the
must-mask corpus and the must-survive corpus are both encoded as tests in
`tests/main/audit.test.ts` (`opaque-run masking — must-mask/must-survive
corpus`). Known and accepted false positives: **any** unbroken 20+ character
alphanumeric run carrying at least one letter, one digit and 8 or more distinct
characters is masked — git SHAs, sha256 checksums, and identifiers of any
casing, including all-lowercase (`acmeprod2026staging1`), not only "long
CamelCase identifiers containing digits" as this previously claimed.

That false-positive class is why `target` and `install_name` are exempted from
the opaque-run rule when the **whole** value is a legal WPE install name
(`[a-z0-9-]`, ≤20 chars — `create-install.ts` rejects 21+, so exactly 20 is
legal and reachable). Without the carve-out a legal install name redacted the
one field saying which production install was operated on. Every other pattern
still runs on those fields, and a value that is not a legal install name is
masked as before.

Value-shape matching exists because key-name matching **structurally cannot**
protect free-text payloads: `error` is raw tool output from a failed WP-CLI or
CAPI call, and any freeform field not yet on `FREEFORM_FIELDS` reaches disk
through it. (`wp_eval`'s `code` was the original motivating example; it is now
withheld outright rather than masked.)

Tier 1 (read-only) is deliberately not written to disk. Tier 2 is the **default**
tier for any tool absent from `TIER_OVERRIDES` (`src/main/mcp/safety.ts:223`) —
`getToolSafety()` falls back to `TIER_OVERRIDES[toolName] ?? 2` — so new tools are
audited by default unless explicitly marked Tier 1.

**Never throw from an audit path.** `OperationAuditLog.log()` builds the entry
inside its try (`randomUUID()` and the recursive redaction walk can both throw);
`redactValue` carries a `WeakSet` so cyclic args from agent code terminate; and
the audit blocks at both chokepoints are individually wrapped so an audit fault
cannot convert a successful call into an error result.

**Rotation:** all durable writers use `src/main/logging/rotate.ts`
(`rotateIfNeeded`, `pruneOldFiles`). Default 5 MiB x 3 generations
(`DEFAULT_MAX_BYTES` / `DEFAULT_KEEP`). Per-run agent logs and reports
(`run-*.log`, `run-*-report.md`) are pruned to the 20 most recent per agent in
`buildAgentContext.ts`; `agent.log`, the main process log, `operation-audit.log`
and `audit.log` are all rotated the same way.

`OperationAuditLog.list()` reads the rotated generations (`.{keep}` … `.1`)
before the live file, so `export()` genuinely exports everything on disk.
Reading only `logPath` would silently amputate the compliance record at the
current generation boundary.

**`export()` destinations are validated.** It writes the complete de-rotated
trail to a caller-supplied path, and a path under `~/Local Sites/<site>/app/
public/` is served over HTTP by nginx. `webServedReason()` rejects Local site
directories, `app/public`, `wp-content`, `public_html`, `htdocs`, `www` and
`public`. The file is also `chmod`ed to 0600 *after* the write: `writeFileSync`'s
`mode` applies only at creation, so exporting over an existing 0644 file left it
0644.

**Historical:** `services.operationAuditLog` was declared in the service types but
never assigned, so `?.log()` calls silently no-opped and no audit file was ever
created on any machine. `mcp/audit.ts`'s `AuditLogger.flush()` was likewise never
called in production — no `before-quit` handler, no periodic flush — so its
in-memory buffer was discarded on every exit. Both are now fixed, wired in
`src/main/index.ts`. **Lesson: if you add a new service handle, verify it is
actually assigned, not merely declared** — a declared-but-unassigned optional
field fails silently (the `?.` just no-ops) instead of throwing, so nothing
surfaces the bug until someone goes looking for the file it should have created.

This section previously claimed the two chokepoints "cover everything and cannot
drift". That was false — it missed the ~30 direct `services.localServices` call
sites, which is why the "Known gaps" list above is now mandatory. If you close a
gap, delete it from the list; if you find a new one, add it. A false
completeness claim here is worse than no claim at all.

---

## Known Pitfalls

- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; `siteStarted` races MySQL startup. Use filesystem checks in Node.js, not WP-CLI.
- **`wpeAllowedEnvironments` is dead code — it blocks nothing.** This entry used to
  say it "blocks SSH/WP-CLI on excluded environments, default excludes production."
  That is false: all four exported functions of
  `src/main/mcp/utils/environment-filter.ts` have **zero callers** outside their own
  test file. It was superseded by the granular permissions — `types.ts:299` says
  "Replaces wpeAllowedEnvironments", `schemas.ts:77` marks it "legacy — kept for
  migration", and `operation-permissions.ts:133` is the one-way converter.
  The gate that actually runs is `isOperationAllowed` against
  `remoteOperationPermissions`, whose defaults
  (`operation-permissions.ts:22`) are: `wpcli_read` **allowed on every
  environment including production**; `wpcli` and `push` refused on production;
  `delete` refused everywhere. So on a production install, reads work and writes
  do not — SSH is *not* off wholesale. Delete `environment-filter.ts` or wire it
  up; do not cite it as a live protection.
