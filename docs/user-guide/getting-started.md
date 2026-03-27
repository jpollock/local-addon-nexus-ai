# Getting Started with Nexus AI

Nexus AI brings AI capabilities to your Local WordPress sites with usage tracking, cost monitoring, and fleet management.

## Installation

### From Local Add-ons Marketplace (Recommended)

1. Open Local by Flywheel
2. Click **Add-ons** in the left sidebar
3. Search for "Nexus AI"
4. Click **Install**
5. Restart Local when prompted

### Manual Installation (Development)

1. Clone the repository
2. Run `npm install && npm run rebuild`
3. In Local: **File → Add Add-on Manually**
4. Select the addon directory
5. Restart Local

## Initial Setup

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

1. Go to **Settings → WP Engine**
2. Add your CAPI credentials:
   - **Username:** Your WPE portal email
   - **Password:** Your WPE portal password
3. **Test Connection** to verify

**Recommended:** Use WPE API tokens (coming soon) instead of password for better security.

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
