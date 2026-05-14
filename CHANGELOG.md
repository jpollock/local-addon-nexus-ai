# Changelog

All notable changes to Nexus AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.1] — 2026-05-14

### Added
- **WP Engine Environment Access Control** — `wpeAllowedEnvironments` setting controls which WPE
  environment types Nexus can access. **Production is excluded by default** — staging and
  development only. Enable production access in Preferences → WP Engine → WP Engine Environment
  Access. Applies to WP-CLI over SSH, content indexing, twin sync, and CAPI write operations
  (`wpe_promote_environment`, `wpe_delete_install`, `wpe_delete_site`, `wpe_update_install`,
  `wpe_purge_cache`).
- **WP Engine Smart Search local backend** — Nexus acts as a local drop-in for the WP Engine
  AI Toolkit (`atlas-search`) plugin. Smart Search, Recommendations, Insights, Tracker, and
  Synonyms all work against LanceDB + ONNX locally — no WPE subscription required for local
  development. Auto-installs `atlas-search` from wordpress.org on AI-configured sites.

### Changed
- Production WPE environments are now excluded from WP-CLI and content sync by default.
  **Existing users:** re-enable production access in Preferences → WP Engine → WP Engine
  Environment Access if needed.

---

## [0.2.2] — 2026-04-12

### Fixed
- `nexus doctor` now runs bootstrap on first run — if the addon is missing it downloads and
  installs it before reporting health status. Previously doctor was in the bootstrap skip list,
  so `npm install -g` + `nexus doctor` would report the addon as missing but never install it.

## [0.2.1] — 2026-04-11

### Added
- **`nexus doctor`** — system health check and first-run orientation. Checks Local,
  addon, GraphQL, MCP server, AI agent config, provider + API key, gateway, and site
  count in a single command. Every warning includes the exact next step to fix it.
  `--json` flag for machine-readable output. Run this first when anything is broken.
- **Multi-provider AI Gateway** — the gateway now routes requests to Anthropic or OpenAI
  based on model ID (`claude-*` → Anthropic, `gpt-*` → OpenAI) with a clean `MODEL_PROVIDER_MAP`
  registry. Unknown model IDs fall back to the globally configured provider.
- **Real-time provider switching** — changing the AI provider in Preferences immediately
  updates all running gateway sites: rewrites the MU plugin with the new `NEXUS_AI_PROVIDER`
  constant and refreshes the site info panel without requiring a site restart.
- **AI Gateway usage panel** — combined tabbed view (Requests | By Caller) replaces the two
  stacked panels. Single IPC fetch, shared time filter, trend indicators (↑/↓ % vs previous
  period), and proper column alignment.
- `NEXUS_AI_PROVIDER` PHP constant in the MU plugin template — tells the
  `ai-provider-for-local-gateway` plugin which models to advertise to WordPress.
- Webhook auth token persisted to disk (`http_webhook_auth_token`) — survives Local restarts
  so the MU plugin credentials don't go stale.
- Site info panels (`SiteNexusSection`, `NexusSiteTab`) now listen for
  `nexus-ai:settings-applied` DOM event and refresh immediately after Preferences → Apply.

### Changed
- **Gateway auth flow** — `/ai-gateway/v1/*` routes now bypass the webhook Bearer auth gate
  (they have their own `X-Auth-Token` validation). Auth token validated against
  `http_webhook_info.authToken`; site ID resolved from `X-WP-Site-ID` header validated
  against the index registry (prevents spoofing).
- `applyGatewayChange` — now handles provider-only changes on gateway sites without swapping
  WordPress plugins. Only the MU plugin and stored config are updated.
- `autoSyncCredentials` and `broadcastKeyChange` — both skip sites with `useLocalGateway: true`;
  gateway credentials live in Local's Node.js process, not the WordPress database.
- `LocalGatewayProvider::baseUrl()` — now uses `NEXUS_AI_WEBHOOK_URL` (port ~13000, the real
  gateway server) instead of `NEXUS_AI_GATEWAY_URL` (port ~13100, the Ollama proxy).
- `LocalGatewayProviderAvailability::isConfigured()` — pings `NEXUS_AI_WEBHOOK_URL/health`;
  result cached per-request to avoid repeated HTTP round-trips on each page load.
- `LocalGatewayModelMetadataDirectory` — returns models for the configured provider
  (`NEXUS_AI_PROVIDER`) rather than a hardcoded Claude list.
- `LocalGatewayTextGenerationModel` — sends `X-Auth-Token: NEXUS_AI_AUTH_TOKEN` and
  `X-WP-Site-ID: NEXUS_AI_SITE_ID` headers; uses `http_request_args` filter (not
  `pre_http_request`) for injecting caller tracking headers.
- Model routing uses `MODEL_PROVIDER_MAP` registry (exact match) instead of fragile
  `model.startsWith('claude')` / `model.startsWith('gpt')` prefix heuristics.
- `getSiteName()` in `AIGatewayRoutes` reads from the index registry instead of the
  unpopulated `nexus_ai_gateway_tokens` storage.
- Dashboard layout overhauled — each tab scrolls independently with no double-scroll;
  Activity tab timeline fills its grid cell height; EventTimeline and AIGatewayPanel
  use plain scrollable divs instead of fixed-height `react-window` lists.
- Tokens column in the Requests table fixed to 150px (was `flex: 1`, causing a ~440px gap).

### Fixed
- `LocalGatewayProviderAvailability` was pinging the wrong server (`localhost:52847` fallback
  or the Ollama proxy port) causing `isProviderConfigured()` to always return false.
- Caller headers (`X-WP-Caller-Plugin`, etc.) were silently dropped because the MU plugin
  used `pre_http_request` (a preemption filter) instead of `http_request_args` (which
  returns the modified args to WordPress).
- `nexus_lg_is_gateway_url()` now matches `NEXUS_AI_WEBHOOK_URL/ai-gateway/` paths so
  WordPress allows localhost requests to the real gateway server.
- Provider switching on a gateway site no longer tries to deactivate/activate direct
  provider plugins (`ai-provider-for-openai`, `ai-provider-for-anthropic`) — the WordPress
  plugin stays as `ai-provider-for-local-gateway`.
- `nexus-ai-connector` admin settings page no longer shows "Coming soon" for plugin and
  theme events — all 14 event types have been supported since v0.1.
- Removed debug `error_log()` calls from `plugin.php`, `LocalGatewayProvider.php`, and
  `LocalGatewayTextGenerationModel.php` that were logging on every WordPress request.

### Security
- `X-WP-Site-ID` header is now validated against the index registry before being accepted
  as a site identifier — prevents a site with valid auth from attributing requests to
  another site.

---

## [0.2.0] — 2025-04-07

### Added
- Per-site AI provider configuration (`SiteAIConfig`)
- Local AI Gateway (`ai-provider-for-local-gateway`) for centralized credential management
- MCP tools: `wp_setup_ai`, `nexus_switch_provider`, `nexus_sync_credentials`, `nexus_get_site_ai_config`
- AI Gateway usage tracking with cost calculation (Anthropic pricing)
- AI Gateway rate limiting per site
- `broadcastKeyChange` — live credential sync to all running sites when API key changes
- WPE CAPI integration (accounts, installs, domains, SSL, backups)
- Database health scanner (`scan_database_health`, `get_database_recommendations`)
- Site metadata digital twin (WP version, plugins, themes cached per site)
- WPE site sync with drift detection

### Changed
- `autoSyncCredentials` is now per-site (reads `SiteAIConfig.provider`)
- Setup AI installs the provider plugin matching global provider setting
- `switch-provider` handles live provider transitions without site restart

---

## [0.1.0] — 2025-03-15

Initial release.

### Added
- Content indexing with vector embeddings (ONNX)
- MCP server with tools: `search_site_content`, `get_site_structure`, `fleet_summary`, etc.
- WordPress event tracking via `nexus-ai-connector` plugin (posts, plugins, themes, users)
- Ollama integration for local AI
- Site finder with natural language queries
- CLI: `nexus search`, `nexus index`, `nexus setup`, `nexus update`
