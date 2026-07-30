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

## Logging & Audit

**Durable audit trail:** `~/Library/Application Support/Local/nexus-ai/operation-audit.log`
— JSONL, mode 0600, one line per Tier 2/3 operation.

**The durable write lives in `ToolRegistry.call()`** (`src/main/mcp/tool-registry.ts`),
on both the success path and the `catch` branch. This is the single funnel that MCP
tools, the chat assistant, CLI/GraphQL resolvers, and agent-internal tool calls
(dispatched via `NexusToolProvider`) all pass through, so it is the one place that
owns the durable write.

`AgentDispatcher.dispatch()` (`src/main/agent-runtime/AgentDispatcher.ts`) has its
*own separate* durable write. Agent-contributed tools dispatch straight to
`dispatchFunction`/`dispatchRun` and never reach `ToolRegistry.call()`, so without
this second write agent tool calls would go unaudited.

`McpSafetyWrapper.auditLog()` (`src/main/mcp/mcp-safety-wrapper.ts`) no longer
writes durably — that responsibility moved to `ToolRegistry.call()` since
`callWithSafety()` calls `this.registry.call(...)` beneath it, and writing there
too would double-log every MCP-routed call. `McpSafetyWrapper.auditLog()` still
appends to the in-memory `auditLogger` (the `RegistryStorage`-backed one used for
live introspection via `getEntries()`) — that part is unchanged.

**Do not hand-instrument individual tools or handlers** — the two chokepoints
above (`ToolRegistry.call()` and `AgentDispatcher.dispatch()`) cover everything
and cannot drift. Any new tool-dispatch surface must route through one of these
two funnels or it will silently go unaudited.

Tier 1 (read-only) is deliberately not written to disk. Tier 2 is the **default**
tier for any tool absent from `TIER_OVERRIDES` (`src/main/mcp/safety.ts:223`) —
`getToolSafety()` falls back to `TIER_OVERRIDES[toolName] ?? 2` — so new tools are
audited by default unless explicitly marked Tier 1.

`parameters` is redacted inside `OperationAuditLog.log()` (via `redactParams` from
`src/main/mcp/audit.ts`), never at the call site, so a new call site cannot leak
credentials by forgetting to redact.

**Rotation:** all durable writers use `src/main/logging/rotate.ts`
(`rotateIfNeeded`, `pruneOldFiles`). Default 5 MiB x 3 generations
(`DEFAULT_MAX_BYTES` / `DEFAULT_KEEP`). Per-run agent logs and reports
(`run-*.log`, `run-*-report.md`) are pruned to the 20 most recent per agent in
`buildAgentContext.ts`; `agent.log` itself and the main process log are rotated
the same way.

**Historical:** `services.operationAuditLog` was declared in the service types but
never assigned, so `?.log()` calls silently no-opped and no audit file was ever
created on any machine. `mcp/audit.ts`'s `AuditLogger.flush()` was likewise never
called in production — no `before-quit` handler, no periodic flush — so its
in-memory buffer was discarded on every exit. Both are now fixed, wired in
`src/main/index.ts`. **Lesson: if you add a new service handle, verify it is
actually assigned, not merely declared** — a declared-but-unassigned optional
field fails silently (the `?.` just no-ops) instead of throwing, so nothing
surfaces the bug until someone goes looking for the file it should have created.

---

## Known Pitfalls

- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; `siteStarted` races MySQL startup. Use filesystem checks in Node.js, not WP-CLI.
- `wpeAllowedEnvironments` blocks SSH/WP-CLI on excluded environments — default excludes production. CAPI operations and push/pull are NOT affected. See `src/main/mcp/utils/environment-filter.ts`.
