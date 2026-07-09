---
title: MCP Tools Reference
description: Complete reference for all 160+ Model Context Protocol tools
keywords: [mcp, tools, api, wordpress, local, wpe, reference]
---

# MCP Tools Reference

Nexus AI exposes **160+ tools** via the Model Context Protocol for AI-powered WordPress management.

## Tool Categories

<div class="tool-grid" markdown>

<div class="tool-card" markdown>

### Local Sites
**10 tools** for managing Local sites

- Create, start, stop sites
- Pull/push to WP Engine
- Backup management
- Service control

[View Tools →](local-sites.md)

</div>

<div class="tool-card" markdown>

### WP Engine Sites
**40+ tools** for WPE management

- List installs and accounts
- Site diagnostics
- Environment comparison
- Backup & restore

[View Tools →](wpe-sites.md)

</div>

<div class="tool-card" markdown>

### WordPress
**12 tools** for WP-CLI operations

- Plugin management
- Core updates
- User management
- Site health checks

[View Tools →](wordpress.md)

</div>

<div class="tool-card" markdown>

### Search
**4 tools** for content search

- Semantic search
- Post search
- Product search
- Cross-site search

[View Tools →](search.md)

</div>

<div class="tool-card" markdown>

### Fleet
**8 tools** for fleet operations

- List all sites
- Fleet health
- Bulk updates
- Site grouping

[View Tools →](fleet.md)

</div>

<div class="tool-card" markdown>

### Telemetry
**4 tools** for analytics control

- Get status
- Enable/disable
- Clear events
- Reset installation

[View Tools →](telemetry.md)

</div>

</div>

## Tool Structure

Every MCP tool follows this structure:

```typescript
{
  "name": "tool_name",
  "description": "What the tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      // Input parameters
    },
    "required": ["required_params"]
  }
}
```

### Example: wp_plugin_list

```json
{
  "name": "wp_plugin_list",
  "description": "List WordPress plugins on a local or remote site",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site_id": {
        "type": "string",
        "description": "Local site ID (from local_list_sites)"
      },
      "install_name": {
        "type": "string",
        "description": "WPE install name (from wpe_get_installs)"
      },
      "status": {
        "type": "string",
        "enum": ["all", "active", "inactive"],
        "description": "Filter by plugin status"
      }
    },
    "oneOf": [
      {"required": ["site_id"]},
      {"required": ["install_name"]}
    ]
  }
}
```

**Usage:**

```json
// List active plugins on local site
{
  "tool": "wp_plugin_list",
  "arguments": {
    "site_id": "abc123",
    "status": "active"
  }
}

// List all plugins on WPE site
{
  "tool": "wp_plugin_list",
  "arguments": {
    "install_name": "mysite-prod"
  }
}
```

## Common Parameters

### Site Targeting

All tools that operate on sites accept **one** of these:

| Parameter | Type | Description |
|-----------|------|-------------|
| `site_id` | string | Local site ID (from `local_list_sites`) |
| `install_name` | string | WPE install name (from `wpe_get_installs`) |

**Never** provide both — use `site_id` for local, `install_name` for remote.

### Pagination

Search and list tools support pagination:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 10 | Max results to return |
| `offset` | number | 0 | Skip this many results |

### Filtering

Many tools support filtering:

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (active, inactive, etc.) |
| `type` | string | Filter by type (post, page, product, etc.) |
| `search` | string | Text search within results |

## Safety Tiers

Tools are classified by risk level:

<div class="metadata" markdown>
**Tier 1 - Safe** <span class="safety-tier safety-tier-1">SAFE</span>

Read-only operations. No confirmation required.

- `wp_plugin_list`
- `wpe_get_installs`
- `search_site_content`
- All `get_*` and `list_*` tools

**Tier 2 - Caution** <span class="safety-tier safety-tier-2">CAUTION</span>

Modify site state. Confirmation prompt shown.

- `wp_plugin_update`
- `wpe_create_backup`
- `local_start_site`
- All `update_*` and `create_*` tools

**Tier 3 - Destructive** <span class="safety-tier safety-tier-3">DESTRUCTIVE</span>

Irreversible operations. Requires confirmation token.

- `wp_plugin_deactivate` (with `--force`)
- `wpe_delete_install`
- `local_delete_site`
- All `delete_*` tools

</div>

[Safety System Details →](../features/safety-system.md)

## Access Methods

Tools are available via different access methods:

<span class="access-badge">LOCAL</span> — Works on local sites only
<span class="access-badge">REMOTE</span> — Works on WPE sites via SSH
<span class="access-badge">BOTH</span> — Works on both local and remote

### Capability Matrix

| Tool | Local | Remote | Notes |
|------|-------|--------|-------|
| `wp_plugin_list` | ✅ | ✅ | Full support |
| `wp_plugin_activate` | ✅ | ✅ | Full support |
| `wp_db_export` | ✅ | ❌ | Local only |
| `wp_search_replace` | ✅ | ❌ | Local only (safety) |
| `wpe_get_installs` | N/A | ✅ | WPE only |
| `wpe_create_backup` | N/A | ✅ | WPE only |

[Complete Matrix →](tool-matrix.md)

## Return Values

All tools return a structured response:

```typescript
interface ToolResult {
  content: Array<{
    type: "text";
    text: string;  // Human-readable result
  }>;
  isError?: boolean;
}
```

### Success Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "✓ Found 5 active plugins:\n\n1. Akismet Anti-Spam (5.3)\n2. Hello Dolly (1.7.2)\n..."
    }
  ]
}
```

### Error Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Site not found: nonexistent\n\nUse nexus_list_sites to find available sites."
    }
  ],
  "isError": true
}
```

## Error Handling

### Common Errors

**1. Site Not Found**

```json
{
  "error": "Site not found",
  "code": "SITE_NOT_FOUND",
  "suggestion": "Use nexus_list_sites to find available sites"
}
```

**2. Invalid Parameters**

```json
{
  "error": "Missing required parameter: site_id or install_name",
  "code": "MISSING_PARAMETER",
  "suggestion": "Provide either site_id (local) or install_name (remote)"
}
```

**3. Authentication Required**

```json
{
  "error": "WP Engine authentication required",
  "code": "AUTH_REQUIRED",
  "suggestion": "User must authenticate via Local → Connect → WP Engine"
}
```

**4. Operation Failed**

```json
{
  "error": "WP-CLI command failed: Plugin not found",
  "code": "WP_CLI_ERROR",
  "details": "Error: The plugin 'nonexistent' could not be found."
}
```

[Error Codes Reference →]

## Tool Discovery

AI assistants can discover available tools via MCP protocol:

```json
// Request
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}

// Response
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "wp_plugin_list",
        "description": "List WordPress plugins",
        "inputSchema": {...}
      },
      // ... 90+ more tools
    ]
  },
  "id": 1
}
```

## Best Practices

### 1. Start with Discovery

Always list available sites before operating on them:

```json
// 1. Discover sites
{"tool": "nexus_list_sites"}

// 2. Use site_id or install_name from results
{"tool": "wp_plugin_list", "arguments": {"site_id": "abc123"}}
```

### 2. Check Before Acting

Use read-only tools to check state before modifications:

```json
// 1. Check current state
{"tool": "wp_plugin_list", "arguments": {"site_id": "abc123"}}

// 2. Make informed decision
{"tool": "wp_plugin_update", "arguments": {"site_id": "abc123", "slug": "akismet"}}
```

### 3. Handle Errors Gracefully

Check `isError` flag and provide helpful suggestions:

```typescript
const result = await callTool("wp_plugin_list", {site_id: "nonexistent"});

if (result.isError) {
  // Suggest alternative
  console.log("Site not found. Let me list available sites...");
  await callTool("nexus_list_sites");
}
```

### 4. Use Bulk Operations

For multiple sites, use bulk operations instead of sequential calls:

```json
// Bad: 50 sequential calls
for (const site of sites) {
  await callTool("wp_core_version", {site_id: site.id});
}

// Good: 1 bulk call with parallel execution
await callTool("nexus_bulk_operation", {
  operation: "wp_core_version",
  sites: sites.map(s => s.id)
});
```

## Tool Categories

### Local Site Tools

- [local_list_sites](local-sites.md)
- [local_create_site](local-sites.md)
- [local_start_site](local-sites.md)
- [local_stop_site](local-sites.md)
- [local_wpe_pull](local-sites.md)
- [local_wpe_push](local-sites.md)
- [local_get_site](local-sites.md)
- [local_delete_site](local-sites.md)

### WP Engine Tools

- [wpe_get_installs](wpe-sites.md)
- [wpe_get_accounts](wpe-sites.md)
- [wpe_diagnose_site](wpe-sites.md)
- [wpe_environment_diff](wpe-sites.md)
- [wpe_promote_to_production](wpe-sites.md)
- [wpe_create_backup](wpe-sites.md)
- [40+ more...](wpe-sites.md)

### WordPress Tools

- [wp_plugin_list](wordpress.md)
- [wp_plugin_activate](wordpress.md)
- [wp_plugin_deactivate](wordpress.md)
- [wp_plugin_update](wordpress.md)
- [wp_core_version](wordpress.md)
- [wp_user_list](wordpress.md)
- [wp_site_health](wordpress.md)
- [wp_theme_list](wordpress.md)

### Search Tools

- [search_site_content](search.md)
- [search_posts](search.md)
- [search_products](search.md)
- [semantic_search](search.md)

### Fleet Tools

- [fleet_overview](fleet.md) — adaptive fleet summary (local-only vs WPE auto-detected)
- [fleet_sql](fleet.md) — read-only SQL over graph.db (`sites`, `plugins`, `content`, `users`)
- [fleet_summary](fleet.md)
- [fleet_health_summary](fleet.md)
- [fleet_filter](fleet.md)
- [fleet_search](fleet.md)
- [nexus_fleet_plugins](fleet.md)
- [fleet_database_health](fleet.md)
- [nexus_plugin_audit](fleet.md)

### Telemetry Tools

- [get_telemetry_status](telemetry.md)
- [set_telemetry_enabled](telemetry.md)
- [clear_telemetry_events](telemetry.md)
- [reset_telemetry](telemetry.md)

## Complete Schemas

For complete JSON schemas of all tools, see:

[Tool Schemas →](tool-schemas.md)

## Next Steps

- [WordPress Tools](wordpress.md) - Most commonly used tools
- [Local Sites](local-sites.md) - Local site management
- [WPE Sites](wpe-sites.md) - WP Engine operations
- [Search Tools](search.md) - Content search
- [Tool Matrix](tool-matrix.md) - Capability comparison
