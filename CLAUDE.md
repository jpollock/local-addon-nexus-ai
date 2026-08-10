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

## Agent schedules — the manifest is the default, an explicit pick overrides

**There are two sources for an agent's cron and they disagreed silently.**
`AgentScheduler` scheduled the expressions in the agent's own manifest; the
Preferences cadence picker wrote `cadence` into `agent-settings.json`, where
**nothing in the main process ever read it**. All 28 references were renderer
labels. Measured live 2026-08-09: `auth-probe` displayed *Hourly* and fired
every two minutes; `seo-insights` displayed *Every 15 minutes* and fired
Mondays at 07:00. The schedule a user set was never the schedule that ran.

- **`resolveAgentCron` (`src/main/agent-runtime/schedule.ts`) is the rule.**
  Manifest by default; a cadence the user explicitly picked wins.
- **`cadenceSetAt` is what makes a pick explicit, and it is load-bearing.**
  `AgentStore.getDefaultSettings` seeds a fifteen-minute cadence into every
  agent the renderer has never seen, so a stored `cadence` is **not** evidence
  anyone chose it. Honouring stored values wholesale would have moved
  `seo-insights` from weekly to every fifteen minutes — 672× more often — and
  `web-analytics` 28× more often, on values the user never picked. Only the
  timestamp, written by the picker's own handler, grants a cadence authority.
- **The rule exists twice, and a test pins the copies together.**
  `resolveAgentCron` (main) and `effectiveCadenceExpression`
  (`src/renderer/components/agents/effectiveCadence.ts`) live in bundles that
  cannot import each other; `tests/unit/renderer/effectiveCadence.test.ts`
  runs both over a shared case table. Same pattern as `normalizeLogPrefix`.
- **A picked cadence takes effect immediately.** `AGENT_SETTINGS_UPDATE`
  re-registers the agent (`nexusServices.agentScheduler`, exposed for exactly
  this) rather than waiting for a restart — a schedule that needs a restart is
  the same class of dead setting as the picker that nothing read. It
  re-registers only when `cadence`/`cadenceSetAt` actually changed:
  `register()` stops and destroys the running task first, so a needless call
  is a real interruption.
- **An unparseable saved cadence falls back to the manifest and logs why.**
  Never leave an agent unscheduled because a stored expression went bad —
  silence is indistinguishable from a broken agent, and this is the schedule
  for something that runs against production.
- **An agent with no cron trigger is never given one.** No cron in the
  manifest means it was not built to run on a timer; the seeded cadence must
  not conjure a schedule for it.
- The registration log line names the source
  (`registered "x" with cron "…" (source=user|manifest)`) so a surprising
  schedule is explainable without opening settings.

**The settings cache, not the file, is what the gate and the scheduler read.**
`agent-settings.json` is loaded into `__agentSettingsCache` once, inside
`registerIpcHandlers`, and updated thereafter only by the
`AGENT_SETTINGS_UPDATE` IPC channel. Editing the file on disk changes nothing
until a restart — verified live: restoring a restored `enabled: true` to disk
left the running process refusing the agent for another half hour. There is no
GraphQL mutation for agent settings, so the CLI cannot change them either.

---

## WP AI Plugin Compatibility (wp-plugins/ai-provider-for-local-gateway)

**Connector approval bypass**: The MU plugin template (`src/main/ai-gateway/mu-plugin-template.ts`) injects an `option_wpai_connector_approvals` filter that pre-approves `ai/ai.php`, `nexus-ai-connector/nexus-ai-connector.php`, and `ai-provider-for-local-gateway/plugin.php` for the `local-gateway` connector. This is intentional for local development — the gateway token is the auth layer. Do not remove without understanding the connector-approval experiment.

**Model capabilities**: `LocalGatewayModelMetadataDirectory` must declare `OptionEnum::outputSchema()` for JSON-response abilities (editorial notes, etc.) and `OptionEnum::functionDeclarations()` for tool-use abilities. Missing options cause `is_supported_for_text_generation()` to silently return false.

**MU plugin no longer sets WP_DEBUG**: Removed in May 2026. Previously forced `WP_DEBUG_LOG=true` on every managed site, which made `wp-content/debug.log` grow unbounded and exposed PHP errors via HTTP.

---

## Logging & Audit

### The structured event log — diagnostic, not the compliance record

Separate from the audit files below, and do not confuse them. Under
`~/Library/Application Support/Local/nexus-ai/logs/`:
`nexus-YYYY-MM-DD.log` (everything) plus `agents/<source>-YYYY-MM-DD.log`
(one agent's slice, byte-identical lines). Written by `EventLog`
(`src/main/logging/eventLog.ts`), mode 0600, rotated by size per day.

Answers "did my agent run, what did it do, and why not" — the case that
previously produced **zero bytes anywhere**. `grep run=<id>` reassembles a
whole run across both streams.

- **Line format:** `HH:MM:SS.mmm LEVEL source [run=<id>] [event] [k=v…]  [message]`
  — message separated by **two spaces**, everything else by one. The level is
  **not** padded: padding put two spaces after `INFO`/`WARN` and one after
  `DEBUG`/`ERROR`, so `awk -F'  '` returned a different field per level. Do
  not reintroduce the pad without changing the delimiter.
- **Times and filenames are LOCAL, not UTC.** They were `toISOString()`, which
  made `tail -f nexus-$(date +%F).log` follow a dead file for the seven hours
  a day PDT is behind UTC — succeeding silently, showing nothing. Every test
  injected a fixed UTC clock and derived expectations the same way the code
  did, so the suite was internally consistent and externally wrong;
  `tests/unit/logging/simulatedZone.ts` now simulates a zone at the `Date` so
  the assertions fail against a UTC implementation on any machine.
- **Closed vocabulary, one word one shape:** `run.start`, `run.end`,
  `run.skip`, `phase`, `action`, `site`, `finding`, `mutation`, `llm.call`,
  `llm.error`, `tool.call`, `credential`. `action` and `site` are separate from
  `phase` deliberately — three field shapes under one word gives away the only
  property a closed vocabulary has.
- **`redactParams` owns value masking; `renderValue` adds key context.**
  Masking a second time without the key defeated the `target`/`install_name`
  carve-out and redacted the one field naming which production install was
  changed. Field *keys* are masked and quoted too — nothing else inspects them.
- **Logging must never throw**, and does not: `formatLine`, `pathsFor` and
  `write` are each guarded, verified by execution against pathological
  `toString`, invalid dates and a null event. A dropped event still emits a
  line saying so — a swallowed event is a lost event.
- **`mutation` events are emitted by the runtime, not by agents.**
  `NexusToolProvider.ts:92` emits `event: 'mutation'` for Tier 2/3 tool calls
  that complete. `ctx.log.mutation()` exists but has no agent callers — agents
  forgot to call it, which is exactly why the runtime emits it instead.
- **`agent_runs.run_id` is written but not read back.** The column is populated
  (`AgentRunner.ts` writes it), but `getLastRun()` and `getRunHistory()` in
  `AgentStateStore.ts` both return types (`AgentResult`, `AgentRunRow`) that
  exclude it — the `SELECT *` fetches it, the mapping drops it. The UI's Run
  Now broadcasts the runner's real `r_…` ids (`runIds`, collected via
  `runNowIds.ts` and rendered in `RunDrawer.tsx`), so a user can copy one, but
  the historical runs list has no id column.
- **`localDay` exists twice** — `src/main/logging/eventLog.ts` and
  `src/renderer/components/localDay.ts` — pinned by a shared case table in
  `tests/unit/renderer/localDay.test.ts`. Main and renderer do not share a
  bundle, so the function is duplicated. This mirrors the existing
  `resolveAgentCron` / `effectiveCadenceExpression` pattern already
  documented above.
- **`run.skip` is emitted at most once per process, per agent, per reason,
  per trigger kind, per local day.** Keyed by `agentId:YYYY-MM-DD:kind` in
  `ipc-handlers.ts`'s `lastSkipReason` map (in-memory). A user grepping today's
  log for a long-disabled agent finds exactly one line per trigger kind, not one
  per tick. The day-keying means each log file (which is also named by local
  day) contains at least one line explaining why the agent didn't run (when no
  rotations have occurred), so a user on Thursday asking "why didn't this run
  today" finds the answer in today's file, not only in Monday's. A process
  restart re-arms every agent's slot.
- **`run.end` gains a `failedCalls` field only when non-zero**, and `status`
  is unchanged when tool calls failed. Reasoning: an agent that caught a
  failure and carried on did succeed. The presence of `failedCalls` means
  some tools failed, but the agent handled it — the run as a whole did not
  fail.

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
- An operation refused by `isOperationAllowed` writes nothing, because nothing
  happened.

**Naming:** `<surface>.<resource>.<action>`, lowercase, dot-separated —
`cli.wp.command`, `wpe.install.delete`, `wpe.install.copy`, `wpe.user.create`,
`ipc.wp.core.update`, `bulk.plugin.update`. `target` is the install name, site
id, or other resource identifier. (Chokepoint writes use the raw tool name, e.g.
`wpe_delete_install`, so both shapes appear in the file.)

### Coverage — and the known gaps

**Covered:** all MCP tools (chokepoint 1); all agent-contributed tools
(chokepoint 2); every mutating WPE CAPI resolver in `resolvers.ts` and
`resolvers/wpe.ts` (user/site/install/domain/SSL/SSH-key create-update-delete,
`install_copy`, cache purge, backup create); `nexusWpCommand` local and remote;
IPC `UPGRADE_WP`, `REMOVE_WP_AI` plugin deactivation, `WPE_DIAGNOSE` remote
WP-CLI, `nexus:sentinel:execute`; `BulkOperationManager` per-site plugin updates.

**Known gaps — do not assume completeness:**

- **Run id reaches `operation-audit.log` from only ONE of three audit
  writers.** `ToolRegistry.call()` passes `runId` through; `AgentDispatcher.
  dispatch()` does not (and that is a real gap — agent-contributed tools are
  agent runs); `auditDirectOperation()` does not either (mostly honest — those
  are GraphQL/IPC paths that generally are not agent runs). The join between
  the compliance record and the diagnostic log is therefore incomplete.
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

## log-processor — one bucket, joined by install name

**WP Engine writes every install of an account into ONE flat S3 prefix** —
`s3://<bucket>/wpe_logs/nginx/` — and separates them by filename:

```
20260807-0016-jeremypollock2.apachestyle.log.gz
202607210625-localwpe.apachestyle.log.gz          ← second live shape: date+hhmm concatenated
```

There is no per-site prefix. Asking a user for one asks them to invent a fact
that does not exist, which is why `connect_log_source`, `disconnect_log_source`
and `set_log_processing` are gone; `set_log_bucket` + `rescan_log_bucket`
replace them, and the whole design rationale (including two models that were
built and rejected) is in the designer's `handoff_log_sources_v3/DECISIONS.md`.

- **`parseInstallIdFromKey` (`access-logs.ts`) is the join.** Both filename
  shapes above are live in real buckets; a parser handling only one silently
  drops every object of the other, which reads as "that install has no logs".
  It returns `null` rather than guessing — a wrong guess folds one install's
  traffic into another's aggregates.
- **Only `*.apachestyle.log.gz` is ingested.** `*.access.log.gz` sit in the same
  folder and are roughly half the objects, so every count shown to a user must
  say **apache-style** or the number reads as data loss.
- **The unit of ingestion work is a FILE-DATE, not a site.** `runBatchSync`
  lists `prefix + YYYYMMDD` once and routes each object to a site by its parsed
  filename. The per-site `runSync` it replaces listed that same shared prefix
  and attributed **every** apache-style object to whichever single site the call
  was made for — so aggregates were cross-contaminated across installs, and the
  same objects were downloaded once per site in scope. `fetch_log_window` had
  the identical defect and is fixed the same way.
- **Aggregates and the ledger are written together or not at all.** A site whose
  stream errored keeps its previous rows and stays un-ledgered. Saving a partial
  fold while withholding the ledger entry — what this used to do — double-counts
  every line of that date on the retry.
- **The migration off the per-site `sources` table wipes `aggregates` and
  `ledger`** (`migrateFromPerSiteSources`, guarded by a `meta` marker so it runs
  once). Not housekeeping: every row was computed by the mis-attributing sync.
  Re-pointing at a different bucket wipes them too, because the ledger records
  which file-dates were processed *against a specific bucket*.
- **`scope.siteIds` is the only "which installs run" list.** The switch on each
  row of the agent's Sites tab writes it directly; there is no separate sources
  table and no basket-style scope picker for this agent. An install with no
  objects cannot be switched on, which is why no "in scope but nothing to read"
  warning exists anywhere — the state is unreachable.
- **The Sites list defaults to installs with logs — see BEHAVIOR §4. A
  500-install account must never render 500 rows.** 500 installs with three in
  the bucket is the normal shape, not the edge case. The fleet stays reachable
  through the `All installs` filter and through search, which covers every
  install regardless of the active filter so a missing site is explained rather
  than absent. Rows page at 25; filter counts are derived per render, never
  cached; bulk switching is offered only where "all" is unambiguous (the `With
  logs` view, no active search, something still off).
- **Every count is derived, never independently computed.** Tab badge, header
  line, footnote, Run Now enabled state and Run Now's prefill all come from
  `runnableSiteIds(deriveLogSiteRows(...))` (`logSourcesModel.ts`). Each
  contradiction found in design review came from a consumer keeping its own copy.
- **Open question, not yet answered:** whether WP Engine ever truncates the
  install-name segment in a filename (install names cap at 14 chars, so
  `theawfulproduc` may be the id itself rather than a shortened form). The join
  assumes the segment **is** the id. If that proves false it needs a real
  mapping table, not fuzzy matching.

---

## Known Pitfalls

- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; `siteStarted` races MySQL startup. Use filesystem checks in Node.js, not WP-CLI.
- `wpeAllowedEnvironments` blocks SSH/WP-CLI on excluded environments — default excludes production. CAPI operations and push/pull are NOT affected. See `src/main/mcp/utils/environment-filter.ts`.
