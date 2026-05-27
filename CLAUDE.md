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
- Local uses Electron Node.js (MODULE_VERSION 136)
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
- better-sqlite3: 11.10.0 (don't change this)
- Electron (Local): 37.8.0
- System Node: 22.16.0

---

## Jest & Open Handles

**`npm test` exits cleanly.** `jest.config.js` has `forceExit: true` intentionally.

After every test run you'll see:
```
Jest has detected the following 1 open handle potentially keeping Jest from exiting:
  ●  CustomGC  (from @lancedb/lancedb)
```

This is **expected and unfixable at the app level.** LanceDB's Rust native module registers a background GC thread with Node's event loop on import. There is no API to shut it down. `forceExit: true` is the correct fix — `detectOpenHandles: true` keeps it visible so new handles don't get silently masked.

**See:** `docs/NATIVE_MODULES.md#lancedb-customgc-open-handle` for details.

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

## Known Pitfalls

- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; `siteStarted` races MySQL startup. Use filesystem checks in Node.js, not WP-CLI.
- `wpeAllowedEnvironments` blocks SSH/WP-CLI on excluded environments — default excludes production. CAPI operations and push/pull are NOT affected. See `src/main/mcp/utils/environment-filter.ts`.
