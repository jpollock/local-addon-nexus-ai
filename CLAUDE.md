

## Native Modules & Electron

**TL;DR:** It just works. Don't manually rebuild.

**The addon uses better-sqlite3** (native module):
- Tests use system Node.js → compiles automatically on `npm install`
- Local uses Electron Node.js → **Local rebuilds automatically when loading addon**

**You don't need to rebuild manually.** Local handles it.

**If you see NODE_MODULE_VERSION error in Local:**
1. Restart Local and reload addon
2. Check Xcode Command Line Tools: `xcode-select --install`
3. Delete addon's `node_modules`, let Local reinstall

**See:** `docs/NATIVE_MODULES.md` for details.

**Key versions:**
- better-sqlite3: 11.10.0 (don't change this)
- Install script: `prebuild-install || node-gyp rebuild` (handles both contexts)
