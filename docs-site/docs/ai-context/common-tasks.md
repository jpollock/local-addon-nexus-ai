---
title: Common Tasks
description: Step-by-step workflows for common operations
keywords: [workflows, tasks, how-to, guides]
---

# Common Tasks

**Last Verified:** 2026-03-25

Step-by-step workflows for common Nexus AI operations.

## Task 1: Search for Content Across Sites

**Goal:** Find all posts/pages mentioning "WooCommerce"

**Steps:**

1. **List indexed sites:**
   ```
   Tool: nexus_list_sites
   Result: Shows which sites are indexed
   ```

2. **Search across all sites:**
   ```
   Tool: search_across_sites
   Args: {
     query: "WooCommerce payment gateway",
     limit: 10
   }
   Result: Ranked results from all sites
   ```

3. **Search specific site:**
   ```
   Tool: search_site_content
   Args: {
     site: "my-store",
     query: "WooCommerce",
     limit: 20
   }
   ```

**Notes:**
- Sites must be indexed first (`index_site`)
- Query is semantic (finds similar meaning, not just keywords)
- Results ranked by cosine distance

---

## Task 2: Create and Configure a WordPress Site

**Goal:** Create a new local WordPress site

**Steps:**

1. **Create site:**
   ```
   Tool: local_create_site
   Args: {
     name: "my-new-site",
     php_version: "8.2"
   }
   Result: Site created with admin/admin credentials
   ```

2. **Start site:**
   ```
   Tool: local_start_site
   Args: { site: "my-new-site" }
   ```

3. **Check WordPress version:**
   ```
   Tool: wp_core_version
   Args: { site_id: "abc-123" }
   ```

4. **Install plugins:**
   ```
   Tool: wp_plugin_install
   Args: {
     site_id: "abc-123",
     slug: "woocommerce",
     activate: true
   }
   ```

5. **Index site content:**
   ```
   Tool: index_site
   Args: { site_id: "abc-123" }
   ```

---

## Task 3: Sync WP Engine Sites

**Goal:** Pull WPE sites into Nexus AI fleet

**Steps:**

1. **Check WPE connection:**
   ```
   Tool: wpe_get_status
   Result: Shows if WPE auth is configured
   ```

2. **List WPE accounts:**
   ```
   Tool: wpe_get_accounts
   Result: All accessible WPE accounts
   ```

3. **Sync all sites:**
   ```
   Tool: wpe_sync_sites
   Args: { full_index: true }
   Result: Pulls all WPE sites, extracts content, indexes
   ```

4. **Check sync status:**
   ```
   Tool: nexus_list_sites
   Result: Shows local + WPE sites with last sync time
   ```

**Performance:**
- ~6 seconds per site average
- 10x concurrent operations
- 251 sites in ~25 minutes

---

## Task 4: Check Plugin Status Across Fleet

**Goal:** Find which sites have a specific plugin

**Steps:**

1. **List all sites:**
   ```
   Tool: nexus_list_sites
   Result: All local + WPE sites
   ```

2. **Check plugin on each site:**
   ```
   Tool: wp_plugin_list
   Args: { site_id: "site-1" }
   Repeat for each site
   ```

3. **Use parallel audit (faster):**
   ```
   Tool: parallel_plugin_audit
   Args: { sites: ["site-1", "site-2", "site-3"] }
   Result: Plugin status across all sites
   ```

**Alternative:** Use bulk operations panel in UI

---

## Task 5: Pull WPE Site to Local

**Goal:** Create local copy of WPE production site

**Steps:**

1. **Find WPE install:**
   ```
   Tool: wpe_get_sites
   Result: Lists all WPE sites with install IDs
   ```

2. **Check if local site exists:**
   ```
   Tool: nexus_list_sites
   Look for linked local site
   ```

3. **Create local site if needed:**
   ```
   Tool: local_create_site
   Args: { name: "my-site-local" }
   ```

4. **Pull from WPE:**
   ```
   Tool: local_wpe_pull
   Args: {
     site: "my-site-local",
     remote_install_id: "install-id-from-step-1",
     include_database: true
   }
   Result: Async operation, check Local app for progress
   ```

5. **Wait for pull to complete** (check Local app)

6. **Verify:**
   ```
   Tool: wp_core_version
   Args: { site_id: "local-site-id" }
   ```

**Important:** Pull is async — always check Local app for completion

---

## Task 6: Execute Bulk Plugin Update

**Goal:** Update a plugin across multiple sites

**Steps:**

1. **Identify sites needing update:**
   ```
   Tool: wp_plugin_list
   Args: { site_id: "site-1" }
   Check 'update_available' field
   Repeat for all sites
   ```

2. **Use bulk operation:**
   ```
   Tool: bulk_plugin_update
   Args: {
     sites: ["site-1", "site-2", "site-3"],
     slug: "woocommerce"
   }
   Result: Progress tracked in BulkOperationsPanel
   ```

3. **Monitor progress in UI:**
   - Fleet Overview → Bulk Operations Panel
   - Shows per-site status
   - Expandable results
   - Cancel if needed

**Alternative:** CLI approach for automation

---

## Task 7: Search with Ollama (Local LLM)

**Goal:** Query site using local LLM with automatic context

**Steps:**

1. **Check Ollama status:**
   ```
   Tool: ollama_status
   Result: Shows if Ollama running, available models
   ```

2. **List models:**
   ```
   Tool: ollama_list_models
   Result: Installed models (e.g., llama3.2)
   ```

3. **Query with site context:**
   ```
   Tool: ollama_query_with_site
   Args: {
     site: "my-store",
     prompt: "What payment gateways are configured?",
     model: "llama3.2"
   }
   Result: LLM response with automatic site context injection
   ```

**What happens:**
- Nexus AI automatically injects site metadata
- Plugin list, theme info, WP version added to prompt
- LLM gets full context without manual prompting

---

## Task 8: Monitor AI Gateway Usage

**Goal:** Track AI API costs and usage

**Steps:**

1. **Get overall usage:**
   ```
   Tool: ai_gateway_usage
   Result: Total cost, requests, tokens
   ```

2. **Get usage by caller:**
   ```
   Tool: ai_gateway_by_caller
   Result: Breakdown by plugin/theme
   ```

3. **View in UI:**
   - Fleet Overview → AI Gateway Usage Panel
   - Shows cost over time
   - Breakdown by caller
   - Recent requests

**Use case:** Track which plugins/themes use most AI credits

---

## Task 9: Fix Broken Site (Diagnostic)

**Goal:** Troubleshoot non-responsive site

**Steps:**

1. **Check site status:**
   ```
   Tool: local_get_site
   Args: { site: "broken-site" }
   Result: Status, path, domain
   ```

2. **Check if running:**
   ```
   If status = "halted":
     Tool: local_start_site
     Args: { site: "broken-site" }
   ```

3. **Check WordPress health:**
   ```
   Tool: wp_site_health
   Args: { site_id: "site-id" }
   Result: Health status, issues, recommendations
   ```

4. **Check logs:**
   ```
   Tool: local_get_site_logs
   Args: { site: "broken-site", lines: 100 }
   Result: Recent error logs
   ```

5. **Check plugin conflicts:**
   ```
   Tool: wp_plugin_list
   Args: { site_id: "site-id" }
   Look for recently activated plugins
   ```

**Common fixes:**
- Start halted site
- Deactivate problematic plugins
- Check disk space (StorageHealthPanel)
- Review error logs

---

## Task 10: Setup AI on Multiple Sites

**Goal:** Configure AI features across fleet

**Steps:**

1. **Use bulk setup:**
   ```
   Tool: bulk_setup_ai
   Args: {
     sites: ["site-1", "site-2", "site-3"],
     provider: "openai",
     api_key: "sk-..."
   }
   Result: Progress in BulkOperationsPanel
   ```

**What it does:**
- Installs AI assistant plugin
- Activates provider plugins (OpenAI, etc.)
- Enables AI experiments
- Syncs credentials
- Deploys ACF abilities mu-plugin

**Alternative:** Setup individually via WP-CLI tools

---

## Quick Reference

| Task | Primary Tool | Alternative |
|------|-------------|-------------|
| Search content | `search_site_content` | `search_across_sites` |
| Create site | `local_create_site` | Local UI |
| Sync WPE | `wpe_sync_sites` | UI Preferences |
| Check plugins | `wp_plugin_list` | `parallel_plugin_audit` |
| Pull to local | `local_wpe_pull` | Local UI |
| Bulk update | `bulk_plugin_update` | UI Bulk Ops Panel |
| LLM query | `ollama_query_with_site` | External MCP client |
| AI usage | `ai_gateway_usage` | UI Usage Panel |
| Diagnose | `wp_site_health` | Check logs |
| Setup AI | `bulk_setup_ai` | Manual WP-CLI |

## Next Steps

- **All tools:** [MCP Tools](../mcp-tools/index.md)
- **CLI usage:** [CLI Commands](../cli/commands.md)
- **Troubleshooting:** [Troubleshooting](troubleshooting.md)
