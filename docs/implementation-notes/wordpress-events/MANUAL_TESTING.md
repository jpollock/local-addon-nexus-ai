# Manual Testing Guide - WordPress Event Sender Plugin

## Quick Start: See Events in Action 🎯

This guide shows how to manually test the WordPress Event Sender Plugin using the **real production use case** (WordPress Admin UI, not WP-CLI).

---

## Step 1: Pick a Running Site

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
node manual-test-list-sites.js
```

This shows all running sites. Pick one (e.g., "The Curated Shelf" or "nexus-e2e-test").

---

## Step 2: Open WordPress Admin

Open your site's admin panel in a browser:

```
http://the-curated-shelf.local/wp-admin
```

Or for the test site:

```
http://nexus-e2e-test.local/wp-admin
```

Login credentials are usually `admin/admin`.

---

## Step 3: Create a Post 📝

1. Click **Posts → Add New**
2. Enter:
   - **Title:** `Live Event Test - March 5`
   - **Content:** `This post was created via WordPress admin to test the Nexus AI event sender plugin in action.`
3. Click **Publish** (top right corner)
4. Wait 3-5 seconds for event processing

---

## Step 4: Check Event Stats ✅

```bash
node manual-test-check-stats.js
```

**Expected output:**
```
=== Event Processor Stats ===
Total events: 1
Pending: 0
Failed: 0
Processed today: 1
```

If `total_events` increased, **the event was processed!** 🎉

---

## Step 5: Search for Your Post 🔍

```bash
# Using default site name and query
node manual-test-search.js

# Or specify site and query
node manual-test-search.js "the-curated-shelf" "Live Event Test"
```

**Expected output:**
```
=== Search Results for "Live Event Test" in "the-curated-shelf" ===
Found 1 results in "the-curated-shelf":
1. **Live Event Test - March 5** (post, Uncategorized, score: 0.892)
   This post was created via WordPress admin to test the Nexus AI event sender plugin in action.
   Post ID: 2
```

If you see your post, **the full event flow works!** ✅

---

## Test Update Events

1. Go back to WordPress admin
2. Click **Posts → All Posts**
3. Click **Edit** on your "Live Event Test" post
4. Change title to: `Live Event Test - UPDATED`
5. Click **Update**
6. Wait 3 seconds
7. Run search again:

```bash
node manual-test-search.js "the-curated-shelf" "UPDATED"
```

You should see the updated title in search results.

---

## Test Delete Events

1. Go to **Posts → All Posts**
2. **Trash** your test post
3. Wait 3 seconds
4. Run search again:

```bash
node manual-test-search.js "the-curated-shelf" "Live Event Test"
```

Should show "No results found" (post was removed from index).

---

## Troubleshooting

### If event stats don't increment:

**Check if HTTP server is running:**
```bash
curl -v http://127.0.0.1:13000/health
# Should return: 200 OK
```

**Check if plugin is configured:**
```bash
cat ~/Local\ Sites/the-curated-shelf/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php
```

Should show:
```php
define('NEXUS_AI_WEBHOOK_URL', 'http://127.0.0.1:13000');
define('NEXUS_AI_AUTH_TOKEN', '...');
```

### If search doesn't find post:

**Wait longer** - Initial indexing takes 5-10 seconds after site starts.

**Check WordPress debug log:**
```bash
tail -20 ~/Local\ Sites/the-curated-shelf/app/public/wp-content/debug.log | grep "Nexus AI"
```

Should show:
```
[Nexus AI] save_post hook fired for post #2 (status: publish, update: no)
[Nexus AI] Sending post_created event for post #2
[Nexus AI] Event sent (non-blocking): post_created - HTTP 200
```

### If plugin isn't installed:

Restart the site (plugin auto-installs on site start):

```bash
# Stop site via Local UI, then start it again
# Or via CLI:
# local-cli stop the-curated-shelf
# local-cli start the-curated-shelf
```

---

## What Success Looks Like

When everything works:

✅ **Create post in WordPress admin** → Event sent within 1 second
✅ **Event processor stats increment** → Event received and queued
✅ **Search finds post within 5 seconds** → Event processed and indexed
✅ **Update post** → Search shows updated content
✅ **Delete post** → Search no longer finds it

**This proves the full production workflow works end-to-end!** 🎉

---

## Alternative: Test via MCP Client

If you have Claude Desktop or another MCP client, you can test via chat:

```
User: Get event processor stats
Claude: [calls get_event_processor_stats]

User: Search for "Live Event Test" in the-curated-shelf
Claude: [calls search_site_content]
```

---

## Notes

- **Events from WordPress Admin UI work perfectly** (this is the real use case)
- **Events from WP-CLI** don't fire hooks by default (WordPress design)
- **Background indexing** takes 5-10 seconds after site starts
- **Event processing** is async (3-5 seconds typical)
- **All events are logged** to WordPress debug.log if WP_DEBUG is enabled
