

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
