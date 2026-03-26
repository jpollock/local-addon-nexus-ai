---
title: Your First AI Query
description: Search indexed content and interact with AI assistants
keywords: [search, semantic-search, ai-chat, query, embeddings, getting-started]
---

# Your First AI Query

Learn how to search your indexed WordPress content and interact with AI assistants.

## Prerequisites

Before your first AI query, make sure you've:

1. ✅ [Installed Nexus AI](cli-quick-start.md#installation)
2. ✅ [Scanned your sites](first-scan.md)
3. ✅ (Optional) [Connected an AI assistant](../cli/mcp-setup.md)

## Search Methods

Nexus AI provides three ways to query your content:

1. **CLI Search** — Direct command-line semantic search
2. **UI Site Finder** — Visual search interface in Local addon
3. **AI Assistant (MCP)** — Natural language queries via Claude Desktop, Cursor, etc.

Let's try each method.

## Method 1: CLI Search

### Basic Search

Search indexed content from the command line:

```bash
nexus search "how to optimize images"
```

**Output:**

```json
{
  "query": "how to optimize images",
  "results": [
    {
      "site": "blog",
      "type": "post",
      "title": "WordPress Image Optimization Guide",
      "url": "https://blog.local/optimize-images",
      "excerpt": "Learn how to compress and lazy-load images to speed up your WordPress site. We'll cover WebP conversion, CDN usage, and lazy loading techniques.",
      "score": 0.92,
      "post_id": 123,
      "published_at": "2026-03-15"
    },
    {
      "site": "blog",
      "type": "post",
      "title": "WebP Conversion for WordPress",
      "url": "https://blog.local/webp-images",
      "excerpt": "Converting images to WebP format reduces file sizes by 25-35% while maintaining quality. This tutorial shows you how.",
      "score": 0.88,
      "post_id": 456,
      "published_at": "2026-03-10"
    },
    {
      "site": "shop",
      "type": "post",
      "title": "Product Image Best Practices",
      "url": "https://shop.local/product-images",
      "excerpt": "High-quality product images increase conversions. Here's how to optimize them for speed and SEO.",
      "score": 0.85,
      "post_id": 789,
      "published_at": "2026-03-01"
    }
  ],
  "total": 3,
  "time_ms": 42
}
```

**Understanding the results:**

- **score** — Similarity score (0-1, higher = more relevant)
- **excerpt** — The matching chunk of text
- **site** — Which WordPress site contains this content
- **type** — Content type (post, page, product)
- **time_ms** — Search speed in milliseconds

### Filter by Site

Search specific site only:

```bash
nexus search "shipping options" --site shop
```

### Filter by Type

Search products only:

```bash
nexus search "blue widgets" --type product
```

**Supported types:**

- `post` — Blog posts
- `page` — Pages
- `product` — WooCommerce products
- `attachment` — Media files
- `all` — All types (default)

### Adjust Results

Get more or fewer results:

```bash
# Get top 20 results
nexus search "WordPress security" --limit 20

# Lower similarity threshold (more results, less relevant)
nexus search "performance" --threshold 0.6

# Higher threshold (fewer results, more relevant)
nexus search "performance" --threshold 0.9
```

**Threshold guide:**

| Threshold | Results | Use Case |
|-----------|---------|----------|
| 0.5-0.6 | Many, loosely related | Exploratory research |
| 0.7 | Moderate, relevant | Default search |
| 0.8-0.9 | Few, highly relevant | Precise matching |
| 0.95+ | Very few, exact matches | Find duplicates |

### Export Results

Save search results to file:

```bash
# JSON format
nexus search "WooCommerce" --format json > woo-content.json

# Markdown format (human-readable)
nexus search "WooCommerce" --format markdown > woo-content.md
```

## Method 2: UI Site Finder

### Open Site Finder

1. Open **Nexus AI** sidebar (toolbar icon)
2. Click **Site Finder** panel
3. Type your query in the search box

![Site Finder](../assets/site-finder.png)

### Try These Queries

**Content queries:**

- `WooCommerce` — Sites with WooCommerce
- `SEO` — Sites or posts about SEO
- `image optimization` — Posts about images
- `contact form` — Sites with contact forms

**Site queries:**

- `outdated` — Sites running old WordPress
- `needs updates` — Sites with available plugin updates
- `staging` — Staging environments
- `production` — Production sites
- `WP Engine` — Sites linked to WPE

**Plugin queries:**

- `Yoast` — Sites with Yoast SEO
- `Akismet` — Sites with Akismet
- `without Yoast` — Sites missing Yoast SEO

### Understanding Results

Results appear in three sections:

**1. Exact Matches**

Sites that exactly match your query:

```
Exact Matches (3)
✓ woocommerce-shop (WooCommerce 8.5.2 installed)
✓ online-store (WooCommerce 8.4.1 installed)
✓ test-shop (WooCommerce 8.3.0 installed)
```

**2. Content Matches**

Posts/pages that match semantically:

```
Content Matches (15)
📝 "Setting Up WooCommerce" on blog (score: 0.92)
📝 "Payment Gateways Guide" on shop (score: 0.88)
📝 "Shipping Configuration" on store (score: 0.85)
```

**3. Site Matches**

Sites that partially match:

```
Site Matches (2)
🌐 shop (has WooCommerce plugin)
🌐 test (mentions "WooCommerce" in description)
```

## Method 3: AI Assistant (MCP)

### Connect to Claude Desktop

If you haven't already, [set up MCP](../cli/mcp-setup.md#claude-desktop):

1. Edit `~/.config/Claude/claude_desktop_config.json`:

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

2. Restart Claude Desktop

3. Verify connection (look for 🔌 icon with "nexus-ai")

### Ask Natural Language Questions

Now you can ask Claude questions about your WordPress sites:

#### Example 1: List Sites

```
You: List all my WordPress sites

Claude: You have 3 WordPress sites:

Local Sites:
1. mysite (mysite.local) - WordPress 6.4.3, running
2. blog (blog.local) - WordPress 6.4.2, running
3. shop (shop.local) - WordPress 6.3.1, halted

WP Engine Sites:
1. mysite-production (mysite.wpengine.com) - active
2. mysite-staging (mysite.wpenginepowered.com) - active
```

#### Example 2: Find Content

```
You: Find all posts about SEO on my blog

Claude: I found 12 posts about SEO on blog:

1. "Yoast SEO Complete Guide" (2026-03-15)
   → Comprehensive guide to using Yoast SEO plugin
   Score: 0.94

2. "Meta Descriptions Best Practices" (2026-03-10)
   → How to write effective meta descriptions
   Score: 0.91

3. "Schema Markup for WordPress" (2026-03-05)
   → Implementing structured data for better search results
   Score: 0.89

... (9 more results)

Would you like me to show more details for any of these?
```

#### Example 3: Plugin Audit

```
You: Which sites are running old versions of Akismet?

Claude: Checking Akismet versions across all sites...

Sites with outdated Akismet:
1. blog - Akismet 5.3 (latest: 5.3.1)
2. test - Akismet 5.2.1 (latest: 5.3.1)

Sites with current Akismet:
1. mysite - Akismet 5.3.1 ✓

Would you like me to update the outdated versions?
```

#### Example 4: WooCommerce Analysis

```
You: How many products do I have across all WooCommerce sites?

Claude: Let me check all WooCommerce sites...

shop: 8,901 products (5,234 in stock, 3,667 out of stock)
test-shop: 45 products (testing environment)

Total: 8,946 products across 2 sites

Product breakdown by category:
- Widgets: 4,523 products
- Gadgets: 2,187 products
- Accessories: 1,456 products
- Other: 780 products
```

#### Example 5: Bulk Operations

```
You: Update WordPress on all staging sites

Claude: Found 2 staging sites:
1. mysite-staging (WordPress 6.4.2)
2. blog-staging (WordPress 6.4.1)

I'll update both to WordPress 6.4.3. This will:
1. Create automatic backups
2. Update WordPress core
3. Verify checksums
4. Run health checks

Proceed? (yes/no)

You: yes

Claude: Updating sites...

✓ mysite-staging
  - Backup created (backup_abc123)
  - Updated 6.4.2 → 6.4.3
  - Checksums verified
  - Health: Good

✓ blog-staging
  - Backup created (backup_xyz789)
  - Updated 6.4.1 → 6.4.3
  - Checksums verified
  - Health: Good

Both sites successfully updated!
```

### Best Practices for AI Assistants

**Be specific:**

- ❌ "Update plugin"
- ✅ "Update Akismet to latest version on mysite"

**Ask before acting:**

- ✅ "Should I update all plugins on mysite?"
- ✅ "What will happen if I update WordPress on production?"

**Use natural language:**

- ✅ "Find WooCommerce sites"
- ✅ "Which sites need updates?"
- ✅ "How many posts does my blog have?"

**Verify results:**

- ✅ "Show me the current plugin versions before updating"
- ✅ "What's the WordPress version on production?"

!!! note "This is not a UI panel"
    Method 3 uses external AI assistants (Claude Desktop, Cursor) connected via MCP. Nexus AI does not have a built-in chat interface in the Local addon UI.

## Semantic Search vs Keyword Search

### Traditional Keyword Search

```
Query: "optimize images"

Finds posts containing EXACTLY:
- "optimize images"
- "image optimization"

Misses posts about:
- "compress photos"
- "reduce file sizes"
- "lazy loading pictures"
```

### Nexus Semantic Search

```
Query: "optimize images"

Finds posts about:
✓ "optimize images" (exact match)
✓ "compress photos" (synonym)
✓ "reduce file sizes" (related concept)
✓ "lazy loading pictures" (implementation)
✓ "WebP conversion" (technique)
✓ "CDN for media" (solution)
```

**Why semantic search is better:**

| Feature | Keyword | Semantic |
|---------|---------|----------|
| **Understands meaning** | ❌ | ✅ |
| **Finds synonyms** | ❌ | ✅ |
| **Understands context** | ❌ | ✅ |
| **Cross-language** | ❌ | ✅ (some) |
| **Handles typos** | ❌ | ✅ (partial) |
| **Exact matches** | ✅ | ✅ |

### Real-World Examples

#### Example 1: "Speed up my site"

**Keyword search finds:**

- Posts containing "speed" OR "site"

**Semantic search finds:**

- Performance optimization guides
- Caching tutorials
- Image compression posts
- Minification articles
- CDN setup guides
- Database optimization
- Code splitting techniques

**Why?** The search understands **intent** (improve performance), not just words.

#### Example 2: "How do I sell products?"

**Keyword search finds:**

- Posts with "sell" AND "products"

**Semantic search finds:**

- WooCommerce setup guides
- Payment gateway tutorials
- Shipping configuration
- Product page optimization
- Checkout best practices
- E-commerce SEO
- Conversion rate optimization

**Why?** The search understands the **goal** (set up e-commerce), not just keywords.

#### Example 3: "Fix broken links"

**Keyword search finds:**

- Posts mentioning "broken" AND "links"

**Semantic search finds:**

- Link checker tutorials
- Redirect setup guides
- 404 error handling
- Permalink structure
- .htaccess configuration
- SEO impact of 404s
- Site migration guides

**Why?** The search connects **problems** to **solutions**.

## Advanced Search Techniques

### Boolean-Style Queries

Combine multiple concepts:

```bash
# Find posts about both performance AND security
nexus search "performance AND security"

# Find posts about either caching OR CDN
nexus search "caching OR CDN"

# Find posts about WooCommerce but not shipping
nexus search "WooCommerce NOT shipping"
```

!!! note
    These are semantic, not exact boolean operators. The AI interprets intent.

### Temporal Queries

Find recent content:

```bash
# Find recent posts about a topic
nexus search "WordPress 6.4 new features"

# Ask AI for time-based queries
"Show me posts published in March 2026"
"Find products added this week"
```

### Cross-Site Queries

Search across multiple sites:

```bash
# CLI searches all sites by default
nexus search "contact form"

# UI Site Finder searches all sites
# Filter results by site in the UI

# AI Chat can target specific sites
"Find posts about SEO on blog and news sites"
```

### Fuzzy Matching

Semantic search naturally handles typos and variations:

```bash
# These all find similar results
nexus search "optimize images"
nexus search "optimise images"  # UK spelling
nexus search "image optimization"
nexus search "compressing pictures"
```

## Understanding Search Scores

### Score Ranges

| Score | Meaning | Example |
|-------|---------|---------|
| **0.95-1.0** | Near-identical | Exact duplicates, quotes |
| **0.85-0.94** | Very similar | Same topic, different words |
| **0.75-0.84** | Related | Related concepts, similar context |
| **0.65-0.74** | Loosely related | Tangentially connected |
| **0.50-0.64** | Weakly related | Shared keywords only |
| **<0.50** | Not relevant | Different topics |

### Example Scores

**Query:** "WordPress performance optimization"

```json
[
  {
    "title": "WordPress Speed Optimization Guide",
    "score": 0.95,
    "why": "Exact topic match, comprehensive coverage"
  },
  {
    "title": "Caching Strategies for WordPress",
    "score": 0.89,
    "why": "Core subtopic, directly related"
  },
  {
    "title": "Image Compression Tutorial",
    "score": 0.82,
    "why": "Related optimization technique"
  },
  {
    "title": "Database Query Optimization",
    "score": 0.76,
    "why": "Performance-related, different domain"
  },
  {
    "title": "Choosing a WordPress Host",
    "score": 0.68,
    "why": "Affects performance, indirect"
  },
  {
    "title": "WordPress Plugin Development",
    "score": 0.52,
    "why": "Shares 'WordPress' keyword only"
  }
]
```

## Common Search Patterns

### Finding Similar Content

Find content similar to a specific post:

```
You: Find posts similar to "WordPress Security Checklist"

Claude: Here are posts similar to "WordPress Security Checklist":

1. "Hardening WordPress" (score: 0.91)
2. "Two-Factor Authentication Setup" (score: 0.87)
3. "WordPress Firewall Configuration" (score: 0.85)
4. "Backup and Recovery Best Practices" (score: 0.82)
```

### Content Gap Analysis

Find topics you haven't covered:

```
You: What SEO topics am I missing on my blog?

Claude: Analyzing your blog content...

You have strong coverage of:
✓ On-page SEO (12 posts)
✓ Meta descriptions (8 posts)
✓ Schema markup (5 posts)

Content gaps (common SEO topics not found):
- Link building strategies
- Core Web Vitals optimization
- International SEO
- E-A-T principles
- Voice search optimization

Would you like me to create drafts for any of these?
```

### Duplicate Detection

Find duplicate or near-duplicate content:

```bash
# High threshold catches duplicates
nexus search "content from post title" --threshold 0.95
```

### Cross-Product Search

Find products across e-commerce sites:

```
You: Find all blue products across my WooCommerce sites

Claude: Searching products with "blue" attribute...

shop:
- Blue Widget Pro (SKU: BWP-001, $99.99)
- Royal Blue Gadget (SKU: RBG-042, $149.99)
- Navy Blue Accessory (SKU: NBA-123, $29.99)
... (12 more results)

test-shop:
- Blue Test Product (SKU: TEST-01, $1.00)

Total: 16 blue products across 2 sites
```

## Troubleshooting

### No Results Found

If your search returns no results:

**1. Check if sites are scanned:**

```bash
nexus db info
```

Look for "Documents: 0" — means no sites scanned yet.

**2. Re-scan sites:**

```bash
nexus scan --force
```

**3. Try broader query:**

```bash
# Too specific
nexus search "WordPress 6.4.3 performance optimization with Redis caching"

# Better
nexus search "WordPress performance"
```

**4. Lower threshold:**

```bash
nexus search "query" --threshold 0.5
```

### Irrelevant Results

If results don't match your query:

**1. Increase threshold:**

```bash
nexus search "query" --threshold 0.85
```

**2. Be more specific:**

```bash
# Vague
nexus search "WordPress"

# Specific
nexus search "WordPress multisite configuration"
```

**3. Filter by type:**

```bash
# Only search posts
nexus search "query" --type post

# Only search products
nexus search "query" --type product
```

### Slow Search

If search takes >1 second:

**1. Check database size:**

```bash
nexus db info
```

If >1GB, consider optimizing:

```bash
nexus db optimize
```

**2. Reduce result limit:**

```bash
# Faster: only get top 5
nexus search "query" --limit 5
```

**3. Search specific site:**

```bash
# Faster: only search one site
nexus search "query" --site mysite
```

## Next Steps

Now that you can search your content:

### Learn More About Search

- **[Semantic Search](../features/semantic-search.md)** - Deep dive into vector search
- **[Content Extraction](../features/content-extraction.md)** - What gets indexed
- **[CLI Examples](../cli/examples.md)** - Advanced search patterns

### Connect AI Assistants

- **[Claude Desktop](../cli/mcp-setup.md#claude-desktop)** - Full setup guide
- **[Cursor IDE](../cli/mcp-setup.md#cursor-ide)** - Code editor integration
- **[Zed Editor](../cli/mcp-setup.md#zed-editor)** - Fast, lightweight editor

### Explore Other Features

- **[WP Engine Management](../cli/wpe-sites.md)** - Remote site management
- **[Bulk Operations](../ui-addon/bulk-operations.md)** - Fleet operations
- **[Fleet Overview](../ui-addon/fleet-overview.md)** - Dashboard and analytics

---

**Try these example searches:**

```bash
# Find content
nexus search "WooCommerce shipping"
nexus search "WordPress security"
nexus search "optimize images"

# Find sites
nexus search "needs updates"
nexus search "staging environment"
nexus search "WP Engine"

# Find products
nexus search "blue widgets" --type product
```

Or ask Claude (if MCP is set up):

- "List all my WordPress sites"
- "Which sites need plugin updates?"
- "Find posts about SEO across all my sites"
