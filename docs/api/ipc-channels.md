# IPC Channels API Reference

All IPC channels for communication between renderer and main process.

## Invoking from Renderer

```typescript
const result = await electron.ipcRenderer.invoke(IPC_CHANNELS.CHANNEL_NAME, params);
```

## Response Format

All handlers return:
```typescript
{
  success: boolean;
  data?: any;        // On success
  error?: string;    // On failure
}
```

---

## WordPress Management

### WP_PLUGIN_INSTALL

Install WordPress plugin.

**Channel:** `'nexus-ai:wp-plugin-install'`

**Parameters:**
```typescript
{
  site_id?: string;      // Local site ID (UUID) OR
  install_name?: string; // Remote WPE install name
  slug: string;          // Plugin slug (lowercase, hyphens only)
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: { installed: boolean };
  error?: string;
}
```

**Example:**
```typescript
const result = await electron.ipcRenderer.invoke(
  IPC_CHANNELS.WP_PLUGIN_INSTALL,
  { site_id: 'abc-123', slug: 'akismet' }
);
```

---

### WP_PLUGIN_ACTIVATE

Activate WordPress plugin.

**Channel:** `'nexus-ai:wp-plugin-activate'`

**Parameters:**
```typescript
{
  site_id?: string;
  install_name?: string;
  slug: string;
}
```

---

### WP_PLUGIN_DEACTIVATE

Deactivate WordPress plugin.

**Channel:** `'nexus-ai:wp-plugin-deactivate'`

**Parameters:**
```typescript
{
  site_id?: string;
  install_name?: string;
  slug: string;
}
```

---

### WP_PLUGIN_LIST

List installed plugins.

**Channel:** `'nexus-ai:wp-plugin-list'`

**Parameters:**
```typescript
{
  site_id?: string;
  install_name?: string;
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: Array<{
    name: string;
    status: 'active' | 'inactive';
    version: string;
  }>;
}
```

---

### WP_CORE_VERSION

Get WordPress core version.

**Channel:** `'nexus-ai:wp-core-version'`

**Parameters:**
```typescript
{
  site_id?: string;
  install_name?: string;
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: { version: string }; // e.g., "7.0.1"
}
```

---

## Bulk Operations

### BULK_SETUP_AI

Run Setup AI on multiple sites.

**Channel:** `'nexus-ai:bulk-setup-ai'`

**Parameters:**
```typescript
{
  siteIds: string[];           // Array of site UUIDs
  confirmProduction?: boolean; // Required if production sites included
  options?: {
    enableOllama?: boolean;
    enableAcf?: boolean;
    enableGateway?: boolean;
  };
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    results: Array<{
      siteId: string;
      success: boolean;
      error?: string;
    }>;
    stats: {
      total: number;
      successful: number;
      failed: number;
    };
  };
}
```

**Progress Events:**
Emits `'bulk-operation-progress'` events during execution:
```typescript
event.sender.send('bulk-operation-progress', {
  completed: 5,
  total: 10,
  siteId: 'current-site-id',
  result: { success: true }
});
```

---

## WPE CAPI Operations

### WPE_CREATE_INSTALL

Create new WP Engine install.

**Channel:** `'nexus-ai:wpe-create-install'`

**Parameters:**
```typescript
{
  account_id: string;  // WPE account UUID
  site_id?: string;    // WPE site UUID (optional)
  name: string;        // Install name
  environment: 'production' | 'staging' | 'development';
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    install_id: string;
    name: string;
    status: 'provisioning' | 'active';
  };
}
```

---

### WPE_DELETE_INSTALL

Delete WP Engine install.

**Channel:** `'nexus-ai:wpe-delete-install'`

**Parameters:**
```typescript
{
  install_id: string;
  confirm_token: string; // Must be at least 10 characters
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: { deleted: boolean };
}
```

**⚠️ DESTRUCTIVE:** Requires confirmation token. No undo.

---

### WPE_COPY_INSTALL

Copy install to another install (overwrites destination).

**Channel:** `'nexus-ai:wpe-copy-install'`

**Parameters:**
```typescript
{
  source_install_id: string;
  dest_install_id: string;
  confirm_token: string;
}
```

**⚠️ DESTRUCTIVE:** Overwrites destination. Requires confirmation.

---

## AI Gateway

### AI_GATEWAY_GET_USAGE

Get AI usage records.

**Channel:** `'nexus-ai:ai-gateway-get-usage'`

**Parameters:** None

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    records: GatewayUsageRecord[];
  };
}

interface GatewayUsageRecord {
  id: string;
  siteId: string;
  siteName: string;
  model: string;
  provider: string;
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  // Caller tracking
  callerPlugin?: string;
  callerTheme?: string;
  callerFeature?: string;
  callerSource?: string;
  callerUserId?: number;
  callerUserRole?: string;
}
```

---

### AI_GATEWAY_CLEAR_USAGE

Clear all usage records.

**Channel:** `'nexus-ai:ai-gateway-clear-usage'`

**Parameters:** None

**Returns:**
```typescript
{
  success: boolean;
}
```

---

## Content Indexing

### INDEX_SITE

Index site content for semantic search.

**Channel:** `'nexus-ai:index-site'`

**Parameters:**
```typescript
{
  siteId: string;
  force?: boolean; // Re-index even if already indexed
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    documentsIndexed: number;
    chunksCreated: number;
  };
}
```

---

### SEARCH_CONTENT

Search indexed content.

**Channel:** `'nexus-ai:search-content'`

**Parameters:**
```typescript
{
  query: string;
  siteIds?: string[]; // Filter to specific sites
  limit?: number;     // Max results (default: 20, max: 100)
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    results: Array<{
      siteId: string;
      siteName: string;
      documentId: string;
      title: string;
      excerpt: string;
      score: number;
    }>;
  };
}
```

---

## Site Groups

### CREATE_SITE_GROUP

Create new site group.

**Channel:** `'nexus-ai:create-site-group'`

**Parameters:**
```typescript
{
  name: string;           // Max 100 chars
  description?: string;   // Max 500 chars
  filters?: Record<string, any>;
}
```

**Returns:**
```typescript
{
  success: boolean;
  data?: { id: string };
}
```

---

### UPDATE_SITE_GROUP

Update existing site group.

**Channel:** `'nexus-ai:update-site-group'`

**Parameters:**
```typescript
{
  id: string;             // Group UUID
  name?: string;
  description?: string;
  filters?: Record<string, any>;
}
```

---

## Settings

### GET_SETTINGS

Get all addon settings.

**Channel:** `'nexus-ai:get-settings'`

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    apiKeys: {
      anthropic?: string; // Masked: "sk-ant-****"
      openai?: string;
      google?: string;
    };
    aiGateway: {
      enabled: boolean;
      rateLimits: {
        requestsPerHour: number;
        requestsPerDay: number;
        costPerDayUsd: number;
      };
    };
    wpeAuth?: {
      username: string;
      connected: boolean;
    };
  };
}
```

---

### UPDATE_SETTINGS

Update addon settings.

**Channel:** `'nexus-ai:update-settings'`

**Parameters:**
```typescript
{
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
  aiGateway?: {
    enabled?: boolean;
    rateLimits?: {
      requestsPerHour?: number;
      requestsPerDay?: number;
      costPerDayUsd?: number;
    };
  };
  wpeAuth?: {
    username: string;
    password: string;
  };
}
```

---

## Error Handling

All IPC handlers follow this pattern:

```typescript
try {
  // Validate inputs
  const validated = validateInput(Schema, params);

  // Execute operation
  const result = await performOperation(validated);

  return { success: true, data: result };
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error'
  };
}
```

**Common Error Messages:**
- `"Validation failed: ..."` - Invalid input parameters
- `"Site not found"` - Invalid site_id
- `"Install not found"` - Invalid install_id/name
- `"Operation blocked: production sites in selection"` - Production safeguard
- `"Rate limit exceeded"` - AI Gateway rate limit hit
- `"Anthropic API key not configured"` - Missing API key

---

## Security Notes

1. **All inputs validated:** Uses Zod schemas from `src/common/schemas.ts`
2. **Credentials redacted:** Never logged or returned in errors
3. **Production safeguards:** Destructive ops require explicit confirmation
4. **Audit logged:** All remote operations tracked in audit log
5. **WP-CLI sanitized:** Arguments validated to prevent injection

---

## See Also

- [MCP Tools API](./mcp-tools.md) - MCP server tools reference
- [Storage Schema](./storage-schema.md) - Storage keys reference
- [Events](./events.md) - Event types reference
