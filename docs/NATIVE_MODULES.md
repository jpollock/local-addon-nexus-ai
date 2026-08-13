# Native Module Compilation (better-sqlite3)

## TL;DR — Manual Rebuild Required When Switching Contexts

- **For tests:** `npm install` (or `npm ci`) compiles `better-sqlite3` for your **system Node**.
- **For Local:** run **`npm run rebuild`** to recompile it for **Electron**.
- The two binaries are incompatible — rebuild when switching between running tests and loading in Local.

`npm run rebuild` self-heals the node-abi registry (see below), so a fresh clone can build for
Local without any manual node_modules editing.

---

## The versions that matter

| Thing | Value |
|---|---|
| `better-sqlite3` | **12.11.1** (don't change — see below) |
| Electron (Local) | **42.2.0**, ABI (`NODE_MODULE_VERSION`) **146** |
| electron-rebuild target | **42.2.0** |
| System Node (tests) | whatever you run; ABI depends on version (Node 22 → 127, Node 25 → 141, …) |

better-sqlite3 compiles native code for the runtime that builds it:

```bash
npm ci            # compiles for system Node  → tests work
npm run rebuild   # recompiles for Electron 42.2.0 (ABI 146) → Local works
```

---

## The node-abi patch (now automated)

`electron-rebuild`'s bundled `node-abi` does not yet know about **Electron 42.2.0**, so a plain
`electron-rebuild` fails on the unknown ABI. The fix is to add a `42.2.0` entry (ABI `146`,
`"future": true`, placed **last**) to every `node-abi/abi_registry.json` under `node_modules` —
and every `npm install` / `npm ci` restores the unpatched registry.

This used to be a hand-run one-liner documented only in `CLAUDE.md` (which a fresh clone had no
way to know). It is now **`scripts/patch-node-abi.js`**, run automatically as the first half of
`npm run rebuild`:

```jsonc
"rebuild": "node scripts/patch-node-abi.js && electron-rebuild -v 42.2.0 -f -w better-sqlite3"
```

The script is idempotent and finds **all** node-abi copies (it currently lives under `node-abi/`,
`electron-rebuild/`, and `prebuild-install/`; the set drifts across installs). `"future": true` is
required, not `false` — node-abi's boundary check needs the newest future entry to be last.

> Do **not** add this as a `postinstall` hook — running electron-rebuild during `npm install`
> breaks a shell `npm install` (wrong Node context). Keep it inside `rebuild`.

---

## Development workflow

```bash
git clone <repo>
npm ci             # compiles better-sqlite3 for system Node
npm run test:ci    # ✅ tests run
npm run build      # ✅ compiles TypeScript

# before loading in Local:
npm run rebuild    # patches node-abi + recompiles better-sqlite3 for Electron 42.2.0
# load the addon in Local → ✅ works
```

Switching back to running tests? `npm rebuild better-sqlite3` (or `npm ci`) recompiles it for
system Node again.

---

## Troubleshooting

### In Local: `NODE_MODULE_VERSION` mismatch

```
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 141 (or 127). This version of Node.js requires NODE_MODULE_VERSION 146.
```

better-sqlite3 is built for your **system Node**, but Local (Electron) needs **146**. Fix:

1. `npm run rebuild`
2. Restart Local and reload the addon.
3. If the rebuild fails to compile: ensure Xcode Command Line Tools are installed
   (`xcode-select --install`).

### In tests: `NODE_MODULE_VERSION 146 … requires NODE_MODULE_VERSION <your node>`

The reverse — better-sqlite3 is built for **Electron** but you're running tests under system Node
(this is the state right after `npm run rebuild`). Fix:

```bash
npm rebuild better-sqlite3   # recompile for system Node
```

### `npm install` hangs or fails with C++ errors

1. Check `package.json` for a `postinstall` hook — there must **not** be one (it breaks
   `npm install`).
2. Use `npm ci --legacy-peer-deps` (or `npm install --legacy-peer-deps`).
3. After install succeeds, run `npm run rebuild` for Local.

---

## Why better-sqlite3 12.11.1 (don't change)

- Ships `prebuild-install` with a `node-gyp rebuild` fallback, so it builds for both system Node
  (tests) and Electron (Local).
- Pinned because the ABI mapping and the node-abi patch above are keyed to this line; bumping it
  can change the prebuilt-binary availability and the Electron rebuild behavior. Re-verify the
  whole flow before changing it.

---

## Native-Module Open Handles (Jest `forceExit`)

`jest.config.js` runs with `forceExit: true` and `detectOpenHandles: true`:

```js
testTimeout: 30000,      // individual tests can't hang indefinitely
detectOpenHandles: true, // surface any real handle leak rather than masking it
forceExit: true,         // exit after tests complete regardless of open handles
```

**Why:** native modules (better-sqlite3, sqlite-vec, onnxruntime) can register background threads
with Node's event loop **at import time**; Node can't unload a native module, so those threads
live for the whole process and Jest's `--detectOpenHandles` tracker would otherwise wait on them
forever. `forceExit` is the fix; `detectOpenHandles` stays on so a *new*, genuinely fixable handle
still shows up rather than being silently swallowed.

*(Historical: this section once described a LanceDB `CustomGC` handle. The vector store migrated
to sqlite-vec — `src/main/vector-store/SqliteVecStore.ts` — and `@lancedb/lancedb` is no longer a
dependency, so that handle no longer appears; the `forceExit` rationale still holds.)*

---

**Status:** ✅ Working (tests + Local). Run `npm run rebuild` before loading in Local; run
`npm rebuild better-sqlite3` before running tests.
**Critical:** NO `postinstall` hook — it breaks `npm install` from a shell.
