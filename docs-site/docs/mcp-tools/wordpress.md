---
title: WordPress Tools
description: WP-CLI integration tools for plugin, theme, and core management
keywords: [wordpress, wp-cli, plugins, themes, updates, mcp]
tool_category: wordpress
tools: [wp_plugin_list, wp_plugin_activate, wp_plugin_deactivate, wp_plugin_update, wp_plugin_install, wp_core_version, wp_user_list, wp_theme_list, wp_site_health, wp_option_get, wp_db_export, wp_search_replace]
---

# WordPress Tools

WP-CLI integration tools for managing WordPress plugins, themes, core, and more.

## Overview

These tools wrap **WP-CLI commands** and work on both **local** and **remote** (WP Engine) sites via SSH.

**12 tools available:**

- Plugin management (list, activate, deactivate, update, install)
- Core version check
- Theme management
- User management
- Site health checks
- Options management
- Database operations

---

## wp_plugin_list

List all installed WordPress plugins on a site.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Array of plugin objects with name, status, version</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Optional filters
  status?: "all" | "active" | "inactive";  // Default: "all"
}
```

### Examples

=== "Local Site"

    ```json
    {
      "tool": "wp_plugin_list",
      "arguments": {
        "site_id": "abc123",
        "status": "active"
      }
    }
    ```

=== "WPE Site"

    ```json
    {
      "tool": "wp_plugin_list",
      "arguments": {
        "install_name": "mysite-prod"
      }
    }
    ```

=== "All Plugins"

    ```json
    {
      "tool": "wp_plugin_list",
      "arguments": {
        "site_id": "abc123"
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Found 12 plugins (8 active, 4 inactive):\n\nActive Plugins:\n  1. Akismet Anti-Spam 5.3.1\n  2. Classic Editor 1.6.2\n  3. Contact Form 7 5.8\n  ...\n\nInactive Plugins:\n  9. Hello Dolly 1.7.2\n  10. Jetpack 12.9\n  ..."
  }]
}
```

### Related Tools

- [wp_plugin_activate](#wp_plugin_activate) - Activate a plugin
- [wp_plugin_deactivate](#wp_plugin_deactivate) - Deactivate a plugin
- [wp_plugin_update](#wp_plugin_update) - Update plugins

---

## wp_plugin_activate

Activate a WordPress plugin.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Confirmation message</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Required
  slug: string;            // Plugin slug (e.g., "akismet")
}
```

### Examples

=== "Local Site"

    ```json
    {
      "tool": "wp_plugin_activate",
      "arguments": {
        "site_id": "abc123",
        "slug": "akismet"
      }
    }
    ```

=== "WPE Site"

    ```json
    {
      "tool": "wp_plugin_activate",
      "arguments": {
        "install_name": "mysite-prod",
        "slug": "woocommerce"
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Activated plugin: Akismet Anti-Spam"
  }]
}
```

### Error Handling

```json
// Plugin already active
{
  "content": [{
    "type": "text",
    "text": "Warning: Plugin already active: akismet"
  }],
  "isError": false  // Not an error, just a warning
}

// Plugin not found
{
  "content": [{
    "type": "text",
    "text": "Error: Plugin not found: nonexistent\n\nRun wp_plugin_list to see available plugins."
  }],
  "isError": true
}
```

### Related Tools

- [wp_plugin_list](#wp_plugin_list) - List plugins first
- [wp_plugin_deactivate](#wp_plugin_deactivate) - Deactivate plugin

---

## wp_plugin_deactivate

Deactivate a WordPress plugin.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Confirmation message</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Required
  slug: string;            // Plugin slug
}
```

### Examples

```json
{
  "tool": "wp_plugin_deactivate",
  "arguments": {
    "site_id": "abc123",
    "slug": "akismet"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Deactivated plugin: Akismet Anti-Spam"
  }]
}
```

---

## wp_plugin_update

Update WordPress plugins.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Update results with versions</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Update target
  slug?: string;           // Specific plugin slug
  all?: boolean;           // Update all plugins

  // Optional
  dry_run?: boolean;       // Check without updating (default: false)
}
```

### Examples

=== "Update One Plugin"

    ```json
    {
      "tool": "wp_plugin_update",
      "arguments": {
        "site_id": "abc123",
        "slug": "akismet"
      }
    }
    ```

=== "Update All Plugins"

    ```json
    {
      "tool": "wp_plugin_update",
      "arguments": {
        "site_id": "abc123",
        "all": true
      }
    }
    ```

=== "Dry Run (Check Only)"

    ```json
    {
      "tool": "wp_plugin_update",
      "arguments": {
        "site_id": "abc123",
        "all": true,
        "dry_run": true
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Updated 3 plugins:\n\n  Akismet: 5.3.0 → 5.3.1\n  Contact Form 7: 5.7 → 5.8\n  Yoast SEO: 21.5 → 21.6\n\nNo updates available for 5 other plugins."
  }]
}
```

---

## wp_plugin_install

Install a new WordPress plugin.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Installation confirmation</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Required
  slug: string;            // Plugin slug from wordpress.org

  // Optional
  activate?: boolean;      // Activate after install (default: false)
  version?: string;        // Specific version (default: latest)
}
```

### Examples

```json
{
  "tool": "wp_plugin_install",
  "arguments": {
    "site_id": "abc123",
    "slug": "wordfence",
    "activate": true
  }
}
```

---

## wp_core_version

Get WordPress core version.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>WordPress version string</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name
}
```

### Examples

```json
{
  "tool": "wp_core_version",
  "arguments": {
    "site_id": "abc123"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "WordPress version: 6.4.2"
  }]
}
```

---

## wp_user_list

List WordPress users.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Array of users with roles</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Optional filters
  role?: string;           // Filter by role (administrator, editor, etc.)
}
```

### Examples

=== "All Users"

    ```json
    {
      "tool": "wp_user_list",
      "arguments": {
        "site_id": "abc123"
      }
    }
    ```

=== "Administrators Only"

    ```json
    {
      "tool": "wp_user_list",
      "arguments": {
        "site_id": "abc123",
        "role": "administrator"
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Found 5 users:\n\n  1. admin (administrator)\n  2. editor (editor)\n  3. author1 (author)\n  4. contributor1 (contributor)\n  5. subscriber1 (subscriber)"
  }]
}
```

---

## wp_theme_list

List installed WordPress themes.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Array of themes with status</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Found 3 themes:\n\n  Active:\n    Twenty Twenty-Four 1.0\n\n  Inactive:\n    Twenty Twenty-Three 1.3\n    Twenty Twenty-Two 1.4"
  }]
}
```

---

## wp_site_health

Run WordPress site health checks.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> (local only)</dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Health status and recommendations</dd>
</dl>
</div>

### Input Schema

```typescript
{
  site_id: string;         // Local site ID only
}
```

### Examples

```json
{
  "tool": "wp_site_health",
  "arguments": {
    "site_id": "abc123"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "Site Health Status: GOOD\n\nPassed Tests (15):\n  ✓ WordPress version is up to date\n  ✓ PHP version is supported\n  ✓ Database server is up to date\n  ...\n\nRecommended Improvements (2):\n  ⚠ Inactive plugins should be removed\n  ⚠ Enable automatic updates"
  }]
}
```

---

## wp_option_get

Get a WordPress option value.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> <span class="access-badge">REMOTE</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Option value</dd>
</dl>
</div>

### Input Schema

```typescript
{
  // Target (provide ONE of these)
  site_id?: string;        // Local site ID
  install_name?: string;   // WPE install name

  // Required
  option: string;          // Option name
}
```

### Examples

=== "Site URL"

    ```json
    {
      "tool": "wp_option_get",
      "arguments": {
        "site_id": "abc123",
        "option": "siteurl"
      }
    }
    ```

=== "Permalink Structure"

    ```json
    {
      "tool": "wp_option_get",
      "arguments": {
        "site_id": "abc123",
        "option": "permalink_structure"
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "siteurl: https://mysite.local"
  }]
}
```

---

## wp_db_export

Export WordPress database to SQL file.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> (local only)</dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Export path and file size</dd>
</dl>
</div>

### Input Schema

```typescript
{
  site_id: string;         // Local site ID
  output?: string;         // Output path (default: auto-generated)
}
```

### Examples

```json
{
  "tool": "wp_db_export",
  "arguments": {
    "site_id": "abc123"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Database exported:\n\n  Path: ~/mysite-2024-03-19.sql\n  Size: 2.4 MB\n  Tables: 12"
  }]
}
```

---

## wp_search_replace

Search and replace in WordPress database.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span> (local only - safety restriction)</dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Number of replacements made</dd>
</dl>
</div>

### Input Schema

```typescript
{
  site_id: string;         // Local site ID only
  search: string;          // String to search for
  replace: string;         // Replacement string
  dry_run?: boolean;       // Preview only (default: true)
}
```

### Examples

=== "Dry Run (Preview)"

    ```json
    {
      "tool": "wp_search_replace",
      "arguments": {
        "site_id": "abc123",
        "search": "oldsite.com",
        "replace": "newsite.com",
        "dry_run": true
      }
    }
    ```

=== "Actual Replace"

    ```json
    {
      "tool": "wp_search_replace",
      "arguments": {
        "site_id": "abc123",
        "search": "oldsite.com",
        "replace": "newsite.com",
        "dry_run": false
      }
    }
    ```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Search/Replace Results (DRY RUN):\n\n  Found 47 matches:\n    wp_options: 12\n    wp_posts: 28\n    wp_postmeta: 7\n\n  Run with dry_run=false to apply changes."
  }]
}
```

---

## AI Provider Management

Tools for configuring AI providers on individual WordPress sites.

### `nexus_get_site_ai_config`

Get the current AI provider configuration for a site.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Provider ID, model, configured timestamp, and whether Local AI Gateway is active</dd>
</dl>
</div>

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `site_id` | string | Yes | Local site ID |

### Examples

```json
{
  "tool": "nexus_get_site_ai_config",
  "arguments": {
    "site_id": "abc123"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "mysite — AI Configuration\n─────────────────────────────────────────────\n  Provider:  Anthropic (Claude)\n  Model:     claude-sonnet-4-6\n  Set up:    3/27/2026\n  Gateway:   Disabled"
  }]
}
```

---

### `nexus_switch_provider`

Switch the AI provider on an already-configured site. Deactivates the old provider plugin, installs and activates the new one, and syncs the appropriate credentials.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-2">2 - CAUTION</span></dd>
  <dt>Returns</dt>
  <dd>Confirmation of provider switch with old and new provider names</dd>
</dl>
</div>

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `site_id` | string | Yes | Local site ID |
| `provider` | string | Yes | New provider: `anthropic`, `openai`, `google`, `ollama` |

### Examples

```json
{
  "tool": "nexus_switch_provider",
  "arguments": {
    "site_id": "abc123",
    "provider": "openai"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ Switched AI provider on mysite\n\n  From: Anthropic (Claude)\n  To:   OpenAI (GPT)\n\n  Credentials synced."
  }]
}
```

---

### `nexus_sync_credentials`

Sync AI credentials to a specific WordPress site. Normally this happens automatically on site start; use this tool to trigger a manual sync.

<div class="metadata">
<dl>
  <dt>Access</dt>
  <dd><span class="access-badge">LOCAL</span></dd>
  <dt>Safety Tier</dt>
  <dd><span class="safety-tier safety-tier-1">1 - SAFE</span></dd>
  <dt>Returns</dt>
  <dd>Confirmation that credentials were written to the site</dd>
</dl>
</div>

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `site_id` | string | Yes | Local site ID |

### Examples

```json
{
  "tool": "nexus_sync_credentials",
  "arguments": {
    "site_id": "abc123"
  }
}
```

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "✓ AI credentials synced to mysite\n\n  Provider: Anthropic (Claude)\n  API key written to wp-config constants."
  }]
}
```

---

## Usage Patterns

### Plugin Workflow

```typescript
// 1. List plugins to see status
await callTool("wp_plugin_list", {site_id: "abc123"});

// 2. Check for updates (dry run)
await callTool("wp_plugin_update", {
  site_id: "abc123",
  all: true,
  dry_run: true
});

// 3. Update specific plugin
await callTool("wp_plugin_update", {
  site_id: "abc123",
  slug: "akismet"
});

// 4. Verify update
await callTool("wp_plugin_list", {
  site_id: "abc123",
  status: "active"
});
```

### Site Audit Workflow

```typescript
// 1. Get WordPress version
await callTool("wp_core_version", {site_id: "abc123"});

// 2. List plugins
await callTool("wp_plugin_list", {site_id: "abc123"});

// 3. Run health check
await callTool("wp_site_health", {site_id: "abc123"});

// 4. Check users
await callTool("wp_user_list", {site_id: "abc123"});
```

### Local to Remote Workflow

```typescript
// 1. Export local database
await callTool("wp_db_export", {site_id: "local-abc"});

// 2. Search/replace URLs (dry run)
await callTool("wp_search_replace", {
  site_id: "local-abc",
  search: "localhost",
  replace: "mysite.com",
  dry_run: true
});

// 3. Apply changes
await callTool("wp_search_replace", {
  site_id: "local-abc",
  search: "localhost",
  replace: "mysite.com",
  dry_run: false
});

// 4. Push to WPE
await callTool("local_wpe_push", {
  site: "local-abc",
  remote_install_id: "wpe-prod",
  include_database: true
});
```

## Error Reference

| Error | Cause | Solution |
|-------|-------|----------|
| `Site not found` | Invalid site_id or install_name | Run `nexus_list_sites` first |
| `Plugin not found` | Invalid plugin slug | Run `wp_plugin_list` to see slugs |
| `WP-CLI not available` | Site not running | Start site with `local_start_site` |
| `Permission denied` | File permission issue | Check site permissions |
| `Command failed` | WP-CLI error | Check error details in response |

## Next Steps

- [Local Sites Tools](local-sites.md) - Create and manage local sites
- [WPE Sites Tools](wpe-sites.md) - WP Engine remote operations
- [Search Tools](search.md) - Content search across sites
- [Tool Matrix](tool-matrix.md) - Full capability comparison
