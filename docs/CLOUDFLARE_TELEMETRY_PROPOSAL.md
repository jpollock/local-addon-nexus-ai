# Cloudflare Telemetry Proposal for Nexus AI

**Date:** 2026-03-19
**Based on:** lwp CLI analytics pattern (local-addon-cli-mcp)
**Status:** Proposal

---

## Executive Summary

Extend Nexus AI's existing telemetry system (MetricsCollector, HealthMonitor) to transmit anonymous usage data to Cloudflare for product improvement insights.

**Key Principles:**
- ✅ **Privacy-first** - No PII, site names, or WordPress data
- ✅ **Installation-based** - Random UUID, not tied to user identity
- ✅ **Opt-out model** - Enabled by default, easy to disable
- ✅ **HMAC-signed** - Cryptographically authenticated requests
- ✅ **Fire-and-forget** - Never blocks addon operation
- ✅ **Local fallback** - Works offline, queues for later

---

## Architecture

### Overview

```
┌─────────────────┐      HTTPS/HMAC      ┌──────────────────────┐
│   Nexus Addon   │─────────────────────▶│  Cloudflare Worker   │
│   (Electron)    │  Signed telemetry    │  nexus-analytics.dev │
└─────────────────┘      events          └──────────────────────┘
        │                                           │
        │ Offline queue                             ▼
        ▼                                  ┌──────────────────┐
┌─────────────────┐                       │  D1 Database     │
│  Local Storage  │                       │  (SQLite @edge)  │
│  ~/.nexus-ai/   │                       └──────────────────┘
│  telemetry.jsonl│                                │
└─────────────────┘                                ▼
                                          ┌──────────────────┐
                                          │ Admin Dashboard  │
                                          │ (Internal only)  │
                                          └──────────────────┘
```

### Components

1. **Nexus Addon (Client)**
   - Extends existing MetricsCollector
   - Adds CloudflareTransmitter class
   - Local JSONL queue for offline storage
   - HMAC signature generation

2. **Cloudflare Worker (Server)**
   - Event ingestion endpoint (/v1/events)
   - HMAC signature verification
   - D1 database storage
   - Admin stats endpoint (/v1/stats)

3. **D1 Database**
   - SQLite at the edge (global distribution)
   - Tables: installations, events, aggregates
   - Auto-cleanup (90-day retention)

---

## Data Model

### What We Collect

**Existing Metrics (Already Available):**
- MCP tool calls (name, duration, success/error)
- System health (memory, event queue, error rates)
- Search performance (query count, duration, cache hits)
- Fleet operations (site count, list duration)

**New Fields (Privacy-Safe):**
```typescript
interface TelemetryEvent {
  // Identity
  installation_id: string;      // Random UUID (not user ID)
  session_id: string;            // Per-Local-restart UUID

  // System info
  addon_version: string;         // Nexus AI version
  local_version: string;         // Local app version
  os: string;                    // 'darwin', 'win32', 'linux'
  node_version: string;          // Node runtime version

  // Event data
  event_type: string;            // 'tool_call', 'health_check', 'error'
  timestamp: string;             // ISO 8601

  // Tool call metrics (if event_type='tool_call')
  tool_name?: string;            // 'wp_plugin_list', 'search_site_content'
  success?: boolean;             // Did it succeed?
  duration_ms?: number;          // How long did it take?
  error_category?: string;       // 'site_not_found', 'timeout', etc.

  // Health metrics (if event_type='health_check')
  memory_mb?: number;            // RSS memory usage
  health_status?: string;        // 'healthy', 'degraded', 'unhealthy'
  active_sites?: number;         // Number of indexed sites

  // Performance metrics (if event_type='performance')
  operation?: string;            // 'fleet_summary', 'search'
  operation_duration_ms?: number;

  // NEVER collected
  // ❌ Site names, domains, paths
  // ❌ WordPress usernames, emails
  // ❌ Database content
  // ❌ Command arguments or parameters
  // ❌ Error messages or stack traces
  // ❌ IP addresses (not stored)
}
```

### Excluded Events

Following lwp CLI pattern, certain events excluded:

```typescript
const EXCLUDED_PREFIXES = [
  'wpe_',           // WP Engine CAPI calls (may contain account info)
  'wp_db_',         // Database operations (privacy)
  'wp_search_replace', // May contain site data
];
```

---

## Implementation Plan

### Phase 1: Local Transmission (~2 days)

**Goal:** Extend existing telemetry to transmit to Cloudflare

#### File Structure
```
src/main/telemetry/
├── types.ts                    # Existing types
├── MetricsCollector.ts         # Existing collector
├── HealthMonitor.ts            # Existing monitor
├── PerformanceTracker.ts       # Existing tracker
├── CloudflareTransmitter.ts    # NEW - Handles transmission
└── config.ts                   # NEW - Config management

~/.nexus-ai/
├── config.json                 # Installation ID, secret key
└── telemetry/
    └── events.jsonl           # Offline queue (max 10k events)
```

#### 1. Create Config Management (`src/main/telemetry/config.ts`)

```typescript
interface TelemetryConfig {
  installationId: string;     // Random UUID
  secretKey: string;          // 32 random bytes (base64)
  registeredAt?: string;      // When first synced to server
  telemetry: {
    enabled: boolean;         // Default: true (opt-out)
    promptedAt: string | null;
  };
}

// Functions:
- readConfig(): TelemetryConfig
- writeConfig(config): void
- generateInstallationId(): string
- generateSecretKey(): string
- isTelemetryEnabled(): boolean
- setTelemetryEnabled(enabled): void
```

Pattern from lwp CLI:
- Random UUID, not tied to user
- Secret key never transmitted after registration
- File permissions: 0600 (user read/write only)
- Atomic writes (temp file + rename)

#### 2. Create CloudflareTransmitter (`src/main/telemetry/CloudflareTransmitter.ts`)

```typescript
export class CloudflareTransmitter {
  private endpoint = 'https://nexus-analytics.dev/v1/events';
  private queuePath = '~/.nexus-ai/telemetry/events.jsonl';
  private maxQueueSize = 10000;

  async transmitEvent(event: TelemetryEvent): Promise<void> {
    // 1. Check if enabled
    if (!isTelemetryEnabled()) return;

    // 2. Check exclusions
    if (isExcluded(event)) return;

    // 3. Append to local queue (JSONL)
    this.appendToQueue(event);

    // 4. Try to transmit (fire-and-forget)
    this.transmitQueuedEvents().catch(() => {
      // Silently ignore transmission errors
    });
  }

  private async transmitQueuedEvents(): Promise<void> {
    // Read queued events
    const events = this.readQueue();
    if (events.length === 0) return;

    // Sign request with HMAC
    const body = JSON.stringify(events);
    const signature = signData(body, getSecretKey());

    // Send to Cloudflare
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Installation-Id': getInstallationId(),
        'X-Signature': signature,
        'X-Secret-Key': isFirstRequest() ? getSecretKey() : undefined,
      },
      body,
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (response.ok) {
      // Clear transmitted events
      this.clearQueue();
    }
  }

  private signData(data: string, secretKey: string): string {
    const key = Buffer.from(secretKey, 'base64');
    return crypto.createHmac('sha256', key).update(data).digest('hex');
  }
}
```

#### 3. Integrate with MetricsCollector

```typescript
// In MetricsCollector.ts
import { CloudflareTransmitter } from './CloudflareTransmitter';

export class MetricsCollector {
  private transmitter = new CloudflareTransmitter();

  recordToolCall(toolName: string, duration_ms: number, isError: boolean): void {
    // Existing local tracking...

    // NEW: Transmit to Cloudflare
    this.transmitter.transmitEvent({
      installation_id: getInstallationId(),
      session_id: getSessionId(),
      addon_version: ADDON_VERSION,
      event_type: 'tool_call',
      tool_name: toolName,
      success: !isError,
      duration_ms,
      timestamp: new Date().toISOString(),
      // ... system info
    });
  }
}
```

#### 4. Add MCP Tools for User Control

```typescript
// New tools in telemetry-tools.ts

export const getTelemetryStatusTool: McpToolHandler = {
  definition: {
    name: 'get_telemetry_status',
    description: 'Check telemetry status and local event count',
  },
  async execute() {
    return success({
      enabled: isTelemetryEnabled(),
      installation_id: getInstallationId(),
      events_queued: getQueuedEventCount(),
      transmitted: getTransmittedCount(),
    });
  },
};

export const setTelemetryTool: McpToolHandler = {
  definition: {
    name: 'set_telemetry',
    description: 'Enable or disable telemetry transmission',
    inputSchema: {
      properties: {
        enabled: { type: 'boolean' },
      },
      required: ['enabled'],
    },
  },
  async execute(args) {
    setTelemetryEnabled(args.enabled as boolean);
    return success({
      message: args.enabled ? 'Telemetry enabled' : 'Telemetry disabled',
    });
  },
};
```

### Phase 2: Cloudflare Worker (~1 day)

**Goal:** Deploy Cloudflare Worker to receive and store events

#### 1. Create Worker

```bash
cd packages/nexus-analytics-worker
npm init -y
npm install --save-dev wrangler
npx wrangler init
```

#### 2. Implement Worker (`packages/nexus-analytics-worker/src/index.ts`)

**Reuse pattern from lwp CLI:**
- HMAC signature verification
- D1 database storage
- Auto-registration on first request
- Admin stats endpoint

```typescript
export interface Env {
  nexus_analytics: D1Database;
  ADMIN_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/v1/events' && request.method === 'POST') {
      return handleEventIngestion(request, env);
    }

    if (url.pathname === '/v1/stats' && request.method === 'GET') {
      return handleStats(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleEventIngestion(request: Request, env: Env): Promise<Response> {
  // 1. Extract headers
  const installationId = request.headers.get('X-Installation-Id');
  const signature = request.headers.get('X-Signature');
  const secretKey = request.headers.get('X-Secret-Key'); // First request only

  // 2. Get installation record (or register if new)
  let installation = await getInstallation(env, installationId);
  if (!installation) {
    await registerInstallation(env, installationId, secretKey!);
    installation = { secret_key: secretKey! };
  }

  // 3. Verify HMAC signature
  const body = await request.text();
  const isValid = await verifySignature(body, signature, installation.secret_key);
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
  }

  // 4. Parse and store events
  const events = JSON.parse(body) as TelemetryEvent[];
  for (const event of events) {
    await env.nexus_analytics
      .prepare(`INSERT INTO events (...) VALUES (...)`)
      .bind(...)
      .run();
  }

  return new Response(JSON.stringify({ status: 'accepted' }), { status: 202 });
}
```

#### 3. Create D1 Database

```bash
# Create database
npx wrangler d1 create nexus-analytics

# Create schema
npx wrangler d1 execute nexus-analytics --file=./schema.sql
```

**Schema:**
```sql
-- Installations table (stores secret keys)
CREATE TABLE installations (
  installation_id TEXT PRIMARY KEY,
  secret_key TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  last_seen_at TEXT
);

-- Events table (telemetry data)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,

  -- System info
  addon_version TEXT,
  local_version TEXT,
  os TEXT,
  node_version TEXT,

  -- Tool call metrics
  tool_name TEXT,
  success INTEGER,
  duration_ms INTEGER,
  error_category TEXT,

  -- Health metrics
  memory_mb INTEGER,
  health_status TEXT,
  active_sites INTEGER,

  -- Performance metrics
  operation TEXT,
  operation_duration_ms INTEGER,

  FOREIGN KEY (installation_id) REFERENCES installations(installation_id)
);

CREATE INDEX idx_events_installation ON events(installation_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_tool ON events(tool_name);
```

#### 4. Deploy Worker

```bash
npx wrangler deploy
```

**wrangler.toml:**
```toml
name = "nexus-analytics"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "nexus_analytics"
database_name = "nexus-analytics"
database_id = "your-db-id"

[vars]
# ADMIN_TOKEN set via: wrangler secret put ADMIN_TOKEN
```

### Phase 3: Admin Dashboard (~1 day)

**Goal:** Internal dashboard for product insights

#### Admin Stats Endpoint

```typescript
// GET /v1/stats (requires Bearer token)

{
  "total_events": 12345,
  "unique_installations": 234,
  "success_rate": "94.2%",
  "top_tools": [
    { "tool": "wp_plugin_list", "count": 1234 },
    { "tool": "search_site_content", "count": 892 },
    ...
  ],
  "os_distribution": {
    "darwin": 145,
    "win32": 67,
    "linux": 22
  },
  "versions": {
    "0.1.0": 234
  },
  "health_distribution": {
    "healthy": 210,
    "degraded": 18,
    "unhealthy": 6
  },
  "avg_duration_by_tool": {
    "wp_plugin_list": 234.5,
    "search_site_content": 892.3
  }
}
```

---

## Privacy & Compliance

### GDPR Compliance

| Requirement | Implementation |
|-------------|----------------|
| **Data minimization** | Only collect necessary metrics, no PII |
| **Purpose limitation** | Product improvement only |
| **Right to erasure** | `set_telemetry({ enabled: false })` + delete installation |
| **Right to access** | `get_telemetry_status` shows local data |
| **Consent** | Opt-out model with clear disclosure |
| **Storage limitation** | 90-day auto-deletion |

### What's NEVER Collected

```typescript
// ❌ NEVER collected:
- User names, emails, IP addresses
- Site names, domains, paths
- WordPress content (posts, pages, users)
- Database data or queries
- Command arguments or parameters
- WP Engine account names or install names
- File paths or directory structures
- Environment variables
- Error messages or stack traces
- Screenshots or UI state
```

### Data Retention

- **Events:** 90 days, then auto-deleted
- **Aggregates:** Computed daily, stored separately
- **Installations:** Soft-delete after 180 days of inactivity

---

## User Communication

### First-Run Message (Addon Activation)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nexus AI - Anonymous Usage Analytics

To improve Nexus AI, we collect anonymous usage data:
• Tool usage (names, duration, success/failure)
• System performance (memory, health status)
• NO personal information, site names, or WordPress data

Disable anytime via MCP: set_telemetry({ enabled: false })
Learn more: https://github.com/wpengine/nexus-ai#privacy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Documentation

Create `docs/PRIVACY.md`:
- What we collect
- What we DON'T collect
- How to disable
- How to view your data
- GDPR rights

---

## Estimated Effort

| Phase | Tasks | Estimate |
|-------|-------|----------|
| **Phase 1: Client** | CloudflareTransmitter, config mgmt, integration | 2 days |
| **Phase 2: Server** | Cloudflare Worker, D1 setup, deployment | 1 day |
| **Phase 3: Dashboard** | Admin stats endpoint, aggregates | 1 day |
| **Testing** | E2E tests, HMAC validation, queue behavior | 1 day |
| **Documentation** | Privacy policy, user guide, code docs | 0.5 days |
| **Total** | | **5-6 days** |

---

## Rollout Strategy

### Week 1: Build & Test
1. Implement CloudflareTransmitter
2. Deploy Cloudflare Worker
3. Test HMAC signing end-to-end
4. Verify offline queue behavior

### Week 2: Beta
1. Enable for 10-20 internal users
2. Monitor transmission success rate
3. Validate data quality
4. Fix any issues

### Week 3: Gradual Rollout
1. Enable for 25% of users
2. Monitor for 3 days
3. Increase to 50%
4. Monitor for 3 days
5. Enable for 100%

### Monitoring

- Transmission success rate (target: >95%)
- Queue size (should stay <100 events)
- Server response time (target: <200ms)
- Signature rejection rate (target: <0.1%)

---

## Feature Flags

```typescript
// config.json
{
  "installationId": "uuid",
  "secretKey": "base64-secret",
  "telemetry": {
    "enabled": true,  // Master switch
    "events": {
      "tool_calls": true,      // MCP tool tracking
      "health_checks": true,   // Health monitoring
      "performance": true,     // Performance metrics
      "errors": true           // Error categories only
    },
    "transmission": {
      "realtime": false,       // Default: queue and batch
      "batchSize": 50,         // Send in batches of 50
      "batchInterval": 300000  // Or every 5 minutes
    }
  }
}
```

---

## Comparison to lwp CLI

### Similarities
✅ HMAC-signed requests
✅ Installation-based (not user-based)
✅ Cloudflare Worker + D1
✅ Opt-out model
✅ Local JSONL queue
✅ Privacy-first (no PII)

### Differences
| Feature | lwp CLI | Nexus AI |
|---------|---------|----------|
| **Events** | CLI commands | MCP tool calls, health, performance |
| **Volume** | ~10-50/day | ~100-500/day (higher frequency) |
| **Queue** | Simple JSONL | Same, but larger max (10k events) |
| **Dashboard** | Personal dashboard | Admin-only (no user dashboard) |
| **Context** | Single user | Multi-site fleet management |

---

## Alternative: Cloudflare Analytics Engine

**Instead of D1, use Analytics Engine:**

Pros:
- Designed for high-volume telemetry
- Automatic aggregation
- Lower cost at scale
- Built-in SQL queries

Cons:
- Can't query raw events (only aggregates)
- 25-datapoint limit per event
- More complex to debug

**Recommendation:** Start with D1 (simpler), migrate to Analytics Engine if volume exceeds 1M events/month.

---

## Security Considerations

### HMAC Signing

```typescript
// Client generates signature
const body = JSON.stringify(events);
const signature = HMAC-SHA256(body, secretKey);

// Server verifies
const expectedSignature = HMAC-SHA256(receivedBody, storedSecretKey);
if (signature !== expectedSignature) return 401;
```

**Properties:**
- Secret key never transmitted after registration
- Signature changes with any body modification
- Replay attacks prevented by timestamp validation
- Brute-force infeasible (256-bit signature space)

### File Permissions

```bash
~/.nexus-ai/config.json           # 0600 (read/write user only)
~/.nexus-ai/telemetry/events.jsonl # 0600
```

### Environment Variable Override

```bash
# Disable globally
export NEXUS_TELEMETRY=0

# Disable for one command
NEXUS_TELEMETRY=0 npx nexus sites list
```

---

## Open Questions

1. **Should we track site count?**
   - Pro: Understand fleet size distribution
   - Con: Indirect proxy for WP Engine customer size
   - **Recommendation:** Yes, but as `active_sites` bucket (<10, 10-50, 50-100, 100+)

2. **Should we track WPE CAPI usage?**
   - Pro: Understand WPE integration adoption
   - Con: Could identify WP Engine customers
   - **Recommendation:** Track only `wpe_tool_calls_total` count, not specific tools

3. **Should we batch events?**
   - Pro: Reduces network requests, better for offline
   - Con: More complex, delayed transmission
   - **Recommendation:** Yes, batch every 5 minutes or 50 events

4. **Should we include WordPress version?**
   - Pro: Understand WP version distribution
   - Con: Could fingerprint specific site setups
   - **Recommendation:** Yes, but as major version only (e.g., "6.x", "7.x")

---

## Next Steps

### To Proceed

1. **Approve scope** - Review this proposal, confirm approach
2. **Create repo** - Set up `packages/nexus-analytics-worker`
3. **Implement Phase 1** - CloudflareTransmitter integration
4. **Deploy Phase 2** - Cloudflare Worker + D1
5. **Internal testing** - Validate with 5-10 users
6. **Public rollout** - Gradual activation with monitoring

### Dependencies

- Cloudflare account (Workers + D1)
- Domain for endpoint (e.g., `nexus-analytics.dev`)
- Admin dashboard hosting (Cloudflare Pages)
- Privacy policy review (legal team)

---

## Appendix: Event Examples

### Tool Call Event
```json
{
  "installation_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "abc123-session",
  "addon_version": "0.1.0",
  "local_version": "9.0.2",
  "os": "darwin",
  "node_version": "20.10.0",
  "event_type": "tool_call",
  "tool_name": "wp_plugin_list",
  "success": true,
  "duration_ms": 234,
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

### Health Check Event
```json
{
  "installation_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "abc123-session",
  "addon_version": "0.1.0",
  "event_type": "health_check",
  "health_status": "healthy",
  "memory_mb": 245,
  "active_sites": 15,
  "timestamp": "2026-03-19T12:05:00.000Z"
}
```

### Error Event
```json
{
  "installation_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "abc123-session",
  "addon_version": "0.1.0",
  "event_type": "tool_call",
  "tool_name": "wp_plugin_install",
  "success": false,
  "error_category": "site_not_running",
  "duration_ms": 156,
  "timestamp": "2026-03-19T12:10:00.000Z"
}
```

---

**Status:** Ready for review and approval
**Author:** Claude Sonnet 4.5
**Based on:** local-addon-cli-mcp analytics pattern
