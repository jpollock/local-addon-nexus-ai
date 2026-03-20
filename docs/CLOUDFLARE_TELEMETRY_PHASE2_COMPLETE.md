# Cloudflare Telemetry - Phase 2 Complete

**Date:** 2026-03-19
**Phase:** 2 - Cloudflare Worker + D1 Database
**Status:** ✅ COMPLETE (Code Ready, Deployment Pending)
**Next:** Phase 3 - Admin Dashboard

---

## What Was Built

### New Files Created (10 files, ~900 lines)

**Worker Source Code:**
1. **`cloudflare/worker/src/index.ts`** (~240 lines)
   - Main worker entry point
   - POST `/v1/events` - Event ingestion endpoint
   - GET `/v1/stats` - Analytics statistics endpoint
   - GET `/` - Health check endpoint
   - Scheduled cleanup handler (90-day retention)

2. **`cloudflare/worker/src/verify.ts`** (~80 lines)
   - HMAC-SHA256 signature verification
   - Header extraction and validation
   - Crypto.subtle Web API for signing

3. **`cloudflare/worker/src/db.ts`** (~280 lines)
   - D1 database operations
   - Installation registration and lookup
   - Event storage
   - Statistics queries (installations, events, top tools, MCP vs CLI)
   - Cleanup operations

**Configuration & Schema:**
4. **`cloudflare/worker/schema.sql`** (~120 lines)
   - D1 database schema (3 tables: installations, events, daily_aggregates)
   - Indexes for performance
   - 90-day retention policy documentation

5. **`cloudflare/worker/wrangler.toml`** (~40 lines)
   - Cloudflare Worker configuration
   - D1 database binding
   - Environment settings (production, dev)

6. **`cloudflare/worker/package.json`** (~20 lines)
   - Dependencies and scripts
   - Wrangler CLI commands

7. **`cloudflare/worker/tsconfig.json`** (~20 lines)
   - TypeScript compiler configuration

8. **`cloudflare/worker/.gitignore`** (~5 lines)
   - Node modules, dist, wrangler cache

**Documentation:**
9. **`cloudflare/worker/README.md`** (~400 lines)
   - Complete deployment guide
   - API documentation
   - Development workflow
   - Troubleshooting guide
   - Security and privacy details
   - Cost estimation

10. **`docs/CLOUDFLARE_TELEMETRY_PHASE2_COMPLETE.md`** (this file)

---

## Architecture

```
┌─────────────────┐      HTTPS/HMAC-SHA256       ┌──────────────────────┐
│   Nexus Addon   │──────────────────────────────▶│  Cloudflare Worker   │
│   (Electron)    │  Signed telemetry events     │  nexus-analytics     │
└─────────────────┘                               └──────────────────────┘
        │                                                    │
        │ Fire-and-forget                                   ▼
        │ Local JSONL queue                        ┌──────────────────┐
        │                                          │  D1 Database     │
        │                                          │  (SQLite @edge)  │
        │                                          └──────────────────┘
        │                                                    │
        │                                                    │
        └────────────────────────────────────────────────────┘
                 Offline queue for reliability
```

---

## Database Schema

### Tables

**1. installations**
- Stores unique installations with secret keys for HMAC verification
- Tracks first/last seen timestamps
- Records addon version, OS, Node version

```sql
CREATE TABLE installations (
  installation_id TEXT PRIMARY KEY,
  secret_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  addon_version TEXT,
  os TEXT,
  node_version TEXT
);
```

**2. events**
- Stores all telemetry events
- Separate columns for common fields
- JSON blob for extensibility

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  tool_name TEXT,
  access_method TEXT,              -- 'mcp' or 'cli'
  success INTEGER,                 -- 1 = success, 0 = failure
  duration_ms INTEGER,
  error_category TEXT,
  memory_mb REAL,
  health_status TEXT,
  active_sites INTEGER,
  data TEXT,                       -- JSON blob
  FOREIGN KEY (installation_id) REFERENCES installations(installation_id)
);
```

**3. daily_aggregates** (future use)
- Pre-computed daily stats for dashboard performance

### Indexes

- `idx_events_installation` - Fast lookup by installation
- `idx_events_timestamp` - Time-range queries
- `idx_events_type` - Filter by event type
- `idx_events_tool` - Tool-specific queries
- `idx_events_access_method` - MCP vs CLI analysis

---

## API Endpoints

### POST /v1/events

**Purpose:** Receive telemetry event from addon

**Authentication:** HMAC-SHA256 signature

**Headers:**
```
Content-Type: application/json
X-Installation-Id: <uuid>
X-Signature: <hmac-sha256-hex>
X-Secret-Key: <base64>  (only on first request)
```

**Request Flow:**

1. **First Request (Registration):**
   - Client includes `X-Secret-Key` header with base64-encoded 32-byte secret
   - Worker verifies signature using provided secret
   - Worker stores installation + secret in database
   - Returns success

2. **Subsequent Requests:**
   - Client includes only `X-Signature` header
   - Worker looks up secret key by installation_id
   - Worker verifies signature using stored secret
   - Stores event in database
   - Updates installation last_seen_at
   - Returns success

**Response:**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` - Invalid event structure
- `401` - Missing headers or invalid signature
- `500` - Internal server error

---

### GET /v1/stats

**Purpose:** Get analytics statistics

**Authentication:** Optional Bearer token (if `ADMIN_TOKEN` secret is set)

**Headers:**
```
Authorization: Bearer <admin-token>  (if required)
```

**Response:**
```json
{
  "installations": {
    "total": 42,
    "active_7d": 35,
    "active_30d": 40
  },
  "events": {
    "total": 1234,
    "by_type": {
      "tool_call": 1000,
      "health_check": 200,
      "error": 34
    }
  },
  "tools": {
    "top_10": [
      {
        "tool_name": "wp_plugin_list",
        "count": 150,
        "success_count": 145,
        "error_count": 5,
        "avg_duration_ms": 234
      }
    ]
  },
  "access_methods": {
    "mcp": {
      "count": 600,
      "avg_duration_ms": 250
    },
    "cli": {
      "count": 400,
      "avg_duration_ms": 180
    },
    "percentage_mcp": 60
  }
}
```

**Metrics Provided:**
- Total installations
- Active installations (7-day, 30-day)
- Total events by type
- Top 10 most-used tools
- MCP vs CLI usage and performance

---

### GET /

**Purpose:** Health check

**Response:**
```json
{
  "service": "nexus-analytics",
  "status": "healthy",
  "version": "1.0.0",
  "endpoints": {
    "POST /v1/events": "Receive telemetry events",
    "GET /v1/stats": "Get analytics statistics"
  }
}
```

---

## HMAC Authentication Flow

### Client Side (Addon)

```typescript
// 1. Generate signature
const body = JSON.stringify(event);
const secretKey = getSecretKey(); // Base64-encoded 32 bytes
const signature = crypto.createHmac('sha256', Buffer.from(secretKey, 'base64'))
  .update(body)
  .digest('hex');

// 2. Send request
const headers = {
  'X-Installation-Id': installationId,
  'X-Signature': signature,
  // First request only:
  'X-Secret-Key': secretKey,
};
```

### Server Side (Worker)

```typescript
// 1. Extract headers
const { installationId, signature, secretKey } = extractHeaders(request);

// 2. First request: verify with provided secret
if (secretKey) {
  const isValid = await verifySignature(body, signature, secretKey);
  if (isValid) {
    await registerInstallation(db, installationId, secretKey, event);
  }
}

// 3. Subsequent requests: verify with stored secret
else {
  const installation = await getInstallation(db, installationId);
  const isValid = await verifySignature(body, signature, installation.secret_key);
  if (isValid) {
    await storeEvent(db, event);
  }
}
```

---

## Deployment Instructions

### Prerequisites

- Cloudflare account (free tier sufficient)
- Wrangler CLI installed: `npm install -g wrangler`
- Authenticated: `wrangler login`

### Step 1: Create D1 Database

```bash
cd cloudflare/worker

# Create database
wrangler d1 create nexus-analytics

# Output:
# ✅ Successfully created DB 'nexus-analytics'!
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Copy database_id to wrangler.toml
# Replace "TO_BE_CREATED" with your actual database_id
```

### Step 2: Apply Schema

```bash
# Apply schema to database
wrangler d1 execute nexus-analytics --file=schema.sql

# Verify tables created
wrangler d1 execute nexus-analytics --command="SELECT name FROM sqlite_master WHERE type='table'"

# Expected output:
# installations
# events
# daily_aggregates
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Deploy Worker

```bash
# Deploy to production
npm run deploy

# Output:
# ✨ Built successfully!
# ✨ Uploaded nexus-analytics
# ✨ Published nexus-analytics (1.23 sec)
#    https://nexus-analytics.<your-subdomain>.workers.dev
```

### Step 5: Set Admin Token (Optional)

```bash
# Generate random token
openssl rand -hex 32

# Store as secret
wrangler secret put ADMIN_TOKEN
# Paste token when prompted
```

### Step 6: Test Deployment

```bash
# Health check
curl https://nexus-analytics.<your-subdomain>.workers.dev/

# Stats (no auth if ADMIN_TOKEN not set)
curl https://nexus-analytics.<your-subdomain>.workers.dev/v1/stats
```

### Step 7: Update Addon

Update addon to use worker URL:

**Option A: Environment Variable**
```bash
export NEXUS_ANALYTICS_ENDPOINT=https://nexus-analytics.<your-subdomain>.workers.dev/v1/events
```

**Option B: Update Code (for production)**

Edit `src/main/telemetry/telemetry-config.ts`:
```typescript
export function getAnalyticsEndpoint(): string {
  const base = ENV_ENDPOINT || 'https://nexus-analytics.<your-subdomain>.workers.dev';
  return base.replace(/\/$/, '') + '/v1/events';
}
```

---

## Scheduled Cleanup

The worker includes a scheduled handler to delete events older than 90 days.

**Configure in wrangler.toml:**
```toml
[triggers]
crons = ["0 2 * * *"]  # Run at 2 AM UTC daily
```

**Deploy schedule:**
```bash
wrangler deploy
```

**Manually trigger cleanup:**
```bash
wrangler d1 execute nexus-analytics --command="DELETE FROM events WHERE timestamp < datetime('now', '-90 days')"
```

---

## Security Features

### HMAC-SHA256 Signing

✅ **Cryptographic Authentication:**
- 32-byte secret key (256 bits of entropy)
- SHA-256 hash function
- Signature covers entire request body
- Replay protection via timestamp validation

✅ **Secret Key Management:**
- Generated client-side (addon)
- Transmitted only once (first request)
- Stored server-side in D1 database
- Never transmitted after registration

### CORS

✅ **Cross-Origin Support:**
- Configurable origin via `CORS_ORIGIN` env var
- Preflight requests handled (OPTIONS)
- Default: `*` (accept all origins)

### Admin Token

✅ **Optional Stats Protection:**
- Set `ADMIN_TOKEN` secret to require Bearer auth on `/v1/stats`
- If not set, stats are public (read-only, no sensitive data)

---

## Monitoring & Observability

### Cloudflare Dashboard

**Workers Analytics:**
- Request count
- Error rate
- CPU time
- Bandwidth

**D1 Analytics:**
- Database size
- Query count
- Read/write operations

### Query Examples

```sql
-- Events per day
SELECT DATE(timestamp) as date, COUNT(*) as count
FROM events
GROUP BY DATE(timestamp)
ORDER BY date DESC
LIMIT 30;

-- Error rate by tool
SELECT tool_name,
  SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
  COUNT(*) as total
FROM events
WHERE event_type = 'tool_call'
GROUP BY tool_name
ORDER BY errors DESC;

-- MCP vs CLI adoption over time
SELECT DATE(timestamp) as date,
  access_method,
  COUNT(*) as count
FROM events
WHERE event_type = 'tool_call'
GROUP BY DATE(timestamp), access_method
ORDER BY date DESC;
```

---

## Cost Estimation

### Cloudflare Free Tier

**Workers:**
- 100,000 requests/day
- 10ms CPU time per request
- ✅ Adequate for <10,000 addon installations

**D1:**
- 5 GB storage
- 5 million rows read/day
- 100,000 rows written/day
- ✅ Adequate for <1,000,000 events/day

### Estimated Usage

**1,000 Installations:**
- 10 tool calls/day/installation = 10,000 events/day
- 1 health check/hour = 1,000/day
- **Total: 11,000 events/day** ✅ Well within free tier

**Storage:**
- ~500 bytes/event
- 11,000 events/day × 500 bytes = 5.5 MB/day
- 90-day retention = 495 MB total ✅ Well within 5 GB limit

### Paid Tier (if needed)

**Workers Paid ($5/month):**
- 10 million requests/month
- 50ms CPU time per request

**D1 Paid:**
- Currently free (as of March 2026)
- Future pricing TBD

---

## Privacy & GDPR Compliance

### Data Collected

✅ **Anonymous Only:**
- Installation ID (random UUID)
- Tool names
- Success/failure status
- Duration in milliseconds
- System info (OS, Node version)
- Access method (MCP vs CLI)

❌ **Never Collected:**
- User names, emails, IP addresses
- Site names, domains, paths
- WordPress content or structure
- Command arguments or parameters
- Any personally identifiable information

### User Rights

✅ **Right to Know:**
- MCP tool: `get_telemetry_status`
- Documentation clearly states what's collected

✅ **Right to Opt-Out:**
- MCP tool: `set_telemetry_enabled(false)`
- Environment variable: `NEXUS_TELEMETRY=0`

✅ **Right to Deletion:**
- MCP tool: `reset_telemetry(confirm=true)`
- Server: 90-day auto-deletion

✅ **Data Minimization:**
- Only collect what's necessary
- No PII, no WordPress data
- Random UUIDs, not user identifiers

---

## Testing

### Local Development

```bash
# Start local worker
npm run dev

# Worker runs on http://localhost:8787
```

### Test Event Ingestion

```bash
# Test health check
curl http://localhost:8787/

# Test event (will fail without valid signature - expected)
curl -X POST http://localhost:8787/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Installation-Id: test-uuid" \
  -H "X-Signature: invalid" \
  -d '{"installation_id":"test","event_type":"tool_call","timestamp":"2026-03-19T00:00:00Z"}'

# Expected: 401 Unauthorized (signature verification failed)
```

### Integration Test

Once deployed, the addon will automatically start sending events. Check:

```bash
# View stats
curl https://nexus-analytics.<your-subdomain>.workers.dev/v1/stats

# Should show:
# - installations.total > 0
# - events.total > 0
```

---

## Troubleshooting

### "Unknown installation" Error

**Cause:** First request didn't include `X-Secret-Key` header

**Solution:**
1. Check addon is sending secret key on first request
2. Verify database has installations table
3. Check CloudflareTransmitter.transmitEvent() logic

### "Invalid signature" Error

**Cause:** HMAC signature verification failed

**Solution:**
1. Verify addon and worker use same algorithm (SHA-256)
2. Check secret key is base64-encoded 32 bytes
3. Verify signature is hex-encoded
4. Ensure request body matches exactly (no whitespace changes)

**Debug:**
```bash
# Check stored secret for installation
wrangler d1 execute nexus-analytics \
  --command="SELECT installation_id, secret_key FROM installations WHERE installation_id = 'xxx'"
```

### Database Errors

**Check D1 status:**
```bash
wrangler d1 info nexus-analytics
```

**Verify schema:**
```bash
wrangler d1 execute nexus-analytics \
  --command="SELECT sql FROM sqlite_master WHERE type='table'"
```

### Worker Not Responding

**Check deployment:**
```bash
wrangler deployments list
```

**View logs:**
```bash
wrangler tail
```

---

## Next Steps

### Phase 3: Admin Dashboard (~1 day)

**Goal:** Create internal analytics dashboard

**Tasks:**
1. Create dashboard HTML/JS (static site)
2. Add charts and visualizations
3. Add date range filtering
4. Deploy to Cloudflare Pages or Workers
5. Implement authentication

**Dashboard Features:**
- Total installations (unique installation_ids)
- Daily/weekly/monthly active installations
- Total events by type (pie chart)
- Most used tools (bar chart)
- Error rates by tool (table)
- MCP vs CLI adoption (line chart over time)
- Average durations by tool (table)
- Health status distribution
- Active sites distribution

**Tech Stack:**
- Static HTML + Vanilla JS (no framework needed)
- Chart.js for visualizations
- Tailwind CSS for styling
- Cloudflare Pages for hosting

---

## Status Summary

### Phase 2 Complete ✅

**Implementation:**
- [x] HMAC verification module
- [x] D1 database schema
- [x] Database operations (registration, storage, queries)
- [x] Event ingestion endpoint
- [x] Statistics endpoint
- [x] Health check endpoint
- [x] Scheduled cleanup handler
- [x] CORS support
- [x] Complete documentation

**Ready for Deployment:**
- [x] Code complete
- [x] Schema ready
- [x] wrangler.toml configured
- [x] README with deployment steps
- [ ] D1 database created (requires Cloudflare account)
- [ ] Worker deployed (requires deployment)
- [ ] Addon endpoint updated

**Next:** Phase 3 - Admin Dashboard (~1 day)

---

**Date:** 2026-03-19
**Total Time:** ~2 hours (estimated 1 day, completed in 2 hours!)
**Lines of Code:** ~900 lines
**Files Created:** 10 files
