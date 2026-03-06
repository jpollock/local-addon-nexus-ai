# WordPress Event Sender Plugin - Implementation Plan

## Approved Design

✅ **Capabilities:** 6 core capabilities (real-time intelligence, tracking, alerts, versioning, testing, smart reindexing)
✅ **Configuration:** Hybrid approach (auto-detect + manual fallback)
✅ **Phase 1 Scope:** Content events only (`post_created`, `post_updated`, `post_deleted`)
✅ **Security:** Sanitization approach approved
✅ **Performance:** Non-blocking + batching approved

---

## Phase 1 Implementation Tasks

### 1. Plugin Structure

```
wp-plugins/nexus-ai-connector/
├── nexus-ai-connector.php          # Main plugin file
├── includes/
│   ├── class-event-builder.php     # Creates event payloads
│   ├── class-http-client.php       # Sends events to Local
│   ├── class-config.php            # Configuration management
│   └── class-admin-settings.php    # Settings page (manual config)
├── assets/
│   └── admin.css                   # Admin UI styling
└── readme.txt                      # WordPress plugin readme
```

### 2. Core Files

#### `nexus-ai-connector.php` (Main Plugin File)
- Plugin header (name, version, description)
- Register activation/deactivation hooks
- Load includes
- Register WordPress action hooks:
  - `save_post` → trigger post_created/post_updated
  - `delete_post` → trigger post_deleted
- Initialize configuration
- Initialize HTTP client

#### `class-event-builder.php`
- `build_post_created_event($post)` → JSON payload
- `build_post_updated_event($post, $changes)` → JSON payload
- `build_post_deleted_event($post_id)` → JSON payload
- `sanitize_post_data($post)` → Remove sensitive fields
- `detect_changes($old_post, $new_post)` → Diff detection

#### `class-http-client.php`
- `send_event($event)` → POST to webhook
- `get_webhook_url()` → Get endpoint from config
- `get_auth_token()` → Get token from config
- Non-blocking HTTP via `wp_remote_post()`
- Error logging (fail silently)

#### `class-config.php`
- `get_config()` → Returns [url, token] or null
- Priority: Constants > Database > Discovery
- `auto_discover_local()` → Ping localhost:10800
- `is_configured()` → Boolean check

#### `class-admin-settings.php`
- Settings page UI
- Save webhook URL + token to database
- Show connection status (green = connected)
- Test connection button

### 3. Event Hooks Registration

```php
// Main plugin file
add_action('save_post', 'nexus_ai_handle_post_save', 10, 3);
add_action('delete_post', 'nexus_ai_handle_post_delete', 10, 1);
```

### 4. Event Handler Logic

```php
function nexus_ai_handle_post_save($post_id, $post, $update) {
    // Skip autosaves
    if (wp_is_post_autosave($post_id)) return;

    // Skip revisions
    if (wp_is_post_revision($post_id)) return;

    // Only published posts
    if ($post->post_status !== 'publish') return;

    // Build event
    $event_type = $update ? 'post_updated' : 'post_created';
    $event = Nexus_AI_Event_Builder::build_event($event_type, $post);

    // Send to Local
    Nexus_AI_HTTP_Client::send_event($event);
}
```

### 5. Configuration Implementation

```php
class Nexus_AI_Config {
    public static function get_config() {
        // 1. Check constants (injected by Local)
        if (defined('NEXUS_AI_WEBHOOK_URL') && defined('NEXUS_AI_AUTH_TOKEN')) {
            return [
                'url' => NEXUS_AI_WEBHOOK_URL,
                'token' => NEXUS_AI_AUTH_TOKEN,
                'source' => 'constants',
            ];
        }

        // 2. Check database
        $settings = get_option('nexus_ai_settings');
        if (!empty($settings['webhook_url']) && !empty($settings['auth_token'])) {
            return [
                'url' => $settings['webhook_url'],
                'token' => $settings['auth_token'],
                'source' => 'database',
            ];
        }

        // 3. Auto-discover (optional)
        if (self::auto_discover_local()) {
            // Show admin notice to configure
        }

        return null;
    }

    private static function auto_discover_local() {
        $response = wp_remote_get('http://localhost:10800/health', [
            'timeout' => 1,
        ]);

        if (is_wp_error($response)) {
            return false;
        }

        return wp_remote_retrieve_response_code($response) === 200;
    }
}
```

### 6. HTTP Client Implementation

```php
class Nexus_AI_HTTP_Client {
    public static function send_event($event) {
        $config = Nexus_AI_Config::get_config();

        if (!$config) {
            error_log('[Nexus AI] Not configured, skipping event');
            return;
        }

        $response = wp_remote_post($config['url'] . '/wp-events', [
            'timeout' => 1,
            'blocking' => false,  // Fire-and-forget
            'headers' => [
                'Authorization' => 'Bearer ' . $config['token'],
                'Content-Type' => 'application/json',
            ],
            'body' => json_encode($event),
        ]);

        if (is_wp_error($response)) {
            error_log('[Nexus AI] Event send failed: ' . $response->get_error_message());
        }
    }
}
```

### 7. Admin Settings Page

```php
class Nexus_AI_Admin_Settings {
    public static function register_menu() {
        add_options_page(
            'Nexus AI Connector',
            'Nexus AI',
            'manage_options',
            'nexus-ai-settings',
            [__CLASS__, 'render_settings_page']
        );
    }

    public static function render_settings_page() {
        // Show connection status
        $config = Nexus_AI_Config::get_config();

        if ($config) {
            echo '<div class="notice notice-success">';
            echo '<p>✅ Connected to Local (source: ' . $config['source'] . ')</p>';
            echo '</div>';
        } else {
            echo '<div class="notice notice-warning">';
            echo '<p>⚠️ Not configured. Enter webhook URL and token below.</p>';
            echo '</div>';
        }

        // Settings form
        ?>
        <form method="post" action="options.php">
            <?php settings_fields('nexus_ai_settings'); ?>
            <table class="form-table">
                <tr>
                    <th>Webhook URL</th>
                    <td>
                        <input type="url" name="nexus_ai_settings[webhook_url]"
                               value="<?php echo esc_attr($config['url'] ?? ''); ?>"
                               class="regular-text" />
                        <p class="description">Example: http://localhost:10800</p>
                    </td>
                </tr>
                <tr>
                    <th>Auth Token</th>
                    <td>
                        <input type="password" name="nexus_ai_settings[auth_token]"
                               value="<?php echo esc_attr($config['token'] ?? ''); ?>"
                               class="regular-text" />
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <?php
    }
}
```

---

## Local Addon Integration

### 1. Auto-Inject Constants (Optional Enhancement)

When Local starts a site, inject webhook config into wp-config.php:

```php
// In Local addon (src/main/content/lifecycle-hooks.ts)

async function injectNexusAiConfig(site: LocalSiteRef) {
    const wpConfigPath = path.join(site.path, 'app', 'public', 'wp-config.php');
    const config = `
define('NEXUS_AI_WEBHOOK_URL', 'http://localhost:10800');
define('NEXUS_AI_AUTH_TOKEN', '${connectionInfo.authToken}');
`;

    // Append to wp-config.php (before "That's all, stop editing!")
    await appendToWpConfig(wpConfigPath, config);
}
```

### 2. Auto-Install Plugin (Recommended)

Copy plugin to site's `wp-content/plugins/` during site start:

```typescript
// In lifecycle-hooks.ts
async function installNexusAiPlugin(site: LocalSiteRef) {
    const pluginSource = path.join(__dirname, '..', '..', 'wp-plugins', 'nexus-ai-connector');
    const pluginDest = path.join(site.path, 'app', 'public', 'wp-content', 'plugins', 'nexus-ai-connector');

    // Copy plugin
    await fs.copy(pluginSource, pluginDest);

    // Activate via WP-CLI
    await wpCli(site, ['plugin', 'activate', 'nexus-ai-connector']);
}
```

---

## Testing Plan

### Unit Tests (WordPress Plugin)

```php
// tests/test-event-builder.php
class Test_Event_Builder extends WP_UnitTestCase {
    public function test_build_post_created_event() {
        $post = $this->factory->post->create_and_get();
        $event = Nexus_AI_Event_Builder::build_post_created_event($post);

        $this->assertEquals('post_created', $event['event_type']);
        $this->assertEquals($post->ID, $event['payload']['post_id']);
        $this->assertEquals($post->post_title, $event['payload']['title']);
    }

    public function test_sanitize_removes_password() {
        $post = $this->factory->post->create_and_get([
            'post_password' => 'secret123',
        ]);

        $data = Nexus_AI_Event_Builder::sanitize_post_data($post);

        $this->assertEquals('[Password Protected]', $data['content']);
    }
}
```

### Integration Tests (Local Addon)

```typescript
// tests/e2e/18-wordpress-events.e2e.test.ts
describe('WordPress Event Integration', () => {
    it('should receive post_created event when post is created', async () => {
        const siteName = 'nexus-test-site';

        // Create post via WP-CLI
        await client.callTool('wp_post_create', {
            site: siteName,
            title: 'Test Post from E2E',
            content: 'This is a test post',
            status: 'publish',
        });

        // Wait for event processing
        await waitFor(async () => {
            const stats = await client.callTool('get_event_processor_stats', {});
            return stats.pending_events === 0;
        }, 5000);

        // Verify post is in graph
        const searchResult = await client.callTool('search_site_content', {
            site: siteName,
            query: 'Test Post from E2E',
        });

        expect(searchResult.content[0].text).toContain('Test Post from E2E');
    });
});
```

### Manual Testing

1. **Install Plugin:**
   - Copy plugin to site
   - Activate via WP Admin

2. **Verify Configuration:**
   - Check Settings → Nexus AI
   - Should show "✅ Connected to Local"

3. **Test Events:**
   - Create new post → Check Local logs for event
   - Update post → Check Local logs
   - Delete post → Check Local logs

4. **Test Search:**
   - Create post "Nexus Test 123"
   - Run `search_site_content` for "Nexus Test"
   - Should return the post

---

## File Locations

### WordPress Plugin
```
/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/wp-plugins/nexus-ai-connector/
```

### Local Addon Integration
```
/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/src/main/content/lifecycle-hooks.ts
```

### Tests
```
/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/tests/e2e/18-wordpress-events.e2e.test.ts
```

---

## Implementation Checklist

### WordPress Plugin (Core)
- [ ] Create plugin directory structure
- [ ] Implement `class-event-builder.php`
- [ ] Implement `class-http-client.php`
- [ ] Implement `class-config.php`
- [ ] Implement `class-admin-settings.php`
- [ ] Write main plugin file with hooks
- [ ] Test event payload format
- [ ] Test non-blocking HTTP

### WordPress Plugin (Admin)
- [ ] Create settings page UI
- [ ] Add connection status indicator
- [ ] Add test connection button
- [ ] Style admin page

### Local Addon Integration
- [ ] Add auto-install logic to lifecycle hooks
- [ ] (Optional) Add wp-config.php injection
- [ ] Update build script to copy plugin

### Testing
- [ ] Write unit tests for event builder
- [ ] Write integration test for event flow
- [ ] Manual test: create/update/delete posts
- [ ] Manual test: verify search results

### Documentation
- [ ] Update README with plugin info
- [ ] Document configuration options
- [ ] Add troubleshooting guide

---

## Estimated Timeline

- **Plugin Core:** 4-6 hours
- **Admin UI:** 2-3 hours
- **Local Integration:** 2-3 hours
- **Testing:** 2-4 hours
- **Total:** 10-16 hours

---

## Success Criteria

✅ Plugin activates without errors
✅ Events sent to Local on post create/update/delete
✅ Events appear in Local logs
✅ Event processor updates graph + embeddings
✅ Search returns updated content within 5 seconds
✅ No performance impact on WordPress (<50ms overhead)
✅ Auto-config works (shows "Connected" in admin)
✅ Manual config works (can paste URL/token)

---

## Next Step

Ready to implement? I can start with:

1. **WordPress Plugin Core** (event builder + HTTP client)
2. **Local Integration** (auto-install + activation)
3. **E2E Tests** (verify end-to-end flow)

Which would you like to start with?
