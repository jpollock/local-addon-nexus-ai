---
title: CLI Command Reference
description: Complete command tree for the Nexus AI CLI — every command and subcommand with one-line descriptions
keywords: [cli, commands, reference, command tree]
---

# CLI Command Reference

This page is the map. Every `nexus` command is listed here with a one-line description and a link to the relevant guide. For flags and examples, follow the links.

## Target Syntax

Two target formats are used throughout the CLI:

| Format | Example | Used for |
|--------|---------|----------|
| `name@local` | `mysite@local` | Local sites managed by Local app |
| `wpe:account/install@env` | `wpe:acmeco/myblog@production` | WP Engine installs |

Environments: `production`, `staging`, `development`

---

## Top-Level Commands

| Command | Description |
|---------|-------------|
| `nexus doctor` | Check system health and show setup status |
| `nexus update` | Update the CLI to the latest version |
| `nexus list` | List all local and WP Engine sites (shorthand for `nexus sites list`) |
| `nexus scan` | Scan sites into the vector index |
| `nexus search <query>` | Semantic search across indexed sites |

---

## `nexus doctor`

Check system health and show setup status. Run this first when something is broken.

```bash
nexus doctor
nexus doctor --json
```

Checks: Local installed, Local running, addon active, version match, GraphQL server, MCP server, AI agent config, AI provider, Local Gateway, sites with AI configured.

Each failing check prints the exact command to fix it.

---

## `nexus update`

Update the CLI to the latest version via npm.

```bash
nexus update           # Install latest
nexus update --check   # Show available version without installing
```

---

## `nexus sites` — Local Site Management

[Full documentation](./local-sites.md)

| Command | Description |
|---------|-------------|
| `nexus sites list` | List all local sites and linked WPE installs |
| `nexus sites get <site>` | Get detailed info about a site |
| `nexus sites create <name>@local` | Create a new local site |
| `nexus sites start <site>@local` | Start a halted site |
| `nexus sites stop <site>@local` | Stop a running site |
| `nexus sites restart <site>@local` | Restart a site |
| `nexus sites delete <site>@local` | Delete a site permanently |
| `nexus sites clone <source>@local <newName>` | Clone a site |
| `nexus sites rename <site>@local <newName>` | Rename a site |
| `nexus sites export <site>@local [path]` | Export site to a zip archive |
| `nexus sites import <archivePath>` | Import a site from a zip archive |
| `nexus sites logs <site>@local` | View site logs |
| `nexus sites config-php <site>@local <version>` | Change PHP version |
| `nexus sites config-ssl <site>@local` | Trust SSL certificate |
| `nexus sites config-xdebug <site>@local` | Enable or disable Xdebug |

**Key flags for `sites list`:** `--local-only`, `--wpe-only`, `--json`

**Key flags for `sites create`:** `--blueprint <name>`, `--php <version>`, `--wp <version>`

**Key flags for `sites delete`:** `--force` (skip confirmation)

---

## `nexus wpe` — WP Engine Management

[Full documentation](./wpe-sites.md) | [Authentication](./authentication.md)

### Authentication

| Command | Description |
|---------|-------------|
| `nexus wpe login` | Authenticate with WP Engine (opens browser) |
| `nexus wpe logout` | Log out of WP Engine |
| `nexus wpe status` | Show authentication status |
| `nexus wpe set-credentials <user> <pass>` | Store API credentials for backup creation |
| `nexus wpe credentials-status` | Check whether API credentials are configured |
| `nexus wpe clear-credentials` | Remove stored API credentials |

### Accounts

| Command | Description |
|---------|-------------|
| `nexus wpe accounts` | List all WP Engine accounts |
| `nexus wpe account <accountId>` | Get details about an account |
| `nexus wpe limits <accountId>` | Show plan limits for an account |
| `nexus wpe users <accountId>` | List users on an account |
| `nexus wpe user <accountId> <userId>` | Get details about a specific user |
| `nexus wpe user-add <accountId>` | Add a user to an account |
| `nexus wpe user-update <accountId> <userId>` | Update a user's role |
| `nexus wpe user-remove <accountId> <userId>` | Remove a user from an account |
| `nexus wpe user-audit` | Audit users across all accounts |

### Sites and Installs

| Command | Description |
|---------|-------------|
| `nexus wpe sites` | List WP Engine sites (top-level groupings) |
| `nexus wpe site <siteId>` | Get details about a WP Engine site |
| `nexus wpe create-site` | Create a new WP Engine site |
| `nexus wpe installs [account]` | List installs for all or one account |
| `nexus wpe install <installId>` | Get details about a specific install |
| `nexus wpe create-install` | Create a new install under a site |
| `nexus wpe update-install <installId>` | Update install settings (PHP, environment) |
| `nexus wpe delete-install <installId>` | Delete an install |

### Usage Metrics

| Command | Description |
|---------|-------------|
| `nexus wpe usage <installId>` | Bandwidth, storage, visits for an install |
| `nexus wpe account-usage <accountId>` | Rolled-up usage for an account |
| `nexus wpe portfolio` | Portfolio overview across all accounts |

### Backups

| Command | Description |
|---------|-------------|
| `nexus wpe backup <target>` | Create a backup |
| `nexus wpe backup-status <installId> <backupId>` | Check backup status |
| `nexus wpe backup-verify <installId>` | Create backup and poll until complete |

### Domains

| Command | Description |
|---------|-------------|
| `nexus wpe domains <installId>` | List domains on an install |
| `nexus wpe domain-add <installId> <domain>` | Add a domain |
| `nexus wpe domain-remove <installId> <domainId>` | Remove a domain |
| `nexus wpe domain-check <installId> <domainId>` | Check DNS status for a domain |

### SSL

| Command | Description |
|---------|-------------|
| `nexus wpe ssl <installId>` | List SSL certificates on an install |
| `nexus wpe ssl-request <installId>` | Request SSL provisioning |

### SSH Keys

| Command | Description |
|---------|-------------|
| `nexus wpe ssh-keys` | List SSH keys on your account |
| `nexus wpe ssh-key-add` | Add an SSH public key |
| `nexus wpe ssh-key-remove <keyId>` | Remove an SSH key |

### Operations

| Command | Description |
|---------|-------------|
| `nexus wpe promote <sourceId> <destId>` | Copy one install to another |
| `nexus wpe cache <target> --purge` | Purge install cache |
| `nexus wpe diagnose <installId>` | Diagnostic check on an install |
| `nexus wpe go-live-check <installId> <domain>` | Check go-live readiness |
| `nexus wpe fleet-health` | SSL and environment status for all installs |
| `nexus wpe link <site>@local <wpeTarget>` | Link a local site to a WPE install |
| `nexus wpe changes <site>@local` | View file differences between local and WPE |

---

## `nexus sync` — Pull and Push

[Full documentation](./wpe-sites.md#pull-and-push)

| Command | Description |
|---------|-------------|
| `nexus sync pull <site>@local --from <wpeTarget>` | Pull from WPE to local |
| `nexus sync push <site>@local --to <wpeTarget>` | Push from local to WPE |
| `nexus sync history <site>@local` | View sync history for a site |

**Key flags for `pull`:** `--db-only`, `--files-only`

**Key flags for `push`:** `--db`, `--db-only`, `--files-only`, `--create`

---

## `nexus wp` — WordPress and WP-CLI

Run WP-CLI commands on local or WP Engine sites.

### Plugins

| Command | Description |
|---------|-------------|
| `nexus wp plugin list <target>` | List plugins on a site |
| `nexus wp plugin install <target> <slug...>` | Install one or more plugins |
| `nexus wp plugin activate <target> <slug...>` | Activate plugins |
| `nexus wp plugin deactivate <target> <slug...>` | Deactivate plugins |
| `nexus wp plugin update <target> [slug...]` | Update plugins |

**Key flags:** `--status <status>` (list), `--activate` (install), `--all` (update), `--dry-run` (update)

### Themes

| Command | Description |
|---------|-------------|
| `nexus wp theme list <target>` | List themes |
| `nexus wp theme activate <target> <slug>` | Activate a theme |

### Core

| Command | Description |
|---------|-------------|
| `nexus wp core version <target>` | Get WordPress version |
| `nexus wp core update <target>` | Update WordPress core |

**Key flag for update:** `--version <version>`

### Database

| Command | Description |
|---------|-------------|
| `nexus wp db export <target> [output]` | Export database to a file |
| `nexus wp db import <target> <file>` | Import database from a file |
| `nexus wp db scan <target>` | Scan for bloat and health issues |
| `nexus wp db clean <target>` | Clean database bloat (dry-run by default) |
| `nexus wp db report` | Fleet database health report for all running sites |
| `nexus wp db search-replace <target> <from> <to>` | Search and replace in database |

**Key flags for `db scan`:** `--json`

**Key flags for `db clean`:** `--no-dry-run` (apply changes), `--items <types>`

**Key flags for `db search-replace`:** `--dry-run`, `--all-tables`

### Posts

| Command | Description |
|---------|-------------|
| `nexus wp post create <target>` | Create a post |
| `nexus wp post update <target> <id>` | Update a post |
| `nexus wp post delete <target> <id>` | Delete a post |

**Required flag for create:** `--title <title>`

### Utilities

| Command | Description |
|---------|-------------|
| `nexus wp user-list <target>` | List WordPress users |
| `nexus wp option-get <target> <key>` | Get a WordPress option value |
| `nexus wp health <target>` | Check site health |

---

## `nexus ai` — AI Configuration and Connector

| Command | Description |
|---------|-------------|
| `nexus ai config` | View or interactively configure AI provider settings |
| `nexus ai models` | List available Ollama models |
| `nexus ai setup <site>` | Install and configure the AI connector on a WordPress site |
| `nexus ai status <target>` | Show AI connector status on a site |
| `nexus ai site-config <site>` | Show which AI provider is configured for a site |
| `nexus ai switch-provider <site>` | Interactively switch AI provider on a configured site |
| `nexus ai sync-credentials <site>` | Sync AI API credentials to a WordPress site |
| `nexus ai abilities <target>` | List AI abilities available on a site |
| `nexus ai run <target> <ability>` | Run an AI ability on a site |

**Key flags for `ai config`:** `--gateway on|off` (toggle Local AI Gateway non-interactively)

**Key flags for `ai setup`:** `--provider <id>` (skip interactive prompt), `--force`

**Key flags for `ai run`:** `--params <json>`, `--json`

Supported providers: `anthropic`, `openai`, `google`, `ollama`

---

## `nexus mcp` — MCP Server

| Command | Description |
|---------|-------------|
| `nexus mcp status` | Show MCP server status, URL, port, and tool count |
| `nexus mcp setup` | Generate or write MCP config for your AI agent |

**Key flags for `mcp setup`:** `--agent <name>`, `--write`

Supported agents: `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `cline`, `gemini`

Without `--write`, the command prints the config snippet to paste manually.

---

## `nexus fleet` — Fleet Intelligence

| Command | Description |
|---------|-------------|
| `nexus fleet health` | Overall health summary across all local sites |
| `nexus fleet site-health <target>` | Detailed health for one site |
| `nexus fleet search <query>` | Semantic search across all indexed sites |
| `nexus fleet filter` | Filter sites by status, plugin, WP version |
| `nexus fleet compare <target1> <target2>` | Compare two sites |

**Key flags for `fleet filter`:** `--status <status>`, `--plugin <slug>`, `--wp-version <version>`, `--linked`

### `nexus fleet groups` — Site Groups

| Command | Description |
|---------|-------------|
| `nexus fleet groups list` | List all site groups |
| `nexus fleet groups create <name>` | Create a new group |
| `nexus fleet groups add <group> <sites...>` | Add sites to a group |
| `nexus fleet groups remove <group> <sites...>` | Remove sites from a group |
| `nexus fleet groups delete <group>` | Delete a group |

### `nexus fleet bulk` — Bulk Operations

| Command | Description |
|---------|-------------|
| `nexus fleet bulk reindex <targets...>` | Reindex multiple sites |
| `nexus fleet bulk plugin-update <targets...>` | Update plugins across multiple sites |
| `nexus fleet bulk health-check <targets...>` | Run health check across multiple sites |

**Key flags for `bulk plugin-update`:** `--plugin <slug>`, `--all`, `--dry-run`

---

## `nexus audit` — Site and Plugin Audits

| Command | Description |
|---------|-------------|
| `nexus audit site <target>` | Comprehensive audit: plugins, themes, health, security |
| `nexus audit plugins` | Fleet-wide plugin audit across all running sites |

**Key flags for `audit plugins`:** `--filter-outdated` (show only sites with updates)

---

## Global Flags

These flags are available on most commands:

| Flag | Description |
|------|-------------|
| `--json` | Output machine-readable JSON |

---

## Getting Help

```bash
# Show all top-level commands
nexus --help

# Show subcommands for a group
nexus sites --help
nexus wpe --help
nexus wp --help

# Show flags for a specific command
nexus sites create --help
nexus wpe backup --help
```
