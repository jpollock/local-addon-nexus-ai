# Getting Started with Nexus AI

Nexus AI brings AI capabilities to your Local WordPress sites with usage tracking, cost monitoring, and fleet management.

## Choose Your Journey

There are two ways to get value from Nexus AI — pick the one that fits:

**Journey A: Connect your AI agent (Claude Code, Cursor, etc.)**
No API key required. Takes ~2 minutes. Your AI agent gets 160+ tools to search, manage, and audit all your WordPress sites.
→ Install → `nexus mcp setup` → done.

**Journey B: AI features inside WordPress**
Generate titles, summaries, and excerpts directly in the block editor. Requires an Anthropic or OpenAI API key. Takes ~5 minutes per site.
→ Install → `nexus ai config` → `nexus ai setup <sitename>` → done.

Both journeys use the same installation. Start with Journey A — it works immediately and makes Journey B much easier to configure.

## Installation

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

This installs the CLI and automatically downloads and installs the Local addon for your platform. On first run, it will:

1. Detect your platform (macOS Apple Silicon, Intel, Windows, Linux)
2. Download the correct addon tarball
3. Install it into Local's addons directory
4. Prompt you to restart Local

**Verify everything is working:**

```bash
nexus doctor
```

Expected output on a healthy system:

```
Nexus AI v0.2.1 — System Health
──────────────────────────────────────────────────
  ✅  Local app           Installed
  ✅  Local running       Running
  ✅  Nexus AI addon      Active (v0.2.1)
  ✅  GraphQL server      Connected (port 4000)
  ✅  MCP server          Running · 161 tools
  ...
```

Any `⚠️` or `❌` line includes the exact command to fix it. Run `nexus doctor` anytime you're unsure what's wrong.

## Journey A: Connect Your AI Agent

Once the addon is installed and `nexus doctor` shows green:

```bash
nexus mcp setup
```

Select your AI agent (Claude Code, Claude Desktop, Cursor, Windsurf, etc.) and the command writes the MCP configuration. No restart required for Claude Code — it picks up the new server immediately.

**Test it:** Ask Claude "list my WordPress sites" — it should return your real site list.

## Journey B: AI Features in WordPress

### 1. Configure API Keys

1. Click **Nexus AI** in Local's sidebar
2. Go to **Settings** tab
3. Add your API keys:
   - **Anthropic (Required):** Get from [console.anthropic.com](https://console.anthropic.com)
   - **OpenAI (Optional):** Get from [platform.openai.com](https://platform.openai.com/api-keys)
   - **Google (Optional):** Get from [console.cloud.google.com](https://console.cloud.google.com)

**Security:** API keys are stored locally in Local's encrypted storage and never leave your machine.

### 2. Enable AI Gateway (Optional but Recommended)

The AI Gateway routes all AI requests through Local for centralized tracking and cost control.

1. In **Settings**, toggle **Enable AI Gateway**
2. Set rate limits (optional):
   - Requests per hour: 100 (default)
   - Requests per day: 1000 (default)
   - Cost per day: $10.00 (default)

### 3. WP Engine Integration (Optional)

If you're a WP Engine customer:

**OAuth Login (for listing sites, pulling/pushing):**
1. Open Local's Nexus AI Preferences
2. Click **Authenticate with WP Engine** — a browser window opens
3. Complete login and return to Local

**API Credentials (required for backup creation):**

WP Engine's backup endpoint requires basic auth, not OAuth. Store credentials once in Preferences:

1. Go to **Nexus AI Preferences → WP Engine API Credentials**
2. Enter your API username and password from [my.wpengine.com](https://my.wpengine.com)
3. Click **Apply**

Or via CLI: `nexus wpe set-credentials <username> <password>`

**Security:** All credentials are encrypted using OS-level encryption (Keychain on macOS).

## Your First AI-Enabled Site

### Quick Setup

1. Right-click any WordPress site in Local
2. Select **Setup AI**
3. Wait for installation (30-60 seconds)
4. Site is now AI-ready!

### What Gets Installed

Setup AI installs:
- **WordPress AI 7.0+** (core AI functionality)
- **Nexus AI Connector** (tracks events, routes AI through gateway)
- **Local Gateway Provider** (if gateway enabled)
- **ACF Mu-Plugin** (optional, for ACF integration)

### Manual Verification

1. Start the site
2. Open WordPress admin
3. Go to **AI → Generate Text**
4. Test AI generation
5. View usage in **Nexus AI → Overview**

## Configuring AI

### Global AI Provider (Default)

The global provider applies to all sites that haven't been configured individually:

1. Go to **Nexus AI → Preferences → AI Provider**
2. Select your default provider (Anthropic, OpenAI, Google, or Ollama)
3. Ensure the corresponding API key is saved in **Settings**

### Per-Site AI Provider

Each site can use a different AI provider, set during Setup AI or changed later:

1. Open the site card in Local's site list
2. Under **Nexus AI**, click **Switch Provider**
3. Choose the provider for that site
4. Credentials are automatically synced if the site is running

Alternatively, select the provider during **Setup AI**:
- Right-click the site → **Setup AI** → choose provider from the dropdown

### Local AI Gateway

The Local AI Gateway routes all site AI requests through Local for centralized tracking and cost control. It is a **routing layer**, not a selectable provider:

1. Enable it in **Settings → AI Gateway → Enable**
2. All sites using the gateway will have their requests logged in the **Overview** panel
3. Set rate limits per hour, per day, or by cost to prevent overspending

The gateway is separate from the per-site provider — a site can use Anthropic via the gateway, which means Local proxies the Anthropic request and logs the usage.

---

## Common Workflows

### Generate AI Content

In WordPress admin:
1. **AI → Generate Text**
2. Enter prompt: "Write a blog post about..."
3. Select model (Haiku, Sonnet, Opus)
4. Click **Generate**
5. View result

### Monitor Usage

In Local's Nexus AI panel:
1. **Overview → AI Gateway Usage**
2. See requests, tokens, cost
3. Filter by time (1h, 24h, 7d, All)
4. See which plugins are using AI (**By Caller** panel)

### Manage Multiple Sites (Fleet)

1. **Fleet Overview** panel
2. See all local + remote (WPE) sites
3. Create **Site Groups** for organization
4. Use **Bulk Operations** to setup AI on many sites

### Search Content

1. **Content Browser** panel
2. Enter semantic search query
3. Search across all indexed sites
4. View results with context

## Verifying Your Setup

Run `nexus doctor` at any time for a full health check:

```bash
nexus doctor          # human-readable
nexus doctor --json   # machine-readable (for scripting)
```

It checks: Local running, addon active, version match, GraphQL connected, MCP server, AI agent config, provider + API key, gateway, and site count. Every warning includes the exact next step to fix it.

## Troubleshooting

### "Setup AI Failed"

**Cause:** Site not running or unhealthy
**Fix:**
1. Start the site in Local
2. Check site health (green light in Local)
3. Try Setup AI again

### "AI Requests Not Tracked"

**Cause:** Gateway not configured or MU plugin missing
**Fix:**
1. Check **Settings → AI Gateway** is enabled
2. Run Setup AI again on the site
3. Verify `/wp-content/mu-plugins/nexus-ai-connector-config.php` exists

### "NODE_MODULE_VERSION Mismatch"

**Cause:** better-sqlite3 compiled for wrong Node version
**Fix:**
1. Run `npm run rebuild` in terminal (from addon directory)
2. Restart Local
3. Reload addon

### "Rate Limit Exceeded"

**Cause:** Site exceeded configured rate limits
**Fix:**
1. Check **Settings → AI Gateway → Rate Limits**
2. Increase limits or wait for reset
3. Review which plugins are making excessive requests (**By Caller** panel)

## Next Steps

- [AI Gateway Guide](./ai-gateway.md) - Deep dive on usage tracking
- [Fleet Management](./fleet-management.md) - Managing multiple sites
- [Content Browser](./content-browser.md) - Semantic search
- [Troubleshooting](./troubleshooting.md) - Common issues

## Getting Help

- **Documentation:** [Full docs](../README.md)
- **Issues:** [GitHub Issues](https://github.com/wpengine/local-addon-nexus-ai/issues)
- **Local Support:** [Local Support](https://localwp.com/help/)

## Security Best Practices

1. **Never commit API keys** to Git
2. **Use separate keys** for development vs production
3. **Monitor costs** regularly in the dashboard
4. **Set rate limits** to prevent accidental overspending
5. **Lock your laptop** when away (keys stored locally)
