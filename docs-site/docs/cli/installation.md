---
title: CLI Installation
description: Install and configure the Nexus AI CLI and MCP server
keywords: [cli, installation, setup, npm, npx, mcp]
---

# CLI Installation

Install the Nexus AI CLI for command-line access and MCP server functionality.

## Prerequisites

- **[Local](https://localwp.com)** must be installed
- **Node.js 18 or higher**

!!! success "Auto-Start Feature"
    The CLI automatically starts Local if it's not running. No manual setup required!

### Verify Prerequisites

```bash
# Check Node.js version (must be 18+)
node --version
# ✓ v22.16.0

# Check Local is installed (optional - CLI will prompt if missing)
ls -la /Applications/Local.app  # macOS
```

!!! info "What Happens on First Run"
    The CLI automatically:

    - Detects if Local is installed (prompts to download if not)
    - Starts Local if it's not running
    - Downloads the addon for your platform from GitHub Releases (~300 MB)
    - Extracts and installs the Nexus AI addon
    - Activates the addon
    - Waits for GraphQL server to be ready

    Just install the CLI and run commands - everything else is automatic!

    **Supported platforms:** macOS (Apple Silicon/Intel), Windows, Linux

## Installation

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

After installation, the `nexus` command is available globally.

### First Run

On first run, the CLI automatically handles all setup:

```bash
$ nexus sites list

Nexus AI addon not found.
Detected platform: macOS (Apple Silicon)

Download and install addon from GitHub? (Y/n) Y

Downloading nexus-ai-darwin-arm64-0.2.1.tgz...
Downloading... 100% (287 MB / 287 MB)
Download complete. Installing...
✓ Addon installed successfully!

Please restart Local for the addon to appear.

(After restarting Local)

$ nexus sites list

Local Sites (0 running, 0 halted):
  No local sites found. Create one in Local or: nexus local create <name>
```

**What just happened:**

1. ✅ Detected missing addon
2. ✅ Prompted for confirmation
3. ✅ Downloaded platform-specific tarball from GitHub Releases (~300 MB)
4. ✅ Extracted to Local's addon directory
5. ✅ Activated the addon
6. ✅ Prompted you to restart Local

Subsequent runs are instant - no bootstrap overhead.

## Verify Installation

```bash
nexus doctor
```

This checks every layer of the stack and prints the exact fix for anything that's wrong:

```
Nexus AI v0.2.1 — System Health
──────────────────────────────────────────────────
  ✅  Local app           Installed
  ✅  Local running       Running
  ✅  Nexus AI addon      Active (v0.2.1)
  ✅  GraphQL server      Connected (port 4000)
  ✅  MCP server          Running · 161 tools
  ⚠️   AI agent config    No agents configured
  ⚠️   AI provider        Not configured
  ...
──────────────────────────────────────────────────

  Getting started:
  1. Connect your AI agent:    nexus mcp setup
  2. Configure AI provider:    nexus ai config
```

Every `⚠️` or `❌` includes the exact next step. Run `nexus doctor` anytime something is broken.

## Configuration

The CLI reads configuration from Local's data directory:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/Local/` |
| Windows | `%APPDATA%/Local/` |
| Linux | `~/.config/Local/` |

No additional configuration is required.

### Optional: Shell Completion

=== "Bash"

    ```bash
    # Add to ~/.bashrc or ~/.bash_profile
    eval "$(nexus completion bash)"
    ```

=== "Zsh"

    ```bash
    # Add to ~/.zshrc
    eval "$(nexus completion zsh)"
    ```

=== "Fish"

    ```bash
    # Add to ~/.config/fish/config.fish
    nexus completion fish | source
    ```

### Optional: Environment Variables

```bash
# Disable telemetry
export NEXUS_TELEMETRY=0

# Enable debug logging
export DEBUG=nexus:*
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to persist.

### Optional: Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXUS_TELEMETRY` | `0` to disable, `1` to enable | Config value |
| `NEXUS_ANALYTICS_ENDPOINT` | Custom telemetry endpoint | Cloudflare Worker |
| `DEBUG` | Debug logging (e.g., `nexus:*`) | None |
| `NEXUS_CONCURRENCY` | Parallel operation limit | 10 |
| `NEXUS_SSH_TIMEOUT` | SSH timeout in milliseconds | 30000 |

## Updating

```bash
npm update -g local-addon-nexus-ai

# Or force reinstall latest
npm install -g @local-labs-jpollock/local-addon-nexus-ai@latest
```

The addon in Local will auto-update on next CLI run if a new version is detected.

## Uninstalling

```bash
# Remove CLI
npm uninstall -g local-addon-nexus-ai

# Remove addon from Local (optional)
# Local → Preferences → Addons → Nexus AI → Remove
```

## Troubleshooting

### Command Not Found

**Problem:** `nexus: command not found` after installation

**Solution:**

```bash
# Check if installed
npm list -g local-addon-nexus-ai

# Check npm global bin is in PATH
echo $PATH | grep -q "$(npm config get prefix)/bin" && echo "✓ In PATH" || echo "✗ Not in PATH"

# Add to PATH if needed
export PATH="$(npm config get prefix)/bin:$PATH"

# Add permanently
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Permission Denied

**Problem:** `EACCES: permission denied` during installation

**Solution:**

```bash
# Option 1: Configure npm for user installs (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# Option 2: Use sudo
sudo npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

### Local Not Detected

**Problem:** CLI can't find Local installation

**Solution:**

```bash
# Verify Local is installed
ls -la /Applications/Local.app  # macOS

# If Local is elsewhere, set environment variable
export LOCAL_APP_PATH="/path/to/Local.app"

# Start Local
open -a Local
```

### Addon Installation Failed

**Problem:** Auto-install of addon fails on first run

**Solution:**

See [Manual Install](../ui-addon/installation.md#method-2-manual-install-from-github-releases) for instructions on downloading and extracting the platform tarball manually.

### Node Version Too Old

**Problem:** `requires Node.js >= 18.0.0`

**Solution:**

```bash
# Install Node 18+ via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
nvm alias default 18
```

## Next Steps

<div class="grid cards" markdown>

- **MCP Setup**

    Configure for use with Claude Desktop, Cursor, or other MCP clients.

    [→ MCP Setup](mcp-setup.md)

- **First Command**

    List your WordPress sites and run your first CLI command.

    [→ Commands](commands.md)

- **WPE Authentication**

    Connect your WP Engine account for remote site management.

    [→ Authentication](authentication.md)

- **Examples**

    See real-world CLI usage examples.

    [→ Examples](examples.md)

</div>

## Support

- **Documentation:** https://jpollock.github.io/local-addon-nexus-ai
- **Issues:** https://github.com/jpollock/local-addon-nexus-ai/issues
- **Discussions:** https://github.com/jpollock/local-addon-nexus-ai/discussions

---

**Installation complete!** Run `nexus doctor` to verify, then `nexus mcp setup` to connect your AI agent.
