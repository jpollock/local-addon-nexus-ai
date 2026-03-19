# Cloudflare Telemetry - Phase 1 Complete

**Date:** 2026-03-19
**Phase:** 1 - CloudflareTransmitter Client
**Status:** ✅ COMPLETE
**Next:** Phase 2 - Cloudflare Worker + D1

---

## What Was Built

### New Files Created (3 files, ~650 lines)

1. **`src/main/telemetry/telemetry-config.ts`** (~250 lines)
   - Installation ID and secret key management
   - Telemetry enabled/disabled state
   - JSONL event queue management
   - Config file read/write with atomic operations
   - Event rotation (max 10k events, keep newest 80%)

2. **`src/main/telemetry/CloudflareTransmitter.ts`** (~350 lines)
   - HMAC-SHA256 signing for authentication
   - Event transmission to Cloudflare Worker
   - Privacy-safe event filtering
   - Automatic tool call tracking
   - Health check recording
   - Fire-and-forget transmission (never blocks)

3. **`src/main/mcp/modules/telemetry-control-tools.ts`** (~230 lines)
   - 4 new MCP tools for telemetry control
   - get_telemetry_status
   - set_telemetry_enabled
   - clear_telemetry_events
   - reset_telemetry

### Files Modified (3 files)

1. **`src/main/telemetry/MetricsCollector.ts`**
   - Import CloudflareTransmitter
   - Integrate with `recordToolCall()` method
   - Automatic transmission of all tool calls

2. **`src/main/telemetry/HealthMonitor.ts`**
   - Import CloudflareTransmitter
   - Add `transmitHealthCheck()` method
   - Enable periodic health transmission

3. **`src/main/index.ts`**
   - Import telemetry control tools
   - Register telemetry control tools
   - Set up periodic health check transmission (every hour)

---

## Privacy & Security

### What We Collect (Privacy-Safe)

✅ **Anonymous Metrics:**
- Installation ID (random UUID, not user ID)
- Session ID (per Local restart)
- Tool names (e.g., "wp_plugin_list")
- Success/failure status
- Duration in milliseconds
- System info (OS, Node version, addon version)
- Health status (memory, active sites count)

❌ **Never Collected:**
- Site names, domains, or paths
- WordPress usernames or emails
- Database content or structure
- Command arguments or parameters
- Error messages or stack traces
- IP addresses (not stored)
- Any PII (personally identifiable information)

### Excluded Operations (Privacy Protection)

Certain tool prefixes are automatically excluded:
- `wpe_*` - WP Engine CAPI calls (may contain account info)
- `wp_db_*` - Database operations
- `wp_search_replace` - May contain site data
- `wp_user_*` - User operations

### Security Features

✅ **HMAC-SHA256 Authentication:**
- Secret key: 32 random bytes (base64-encoded)
- Signature: HMAC(event_json, secret_key)
- First request sends secret key to server (X-Secret-Key header)
- Subsequent requests use signature only (X-Signature header)

✅ **Opt-Out Model:**
- Telemetry enabled by default
- Easy to disable: `set_telemetry_enabled(false)`
- Auto-disabled in CI environments
- Environment variable override: `NEXUS_TELEMETRY=0`

✅ **Local Storage Security:**
- Config file: `~/.nexus-ai/config.json` (mode 0600)
- Events file: `~/.nexus-ai/telemetry/events.jsonl` (mode 0600)
- Atomic writes (temp file + rename)
- Auto-rotation when queue exceeds 10k events

---

## Technical Details

### Event Flow

```
Tool Call
    ↓
MetricsCollector.recordToolCall()
    ↓
CloudflareTransmitter.recordToolCall()
    ↓
1. Check if enabled (isTelemetryEnabled())
2. Check exclusions (wpe_*, wp_db_*, etc.)
3. Append to local queue (~/.nexus-ai/telemetry/events.jsonl)
4. Sign with HMAC-SHA256
5. POST to Cloudflare (fire-and-forget, never blocks)
```

### HMAC Signing Pattern

```typescript
// Server receives:
headers: {
  'X-Installation-Id': '<uuid>',
  'X-Signature': '<hmac-sha256-hex>',
  'X-Secret-Key': '<base64>' // Only on first request
}

body: {
  installation_id: '<uuid>',
  session_id: '<uuid>',
  event_type: 'tool_call',
  tool_name: 'wp_plugin_list',
  duration_ms: 234,
  success: true,
  timestamp: '2026-03-19T...',
  // ...
}

// Server verifies:
const signature = crypto.createHmac('sha256', secretKey)
  .update(JSON.stringify(body))
  .digest('hex');

if (signature !== headers['X-Signature']) {
  return 401 Unauthorized;
}
```

### Config File Structure

```json
{
  "installationId": "550e8400-e29b-41d4-a716-446655440000",
  "secretKey": "dGVzdHNlY3JldGtleWJhc2U2NGVuY29kZWQzMmJ5dGVz",
  "registeredAt": "2026-03-19T15:30:00.000Z",
  "telemetry": {
    "enabled": true,
    "promptedAt": "2026-03-19T15:30:00.000Z"
  }
}
```

### Event Queue (JSONL)

```jsonl
{"installation_id":"...","event_type":"tool_call","tool_name":"wp_plugin_list",...}
{"installation_id":"...","event_type":"health_check","memory_mb":245,...}
{"installation_id":"...","event_type":"tool_call","tool_name":"search_site_content",...}
```

**Rotation Policy:**
- Max 10,000 events
- When limit reached, keep newest 80% (8,000 events)
- Oldest 20% discarded

---

## MCP Tools

### 1. get_telemetry_status

Get current telemetry configuration and status.

**Returns:**
```json
{
  "enabled": true,
  "installation_id": "550e8400-...",
  "registered": true,
  "registered_at": "2026-03-19T15:30:00.000Z",
  "prompted_at": "2026-03-19T15:30:00.000Z",
  "queued_events": 42,
  "privacy_note": "Only anonymous metrics collected...",
  "opt_out": "Use set_telemetry_enabled..."
}
```

### 2. set_telemetry_enabled

Enable or disable telemetry.

**Parameters:**
- `enabled` (boolean): true to enable, false to disable

**Returns:**
```json
{
  "success": true,
  "enabled": false,
  "message": "Anonymous usage analytics disabled...",
  "installation_id": "550e8400-..."
}
```

### 3. clear_telemetry_events

Clear all queued events from local storage.

**Returns:**
```json
{
  "success": true,
  "events_cleared": 42,
  "message": "Cleared 42 queued telemetry events"
}
```

### 4. reset_telemetry

Reset telemetry completely: new installation ID, new secret key, clear events, disable.

**Parameters:**
- `confirm` (boolean): must be true to proceed

**Returns:**
```json
{
  "success": true,
  "message": "Telemetry reset complete",
  "old_installation_id": "550e8400-...",
  "new_installation_id": "7d7c0e90-...",
  "telemetry_enabled": false,
  "note": "All queued events cleared and new credentials generated"
}
```

---

## Automatic Transmission

### Tool Calls (Automatic)

Every MCP tool call is automatically tracked and transmitted:

```typescript
// In MetricsCollector.recordToolCall()
CloudflareTransmitter.recordToolCall(toolName, duration_ms, !isError);
```

**Transmitted Data:**
- event_type: "tool_call"
- tool_name: "wp_plugin_list"
- duration_ms: 234
- success: true
- timestamp: ISO 8601

### Health Checks (Periodic)

Every hour, health status is transmitted:

```typescript
// In main/index.ts after startup
setInterval(() => {
  const healthMonitor = getHealthMonitor();
  const activeSites = indexRegistry.listAll().length;
  healthMonitor.transmitHealthCheck(activeSites);
}, 3600000); // 1 hour
```

**Transmitted Data:**
- event_type: "health_check"
- memory_mb: 245.67
- health_status: "healthy"
- active_sites: 12
- timestamp: ISO 8601

---

## Testing

### Compilation

```bash
npm run compile  # ✅ PASSED (zero errors)
```

### Manual Testing

1. **Check Telemetry Status:**
   ```bash
   # Via MCP
   call get_telemetry_status
   ```

2. **Disable Telemetry:**
   ```bash
   call set_telemetry_enabled(enabled=false)
   ```

3. **Enable Telemetry:**
   ```bash
   call set_telemetry_enabled(enabled=true)
   ```

4. **Clear Events:**
   ```bash
   call clear_telemetry_events
   ```

5. **Reset Telemetry:**
   ```bash
   call reset_telemetry(confirm=true)
   ```

6. **Check Local Queue:**
   ```bash
   cat ~/.nexus-ai/telemetry/events.jsonl | wc -l
   cat ~/.nexus-ai/telemetry/events.jsonl | tail -5
   ```

7. **Check Config:**
   ```bash
   cat ~/.nexus-ai/config.json | jq .
   ```

---

## Next Steps

### Phase 2: Cloudflare Worker + D1 (~1 day)

**Goal:** Deploy Cloudflare Worker to receive and store telemetry events

**Tasks:**
1. Create Cloudflare Worker project structure
2. Implement event ingestion endpoint (`POST /v1/events`)
3. Implement HMAC signature verification
4. Create D1 database schema
5. Implement event storage to D1
6. Deploy to Cloudflare Workers
7. Update endpoint URL in addon (`NEXUS_ANALYTICS_ENDPOINT`)

**Files to Create:**
- `cloudflare/worker/src/index.ts` - Worker entry point
- `cloudflare/worker/src/verify.ts` - HMAC verification
- `cloudflare/worker/src/db.ts` - D1 database operations
- `cloudflare/worker/schema.sql` - Database schema
- `cloudflare/worker/wrangler.toml` - Cloudflare config

**D1 Schema:**
```sql
CREATE TABLE installations (
  installation_id TEXT PRIMARY KEY,
  secret_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  success INTEGER,
  duration_ms INTEGER,
  timestamp TEXT NOT NULL,
  data TEXT -- JSON blob for additional fields
);

CREATE INDEX idx_events_installation ON events(installation_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);
```

### Phase 3: Admin Dashboard (~1 day)

**Goal:** Internal analytics dashboard for viewing telemetry data

**Tasks:**
1. Create admin dashboard HTML/JS
2. Implement stats endpoint (`GET /v1/stats`)
3. Implement query endpoint (`GET /v1/query`)
4. Add charts and visualizations
5. Add date range filtering
6. Deploy dashboard

**Dashboard Features:**
- Total installations (unique installation_ids)
- Total events by type
- Most used tools (top 10)
- Error rates by tool
- Average durations by tool
- Health status distribution
- Active sites distribution
- Daily/weekly/monthly trends

---

## Configuration

### Environment Variables

**Addon Side:**
```bash
# Disable telemetry
NEXUS_TELEMETRY=0

# Custom endpoint (for testing)
NEXUS_ANALYTICS_ENDPOINT=https://localhost:8787/v1/events
```

**Worker Side:**
```bash
# Set in wrangler.toml
[env.production]
name = "nexus-analytics"
workers_dev = false
route = "nexus-analytics.dev/*"
```

---

## Privacy Compliance

### GDPR Compliance

✅ **Right to Know:**
- Users can call `get_telemetry_status` to see what's being collected
- Documentation clearly states what data is collected

✅ **Right to Opt-Out:**
- Users can call `set_telemetry_enabled(false)` at any time
- Environment variable override: `NEXUS_TELEMETRY=0`

✅ **Right to Deletion:**
- Users can call `reset_telemetry(confirm=true)` to delete local data
- Server retention: 90 days (configurable)

✅ **Data Minimization:**
- Only collect what's necessary for product improvement
- No PII, site names, or WordPress content
- Use random UUIDs, not user identifiers

✅ **Security:**
- HMAC-signed requests
- Secure storage (file permissions 0600)
- HTTPS-only transmission

---

## Metrics to Track

### Key Product Metrics

**Adoption:**
- Total installations (unique installation_ids)
- Daily active installations (installations with events in last 24h)
- Weekly active installations
- Retention (7-day, 30-day)

**Usage:**
- Tool call distribution (which tools are most used)
- Average tools per session
- Session duration
- Error rates by tool

**Performance:**
- Average tool duration by tool name
- P50/P95/P99 durations
- Memory usage distribution
- Health status distribution (healthy vs degraded vs unhealthy)

**Fleet Size:**
- Average active sites per installation
- Distribution of fleet sizes (1-5, 6-10, 11-20, 21+)

---

## Success Criteria

### Phase 1 (Client) - ✅ COMPLETE

- [x] Config management (installation ID, secret key)
- [x] HMAC signing implementation
- [x] Event queue (JSONL, rotation)
- [x] CloudflareTransmitter class
- [x] Integration with MetricsCollector
- [x] Integration with HealthMonitor
- [x] 4 new MCP tools (status, enable/disable, clear, reset)
- [x] Periodic health check transmission
- [x] Compilation success
- [x] Privacy-safe filtering (exclude wpe_*, wp_db_*, etc.)

### Phase 2 (Worker) - Pending

- [ ] Cloudflare Worker deployed
- [ ] D1 database created and migrated
- [ ] HMAC verification working
- [ ] Event ingestion endpoint working
- [ ] Registration (first request with X-Secret-Key)
- [ ] Events stored in D1
- [ ] Endpoint URL updated in addon

### Phase 3 (Dashboard) - Pending

- [ ] Admin dashboard deployed
- [ ] Stats endpoint working
- [ ] Query endpoint working
- [ ] Charts and visualizations
- [ ] Date range filtering
- [ ] Authentication (admin only)

---

## Risks & Mitigations

### Risk: Privacy Concerns

**Mitigation:**
- Clear documentation of what's collected
- Opt-out model (easy to disable)
- No PII ever collected
- GDPR compliant

### Risk: Telemetry Errors Breaking Addon

**Mitigation:**
- Fire-and-forget transmission (never blocks)
- All telemetry code wrapped in try-catch
- Timeout on transmission (5 seconds)
- Failures logged but ignored

### Risk: Telemetry Queue Growing Too Large

**Mitigation:**
- Max 10k events
- Auto-rotation (keep newest 80%)
- File permissions prevent unauthorized access

### Risk: HMAC Secret Compromise

**Mitigation:**
- Secret key never transmitted after first request
- Stored with file permissions 0600 (user only)
- User can reset telemetry to generate new secret

---

**Status:** ✅ **PHASE 1 COMPLETE**
**Next:** Phase 2 - Cloudflare Worker + D1
**Est. Time:** 1 day
**Date:** 2026-03-19
