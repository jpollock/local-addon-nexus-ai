# Workflow: Content Indexing and Search

Index WordPress site content for semantic search using AI embeddings.

## How It Works

Nexus AI extracts content from WordPress sites (posts, pages, products, media), splits it into chunks, generates vector embeddings using a local AI model (all-MiniLM-L6-v2), and stores them in a vector database (LanceDB). You can then search content using natural language queries.

## Index a Site

1. **Ensure the site is running**
   ```
   local_start_site({ site: "my-blog" })
   ```
   The site must be running so its MySQL database is accessible.

2. **Trigger indexing**
   ```
   reindex_site({ site: "my-blog" })
   ```
   This extracts all content, generates embeddings, and stores them. Indexing happens automatically when a site starts, but you can force a re-index anytime.

3. **Check index status**
   ```
   get_index_status({ site: "my-blog" })
   ```
   Shows when the site was last indexed and how many documents are stored.

## Search Content

### Single-site search
```
search_site_content({ site: "my-blog", query: "pricing plans for enterprise" })
```
Returns ranked results with titles, excerpts, and relevance scores.

### Cross-site search
```
search_across_sites({ query: "refund policy" })
```
Searches all indexed sites at once. Useful for finding content across a fleet.

## What Gets Indexed

- Posts and pages (title, content, excerpt, categories, tags)
- WooCommerce products (if WooCommerce is installed)
- Custom post types
- Media attachments (metadata)
- ACF custom fields (if ACF is installed)

## Tips

- Indexing runs automatically when sites start — manual re-indexing is only needed after bulk content changes
- Search uses semantic similarity, not keyword matching — natural language queries work best
- Results include a relevance score — lower scores may be less relevant
- Use `list_indexed_sites` to see which sites have been indexed
