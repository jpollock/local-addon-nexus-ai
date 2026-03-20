---
title: MCP Tool Reference
description: Complete catalog of Model Context Protocol tools exposed by Nexus AI
keywords: [mcp tools, api reference, tool catalog, json schema, claude, ai]
---

# MCP Tool Reference

Complete reference for all Model Context Protocol tools provided by Nexus AI.

## Overview

Nexus AI exposes **45+ tools** across 6 categories for AI assistants to interact with WordPress sites.

**Tool Categories:**

1. **Site Discovery** (8 tools) - Find and list sites
2. **Content Management** (12 tools) - WP-CLI operations
3. **Search & Analysis** (7 tools) - Semantic search and insights
4. **WP Engine** (10 tools) - Cloud hosting operations
5. **Bulk Operations** (6 tools) - Multi-site management
6. **AI Assistance** (4 tools) - AI-powered analysis

## Site Discovery

### nexus_list_sites

List all WordPress sites managed by Local.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["all", "running", "halted"],
      "default": "all",
      "description": "Filter by site status"
    },
    "format": {
      "type": "string",
      "enum": ["summary", "detailed"],
      "default": "summary",
      "description": "Output format"
    }
  }
}
```

**Example:**

```typescript
await mcp.callTool({
  name: 'nexus_list_sites',
  arguments: {
    status: 'running',
    format: 'detailed'
  }
});
```

**Response:**

```json
[
  {
    "id": "abc123",
    "name": "mysite",
    "domain": "mysite.local",
    "status": "running",
    "wpVersion": "6.4.3",
    "path": "/Users/me/Local Sites/mysite"
  }
]
```

### get_site_info

Get detailed information about a specific site.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string",
      "description": "Site ID or name"
    }
  },
  "required": ["siteId"]
}
```

**Example:**

```typescript
await mcp.callTool({
  name: 'get_site_info',
  arguments: { siteId: 'mysite' }
});
```

**Response:**

```json
{
  "id": "abc123",
  "name": "mysite",
  "domain": "mysite.local",
  "status": "running",
  "wpVersion": "6.4.3",
  "phpVersion": "8.1.0",
  "database": {
    "host": "localhost",
    "name": "local",
    "size": "45.2 MB"
  },
  "stats": {
    "posts": 142,
    "pages": 24,
    "products": 38,
    "users": 3
  },
  "lastScan": "2024-03-20T10:30:00Z"
}
```

### find_sites_by_plugin

Find all sites with a specific plugin installed.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "type": "string",
      "description": "Plugin slug (e.g., 'woocommerce')"
    },
    "status": {
      "type": "string",
      "enum": ["any", "active", "inactive"],
      "default": "any"
    }
  },
  "required": ["plugin"]
}
```

**Example:**

```typescript
await mcp.callTool({
  name: 'find_sites_by_plugin',
  arguments: {
    plugin: 'woocommerce',
    status: 'active'
  }
});
```

### find_sites_by_theme

Find all sites using a specific theme.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "description": "Theme slug"
    },
    "activeOnly": {
      "type": "boolean",
      "default": true
    }
  },
  "required": ["theme"]
}
```

### get_site_health

Get WordPress site health status.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string",
      "description": "Site ID"
    }
  },
  "required": ["siteId"]
}
```

**Response:**

```json
{
  "status": "good",
  "score": 92,
  "tests": {
    "wordpress_version": "pass",
    "plugin_version": "pass",
    "theme_version": "pass",
    "php_version": "pass",
    "https_status": "pass",
    "database": "pass"
  },
  "issues": [],
  "recommendations": [
    "Consider updating to PHP 8.2 for better performance"
  ]
}
```

### get_site_stats

Get site statistics (posts, pages, products, etc.).

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

### compare_sites

Compare two or more sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 2,
      "description": "Site IDs to compare"
    },
    "metrics": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["plugins", "themes", "version", "content", "all"]
      },
      "default": ["all"]
    }
  },
  "required": ["siteIds"]
}
```

## Content Management (WP-CLI)

### wp_plugin_list

List all plugins on a site.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string",
      "description": "Local site ID"
    },
    "install_name": {
      "type": "string",
      "description": "WPE install name (remote)"
    },
    "status": {
      "type": "string",
      "enum": ["all", "active", "inactive"],
      "default": "all"
    }
  }
}
```

**Note:** Provide either `siteId` (local) or `install_name` (remote WPE).

**Example:**

```typescript
// Local site
await mcp.callTool({
  name: 'wp_plugin_list',
  arguments: { siteId: 'mysite' }
});

// Remote WPE site
await mcp.callTool({
  name: 'wp_plugin_list',
  arguments: { install_name: 'mysite-production' }
});
```

**Response:**

```json
[
  {
    "name": "akismet",
    "status": "active",
    "update": "available",
    "version": "5.3",
    "update_version": "5.3.1"
  },
  {
    "name": "woocommerce",
    "status": "active",
    "update": "none",
    "version": "8.5.2"
  }
]
```

### wp_plugin_install

Install a plugin from WordPress.org.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "slug": {
      "type": "string",
      "description": "Plugin slug"
    },
    "version": {
      "type": "string",
      "description": "Specific version (optional)"
    },
    "activate": {
      "type": "boolean",
      "default": false
    }
  },
  "required": ["slug"]
}
```

### wp_plugin_activate

Activate a plugin.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "slug": {
      "type": "string",
      "description": "Plugin slug"
    }
  },
  "required": ["slug"]
}
```

### wp_plugin_deactivate

Deactivate a plugin.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "slug": {
      "type": "string"
    }
  },
  "required": ["slug"]
}
```

### wp_plugin_update

Update one or more plugins.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "slug": {
      "type": "string",
      "description": "Plugin slug (or 'all' for all plugins)"
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "Preview updates without applying"
    }
  },
  "required": ["slug"]
}
```

### wp_theme_list

List themes.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": ["all", "active"],
      "default": "all"
    }
  }
}
```

### wp_core_version

Get WordPress version.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    }
  }
}
```

**Response:**

```json
{
  "version": "6.4.3",
  "updateAvailable": true,
  "latestVersion": "6.5.0"
}
```

### wp_user_list

List users.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "role": {
      "type": "string",
      "description": "Filter by role"
    }
  }
}
```

### wp_option_get

Get WordPress option value.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "install_name": {
      "type": "string"
    },
    "key": {
      "type": "string",
      "description": "Option key (e.g., 'siteurl')"
    }
  },
  "required": ["key"]
}
```

### wp_db_export

Export database (local sites only).

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "output": {
      "type": "string",
      "description": "Output path (optional)"
    }
  },
  "required": ["siteId"]
}
```

### wp_search_replace

Search and replace in database (local sites only).

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "from": {
      "type": "string",
      "description": "Search string"
    },
    "to": {
      "type": "string",
      "description": "Replace string"
    },
    "dryRun": {
      "type": "boolean",
      "default": true,
      "description": "Preview changes without applying"
    }
  },
  "required": ["siteId", "from", "to"]
}
```

### wp_site_health

Run WordPress site health checks (local sites only).

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

## Search & Analysis

### search_sites

Semantic search across all sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query (natural language)"
    },
    "limit": {
      "type": "number",
      "default": 50,
      "description": "Maximum results"
    },
    "filters": {
      "type": "object",
      "properties": {
        "siteId": { "type": "string" },
        "postType": { "type": "string" },
        "minScore": { "type": "number" }
      }
    }
  },
  "required": ["query"]
}
```

**Example:**

```typescript
await mcp.callTool({
  name: 'search_sites',
  arguments: {
    query: 'WooCommerce sites with Stripe payment gateway',
    limit: 10,
    filters: {
      postType: 'product',
      minScore: 0.7
    }
  }
});
```

**Response:**

```json
[
  {
    "siteId": "abc123",
    "siteName": "Store1",
    "postId": 42,
    "postTitle": "Payment Setup Guide",
    "score": 0.94,
    "snippet": "...configure Stripe payment gateway for WooCommerce..."
  }
]
```

### scan_site

Scan and index a site's content.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "full": {
      "type": "boolean",
      "default": false,
      "description": "Full rescan vs incremental"
    }
  },
  "required": ["siteId"]
}
```

### get_scan_status

Get scan progress for a site.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

**Response:**

```json
{
  "status": "in_progress",
  "progress": 45,
  "phase": "embedding",
  "chunksProcessed": 450,
  "totalChunks": 1000,
  "estimatedTimeRemaining": "30 seconds"
}
```

### analyze_site_content

AI-powered content analysis.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "aspects": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["seo", "quality", "topics", "keywords"]
      },
      "default": ["all"]
    }
  },
  "required": ["siteId"]
}
```

### get_indexed_content

Get all indexed content for a site.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "postType": {
      "type": "string",
      "description": "Filter by post type"
    }
  },
  "required": ["siteId"]
}
```

## WP Engine Operations

### wpe_list_accounts

List all connected WP Engine accounts.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {}
}
```

**Response:**

```json
[
  {
    "id": "acc123",
    "name": "My Account",
    "sites": 24,
    "installs": 68
  }
]
```

### wpe_list_sites

List sites in a WPE account.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "Account ID (optional, uses default if not provided)"
    }
  }
}
```

### wpe_list_installs

List installs (environments) for a site.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string",
      "description": "WPE site ID"
    }
  },
  "required": ["siteId"]
}
```

**Response:**

```json
[
  {
    "id": "inst123",
    "name": "mysite-production",
    "environment": "production",
    "domain": "mysite.com",
    "status": "running"
  },
  {
    "id": "inst124",
    "name": "mysite-staging",
    "environment": "staging",
    "domain": "mysite.wpengine.com",
    "status": "running"
  }
]
```

### wpe_get_install

Get detailed install information.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "installId": {
      "type": "string"
    }
  },
  "required": ["installId"]
}
```

### wpe_create_backup

Create a backup.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "installId": {
      "type": "string"
    },
    "description": {
      "type": "string",
      "description": "Backup description"
    }
  },
  "required": ["installId"]
}
```

### wpe_list_domains

List domains for an install.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "installId": {
      "type": "string"
    }
  },
  "required": ["installId"]
}
```

### wpe_get_ssl_status

Get SSL certificate status.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "domainId": {
      "type": "string"
    }
  },
  "required": ["domainId"]
}
```

### wpe_get_usage

Get resource usage (disk, bandwidth).

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "installId": {
      "type": "string"
    },
    "period": {
      "type": "string",
      "enum": ["daily", "monthly"],
      "default": "monthly"
    }
  },
  "required": ["installId"]
}
```

### wpe_pull_site

Pull site from WPE to Local.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "localSiteId": {
      "type": "string",
      "description": "Local site to pull into"
    },
    "installId": {
      "type": "string",
      "description": "WPE install to pull from"
    },
    "includeDatabase": {
      "type": "boolean",
      "default": true
    },
    "includeFiles": {
      "type": "boolean",
      "default": true
    }
  },
  "required": ["localSiteId", "installId"]
}
```

### wpe_push_site

Push site from Local to WPE.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "localSiteId": {
      "type": "string"
    },
    "installId": {
      "type": "string"
    },
    "includeDatabase": {
      "type": "boolean",
      "default": true
    },
    "includeFiles": {
      "type": "boolean",
      "default": true
    },
    "dryRun": {
      "type": "boolean",
      "default": false
    }
  },
  "required": ["localSiteId", "installId"]
}
```

## Bulk Operations

### bulk_scan_sites

Scan multiple sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["siteIds"]
}
```

### bulk_update_plugins

Update plugins across multiple sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "plugin": {
      "type": "string",
      "description": "Plugin slug or 'all'"
    },
    "dryRun": {
      "type": "boolean",
      "default": false
    }
  },
  "required": ["siteIds", "plugin"]
}
```

### bulk_update_wordpress

Update WordPress core on multiple sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "version": {
      "type": "string",
      "description": "Target version or 'latest'"
    }
  },
  "required": ["siteIds"]
}
```

### bulk_backup_sites

Create backups for multiple sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "description": {
      "type": "string"
    }
  },
  "required": ["siteIds"]
}
```

### bulk_wp_cli

Execute WP-CLI command on multiple sites.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "command": {
      "type": "string",
      "description": "WP-CLI command"
    }
  },
  "required": ["siteIds", "command"]
}
```

## AI Assistance

### ai_plugin_audit

AI-powered plugin security and compatibility audit.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

**Response:**

```json
{
  "summary": "12 plugins analyzed",
  "findings": [
    {
      "plugin": "old-plugin",
      "severity": "high",
      "issue": "Not updated in 3 years",
      "recommendation": "Replace with modern alternative"
    }
  ]
}
```

### ai_security_scan

AI-powered security assessment.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

### ai_performance_analysis

AI-powered performance recommendations.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    }
  },
  "required": ["siteId"]
}
```

### ai_content_summary

Generate AI summary of site content.

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "siteId": {
      "type": "string"
    },
    "maxLength": {
      "type": "number",
      "default": 500,
      "description": "Summary length in words"
    }
  },
  "required": ["siteId"]
}
```

## Error Responses

All tools return errors in this format:

```json
{
  "error": {
    "code": "SITE_NOT_FOUND",
    "message": "Site not found: mysite",
    "details": {
      "siteId": "mysite",
      "availableSites": ["site1", "site2"]
    }
  }
}
```

**Common Error Codes:**

| Code | Description |
|------|-------------|
| `SITE_NOT_FOUND` | Site ID not found |
| `SITE_NOT_RUNNING` | Site must be running |
| `PLUGIN_NOT_FOUND` | Plugin not installed |
| `WP_CLI_ERROR` | WP-CLI command failed |
| `WPE_AUTH_ERROR` | WP Engine authentication failed |
| `INVALID_PARAMS` | Invalid input parameters |
| `OPERATION_FAILED` | Operation failed |

## Next Steps

- **[MCP Protocol](../architecture/mcp-protocol.md)** - Protocol implementation
- **[Claude Desktop](../integrations/claude-desktop.md)** - Using tools in Claude
- **[Cursor](../integrations/cursor.md)** - IDE integration
- **[Other MCP Clients](../integrations/other-mcp-clients.md)** - Zed, Continue, etc.
- **[Examples](../cli/examples.md)** - Real-world usage examples
