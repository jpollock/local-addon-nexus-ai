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
    - Installs the Nexus AI addon
    - Activates the addon
    - Waits for GraphQL server to be ready

    Just install the CLI and run commands - everything else is automatic!

## Installation

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

After installation, the `nexus` command is available globally.

### First Run

On first run, the CLI automatically handles all setup:

```bash
$ nexus sites list

🔧 Connecting to Local...
🔧 Starting Local...
🔧 Addon not installed. Installing...
🔧 Activating addon...
🔧 Waiting for GraphQL...
🔧 GraphQL server ready.

Local Sites:
  (no sites yet)
```

**What just happened:**

1. ✅ Detected Local is installed
2. ✅ Started Local automatically
3. ✅ Installed Nexus AI addon
4. ✅ Activated the addon
5. ✅ Waited for GraphQL server
6. ✅ Executed your command

Subsequent runs are instant - no bootstrap overhead.

## Verify Installation

```bash
# Check version
nexus --version
# local-addon-nexus-ai v0.1.0

# List available commands
nexus --help

# List your sites
nexus sites
```

Expected output:
```
Local Sites (0 running, 0 halted):
  No local sites found. Create one in Local or: nexus local create <name>

WP Engine Sites:
  Not authenticated. Run: nexus wpe auth
```

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

```bash
# Manually install addon
# 1. Download addon ZIP from releases
# 2. Local → Preferences → Addons → Install from disk
# 3. Select the ZIP file
# 4. Restart Local
```

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

**Installation complete!** Run `nexus --help` to see available commands.
