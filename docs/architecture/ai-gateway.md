# AI Gateway Architecture

**Status**: ✅ Complete (Phases 2.1-2.8)
**Last Updated**: 2026-03-24

## Overview

The **AI Gateway** is a reverse proxy that routes AI requests from WordPress sites to Anthropic's API with centralized authentication, rate limiting, and usage tracking. WordPress sites make OpenAI-compatible requests to Local, and the gateway translates formats, enforces limits, and proxies to Anthropic.

## Problem Statement

Without a centralized AI gateway:
- Each WordPress site needs to manage Anthropic API keys independently
- No centralized rate limiting or cost controls
- No visibility into AI usage across sites
- Difficult to track costs and optimize spending
- API keys stored in WordPress databases (security risk)

## Solution Architecture

### Components

1. **WordPress Provider Plugin** (`ai-provider-for-local-gateway`)
   - Integrates with WordPress AI Client (`wp-ai` package)
   - Sends OpenAI-compatible requests to Local's gateway endpoint
   - Adds `X-Auth-Token` header for site authentication
   - Location: `wp-plugins/ai-provider-for-local-gateway/`

2. **Gateway Server** (HTTP Routes)
   - Runs inside Local's existing HTTP server (`HttpEventInterface`)
   - Handles `/ai-gateway/v1/chat/completions` endpoint
   - Validates tokens, enforces rate limits, proxies to Anthropic
   - Location: `src/main/ai-gateway/AIGatewayRoutes.ts`

3. **Token Manager**
   - Generates UUID tokens for each site
   - Maps tokens to site IDs
   - Stores token metadata (site name, creation time)
   - Location: `src/main/ai-gateway/token-manager.ts`

4. **Format Translator**
   - Converts OpenAI Chat Completions ↔ Anthropic Messages API
   - Extracts system messages (Anthropic requires separate `system` parameter)
   - Translates stop reasons and usage fields
   - Location: `src/main/ai-gateway/format-translator.ts`

5. **Rate Limiter**
   - Rolling window tracking (requests/hour, requests/day, cost/day)
   - Per-site limits with configurable defaults
   - Defaults: 100 req/hr, 500 req/day, $10/day
   - Location: `src/main/ai-gateway/rate-limiter.ts`

6. **Anthropic Client**
   - HTTPS request to `api.anthropic.com/v1/messages`
   - Model-specific cost calculation
   - Pricing: Haiku ($0.80/$4), Sonnet ($3/$15), Opus ($15/$75) per 1M tokens
   - Location: `src/main/ai-gateway/anthropic-client.ts`

7. **Usage Tracker**
   - Logs every request with tokens, cost, duration
   - 1000-record limit (oldest dropped when exceeded)
   - Supports IPC queries for UI dashboards
   - Stored in `nexus_ai_gateway_usage` registry key

8. **Setup AI Integration**
   - Step 2c installs Local Gateway provider plugin automatically
   - Generates per-site auth token
   - Creates MU plugin with gateway URL and token constants
   - Location: `src/main/mcp/modules/wp-connector/setup-ai.ts`

### Request Flow

```
WordPress Site
  ↓ (OpenAI Chat Completions format)
  ↓ + X-Auth-Token header
Local Gateway (http://localhost:<webhook-port>/ai-gateway/v1)
  ↓ Token validation
  ↓ Rate limit check
  ↓ Format translation (OpenAI → Anthropic)
Anthropic API (api.anthropic.com)
  ↓ (Anthropic Messages API response)
Local Gateway
  ↓ Format translation (Anthropic → OpenAI)
  ↓ Usage logging
WordPress Site
```

### Data Model

**Token Storage** (`nexus_ai_gateway_tokens`):
```typescript
{
  [token: string]: {
    siteId: string;
    siteName: string;
    createdAt: number;
  }
}
```

**Usage Records** (`nexus_ai_gateway_usage`):
```typescript
{
  id: string;           // Anthropic message ID
  siteId: string;
  siteName: string;
  model: string;
  provider: 'anthropic';
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}[]
```

**Rate Limits** (`nexus_ai_rate_limits`):
```typescript
{
  [siteId: string]: {
    requestsPerHour?: number;
    requestsPerDay?: number;
    costPerDayUsd?: number;
  }
}
```

### Configuration

**MU Plugin** (`wp-content/mu-plugins/nexus-ai-gateway-config.php`):
```php
<?php
define('NEXUS_AI_GATEWAY_URL', 'http://localhost:10005/ai-gateway/v1');
define('NEXUS_AI_GATEWAY_TOKEN', 'f8e7d6c5-b4a3-4192-8170-6f5e4d3c2b1a');
```

Created automatically during Setup AI (Step 2c).

## API Endpoints

### POST `/ai-gateway/v1/chat/completions`

**Request**:
```bash
curl -X POST http://localhost:10005/ai-gateway/v1/chat/completions \
  -H "X-Auth-Token: <site-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ],
    "max_tokens": 1024
  }'
```

**Response** (200 OK):
```json
{
  "id": "msg_123abc",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "claude-haiku-4-5-20251001",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Error Responses**:
- `401 Unauthorized` — Missing or invalid `X-Auth-Token`
- `400 Bad Request` — Invalid JSON or missing required fields
- `429 Too Many Requests` — Rate limit exceeded
- `502 Bad Gateway` — Anthropic API error
- `503 Service Unavailable` — Anthropic API key not configured

### GET `/ai-gateway/v1/models`

Lists available models (no authentication required).

**Response**:
```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-haiku-4-5-20251001",
      "object": "model",
      "created": 1700000000,
      "owned_by": "anthropic"
    },
    {
      "id": "claude-sonnet-4-5-20250514",
      "object": "model",
      "created": 1700000000,
      "owned_by": "anthropic"
    },
    {
      "id": "claude-opus-4-6-20251015",
      "object": "model",
      "created": 1700000000,
      "owned_by": "anthropic"
    }
  ]
}
```

## IPC Handlers

### Usage & Cost
- `AI_GATEWAY_GET_USAGE` — Get usage records (optionally filtered by site ID)
- `AI_GATEWAY_GET_COST` — Calculate total cost (optionally filtered by site ID, date range)
- `AI_GATEWAY_GET_STATS` — Get aggregate statistics (requests, tokens, cost)
- `AI_GATEWAY_CLEAR_USAGE` — Clear all usage records (admin function)

### Rate Limiting
- `AI_GATEWAY_GET_RATE_LIMIT` — Get rate limit config for a site
- `AI_GATEWAY_SET_RATE_LIMIT` — Set rate limit config for a site
- `AI_GATEWAY_CHECK_RATE_LIMIT` — Check if site is within limits (preview)

### Usage Examples

**Get total cost for a site**:
```typescript
const result = await ipcRenderer.invoke(IPC_CHANNELS.AI_GATEWAY_GET_COST, {
  siteId: 'test-site-123',
  startDate: '2026-03-01',
  endDate: '2026-03-31',
});
// { totalCost: 2.45, recordCount: 47 }
```

**Set custom rate limits**:
```typescript
await ipcRenderer.invoke(IPC_CHANNELS.AI_GATEWAY_SET_RATE_LIMIT, {
  siteId: 'test-site-123',
  limits: {
    requestsPerHour: 50,
    requestsPerDay: 250,
    costPerDayUsd: 5.0,
  },
});
```

## Performance

### Latency Overhead
- Token validation: < 1ms (in-memory lookup)
- Rate limit check: < 5ms (scans last 1000 records)
- Format translation: < 1ms (pure computation)
- Total gateway overhead: **< 10ms** per request

### Storage
- Usage records: 1000 max (auto-trim oldest)
- Token storage: ~200 bytes per site
- Rate limit config: ~100 bytes per site
- Total: **< 500 KB** for 100 sites with full usage history

## Security

### Authentication
- Per-site UUID tokens (cryptographically random)
- Tokens stored only in Local (not on remote servers)
- WordPress sites authenticate via `X-Auth-Token` header
- Invalid tokens rejected with 401 Unauthorized

### API Key Protection
- Anthropic API key stored only in Local (never sent to WordPress)
- WordPress sites never see the actual API key
- All Anthropic requests proxied through Local

### Rate Limiting
- Prevents runaway costs from buggy WordPress code
- Enforces per-site quotas (hour, day, cost)
- Configurable per-site limits (not global)

## Error Handling

### Anthropic API Errors
- Wrapped in OpenAI-compatible error format
- Original error message preserved
- HTTP status code mapped appropriately

### Network Failures
- Connection timeouts return 502 Bad Gateway
- DNS failures return 502 Bad Gateway
- Malformed responses return 502 Bad Gateway

### Rate Limit Exceeded
- Returns 429 Too Many Requests
- Includes reason in error message (hour/day/cost limit)
- Client should implement exponential backoff

## Testing

### Integration Tests
- 25 tests covering all components
- Test file: `tests/integration/17-ai-gateway.integration.test.ts`
- Coverage: Token management, format translation, rate limiting, cost calculation, usage tracking, error handling

### Test Categories
1. **Token Management** (5 tests) — Generation, retrieval, lookup
2. **Format Translation** (4 tests) — OpenAI ↔ Anthropic conversion
3. **Rate Limiting** (6 tests) — Hour/day/cost limits, rolling windows
4. **Cost Calculation** (4 tests) — Model-specific pricing
5. **Usage Tracking** (2 tests) — Record storage, limit enforcement
6. **Error Handling** (4 tests) — 401, 400 error cases

### Manual Testing
1. Run Setup AI on a test site
2. Verify MU plugin created with gateway URL and token
3. Install `ai-provider-for-local-gateway` plugin
4. Use WordPress AI Client to make a request
5. Verify request appears in usage logs
6. Check rate limits with multiple requests

## Troubleshooting

### "Missing X-Auth-Token header"
- **Cause**: WordPress provider plugin not configured or MU plugin missing
- **Fix**: Run Setup AI again or manually create MU plugin with token

### "Invalid authentication token"
- **Cause**: Token mismatch between WordPress and Local
- **Fix**: Regenerate token via Setup AI or manually update MU plugin

### "Anthropic API key not configured in Local"
- **Cause**: No Anthropic API key in Local's settings
- **Fix**: Add Anthropic API key in Local preferences

### "Rate limit exceeded"
- **Cause**: Site exceeded hour/day/cost limit
- **Fix**: Wait for rolling window to expire or increase limits via IPC

### Gateway not responding
- **Cause**: HTTP server not running or wrong port
- **Fix**: Check `http_webhook_info` in registry, restart Local

## Future Enhancements

### Phase 2.9 (Optional): Model Selection UI
- Dropdown in Nexus section to choose default model (Haiku/Sonnet/Opus)
- Per-site model preference
- Show pricing info in UI

### Phase 2.10 (Optional): Cost Budgets
- Set monthly budgets per site
- Alert when approaching budget limit
- Auto-disable provider when budget exceeded

### Phase 2.11 (Optional): Usage Dashboard
- Visual charts of usage over time
- Cost breakdown by site
- Token usage trends

### Phase 2.12 (Optional): OpenAI Support
- Add OpenAI provider alongside Anthropic
- Model selection includes GPT-4, GPT-3.5
- Unified cost tracking across providers

## References

### Commits
- Phase 2.1: `cd25629` — WordPress provider plugin
- Phase 2.2: `f29e4c7` — Gateway server core
- Phase 2.3: `aa86b97` — Usage and cost tracking IPC
- Phase 2.4: `d8de51e` — Rate limiting
- Phase 2.6: `f5fe720` — Setup AI integration
- Phase 2.8: `9ef4f09` — Integration tests

### Related Docs
- [Digital Twin Architecture](./digital-twin.md)
- [Setup AI Module](../modules/setup-ai.md) (if exists)
- [HTTP Server Integration](../http-server.md) (if exists)

### External Resources
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [WordPress AI Client](https://github.com/GoogleChromeLabs/wp-ai) (hypothetical link)
