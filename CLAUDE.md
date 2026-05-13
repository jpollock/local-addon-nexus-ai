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

## Known Pitfalls

- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; `siteStarted` races MySQL startup. Use filesystem checks in Node.js, not WP-CLI.
