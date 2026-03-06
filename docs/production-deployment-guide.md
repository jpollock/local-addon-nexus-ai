# Production Deployment Guide

How to deploy AI-configured WordPress sites from Local to production on WP Engine.

## Overview

The Nexus AI addon configures WordPress sites running natively on localhost with AI capabilities. Some of those capabilities are local-only, so deploying to production requires a few adjustments. This guide walks through what transfers, what does not, and how to get AI working on a production WP Engine environment.

---

## Bundled Plugins

The addon bundles three WordPress plugins, installed and activated by the "Setup AI" button:

| Plugin | Purpose |
|---|---|
| `ai` (AI Experiments) | WordPress's experimental AI features. Works with any compatible AI service provider. |
| `ai-provider-for-ollama` | Registers Ollama as a WordPress AI service provider. Hardcoded to `http://localhost:11434/v1`. |
| `nexus-ai-connector` | Sends WordPress events (plugin activations, content changes) back to the Local addon. |

"Setup AI" also enables AI experiments, syncs API keys to the WordPress database, and enables ACF abilities via an mu-plugin.

### How API Keys Are Stored

API keys are synced to WordPress via the `wp_options` table (option name: `nexus_ai_credentials`) using the Connector Screen API introduced in WordPress 7.0+.

---

## What Transfers When Pushing to WP Engine

When you use Local's "Push to WP Engine" feature:

**Transfers successfully:**

- Plugin files (`wp-content/plugins/`) -- all three bundled plugins transfer.
- Database (`wp_options`) -- synced API keys transfer **if "Include database" is checked** during the push.
- mu-plugins (including the ACF abilities enabler) -- transfers with file push.

**Does NOT work on production:**

- **`ai-provider-for-ollama`** -- This plugin connects to `http://localhost:11434`. Ollama is not available on WP Engine servers, so this plugin will not function in production.
- **`nexus-ai-connector`** -- This plugin sends events to localhost. It will not function on a remote server.
- **The AI proxy** -- The proxy runs inside Local on your machine. It is not available on production.

---

## Production AI Setup

WordPress AI features work on production when backed by cloud providers instead of Ollama.

On production, use cloud AI providers such as OpenAI or Anthropic. Configure their API keys either through the WordPress admin (Settings > AI) or via the WP Engine Connector Screen. The `ai` plugin is fully functional on production with cloud-based API keys.

Deactivate `ai-provider-for-ollama` on production. It is a local-only plugin and serves no purpose on a remote server.

---

## Step-by-Step Deployment

### 1. Set up AI locally

Click the "Setup AI" button in the Nexus AI addon panel for your site. This installs and activates the three plugins, enables AI experiments, syncs API keys, and enables ACF abilities.

### 2. Configure cloud provider API keys

In the Nexus AI addon preferences, configure API keys for cloud providers (OpenAI, Anthropic, etc.). These keys will be synced to the WordPress database and can be transferred during a push.

### 3. Push to WP Engine

Use Local's "Push to WP Engine" to deploy your site. Check **"Include database"** if you want your API keys and AI settings to transfer automatically.

### 4. Deactivate local-only plugins on production

Log in to the WordPress admin on your production environment and deactivate:

- `ai-provider-for-ollama` (connects to localhost -- will not work on WPE servers)

Optionally deactivate `nexus-ai-connector` as well, since it sends events to localhost.

### 5. Configure cloud API keys on production (if needed)

If you did not push the database, or if you need to use different keys on production:

- Go to **Settings > AI** in the WordPress admin.
- Enter your cloud provider API keys (OpenAI, Anthropic, etc.).
- Alternatively, configure keys via the WP Engine Connector Screen.

### 6. Verify AI features

Confirm that AI features are working in the WordPress admin. Test content generation or other AI-powered functionality to ensure your cloud provider keys are active.

---

## FAQ

### Will my local AI setup break if I push to production?

No. Pushing to WP Engine copies files and (optionally) the database to the remote environment. Your local site remains unchanged.

### Do I need to deactivate ai-provider-for-ollama before pushing?

No. You can push with all plugins active. Just deactivate `ai-provider-for-ollama` on the production environment after pushing. It will not cause errors on production -- it simply cannot reach Ollama at `localhost:11434`.

### Will my API keys transfer automatically?

Yes, if you check "Include database" during the push. API keys are stored in `wp_options` as `nexus_ai_credentials` and will be included in the database transfer.

### Can I use Ollama on WP Engine production servers?

No. WP Engine production servers do not run Ollama. Use cloud AI providers (OpenAI, Anthropic) for production AI features.

### What happens to the nexus-ai-connector plugin on production?

It will attempt to send events to localhost, which will fail silently. It is safe to leave active but recommended to deactivate since it serves no purpose on a remote server.

### Does the ai plugin work on production?

Yes. The `ai` (AI Experiments) plugin works on any WordPress environment as long as a compatible AI service provider is configured with valid API keys. On production, use cloud providers instead of Ollama.

### Do I need to re-enable ACF abilities on production?

No. The ACF abilities mu-plugin transfers with the file push and will be active on production automatically.

### What if I want different API keys on production vs local?

Push without including the database, then configure production-specific API keys in the WordPress admin (Settings > AI) or via the WP Engine Connector Screen.
