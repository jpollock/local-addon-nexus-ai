---
title: Smart Search — Getting Started
description: Set up WP Engine Smart Search locally with Nexus AI
keywords: [smart-search, setup, atlas-search, local-development]
---

# Smart Search — Getting Started

## Prerequisites

- Nexus AI addon active in Local
- A local WordPress site

That's it. If you've run `nexus ai setup` on the site, Nexus handles the rest automatically.

## Step 1: Get the Plugin

**If your site already has AI configured**, Nexus auto-installs the WP Engine AI Toolkit plugin the next time the site starts. Nothing to do.

**Manual install** (if needed):

=== "WP Admin"
    Plugins → Add New → search **"WP Engine AI Toolkit"** → Install Now → Activate

=== "WP-CLI via Nexus"
    ```bash
    nexus wp "plugin install atlas-search --activate" yoursite@local
    ```

=== "Direct"
    Download from [wordpress.org/plugins/atlas-search](https://wordpress.org/plugins/atlas-search/)

!!! note
    On production WPE, the plugin requires a Smart Search subscription. **Locally with Nexus, no WPE subscription is needed.**

## Step 2: Start the Site

Start (or restart) your site in Local. Nexus will:

1. Detect the atlas-search plugin files
2. Auto-generate a MU plugin that redirects the plugin's backend to `http://127.0.0.1:13000/smart-search/graphql`

**Verify it's working:** Go to **WP Admin → WP Engine AI Toolkit → Settings**. The URL field should show `http://127.0.0.1:13000/smart-search/graphql`.

## Step 3: Sync Content

The index starts empty. Populate it from the WordPress admin:

**WP Admin → WP Engine AI Toolkit → Smart Search → click Sync**

This sends all posts and pages to Nexus's local vector index. After syncing, WordPress search uses the semantic index.

## Step 4: Test It

Search for something on the front end of your site, or use the WordPress admin search. Results should come from Nexus's local index.

Try a typo — "typo tolerance" means slight misspellings still return the right content.

## Pushing to WPE

Before pushing your site to WP Engine:

**Exclude the MU plugin from file push.** Add to `.wpe-push-ignore` at your site root:

```
wp-content/mu-plugins/nexus-ai-connector-config.php
```

This file contains localhost URLs. On WPE, the plugin will use WPE's own provisioned credentials instead.

The database is safe to push — Nexus uses a WordPress filter to override the option on-the-fly, so nothing is written to the database.

## Troubleshooting

**URL field is empty / "Missing URL" warning in plugin settings**
:   The site started before atlas-search was activated. Activate the plugin from WP Admin → Plugins, then restart the site in Local.

**"Failed to query capabilities: Unknown operation"**
:   Local is running an old compiled version of the Nexus addon. Restart Local completely.

**Search returns no results**
:   The index is empty. Run a sync from the Smart Search admin page.

**Typo queries return nothing**
:   The ONNX embedding model may be missing. Check that `models/all-MiniLM-L6-v2-quantized/model.onnx` exists in the Nexus addon directory. Without it, only exact text matches are returned.
