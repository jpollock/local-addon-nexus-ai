---
title: Release Process
description: How to release Nexus AI with automated GitHub Actions workflow
keywords: [release, github actions, ci/cd, packaging, distribution]
---

# Release Process

Nexus AI uses GitHub Actions to automatically build platform-specific tarballs and create releases when version tags are pushed.

## Overview

The release process is fully automated:

1. Developer bumps version and pushes tag
2. GitHub Actions builds 4 platform-specific tarballs in parallel
3. GitHub release is created automatically
4. All 4 tarballs are uploaded as release assets
5. Users can auto-install from releases via CLI

## Quick Start

### 1. Bump Version

```bash
# Patch release (0.1.0 → 0.1.1)
npm version patch

# Minor release (0.1.1 → 0.2.0)
npm version minor

# Major release (0.2.0 → 1.0.0)
npm version major
```

This updates `package.json` and creates a git tag automatically.

### 2. Push Tag to GitHub

```bash
# Push commits and tags
git push && git push --tags

# Or just the tag
git push origin v0.1.0
```

### 3. Monitor GitHub Actions

Visit `https://github.com/jpollock/local-addon-nexus-ai/actions` to watch the build.

**Workflow steps:**

1. **Package** (parallel on 4 platforms)
   - macOS (Apple Silicon)
   - macOS (Intel)
   - Windows (64-bit)
   - Linux (64-bit)

2. **Release** (after all packages complete)
   - Create GitHub release
   - Upload all 4 tarballs

### 4. Verify Release

Visit `https://github.com/jpollock/local-addon-nexus-ai/releases/latest`

**Expected assets:**
- `nexus-ai-darwin-arm64-{version}.tgz`
- `nexus-ai-darwin-x64-{version}.tgz`
- `nexus-ai-win32-x64-{version}.tgz`
- `nexus-ai-linux-x64-{version}.tgz`

## Platform-Specific Builds

Each platform build runs these steps:

```yaml
1. npm ci                          # Install dependencies
2. npm run download-model          # Download ONNX model
3. npm run build                   # TypeScript compile
4. npm test                        # Run tests
5. node scripts/package-addon.js   # Create tarball
```

### Packaging Script

`scripts/package-addon.js` creates self-contained tarballs:

**What gets included:**
- `lib/` - Compiled TypeScript (CommonJS)
- `models/` - ONNX model files
- `node_modules/` - Production dependencies (no devDependencies)
- `package.json` - Metadata

**Critical steps:**

1. **Install production dependencies:**
   ```bash
   npm install --omit=dev
   ```

2. **Rebuild native modules for Electron:**
   ```bash
   npx electron-rebuild -v 37.8.0 -f -w better-sqlite3
   ```

   This compiles `better-sqlite3` for Electron's Node.js (MODULE_VERSION 136).

3. **Strip non-target platform binaries:**
   ```bash
   bash scripts/strip-platforms.sh {platform} {arch}
   ```

   Removes unused platform binaries to reduce tarball size.

4. **Create tarball:**
   ```bash
   tar -czf nexus-ai-{platform}-{arch}-{version}.tgz .
   ```

**Output:** ~300 MB compressed tarball

## Auto-Install Integration

CLI automatically downloads and installs from GitHub Releases:

```bash
# User runs:
nexus sites list

# CLI detects missing addon:
# → Prompts: "Download and install addon? (Y/n)"
# → Downloads: nexus-ai-darwin-arm64-0.1.0.tgz
# → Extracts to: ~/Library/Application Support/Local/addons/
# → Activates in: enabled-addons.json
```

**Platform detection:**
- macOS (Apple Silicon) → `darwin-arm64`
- macOS (Intel) → `darwin-x64`
- Windows (64-bit) → `win32-x64`
- Linux (64-bit) → `linux-x64`

See [CLI Installation](../cli/installation.md) for user-facing docs.

## Manual Release (Development)

For testing or development, you can build a single platform:

```bash
# macOS Apple Silicon only
npm run package:mac-arm

# Output: dist/nexus-ai-darwin-arm64-{version}.tgz
```

**Use cases:**
- Local testing before creating a release
- Development builds
- Platform-specific debugging

## GitHub Actions Configuration

### Workflow File

`.github/workflows/package.yml`:

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  package:
    strategy:
      matrix:
        include:
          - os: macos-latest        # Apple Silicon
            platform: darwin
            arch: arm64
          - os: macos-13           # Intel
            platform: darwin
            arch: x64
          - os: ubuntu-latest      # Linux
            platform: linux
            arch: x64
          - os: windows-latest     # Windows
            platform: win32
            arch: x64
    # ... build steps

  release:
    needs: package
    if: startsWith(github.ref, 'refs/tags/v')
    # ... create release and upload assets
```

### Triggers

- **Tag push:** `git push origin v0.1.0`
- **Manual:** GitHub UI → Actions → Run workflow

### Permissions

```yaml
permissions:
  contents: write  # Required for creating releases
```

## Versioning

Nexus AI follows [Semantic Versioning](https://semver.org/):

- **MAJOR** - Breaking changes (1.0.0 → 2.0.0)
- **MINOR** - New features, backward-compatible (0.1.0 → 0.2.0)
- **PATCH** - Bug fixes, backward-compatible (0.1.0 → 0.1.1)

## Checklist

Before releasing:

- [ ] All tests passing (`npm run test:all`)
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated
- [ ] Breaking changes documented
- [ ] README.md up to date
- [ ] Tag pushed to GitHub
- [ ] GitHub Actions build succeeded
- [ ] All 4 platform tarballs present in release
- [ ] Auto-install tested from release

## Troubleshooting

### Build Fails on Specific Platform

**Problem:** macOS build succeeds but Windows fails

**Solution:**
1. Check GitHub Actions logs for the failing platform
2. Common issues:
   - Windows path handling (use forward slashes)
   - Line ending differences (CRLF vs LF)
   - Native module compilation failures

### Tarball Too Large

**Problem:** Tarball exceeds GitHub's 2 GB limit

**Solution:**
1. Verify `strip-platforms.sh` is running
2. Check for accidental inclusion of:
   - `node_modules/` from devDependencies
   - Test fixtures
   - Build artifacts

### Auto-Install Fails

**Problem:** Users report "Asset not found" during auto-install

**Solution:**
1. Verify asset naming matches expected pattern:
   ```
   nexus-ai-{platform}-{arch}-{version}.tgz
   ```
2. Check release is published (not draft)
3. Verify all 4 platforms uploaded

## Next Steps

- [Building Addon](building-addon.md) - Detailed packaging documentation
- [Testing](testing-addon.md) - Test before releasing
- [Contributing](contributing.md) - Contribution guidelines
