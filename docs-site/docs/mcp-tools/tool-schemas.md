---
title: Tool Schemas
description: Complete JSON schemas for all 88 MCP tools with TypeScript type definitions
keywords: [mcp, tools, schemas, json schema, typescript, api reference]
---

# Tool Schemas

Complete JSON schemas for all 88 MCP tools. Use these for building AI applications, custom clients, or understanding tool capabilities.

## Schema Structure

Every MCP tool follows this structure:

```typescript
interface McpTool {
  name: string;              // Tool identifier
  description: string;       // Human-readable description
  inputSchema: {             // JSON Schema for inputs
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: string[];
  };
}
```

## Common Patterns

### Site Targeting

Most tools that operate on sites accept **either** `site` (local) **or** `install_name` (remote):

```typescript
{
  site?: string;             // Local site name, ID, or domain
  install_name?: string;     // WPE install name for remote execution
}
```

**Never provide both** - use `site` for local, `install_name` for remote.

### Pagination

List tools support pagination:

```typescript
{
  limit?: number;            // Max results (default: 10)
  offset?: number;           // Skip results (default: 0)
}
```

### Filtering

Many tools support status or type filtering:

```typescript
{
  status?: "all" | "active" | "inactive";
  type?: "post" | "page" | "product";
}
```

## Tool Categories

### Local Site Management (10 tools)

Tools for managing Local WordPress sites.

#### local_list_sites

List all Local WordPress sites with status.

```json
{
  "name": "local_list_sites",
  "description": "List all Local WordPress sites with status information",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**TypeScript:**
```typescript
// No input required
local_list_sites()
```

**Response:**
```typescript
{
  local: Array<{
    id: string;
    name: string;
    domain: string;
    status: "running" | "stopped";
  }>;
  wpe?: Array<{
    id: string;
    name: string;
    environment: string;
  }>;
}
```

#### local_create_site

Create a new Local WordPress site.

```json
{
  "name": "local_create_site",
  "description": "Create a new WordPress site in Local",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Site name (required)"
      },
      "php": {
        "type": "string",
        "description": "PHP version (e.g., '8.2.10')"
      },
      "blueprint": {
        "type": "string",
        "description": "Blueprint name to use"
      }
    },
    "required": ["name"]
  }
}
```

**TypeScript:**
```typescript
interface LocalCreateSiteInput {
  name: string;              // Required
  php?: string;              // Optional: "8.2.10", "8.1.25", etc.
  blueprint?: string;        // Optional: blueprint name
}
```

#### local_start_site / local_stop_site

```json
{
  "name": "local_start_site",
  "description": "Start a stopped Local site",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Site name, ID, or domain"
      }
    },
    "required": ["site"]
  }
}
```

**TypeScript:**
```typescript
interface LocalSiteActionInput {
  site: string;              // Site name, ID, or domain
}
```

#### local_wpe_pull / local_wpe_push

```json
{
  "name": "local_wpe_pull",
  "description": "Pull a WP Engine site to Local",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site name (will be created if doesn't exist)"
      },
      "remote_install_id": {
        "type": "string",
        "description": "WPE install ID to pull from"
      },
      "include_database": {
        "type": "boolean",
        "description": "Pull database as well (default: true)"
      }
    },
    "required": ["site", "remote_install_id"]
  }
}
```

**TypeScript:**
```typescript
interface LocalWpePullInput {
  site: string;                    // Local site name
  remote_install_id: string;       // WPE install ID
  include_database?: boolean;      // Default: true
}
```

### WordPress Management (12 tools)

WP-CLI integration for plugin, theme, core, and user management.

#### wp_plugin_list

```json
{
  "name": "wp_plugin_list",
  "description": "List all installed WordPress plugins",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site name, ID, or domain"
      },
      "install_name": {
        "type": "string",
        "description": "WPE install name for remote execution"
      }
    }
  }
}
```

**TypeScript:**
```typescript
interface WpPluginListInput {
  site?: string;             // For local sites
  install_name?: string;     // For remote WPE sites
}
```

#### wp_plugin_activate / wp_plugin_deactivate

```json
{
  "name": "wp_plugin_activate",
  "description": "Activate a WordPress plugin",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site name"
      },
      "install_name": {
        "type": "string",
        "description": "WPE install name"
      },
      "slug": {
        "type": "string",
        "description": "Plugin slug (required)"
      }
    },
    "required": ["slug"]
  }
}
```

**TypeScript:**
```typescript
interface WpPluginActionInput {
  site?: string;
  install_name?: string;
  slug: string;              // Required: plugin slug
}
```

#### wp_plugin_update

```json
{
  "name": "wp_plugin_update",
  "description": "Update WordPress plugins",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string"
      },
      "install_name": {
        "type": "string"
      },
      "slug": {
        "type": "string",
        "description": "Specific plugin slug to update"
      },
      "all": {
        "type": "boolean",
        "description": "Update all plugins"
      },
      "dry_run": {
        "type": "boolean",
        "description": "Check for updates without applying (default: false)"
      }
    }
  }
}
```

**TypeScript:**
```typescript
interface WpPluginUpdateInput {
  site?: string;
  install_name?: string;
  slug?: string;             // Update specific plugin
  all?: boolean;             // Or update all
  dry_run?: boolean;         // Check only (default: false)
}
```

#### wp_core_version

```json
{
  "name": "wp_core_version",
  "description": "Get WordPress core version",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": { "type": "string" },
      "install_name": { "type": "string" }
    }
  }
}
```

#### wp_user_list

```json
{
  "name": "wp_user_list",
  "description": "List WordPress users",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": { "type": "string" },
      "install_name": { "type": "string" },
      "role": {
        "type": "string",
        "description": "Filter by role (administrator, editor, etc.)"
      }
    }
  }
}
```

**TypeScript:**
```typescript
interface WpUserListInput {
  site?: string;
  install_name?: string;
  role?: string;             // Optional: filter by role
}
```

#### wp_theme_list

```json
{
  "name": "wp_theme_list",
  "description": "List installed WordPress themes",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": { "type": "string" },
      "install_name": { "type": "string" }
    }
  }
}
```

#### wp_site_health

```json
{
  "name": "wp_site_health",
  "description": "Run WordPress site health checks",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site only (not available for remote)"
      }
    },
    "required": ["site"]
  }
}
```

**Note:** `wp_site_health` only works on local sites, not remote WPE sites.

#### wp_db_export

```json
{
  "name": "wp_db_export",
  "description": "Export WordPress database to SQL file",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site only"
      },
      "output": {
        "type": "string",
        "description": "Output file path (optional)"
      }
    },
    "required": ["site"]
  }
}
```

**Note:** `wp_db_export` only works on local sites.

#### wp_search_replace

```json
{
  "name": "wp_search_replace",
  "description": "Search and replace in WordPress database",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site": {
        "type": "string",
        "description": "Local site only"
      },
      "search": {
        "type": "string",
        "description": "String to search for"
      },
      "replace": {
        "type": "string",
        "description": "Replacement string"
      },
      "dry_run": {
        "type": "boolean",
        "description": "Preview only (default: true)"
      }
    },
    "required": ["site", "search", "replace"]
  }
}
```

**TypeScript:**
```typescript
interface WpSearchReplaceInput {
  site: string;              // Local only
  search: string;
  replace: string;
  dry_run?: boolean;         // Default: true (safety)
}
```

**Note:** `wp_search_replace` defaults to dry-run for safety. Set `dry_run: false` to apply.

### WP Engine Operations (40+ tools)

Tools for managing WP Engine sites via CAPI and SSH.

#### wpe_get_installs

```json
{
  "name": "wpe_get_installs",
  "description": "List all WP Engine installs across accounts",
  "inputSchema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "Filter by account ID (optional)"
      }
    }
  }
}
```

**TypeScript:**
```typescript
interface WpeGetInstallsInput {
  account_id?: string;       // Optional: filter by account
}
```

#### wpe_get_accounts

```json
{
  "name": "wpe_get_accounts",
  "description": "List all accessible WP Engine accounts",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

#### wpe_create_backup

```json
{
  "name": "wpe_create_backup",
  "description": "Create a backup of a WP Engine install",
  "inputSchema": {
    "type": "object",
    "properties": {
      "install_id": {
        "type": "string",
        "description": "WPE install ID"
      },
      "description": {
        "type": "string",
        "description": "Backup description (optional)"
      }
    },
    "required": ["install_id"]
  }
}
```

**TypeScript:**
```typescript
interface WpeCreateBackupInput {
  install_id: string;
  description?: string;
}
```

#### wpe_purge_cache

```json
{
  "name": "wpe_purge_cache",
  "description": "Purge cache for a WP Engine install",
  "inputSchema": {
    "type": "object",
    "properties": {
      "install_id": {
        "type": "string",
        "description": "WPE install ID"
      }
    },
    "required": ["install_id"]
  }
}
```

### Search Tools (4 tools)

Vector-based semantic search across indexed content.

#### search_site_content

```json
{
  "name": "search_site_content",
  "description": "Search content within a specific site using vector similarity",
  "inputSchema": {
    "type": "object",
    "properties": {
      "site_id": {
        "type": "string",
        "description": "Site ID to search within"
      },
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "limit": {
        "type": "number",
        "description": "Max results (default: 10)"
      },
      "type": {
        "type": "string",
        "description": "Filter by content type (post, page, product)"
      }
    },
    "required": ["site_id", "query"]
  }
}
```

**TypeScript:**
```typescript
interface SearchSiteContentInput {
  site_id: string;
  query: string;
  limit?: number;            // Default: 10
  type?: "post" | "page" | "product";
}
```

#### search_across_sites

```json
{
  "name": "search_across_sites",
  "description": "Search content across all indexed sites",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "limit": {
        "type": "number",
        "description": "Max results (default: 10)"
      }
    },
    "required": ["query"]
  }
}
```

### Fleet Tools (8 tools)

Fleet-wide operations and health monitoring.

#### nexus_list_sites

```json
{
  "name": "nexus_list_sites",
  "description": "Unified site discovery - lists all local and WPE sites",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

#### fleet_health_summary

```json
{
  "name": "fleet_health_summary",
  "description": "Get health summary across all sites",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

### Telemetry Tools (4 tools)

Control anonymous usage analytics.

#### get_telemetry_status

```json
{
  "name": "get_telemetry_status",
  "description": "Get current telemetry configuration and stats",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

#### set_telemetry_enabled

```json
{
  "name": "set_telemetry_enabled",
  "description": "Enable or disable telemetry",
  "inputSchema": {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "description": "Enable (true) or disable (false)"
      }
    },
    "required": ["enabled"]
  }
}
```

**TypeScript:**
```typescript
interface SetTelemetryEnabledInput {
  enabled: boolean;
}
```

## Response Format

All tools return this structure:

```typescript
interface McpToolResult {
  content: Array<{
    type: "text";
    text: string;            // Markdown-formatted response
  }>;
  isError?: boolean;         // True if operation failed
}
```

**Success response:**
```json
{
  "content": [{
    "type": "text",
    "text": "✓ Operation successful\n\nDetails here..."
  }]
}
```

**Error response:**
```json
{
  "content": [{
    "type": "text",
    "text": "Error: Something went wrong\n\nSuggestion: Try this instead..."
  }],
  "isError": true
}
```

## Complete Tool List

### By Category

| Category | Tools | Total |
|----------|-------|-------|
| Local Site Management | `local_*` | 10 |
| WordPress Management | `wp_*` | 12 |
| WP Engine Operations | `wpe_*` | 40+ |
| Search | `search_*` | 4 |
| Fleet | `fleet_*`, `nexus_*` | 8 |
| Telemetry | `*_telemetry_*` | 4 |
| **Total** | | **88** |

[Complete tool list with descriptions →](index.md)

## TypeScript Definitions

Full TypeScript definitions for all tools:

```typescript
// Site targeting (most tools)
interface SiteTarget {
  site?: string;             // Local: name, ID, or domain
  install_name?: string;     // Remote: WPE install name
}

// Pagination (list tools)
interface Pagination {
  limit?: number;            // Default: 10
  offset?: number;           // Default: 0
}

// Status filtering
interface StatusFilter {
  status?: "all" | "active" | "inactive" | "running" | "stopped";
}

// Type filtering
interface TypeFilter {
  type?: "post" | "page" | "product" | "attachment";
}

// Search tools
interface SearchInput extends Pagination, TypeFilter {
  query: string;
  site_id?: string;          // Optional: search specific site
}

// Plugin management
interface PluginManagement extends SiteTarget {
  slug?: string;             // Plugin slug
  all?: boolean;             // All plugins
  dry_run?: boolean;         // Check only
}

// Database operations
interface DatabaseOperation {
  site: string;              // Local only
  output?: string;           // Optional output path
}

// WPE operations
interface WpeOperation {
  install_id: string;        // WPE install ID
  description?: string;      // Optional description
}
```

## Usage Examples

### TypeScript Client

```typescript
import { MCP } from '@modelcontextprotocol/sdk';

const mcp = new MCP({
  command: 'nexus',
  args: ['mcp']
});

// List sites
const sites = await mcp.callTool('nexus_list_sites', {});

// List plugins on local site
const plugins = await mcp.callTool('wp_plugin_list', {
  site: 'mysite'
});

// Search across all sites
const results = await mcp.callTool('search_across_sites', {
  query: 'woocommerce setup',
  limit: 5
});
```

### Python Client

```python
from mcp import Client

client = Client(command='nexus', args=['mcp'])

# List sites
sites = client.call_tool('nexus_list_sites', {})

# Create backup
backup = client.call_tool('wpe_create_backup', {
    'install_id': 'abc123',
    'description': 'Pre-deployment backup'
})
```

### Direct JSON-RPC

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "wp_plugin_list",
    "arguments": {
      "site": "mysite"
    }
  },
  "id": 1
}
```

## Schema Validation

Tools validate inputs using JSON Schema. Invalid inputs return error:

```json
{
  "content": [{
    "type": "text",
    "text": "Error: Missing required parameter: slug\n\nExpected: {\"site\": \"mysite\", \"slug\": \"plugin-name\"}"
  }],
  "isError": true
}
```

## Next Steps

- [Tool Reference](index.md) - Browse all tools by category
- [WordPress Tools](wordpress.md) - Detailed WP-CLI tool docs
- [WPE Tools](wpe-sites.md) - WP Engine operation docs
- [Tool Matrix](tool-matrix.md) - Capability comparison

---

**88 tools documented** with complete JSON schemas and TypeScript definitions.
