---
title: Cursor IDE Integration
description: Complete guide to using Nexus AI with Cursor IDE
keywords: [cursor, ide, mcp, integration, setup, code-editor, ai]
---

# Cursor IDE Integration

Complete guide to integrating Nexus AI with Cursor IDE for AI-powered WordPress development.

## Overview

Cursor is an AI-first code editor built on VS Code. With MCP support, Cursor can:

- ✅ **Access your WordPress fleet** from within the editor
- ✅ **Run WP-CLI commands** while writing code
- ✅ **Search content** across all sites semantically
- ✅ **Manage plugins and themes** without leaving your IDE
- ✅ **Debug WordPress issues** with AI assistance
- ✅ **Generate WordPress code** with context from your sites

**Cursor + Nexus AI = WordPress Development Supercharged**

## Prerequisites

Before you begin:

1. **Cursor IDE installed** ([download](https://cursor.sh))
2. **Nexus AI CLI installed:**
   ```bash
   npm install -g @local-labs-jpollock/local-addon-nexus-ai
   ```
3. **Local with WordPress sites** running
4. **Cursor Pro subscription** (MCP requires paid plan)

!!! info "MCP Availability"
    Model Context Protocol support requires Cursor Pro. Free users cannot use MCP.

## Installation

### Step 1: Open Cursor Settings

1. Open Cursor
2. Press `Cmd/Ctrl + Shift + J` or click the settings gear icon
3. Navigate to **Features → Model Context Protocol**

### Step 2: Configure MCP Server

Add Nexus AI to your MCP configuration:

```json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"]
    }
  }
}
```

**If you already have other MCP servers:**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["/path/to/allowed/directory"]
    },
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"]
    }
  }
}
```

### Step 3: Verify JSON Syntax

Cursor will show a red indicator if JSON is invalid. Common mistakes:

- ❌ Missing comma between servers
- ❌ Trailing comma after last item
- ❌ Single quotes instead of double quotes
- ❌ Unquoted strings

### Step 4: Restart Cursor

**Important:** Restart Cursor completely:

1. `Cmd/Ctrl + Q` to quit
2. Reopen Cursor

### Step 5: Verify Connection

1. Open a chat window (`Cmd/Ctrl + L`)
2. Type `@` to see available context providers
3. You should see **@nexus-ai** in the list
4. Or check the MCP status indicator in the bottom bar

![MCP Status](../assets/cursor-mcp-status.png)

## Using Nexus AI in Cursor

### Chat Integration

Access Nexus AI through Cursor's chat interface:

#### Basic Usage

```
You: @nexus-ai list all my WordPress sites

Cursor: I'll check your WordPress sites...

[Uses nexus_list_sites tool]

You have 3 local sites and 2 WP Engine sites:

Local Sites:
1. mysite (mysite.local) - WordPress 6.4.3, running
2. blog (blog.local) - WordPress 6.4.2, running
3. shop (shop.local) - WordPress 6.3.1, halted

WP Engine Sites:
1. mysite-production (mysite.wpengine.com) - active
2. mysite-staging (mysite.wpenginepowered.com) - active
```

#### Inline Questions

Ask questions while coding:

```
You: @nexus-ai What plugins are installed on mysite?

Cursor: Checking plugins on mysite...

[Uses wp_plugin_list tool]

Active Plugins (12):
✓ Akismet Anti-Spam 5.3 (update to 5.3.1 available)
✓ Yoast SEO 21.9 (latest)
✓ WooCommerce 8.5.2 (latest)
...

Would you like me to update Akismet?
```

### Code Generation with Context

Generate WordPress code with real data from your sites:

#### Example 1: Custom Query

```
You: @nexus-ai Write a function to get all WooCommerce products from mysite

Cursor: Let me check what products you have first...

[Uses search_site_content with type=product]

You have 234 products. Here's a function to query them:

```php
function get_all_products() {
    $args = array(
        'post_type' => 'product',
        'posts_per_page' => -1,
        'post_status' => 'publish',
        'meta_query' => array(
            array(
                'key' => '_stock_status',
                'value' => 'instock',
            ),
        ),
    );

    $products = new WP_Query( $args );
    return $products->posts;
}
```

This function will return all 234 in-stock products from your site.
```

#### Example 2: Theme Development

```
You: @nexus-ai I'm building a custom theme. Show me what themes are currently on mysite

Cursor: [Uses wp_theme_list]

Current themes on mysite:
- twentytwentyfour (active)
- twentytwentythree (inactive)
- storefront (inactive)

Here's a starter template.php for your custom theme:

```php
<?php
/**
 * Template Name: Custom Page Template
 */

get_header();

// Your custom code here
while ( have_posts() ) : the_post();
    the_content();
endwhile;

get_footer();
```
```

#### Example 3: Plugin Development

```
You: @nexus-ai Create a custom plugin that adds a meta box to posts

Cursor: I'll create a plugin structure for you:

```php
<?php
/**
 * Plugin Name: Custom Meta Box
 * Description: Adds a custom meta box to posts
 * Version: 1.0.0
 */

add_action('add_meta_boxes', 'custom_add_meta_box');

function custom_add_meta_box() {
    add_meta_box(
        'custom_meta_box',
        'Custom Settings',
        'custom_meta_box_callback',
        'post',
        'normal',
        'high'
    );
}

function custom_meta_box_callback($post) {
    wp_nonce_field('custom_meta_box_nonce', 'custom_meta_box_nonce');
    $value = get_post_meta($post->ID, '_custom_field', true);
    ?>
    <label for="custom_field">Custom Field:</label>
    <input type="text" id="custom_field" name="custom_field" value="<?php echo esc_attr($value); ?>" />
    <?php
}

add_action('save_post', 'custom_save_meta_box');

function custom_save_meta_box($post_id) {
    if (!isset($_POST['custom_meta_box_nonce'])) return;
    if (!wp_verify_nonce($_POST['custom_meta_box_nonce'], 'custom_meta_box_nonce')) return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (!current_user_can('edit_post', $post_id)) return;

    if (isset($_POST['custom_field'])) {
        update_post_meta($post_id, '_custom_field', sanitize_text_field($_POST['custom_field']));
    }
}
```

Would you like me to test this on mysite?
```

### Development Workflows

#### Workflow 1: Debug Production Issue

```
You: @nexus-ai The homepage on mysite-production is showing a white screen

Cursor: Let me check the site health...

[Uses wpe_diagnose_site]

Site Health Report for mysite-production:
✓ SSL Certificate valid
✓ Backups current
✓ Cache functioning
❌ PHP Errors detected:
   - Fatal error in /wp-content/themes/custom/header.php line 42
   - "Call to undefined function get_custom_header()"

⚠️ WordPress 6.4.2 (6.4.3 available)

Issue found: Missing function in theme. Here's the fix:

```php
// In header.php, replace:
$header = get_custom_header();

// With:
if (function_exists('get_custom_header')) {
    $header = get_custom_header();
} else {
    $header = get_theme_mod('header_image');
}
```

Would you like me to check if this function exists in your local copy?
```

#### Workflow 2: Content Migration

```
You: @nexus-ai I need to migrate all posts tagged "featured" from blog to mysite

Cursor: I'll help you migrate those posts. Let me check what we're working with...

[Uses search_site_content on blog]

Found 23 posts tagged "featured" on blog.

Here's a WP-CLI command to export them:

```bash
nexus wp blog export --dir=/tmp/export --post_type=post --term=featured

nexus wp mysite import /tmp/export/*.xml --authors=create
```

Or I can generate a PHP script to do this programmatically. Which would you prefer?

You: Generate the PHP script

Cursor: Here's a script to migrate the posts:

```php
<?php
// migration-script.php

// Connect to both databases
$source_db = new mysqli('localhost', 'user', 'pass', 'blog_db');
$target_db = new mysqli('localhost', 'user', 'pass', 'mysite_db');

// Get featured posts from source
$posts = $source_db->query("
    SELECT p.* FROM wp_posts p
    JOIN wp_term_relationships tr ON p.ID = tr.object_id
    JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
    JOIN wp_terms t ON tt.term_id = t.term_id
    WHERE t.slug = 'featured'
    AND p.post_status = 'publish'
");

// Insert into target
while ($post = $posts->fetch_assoc()) {
    $stmt = $target_db->prepare("
        INSERT INTO wp_posts
        (post_title, post_content, post_excerpt, post_status, post_type, post_date)
        VALUES (?, ?, ?, 'publish', 'post', NOW())
    ");
    $stmt->bind_param('sss',
        $post['post_title'],
        $post['post_content'],
        $post['post_excerpt']
    );
    $stmt->execute();
    echo "Migrated: {$post['post_title']}\n";
}

echo "Migration complete!\n";
```

Run with: `php migration-script.php`
```

#### Workflow 3: Plugin Development Iteration

```
You: @nexus-ai I'm developing a custom plugin. Can you activate it on my staging site for testing?

Cursor: Sure! What's the plugin slug?

You: wp-custom-analytics

Cursor: [Uses wp_plugin_activate]

✓ Activated wp-custom-analytics on mysite-staging

The plugin is now active. Let me check if there are any errors...

[Uses wp_site_health]

✓ No PHP errors detected
✓ Plugin loaded successfully

You can now test it at: https://mysite.wpenginepowered.com

Would you like me to monitor the error log?

You: Yes, check for errors

Cursor: I'll check the PHP error log...

[Uses wp_cli with custom command]

No errors in the last 100 log entries. The plugin appears to be running cleanly.

Want me to check specific functionality?
```

## Real-World Use Cases

### Use Case 1: Multi-Site Development

**Scenario:** Managing a WordPress multisite network

```
You: @nexus-ai List all sites in my network and their primary domains

Cursor: Checking your multisite setup...

[Uses wp_site_list for multisite]

Network Sites (5):
1. Main Site (example.com) - WordPress 6.4.3
2. Blog (blog.example.com) - WordPress 6.4.3
3. Shop (shop.example.com) - WordPress 6.4.3
4. Support (support.example.com) - WordPress 6.4.3
5. Docs (docs.example.com) - WordPress 6.4.3

All sites are running the same WordPress version. Would you like me to check plugin status across all sites?
```

### Use Case 2: Theme Customization

**Scenario:** Customizing a theme for a client

```
You: @nexus-ai Generate a custom CSS file to change the header color on mysite

Cursor: Let me check the current theme first...

[Uses wp_theme_list]

Active theme: Twenty Twenty-Four

Here's custom CSS for the header:

```css
/* custom-header.css */
.wp-block-template-part.site-header {
    background-color: #2c3e50;
    color: #ffffff;
}

.site-header .wp-block-navigation a {
    color: #ecf0f1;
}

.site-header .wp-block-navigation a:hover {
    color: #3498db;
}

/* Mobile responsive */
@media (max-width: 768px) {
    .site-header {
        padding: 1rem;
    }
}
```

Add this to your theme's style.css or enqueue as a separate file.

Would you like me to show you how to enqueue this properly?
```

### Use Case 3: Performance Optimization

**Scenario:** Optimizing a slow WordPress site

```
You: @nexus-ai Mysite is loading slowly. Help me diagnose the issue.

Cursor: Let me run a performance check...

[Uses multiple tools: wp_plugin_list, wp_theme_list, wp_site_health, wpe_diagnose_site]

Performance Analysis for mysite:

Issues Found:
⚠️ 47 active plugins (recommended: < 20)
⚠️ Theme not optimized for performance
⚠️ No caching plugin detected
✓ Database optimized
✓ Images properly compressed

Recommendations:
1. Deactivate unused plugins:
   - Classic Editor (conflicts with Gutenberg)
   - Jetpack modules you're not using
   - Hello Dolly (demo plugin)

2. Install caching:
   nexus wp mysite plugin install wp-super-cache --activate

3. Enable lazy loading for images:
   Images are using native lazy loading ✓

Would you like me to deactivate the unused plugins?
```

## Advanced Configuration

### Custom Database Path

```json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"],
      "env": {
        "NEXUS_DB_PATH": "/custom/path/nexus.db"
      }
    }
  }
}
```

### Debug Mode

```json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"],
      "env": {
        "NEXUS_DEBUG": "true"
      }
    }
  }
}
```

### Multiple Profiles

Run separate Nexus instances for work and personal:

```json
{
  "mcpServers": {
    "nexus-work": {
      "command": "nexus",
      "args": ["mcp"],
      "env": {
        "NEXUS_DB_PATH": "~/.nexus/work.db"
      }
    },
    "nexus-personal": {
      "command": "nexus",
      "args": ["mcp"],
      "env": {
        "NEXUS_DB_PATH": "~/.nexus/personal.db"
      }
    }
  }
}
```

## Keyboard Shortcuts

Speed up your workflow with Cursor shortcuts:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + L` | Open chat |
| `Cmd/Ctrl + K` | Quick command |
| `Cmd/Ctrl + I` | Inline edit |
| `@nexus-ai` | Mention Nexus in chat |
| `Cmd/Ctrl + Shift + L` | Clear chat history |

## Troubleshooting

### Connection Issues

**Problem:** Nexus AI doesn't appear in Cursor

**Solutions:**

1. **Verify Nexus is installed:**
   ```bash
   nexus --version
   ```

2. **Check MCP configuration:**
   - Open Cursor Settings → Features → Model Context Protocol
   - Verify JSON syntax is valid
   - Check for error indicators

3. **Restart Cursor completely:**
   - Quit Cursor (`Cmd/Ctrl + Q`)
   - Wait 5 seconds
   - Reopen

4. **Check Cursor logs:**
   - Help → Show Logs
   - Look for MCP connection errors

### Tool Execution Fails

**Problem:** Tools appear but fail when used

**Solutions:**

1. **Test CLI directly:**
   ```bash
   nexus list
   nexus search "test"
   ```

2. **Check Local is running:**
   - Open Local app
   - Verify sites are visible

3. **Enable debug mode:**
   ```json
   {
     "mcpServers": {
       "nexus-ai": {
         "command": "nexus",
         "args": ["mcp"],
         "env": {
           "NEXUS_DEBUG": "true"
         }
       }
     }
   }
   ```

4. **Check debug logs:**
   ```bash
   tail -f ~/.nexus/logs/mcp.log
   ```

### Slow Performance

**Problem:** Tool calls take too long

**Solutions:**

1. **Optimize database:**
   ```bash
   nexus db optimize
   ```

2. **Reduce scan frequency:**
   - Only scan when content changes
   - Use `--site` for specific sites

3. **Check SSH ControlMaster (WPE):**
   ```bash
   # List active connections
   ls -la ~/.ssh/wpe-*

   # Should see socket files
   ```

## Best Practices

### 1. Use Context Effectively

```
# ❌ Vague
You: Update plugins

# ✅ Specific with context
You: @nexus-ai Check which plugins on mysite-staging need updates, then update them if safe
```

### 2. Verify Before Modifying

```
You: @nexus-ai Before updating WordPress on production, show me:
1. Current version
2. Available updates
3. Recent backup status
4. Plugin compatibility

Then if everything looks good, proceed with the update.
```

### 3. Document Your Workflow

```
You: @nexus-ai Create a checklist for deploying updates to production

Cursor: Here's a deployment checklist:

- [ ] Check staging environment health
- [ ] Verify recent production backup
- [ ] Compare staging vs production
- [ ] Update plugins on staging first
- [ ] Test staging site
- [ ] Update production
- [ ] Verify production health
- [ ] Monitor error logs for 10 minutes

Would you like me to execute this workflow?
```

### 4. Leverage Code Generation

```
You: @nexus-ai Generate a WordPress plugin that adds custom post types for "Events"

Include:
- Custom post type registration
- Custom fields (date, location, ticket_url)
- Admin columns
- Public query vars
```

## Privacy and Security

### What Data is Shared

When using Nexus AI with Cursor:

**Sent to Cursor/Anthropic:**
- Tool names and parameters
- Tool results (plugin lists, search results)
- Your prompts and questions

**NOT sent:**
- WordPress passwords
- Database credentials
- WP Engine API keys (stored locally)
- Full site content (unless explicitly searched)

### Security Best Practices

1. **Don't share credentials in chat:**
   ```
   # ❌ Never do this
   You: Update the API key to sk_live_abc123...

   # ✅ Instead
   You: How do I update the API key?
   Cursor: Use wp option update [key] [value]
   ```

2. **Test on staging first:**
   - Develop and test on local/staging
   - Only deploy to production after verification

3. **Review AI suggestions:**
   - Always review generated code
   - Test before deploying
   - Understand what the code does

## Cursor vs Claude Desktop

| Feature | Cursor | Claude Desktop |
|---------|--------|----------------|
| **Context** | Code-aware, file context | General purpose |
| **Interface** | Integrated in editor | Standalone app |
| **Workflow** | Code while chatting | Chat-focused |
| **Best For** | Active development | Site management |
| **Code Generation** | Excellent (sees your code) | Good |
| **Site Management** | Good | Excellent |

**Recommendation:** Use both!

- **Cursor** for development and coding
- **Claude Desktop** for site management and operations

## Next Steps

- **[Claude Desktop Integration](claude-desktop.md)** - General site management
- **[MCP Setup](../cli/mcp-setup.md)** - Other MCP clients
- **[CLI Examples](../cli/examples.md)** - More usage patterns
- **[Tool Reference](../mcp-tools/index.md)** - All 160+ tools

---

**Ready to code?** Ask Cursor:

> "@nexus-ai List all my WordPress sites and help me set up a development environment"
