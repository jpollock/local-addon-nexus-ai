# Short-Term Roadmap

**Status:** Planning (March 2026)
**Target:** Next 2-4 weeks

---

## 1. Digital Twin: Complete Site State Persistence

### Problem Statement

Currently, the addon has **incomplete persistence** of site state:

**Persistent (✅ Works across restarts):**
- Content (vector store)
- Graph structure (plugins, themes, users as nodes)
- Event timeline (WordPress events from connector plugin)
- AI setup state (just added in commit 58f8e86)
- User credentials (API keys)

**Ephemeral (❌ Requires live WP-CLI query every time):**
- WordPress version
- Plugin list and status
- Theme info
- PHP version, MySQL version
- Site configuration

**The Gap:**
When a site is slow to start, WP-CLI times out, or the site is halted, the UI shows stale/missing data even though we KNOW this information from previous sessions.

**Example:** Before commit 58f8e86, AI setup status showed "Not installed" after Local restart because WP-CLI query failed, even though we knew the site had been setup successfully.

### Solution: "Last Known State" Cache

Add a persistent metadata cache that stores WordPress runtime state with timestamps.

#### Data Model

```typescript
// Storage key
STORAGE_KEYS.SITE_METADATA: `${ADDON_PREFIX}_site_metadata`

// Structure
interface SiteMetadata {
  wpVersion: string;              // "7.0-beta6-62094"
  phpVersion: string;             // "8.3"
  mysqlVersion?: string;          // "8.0.35"
  plugins: Array<{
    name: string;                 // "ai"
    title: string;                // "AI"
    version: string;              // "0.6.0"
    status: 'active' | 'inactive';
    file?: string;                // "ai/ai.php"
  }>;
  theme: {
    name: string;                 // "twentytwentyfour"
    title: string;                // "Twenty Twenty-Four"
    version: string;              // "1.0"
    status: 'active' | 'inactive';
  };
  activeTheme?: string;           // name of the current active theme
  siteUrl?: string;
  adminEmail?: string;
  lastUpdated: number;            // timestamp
  updateSource: 'lifecycle' | 'manual' | 'periodic';
  isStale?: boolean;              // true if > 24 hours old
}

// Storage shape
Record<string, SiteMetadata>
```

#### Update Triggers

1. **Site start** (lifecycle hook `siteStarted`)
   - Always refresh metadata when site starts
   - Most accurate, happens automatically

2. **Setup AI completes**
   - Refresh after plugin installations
   - Ensures plugin list is current

3. **Manual refresh**
   - User clicks "Refresh" button in UI
   - Useful for debugging or forcing update

4. **Periodic refresh** (optional, Phase 2)
   - Every 15 minutes while site is running
   - Catches manual plugin activations
   - Skipped if not needed (adds complexity)

#### Cache Invalidation

- **On site deletion:** Remove metadata entry
- **Age indicator:** Show "as of X minutes ago" in UI
- **Stale marker:** Flag if > 24 hours old
- **Drift detection:** Compare cached vs. live when both available
  - If mismatch: update cache, log warning
  - Useful for debugging "why did status change?"

#### UI Changes

**Before (current):**
```
AI plugin: [Loading...]  (WP-CLI query in progress)
AI plugin: Not installed  (WP-CLI timeout or site halted)
```

**After (with cache):**
```
AI plugin: Active (as of 2 minutes ago)
AI plugin: Active (last seen 3 hours ago, site is halted)
```

#### Implementation Plan

**Phase 1.1: Core Infrastructure (Day 1-2)**
- [ ] Add `SITE_METADATA` storage key to constants
- [ ] Create `SiteMetadataCache` class in `src/main/metadata/SiteMetadataCache.ts`
  - Methods: `get()`, `set()`, `refresh()`, `invalidate()`
  - Age calculation, staleness detection
- [ ] Add IPC handler `GET_SITE_METADATA`
- [ ] Unit tests for cache logic

**Phase 1.2: Lifecycle Integration (Day 3)**
- [ ] Hook into `siteStarted` lifecycle event
- [ ] Call `wpCli.getVersion()`, `wpCli.getPlugins()`, `wpCli.getThemes()`
- [ ] Store in cache with `updateSource: 'lifecycle'`
- [ ] Integration test: site start → cache updated

**Phase 1.3: UI Integration (Day 4-5)**
- [ ] Update `GET_AI_STATUS` to use cached plugin list as fallback
- [ ] Update `GET_WP_VERSION` to use cached version as fallback
- [ ] Add "last updated" timestamp to UI components
- [ ] Show staleness indicator (yellow dot if > 1 hour old)
- [ ] Add "Refresh" button to force cache update

**Phase 1.4: Setup AI Integration (Day 5)**
- [ ] Refresh cache after `setupSiteForAI()` completes
- [ ] Ensures plugin list reflects new installations

**Phase 1.5: Testing & Polish (Day 6)**
- [ ] E2E test: setup AI → restart Local → verify status persists
- [ ] E2E test: deactivate plugin manually → cache shows drift
- [ ] Performance test: 50 sites, all cached, UI loads instantly
- [ ] Documentation in `docs/architecture/digital-twin.md`

#### Success Metrics

- **UI responsiveness:** Site info section loads in < 100ms (no WP-CLI wait)
- **Accuracy:** Cache matches live state 99% of the time
- **Persistence:** AI status survives Local restart 100% of the time
- **User clarity:** Timestamp shows how fresh the data is

#### Future Enhancements (Phase 2, not in scope)

- Periodic refresh while site running (15 min interval)
- Historical snapshots ("plugin activated 3 days ago")
- Diff detection ("3 plugins changed since last cache")
- Export cache as JSON for debugging

---

## 2. Local AI Gateway: Centralized Credential Management

### Problem Statement

**Current state (WordPress 7.0 AI plugin):**
- Each site stores API keys in its own `wp_options` table
- Keys are synced from Local addon via `wp eval` + credential-sync PHP
- Sites make direct API calls to OpenAI, Anthropic, Google, etc.
- No centralization, no usage tracking, no rate limiting

**Pain points:**
1. **Key sprawl:** Same API key duplicated across 50 sites
2. **No visibility:** Can't see which site is using how many tokens
3. **No control:** Can't disable a site's API access without WP-CLI
4. **Security:** API keys written to database (even though encrypted, still in DB)
5. **Offline testing:** Can't mock AI responses for E2E tests

### Solution: Local AI Gateway (Reverse Proxy)

Add an HTTP proxy server in the Local addon that:
- Stores credentials centrally (one place, already done)
- Routes AI requests from WordPress sites to provider APIs
- Adds usage tracking, rate limiting, and audit logging
- Enables testing, monitoring, and cost control

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ WordPress Site (localhost:10000)                                │
│                                                                  │
│  wp_ai_generate_text([                                          │
│    'model' => 'claude-haiku-4-5-20251001',                      │
│    'prompt' => 'Write a post about...'                          │
│  ])                                                              │
│                                                                  │
│  ↓ (AI plugin's ProviderRegistry)                               │
│                                                                  │
│  LocalGatewayProvider->generate_text()                          │
│    reads: NEXUS_AI_GATEWAY_URL, NEXUS_AI_GATEWAY_TOKEN          │
│                                                                  │
│  POST http://localhost:52847/ai-gateway/v1/chat/completions     │
│  Headers:                                                        │
│    X-Auth-Token: <per-site UUID from mu-plugin>                 │
│  Body: { model: "claude-haiku-4-5", messages: [...] }           │
│        (OpenAI Chat Completions format)                         │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ (localhost, no network)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Local AI Gateway (webhook server on localhost:52847)            │
│  Route: /ai-gateway/v1/chat/completions                         │
│                                                                  │
│  1. Verify X-Auth-Token (lookup site ID from token)             │
│  2. Load site settings (model, rate limit) from addon storage   │
│  3. Check rate limit (100 req/hr per site)                      │
│  4. Translate OpenAI format → Anthropic Messages API:           │
│     { model: "claude-haiku", messages: [...] }                  │
│  5. Lookup Anthropic API key (from addon config)                │
│  6. Call Anthropic API:                                         │
│     POST https://api.anthropic.com/v1/messages                  │
│     x-api-key: sk-ant-...                                       │
│  7. Translate Anthropic response → OpenAI format                │
│  8. Log usage to graph DB (site, model, tokens, cost)           │
│  9. Return response to WordPress                                │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ (internet)
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Anthropic API        │
                    │ (Claude Haiku 4.5)   │
                    └──────────────────────┘
```

#### Requirements Discussion (To Do)

**Core Requirements:**
1. **Provider routing:** Which providers to support?
   - OpenAI (gpt-4, gpt-4o, gpt-3.5-turbo)
   - Anthropic (claude-3-5-sonnet, claude-3-opus)
   - Google (gemini-pro, gemini-1.5-pro)
   - Ollama (local models, already supported)
   - Others? (Cohere, Mistral, Azure OpenAI?)

2. **Authentication:**
   - How does WordPress prove it's allowed to use the gateway?
   - Per-site tokens? (generated by addon, stored in mu-plugin)
   - HMAC signatures? (like telemetry uses)
   - IP allowlist? (localhost only, but which port?)

3. **API compatibility:**
   - OpenAI Chat Completions format? (most common, WordPress AI plugin uses it)
   - Provider-specific formats? (Anthropic Messages API is different)
   - Translation layer? (convert OpenAI format → Anthropic format)

4. **Usage tracking:**
   - What to log? (site ID, model, prompt tokens, completion tokens, cost)
   - Where to store? (graph DB, separate SQLite, in-memory?)
   - Retention? (30 days? 90 days? forever?)

5. **Rate limiting:**
   - Per-site limits? (100 requests/hour per site)
   - Per-user limits? (1000 requests/day total)
   - Cost limits? ($5/day per site)
   - What happens when limit exceeded? (429 error, queue, email notification?)

6. **Configuration:**
   - Per-site settings? (site A uses gpt-4, site B uses claude)
   - Fallback providers? (try OpenAI, if fails try Anthropic)
   - Model aliasing? ("smart" → gpt-4 for site A, claude for site B)

7. **Error handling:**
   - Provider API down? (fail immediately, retry, fallback?)
   - Invalid API key? (fail, or try different provider?)
   - Rate limited by provider? (queue, or return 429 to WordPress?)

8. **Testing & Development:**
   - Mock mode? (return fake responses without hitting real APIs)
   - Replay mode? (record real responses, replay in tests)
   - Cost tracking? (how much did this test run cost?)

**Non-functional Requirements:**
- **Performance:** < 50ms overhead (token lookup + logging)
- **Reliability:** 99.9% uptime (gateway crashes should not break WordPress)
- **Security:** API keys never leave Local process, never written to WordPress DB
- **Observability:** Logs show which site is using which model, how many tokens
- **Scalability:** Handle 50 sites × 100 requests/hour = 5000 req/hr

#### Implementation Plan (Draft, pending requirements discussion)

**Phase 2.1: Provider Plugin (Day 1-2)**
- [ ] Create `wp-plugins/ai-provider-for-local-gateway/`
- [ ] Plugin header, register with `ProviderRegistry`
- [ ] Read `NEXUS_AI_GATEWAY_TOKEN` constant
- [ ] Implement `generate_text()` method (calls gateway)
- [ ] OpenAI Chat Completions format for requests
- [ ] Handle responses, map to WordPress AI plugin format
- [ ] Unit tests (mock gateway responses)

**Phase 2.2: Gateway Server Core (Day 3-4)**
- [ ] Add routes to webhook server: `/ai-gateway/v1/chat/completions`
- [ ] Authentication middleware (validate `X-Auth-Token` header)
- [ ] Extract site ID from token lookup
- [ ] Load site settings (provider, model) from storage
- [ ] Translate OpenAI format → Anthropic Messages API
- [ ] Call Anthropic API with stored credentials
- [ ] Return response in OpenAI format

**Phase 2.3: Usage & Cost Tracking (Day 5)**
- [ ] Create `ai_gateway_usage` table in graph DB
- [ ] Log each request: site ID, model, timestamp, tokens (prompt + completion)
- [ ] Calculate cost (Anthropic pricing: $0.80/1M input, $4/1M output for Haiku)
- [ ] IPC handler `GET_AI_GATEWAY_USAGE` (site-level, fleet-level, date range)
- [ ] IPC handler `GET_AI_GATEWAY_COST` (per site, total)

**Phase 2.4: Rate Limiting (Day 6)**
- [ ] Add `AI_RATE_LIMITS` storage key (per-site limits)
- [ ] Check request count in rolling window (last hour, last day)
- [ ] Return 429 if over limit
- [ ] IPC handler `UPDATE_AI_RATE_LIMIT` (set per-site limit)
- [ ] Default: 100 requests/hour per site

**Phase 2.5: Dashboard Integration (Day 7-8)**
- [ ] Add "AI Gateway" section to Nexus Overview dashboard
- [ ] Show: total requests today, total cost today, top 5 sites by usage
- [ ] Show: rate limit status (X of Y requests used)
- [ ] Chart: requests over time (last 7 days)
- [ ] Chart: cost over time (last 30 days)

**Phase 2.6: Setup AI Integration (Day 9)**
- [ ] Install `ai-provider-for-local-gateway` plugin during Setup AI
- [ ] Generate per-site auth token (UUID)
- [ ] Write mu-plugin with constants:
  ```php
  define('NEXUS_AI_GATEWAY_TOKEN', '<uuid>');
  define('NEXUS_AI_GATEWAY_URL', 'http://localhost:52847/ai-gateway/v1');
  define('NEXUS_AI_PROVIDER', 'local-gateway');
  define('NEXUS_AI_MODEL', 'claude-haiku-4-5-20251001');
  ```
- [ ] Activate provider plugin
- [ ] Set as default provider in WordPress AI settings

**Phase 2.7: UI for Model Selection (Day 10, Optional)**
- [ ] Add dropdown in Nexus Site Info: "AI Model"
- [ ] Options: claude-haiku-4-5, claude-sonnet-4-5, gpt-4, gpt-4o
- [ ] Update mu-plugin constants when changed
- [ ] Gateway reads model from constants, routes accordingly

**Phase 2.8: Testing & Polish (Day 11-12)**
- [ ] E2E test: Setup AI → provider installed → WordPress calls AI → gateway routes → mock Anthropic
- [ ] E2E test: Invalid token → 401 error
- [ ] E2E test: Rate limit exceeded → 429 error
- [ ] E2E test: Usage tracked correctly
- [ ] E2E test: Cost calculated correctly
- [ ] Mock mode (return fake responses without real API calls)
- [ ] Documentation in `docs/ai-gateway.md`

**Phase 2.9: Advanced Features (Future, not in scope)**
- [ ] Model aliasing (`local-smart` → claude-sonnet, `local-fast` → claude-haiku)
- [ ] Fallback providers (Anthropic fails → try OpenAI)
- [ ] Cost alerts (email when > $X/day)
- [ ] Replay mode for testing (record/replay real API responses)
- [ ] Multi-provider support (OpenAI, Google, in addition to Anthropic)

#### Requirements (Decided)

1. **Provider Name:** "Local AI Gateway"

2. **Default Model:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
   - Fastest, cheapest Claude model
   - Great for content generation, summarization, alt text
   - Pricing: $0.80/1M input tokens, $4/1M output tokens
   - User can override in Local UI (Phase 2)

3. **Settings Source of Truth:** Local UI (Nexus Site Info section)
   - User selects provider/model in Local
   - Setup AI writes constants to WordPress mu-plugin
   - WordPress reads `NEXUS_AI_PROVIDER`, `NEXUS_AI_MODEL` constants
   - No bi-directional sync (too complex for Phase 1)

4. **Gateway Port:** Reuse webhook server (52847)
   - Add routes: `/ai-gateway/v1/chat/completions`
   - Simpler than dedicated port, fewer moving parts

5. **Phase 1 Features:**
   - ✅ Routing + credential lookup (from addon config)
   - ✅ Usage tracking (site ID, model, tokens, timestamp)
   - ✅ Cost tracking (token count → USD via provider pricing)
   - ✅ Rate limiting (per-site, configurable in Local UI)
   - ✅ API format translation (OpenAI Chat Completions → Anthropic Messages API)
   - ✅ Dashboard integration (usage stats, cost, top sites, rate limit status)

6. **WordPress Integration:** Provider plugin approach
   - Create `ai-provider-for-local-gateway` (bundled in addon)
   - Registers with WordPress AI plugin's `ProviderRegistry`
   - Reads provider/model from mu-plugin constants
   - Makes API calls to `http://localhost:52847/ai-gateway/v1/chat/completions`
   - Gateway handles translation + routing

7. **Token Management:**
   - Generate per-site token on first Setup AI
   - Store in mu-plugin constants (`NEXUS_AI_GATEWAY_TOKEN`)
   - Provider plugin sends as `X-Auth-Token` header
   - Gateway validates before proxying

8. **Testing Strategy:**
   - Mock mode (return fake responses without hitting Anthropic API)
   - Usage tracking in tests (verify gateway logs correctly)
   - Rate limiting tests (verify 429 errors when limit exceeded)

---

## Timeline

**Week 1:**
- Digital Twin Phase 1.1-1.2 (Days 1-3)
- **Requirements discussion for AI Gateway** (Day 3-4)

**Week 2:**
- Digital Twin Phase 1.3-1.5 (Days 1-3)
- AI Gateway Phase 2.1 (Days 4-5)

**Week 3:**
- AI Gateway Phase 2.2-2.3 (Days 1-5)

**Week 4:**
- AI Gateway Phase 2.4 (Days 1-3)
- Buffer for polish, testing, documentation

---

## Success Criteria

**Digital Twin:**
- [ ] AI setup status persists across Local restart (100% success rate)
- [ ] Site metadata loads instantly (< 100ms, no WP-CLI wait)
- [ ] UI shows data age ("as of 2 minutes ago")
- [ ] 50 sites load without WP-CLI query storm

**AI Gateway:**
- [ ] WordPress AI plugin calls route through gateway
- [ ] API keys stored centrally (not in WordPress DB)
- [ ] Usage tracked per site (tokens, cost, model)
- [ ] Gateway adds < 50ms latency
- [ ] E2E tests run without real API calls (mock mode)

---

## Risks & Dependencies

**Digital Twin:**
- **Risk:** Cache grows large with many sites (50 sites × 100 plugins = 5000 entries)
  - Mitigation: Store only essential fields, compress with msgpack
- **Risk:** Stale cache shows wrong data
  - Mitigation: Show age, mark stale, refresh on site start

**AI Gateway:**
- **Risk:** WordPress AI plugin doesn't support custom endpoints
  - Mitigation: Hook `pre_http_request` to intercept, rewrite URLs
- **Risk:** Provider API changes break gateway
  - Mitigation: Version provider clients, test against real APIs
- **Risk:** Gateway crashes, WordPress can't use AI
  - Mitigation: Fallback to direct API calls if gateway unreachable

**Dependencies:**
- WordPress 7.0+ (AI plugin requires it)
- WP-CLI (for metadata refresh)
- HTTP event interface (for usage logging)
- Graph DB (for usage storage)

---

## Next Steps

1. **Review this roadmap** (you + team)
2. **Requirements discussion for AI Gateway:**
   - Provider support (which APIs?)
   - Authentication (per-site tokens? HMAC?)
   - Usage tracking (what to log?)
   - Rate limiting (how aggressive?)
   - Testing strategy (mock mode? replay mode?)
3. **Prioritize:** Digital Twin first (simpler, unblocks AI gateway)
4. **Start Phase 1.1** (Digital Twin core infrastructure)
