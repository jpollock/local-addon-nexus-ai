# WordPress Event Sender Plugin - Design Document

## Overview

A WordPress plugin that sends real-time events to Local's Nexus AI addon, enabling **incremental context updates** as WordPress content and configuration changes occur.

## Problem Statement

**Current State:**
- Initial context is built when site starts (one-time snapshot)
- Changes made in WordPress (new posts, plugin activations, etc.) are **not** reflected in AI context until site restarts
- Users must manually call `reindex_site` to update context

**Desired State:**
- WordPress changes **automatically** update AI context in real-time
- No manual reindexing needed
- AI always has up-to-date site information

---

## Architecture

### High-Level Flow

```
WordPress Action Hook
       ↓
Event Builder (creates JSON payload)
       ↓
HTTP Client (sends to Local webhook)
       ↓
Local HTTP Interface (receives event)
       ↓
Event Processor (queues event)
       ↓
Event Handlers (update graph + embeddings)
       ↓
Updated Context (available via MCP tools)
```

### Components

#### 1. **Event Hooks** (WordPress side)
Hook into WordPress actions and build event payloads:
- `save_post` → `post_created` / `post_updated`
- `delete_post` → `post_deleted`
- `activated_plugin` → `plugin_activated`
- `deactivated_plugin` → `plugin_deactivated`
- `upgrader_process_complete` → `plugin_updated` / `theme_updated`
- `switch_theme` → `theme_changed`

#### 2. **Event Builder** (WordPress side)
Normalizes WordPress data into standard event format:
- Extracts relevant data from hook arguments
- Filters out sensitive data (passwords, keys, etc.)
- Creates JSON payload with metadata

#### 3. **HTTP Client** (WordPress side)
Sends events to Local:
- Uses `wp_remote_post()` for reliability
- Includes auth token from plugin settings
- Non-blocking (doesn't slow down WordPress)
- Retries on failure (with exponential backoff)

#### 4. **Configuration** (WordPress side)
Stores webhook endpoint and auth token:
- **Option A:** Auto-injected by Local during site start
- **Option B:** Manual configuration via Settings page
- **Option C:** Detect from wp-config.php constants

---

## Event Schema

### Standard Event Format

```json
{
  "site_id": "abc123",
  "event_type": "post_updated",
  "timestamp": 1709668800000,
  "payload": {
    // Event-specific data
  }
}
```

### Event Types

#### 1. Content Events

**`post_created`**
```json
{
  "event_type": "post_created",
  "payload": {
    "post_id": 42,
    "post_type": "post",
    "title": "New Blog Post",
    "content": "Full post content...",
    "excerpt": "Short excerpt...",
    "status": "publish",
    "author_id": 1,
    "categories": [1, 5],
    "tags": [3, 7, 9],
    "created_at": 1709668800000,
    "updated_at": 1709668800000
  }
}
```

**`post_updated`**
```json
{
  "event_type": "post_updated",
  "payload": {
    "post_id": 42,
    "post_type": "post",
    "title": "Updated Blog Post",
    "content": "Updated content...",
    "excerpt": "Updated excerpt...",
    "status": "publish",
    "author_id": 1,
    "categories": [1, 5, 8],
    "tags": [3, 7],
    "created_at": 1709668800000,
    "updated_at": 1709670000000,
    "changes": {
      "title": true,
      "content": true,
      "categories": true
    }
  }
}
```

**`post_deleted`**
```json
{
  "event_type": "post_deleted",
  "payload": {
    "post_id": 42,
    "post_type": "post",
    "title": "Deleted Post",
    "deleted_at": 1709670000000
  }
}
```

#### 2. Plugin Events

**`plugin_activated`**
```json
{
  "event_type": "plugin_activated",
  "payload": {
    "slug": "akismet",
    "name": "Akismet Anti-spam",
    "version": "5.3.1",
    "author": "Automattic",
    "description": "Akismet checks your comments...",
    "is_active": true
  }
}
```

**`plugin_deactivated`**
```json
{
  "event_type": "plugin_deactivated",
  "payload": {
    "slug": "akismet",
    "name": "Akismet Anti-spam",
    "version": "5.3.1",
    "is_active": false
  }
}
```

**`plugin_updated`**
```json
{
  "event_type": "plugin_updated",
  "payload": {
    "slug": "akismet",
    "name": "Akismet Anti-spam",
    "old_version": "5.3.0",
    "new_version": "5.3.1",
    "is_active": true
  }
}
```

#### 3. Theme Events

**`theme_changed`**
```json
{
  "event_type": "theme_changed",
  "payload": {
    "old_theme": "twentytwentythree",
    "new_theme": "twentytwentyfour",
    "theme_name": "Twenty Twenty-Four",
    "theme_version": "1.0",
    "changed_at": 1709670000000
  }
}
```

**`theme_updated`**
```json
{
  "event_type": "theme_updated",
  "payload": {
    "slug": "twentytwentyfour",
    "name": "Twenty Twenty-Four",
    "old_version": "1.0",
    "new_version": "1.1"
  }
}
```

---

## Features & Capabilities Enabled

### 1. **Real-Time Content Intelligence**

**Capability:** AI always knows about latest content without reindexing

**Use Cases:**
- User creates new blog post → AI can immediately answer "what's my latest post?"
- User updates product description → AI search returns updated content
- User deletes old page → AI stops suggesting that page

**User Experience:**
```
User: Creates post "2026 Product Launch"
AI (5 seconds later): "I see you just published '2026 Product Launch'.
     Would you like me to suggest related posts or create social media copy?"
```

### 2. **Plugin & Theme Tracking**

**Capability:** AI maintains accurate inventory of installed/active plugins

**Use Cases:**
- "What plugins do I have installed?" → Always current
- "Which sites use WooCommerce?" → Fleet-wide plugin tracking
- "Did plugin X get updated?" → Update history tracking

**User Experience:**
```
User: Activates WooCommerce
AI: "I see WooCommerce was just activated. I can now help with:
     - Product management
     - Order processing
     - Analytics queries
     Would you like me to set up your first product?"
```

### 3. **Change Detection & Alerts**

**Capability:** Proactive notifications about site changes

**Use Cases:**
- Plugin deactivated unexpectedly → Alert user
- Theme changed → Update site structure understanding
- Mass content deletion → Flag for review

**User Experience:**
```
AI: "⚠️ Alert: 5 plugins were deactivated in the last hour on mysite.local.
     This is unusual. Should I investigate?"
```

### 4. **Content Versioning & Rollback**

**Capability:** Track content changes over time (event log)

**Use Cases:**
- "What changed in post #42 today?" → Show edit history
- "Restore post to yesterday's version" → Use event log
- "Who edited this page?" → Author tracking

**User Experience:**
```
User: "Show me the version of post #42 from yesterday"
AI: "Yesterday's version (before edits):
     Title: 'Original Title'
     Content: [shows previous content]

     Changes made today:
     - Title changed to 'New Title'
     - Content updated (300 words added)
     - Featured image added"
```

### 5. **Automated Testing & Validation**

**Capability:** Detect potentially breaking changes

**Use Cases:**
- Plugin update → Check if it breaks site
- Theme change → Validate layout didn't break
- Mass content import → Verify data integrity

**User Experience:**
```
AI: "I noticed you just updated WooCommerce from 8.0 to 9.0.
     Running compatibility checks...

     ✅ Cart functionality works
     ✅ Checkout process works
     ⚠️  Payment gateway configuration needs update

     Should I guide you through the payment gateway update?"
```

### 6. **Cross-Site Pattern Recognition**

**Capability:** Learn from changes across all WordPress sites

**Use Cases:**
- "Which plugins cause the most issues after update?" → Pattern detection
- "What content types get the most updates?" → Usage patterns
- "Which themes are most stable?" → Reliability tracking

**User Experience:**
```
User: "Should I update Yoast SEO?"
AI: "Based on your fleet:
     - 5/12 sites already updated (no issues reported)
     - Average update time: 2 minutes
     - Common changes: New meta box UI, permalink structure unchanged

     Safe to update. Want me to do it now?"
```

### 7. **Smart Reindexing**

**Capability:** Only reindex what changed (not full site)

**Use Cases:**
- Post updated → Reindex just that post (fast)
- Plugin activated → Refresh plugin list (lightweight)
- Theme changed → Refresh theme info + structure (moderate)

**Performance:**
- **Before:** Full reindex takes 5-30 seconds
- **After:** Incremental update takes 100-500ms

---

## Implementation Phases

### Phase 1: Core Events (MVP)
**Events:** `post_created`, `post_updated`, `post_deleted`

**Why First:**
- Highest value (content is primary use case)
- Simplest implementation
- Proves architecture works

**Deliverable:** Users can create/edit posts and AI knows immediately

### Phase 2: Plugin/Theme Events
**Events:** `plugin_activated`, `plugin_deactivated`, `theme_changed`

**Why Second:**
- Moderate complexity
- High value for fleet management
- Builds on Phase 1 HTTP infrastructure

**Deliverable:** AI tracks plugin/theme changes across fleet

### Phase 3: Updates & Versioning
**Events:** `plugin_updated`, `theme_updated`, content versioning

**Why Third:**
- More complex (requires diff detection)
- Lower frequency (updates happen less often)
- Nice-to-have vs. must-have

**Deliverable:** Change history and update tracking

### Phase 4: Advanced Features
- Batch event processing
- Event replay (rebuild from history)
- Event filtering (skip draft saves, etc.)
- Performance optimizations

---

## Configuration Design

### Option A: Auto-Injection (Recommended)

**How it works:**
1. Local starts site → injects `NEXUS_AI_WEBHOOK_URL` and `NEXUS_AI_AUTH_TOKEN` into wp-config.php
2. Plugin detects constants → auto-configures
3. Zero user configuration needed

**Pros:**
- ✅ Zero-config for users
- ✅ Always correct endpoint/token
- ✅ Works across site restarts

**Cons:**
- ❌ Requires Local addon to write to wp-config.php
- ❌ Might conflict with version control

### Option B: Database Settings

**How it works:**
1. Plugin adds Settings page
2. User copies webhook URL + token from Local UI
3. Saved in wp_options table

**Pros:**
- ✅ Simple implementation
- ✅ No file system writes
- ✅ User has visibility/control

**Cons:**
- ❌ Requires manual configuration
- ❌ Error-prone (copy/paste mistakes)
- ❌ Must reconfigure on site clone/migration

### Option C: Hybrid (Best of Both)

**How it works:**
1. **Preferred:** Check for constants first (`NEXUS_AI_WEBHOOK_URL`)
2. **Fallback:** Use database settings if constants not found
3. **Discovery:** Plugin pings `http://localhost:10800/health` to detect Local

**Pros:**
- ✅ Auto-config when possible
- ✅ Manual override available
- ✅ Graceful degradation

**Implementation:**
```php
function nexus_ai_get_config() {
    // 1. Check for constants (injected by Local)
    if (defined('NEXUS_AI_WEBHOOK_URL') && defined('NEXUS_AI_AUTH_TOKEN')) {
        return [
            'url' => NEXUS_AI_WEBHOOK_URL,
            'token' => NEXUS_AI_AUTH_TOKEN,
        ];
    }

    // 2. Check database settings
    $settings = get_option('nexus_ai_settings');
    if (!empty($settings['webhook_url']) && !empty($settings['auth_token'])) {
        return $settings;
    }

    // 3. Auto-discover Local
    $response = wp_remote_get('http://localhost:10800/health');
    if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
        // Local is running - show admin notice to configure
        return null;
    }

    return null; // Not configured
}
```

---

## Performance Considerations

### 1. **Non-Blocking Requests**

**Problem:** Sending HTTP requests on every save_post slows down WordPress

**Solution:** Fire-and-forget async requests
```php
wp_remote_post($webhook_url, [
    'timeout' => 1,      // Fail fast
    'blocking' => false, // Don't wait for response
    'body' => json_encode($event),
]);
```

### 2. **Event Batching**

**Problem:** Multiple events in quick succession (bulk edit)

**Solution:** Batch events within 1-second window
```php
// Queue events instead of sending immediately
nexus_ai_queue_event($event);

// Cron job flushes queue every 5 seconds
add_action('nexus_ai_flush_queue', 'nexus_ai_send_queued_events');
```

### 3. **Selective Triggering**

**Problem:** Every autosave triggers post_updated

**Solution:** Ignore low-value events
```php
// Skip autosaves
if (wp_is_post_autosave($post_id)) {
    return;
}

// Skip revisions
if (wp_is_post_revision($post_id)) {
    return;
}

// Only send for published posts
if (get_post_status($post_id) !== 'publish') {
    return;
}
```

### 4. **Error Handling**

**Problem:** Webhook down → WordPress errors out

**Solution:** Fail silently with logging
```php
$response = wp_remote_post($webhook_url, $args);

if (is_wp_error($response)) {
    error_log('[Nexus AI] Event send failed: ' . $response->get_error_message());
    // Don't throw exception - continue WordPress operation
}
```

---

## Security Considerations

### 1. **Authentication**

**Requirement:** Only Local can send events

**Solution:** Bearer token authentication
```php
wp_remote_post($webhook_url, [
    'headers' => [
        'Authorization' => 'Bearer ' . $auth_token,
        'Content-Type' => 'application/json',
    ],
]);
```

### 2. **Data Sanitization**

**Requirement:** Don't send sensitive data

**Blacklist:**
- Password fields
- API keys (meta fields like `_api_key`)
- Credit card data
- Private post types (if defined)

**Implementation:**
```php
function sanitize_post_content($post) {
    $data = [
        'post_id' => $post->ID,
        'title' => $post->post_title,
        'content' => $post->post_content,
        // ... other fields
    ];

    // Remove password-protected content
    if (!empty($post->post_password)) {
        $data['content'] = '[Password Protected]';
    }

    // Filter custom fields
    $meta = get_post_meta($post->ID);
    foreach ($meta as $key => $value) {
        if (strpos($key, 'password') !== false ||
            strpos($key, 'api_key') !== false ||
            strpos($key, '_') === 0) { // Skip private meta
            unset($meta[$key]);
        }
    }
    $data['meta'] = $meta;

    return $data;
}
```

### 3. **Rate Limiting**

**Requirement:** Prevent abuse (malicious plugin triggering 1000s of events)

**Solution:** Max 100 events per minute per site
```php
$recent_events = get_transient('nexus_ai_event_count') ?: 0;
if ($recent_events > 100) {
    error_log('[Nexus AI] Rate limit exceeded');
    return; // Skip event
}
set_transient('nexus_ai_event_count', $recent_events + 1, 60);
```

---

## Testing Strategy

### 1. **Unit Tests**
- Event builder creates valid JSON
- Sanitization removes sensitive fields
- Rate limiting works correctly

### 2. **Integration Tests**
- WordPress → Local event flow
- Event processor handles events
- Graph + embeddings updated correctly

### 3. **E2E Tests**
- Create post in WordPress → AI finds it via search
- Activate plugin → AI lists it
- Update content → AI returns updated version

### 4. **Load Tests**
- 100 posts created rapidly → all indexed
- Bulk plugin activation → all tracked
- Site with 10,000 posts → selective reindexing works

---

## Open Questions

### 1. **Plugin Distribution**

**Options:**
- **A:** Bundle with Local addon (auto-installed on site start)
- **B:** Separate download (user installs manually)
- **C:** WordPress.org plugin repository (public distribution)

**Recommendation:** Option A (auto-install) for best UX

### 2. **Backwards Compatibility**

**Question:** Support WordPress < 7.0?

**Answer:** Yes, graceful degradation:
- WP 7.0+: Full event tracking
- WP 5.0-6.9: Basic events only (no custom abilities)
- WP < 5.0: Plugin inactive (show admin notice)

### 3. **Multisite Support**

**Question:** How to handle WordPress multisite?

**Answer:** Each subsite sends events with network site ID:
```json
{
  "site_id": "abc123",
  "network_site_id": 5,
  "event_type": "post_created",
  ...
}
```

---

## Success Metrics

### Launch Criteria (Phase 1)
- ✅ Create post in WordPress → AI finds it within 5 seconds
- ✅ Update post → AI returns updated content
- ✅ Delete post → AI no longer returns it
- ✅ Zero-config setup (auto-detection works)
- ✅ No performance impact on WordPress (<50ms overhead)

### Long-Term Goals
- 📊 95% of content changes captured
- 📊 <1 second latency (event sent → context updated)
- 📊 <1% event delivery failure rate
- 📊 Zero user-reported configuration issues

---

## Next Steps

1. **Review this design** with stakeholder
2. **Choose configuration approach** (A/B/C)
3. **Implement Phase 1 MVP** (core content events)
4. **Test in Local** with real WordPress site
5. **Iterate based on feedback**
6. **Ship Phase 2** (plugin/theme events)
