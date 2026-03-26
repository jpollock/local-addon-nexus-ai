---
title: Troubleshooting
description: Common issues and solutions for Nexus AI users
keywords: [troubleshooting, errors, issues, solutions, fixes]
---

# Troubleshooting

**Last Verified:** 2026-03-25

Common issues and solutions when using Nexus AI.

## Connection Issues

### Tool calls fail with "MCP server not reachable"

**Symptoms:**
- AI assistant can't connect to Nexus AI
- "Connection refused" or timeout errors

**Solutions:**

1. **Check Local is running:**
   - Nexus AI only works when Local app is open
   - Start Local if closed

2. **Check connection info file exists:**
   ```bash
   cat ~/Library/Application\ Support/Local/nexus-ai-mcp-connection-info.json
   ```
   Should show URL, auth token, port

3. **Restart Local:**
   - Quit Local completely
   - Relaunch
   - Wait for addon to load

4. **Check addon loaded:**
   - Local → Addons → Should see "Nexus AI"
   - If not listed, check installation

---

### "Site not found" errors

**Symptoms:**
- Tool calls fail with "Site 'xyz' not found"

**Solutions:**

1. **List available sites:**
   ```
   Tool: nexus_list_sites
   ```
   Check exact site name/ID

2. **Site ID vs Name:**
   - Most tools accept both site ID (UUID) or name
   - Use exact match (case-sensitive)

3. **WPE sites:**
   - Must sync first: `wpe_sync_sites`
   - Use `install_name` for remote WP-CLI
   - Use `site_id` for local operations

---

## Search Issues

### No search results

**Symptoms:**
- `search_site_content` returns 0 results
- Content exists but not found

**Solutions:**

1. **Check if site is indexed:**
   ```
   Tool: get_index_status
   Args: { site: "my-site" }
   ```
   Look for "state": "indexed"

2. **Index site if needed:**
   ```
   Tool: index_site
   Args: { site_id: "site-id" }
   ```
   Wait for completion

3. **Try different query:**
   - Search is semantic (finds meaning, not exact keywords)
   - Try broader terms: "payment" instead of "payment-gateway-config"

4. **Check site has content:**
   ```
   Tool: wp_plugin_list
   Args: { site_id: "site-id" }
   ```
   Verify site is accessible

---

### Slow search performance

**Symptoms:**
- Search takes >5 seconds
- Large result sets

**Solutions:**

1. **Reduce limit:**
   ```
   Args: { query: "...", limit: 10 }  # Instead of 100
   ```

2. **Use site-specific search:**
   - `search_site_content` faster than `search_across_sites`

3. **Check vector database size:**
   - UI → Storage Health Panel
   - Large databases slow down search

---

## Tool Execution Failures

### "Tool prerequisites not met"

**Symptoms:**
- Tool available in `tools/list` but fails when called
- Error about missing services

**Solutions:**

1. **Check tool requirements:**
   - Some tools require Local running
   - Some require WPE connection
   - Some require Ollama installed

2. **WPE tools:**
   - Requires WPE account connected in Local
   - Local → Connect → WP Engine

3. **Ollama tools:**
   - Requires Ollama running: `ollama serve`
   - Install Ollama if not present

---

### WP-CLI commands fail

**Symptoms:**
- `wp_plugin_list` or other WP-CLI tools error
- "WP-CLI not found" or permission errors

**Solutions:**

1. **Local sites:**
   - Site must be running (`local_start_site`)
   - Check site status: `local_get_site`

2. **Remote WPE sites:**
   - SSH access required
   - Use `install_name`, not `site_id`
   - Check WPE credentials in Local

3. **Permission errors:**
   - Site files must be writable
   - Check Local site permissions

---

### "Operation failed" on bulk operations

**Symptoms:**
- Bulk operation shows some sites failed
- Per-site errors in results

**Solutions:**

1. **Check expandable results:**
   - UI → Bulk Operations Panel
   - Expand operation to see per-site errors

2. **Common failures:**
   - Halted sites: Start sites first
   - Permission errors: Check file ownership
   - Network errors: Check internet connection

3. **Retry failed sites:**
   - Note which sites failed
   - Execute operation on those sites individually
   - Check logs for detailed errors

---

## WP Engine Issues

### WPE sync fails or is slow

**Symptoms:**
- `wpe_sync_sites` times out
- Only partial sites synced

**Solutions:**

1. **Check WPE auth:**
   ```
   Tool: wpe_get_status
   ```
   Verify credentials configured

2. **Sync in batches:**
   - Don't sync 500+ sites at once
   - Sync account-by-account if needed

3. **Network timeout:**
   - Large sites take longer
   - SSH connections may timeout
   - Retry failed sites

4. **Check rate limits:**
   - WPE CAPI has rate limits
   - Spread sync operations over time

---

### Can't pull WPE site to local

**Symptoms:**
- `local_wpe_pull` fails
- "Install not found" errors

**Solutions:**

1. **Get correct install ID:**
   ```
   Tool: wpe_get_sites
   ```
   Use exact `install_id` from result

2. **Check local site exists and is running:**
   ```
   Tool: local_get_site
   Args: { site: "target-site" }
   ```
   Start site if halted

3. **Pull is async:**
   - Command returns immediately
   - Check Local app for progress
   - Don't run WP-CLI until pull completes

4. **Database overwrite warning:**
   - `include_database: true` overwrites local DB
   - Backup local site first if needed

---

## Performance Issues

### Indexing very slow

**Symptoms:**
- Site indexing takes >30 minutes
- Stuck on "indexing" state

**Solutions:**

1. **Check site size:**
   - Large sites (1000+ posts) take longer
   - Expected: ~1-5 minutes for typical site

2. **Check system resources:**
   - ONNX embedding generation is CPU-intensive
   - Close other apps if needed

3. **Cancel and retry:**
   - Indexing may be stuck
   - Restart Local
   - Try `index_site` again

---

### UI sluggish with many sites

**Symptoms:**
- Fleet Overview slow to render
- Lag when scrolling sites

**Solutions:**

1. **Virtual scrolling enabled:**
   - UI already uses react-window
   - Should handle 500+ sites

2. **Reduce active panels:**
   - Some panels query on load
   - Collapse unused panels

3. **Clear old data:**
   - UI → Storage Health Panel
   - Clean up old indexes if suggested

---

## AI Gateway Issues

### Credentials not syncing to sites

**Symptoms:**
- Sites show "No AI credentials"
- `sync_ai_credentials` doesn't work

**Solutions:**

1. **Check credentials configured:**
   - UI → Preferences → Nexus AI
   - Enter OpenAI/Anthropic API key

2. **Site must have AI plugin:**
   - Use `bulk_setup_ai` first
   - Or install AI assistant plugin manually

3. **Check sync result:**
   - Tool returns success/failure per site
   - Check error messages

---

### AI usage not tracked

**Symptoms:**
- AI Gateway Usage Panel shows 0 requests
- Calls made but not logged

**Solutions:**

1. **Check AI Gateway enabled:**
   - UI → Preferences → Enable AI Gateway
   - Must be on for tracking

2. **Only tracks proxied calls:**
   - Direct API calls not tracked
   - Must go through AI Gateway

3. **Check site configured:**
   - Site must use gateway URL
   - Not direct OpenAI/Anthropic endpoint

---

## CLI Issues

### `nexus` command not found

**Symptoms:**
- Terminal doesn't recognize `nexus` command

**Solutions:**

1. **Check installation:**
   ```bash
   npm list -g local-addon-nexus-ai
   ```

2. **Link CLI:**
   ```bash
   cd /path/to/local-addon-nexus-ai
   npm link
   ```

3. **Use full path:**
   ```bash
   node /path/to/local-addon-nexus-ai/bin/nexus.js
   ```

---

### CLI can't connect to Local

**Symptoms:**
- CLI commands fail with connection errors

**Solutions:**

1. **Local must be running:**
   - CLI connects to Local's GraphQL API
   - Start Local app

2. **Check connection info:**
   ```bash
   cat ~/Library/Application\ Support/Local/graphql-connection-info.json
   ```

3. **Addon must be loaded:**
   - Nexus AI addon enables GraphQL endpoints
   - Check Local → Addons

---

## Data Issues

### Lost index data after restart

**Symptoms:**
- Sites show as "not indexed" after restarting Local
- Search returns no results

**Cause:** This shouldn't happen (LanceDB persists to disk)

**Solutions:**

1. **Check data directory:**
   ```bash
   ls -la ~/Library/Application\ Support/Local/nexus-ai/lancedb/
   ```
   Should have table files

2. **Reindex if lost:**
   ```
   Tool: index_site
   Args: { site_id: "site-id" }
   ```

3. **Check disk space:**
   - Vector database requires space
   - ~10-50 MB per site typically

---

## Getting More Help

### Check Logs

**Local logs:**
```bash
tail -f ~/Library/Logs/Local/local-main.log
```
Look for `[NexusAI]` entries

**MCP server logs:**
- Included in Local logs
- Search for tool names or error messages

### Report Issues

**Before reporting:**
1. Check this troubleshooting guide
2. Check Local logs for errors
3. Try restarting Local
4. Note exact error message

**What to include:**
- OS version (macOS/Windows/Linux)
- Local version
- Nexus AI addon version
- Steps to reproduce
- Error logs
- Expected vs actual behavior

### Common Error Codes

| Error | Meaning | Solution |
|-------|---------|----------|
| `SITE_NOT_FOUND` | Site ID/name invalid | Check `nexus_list_sites` |
| `NOT_RUNNING` | Site is halted | Use `local_start_site` |
| `WP_CLI_FAILED` | WP-CLI command error | Check site logs |
| `AUTH_REQUIRED` | Missing credentials | Connect WPE account |
| `RATE_LIMIT` | Too many requests | Wait and retry |
| `NETWORK_ERROR` | Connection failed | Check internet |

## Next Steps

- **Features:** [Verified Features](features.md)
- **Tools:** [MCP Tools](../mcp-tools/index.md)
- **Common tasks:** [Common Tasks](common-tasks.md)
