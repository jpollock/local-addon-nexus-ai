# Troubleshooting Guide

Common issues and solutions for Nexus AI addon.

## Start Here

Before digging into specific errors, run the health check:

```bash
nexus doctor
```

It checks every layer of the stack (Local, addon, GraphQL, MCP server, AI provider, gateway) and prints the exact command to fix anything that's wrong. Most issues are diagnosed and resolved in one step.

## Installation & Setup

### Addon Not Appearing in Local

**Symptoms:**
- Nexus AI not in Local's sidebar
- Addon doesn't load after installation

**Solutions:**
1. **Restart Local** completely (not just refresh)
2. Check addon is enabled: **Add-ons → Installed → Nexus AI**
3. Check Local's addon directory permissions
4. Manual installation: **File → Add Add-on Manually**

### NODE_MODULE_VERSION Mismatch

**Error Message:**
```
Error: The module 'better-sqlite3.node' was compiled against a different Node.js version
```

**Cause:** better-sqlite3 native module compiled for wrong Node version (system Node vs Electron's Node)

**Fix:**
```bash
cd /path/to/local-addon-nexus-ai
npm run rebuild
# Restart Local
```

**Why this happens:**
- `npm install` compiles for system Node (tests)
- `npm run rebuild` recompiles for Electron (Local)
- Always run `rebuild` after `npm install` before loading in Local

### Setup AI Fails

**Symptoms:**
- "Setup AI failed" error
- Install hangs indefinitely
- Plugins not installed

**Possible Causes & Fixes:**

#### Site Not Running
- **Fix:** Start the site in Local first
- **Verify:** Site shows green "Running" status

#### WordPress Corrupted
- **Fix:** Check site health in Local
- **Fix:** Try stopping and restarting site
- **Nuclear option:** Delete site, recreate, restore from backup

#### WP-CLI Not Available
- **Fix:** Check Local's WP-CLI is working:
  - Open site's **Shell** in Local
  - Run `wp --info`
  - Should show WP-CLI version
- **If broken:** Reinstall Local

#### Network/Download Issues
- **Fix:** Check internet connection
- **Fix:** Try again (plugins download from wordpress.org)
- **Fix:** Manual install via WP Admin if needed

### API Key Not Accepted

**Symptoms:**
- "Invalid API key" errors
- AI requests fail with 401

**Fixes:**
1. **Verify key format:**
   - Anthropic: starts with `sk-ant-`
   - OpenAI: starts with `sk-`
   - Google: starts with `AIza`

2. **Re-enter key carefully:**
   - No extra spaces
   - Copy entire key
   - Paste into Settings

3. **Test in browser:**
   - Try key in API playground
   - Anthropic: [console.anthropic.com](https://console.anthropic.com)
   - OpenAI: [platform.openai.com/playground](https://platform.openai.com/playground)

4. **Check key permissions:**
   - Some keys have usage limits
   - Check your API account status

## AI Gateway

### Requests Not Tracked

**Symptoms:**
- AI requests work but don't show in Usage panel
- "By Caller" panel empty

**Fixes:**

1. **Enable AI Gateway:**
   - **Settings → Enable AI Gateway**
   - Must be ON

2. **Verify MU plugin:**
   - Check `/wp-content/mu-plugins/nexus-ai-connector-config.php` exists
   - Should contain `NEXUS_AI_GATEWAY_URL` constant

3. **Re-run Setup AI:**
   - Right-click site → **Setup AI**
   - Regenerates MU plugin

4. **Check site is using gateway:**
   - In WordPress: **AI → Settings**
   - Active provider should be "Local Gateway"

### Rate Limit Errors

**Error Message:**
```
Rate limit exceeded: 100 requests per hour
```

**Cause:** Site exceeded configured rate limits

**Immediate Fix:**
- Wait for limit window to reset (1 hour or 1 day)

**Long-term Fixes:**
1. **Increase limits:**
   - **Settings → AI Gateway → Rate Limits**
   - Adjust based on usage patterns

2. **Find culprit:**
   - **Overview → AI Usage By Caller**
   - See which plugin is making excessive requests
   - Debug or disable that plugin

3. **Disable limits** (not recommended):
   - Set to very high values (e.g., 10000/day)
   - Monitor costs manually

### Gateway Not Starting

**Symptoms:**
- AI Gateway panel shows "Not Running"
- Requests fail with connection errors

**Fixes:**

1. **Check webhook server:**
   - **Settings → Webhook Server**
   - Should show running with port number

2. **Port conflict:**
   - Another app using the same port
   - **Fix:** Change port in Settings
   - Default: 13000

3. **Restart Local:**
   - Sometimes webhook server doesn't start
   - Complete restart usually fixes

## WP Engine Integration

### CAPI Connection Failed

**Symptoms:**
- "Failed to connect to WP Engine" error
- Can't see remote sites

**Fixes:**

1. **Verify credentials:**
   - **Settings → WP Engine**
   - Test Connection button
   - Username: WPE portal email
   - Password: WPE portal password

2. **Check account status:**
   - Log into [my.wpengine.com](https://my.wpengine.com)
   - Verify account active

3. **API access:**
   - Some accounts don't have CAPI access
   - Contact WPE support if needed

4. **Network issues:**
   - Check internet connection
   - Try again after a moment

### Remote Sites Not Showing

**Symptoms:**
- Local sites visible but not WPE sites
- Fleet Overview shows "0 remote sites"

**Fixes:**

1. **Authenticate first:**
   - **Settings → WP Engine → Add Credentials**
   - Must connect before seeing sites

2. **Refresh sites list:**
   - **Fleet Overview → Refresh** button
   - CAPI calls can be slow

3. **Account permissions:**
   - Check you have access to sites in portal
   - Some sites may be restricted

### Remote Operations Fail

**Symptoms:**
- Can't run WP-CLI on remote sites
- "SSH connection failed" errors

**Fixes:**

1. **Verify environment:**
   - Remote WP-CLI only works on **production/staging** installs
   - Not on **development** environments

2. **Check install status:**
   - Install must be fully provisioned (not "Creating...")
   - Wait for provision to complete

3. **SSH key issues:**
   - Local must be authenticated to WPE
   - Re-authenticate if needed

4. **Command not allowed:**
   - Some WP-CLI commands blocked on remote
   - Blocked: `db query`, `eval`, `shell`
   - Use allowed commands only

## Content Indexing

### Indexing Stuck/Slow

**Symptoms:**
- Indexing never completes
- UI freezes during indexing
- Progress stuck at same percentage

**Fixes:**

1. **Large sites:**
   - Sites with 10,000+ posts take time
   - Let it run (can take 30+ minutes)
   - Check progress in UI

2. **Cancel and retry:**
   - Stop indexing (if button available)
   - Start fresh

3. **Skip patterns:**
   - Add `.indexignore` file to site root
   - Add patterns like:
     ```
     node_modules/
     .git/
     dist/
     vendor/
     ```

4. **Disk space:**
   - Check available disk space
   - Embeddings can be large (100MB+ per site)
   - Free up space if needed

### Search Returns No Results

**Symptoms:**
- Content Browser search finds nothing
- Sites show "0 chunks"

**Fixes:**

1. **Index site first:**
   - **Fleet Overview → Index** button
   - Wait for completion

2. **Check index status:**
   - **Fleet Overview** → column shows indexed sites
   - Green = indexed, Gray = not indexed

3. **Re-index:**
   - Sometimes index gets corrupted
   - Click **Index** again (will force re-index)

## Performance Issues

### Local UI Slow/Frozen

**Symptoms:**
- Local becomes unresponsive
- Addon panels freeze
- High CPU usage

**Causes & Fixes:**

1. **Too many sites:**
   - 500+ sites can slow rendering
   - Use Site Groups to filter
   - Index in batches

2. **Indexing in progress:**
   - Background indexing uses CPU
   - Wait for completion or cancel

3. **Bulk operations:**
   - Running bulk op on 50+ sites
   - Normal - will complete
   - Check progress indicator

4. **Memory leak:**
   - Restart Local
   - Check for addon updates

### Bulk Operations Timeout

**Symptoms:**
- Bulk operation never completes
- Stuck at "Processing..."
- Some sites succeed, others fail

**Fixes:**

1. **Reduce batch size:**
   - Select fewer sites (10-20 at a time)
   - Process in smaller batches

2. **Check failed sites:**
   - Review error messages
   - Fix issues on individual sites
   - Retry bulk op

3. **Network issues:**
   - Slow internet
   - WPE API rate limits
   - Wait and retry

## Error Messages

### "Invalid site ID format"

**Meaning:** Site ID must be a valid UUID
**Fix:** Use site_id from Local (don't guess)

### "Missing X-Auth-Token header"

**Meaning:** AI Gateway request missing authentication
**Fix:** Re-run Setup AI to configure gateway token

### "Anthropic API error: 429"

**Meaning:** Hit Anthropic's rate limits (not addon's)
**Fix:** Wait a moment, try again, or upgrade Anthropic plan

### "Plugin slug must contain only lowercase letters, numbers, and hyphens"

**Meaning:** Invalid plugin slug format
**Fix:** Use correct WordPress plugin slug (e.g., `akismet`, not `Akismet`)

### "Operation blocked: production sites in selection"

**Meaning:** Bulk operation includes production sites without confirmation
**Fix:** Check "Confirm production" checkbox in UI

## Getting Help

If none of the above solutions work:

1. **Check logs:**
   - Local's logs: **Help → Reveal Local Logs**
   - Look for error messages mentioning Nexus AI

2. **Report an issue:**
   - [GitHub Issues](https://github.com/wpengine/local-addon-nexus-ai/issues)
   - Include: Local version, OS, error message, steps to reproduce

3. **Community support:**
   - Local Community Forums
   - WP Engine Support (for WPE integration issues)

## Preventive Maintenance

To avoid issues:

1. **Keep addon updated:** Check for updates regularly
2. **Keep Local updated:** New versions fix bugs
3. **Monitor disk space:** Indexing uses storage
4. **Regular backups:** Before bulk operations
5. **Test on staging:** Before running on production sites
