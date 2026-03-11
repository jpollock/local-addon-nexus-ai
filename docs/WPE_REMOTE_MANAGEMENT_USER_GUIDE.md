# WP Engine Remote Management - User Guide

## Overview

The Nexus AI addon can now sync and manage your **WP Engine sites** alongside your local WordPress sites, giving you a unified view of your entire WordPress fleet.

**Key Features:**
- 🔍 **Search WPE sites** - All synced WPE sites appear in Site Finder and Fleet Overview
- 📊 **View site metadata** - See WordPress version, plugins, users for remote sites
- 🔗 **Link detection** - Automatically shows which WPE sites are already linked to local sites
- ⬇️ **Pull to Local** - One-click creation of local copies for testing/development
- ⚡ **Fast sync** - 251 sites synced in ~25 minutes with full content indexing

## Getting Started

### Prerequisites

1. **WP Engine account** connected to Local
   - Open Local → Connect → WP Engine
   - Authenticate with your WP Engine credentials
2. **SSH key** configured for WP Engine access
   - Local handles this automatically when you connect

### Enabling WPE Sync

1. Open **Nexus AI preferences**:
   - Local → Nexus AI → Preferences
2. Scroll to the **"WP Engine Sites"** section
3. Click **"Sync Now"** button

**What happens during sync:**
- Fetches all WP Engine environments from your account
- Extracts WordPress version via remote WP-CLI
- Pulls plugin and user data
- Indexes content for semantic search (optional - based on addon settings)

**Sync time:**
- ~6 seconds per site on average
- 251 sites = ~25 minutes total
- Progress updates every 2 seconds

**Monitoring sync progress:**
- Live progress shown in Preferences: `Syncing {site}... (N/Total)`
- Also visible in Fleet Overview header (no need to keep Preferences open)

## Using Synced WPE Sites

### Fleet Overview

Navigate to **Nexus AI → Fleet Overview** to see all sites (local + WPE) in one table.

**Source filter:**
- ☑️ **Local Sites** - Show/hide locally running sites
- ☑️ **☁️ WP Engine Sites** - Show/hide synced WPE sites

**WPE Site columns:**
- **Source**: Badge shows `☁️ WPE` (vs `Local`)
- **Actions**: Shows linkage status or "Pull to Local" button
- **Status**: Shows "Remote" (no start/stop controls)
- **Index**: Shows "Via WPE Sync" (indexed during sync)
- **Documents**: Number of posts/pages indexed
- **AI Setup**: Shows "N/A" (AI features only work on running local sites)

### Site Finder

All synced WPE sites are searchable in **Site Finder** alongside local sites:

**Supported filters:**
- ✅ Content search (indexed during sync)
- ✅ Plugin filters (e.g., "sites with Yoast SEO")
- ✅ WordPress version filters
- ❌ Theme filters (requires running site)

**Example queries:**
- "WPE sites with WooCommerce"
- "all sites running WordPress 6.4"
- "sites with 'contact form' in content"

## Pull to Local

Create a local copy of any WPE site for development/testing.

### How to Pull

1. Go to **Fleet Overview**
2. Find the WPE site you want to pull
3. Click **⬇ Pull to Local** button
4. Confirm the operation

**What happens:**
1. Addon creates a new local site with the same name
2. Site is automatically started
3. You receive instructions for next steps

**Next steps (manual):**
1. Find the new site in Local's sidebar
2. Right-click → **Connect to WP Engine**
3. Select the environment (production/staging/development)
4. Click **Pull** to sync database and files

**Why manual linking?**
- Allows you to choose which environment to pull (prod/staging/dev)
- Lets you select what to sync (database, files, or both)
- Respects Local's existing WPE connection workflow

### Linkage Detection

If a WPE site is already linked to a local site, Fleet Overview shows:
- ✓ Linked to `{local-site-name}`

This prevents duplicate pulls and helps you find the local copy quickly.

## Re-Syncing

**When to re-sync:**
- After installing/activating plugins on WPE
- After WordPress version updates
- After publishing new content you want to search
- Periodically (weekly/monthly depending on your workflow)

**How to re-sync:**
- Return to **Nexus AI → Preferences**
- Click **"Sync Now"** again
- All sites will be refreshed (upsert - updates existing, adds new)

**Performance:**
- Re-sync is as fast as initial sync (~25 min for 251 sites)
- No data duplication - existing records are updated

## Troubleshooting

### "CAPI not available" Error

**Cause:** Local is not connected to your WP Engine account

**Fix:**
1. Open Local → Connect → WP Engine
2. Re-authenticate
3. Try sync again

### "SSH key not available" Error

**Cause:** SSH key for WP Engine hasn't been generated

**Fix:**
1. In Local, try connecting to any WPE site manually
2. This triggers SSH key generation
3. Try sync again

### "Sync Failed" Error

Check the error message in Preferences. Common causes:
- Network connectivity issues
- WP Engine API rate limiting (rare - wait 5 min and retry)
- Invalid site credentials

If the error persists, check Local's logs:
- macOS: `~/Library/Logs/local-by-flywheel/main.log`

### Slow Sync Performance

Expected performance:
- ~6 seconds per site (with SSH ControlMaster optimization)
- ~25 minutes for 251 sites

If significantly slower:
- Check network connection (sync requires SSH to WPE)
- Close other VPN/proxy software that might interfere with SSH
- Verify `/tmp/ssh-nexus-*` socket files exist (connection reuse)

## Technical Details

### What Data is Synced?

**Site metadata:**
- Install ID, install name, environment (prod/staging/dev)
- Primary domain
- WordPress version

**Plugins:**
- Plugin slug, name, version
- Active/inactive status
- Author

**Users:**
- Username, email, roles
- (Stored locally for search - not synced back to WPE)

**Content (optional):**
- Posts, pages, custom post types
- Cleaned HTML content (for search)
- Vector embeddings (for semantic search)

**What is NOT synced:**
- Themes (requires running site)
- Database tables
- Uploaded media files
- WordPress options/settings

### Data Storage

- **SQLite database**: `~/Library/Application Support/Local/nexus-ai-data/graph.db`
- **Vector store**: `~/Library/Application Support/Local/nexus-ai/vectors/`

**Schema:**
- `sites` table with `source` column ('local' | 'wpe')
- `plugins`, `users`, `content` tables linked by `site_id`

### Performance Optimizations

**SSH ControlMaster:**
- Reuses SSH connections to WP Engine for 10 minutes
- Eliminates redundant authentication handshakes
- Reduces per-site sync time by ~85%

**Concurrency:**
- 10 sites synced in parallel (using `p-limit`)
- Provides 10x throughput without overwhelming infrastructure

**Content Indexing:**
- Limited to 100 posts per post type (per site)
- Batched embedding generation (10 docs at a time)
- Async vector store upserts

## FAQ

**Q: Will syncing affect my WPE sites?**
A: No. Sync is read-only. It runs WP-CLI commands like `wp plugin list` and `wp post list` which don't modify data.

**Q: How often should I sync?**
A: Depends on your workflow. Weekly for active sites, monthly for stable sites. Sync after major changes (plugin updates, content publishing).

**Q: Can I sync specific sites instead of all?**
A: Not yet. Current implementation syncs all accessible WPE installs. Selective sync is a future enhancement.

**Q: Does this work with Flywheel sites?**
A: Not currently. This feature is WP Engine-specific (uses WPE CAPI + SSH). Flywheel support may come later.

**Q: Can I disable content indexing?**
A: Yes. Turn off "Auto-index sites" in Nexus AI Preferences. This will skip content extraction during sync (faster, less storage).

**Q: What happens if I delete a local site that's linked to WPE?**
A: The linkage detection will update on next Fleet Overview refresh. The "Pull to Local" button will reappear for that WPE site.

**Q: Can I search across both local and WPE sites simultaneously?**
A: Yes! Site Finder searches all indexed sites (local + WPE) by default. Use filters to narrow down.

## Feedback & Support

Found a bug or have a feature request?
- Report issues at: https://github.com/anthropics/claude-code/issues (or your internal feedback channel)

Need help?
- Check Local's logs (see Troubleshooting section)
- Contact your Local/WPE support team
