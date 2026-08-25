---
title: CLI Command Reference
description: Every nexus CLI command, generated from the CLI source (2026-08-25)
keywords: [cli, commands, reference, nexus]
---

# CLI Command Reference

The complete `nexus` command surface — **22 top-level commands**, regenerated
from `src/cli/` on 2026-08-25. Run any command with `--help` for its flags;
most support `--json` for scripting.

```bash
nexus --help          # top-level list
nexus <cmd> --help    # subcommands and flags
```

**Target syntax** used throughout: local sites by name (`mysite`), WP Engine
installs as `wpe:<account>/<install>@<environment>` (or a bare install name),
external SSH hosts as `ssh:<alias>/<site>@<environment>`. A bare name that
exists in more than one source is declined with the disambiguated forms —
copy one back in.

---

## Health & setup

### `nexus doctor`

Check system health and show setup status. **Run this first** — every ⚠️/❌
prints the exact command that fixes it.

### `nexus troubleshoot`

Diagnose and recover from common Nexus AI issues.

### `nexus update`

Update the CLI to the latest version.

### `nexus mcp` — MCP server management

| Subcommand | What it does |
|---|---|
| `status` | Show MCP server status and connection info |
| `setup` | Generate or write MCP config for your AI agent |

### `nexus skills`

| Subcommand | What it does |
|---|---|
| `setup` | Install Nexus CLI skills into `~/.claude/skills/` |
| `list` | List installed Nexus skills |

---

## Sites

### `nexus sites` — Local and WPE sites

| Subcommand | What it does |
|---|---|
| `list` | List all sites (local + WPE) |
| `get <site>` | Detailed information about a site |
| `create` / `delete` | Create / delete a local site |
| `start` / `stop` / `restart` | Lifecycle for a local site |
| `clone` / `rename` | Clone or rename a site |
| `export` / `import` | Archive round-trip |
| `logs <site>` | View site logs |
| `config-php` | Change PHP version |
| `config-ssl` | Trust the SSL certificate |
| `config-xdebug` | Toggle Xdebug |
| `status <site>` | What cached data exists for a site and how fresh it is |
| `refresh <site>` | Refresh the site's cached data (digital twin) |

### `nexus host` — external SSH hosts

Sites that are neither Local nor WP Engine, reached via a `~/.ssh/config`
alias. Nexus stores no key material and never writes to your server.

| Subcommand | What it does |
|---|---|
| `test <alias>` | Check an SSH host without registering it |
| `add <alias>` | Probe a host, list its WordPress installs, register the ones you pick |
| `list` | List registered external hosts |
| `remove <alias>` | Forget a host (soft-delete) |
| `remove-site` | Forget one site under a connection, keep the rest |
| `refresh <alias>` | Collect WordPress metadata now (read-only) |
| `index <alias>` | Content-index the host now, for semantic search (read-only) |

### `nexus sync` — content between local and WPE

| Subcommand | What it does |
|---|---|
| `pull` | Pull from WPE to local |
| `push` | Push from local to WPE (confirmation required) |
| `history <site>` | View sync history |

---

## WordPress operations

### `nexus wp` — WP-CLI on any target

Works on local sites, WPE installs, and (for 18 of the 22 subcommands)
external SSH hosts. Writes are refused on production environments by default —
grant them in Settings → WPE Access / Operation Permissions.

| Group | Subcommands |
|---|---|
| `plugin` | `list` · `install` · `activate` · `deactivate` · `update` |
| `theme` | `list` · `activate` |
| `core` | `version` · `update` |
| `db` | `export` · `import` · `search-replace` · `scan` · `clean` (dry-run by default) · `report` — scan/clean/report are **local-only** |
| `post` | `create` · `update` · `delete` |
| (direct) | `user-list` · `option-get` · `health` · `users` (graph DB; local-only) |

### `nexus content` — indexing and search

| Subcommand | What it does |
|---|---|
| `index <site>` | Index a site's content (posts, pages, products) for semantic search |
| `search <site> <query>` | Search within one site |
| `search-all <query>` | Search across all indexed sites |
| `structure <site>` | Site file structure |
| `index-status <site>` | Indexing status |
| `list-indexed` | All indexed sites |

### `nexus audit`

| Subcommand | What it does |
|---|---|
| `site <site>` | Comprehensive audit of one WordPress site |
| `plugins` | Fleet-wide plugin audit across running sites |

---

## Fleet

### `nexus fleet` — fleet intelligence

| Subcommand | What it does |
|---|---|
| `properties` | The fleet at the property grain: places, knowledge rungs, ceilings, checked ages |
| `summary` | Fleet-wide summary from the twin cache |
| `health` / `site-health <site>` | Fleet and per-site health |
| `search <q>` / `filter` | Find sites by content or criteria |
| `php <version>` / `wp <version>` | Sites on a specific PHP / WP version |
| `plugins` | Aggregate plugin presence |
| `refresh` | Refresh cached twin data for all sites |
| `compare <a> <b>` | Compare two sites |
| `list` / `create` / `add` / `remove` / `delete` | Site groups |
| `reindex` / `plugin-update` / `health-check` | Bulk operations |

### `nexus pipeline`

| Subcommand | What it does |
|---|---|
| `status` | L2/L3 pipeline coverage per source, latest failures with reasons, 24h history |

### `nexus system`

| Subcommand | What it does |
|---|---|
| `status` | Content index + metadata cache state for all local sites |

---

## WP Engine

### `nexus wpe`

**Accounts, installs, and the platform.**

Authentication: `status` · `login` · `logout`

| Area | Subcommands |
|---|---|
| Accounts | `accounts` · `account <id>` · `limits` · `account-usage` · `portfolio` |
| Installs | `installs` · `install <id>` · `create-install` · `update-install` · `delete-install` · `usage` |
| Sites | `sites` · `site <id>` · `create-site` |
| Users | `users` · `user` · `user-add` · `user-update` · `user-remove` · `user-audit` |
| Domains | `domains` · `domain-add` · `domain-remove` · `domain-check` |
| SSL | `ssl` · `ssl-request` |
| SSH keys | `ssh-keys` · `ssh-key-add` · `ssh-key-remove` |
| Backups | `backup` · `backup-status` · `backup-verify` |
| Ops | `cache` (purge) · `promote` · `diagnose` · `go-live-check` · `fleet-health` · `plugin-diff` · `link` · `changes` |

---

## AI

### `nexus ai`

| Subcommand | What it does |
|---|---|
| `config` | View or configure AI provider settings |
| `models` | List available Ollama models |
| `setup <site>` | Set up AI on a WordPress site |
| `sync-credentials <site>` | Sync AI keys to a site |
| `site-config <site>` / `switch-provider` | Per-site provider |
| `abilities <site>` / `run` | WordPress Abilities API |
| `status` | AI connector status |

### `nexus agent` — autonomous agents

| Subcommand | What it does |
|---|---|
| `list` / `status` | Registered agents and last-run status |
| `run <name>` | Trigger an agent now |
| `logs <name>` | Agent log output |
| `create` / `validate` / `build` | Author a TypeScript agent |
| `install <pkg>` | Install a published agent from npm |
| `emit` | Publish a synthetic event to the agent bus |
| `invoke` | Invoke an agent-contributed tool |
| `push` | Push a remediated sentinel sandbox to WPE production (approval-gated) |

### `nexus gateway`

| Subcommand | What it does |
|---|---|
| `usage` | AI gateway spend by site and model |

### `nexus creds`

| Subcommand | What it does |
|---|---|
| `rotate <provider>` | Rotate a stored provider credential |

---

## Configuration

### `nexus settings`

| Subcommand | What it does |
|---|---|
| `get [key]` | Read settings (dotted paths work: `wpeOperationPermissions.wpcli.production`) |
| `set <key> <value>` | Update a setting — takes effect immediately, no restart |
| `patch <json>` | Update several settings at once |
| `reset` | Revert all settings to defaults (confirmation required) |

### `nexus blueprints`

| Subcommand | What it does |
|---|---|
| `list` | Available Local blueprints |
| `save <site>` | Save a site as a blueprint |

### `nexus reset`

Factory reset — wipe all Nexus AI data as if the addon was just installed.
Confirmation required.

---

## See also

- [CLI Quick Start](../getting-started/cli-quick-start.md)
- [Tool Schemas](../mcp-tools/tool-schemas.md) — the MCP tool surface
- [Permissions & Access Control](permissions-access-control-v2.md) — why a
  write was refused, and how to grant it
