# Testing Auto-Install

Three testing approaches for the auto-install functionality:

## 1. Unit Tests (Fast, Automated)

Test individual components in isolation.

```bash
# Run all bootstrap tests
npm test -- tests/cli/bootstrap

# Run specific test files
npm test -- tests/cli/bootstrap/platform.test.ts
npm test -- tests/cli/bootstrap/downloader.test.ts
npm test -- tests/cli/bootstrap/extractor.test.ts
```

**What's tested:**
- ✅ Platform detection for all 4 platforms
- ✅ GitHub API responses (mocked)
- ✅ Tarball extraction with permissions
- ✅ Error handling (network errors, rate limits, etc.)

**Time:** ~5 seconds

## 2. Integration Test Script (Manual, Local)

Test the full flow with a mock tarball (no GitHub required).

```bash
# Run the test script
./scripts/test-auto-install.sh
```

**What it does:**
1. Builds the CLI
2. Creates a mock addon tarball
3. Backs up your existing addon (if any)
4. Tests platform detection
5. Tests tarball extraction
6. Simulates full installation
7. Restores your backup

**Output:**
```
=== Nexus AI Auto-Install Test ===

Step 1: Building CLI...
✓ CLI built

Step 2: Creating mock addon tarball...
✓ Created tarball: nexus-ai-darwin-arm64-0.1.0.tgz (512B)

Step 3: Backing up existing addon...
✓ Backed up to: ~/Library/Application Support/Local/addons/local-addon-nexus-ai.backup-test

Step 4: Testing platform detection...
✓ Platform: macOS (Apple Silicon)
  Asset: nexus-ai-darwin-arm64-0.1.0.tgz

Step 5: Testing tarball extraction...
✓ Extracted successfully
  Valid addon: true
✓ package.json found

Step 6: Testing download (skipped - requires mock GitHub server)
  In production, this downloads from GitHub Releases

Step 7: Testing full auto-install flow...
✓ Mock addon installed
✓ CLI detects addon: true

=== All Tests Passed ===

Summary:
  ✓ Platform detection working
  ✓ Tarball extraction working
  ✓ Addon verification working
  ✓ Mock installation successful

The auto-install logic is ready for real GitHub releases!
```

**Time:** ~10 seconds

**Safe:** Automatically backs up and restores your existing addon.

## 3. End-to-End Test (Manual, Real GitHub)

**⚠️ Only works after creating a GitHub release with platform tarballs**

Test against actual GitHub Releases:

```bash
# 1. Backup existing addon
ADDON_DIR="$HOME/Library/Application Support/Local/addons/local-addon-nexus-ai"
if [ -d "$ADDON_DIR" ]; then
  mv "$ADDON_DIR" "${ADDON_DIR}.backup"
fi

# 2. Run CLI command to trigger auto-install
npm run build
node lib/cli/index.js list

# Expected output:
#
# Nexus AI addon not found.
# Detected platform: macOS (Apple Silicon)
#
# Download and install addon from GitHub? (Y/n) Y
# Downloading nexus-ai-darwin-arm64-0.1.0.tgz...
# Downloading... 10% (512 KB / 5 MB)
# Downloading... 20% (1 MB / 5 MB)
# ...
# Downloading... 100% (5 MB / 5 MB)
# Download complete. Installing...
# ✓ Addon installed successfully!
#
# Please restart Local for the addon to appear.

# 3. Verify installation
ls -la "$ADDON_DIR"
cat "$ADDON_DIR/package.json"

# 4. Restart Local
# The addon should appear in Local

# 5. Restore backup
rm -rf "$ADDON_DIR"
mv "${ADDON_DIR}.backup" "$ADDON_DIR"
```

**Prerequisites:**
- GitHub release exists with tag matching CLI version
- Release has platform-specific tarballs:
  - `nexus-ai-darwin-arm64-0.1.0.tgz`
  - `nexus-ai-darwin-x64-0.1.0.tgz`
  - `nexus-ai-win32-x64-0.1.0.tgz`
  - `nexus-ai-linux-x64-0.1.0.tgz`

## 4. Cross-Platform Testing

**Using GitHub Actions (Automated):**

Create `.github/workflows/test-auto-install.yml`:

```yaml
name: Test Auto-Install

on:
  push:
    branches: [mvp-v1-docs-install]

jobs:
  test-auto-install:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20

      - run: npm install
      - run: npm run build
      - run: npm test -- tests/cli/bootstrap

      # Platform-specific test script
      - name: Test auto-install (Unix)
        if: runner.os != 'Windows'
        run: ./scripts/test-auto-install.sh

      - name: Test auto-install (Windows)
        if: runner.os == 'Windows'
        run: |
          # Windows equivalent of test script
          npm run build
          node -e "const {detectPlatform} = require('./lib/cli/bootstrap/platform'); console.log(detectPlatform());"
```

## Testing Checklist

Before merging to main:

- [ ] Unit tests pass on macOS (`npm test -- tests/cli/bootstrap`)
- [ ] Integration script passes (`./scripts/test-auto-install.sh`)
- [ ] Platform detection correct for current OS
- [ ] Tarball extraction creates valid addon
- [ ] Error messages clear and helpful
- [ ] Cleanup restores original state

Before releasing:

- [ ] Create GitHub release with platform tarballs
- [ ] E2E test on macOS (Apple Silicon)
- [ ] E2E test on macOS (Intel) - optional, can use CI
- [ ] E2E test on Windows - optional, can use CI
- [ ] E2E test on Linux - optional, can use CI
- [ ] Verify downloaded addon works in Local
- [ ] Verify error cases (no internet, rate limit, etc.)

## Debugging Failed Tests

### "Platform detection failed"

```bash
# Check your platform/arch
node -e "console.log(process.platform, process.arch)"

# Should be one of:
# darwin arm64  (macOS Apple Silicon)
# darwin x64    (macOS Intel)
# win32 x64     (Windows)
# linux x64     (Linux)
```

### "Tarball extraction failed"

```bash
# Check tar is available
tar --version

# Try manual extraction
cd /tmp
tar -xzf /path/to/test.tgz
ls -la
```

### "Download failed" (in E2E test)

```bash
# Check GitHub release exists
curl -s https://api.github.com/repos/jpollock/local-addon-nexus-ai/releases/latest | jq .

# Check asset exists
curl -s https://api.github.com/repos/jpollock/local-addon-nexus-ai/releases/latest | \
  jq '.assets[] | .name'

# Expected output:
# "nexus-ai-darwin-arm64-0.1.0.tgz"
# "nexus-ai-darwin-x64-0.1.0.tgz"
# "nexus-ai-win32-x64-0.1.0.tgz"
# "nexus-ai-linux-x64-0.1.0.tgz"
```

### "Rate limit exceeded"

```bash
# Check your GitHub API rate limit
curl -s https://api.github.com/rate_limit

# Output:
# {
#   "rate": {
#     "limit": 60,
#     "remaining": 42,
#     "reset": 1234567890
#   }
# }

# Wait until 'reset' time or use authenticated requests
```

## Quick Test Summary

**Before committing:**
```bash
npm test -- tests/cli/bootstrap
```

**Before PR:**
```bash
npm test -- tests/cli/bootstrap
./scripts/test-auto-install.sh
```

**Before release:**
```bash
# All unit tests
npm test

# Integration test
./scripts/test-auto-install.sh

# E2E (requires GitHub release)
# Follow section 3 above
```
