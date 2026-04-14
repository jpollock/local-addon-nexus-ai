---
title: CLI Quick Start
description: Get started with Nexus AI CLI in 5 minutes
keywords: [cli, quick-start, installation, mcp, claude, cursor, getting-started]
---

# CLI Quick Start

Get up and running with Nexus AI CLI in 5 minutes.

## Prerequisites

Before you begin, make sure you have:

- **Local by WP Engine** installed ([download](https://localwp.com))
- **Node.js 18+** installed ([download](https://nodejs.org))
- At least one WordPress site in Local (optional for first run)

!!! tip "Zero Configuration"
    The CLI handles everything automatically:

    - ✅ Auto-starts Local if not running
    - ✅ Auto-downloads platform-specific addon from releases.elasticapi.io (~300 MB)
    - ✅ Auto-installs and activates addon
    - ✅ No manual setup required!

    **Supported:** macOS (Apple Silicon/Intel), Windows, Linux

## Installation

Install Nexus AI globally via npm:

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

This installs the `nexus` CLI command. The addon is auto-downloaded from releases.elasticapi.io on first run.

!!! info "Auto-Install on First Run"
    When you run your first command, the CLI:

    1. Detects your platform (macOS ARM64/x64, Windows, or Linux)
    2. Prompts: "Download and install addon from GitHub? (Y/n)"
    3. Downloads the platform-specific tarball (~300 MB with all dependencies)
    4. Extracts to Local's addon directory
    5. Activates the addon automatically
    6. Prompts you to restart Local

**Verify installation:**

```bash
nexus doctor
```

This checks every layer of the stack and tells you exactly what to do next:

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
  3. Set up a WordPress site:  nexus ai setup <sitename>
```

Any `⚠️` or `❌` line includes the exact command to fix it. Run `nexus doctor` anytime something is broken — it's the fastest way to diagnose issues.

## First Steps

### 1. Connect Your AI Agent

The fastest path to value — no API key required:

```bash
nexus mcp setup
```

Select your AI agent (Claude Code, Claude Desktop, Cursor, Windsurf, etc.). The command writes the MCP configuration automatically. Ask your AI agent "list my WordPress sites" to confirm it's working.

### 2. List Your Sites

See all your WordPress sites (local and WP Engine):

```bash
nexus list
```

**Output:**

```
Local Sites (3 running, 1 halted)
┌─────────────┬────────────────────────┬──────────┬────────────┐
│ Name        │ Domain                 │ Status   │ WP Version │
├─────────────┼────────────────────────┼──────────┼────────────┤
│ mysite      │ mysite.local           │ running  │ 6.4.3      │
│ blog        │ blog.local             │ running  │ 6.4.2      │
│ shop        │ shop.local             │ running  │ 6.3.1      │
│ test        │ test.local             │ halted   │ 6.4.0      │
└─────────────┴────────────────────────┴──────────┴────────────┘
```

### 2. Scan Your Sites

Index your WordPress content into the vector database for AI-powered search:

```bash
nexus scan
```

**Output:**

```
Scanning 3 sites...

✓ mysite (5,432 posts) - 12.3s
✓ blog (1,234 posts) - 4.2s
✓ shop (8,901 products) - 18.7s

Completed 3 sites in 35.2s
Total indexed: 15,567 documents (89MB)
```

!!! tip "What Gets Indexed"
    Nexus indexes posts, pages, WooCommerce products, ACF fields, media, themes, plugins, and site configuration. No passwords or sensitive data is collected.

### 3. Search Your Content

Use semantic search to find content across all sites:

```bash
nexus search "how to optimize images"
```

**Output:**

```json
{
  "query": "how to optimize images",
  "results": [
    {
      "site": "blog",
      "type": "post",
      "title": "WordPress Image Optimization Guide",
      "url": "https://blog.local/optimize-images",
      "excerpt": "Learn how to compress and lazy-load images...",
      "score": 0.92,
      "post_id": 123
    },
    {
      "site": "blog",
      "type": "post",
      "title": "WebP Conversion for WordPress",
      "url": "https://blog.local/webp-images",
      "excerpt": "Converting images to WebP format reduces...",
      "score": 0.88,
      "post_id": 456
    }
  ],
  "total": 2,
  "time_ms": 42
}
```

!!! info "Semantic Search"
    Unlike keyword search, semantic search understands **meaning**. Searching for "optimize images" also finds posts about image compression, lazy loading, WebP, and CDN usage.

### 4. Manage Plugins

List and manage plugins on your sites:

```bash
# List all plugins
nexus plugin list mysite

# List active plugins only
nexus plugin list mysite --status active

# List plugins with updates available
nexus plugin list mysite --updates
```

**Output:**

```
Plugins on mysite (15 total, 12 active)

Active Plugins:
✓ Akismet Anti-Spam 5.3 (update available: 5.3.1)
✓ Yoast SEO 21.9
✓ WooCommerce 8.5.2

Inactive Plugins:
○ Classic Editor 1.6.3
○ Hello Dolly 1.7.2

3 updates available
```

**Update plugins:**

```bash
# Update specific plugin
nexus plugin update mysite akismet

# Update all plugins
nexus plugin update mysite --all
```

### 5. Run WP-CLI Commands

Execute any WP-CLI command on your sites:

```bash
# Get WordPress version
nexus wp mysite core version

# List users
nexus wp mysite user list

# Get option value
nexus wp mysite option get siteurl

# Check site health
nexus wp mysite site health --format=summary
```

**Output:**

```bash
$ nexus wp mysite core version
6.4.3

$ nexus wp mysite user list --format=table
+----+----------+------------------+
| ID | user_login | user_email     |
+----+----------+------------------+
| 1  | admin    | admin@mysite.local |
+----+----------+------------------+
```

## Connect to AI Assistants

The real power of Nexus AI comes from connecting it to AI assistants via the Model Context Protocol (MCP).

### Claude Desktop

1. **Auto-configure Claude Desktop:**

   ```bash
   nexus mcp setup --agent claude-desktop --write
   ```

2. **Restart Claude Desktop completely** (quit and reopen, don't just close the window)

3. **Verify connection:**

   Look for "nexus-ai" in Claude's available tools (click the 🔌 icon).

4. **Try it out:**

   Ask Claude natural language questions:

   - "List all my WordPress sites"
   - "Find posts about SEO on my blog"
   - "What plugins are installed on mysite?"
   - "Update WordPress on all my staging sites"

!!! info "Local must be running"
    The MCP server runs inside the Local addon. Local by WP Engine must be open and running for AI tools to work.

[Detailed Claude Setup →](../cli/mcp-setup.md#claude-desktop)

### Cursor IDE

1. **Auto-configure Cursor:**

   ```bash
   nexus mcp setup --agent cursor --write
   ```

2. **Restart Cursor**

3. **Use in chat:**

   - "Check which WordPress sites need updates"
   - "Find all posts mentioning WooCommerce"
   - "Show me plugins that have security updates"

[Detailed Cursor Setup →](../cli/mcp-setup.md#cursor-ide)

### Other AI Clients

Nexus AI supports all major MCP clients via `nexus mcp setup`:

```bash
nexus mcp setup --agent windsurf --write   # Windsurf
nexus mcp setup --agent cline --write      # Cline (VS Code)
nexus mcp setup --agent gemini --write     # Gemini CLI
nexus mcp setup --agent claude-code --write # Claude Code
```

## Common Tasks

### Daily Site Check

```bash
#!/bin/bash
# Check all sites at once

# List sites
nexus list

# Scan for new content
nexus scan

# Check for plugin updates
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  nexus plugin list $site --updates
done
```

### Update All Plugins

```bash
# Update plugins on all running sites
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  echo "Updating plugins on $site..."
  nexus plugin update $site --all
done
```

### Content Search

```bash
# Find all posts about a topic
nexus search "WordPress security" --type post --limit 20

# Search specific site
nexus search "shipping options" --site shop

# Search products only
nexus search "blue widgets" --type product
```

## WP Engine Integration

If you have WP Engine sites, you can manage them too:

### 1. Authenticate with WP Engine

In Local by WP Engine, go to **Connect → WP Engine** and sign in, or use the CLI: `nexus wpe login`. Your credentials are automatically synced.

### 2. List WP Engine Sites

```bash
# List all WPE accounts
nexus wpe accounts

# List all WPE installs
nexus wpe installs

# List production installs only
nexus wpe installs --environment production
```

### 3. Manage Remote Sites

```bash
# Diagnose site health
nexus wpe diagnose mysite-production

# Compare staging and production
nexus wpe diff mysite

# Create backup
nexus wpe backup mysite-production

# Promote staging to production
nexus wpe promote mysite
```

### 4. Run WP-CLI on Remote Sites

```bash
# Works the same as local sites
nexus wp mysite-production core version

# List plugins on production
nexus plugin list mysite-production

# Update plugins on staging
nexus plugin update mysite-staging --all
```

[WP Engine Guide →](../cli/wpe-sites.md)

## Best Practices

### 1. Regular Scans

Scan your sites regularly to keep the index fresh:

```bash
# Force re-scan of all sites
nexus scan --force

# Scan only local sites
nexus scan --local-only

# Scan specific site
nexus scan mysite
```

**Recommendation:** Scan daily or after major content changes.

### 2. Before Making Changes

Always check current state before modifications:

```bash
# Check plugins before updating
nexus plugin list mysite

# Check WordPress version before upgrading
nexus wp mysite core version

# Check site health before changes
nexus wp mysite site health
```

### 3. Use Bulk Operations

For fleet management, use bulk operations instead of loops:

```bash
# Bad: Sequential updates (slow)
for site in site1 site2 site3; do
  nexus plugin update $site akismet
done

# Good: Parallel bulk operation (fast)
nexus bulk update-plugin akismet --sites site1,site2,site3
```

### 4. Version Control Your Scripts

Save common workflows as scripts:

```bash
# morning-check.sh
#!/bin/bash
nexus list
nexus scan --local-only
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  nexus plugin list $site --updates
done
```

Make it executable:

```bash
chmod +x morning-check.sh
./morning-check.sh
```

## Troubleshooting

### Start Here

```bash
nexus doctor
```

Run this before anything else. It checks every layer of the stack and prints the exact fix for each issue.

### CLI Not Found

If `nexus` command is not found after installation:

```bash
# Check npm global bin path
npm config get prefix

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$PATH:$(npm config get prefix)/bin"
```

### Sites Not Showing

If `nexus list` shows no sites:

1. **Check Local is running:**
   ```bash
   # Open Local app
   open -a Local
   ```

2. **Verify Local sites exist:**
   - Open Local app
   - Check that sites are visible in sidebar

3. **Check Local path:**
   ```bash
   # Default: ~/Local Sites
   ls -la ~/Local\ Sites
   ```

### Scan Fails

If `nexus scan` fails:

1. **Check site is running:**
   ```bash
   nexus list --running
   ```

2. **Try scanning individual site:**
   ```bash
   nexus scan mysite --debug
   ```

3. **Check database connection:**
   ```bash
   nexus wp mysite db check
   ```

### MCP Connection Issues

If AI assistant doesn't see Nexus tools:

1. **Re-run the setup command:**
   ```bash
   # Re-run the setup command
   nexus mcp setup --agent claude-desktop --write
   # Then restart Claude Desktop completely
   ```

2. **Make sure Local by WP Engine is running** — the MCP server lives inside the Local addon and requires Local to be open.

3. **Restart AI client completely:**
   - Quit the application (not just close window)
   - Reopen

4. **Check logs:**
   ```bash
   tail -f ~/.nexus/logs/mcp.log
   ```

[Full Troubleshooting Guide →](../cli/troubleshooting.md)

## Configuration

### Custom Database Path

```bash
# Set custom database location
export NEXUS_DB_PATH=/custom/path/nexus.db

# Or configure permanently
nexus config set db.path /custom/path/nexus.db
```

### Disable Telemetry

```bash
# Disable anonymous usage analytics
nexus telemetry disable

# Or via environment variable
export NEXUS_TELEMETRY=false
```

### AI Provider

```bash
# Use different AI provider for embeddings
nexus config set ai.provider ollama
nexus config set ai.model nomic-embed-text
```

[Command Reference →](../cli/commands.md)

## Next Steps

### Learn More

- **[CLI Examples](../cli/examples.md)** - Real-world usage patterns
- **[CLI Commands](../reference/cli-command-reference.md)** - Complete command reference
- **[MCP Tools](../mcp-tools/index.md)** - All 160+ tools available to AI assistants
- **[WP Engine Management](../cli/wpe-sites.md)** - Remote site management

### Connect AI Assistants

- **[Claude Desktop](../cli/mcp-setup.md#claude-desktop)** - Detailed setup
- **[Cursor IDE](../cli/mcp-setup.md#cursor-ide)** - Detailed setup
- **[Zed Editor](../cli/mcp-setup.md#zed-editor)** - Detailed setup
- **[Continue.dev](../cli/mcp-setup.md#continuedev)** - Detailed setup

### Advanced Topics

- **[Architecture](../architecture/overview.md)** - How Nexus AI works
- **[Vector Search](../features/semantic-search.md)** - Understanding semantic search
- **[WP-CLI Integration](../features/wp-cli-integration.md)** - Remote WP-CLI execution
- **[Safety System](../features/safety-system.md)** - 3-tier safety protection

## Help and Support

- **GitHub Issues:** [Report bugs](https://github.com/jpollock/local-addon-nexus-ai/issues)
- **Discussions:** [Ask questions](https://github.com/jpollock/local-addon-nexus-ai/discussions)
- **Documentation:** [Full docs](../index.md)

---

**You're ready to go!** Start by scanning your sites and connecting to an AI assistant.

```bash
# Scan all sites
nexus scan

# Connect to Claude Desktop (auto-configure, then restart)
nexus mcp setup --agent claude-desktop --write
# Then ask Claude: "List all my WordPress sites"
```
