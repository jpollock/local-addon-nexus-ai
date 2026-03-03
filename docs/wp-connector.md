# WP Connector

The WP Connector module bridges Nexus AI with WordPress's native AI capabilities: the Abilities API (WP 6.9+) and the AI Connector Screen (WP 7.0+).

## Overview

| Tool | Purpose | WordPress Version |
|------|---------|-------------------|
| `wp_list_abilities` | Discover registered abilities | 6.9+ |
| `wp_run_ability` | Execute a registered ability | 6.9+ |
| `wp_sync_ai_credentials` | Sync API keys to WordPress | 7.0+ |

All three tools require a running local site (pass the `site` parameter).

## WordPress Abilities API

The Abilities API lets WordPress plugins register capabilities that AI agents can discover and execute. For example, ACF PRO registers abilities like `acf/list-field-groups` and `acf/create-field-group`.

### Discovering Abilities

```
wp_list_abilities  site="my-site"
```

Returns a categorized list of registered abilities with their descriptions, input schemas, and flags (read-only, idempotent).

Filter by category:

```
wp_list_abilities  site="my-site"  category="acf"
```

### Executing Abilities

```
wp_run_ability  site="my-site"  ability="acf/list-field-groups"
```

With input:

```
wp_run_ability  site="my-site"  ability="acf/create-field-group"  input={"title": "Hero Section", "fields": [...]}
```

The tool validates that the ability exists, checks permissions, and returns the result. Errors from WordPress (WP_Error) are surfaced as tool errors.

### Prerequisites

For abilities to appear, the site needs:

1. **WordPress 6.9+** — The Abilities API was introduced in WP 6.9
2. **AI Experiments plugin** — Activates the Abilities API framework
3. **Plugin opt-in** — Individual plugins must register their abilities

For ACF PRO specifically, version 6.8+ is required, plus an opt-in mu-plugin that enables the `acf/abilities/enabled` filter.

## Setup for AI

The "Setup for AI" button in the dashboard's Sites tab automates the prerequisites:

1. **Installs the AI Experiments plugin** (`ai` slug) if not present, or activates it if installed but inactive
2. **Writes an ACF abilities mu-plugin** if ACF PRO >= 6.8 is active on the site

The mu-plugin is a single file at `wp-content/mu-plugins/enable-acf-abilities.php` containing:

```php
<?php
// Enable ACF Abilities API integration
add_filter('acf/abilities/enabled', '__return_true');
```

### What "Setup for AI" Does NOT Do

- It does not expose any new network endpoints
- It does not install itself as an MCP tool (it runs via IPC from the Local UI only)
- It does not modify any existing site content or settings
- It skips the ACF step entirely if ACF PRO is not installed or is below version 6.8

### Result States

| Field | Possible Values |
|-------|----------------|
| `aiPlugin` | `installed` (freshly installed and activated), `activated` (was installed but inactive), `already_active` (no action needed), `failed` |
| `acfAbilities` | `enabled` (mu-plugin written), `already_enabled` (mu-plugin already exists), `skipped` (ACF PRO not present or < 6.8), `failed` |

## AI Credential Sync

`wp_sync_ai_credentials` pushes API keys configured in Local's preferences to a WordPress 7.0+ site's AI Connector Screen.

### How It Works

1. Reads API keys from Local's settings (OpenAI, Anthropic, Google)
2. Maps each key to the corresponding WordPress option:
   - `openai` -> `connectors_ai_openai_api_key`
   - `anthropic` -> `connectors_ai_anthropic_api_key`
   - `google` -> `connectors_ai_google_api_key`
3. Writes each option via `wp option update`, bypassing WP 7.0's validation filter (which would call the provider's API to verify the key)

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `site` | Yes | Site name, ID, or domain |
| `providers` | No | Array of providers to sync (defaults to all configured) |
| `dry_run` | No | Show what would be synced without writing |

### Dry Run

Use `dry_run: true` to preview which keys would be synced:

```
wp_sync_ai_credentials  site="my-site"  dry_run=true
```

Keys are masked in output (only the last 4 characters are shown).

### Auto-Sync

Credential sync runs automatically when a site starts if:
- The site is running WordPress 7.0+
- API keys are configured in Local's Nexus AI preferences

This happens silently in the background. Pre-7.0 sites are skipped without error.

## Security Considerations

See [Security](security.md) for the full security analysis of the WP Connector module, including:
- Why Setup for AI is IPC-only (not MCP-exposed)
- The mu-plugin file write surface
- Credential handling and key masking
