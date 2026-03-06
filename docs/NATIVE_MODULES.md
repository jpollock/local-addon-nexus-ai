# Native Module Compilation (better-sqlite3)

## The Problem

The Nexus AI addon uses `better-sqlite3`, a native Node.js module that requires compilation for the specific Node.js version being used.

There are **two different Node.js versions** to consider:

1. **System Node.js** (for running tests via `npm test`)
   - Version: v22.x or whatever is installed globally
   - NODE_MODULE_VERSION: 127

2. **Electron's embedded Node.js** (for running in Local)
   - Electron version: 37.8.0 (from flywheel-local)
   - NODE_MODULE_VERSION: 136
   - Different ABI than system Node.js

When you see this error:
```
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 136.
```

It means better-sqlite3 was compiled for system Node.js but is being loaded by Electron's Node.js.

## Solutions

### Option 1: Rebuild for System Node (Tests Only)

If you just need to run tests:

```bash
npm run prepare:electron
```

This rebuilds better-sqlite3 for your system Node.js.

### Option 2: Rebuild for Electron (Running in Local)

To rebuild for Electron's Node.js version:

```bash
npm run rebuild:electron
```

**Note:** This may fail on some systems due to compiler issues. If it fails, use Option 3.

### Option 3: Let Local Handle It (Recommended)

Local's build process should automatically rebuild native modules for Electron when packaging the addon.

The addon's `package.json` includes:
- `better-sqlite3` as a dependency
- `electron-rebuild` as a dev dependency

When Local loads the addon, it should:
1. Install dependencies
2. Rebuild native modules for its Electron version
3. Load the addon

**If you get the error**, it means Local's rebuild step didn't run or failed silently.

## Manual Rebuild Steps

If automatic rebuild fails, try this manual approach:

```bash
# Option A: Using electron-rebuild (if installed globally)
npx electron-rebuild -f -w better-sqlite3

# Option B: Using node-gyp directly
cd node_modules/better-sqlite3
node-gyp rebuild --target=37.8.0 --arch=arm64 --dist-url=https://electronjs.org/headers
cd ../..

# Option C: Reinstall with rebuild
npm rebuild better-sqlite3 --update-binary
```

## For Addon Developers

### During Development

- **Tests**: Use system Node.js (`npm test`)
  - Binaries built for NODE_MODULE_VERSION 127
  - Fast, no Electron required

- **Testing in Local**: Load addon in actual Local app
  - Binaries must be for NODE_MODULE_VERSION 136
  - Run `npm run rebuild:electron` before testing

### Before Committing

Do NOT commit the compiled binaries:
- `node_modules/better-sqlite3/build/` is gitignored
- Each developer rebuilds for their platform

### CI/CD Considerations

If we add CI:
- Tests use system Node.js (no rebuild needed)
- E2E tests in Local require electron-rebuild
- Each platform (macOS, Windows, Linux) needs separate builds

## Package Scripts

```json
{
  "scripts": {
    "prepare:electron": "npm rebuild better-sqlite3 --update-binary",
    "rebuild:electron": "electron-rebuild -f -w better-sqlite3"
  }
}
```

## Troubleshooting

### Error: "make failed with exit code 2"

electron-rebuild is trying to compile but fails. Solutions:

1. **Check Xcode/Build Tools**:
   ```bash
   xcode-select --install
   ```

2. **Update npm/node-gyp**:
   ```bash
   npm install -g node-gyp
   ```

3. **Try direct rebuild**:
   ```bash
   npm run prepare:electron
   ```

### Error: "Cannot find module 'better_sqlite3.node'"

The native binding wasn't built. Run:
```bash
cd node_modules/better-sqlite3
npm run build-release
```

### Tests pass but Local fails

Tests use system Node, Local uses Electron Node. Rebuild for Electron:
```bash
npm run rebuild:electron
```

## Future: Prebuilt Binaries

better-sqlite3 provides prebuilt binaries for common platforms, but not always for latest Electron versions.

To check if prebuild exists:
```bash
cd node_modules/better-sqlite3
npx prebuild-install --runtime electron --target 37.8.0
```

If it says "No prebuilt binaries found", you must compile locally.

## Alternative: Pure JavaScript SQLite

If native compilation becomes too problematic, consider:
- `sql.js` (SQLite compiled to WebAssembly, slower but no compilation)
- `better-sqlite3-multiple-ciphers` (fork with prebuild support)

For now, sticking with better-sqlite3 because:
- Performance (100x faster than sql.js for our use case)
- Mature, widely used
- Works well once compiled correctly

---

**Last Updated:** 2026-03-05
**Electron Version:** 37.8.0 (from flywheel-local)
**better-sqlite3 Version:** 11.10.0
