# Credential Architecture

## Where credentials live

| Credential | Storage | Notes |
|---|---|---|
| Anthropic / OpenAI / Google API keys | Electron KeyVault (`STORAGE_KEYS.AI_PROVIDER_KEYS`) | Encrypted at rest by OS keychain |
| Per-site AI config (provider, model) | `STORAGE_KEYS.SITE_AI_CONFIG` | Plain JSON in electron-store |
| WPE OAuth token | Electron KeyVault | Short-lived; re-fetched via `wpe_login` |
| WPE basic-auth (backup API) | Electron KeyVault | Set via `wpe_set_api_credentials` |
| Nexus webhook auth token | HttpEventInterface random 32-byte hex; stored in registryStorage | Localhost-only |
| Nexus gateway token | `STORAGE_KEYS.NEXUS_GATEWAY_TOKEN` in registryStorage | Localhost-only |

## Credential flow to WordPress sites

When `setup-ai` runs or a site starts, `installNexusAiConnectorPlugin` writes `nexus-ai-connector-config.php` into `wp-content/mu-plugins/`. This MU plugin defines:

```
NEXUS_AI_WEBHOOK_URL   — http://127.0.0.1:{port}   (where the addon listens)
NEXUS_AI_AUTH_TOKEN    — the webhook auth token
NEXUS_AI_GATEWAY_TOKEN — the Ollama proxy token
NEXUS_AI_SITE_ID       — per-site identifier
NEXUS_AI_PROVIDER      — anthropic | openai | google | ollama
```

These are **localhost-only tokens**, not real API keys. Real API keys never leave the Electron process. The gateway forwards requests to the upstream provider using keys from KeyVault.

## Why no real API keys in WP DB

The gateway (`/ai-gateway/v1/chat/completions`) proxies requests. WordPress sends requests to `http://127.0.0.1:13000/ai-gateway/v1/` authenticated with `X-Auth-Token: NEXUS_AI_AUTH_TOKEN`. The addon validates the token and forwards to Anthropic/OpenAI/Google using the key from KeyVault.

The `connectors_ai_local_gateway_api_key` option written to WP DB is the gateway token (not a real API key). It is used by the WordPress Connectors API credentials check (`has_ai_credentials()`).

## Connector approval bypass

The MU plugin pre-approves known callers (`ai/ai.php`, `ai-provider-for-local-gateway/plugin.php`, `nexus-ai-connector/nexus-ai-connector.php`) via `option_wpai_connector_approvals` filter. This bypasses the WP AI plugin's per-plugin approval gate because the gateway token already provides authentication.

**Security assumption**: this is local development only. The gateway binds to 127.0.0.1 (not 0.0.0.0), so the token cannot be used from other machines.
