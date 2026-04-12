---
title: UI Addon Installation
description: Install Nexus AI addon in Local for visual workflows
keywords: [installation, local, addon, ui, setup]
---

# UI Addon Installation

Install the Nexus AI addon in Local to access visual dashboards, fleet management, and AI chat interfaces.

## Installation Methods

### Method 1: Auto-Install via CLI (Recommended)

The easiest way to install the addon is through the CLI, which automatically downloads and installs it for your platform.

```bash
# 1. Install CLI globally
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# 2. Run any command to trigger auto-install
nexus sites list
```

**What happens:**

1. CLI detects addon is missing
2. Prompts: "Download and install addon for macOS (Apple Silicon)? (Y/n)"
3. Downloads platform-specific addon from GitHub Releases (~300 MB)
4. Extracts to Local's addon directory
5. Activates addon in `enabled-addons.json`
6. Prompts you to restart Local

**Supported platforms:**
- macOS (Apple Silicon) - `darwin-arm64`
- macOS (Intel) - `darwin-x64`
- Windows (64-bit) - `win32-x64`
- Linux (64-bit) - `linux-x64`

After restarting Local, the addon appears in:
- **Sites sidebar** - AI-powered search panel
- **Site details** - WPE site information tab
- **Main menu** - Nexus AI > Preferences

See [CLI Installation](../cli/installation.md) for full CLI setup.

### Method 2: Manual Install from GitHub Releases

If you prefer manual installation or auto-install fails. Releases are distributed as `.tgz` tarballs — not ZIP files.

#### Step 1: Download Platform Tarball

Visit [GitHub Releases](https://github.com/jpollock/local-addon-nexus-ai/releases/latest) and download the `.tgz` file for your platform:

- **macOS (Apple Silicon):** `nexus-ai-darwin-arm64-{version}.tgz`
- **macOS (Intel):** `nexus-ai-darwin-x64-{version}.tgz`
- **Windows:** `nexus-ai-win32-x64-{version}.tgz`
- **Linux:** `nexus-ai-linux-x64-{version}.tgz`

#### Step 2: Extract to Addon Directory

=== "macOS/Linux"

    ```bash
    # Create addon directory
    mkdir -p ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

    # Extract tarball
    tar -xzf nexus-ai-darwin-arm64-{version}.tgz \
      -C ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai/

    # Verify extraction
    ls ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai/
    # Should see: lib/ models/ node_modules/ package.json
    ```

=== "Windows (PowerShell)"

    ```powershell
    # Create addon directory
    $addonDir = "$env:APPDATA\Local\addons\local-addon-nexus-ai"
    New-Item -ItemType Directory -Force -Path $addonDir

    # Extract tarball (requires tar.exe, available on Windows 10+)
    tar -xzf nexus-ai-win32-x64-{version}.tgz -C $addonDir

    # Or use 7-Zip GUI:
    # 1. Right-click tarball → 7-Zip → Extract Here
    # 2. Move contents to %APPDATA%\Local\addons\local-addon-nexus-ai\
    ```

#### Step 3: Activate Addon

Open `enabled-addons.json` and add the addon:

=== "macOS/Linux"

    ```bash
    # Location
    ~/Library/Application Support/Local/enabled-addons.json

    # Add this line
    {
      "local-addon-nexus-ai": true
    }
    ```

=== "Windows"

    ```
    Location: %APPDATA%\Local\enabled-addons.json

    Add this line:
    {
      "local-addon-nexus-ai": true
    }
    ```

#### Step 4: Restart Local

The addon will load automatically on next Local start.

### Method 3: Install from Source (Development)

For development or contributing:

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

# 6. Symlink to Local addons directory
ln -s "$(pwd)" ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

# 7. Activate addon (add to enabled-addons.json)
# 8. Restart Local
```

See `.claude/project/DEVELOPMENT.md` for development workflow.

## Verify Installation

After restarting Local:

### 1. Check Addons Menu

**Local → Add-ons → Manage Add-ons**

Look for "Nexus AI" in the list. It should show:
- **Status:** Active
- **Version:** {version}
- **Description:** AI-powered WordPress fleet management

### 2. Check Sites Sidebar

Open any site in Local. The sidebar should show a new **"Search"** panel with AI-powered search.

### 3. Check Main Menu

**Nexus AI → Preferences** should open the addon settings panel.

### 4. Check Site Details

Click on a WP Engine-linked site. You should see a new **"WPE Info"** tab showing site details.

## Addon Location

The addon is installed at:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/Local/addons/local-addon-nexus-ai/` |
| Windows | `%APPDATA%\Local\addons\local-addon-nexus-ai\` |
| Linux | `~/.config/Local/addons/local-addon-nexus-ai/` |

## What's Included

A complete Nexus AI installation includes:

```
local-addon-nexus-ai/
├── lib/                    # Compiled code
│   ├── main/              # Electron main process
│   ├── renderer/          # Electron renderer (UI)
│   ├── common/            # Shared types
│   └── cli/               # CLI commands
├── models/                # ONNX embedding model (~30 MB)
├── node_modules/          # Production dependencies
│   ├── better-sqlite3/   # Native module (Electron-compiled)
│   ├── @lancedb/lancedb/ # Vector database
│   └── ...
├── package.json          # Addon metadata
└── THIRD_PARTY_LICENSES.md
```

**Total size:** ~300 MB (uncompressed)

## Data Location

Nexus AI stores data separately from the addon:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/Local/nexus-ai/` |
| Windows | `%APPDATA%\Local\nexus-ai\` |
| Linux | `~/.config/Local/nexus-ai/` |

**Data files:**
- `lancedb/` - Vector database (site content indexes)
- `graph.db` - SQLite database (site relationships, events)
- `audit.db` - Audit logs (for security tracking)

## Updating

### Auto-Update via CLI

The CLI automatically updates the addon when a new version is detected:

```bash
# Install new CLI version
npm update -g @local-labs-jpollock/local-addon-nexus-ai

# Run any command
nexus sites list

# If addon version mismatch detected:
# → "New addon version available. Download and install? (Y/n)"
```

### Manual Update

1. Download latest tarball from [Releases](https://github.com/jpollock/local-addon-nexus-ai/releases/latest)
2. Extract to addon directory (overwrites existing files)
3. Restart Local

**Note:** Your data (vector database, settings) is preserved during updates.

## Uninstalling

### Remove Addon

```bash
# Stop Local first

# Remove addon directory
rm -rf ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai

# Remove from enabled-addons.json
# Edit: ~/Library/Application Support/Local/enabled-addons.json
# Delete: "local-addon-nexus-ai": true

# Restart Local
```

### Remove Data (Optional)

```bash
# Remove all Nexus AI data
rm -rf ~/Library/Application\ Support/Local/nexus-ai

# This deletes:
# - Vector database indexes
# - Site relationship data
# - Event history
# - Audit logs
```

### Remove CLI

```bash
npm uninstall -g local-addon-nexus-ai
```

## Troubleshooting

### Addon Not Appearing

**Problem:** Addon doesn't appear after installation

**Check:**

1. **Addon directory exists:**
   ```bash
   ls ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai/
   ```

2. **Addon is activated:**
   ```bash
   cat ~/Library/Application\ Support/Local/enabled-addons.json
   # Should contain: "local-addon-nexus-ai": true
   ```

3. **Local logs:**
   ```bash
   tail -f ~/Library/Logs/local-by-flywheel/main.log
   ```

   Look for errors like:
   - "Add-on does not export a function/class"
   - "NODE_MODULE_VERSION mismatch"

### NODE_MODULE_VERSION Mismatch

**Problem:** Error in logs: "The module was compiled against a different Node.js version"

**Solution:**

This means `better-sqlite3` was compiled for the wrong Node version.

**If you installed from tarball:**
- Download the correct platform tarball from releases
- Tarballs include pre-compiled natives for Electron

**If you installed from source:**
```bash
cd ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai
npm run rebuild
# Restart Local
```

### UI Components Not Loading

**Problem:** Addon loads but UI panels don't appear

**Check:**

1. **React errors in DevTools:**
   - Right-click in Local → Inspect Element
   - Check Console for errors

2. **IPC handlers registered:**
   ```bash
   tail -f ~/Library/Logs/local-by-flywheel/main.log | grep "Nexus AI"
   ```

   Should see: "Nexus AI addon loaded successfully"

### WPE Features Not Working

**Problem:** WP Engine sync fails or WPE site info doesn't load

**Check:**

1. **Local connected to WPE:**
   - Local → Connect → WP Engine
   - Sign in with WPE account

2. **WPE credentials valid:**
   - Try manually in Local: Connect → WP Engine → Refresh

3. **CAPI permissions:**
   - WPE API key needs `read` scope

## Next Steps

<div class="grid cards" markdown>

- **Fleet Overview**

    Explore the fleet dashboard and site management features.

    [→ Fleet Overview](fleet-overview.md)

- **Search**

    Use AI-powered search to find content across your sites.

    [→ Site Finder](site-finder.md)

- **WPE Management**

    Sync and manage WP Engine sites alongside local sites.

    [→ WPE Management](wpe-management.md)

- **Preferences**

    Configure addon settings, AI providers, and sync options.

    [→ Preferences](preferences.md)

</div>

## Support

- **Documentation:** [https://jpollock.github.io/local-addon-nexus-ai](https://jpollock.github.io/local-addon-nexus-ai)
- **Issues:** [GitHub Issues](https://github.com/jpollock/local-addon-nexus-ai/issues)
- **Discussions:** [GitHub Discussions](https://github.com/jpollock/local-addon-nexus-ai/discussions)

---

**Installation complete!** The addon is now available in Local.
