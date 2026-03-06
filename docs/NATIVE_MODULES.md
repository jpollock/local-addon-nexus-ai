# Native Module Compilation (better-sqlite3)

## TL;DR - It Just Works™

**For developers:** Tests work out of the box. Local handles Electron compilation automatically.  
**Don't manually rebuild** - you don't need to.

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
# Inside Local's addon loading process:
1. Local runs `npm install` in the addon directory
2. better-sqlite3 install script runs
3. prebuild-install checks for Electron v136 prebuild → not found
4. Falls back to `node-gyp rebuild`
5. Compiles against Local's Electron headers (v37.8.0, MODULE_VERSION 136)
6. ✅ Works in Local
```

**The magic:** node-gyp detects it's running in Electron's context and compiles for the correct version automatically.

## Why Manual Rebuild Fails (And Why That's OK)

If you try to manually rebuild from outside Local:

```bash
npm run rebuild:electron  # ❌ FAILS - C++ compiler errors
```

This fails because:
- It's trying to compile from system Node's context for Electron's target
- C++ toolchain issues (concepts, V8 API changes)
- **But you don't need to do this!** Local handles it when loading the addon.

## Development Workflow

### Normal Development (What You Actually Do)

```bash
git clone repo
npm install      # Compiles for system Node
npm test         # ✅ Works
npm run build    # ✅ Compiles TypeScript

# Load addon in Local app
# ✅ Local auto-recompiles better-sqlite3 for Electron
# ✅ Addon works
```

**No manual rebuild needed.**

### If You See The Error In Local

If you see this error when loading in Local:
```
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 136.
```

It means **Local's automatic rebuild failed**. Possible causes:

1. **Local's rebuild process was skipped** - Restart Local and reload addon
2. **C++ build tools missing** - Install Xcode Command Line Tools
3. **Node modules cached wrong** - Delete `node_modules` in addon, let Local reinstall

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

Local's rebuild didn't work:

1. Check Local logs for build errors
2. Ensure Xcode Command Line Tools installed: `xcode-select --install`
3. Delete addon's `node_modules`, let Local reinstall
4. If still fails, file bug with Local team

### "electron-rebuild" command fails

This is expected and OK. You don't need electron-rebuild - Local handles it.

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

**Last Updated:** 2026-03-05  
**Status:** ✅ Working (tests + Local)  
**Action Required:** None - it just works
