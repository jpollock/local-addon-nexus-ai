# Quick Test Guide - WordPress Events

**Issue Found:** The site "nexus-e2e-test" was not running when you tried to create a post.

## Prerequisites

1. **Start the site in Local app**
   - Open Local by Flywheel
   - Find "nexus-e2e-test" in the site list
   - Click "Start Site"
   - Wait for the green "Running" indicator

2. **Verify HTTP server is running**
   ```bash
   curl -v http://127.0.0.1:13000/health
   # Should return: 200 OK
   ```

## Test Steps

### 1. Verify Site is Running

```bash
./check-and-start-site.sh
```

You should see "nexus-e2e-test" under **RUNNING** sites, not HALTED.

### 2. Open WordPress Admin

```
http://nexus-e2e-test.local/wp-admin
```

Login: `admin` / `admin`

### 3. Create a Test Post

1. Click **Posts → Add New**
2. Title: `Event Test - [current time]`
3. Content: `This is a test post to verify WordPress events are working`
4. Click **Publish** (top right)
5. **Wait 3-5 seconds** for event processing

### 4. Check Event Stats

```bash
node manual-test-check-stats.js
```

**Expected output:**
```
=== Event Processor Stats ===
Total events: [number increased]
Pending: 0
Failed: 0
Processed today: [number increased]
```

### 5. Search for Your Post

```bash
node manual-test-search.js "nexus-e2e-test" "Event Test"
```

**Expected output:**
```
Found 1 results in "nexus-e2e-test":
1. **Event Test - ...** (post, Uncategorized, score: 0.9xx)
   This is a test post to verify WordPress events are working
   Post ID: X
```

## Success Criteria

✅ Event stats `total_events` increased after creating post
✅ Search finds your new post within 5-10 seconds
✅ Post content is searchable

## Troubleshooting

### If site won't start in Local

Check Local app logs and ensure no port conflicts.

### If events don't increment

1. **Check WordPress debug log:**
   ```bash
   tail -20 ~/Local\ Sites/nexus-e2e-test/app/public/wp-content/debug.log | grep "Nexus AI"
   ```

   Should show:
   ```
   [Nexus AI] save_post hook fired for post #X
   [Nexus AI] Sending post_created event
   [Nexus AI] Event sent (non-blocking): post_created - HTTP 200
   ```

2. **Verify plugin is active:**
   ```bash
   cd ~/Local\ Sites/nexus-e2e-test/app/public
   wp plugin list | grep nexus
   ```

   Should show:
   ```
   nexus-ai-connector    active
   ```

   If inactive, activate it:
   ```bash
   wp plugin activate nexus-ai-connector
   ```

3. **Check MU plugin:**
   ```bash
   cat ~/Local\ Sites/nexus-e2e-test/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php
   ```

   Should contain:
   ```php
   define('NEXUS_AI_WEBHOOK_URL', 'http://127.0.0.1:13000');
   define('NEXUS_AI_AUTH_TOKEN', '...');
   ```

### If search doesn't find post

Wait longer - initial indexing can take 5-10 seconds after site starts. Then search again.

## What Each Component Does

- **WordPress Plugin** (`nexus-ai-connector`): Hooks into WordPress save_post/delete_post actions and sends HTTP POST to Local
- **MU Plugin** (`nexus-ai-connector-config.php`): Provides webhook URL and auth token as constants
- **HTTP Event Interface** (Node.js server on port 13000): Receives events from WordPress
- **Event Processor**: Queues and processes events asynchronously
- **Graph Service**: Updates knowledge graph with post relationships
- **Vector Store**: Creates embeddings and enables semantic search
