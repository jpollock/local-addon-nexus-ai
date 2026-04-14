---
title: UI Quick Start
description: Get started with Nexus AI UI addon in 3 minutes
keywords: [ui, addon, local, quick-start, installation, getting-started]
---

# UI Quick Start

Get up and running with the Nexus AI UI addon in 3 minutes.

## Prerequisites

Before you begin, make sure you have:

- **Local by WP Engine** installed ([download](https://localwp.com))
- At least one WordPress site in Local

## Installation

### Install via CLI (Recommended)

Install the CLI globally — the addon is auto-installed into Local on first run:

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

Open Local by WP Engine and the Nexus AI addon activates automatically.

!!! info "No separate addon download needed"
    The CLI (`npm install -g`) handles everything. It downloads and installs the platform-specific addon into Local automatically on first run. No manual download or ZIP installation required.

### Manual Install (Advanced)

If you need to install the addon separately:

1. Download the platform tarball from [releases.elasticapi.io](https://releases.elasticapi.io/nexus-ai/latest.json) (`.tgz` file for your platform)
2. Extract it to Local's addon directory — see [full instructions](../ui-addon/installation.md#method-2-manual-install-from-releases)
3. Restart Local

### Verify

```bash
nexus doctor
```

Every `⚠️` or `❌` includes the exact command to fix it.

## First Launch

1. **Open Nexus AI:**

   Click the **Nexus AI** icon in the Local toolbar (top-right).

   ![Nexus AI toolbar icon](../assets/nexus-toolbar-icon.png)

2. **The sidebar opens:**

   You'll see the Nexus AI sidebar with several panels:

   - **Fleet Overview** - Dashboard of all sites
   - **Site Finder** - AI-powered site search
   - **WPE Management** - Manage WP Engine sites
   - **Bulk Operations** - Perform operations on multiple sites
   - **Preferences** - Configure settings

## First Steps

### 1. Fleet Overview

The Fleet Overview shows all your sites at a glance.

**What you'll see:**

- Total sites (running vs halted)
- WordPress version distribution
- Sites needing updates
- WP Engine linked sites
- Health status indicators

![Fleet Overview](../assets/fleet-overview.png)

**Quick actions:**

- Click **Scan All Sites** to index content
- Click site name to view details
- Hover over charts for details

### 2. Scan Your Sites

Index your WordPress content for AI-powered search and analysis.

1. Click **Fleet Overview**
2. Click **Scan All Sites** button
3. Watch progress in real-time

![Scanning progress](../assets/scan-progress.png)

**What gets indexed:**

- ✅ Posts & pages (title, content, excerpt, meta)
- ✅ WooCommerce products (price, SKU, stock, attributes)
- ✅ ACF fields (text, textarea, repeater, group, flexible)
- ✅ Media attachments (alt text, captions)
- ✅ Themes & plugins (name, version, description)
- ✅ Users (username, roles — no PII)

!!! tip "Scan Time"
    Scanning is fast: ~2-5 seconds per site with 1,000+ posts. All scans run in parallel.

### 3. Find Sites with Site Finder

Use natural language to find sites.

1. Click **Site Finder** panel
2. Type a query:
   - "WooCommerce sites"
   - "Sites running WordPress 6.4"
   - "Needs plugin updates"
   - "Linked to WP Engine"
3. See results instantly

![Site Finder](../assets/site-finder.png)

**Try these queries:**

- `outdated` - Sites with old WordPress versions
- `woocommerce` - E-commerce sites
- `staging` - Staging environments
- `halted` - Stopped sites

### 4. Connect WP Engine Sites

Link your WP Engine sites to Local for unified management.

1. Click **WPE Management** panel
2. Click **Connect WP Engine Account**
3. Sign in with WP Engine credentials
4. See all your WPE installs

![WPE Management](../assets/wpe-management.png)

**What you can do:**

- View all WPE accounts and installs
- Pull WPE sites to Local
- Compare staging and production
- Create backups
- Promote staging to production
- Run diagnostics

### 5. Bulk Operations

Perform operations on multiple sites at once.

1. Click **Bulk Operations** panel
2. Select operation:
   - Scan sites
   - Update plugins
   - Update WordPress core
   - Activate/deactivate plugins
   - Run custom WP-CLI commands
3. Choose target sites (or select all)
4. Click **Execute**
5. Watch progress in real-time

![Bulk Operations](../assets/bulk-operations.png)

**Example: Update plugins on all running sites**

1. Operation: **Update Plugins**
2. Target: **All running sites** (checkbox)
3. Options: **Update all plugins** (checkbox)
4. Click **Execute**
5. See results:
   ```
   ✓ mysite (3 plugins updated)
   ✓ blog (1 plugin updated)
   ✓ shop (5 plugins updated)

   Completed 3 sites in 45 seconds
   ```

## Common Workflows

### Daily Morning Check

1. Open **Fleet Overview**
2. Check **Health Summary** widget
3. Click **Sites Needing Attention** to see issues
4. Click **Scan All Sites** to catch new content
5. Review plugin updates in **Updates Available** widget

### Before Client Meeting

1. Open **Fleet Overview**
2. Use **Site Finder** to search for client sites
3. View all matching sites at once
4. Run **Bulk Operations → Site Health Check** on selected sites
5. Take screenshots for report

### Weekly Maintenance

1. **Saturday morning:**
   - Scan all sites
   - Review updates available
   - Create WPE backups

2. **Saturday afternoon (staging):**
   - Update plugins on staging sites
   - Update WordPress core on staging
   - Run diagnostics

3. **Sunday (production):**
   - Compare staging vs production
   - Promote staging if tests pass
   - Verify production health

### Emergency Plugin Deactivation

1. Open **Bulk Operations**
2. Operation: **Deactivate Plugin**
3. Plugin: `problematic-plugin`
4. Target: **All running sites**
5. Click **Execute**
6. See instant results across fleet

## WP Engine Integration

### Pull Site to Local

Work on production sites locally.

1. Open **WPE Management**
2. Find the site to pull
3. Click **Pull to Local**
4. Choose options:
   - Include database (yes/no)
   - Include files (yes/no)
   - Site name for local copy
5. Click **Pull**
6. Wait for completion (~2-5 minutes)
7. Site appears in Local sidebar

### Push Changes to WPE

Deploy local changes to WP Engine.

1. Make changes locally
2. Open **WPE Management**
3. Find the linked WPE site
4. Click **Push to WPE**
5. Choose options:
   - Include database (⚠️ overwrites remote!)
   - Include files (yes/no)
6. Confirm action
7. Wait for completion

!!! warning "Database Push"
    Pushing database to WPE **overwrites the remote database**. Always create a backup first!

### Compare Environments

Before promoting staging to production.

1. Open **WPE Management**
2. Select a site
3. Click **Compare Environments**
4. See differences:
   - WordPress version
   - Plugin versions
   - Theme versions
   - Post count
   - File count
5. Decide if safe to promote

## Keyboard Shortcuts

Speed up your workflow with keyboard shortcuts.

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open Site Finder |
| `Cmd/Ctrl + Shift + F` | Toggle Fleet Overview |
| `Cmd/Ctrl + Shift + S` | Scan all sites |
| `Cmd/Ctrl + Shift + B` | Open Bulk Operations |
| `Escape` | Close sidebar |

[Full Keyboard Reference →](../ui-addon/keyboard-shortcuts.md)

## Preferences

Customize Nexus AI to your workflow.

1. Click **Preferences** panel
2. Configure settings:

   **General:**
   - Auto-scan on startup
   - Scan interval (daily, weekly, manual)
   - Show notifications
   - Confirm destructive operations

   **AI:**
   - AI provider (Ollama, OpenAI, Anthropic)
   - Model selection
   - Streaming responses
   - Context window size

   **WP Engine:**
   - Auto-sync credentials
   - SSH ControlMaster
   - Parallel operations limit
   - Backup before promote

   **Telemetry:**
   - Enable anonymous analytics
   - View data collected
   - Clear telemetry events

[Preferences Guide →](../ui-addon/preferences.md)

## Troubleshooting

### Sidebar Doesn't Open

If clicking the toolbar icon doesn't open the sidebar:

1. Restart Local completely (Quit, not just close window)
2. Check that addon is enabled:
   - **Preferences → Addons**
   - "Nexus AI" should be checked
3. Check for errors:
   - **Help → Reveal Logs Folder**
   - Look in `main.log` for errors

### Sites Not Showing

If sites aren't appearing in Fleet Overview:

1. **Refresh the view:**
   - Click **Refresh** button in Fleet Overview
   - Or close/reopen sidebar

2. **Check Local sites:**
   - Sites must be visible in Local's main sidebar
   - If sites are missing there, they won't appear in Nexus

3. **Rescan:**
   - Click **Scan All Sites**
   - Wait for completion

### Scan Fails

If scanning fails on a specific site:

1. **Check site is running:**
   - Running sites show green indicator
   - Halted sites can't be scanned

2. **Check site is healthy:**
   - Right-click site in Local
   - **Open Site Shell**
   - Run: `wp core verify-checksums`

3. **Try individual scan:**
   - In Fleet Overview, click site name
   - Click **Scan This Site**
   - Check error message

### WPE Connection Issues

If WP Engine sites don't appear:

1. **Re-authenticate:**
   - **WPE Management → Disconnect**
   - **Connect WP Engine Account**
   - Sign in again

2. **Check credentials:**
   - **Connect → WP Engine** in Local
   - Verify signed in

3. **Check internet connection:**
   - WPE requires internet access
   - Test: `ping wpengineapi.com`

[Troubleshooting Guide →](../cli/troubleshooting.md)

## Tips and Tricks

### Quick Site Access

- **Double-click site** in Fleet Overview to open in browser
- **Right-click site** for context menu:
  - Open in browser
  - Open admin
  - Open Site Shell
  - Reveal in Local

### Efficient Scanning

- **Scan on schedule:** Set auto-scan in Preferences
- **Scan after changes:** Manual scan after bulk operations
- **Skip unchanged:** Recent scans are skipped automatically

### Bulk Operations Best Practices

- **Start small:** Test on 1-2 sites before running fleet-wide
- **Check status first:** Ensure sites are running before bulk updates
- **Monitor progress:** Watch the real-time progress panel
- **Review results:** Check per-site results for any failures

## Next Steps

### Learn More

- **[Fleet Overview](../ui-addon/fleet-overview.md)** - Detailed fleet dashboard guide
- **[Site Finder](../ui-addon/site-finder.md)** - Advanced search patterns
- **[WPE Management](../ui-addon/wpe-management.md)** - WP Engine integration
- **[Bulk Operations](../ui-addon/bulk-operations.md)** - Fleet management
- **[Preferences](../ui-addon/preferences.md)** - Customize your workflow

### Combine with CLI

For maximum power, use both UI and CLI:

- **UI** for visual overview and discovery
- **CLI** for automation and scripting
- **Both** share the same database and settings

```bash
# Install CLI (addon auto-installs on first run)
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# Connect to AI assistant (auto-configure, then restart the client)
nexus mcp setup --agent claude-desktop --write
# or: cursor, windsurf, cline, gemini, claude-code
```

[CLI Quick Start →](cli-quick-start.md)

### Advanced Features

- **[Semantic Search](../features/semantic-search.md)** - How vector search works
- **[Safety System](../features/safety-system.md)** - Understanding safety tiers
- **[Keyboard Shortcuts](../ui-addon/keyboard-shortcuts.md)** - Efficiency tips
- **[MCP Tools](../mcp-tools/index.md)** - Use with AI assistants

## Help and Support

- **GitHub Issues:** [Report bugs](https://github.com/jpollock/local-addon-nexus-ai/issues)
- **Discussions:** [Ask questions](https://github.com/jpollock/local-addon-nexus-ai/discussions)
- **Documentation:** [Full docs](../index.md)

---

**You're ready to go!** Start by opening Fleet Overview and scanning your sites.

1. Click **Nexus AI** toolbar icon
2. Click **Fleet Overview**
3. Click **Scan All Sites**
4. Explore your WordPress fleet with AI-powered tools
