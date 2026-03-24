# AI Call Source Tracking - Requirements & Planning

**Status:** Requirements Discussion
**Target:** Week 3-4 (March 30 - April 12, 2026)

---

## Overview

Track which WordPress plugin, theme, or feature makes each AI request through the Local AI Gateway, enabling cost attribution, security controls, and debugging.

**User Story:**
> As a Local user monitoring AI usage, I want to see which plugins and features are consuming AI tokens, so I can identify runaway costs, block unauthorized usage, and understand which AI features are actually being used.

---

## Current State

**What we track now:**
- Site ID
- Model (claude-haiku-4-5, etc.)
- Timestamp
- Tokens (prompt + completion)
- Cost (USD)
- Duration (ms)

**What we DON'T track:**
- Which plugin made the request
- Which theme made the request
- Which WordPress AI experiment/feature
- Which user triggered the request
- Admin vs. frontend vs. AJAX vs. REST vs. CLI

**Pain points:**
1. "This site used 10,000 tokens today" — **but which plugin?**
2. Custom plugin calls AI on every page load — **how to detect?**
3. Want to disable AI for one experiment — **how to block?**
4. "AI stopped working" — **which plugin is calling it?**

---

## Questions to Answer

### 1. What Context to Capture?

**WordPress caller information:**

| Context | Example | Value | Overhead |
|---------|---------|-------|----------|
| **Plugin slug** | `my-custom-plugin` | High | Low |
| **Theme name** | `twentytwentyfour` | Medium | Low |
| **Feature/experiment** | `title_generation` | High | Low |
| **Function name** | `MyPlugin\generate_title` | Medium | Low |
| **File path** | `plugins/my-plugin/ai.php` | Low | Medium |
| **Line number** | `42` | Low | Medium |
| **User ID** | `1` | Medium | None |
| **User role** | `administrator` | Medium | None |
| **Request source** | `admin`, `frontend`, `ajax`, `rest`, `cli` | Medium | None |

**Questions:**

1. **Minimal set (Phase 1)?**
   - Recommended: Plugin slug + feature name + user ID
   - Fast, useful, actionable

2. **Enhanced set (Phase 2)?**
   - Add: Function name + file path + line number
   - Useful for debugging, but adds overhead

3. **Should we capture request source?**
   - Admin vs. frontend vs. AJAX vs. REST vs. WP-CLI
   - Helps identify runaway frontend calls

**Recommendation:** Start with **minimal** (plugin + feature + user ID). Add enhanced details in Phase 2 if needed.

---

### 2. How to Capture Caller Information?

**Three approaches:**

#### Option A: PHP Backtrace (Automatic)

**How it works:**
```php
// In LocalGatewayProvider or HTTP transporter
$backtrace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS);
foreach ($backtrace as $frame) {
    if (isset($frame['file'])) {
        // Extract plugin slug from path
        if (preg_match('#/plugins/([^/]+)/#', $frame['file'], $matches)) {
            $callerPlugin = $matches[1];
            break;
        }
        // Extract theme name from path
        if (preg_match('#/themes/([^/]+)/#', $frame['file'], $matches)) {
            $callerTheme = $matches[1];
            break;
        }
    }
}
```

**Pros:**
- ✅ Automatic — catches all callers
- ✅ No developer cooperation needed
- ✅ Works for existing plugins

**Cons:**
- ❌ Performance overhead: ~0.1-0.5ms per call
- ❌ Path-based detection might fail for symlinks
- ❌ Might not detect feature name (just plugin)

**Performance impact:**
- `debug_backtrace()`: ~0.1-0.5ms
- AI generation: 500-5000ms
- **Overhead: 0.01-0.1%** (negligible)

---

#### Option B: Manual Headers (Explicit)

**How it works:**
```php
// Developer must pass caller info explicitly
wp_ai_generate_text([
    'model' => 'claude-haiku',
    'prompt' => 'Write a post about...',
    'caller' => [
        'plugin' => 'my-custom-plugin',
        'feature' => 'auto-post-generator',
    ],
]);
```

**Pros:**
- ✅ Zero overhead
- ✅ Explicit intent
- ✅ Feature name included

**Cons:**
- ❌ Requires developer cooperation
- ❌ Easy to forget
- ❌ Won't work for existing plugins

---

#### Option C: Hybrid (Automatic + Override)

**How it works:**
```php
// Default: Use backtrace to detect plugin/theme
$callerPlugin = $this->detectPluginFromBacktrace();
$callerTheme = $this->detectThemeFromBacktrace();

// Allow manual override
if (isset($args['caller']['plugin'])) {
    $callerPlugin = $args['caller']['plugin'];
}
if (isset($args['caller']['feature'])) {
    $callerFeature = $args['caller']['feature'];
}
```

**Pros:**
- ✅ Automatic for all callers
- ✅ Explicit override for feature names
- ✅ Best of both worlds

**Cons:**
- ⚠️ Slightly more complex

---

**Questions:**

1. **Which approach to use?**
   - Recommended: **Option C (Hybrid)**
   - Automatic plugin detection + optional feature override

2. **Should we support disabling backtrace?**
   - User setting: "Disable caller tracking (better performance)"
   - Default: enabled

3. **Fallback behavior if detection fails?**
   - Log as `unknown` plugin
   - Or skip caller tracking entirely?

**Recommendation:** **Hybrid approach (Option C)** with backtrace enabled by default.

---

### 3. Where to Add Headers?

**Integration points in WordPress provider:**

#### Option A: In LocalGatewayProvider class

```php
// src/Provider/LocalGatewayProvider.php
class LocalGatewayProvider extends AbstractApiProvider {
    protected function makeRequest($endpoint, $body) {
        // Detect caller
        $caller = $this->detectCaller();

        // Add headers
        $headers = [
            'X-Auth-Token' => $this->getGatewayToken(),
            'X-WP-Caller-Plugin' => $caller['plugin'] ?? null,
            'X-WP-Caller-Theme' => $caller['theme'] ?? null,
            'X-WP-Caller-Feature' => $caller['feature'] ?? null,
            'X-WP-User-ID' => get_current_user_id(),
            'X-WP-User-Role' => $this->getUserRole(),
        ];

        return wp_remote_post($endpoint, [
            'headers' => $headers,
            'body' => json_encode($body),
        ]);
    }
}
```

**Pros:** Centralized, all requests get caller info

---

#### Option B: In HTTP transporter

```php
// If using custom HTTP transporter
class LocalGatewayHttpTransporter {
    public function send($request) {
        // Add caller headers before sending
        $caller = $this->detectCaller();
        $request->setHeader('X-WP-Caller-Plugin', $caller['plugin']);
        // ...
    }
}
```

**Pros:** Lower level, works for all request types

---

**Questions:**

1. **Which integration point?**
   - Recommended: **Option A (Provider class)**
   - Simpler, easier to test

2. **Should we cache backtrace results?**
   - Same plugin makes 100 requests in one page load
   - Cache backtrace result for duration of request
   - Reduces overhead from 0.5ms × 100 = 50ms to 0.5ms × 1

**Recommendation:** Add headers in `LocalGatewayProvider` class with request-scoped caching.

---

### 4. Gateway Storage Schema

**Current `UsageRecord`:**
```typescript
interface UsageRecord {
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
}
```

**Proposed additions:**

```typescript
interface UsageRecord {
    // ... existing fields ...

    // Caller information
    callerPlugin?: string;      // 'my-custom-plugin'
    callerTheme?: string;       // 'twentytwentyfour'
    callerFeature?: string;     // 'title_generation'
    callerFunction?: string;    // 'MyPlugin\generate_title' (Phase 2)
    callerFile?: string;        // 'plugins/my-plugin/ai.php:42' (Phase 2)

    // User context
    callerUserId?: number;      // 1
    callerUserRole?: string;    // 'administrator'

    // Request context
    callerSource?: 'admin' | 'frontend' | 'ajax' | 'rest' | 'cli';
}
```

**Database migration:**

```sql
-- Add new columns to usage table
ALTER TABLE ai_gateway_usage ADD COLUMN caller_plugin TEXT;
ALTER TABLE ai_gateway_usage ADD COLUMN caller_theme TEXT;
ALTER TABLE ai_gateway_usage ADD COLUMN caller_feature TEXT;
ALTER TABLE ai_gateway_usage ADD COLUMN caller_user_id INTEGER;
ALTER TABLE ai_gateway_usage ADD COLUMN caller_user_role TEXT;
ALTER TABLE ai_gateway_usage ADD COLUMN caller_source TEXT;
```

**Questions:**

1. **Should we make fields nullable?**
   - Yes, for backward compatibility
   - Old records won't have caller info

2. **Should we index these columns?**
   - Yes for `caller_plugin` (frequent filtering)
   - Maybe for `caller_feature`
   - No for others

3. **Should we store raw backtrace?**
   - For debugging: JSON blob of full backtrace
   - Adds significant storage overhead
   - Probably not worth it

**Recommendation:** Add nullable columns with index on `caller_plugin`. No raw backtrace storage.

---

### 5. UI/UX for Viewing

**Current AI Gateway Usage Panel:**

```
┌────────────────────────────────────────────────────────────┐
│ AI Gateway Usage                    [1h] [24h] [7d] [All]  │
├────────────────────────────────────────────────────────────┤
│ Total Requests: 1,234                                       │
│ Total Tokens: 567,890                                       │
│ Total Cost: $2.34                                           │
├────────────────────────────────────────────────────────────┤
│ Time    Site           Model   Tokens         Cost         │
│ 2:45pm  nexus-test     Haiku   1,234 (800+4)  $0.0012     │
│ 2:44pm  my-site        Sonnet  5,678 (4k+2k)  $0.0234     │
│ ...                                                         │
└────────────────────────────────────────────────────────────┘
```

**Proposed additions:**

#### Option A: Add "Caller" column

```
┌────────────────────────────────────────────────────────────────────┐
│ AI Gateway Usage                    [1h] [24h] [7d] [All]          │
├────────────────────────────────────────────────────────────────────┤
│ Total Requests: 1,234                                               │
│ Total Tokens: 567,890                                               │
│ Total Cost: $2.34                                                   │
├────────────────────────────────────────────────────────────────────┤
│ Time    Site       Model   Caller              Tokens     Cost     │
│ 2:45pm  nexus-test Haiku   ai/title_generation 1,234      $0.0012  │
│ 2:44pm  my-site    Sonnet  my-plugin           5,678      $0.0234  │
│ ...                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

**Pros:** Simple, doesn't change layout much
**Cons:** Caller column might be long (plugin/feature)

---

#### Option B: Expandable rows

```
┌────────────────────────────────────────────────────────────┐
│ 2:45pm  nexus-test  Haiku  1,234  $0.0012  [▼]            │
│   ↳ Plugin: ai                                             │
│   ↳ Feature: title_generation                              │
│   ↳ User: admin (ID: 1)                                    │
└────────────────────────────────────────────────────────────┘
```

**Pros:** Clean default view, detailed on expand
**Cons:** More clicks to see caller info

---

#### Option C: Separate "Caller" tab

```
Tabs: [Requests] [By Caller] [By Model]

┌────────────────────────────────────────────────────────────┐
│ By Caller                                                   │
├────────────────────────────────────────────────────────────┤
│ Plugin                   Requests   Tokens    Cost         │
│ ai                       1,234      567,890   $1.23        │
│   title_generation       800        400,000   $0.80        │
│   excerpt_generation     234        100,000   $0.20        │
│   alt_text_generation    200        67,890    $0.14        │
│ my-custom-plugin         456        234,567   $0.50        │
│ ...                                                         │
└────────────────────────────────────────────────────────────┘
```

**Pros:** Clean separation, aggregated view
**Cons:** More complex UI

---

**Questions:**

1. **Which UI approach?**
   - Recommended: **Option A (Caller column) + Option C (By Caller tab)**
   - Column for individual requests, tab for aggregated view

2. **Should we add filters?**
   - Dropdown: "Filter by plugin"
   - Dropdown: "Filter by feature"
   - Text search: "Search caller"

3. **Should we add "Group by" toggle?**
   - Toggle: "Group by plugin" (aggregates rows)
   - Shows total per plugin instead of per request

**Recommendation:** Add Caller column + new "By Caller" tab + filter dropdowns.

---

### 6. Analytics & Reporting

**New panel: "AI Usage by Plugin"**

```
┌────────────────────────────────────────────────────────────┐
│ AI Usage by Plugin                                          │
├────────────────────────────────────────────────────────────┤
│ Top Plugins (Last 7 Days)                                   │
│                                                              │
│ 1. ai                       45%  ████████                   │
│    1,234 requests  $1.23                                    │
│                                                              │
│ 2. my-custom-plugin         30%  █████                      │
│    823 requests    $0.89                                    │
│                                                              │
│ 3. twentytwentyfour theme   15%  ███                        │
│    411 requests    $0.34                                    │
│                                                              │
│ 4. unknown                  10%  ██                         │
│    274 requests    $0.22                                    │
└────────────────────────────────────────────────────────────┘
```

**Features:**
- Pie chart of usage by plugin
- Bar chart of cost by plugin
- Table with plugin name, requests, tokens, cost
- Click plugin → filter to show only that plugin's requests
- Export to CSV

**Questions:**

1. **Should this be a separate panel or tab?**
   - Separate panel in Overview
   - Or tab in AI Gateway Usage

2. **What time ranges to support?**
   - Today, 7 days, 30 days, All time
   - Match existing time filters

3. **Should we show "Unknown" callers?**
   - Requests where plugin detection failed
   - Or hide them?

**Recommendation:** Separate panel in Overview with "Unknown" category visible.

---

### 7. Security & Blocking

**Use case:** Block specific plugins from using AI.

#### Scenario 1: Runaway plugin

Developer builds a plugin that calls AI on every page load (100 requests/minute).

**Solution:**
- View "By Caller" tab
- See `runaway-plugin` is making 6,000 requests/hour
- Click "Block" button
- Gateway returns 403 Forbidden for that plugin
- Plugin's AI calls fail gracefully

#### Scenario 2: Unauthorized usage

User installs a third-party plugin that secretly uses AI without disclosure.

**Solution:**
- See `shady-plugin` in usage logs
- User didn't expect this plugin to use AI
- Block it
- Audit log shows blocked attempts

---

**Blocking UI mockup:**

```
┌────────────────────────────────────────────────────────────┐
│ AI Usage by Plugin                                          │
├────────────────────────────────────────────────────────────┤
│ my-custom-plugin                                            │
│   1,234 requests  $1.23                                     │
│   Status: Allowed                           [Block Plugin] │
└────────────────────────────────────────────────────────────┘
```

**After blocking:**

```
┌────────────────────────────────────────────────────────────┐
│ my-custom-plugin                                            │
│   Status: ⛔ Blocked                      [Unblock Plugin] │
│   Last attempt: 2 minutes ago                               │
│   Blocked attempts: 42                                      │
└────────────────────────────────────────────────────────────┘
```

**Questions:**

1. **Block at which level?**
   - Plugin level (block entire plugin)
   - Feature level (block specific experiment, allow others)
   - User level (block AI for specific WordPress users)

2. **What happens when blocked?**
   - Return 403 Forbidden (hard block)
   - Return 429 Rate Limited (soft block, suggests retry)
   - Return 402 Payment Required (hint at cost concern)

3. **Should we log blocked attempts?**
   - Yes, for audit trail
   - Show in UI: "23 blocked requests in last hour"

4. **Should we support allow lists?**
   - Inverse: Only these plugins can use AI
   - More restrictive, harder to manage

**Recommendation:**
- Block at **plugin level** (simplest)
- Return **403 Forbidden** when blocked
- **Log blocked attempts** for audit
- **No allow lists** in Phase 1 (can add later)

---

### 8. Performance Considerations

**Backtrace overhead:**

| Operation | Time | Impact |
|-----------|------|--------|
| `debug_backtrace()` | 0.1-0.5ms | Negligible |
| AI generation | 500-5000ms | Dominant |
| **Overhead** | **0.01-0.1%** | **Acceptable** |

**Questions:**

1. **Is 0.1-0.5ms overhead acceptable?**
   - For AI requests (already slow): Yes
   - For every HTTP request: No
   - Recommended: **Only run backtrace for AI requests**

2. **Should we cache backtrace within request?**
   - Same plugin makes 10 AI calls in one page load
   - Cache result: 0.5ms × 1 instead of 0.5ms × 10
   - Recommended: **Yes, cache per request**

3. **Should we support disabling caller tracking?**
   - User setting: "Disable caller tracking for performance"
   - Default: enabled
   - Recommended: **Yes, but default enabled**

**Recommendation:** Acceptable overhead with request-scoped caching.

---

## Implementation Checklist

Before starting implementation, confirm decisions on:

- [ ] **Context to capture:** Plugin slug + feature name + user ID (minimal)?
- [ ] **Capture method:** Hybrid (backtrace + manual override)?
- [ ] **Integration point:** LocalGatewayProvider class?
- [ ] **Storage schema:** Add nullable columns with index on caller_plugin?
- [ ] **UI approach:** Caller column + "By Caller" tab + filters?
- [ ] **Analytics panel:** Separate "AI Usage by Plugin" panel?
- [ ] **Blocking:** Plugin-level blocks with 403 response?
- [ ] **Performance:** 0.1-0.5ms backtrace overhead acceptable?

---

## Next Steps

1. **Answer all questions above**
2. **Create detailed implementation plan** (Phase 4.1-4.6)
3. **Start Phase 4.1:** WordPress provider changes (backtrace + headers)
4. **Build incrementally:** Start with capture, add blocking later
