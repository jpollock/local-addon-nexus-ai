---
title: Claude Desktop Integration
description: Complete guide to using Nexus AI with Claude Desktop
keywords: [claude, claude-desktop, mcp, integration, setup, anthropic]
---

# Claude Desktop Integration

Complete guide to integrating Nexus AI with Claude Desktop via the Model Context Protocol.

## Overview

Claude Desktop is Anthropic's official desktop application for Claude. With MCP support, Claude can:

- ✅ List and search your WordPress sites
- ✅ Execute WP-CLI commands
- ✅ Manage plugins and themes
- ✅ Perform semantic content search
- ✅ Manage WP Engine sites
- ✅ Automate bulk operations

**Claude Desktop + Nexus AI = Your WordPress Fleet, AI-Powered**

## Prerequisites

Before you begin:

1. **Claude Desktop installed** ([download](https://claude.ai/download))
2. **Nexus AI CLI installed:**
   ```bash
   npm install -g @local-labs-jpollock/local-addon-nexus-ai
   ```
3. **Local with WordPress sites** running (required when tools are invoked)
4. **Claude Pro or Team subscription** (MCP requires paid plan)

!!! info "MCP Availability"
    Model Context Protocol support is currently available to Claude Pro and Claude Team subscribers. Free users cannot use MCP.

## Installation

### Automated Setup (Recommended)

The fastest way to configure Claude Desktop is:

```bash
nexus mcp setup --agent claude-desktop --write
```

This writes the correct config to `~/Library/Application Support/Claude/claude_desktop_config.json` automatically. Then skip to [Step 5: Restart Claude Desktop](#step-5-restart-claude-desktop).

### Manual Setup

### Step 1: Locate Config File

Claude Desktop's MCP configuration is stored in a JSON file:

=== "macOS"

    ```
    ~/Library/Application Support/Claude/claude_desktop_config.json
    ```

    **If directory doesn't exist:**

    ```bash
    mkdir -p ~/Library/Application\ Support/Claude
    touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
    ```

=== "Windows"

    ```
    %APPDATA%\Claude\claude_desktop_config.json
    ```

    **Full path example:**

    ```
    C:\Users\YourName\AppData\Roaming\Claude\claude_desktop_config.json
    ```

=== "Linux"

    ```bash
    ~/.config/Claude/claude_desktop_config.json
    ```

### Step 2: Edit Config File

Open the config file in your preferred editor:

```bash
# macOS
open -a "TextEdit" ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Or use VS Code
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Step 3: Find the Bridge Path

Nexus AI uses a **stdio bridge** to communicate with Claude Desktop. Get the correct path for your system:

```bash
nexus mcp setup --agent claude-desktop
```

This prints the exact JSON block to paste, with the absolute path to `mcp-stdio.js` already filled in.

### Step 4: Add Nexus AI Server

Add this configuration (replace the path with the one from Step 3):

```json
{
  "mcpServers": {
    "local-nexus-ai": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@local-labs-jpollock/local-addon-nexus-ai/bin/mcp-stdio.js"]
    }
  }
}
```

!!! important "Use node + mcp-stdio.js, not `nexus mcp`"
    Claude Desktop requires the `node` command with the absolute path to `bin/mcp-stdio.js`. Do **not** use `"command": "nexus"` — that form does not work reliably with Claude Desktop.

**If you already have other MCP servers:**

```json
{
  "mcpServers": {
    "existing-server": {
      "command": "some-command",
      "args": ["arg1", "arg2"]
    },
    "local-nexus-ai": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@local-labs-jpollock/local-addon-nexus-ai/bin/mcp-stdio.js"]
    }
  }
}
```

### Verify JSON Syntax

Validate your JSON before restarting Claude:

```bash
# macOS/Linux
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq
```

If `jq` reports errors, fix the JSON syntax. Common mistakes:

- ❌ Missing comma between servers
- ❌ Trailing comma after last item
- ❌ Unquoted strings
- ❌ Single quotes instead of double quotes

### Step 5: Restart Claude Desktop {#step-5-restart-claude-desktop}

**Important:** Fully quit Claude Desktop (not just close the window):

=== "macOS"

    1. Click **Claude** in menu bar
    2. Select **Quit Claude**
    3. Or press `Cmd + Q`

=== "Windows"

    1. Right-click Claude in system tray
    2. Select **Quit**
    3. Or press `Alt + F4`

Then reopen Claude Desktop.

### Step 6: Verify Connection

Look for the MCP indicator in Claude Desktop:

1. Open a conversation
2. Look for the **🔌 icon** in the bottom-right
3. Click it to see available tools
4. You should see "nexus-ai" listed

![MCP tools indicator](../assets/claude-mcp-tools.png)

**If you see Nexus AI tools, you're ready!**

## First Conversation

### 1. List Your Sites

```
You: List all my WordPress sites

Claude: Let me check your WordPress sites...

[Uses nexus_list_sites tool]

You have 3 local WordPress sites and 2 WP Engine sites:

Local Sites:
1. mysite (mysite.local) - WordPress 6.4.3, running
   - Linked to WP Engine (mysite-production)
2. blog (blog.local) - WordPress 6.4.2, running
3. shop (shop.local) - WordPress 6.3.1, halted

WP Engine Sites:
1. mysite-production (mysite.wpengine.com) - active
2. mysite-staging (mysite.wpenginepowered.com) - active

Would you like more details about any of these sites?
```

### 2. Check Site Health

```
You: What plugins are installed on mysite?

Claude: Let me check the plugins on mysite...

[Uses wp_plugin_list tool]

Found 15 plugins on mysite:

Active Plugins (12):
✓ Akismet Anti-Spam 5.3 (update available to 5.3.1)
✓ Yoast SEO 21.9 (latest)
✓ WooCommerce 8.5.2 (latest)
✓ WP Super Cache 1.9.3 (latest)
✓ Contact Form 7 5.8.7 (latest)
✓ Advanced Custom Fields PRO 6.2.6 (latest)
✓ WP Migrate DB Pro 2.6.7 (latest)
✓ Wordfence Security 7.11.1 (latest)
✓ UpdraftPlus 1.23.14 (latest)
✓ Redirection 5.4.2 (latest)
✓ WP Mail SMTP 4.0.0 (latest)
✓ MonsterInsights 8.26.0 (latest)

Inactive Plugins (3):
○ Classic Editor 1.6.3
○ Hello Dolly 1.7.2
○ Jetpack 13.0

Summary:
- 1 update available (Akismet)
- 3 inactive plugins taking up space

Would you like me to update Akismet or remove the inactive plugins?
```

### 3. Search Content

```
You: Find all posts about WordPress security on my blog

Claude: Searching for posts about WordPress security on blog...

[Uses search_site_content tool]

Found 8 posts about WordPress security on blog:

1. "Complete WordPress Security Checklist" (2026-03-15)
   → 30-point checklist for hardening WordPress
   Similarity: 0.94

2. "Two-Factor Authentication Setup Guide" (2026-03-10)
   → Step-by-step 2FA setup with plugins
   Similarity: 0.89

3. "Firewall Configuration for WordPress" (2026-03-05)
   → WAF setup and best practices
   Similarity: 0.87

4. "Security Headers You Should Enable" (2026-02-28)
   → X-Frame-Options, CSP, HSTS configuration
   Similarity: 0.85

5. "WordPress Backup Best Practices" (2026-02-20)
   → Backup strategies and restoration
   Similarity: 0.82

6. "SSL Certificate Setup Guide" (2026-02-15)
   → Let's Encrypt and HTTPS migration
   Similarity: 0.80

7. "Preventing Brute Force Attacks" (2026-02-10)
   → Login protection techniques
   Similarity: 0.78

8. "Security Plugins Comparison" (2026-02-05)
   → Wordfence vs Sucuri vs iThemes
   Similarity: 0.76

These posts cover authentication, firewalls, headers, backups, SSL, and attack prevention.

Would you like me to show excerpts from any specific post?
```

### 4. Perform Updates

```
You: Update all plugins on mysite-staging

Claude: I'll update all plugins on mysite-staging. Let me first check what needs updating...

[Uses wp_plugin_list with --updates]

Found 3 plugins with updates available on mysite-staging:
- Akismet 5.3 → 5.3.1
- Yoast SEO 21.8 → 21.9
- WooCommerce 8.5.1 → 8.5.2

This is a staging site, so updates are safe to apply. Proceeding...

[Uses wp_plugin_update]

✓ Akismet updated to 5.3.1
✓ Yoast SEO updated to 21.9
✓ WooCommerce updated to 8.5.2

All 3 plugins successfully updated on mysite-staging.

Since this worked on staging, would you like me to update production as well? I recommend:
1. Test the staging site first
2. Compare staging vs production
3. Create a backup of production
4. Apply the same updates to production

Would you like me to proceed with these steps?
```

## Real-World Use Cases

### Use Case 1: Fleet Health Check

**Morning routine:**

```
You: Check the health of all my WordPress sites

Claude: Running health checks on all sites...

[Uses nexus_list_sites + wp_core_version + wp_plugin_list]

Health Summary:

✅ Healthy Sites (2):
1. mysite - WordPress 6.4.3, all plugins latest
2. blog - WordPress 6.4.2, all plugins latest

⚠️ Needs Attention (1):
1. shop - WordPress 6.3.1 (outdated), 5 plugin updates available

❌ Offline (0):
None

Recommendations:
- Update shop to WordPress 6.4.3
- Update 5 plugins on shop (Akismet, Yoast, WooCommerce, Contact Form 7, Wordfence)

Would you like me to update shop? I can:
1. Create a backup first
2. Update WordPress core
3. Update all plugins
4. Verify site health after updates
```

### Use Case 2: Content Research

**Find content gaps:**

```
You: What SEO topics have I written about on blog, and what am I missing?

Claude: Analyzing SEO content on blog...

[Uses search_site_content with various SEO queries]

You've written about (12 posts total):
✓ On-page SEO (5 posts)
✓ Meta descriptions (3 posts)
✓ Schema markup (2 posts)
✓ Site speed (2 posts)

Content gaps (common SEO topics not found):
- Link building strategies (0 posts)
- Core Web Vitals optimization (0 posts)
- International SEO (0 posts)
- E-A-T principles (0 posts)
- Voice search optimization (0 posts)
- Local SEO (0 posts)
- Mobile-first indexing (0 posts)

You have strong on-page coverage but are missing off-page SEO, technical SEO, and modern ranking factors.

Would you like me to create content outlines for any of these topics?
```

### Use Case 3: WP Engine Deployment

**Staging to production workflow:**

```
You: I want to deploy mysite staging to production. What are the steps?

Claude: Let me help you safely deploy mysite-staging to mysite-production. Here's the process:

[Uses wpe_environment_diff to compare]

Step 1: Compare Environments
Checking differences between staging and production...

Differences found:
- WordPress: staging 6.4.3, production 6.4.2 ✓ Safe
- Akismet: staging 5.3.1, production 5.3 ✓ Safe
- Yoast SEO: staging 21.9, production 21.8 ✓ Safe
- Posts: staging has 5 new posts
- Files: staging has 3 new images

No conflicts detected. Safe to promote.

Step 2: Recommended Pre-Flight Checks
Before promoting, I recommend:
1. ✅ Verify staging site works (manual check)
2. ⏳ Create production backup (I can do this)
3. ⏳ Test staging site health (I can do this)
4. ⏳ Promote staging to production (I can do this)
5. ⏳ Verify production after promotion (I can do this)

Would you like me to proceed with steps 2-5?

You: Yes, proceed

Claude: Starting deployment process...

[Uses wpe_create_backup]
✓ Step 2: Created production backup (backup_abc123)
  Rollback available if needed

[Uses wpe_diagnose_site]
✓ Step 3: Staging health check passed
  - SSL: Valid
  - Backups: Current
  - Performance: Good
  - No PHP errors

[Uses wpe_promote_to_production]
✓ Step 4: Promoting staging to production...
  - Files copied
  - Database synced
  - Cache cleared

Waiting 30 seconds for cache to clear...

[Uses wpe_diagnose_site]
✓ Step 5: Production health check passed
  - WordPress 6.4.3 now running
  - All plugins updated
  - Site responding (HTTP 200)
  - SSL valid

Deployment complete!

Production now matches staging:
- WordPress 6.4.3
- All plugins updated
- 5 new posts published

Rollback command (if needed):
nexus wpe rollback mysite backup_abc123
```

### Use Case 4: Bulk Operations

**Update plugins across all sites:**

```
You: Update Akismet to the latest version on all running sites

Claude: I'll update Akismet across all your running sites. Let me check which sites need updating...

[Uses nexus_list_sites + wp_plugin_list on each]

Sites with Akismet installed (3):
1. mysite - Akismet 5.3 (needs update to 5.3.1)
2. blog - Akismet 5.3 (needs update to 5.3.1)
3. shop - halted (skipping)

I'll update mysite and blog (shop is halted, can't update).

Proceeding with updates...

[Uses wp_plugin_update on each]

✓ mysite: Akismet 5.3 → 5.3.1 (2.3s)
✓ blog: Akismet 5.3 → 5.3.1 (1.9s)

Completed 2 updates in 4.2 seconds.

Summary:
- Updated: 2 sites
- Skipped: 1 site (halted)
- Failed: 0 sites

All running sites now have Akismet 5.3.1!
```

### Use Case 5: Emergency Response

**Deactivate problematic plugin:**

```
You: A plugin is breaking my sites. Deactivate "problematic-plugin" on all sites immediately

Claude: I understand there's an urgent issue. I'll deactivate "problematic-plugin" on all running sites right now.

[Uses nexus_list_sites to find running sites]

Found 2 running sites:
1. mysite
2. blog

Checking which sites have "problematic-plugin" installed...

[Uses wp_plugin_list on each]

Sites with "problematic-plugin" active:
1. mysite - problematic-plugin 1.2.3 (active)
2. blog - problematic-plugin 1.2.3 (active)

Deactivating immediately...

[Uses wp_plugin_deactivate on each]

✓ mysite: Deactivated problematic-plugin (0.8s)
✓ blog: Deactivated problematic-plugin (0.7s)

Both sites complete in 1.5 seconds.

"problematic-plugin" is now deactivated on all sites.

Would you like me to:
1. Check if the sites are now working correctly?
2. Delete the plugin entirely?
3. Check for any remaining errors?
```

## Advanced Configuration

### Custom Database Path

If you store your Nexus database in a custom location:

```json
{
  "mcpServers": {
    "local-nexus-ai": {
      "command": "node",
      "args": ["/path/to/bin/mcp-stdio.js"],
      "env": {
        "NEXUS_DB_PATH": "/custom/path/nexus.db"
      }
    }
  }
}
```

### Debug Mode

Enable debug logging for troubleshooting:

```json
{
  "mcpServers": {
    "local-nexus-ai": {
      "command": "node",
      "args": ["/path/to/bin/mcp-stdio.js"],
      "env": {
        "NEXUS_DEBUG": "true"
      }
    }
  }
}
```

Debug logs appear in:

- **macOS/Linux:** `~/.nexus/logs/mcp.log`
- **Windows:** `%USERPROFILE%\.nexus\logs\mcp.log`

### Multiple Profiles

Run multiple Nexus instances with different databases:

```json
{
  "mcpServers": {
    "nexus-personal": {
      "command": "node",
      "args": ["/path/to/bin/mcp-stdio.js"],
      "env": {
        "NEXUS_DB_PATH": "~/.nexus/personal.db"
      }
    },
    "nexus-work": {
      "command": "node",
      "args": ["/path/to/bin/mcp-stdio.js"],
      "env": {
        "NEXUS_DB_PATH": "~/.nexus/work.db"
      }
    }
  }
}
```

Claude will show both sets of tools prefixed by the server name.

## Troubleshooting

### Connection Issues

**Problem:** Nexus AI doesn't appear in Claude's tool list.

**Solutions:**

1. **Verify Nexus is installed:**
   ```bash
   nexus --version
   ```

2. **Check config file path:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

   # Windows
   type %APPDATA%\Claude\claude_desktop_config.json
   ```

3. **Validate JSON syntax:**
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq
   ```

4. **Check Claude Desktop logs:**

   macOS:
   ```bash
   tail -f ~/Library/Logs/Claude/main.log
   ```

   Windows:
   ```
   %USERPROFILE%\AppData\Local\Claude\logs\main.log
   ```

5. **Restart Claude completely:**
   - Quit Claude Desktop (not just close window)
   - Wait 5 seconds
   - Reopen

### Tool Execution Fails

**Problem:** Tools appear but fail when executed.

**Solutions:**

1. **Check Local is running:**
   ```bash
   nexus list
   ```

2. **Test Nexus CLI directly:**
   ```bash
   nexus scan
   nexus search "test"
   ```

3. **Enable debug mode:**
   ```json
   {
     "mcpServers": {
       "local-nexus-ai": {
         "command": "node",
         "args": ["/path/to/bin/mcp-stdio.js"],
         "env": {
           "NEXUS_DEBUG": "true"
         }
       }
     }
   }
   ```

4. **Check debug logs:**
   ```bash
   tail -f ~/.nexus/logs/mcp.log
   ```

### Slow Performance

**Problem:** Tool calls take a long time.

**Solutions:**

1. **Check database size:**
   ```bash
   nexus db info
   ```

2. **Optimize database:**
   ```bash
   nexus db optimize
   ```

3. **Reduce scan frequency:**
   - Only scan when content changes
   - Use `--site` parameter for specific sites

4. **Check network (WPE sites):**
   - WPE calls require internet
   - SSH ControlMaster speeds up repeated calls

### Permission Issues

**Problem:** "Permission denied" errors.

**Solutions:**

1. **Check Nexus executable permissions:**
   ```bash
   which nexus
   ls -la $(which nexus)
   ```

2. **Reinstall Nexus:**
   ```bash
   npm uninstall -g @local-labs-jpollock/local-addon-nexus-ai
   npm install -g @local-labs-jpollock/local-addon-nexus-ai
   ```

3. **Check file permissions:**
   ```bash
   ls -la ~/.nexus/
   ```

### "Command not found"

**Problem:** Claude reports `node` command not found or bridge fails to start.

**Solutions:**

1. **Verify node is accessible:**
   ```bash
   which node
   node --version
   ```

2. **Use full path to node in config:**
   ```json
   {
     "mcpServers": {
       "local-nexus-ai": {
         "command": "/usr/local/bin/node",
         "args": ["/path/to/bin/mcp-stdio.js"]
       }
     }
   }
   ```

   Find paths:
   ```bash
   which node
   nexus mcp setup --agent claude-desktop
   ```

## Best Practices

### 1. Be Specific

Give Claude clear, specific instructions:

❌ **Vague:**
> "Update my sites"

✅ **Specific:**
> "Update all plugins on mysite-staging, then compare with production"

### 2. Confirm Before Destructive Actions

Always review before Claude performs destructive operations:

```
You: I want to delete all inactive plugins

Claude: I found 5 inactive plugins:
1. Classic Editor on mysite
2. Hello Dolly on mysite
3. Jetpack on blog
4. Akismet on shop (site is halted)
5. Hello Dolly on shop (site is halted)

⚠️ WARNING: This will permanently delete these plugins.

Are you sure you want to proceed? Please confirm by typing "yes, delete them"
```

### 3. Use Natural Language

Claude understands context - speak naturally:

✅ Good questions:
- "Which sites need WordPress updates?"
- "Find posts about WooCommerce on my blog"
- "What's the total number of products across all my shops?"
- "Compare mysite staging and production"

### 4. Ask for Explanations

Claude can explain what it's doing:

```
You: Before updating production, explain what will happen step by step

Claude: Here's exactly what will happen when I update production:

Step 1: Pre-Update Backup
- Create automatic backup of current production state
- Backup includes database + files
- Takes ~30 seconds
- Allows rollback if anything goes wrong

Step 2: Download Updates
- WordPress downloads plugin updates from wordpress.org
- Verifies checksums for security
- Takes ~10 seconds per plugin

Step 3: Deactivate Plugins
- Temporarily deactivates plugins being updated
- Prevents conflicts during update
- Site stays online, features temporarily unavailable

Step 4: Update Files
- Replaces old plugin files with new versions
- Preserves plugin settings/data
- Takes ~5 seconds per plugin

Step 5: Reactivate Plugins
- Runs plugin activation hooks
- Runs database migrations if needed
- Site returns to normal operation

Step 6: Verify Health
- Checks for PHP errors
- Verifies site is responding
- Tests core functionality

Total time: ~2-3 minutes
Downtime: None (site stays online)
Risk: Low (backup created first)

Ready to proceed?
```

### 5. Work Iteratively

Start small, then expand:

```
You: Update Akismet on mysite-staging

Claude: ✓ Updated Akismet on mysite-staging

You: Great, now update it on all staging sites

Claude: ✓ Updated Akismet on 3 staging sites

You: Perfect, now update it on all production sites

Claude: Found 2 production sites. I recommend:
1. Creating backups first (I can do this)
2. Then updating Akismet

Proceed?
```

## Keyboard Shortcuts

Speed up your Claude workflow:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + N` | New conversation |
| `Cmd/Ctrl + K` | Search conversations |
| `Cmd/Ctrl + Shift + L` | Toggle sidebar |
| `Cmd/Ctrl + ,` | Open settings |

## Limitations

**What Claude CAN do:**

- ✅ List and search sites
- ✅ Read plugin/theme information
- ✅ Execute WP-CLI commands
- ✅ Update plugins and WordPress core
- ✅ Search content semantically
- ✅ Manage WP Engine sites
- ✅ Create backups
- ✅ Compare environments

**What Claude CANNOT do:**

- ❌ Access site databases directly (uses WP-CLI)
- ❌ Modify files outside WordPress (security)
- ❌ Execute arbitrary PHP code (security)
- ❌ Access site admin UI (uses CLI only)
- ❌ Browse the web (unless using Claude's web tool)

## Privacy and Security

### What Data is Shared

When you use Nexus AI with Claude:

**Sent to Anthropic:**
- Tool names being called
- Tool parameters (site names, plugin names)
- Tool results (plugin lists, search results)

**NOT sent to Anthropic:**
- WordPress passwords
- Database credentials
- WP Engine API keys (stored locally)
- Site content (unless explicitly searched)
- User emails or PII

### Security Best Practices

1. **Don't share sensitive data in prompts:**
   - ❌ "Update the API key to sk_live_abc123..."
   - ✅ "Update the API key" (Claude will ask you to do it manually)

2. **Use staging sites for testing:**
   - Test destructive operations on staging first
   - Only apply to production after verification

3. **Review before confirming:**
   - Always review what Claude plans to do
   - Confirm destructive operations explicitly

## Next Steps

- **[Cursor Integration](cursor.md)** - Use Nexus in your code editor
- **[MCP Protocol](../architecture/mcp-protocol.md)** - Understanding MCP
- **[CLI Examples](../cli/examples.md)** - More CLI usage patterns
- **[Tool Reference](../mcp-tools/index.md)** - All 90+ tools

---

**Ready to start?** Ask Claude:

> "List all my WordPress sites and check which ones need updates"
