=== Nexus AI Connector ===
Contributors: wpengine
Tags: ai, local, development, automation
Requires at least: 5.0
Tested up to: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT

Connects WordPress to Local's Nexus AI addon for intelligent site management.

== Description ==

Nexus AI Connector sends real-time events from your WordPress site to Local's Nexus AI addon, enabling:

* **Real-time content intelligence** - AI knows about new posts immediately
* **Automatic context updates** - No manual reindexing needed
* **Smart site management** - Ask questions and get up-to-date answers

== Supported Events ==

* Post created
* Post updated
* Post deleted

Coming soon:
* Plugin activated/deactivated
* Theme changed
* Plugin/theme updates

== Installation ==

1. Upload the plugin to `/wp-content/plugins/nexus-ai-connector/`
2. Activate the plugin through the 'Plugins' menu
3. Go to Settings → Nexus AI to configure (or let it auto-configure)

== Configuration ==

**Auto-configuration (recommended):**
If running in Local, the plugin will automatically detect and connect.

**Manual configuration:**
1. Go to Settings → Nexus AI
2. Enter Webhook URL: `http://localhost:10800`
3. Enter Auth Token from Local's MCP connection info
4. Click "Test Connection"
5. Save Settings

== Frequently Asked Questions ==

= Does this work outside of Local? =

No, this plugin is designed to work with Local by Flywheel.

= Does it slow down WordPress? =

No. Events are sent asynchronously (fire-and-forget) with minimal overhead (<10ms).

= What data is sent? =

Post content, metadata, categories, and tags. Sensitive data (passwords, API keys) is filtered out.

== Changelog ==

= 1.0.0 =
* Initial release
* Support for post created/updated/deleted events
* Auto-configuration for Local
* Manual configuration fallback
* Connection testing
