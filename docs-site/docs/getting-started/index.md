---
title: Getting Started
description: Get up and running with Nexus AI in minutes
keywords: [getting started, quick start, installation, setup]
---

# Getting Started

Get up and running with Nexus AI in 5 minutes.

## Choose Your Interface

Nexus AI has **two interfaces** — pick the one that matches your workflow.

<div class="grid cards" markdown>

<div class="tool-card" markdown>

### 🤖 CLI/MCP Server
**For AI assistants**

Connect Claude Desktop, Cursor, or other MCP clients.

**Best for:**
- AI-driven workflows
- Terminal users
- Automation & scripting
- Remote operations

[CLI Quick Start →](cli-quick-start.md){ .md-button .md-button--primary }

</div>

<div class="tool-card" markdown>

### 🖥️ UI Addon
**For visual workflows**

Install addon in Local app for a dashboard experience.

**Best for:**
- Visual fleet management
- Site exploration
- Bulk operations UI
- Local development

[UI Quick Start →](ui-quick-start.md){ .md-button }

</div>

</div>

!!! tip "Use Both"
    You can use both interfaces simultaneously. They share the same database and indexes.

## Quick Start Paths

### Path 1: CLI/MCP (5 minutes)

```bash
# 1. Install globally
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# 2. Add to Claude Desktop config
# Edit: ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"]
    }
  }
}

# 3. Restart Claude Desktop
# Tools will appear automatically
```

[Detailed CLI Setup →](cli-quick-start.md)

### Path 2: UI Addon (3 minutes)

```bash
# 1. Download latest release
# https://github.com/jpollock/local-addon-nexus-ai/releases

# 2. Install in Local
# Local → Preferences → Addons → Install

# 3. Restart Local
# Click "Nexus AI" in toolbar
```

[Detailed UI Setup →](ui-quick-start.md)

## What You'll Learn

This getting started guide covers:

1. **Installation** - Install CLI or UI addon
2. **First scan** - Index your first WordPress site
3. **First query** - Search indexed content
4. **WPE integration** - Connect WP Engine account (optional)
5. **Next steps** - Where to go from here

**Time required:** 10-15 minutes

## Prerequisites

### System Requirements

- **OS:** macOS, Windows, or Linux
- **Node.js:** 18.x or newer
- **Local:** 9.0.0+ (for UI addon)
- **Memory:** 2 GB available RAM
- **Disk:** 500 MB for indexes (scales with content)

### Optional

- **WP Engine account** - For remote site management
- **Claude Desktop** - For MCP/AI integration
- **Ollama** - For local AI chat (addon only)

### Check Your Setup

```bash
# Node.js version
node --version  # Should be 18.x or newer

# npm version
npm --version

# Local version (if using UI)
# Local → Preferences → About
```

## Common Paths

### I want to use AI to manage WordPress sites

→ [CLI Quick Start](cli-quick-start.md)

Install the CLI/MCP server and connect Claude Desktop. Ask Claude to perform WordPress operations using natural language.

**Example:**
> "List all my WordPress sites, then check which plugins need updates on my production sites."

### I want a visual dashboard for my sites

→ [UI Quick Start](ui-quick-start.md)

Install the Local addon for a fleet overview, semantic search interface, and built-in AI chat.

### I want to manage WP Engine sites

→ [WPE Integration](../integrations/wpe-account.md)

Connect your WP Engine account to sync remote sites, perform SSH operations, and pull sites to local.

### I want to search across all my sites

→ [First Scan](first-scan.md)

Index your sites into the vector database, then use semantic search to find content across your entire fleet.

## What Gets Installed?

### CLI Package

```
~/.npm/
└── local-addon-nexus-ai/
    ├── bin/nexus           # CLI executable
    ├── lib/                # Node.js code
    └── node_modules/       # Dependencies
```

### UI Addon

```
~/Library/Application Support/Local/addons/
└── nexus-ai/
    ├── main.js            # Main process code
    ├── renderer.js        # UI components
    └── node_modules/      # Dependencies
```

### Shared Data

Both interfaces share the same data directory:

```
~/Library/Application Support/nexus-ai/
├── config.json            # User preferences
├── lancedb/              # Vector database
├── index.db              # Site metadata (SQLite)
├── telemetry/            # Analytics queue
└── wpe/                  # WPE auth tokens
```

## First Steps After Install

### 1. Verify Installation

=== "CLI"

    ```bash
    nexus --version
    # Should show: local-addon-nexus-ai vX.X.X
    ```

=== "UI"

    ```
    Open Local → Click "Nexus AI" in toolbar
    # Should see: Fleet Overview panel
    ```

### 2. List Available Sites

=== "CLI"

    ```bash
    nexus sites
    ```

=== "UI"

    ```
    Fleet Overview → Shows all local sites
    ```

### 3. Index Your First Site

[→ First Scan Guide](first-scan.md)

### 4. Try a Search

[→ First AI Query Guide](first-ai-query.md)

## Troubleshooting

### Command not found: nexus

```bash
# Check npm global bin path
npm config get prefix

# Ensure it's in PATH
echo $PATH

# Reinstall
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

### Addon not appearing in Local

```bash
# Check addon installed
ls ~/Library/Application\ Support/Local/addons/

# Check Local version (requires 9.0.0+)
# Local → Preferences → About

# Restart Local
```

### No sites showing

```bash
# CLI: Check Local is running
# UI: Check sites are running in Local

# Start a site
nexus local start mysite
```

## Get Help

- **Documentation:** [https://jpollock.github.io/local-addon-nexus-ai](https://jpollock.github.io/local-addon-nexus-ai)
- **Issues:** [GitHub Issues](https://github.com/jpollock/local-addon-nexus-ai/issues)
- **Discussions:** [GitHub Discussions](https://github.com/jpollock/local-addon-nexus-ai/discussions)

## Next Steps

<div class="grid cards" markdown>

- **First Scan**

    Index a WordPress site into the vector database.

    [→ First Scan](first-scan.md)

- **First AI Query**

    Search indexed content with semantic search.

    [→ First AI Query](first-ai-query.md)

- **WPE Integration**

    Connect your WP Engine account for remote management.

    [→ WPE Setup](../integrations/wpe-account.md)

- **Explore Tools**

    Browse 90+ MCP tools for WordPress operations.

    [→ Tool Reference](../mcp-tools/index.md)

</div>
