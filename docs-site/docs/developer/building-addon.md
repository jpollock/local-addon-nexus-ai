---
title: Building Addon
description: Build and package Nexus AI addon for distribution
keywords: [build, package, electron, native modules, distribution]
---

# Building Addon

How to build Nexus AI addon from source, including platform-specific packaging for distribution.

## Prerequisites

- **Node.js 20+**
- **Git**
- **ONNX model** (auto-downloaded, see below)
- **Platform-specific tools:**
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools
  - Linux: build-essential, python3

## Quick Start

```bash
# 1. Clone repository
git clone https://github.com/jpollock/local-addon-nexus-ai.git
cd local-addon-nexus-ai

# 2. Install dependencies
npm install

# 3. Download ONNX model
npm run download-model

# 4. Build
npm run build

# 5. CRITICAL: Rebuild native modules for Electron
npm run rebuild
```

**Output:** `lib/` directory with compiled code

## Build Process

### 1. Install Dependencies

```bash
npm install
```

Installs both runtime and development dependencies.

**Key dependencies:**
- `better-sqlite3` - Native module (requires compilation)
- `@lancedb/lancedb` - Vector database
- `@xenova/transformers` - ONNX runtime
- `onnxruntime-node` - Native ONNX bindings

### 2. Download ONNX Model

```bash
npm run download-model
```

Downloads `all-MiniLM-L6-v2` (~30 MB) to `models/` directory.

**Model files:**
- `models/all-MiniLM-L6-v2-quantized/model.onnx`
- `models/all-MiniLM-L6-v2-quantized/tokenizer.json`
- `models/all-MiniLM-L6-v2-quantized/vocab.txt`

This model is required for embeddings. Ships with the addon in releases.

### 3. Build TypeScript

```bash
npm run build
```

Compiles TypeScript to CommonJS in `lib/` directory.

**Steps:**
1. Clean: `rm -rf lib/`
2. Compile: `tsc -p .`
3. Create entry points: `lib/main.js`, `lib/renderer.js`
4. Copy resources: Markdown files, WP plugins

**Output structure:**
```
lib/
├── main/           # Electron main process
├── renderer/       # Electron renderer process
├── common/         # Shared code
├── cli/            # CLI commands
├── wp-plugins/     # WordPress MU plugins
├── main.js         # Entry point for Local
└── renderer.js     # Entry point for Local
```

### 4. Rebuild Native Modules

```bash
npm run rebuild
```

**Critical step:** Recompiles `better-sqlite3` for Electron.

**Why this is needed:**

- **System Node:** Uses MODULE_VERSION 127 (for tests)
- **Electron Node:** Uses MODULE_VERSION 136 (for Local)
- Native modules must match the Node version they run on

**What it does:**
```bash
npx electron-rebuild -v 37.8.0 -f -w better-sqlite3
```

**When to run:**
- After `npm install`
- After `npm update`
- Before loading addon in Local
- If you see "NODE_MODULE_VERSION mismatch" error

See [NATIVE_MODULES.md](../../NATIVE_MODULES.md) for details.

### 5. Link to Local

```bash
# Create symlink (recommended for development)
ln -s "$(pwd)" ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

# Or copy (slower, need to rebuild on changes)
cp -r . ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai
```

**Note:** Symlink allows live updates during development.

### 6. Restart Local

The addon will load automatically when Local starts.

## Packaging for Distribution

Create platform-specific tarballs for GitHub Releases.

### Package Single Platform

```bash
# macOS Apple Silicon
npm run package:mac-arm

# macOS Intel
npm run package:mac-intel

# Windows
npm run package:windows

# Linux
npm run package:linux
```

**Output:** `dist/nexus-ai-{platform}-{arch}-{version}.tgz`

### Package All Platforms (CI)

Use the script directly:

```bash
node scripts/package-addon.js --platform darwin --arch arm64
node scripts/package-addon.js --platform darwin --arch x64
node scripts/package-addon.js --platform win32 --arch x64
node scripts/package-addon.js --platform linux --arch x64
```

## What Goes Into a Tarball

A platform-specific tarball is **self-contained** and includes everything needed to run the addon:

### Included Files

```
nexus-ai-darwin-arm64-0.1.0.tgz
├── lib/                    # Compiled TypeScript
├── models/                 # ONNX model files
├── node_modules/           # Production dependencies
│   ├── better-sqlite3/     # ← Electron-compiled native module
│   ├── @lancedb/lancedb/
│   └── ...
├── package.json            # Metadata (no devDependencies)
└── THIRD_PARTY_LICENSES.md
```

### Excluded Files

- `src/` - Source TypeScript (not needed)
- `tests/` - Test files
- `node_modules/` devDependencies - Build tools
- `.git/` - Version control
- Platform binaries for other platforms

### Tarball Size

**Before stripping:** ~500 MB
**After stripping:** ~300 MB
**Compressed:** ~100-150 MB

**Size breakdown:**
- `node_modules/`: ~250 MB
- `models/`: ~30 MB
- `lib/`: ~20 MB

## Packaging Script Details

`scripts/package-addon.js` performs these steps:

### 1. Clean Build

```bash
rm -rf dist/
npm run build
```

### 2. Create Staging Directory

```bash
STAGING="/tmp/nexus-ai-stage-$(date +%s)"
mkdir -p $STAGING
```

### 3. Copy Files

```bash
cp -r lib/ $STAGING/
cp -r models/ $STAGING/
cp package.json $STAGING/
```

### 4. Install Production Dependencies

```bash
cd $STAGING
npm install --omit=dev
```

**Result:** Only runtime dependencies, no devDependencies.

### 5. Rebuild Native Modules for Electron

```bash
npx electron-rebuild -v 37.8.0 -f -w better-sqlite3 --module-dir "$STAGING"
```

**Critical:** Must rebuild `better-sqlite3` for Electron (MODULE_VERSION 136).

### 6. Strip Non-Target Platform Binaries

```bash
bash scripts/strip-platforms.sh darwin arm64 "$STAGING"
```

Removes native binaries for other platforms to reduce size.

**Example:** For darwin-arm64, removes:
- `node_modules/better-sqlite3/build/Release/better_sqlite3-darwin-x64.node`
- `node_modules/better-sqlite3/build/Release/better_sqlite3-win32-x64.node`
- `node_modules/better-sqlite3/build/Release/better_sqlite3-linux-x64.node`

### 7. Create Tarball

```bash
tar -czf dist/nexus-ai-darwin-arm64-0.1.0.tgz -C "$STAGING" .
```

**Important:** Contents are at root level, not nested in a directory.

### 8. Clean Up

```bash
rm -rf $STAGING
```

## Testing a Tarball Locally

Before releasing, test the tarball:

```bash
# 1. Extract to temp directory
mkdir /tmp/nexus-test
tar -xzf dist/nexus-ai-darwin-arm64-0.1.0.tgz -C /tmp/nexus-test

# 2. Verify contents
ls /tmp/nexus-test
# Should see: lib/ models/ node_modules/ package.json

# 3. Check native module
ls /tmp/nexus-test/node_modules/better-sqlite3/build/Release/
# Should see: better_sqlite3.node (compiled for Electron)

# 4. Install to Local
rm -rf ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai
cp -r /tmp/nexus-test ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

# 5. Restart Local and test
```

## Development Workflow

### Watch Mode

```bash
npm run watch
```

Recompiles TypeScript on file changes.

**Note:** Still need to reload addon in Local to see changes.

### Quick Iteration

```bash
# Make changes to src/
npm run build        # Recompile
npm run rebuild      # Rebuild natives
# Restart Local
```

### Testing Changes

```bash
npm test                    # Unit tests
npm run test:integration    # Integration tests
npm run test:e2e           # E2E tests (requires Local running)
```

## Cross-Platform Considerations

### Native Modules

`better-sqlite3` must be compiled for each platform:

```bash
# On macOS (for macOS builds)
npm install
npm run rebuild

# On Windows (for Windows builds)
npm install
npm run rebuild

# On Linux (for Linux builds)
npm install
npm run rebuild
```

**GitHub Actions handles this automatically** for all platforms.

### Path Handling

Use `path.join()` for cross-platform paths:

```typescript
// ✅ Good
const addonPath = path.join(dataDir, 'addons', 'nexus-ai');

// ❌ Bad
const addonPath = `${dataDir}/addons/nexus-ai`;
```

### Line Endings

Configure git to handle line endings:

```bash
# .gitattributes
* text=auto
*.sh text eol=lf
```

## Troubleshooting

### "NODE_MODULE_VERSION mismatch"

**Problem:** Addon fails to load in Local

**Solution:**
```bash
npm run rebuild
# Restart Local
```

### "Cannot find module 'better-sqlite3'"

**Problem:** Module not installed or not rebuilt

**Solution:**
```bash
npm install
npm run rebuild
```

### Tarball Extraction Fails

**Problem:** Tarball structure is wrong

**Solution:**

Verify tarball contents:
```bash
tar -tzf dist/nexus-ai-darwin-arm64-0.1.0.tgz | head -20
```

Should show:
```
lib/
lib/main/
lib/renderer/
models/
node_modules/
package.json
```

**NOT:**
```
local-addon-nexus-ai/lib/     ← Wrong (nested directory)
```

### Build Fails on CI

**Problem:** GitHub Actions build fails

**Solution:**

1. Check platform-specific requirements
2. Verify all dependencies are in `package.json` (not global)
3. Test locally on the same platform
4. Check GitHub Actions logs for specific error

## Next Steps

- [Release Process](release-process.md) - Automated releases via GitHub Actions
- [Testing](testing-addon.md) - Test suite documentation
- [Contributing](contributing.md) - Contribution guidelines
