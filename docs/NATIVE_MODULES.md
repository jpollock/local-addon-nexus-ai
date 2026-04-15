# Native Module Compilation (better-sqlite3)

## TL;DR - Manual Rebuild Required

**For developers:** Tests work after `npm install`. Local requires `npm run rebuild`.
**Manual rebuild IS required** when switching between tests and Local.

---

## How It Works

The addon uses `better-sqlite3@11.10.0`, which has this install script:

```json
"install": "prebuild-install || node-gyp rebuild"
```

### When Running Tests (System Node.js)

```bash
npm install  # Compiles for system Node (v22, MODULE_VERSION 127)
npm test     # ✅ Works
```

### When Loading in Local (Electron Node.js)

```bash
# For development addons loaded from disk:
# Local does NOT run npm install — uses existing node_modules
# You must manually rebuild:

npm run rebuild    # Runs: electron-rebuild -v 37.8.0 -f -w better-sqlite3
                   # Compiles against Electron headers (MODULE_VERSION 136)
# ✅ Now works in Local
```

**Important:** Local only runs `npm install` for published addons, NOT for local development addons loaded from disk. Manual rebuild required.

## Why You Need Manual Rebuild

better-sqlite3 compiles native code for the Node.js version that's running:

```bash
npm install       # Runs in system Node → MODULE_VERSION 127 (for tests)
npm run rebuild   # Uses electron-rebuild → MODULE_VERSION 136 (for Local)
```

The two binaries are incompatible:
- Tests need MODULE_VERSION 127
- Local needs MODULE_VERSION 136
- **You must rebuild when switching contexts**

## Development Workflow

### Normal Development (What You Actually Do)

```bash
git clone repo
npm install      # Compiles for system Node
npm test         # ✅ Works
npm run build    # ✅ Compiles TypeScript

# Before loading in Local:
npm run rebuild  # ✅ Recompile for Electron

# Load addon in Local app
# ✅ Addon works
```

**Manual rebuild IS needed** when switching from tests to Local.

### If You See The Error In Local

If you see this error when loading in Local:
```
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 136.
```

It means **you forgot to run `npm run rebuild`**. Fix:

1. **Run the rebuild**: `npm run rebuild`
2. **Restart Local** and reload addon
3. **If rebuild fails**: Check Xcode Command Line Tools (`xcode-select --install`)
4. **If still fails**: Delete `node_modules`, run `npm install`, then `npm run rebuild`

## For CI/CD

### Unit/Integration Tests
```bash
npm install  # Uses system Node
npm test     # ✅ Works
```

No special handling needed.

### E2E Tests (In Local)
Let Local handle the rebuild - same as manual testing.

## Troubleshooting

### Tests fail with "better_sqlite3.node not found"

System Node compilation failed:

```bash
npm rebuild better-sqlite3
npm test
```

### Addon fails to load in Local

You need to rebuild for Electron:

1. Run `npm run rebuild`
2. Restart Local and reload addon
3. Ensure Xcode Command Line Tools installed: `xcode-select --install`
4. Delete addon's `node_modules`, run `npm install`, then `npm run rebuild`

### "npm install" hangs or fails with C++ errors

If `npm install` tries to run electron-rebuild and fails:

1. Check package.json for `postinstall` hook — **remove it** (breaks npm install)
2. Run `npm install --legacy-peer-deps` to work around peer dependency conflicts
3. After install succeeds, run `npm run rebuild` manually

## Why better-sqlite3 11.10.0?

- Has `prebuild-install` fallback to `node-gyp rebuild`
- Works with both system Node (tests) and Electron (Local)
- Maintained, good performance
- Prebuilds exist for many platforms (just not Electron 37.8.0)

## Version Info

**Current Setup:**
- better-sqlite3: **11.10.0** ← Keep this version
- Electron (Local): 37.8.0
- System Node: 22.16.0

**Don't downgrade better-sqlite3** - older versions lack the install script that makes this work.

---

## LanceDB CustomGC Open Handle

### What you'll see

After every `npm test` run:

```
Jest has detected the following 1 open handle potentially keeping Jest from exiting:

  ●  CustomGC

    > 1 | import * as lancedb from '@lancedb/lancedb';
        | ^
      at Runtime._loadModule (node_modules/jest-runtime/build/index.js)
      at Object.<anonymous> (node_modules/@lancedb/lancedb/dist/native.js:145:41)
```

### Why it happens

LanceDB ships a native Rust binary (via napi-rs). When Node.js `require()`s the module,
the Rust layer registers a background garbage-collector thread with Node's event loop.
This thread (`CustomGC`) is responsible for running Rust destructors when JS objects
that wrap Rust values get garbage collected.

The thread is registered **at module import time** — not when a connection is opened —
and lives for the **entire lifetime of the process**. There is no public API to shut it
down. Node.js does not support unloading native modules once they are loaded.

### Why Jest hangs without `forceExit`

Jest uses `async_hooks` (`--detectOpenHandles`) to track resources that keep the event
loop alive. `CustomGC` is registered as an async_hooks resource, so Jest sees it as an
open handle and waits for it to close before exiting. Since it never closes, Jest hangs
indefinitely.

### The fix (already applied)

`jest.config.js` has three settings that together solve this:

```js
testTimeout: 30000,      // individual tests can't hang indefinitely
detectOpenHandles: true, // keep CustomGC visible — don't silently mask it
forceExit: true,         // exit after tests complete regardless of open handles
```

`forceExit` is the direct fix. `detectOpenHandles` is kept so that if any *new* handles
appear in the future (ones that ARE fixable), they show up in output rather than being
silently swallowed.

### What "fixed" looks like

After a clean test run you'll see exactly one handle — `CustomGC` from LanceDB. If you
ever see additional handles (e.g. `Timeout`, `TCPSERVERWRAP`), those are real bugs worth
fixing.

### Upstream

There is no LanceDB issue filed for this yet. If a `shutdown()` or `close()` API is
added to `@lancedb/lancedb` that deregisters the GC thread, `forceExit` can be removed.

---

**Last Updated:** 2026-04-15
**Status:** ✅ Working (tests + Local)
**Action Required:** Run `npm run rebuild` after `npm install` before loading in Local

**Critical:** NO postinstall hook — it breaks `npm install` from shell
