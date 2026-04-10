# WP Engine Management — User Guide

## Overview

Nexus AI gives AI agents and the CLI direct access to WP Engine's Customer API (CAPI) — accounts, installs, domains, SSL, users, backups, offload settings, SSH keys, and more. You can query, create, and manage your entire WP Engine fleet without leaving your development workflow.

There are two interfaces:

- **MCP tools** (`wpe_*` tools) — used by AI agents (Claude, etc.) connected to Local via MCP
- **CLI commands** (`nexus wpe ...`) — used directly from a terminal

Both interfaces require Local to be running. The CLI talks to Local's addon GraphQL server; MCP tools are served by the addon's MCP layer. Authentication state is shared between both.

---

## Authentication

All WPE management tools require an active OAuth token. OAuth is initiated through Local's built-in WP Engine connection flow and stored by Local. The addon reads this token from Local when it needs to make API calls.

A second credential type — Basic Auth (username + password) — is required specifically for backup creation because WP Engine's backup endpoint does not accept OAuth tokens. These are stored separately and encrypted.

### Checking auth state

```bash
nexus wpe status
```

MCP tool: `wpe_status`

Shows whether you are authenticated, and which account and email you are operating as. Also validates the token against the live API — if the token has expired it tells you to re-login rather than silently returning empty results.

### Logging in

```bash
nexus wpe login
```

MCP tool: `wpe_login`

Opens a browser window for the WP Engine OAuth flow. The CLI polls until login is confirmed (up to 3 minutes). Complete the login in the browser, then return to your terminal.

### Logging out

```bash
nexus wpe logout
```

MCP tool: `wpe_logout`

### Checking which account you are operating as

MCP tool: `wpe_get_current_user`

Returns your WP Engine user profile — email, name, and account.

### API credentials for backups

Backup creation requires a separate set of API credentials (the username and password from `https://my.wpengine.com`, under your user profile's API access section).

```bash
# Store credentials
nexus wpe set-credentials <username> <password>

# Check if credentials are configured
nexus wpe credentials-status

# Remove credentials
nexus wpe clear-credentials
```

MCP tools: `wpe_set_api_credentials`, `wpe_credentials_status`, `wpe_clear_api_credentials`

The CLI command accepts the credentials as positional arguments. Credentials are stored encrypted in Local's data directory and are not visible after being set (only the username is echoed back by `credentials-status`).

---

## Account and User Management

### Listing accounts

```bash
nexus wpe accounts
nexus wpe accounts --json
```

MCP tool: `wpe_get_accounts`

Returns all WP Engine accounts accessible to the authenticated user.

### Single account details

```bash
nexus wpe account <accountId>
```

MCP tool: `wpe_get_account`

### Plan limits

```bash
nexus wpe limits <accountId>
```

MCP tool: `wpe_get_account_limits`

Shows plan limits for an account — bandwidth caps, install limits, storage quotas, etc.

### Portal users

WP Engine portal users are the people who have access to your WP Engine account (not WordPress site users). These are managed through the WP Engine user portal.

```bash
# List users
nexus wpe users <accountId>

# Get a specific user
nexus wpe user <accountId> <userId>

# Add a user
nexus wpe user-add <accountId> --email <e> --first <f> --last <l> --role <r>

# Update a user's role
nexus wpe user-update <accountId> <userId> --role <role>

# Remove a user (requires confirmation flag)
nexus wpe user-remove <accountId> <userId> --confirm
```

MCP tools: `wpe_get_account_users`, `wpe_get_account_user`, `wpe_create_account_user`, `wpe_update_account_user`, `wpe_delete_account_user`, `wpe_add_user_to_accounts`

**Role codes:** WP Engine's API returns single-letter role codes. The addon maps these to human-readable labels:

| API code | Label |
|----------|-------|
| `o` | owner |
| `b` | billing |
| `p` | partial |
| `full` | full |

When adding or updating users, use the label form (e.g. `--role full`).

`wpe_add_user_to_accounts` (MCP only) — adds an existing user to one or more accounts in a single call.

### Cross-account user audit

```bash
nexus wpe user-audit
nexus wpe user-audit --account <accountId>
```

MCP tool: `wpe_user_audit`

Audits all portal users across all of your accounts (or one account if scoped). Returns a table showing each user's email, resolved role labels, which accounts they have access to, and flags for:

- Multi-account users (access to more than one account)
- Elevated roles (owner, billing, or full)

Useful for access reviews and identifying over-privileged users.

---

## Sites and Installs

### Site vs Install distinction

In WP Engine's data model, a **Site** is a container that groups environments. An **Install** is an individual environment — `production`, `staging`, or `development`. Every install belongs to a site.

When creating a new environment, you must either use an existing site or create a new site first.

### Listing and inspecting

```bash
# List all sites
nexus wpe sites
nexus wpe sites --account <accountId>

# Single site
nexus wpe site <siteId>

# List installs (optionally scoped to an account)
nexus wpe installs
nexus wpe installs <accountId>

# Single install
nexus wpe install <installId>
```

MCP tools: `wpe_get_sites`, `wpe_get_site`, `wpe_get_installs`, `wpe_get_install`

The `nexus wpe installs` output includes a target string in `wpe:<account>/<name>@<environment>` format, which can be used with push/pull commands.

### Creating a new environment

Sites and installs must be created in order:

```bash
# Step 1: Create the site container
nexus wpe create-site --name "My New Site" --account <accountId>
# Output: site ID

# Step 2: Create an install inside that site
nexus wpe create-install \
  --site <siteId> \
  --name my-new-site \
  --env production \
  --account <accountId>
```

MCP tools: `wpe_create_site`, `wpe_create_install`

Install names must be lowercase and may contain hyphens. The environment must be `production`, `staging`, or `development`.

### Updating an install

```bash
nexus wpe update-install <installId> --php 8.2
nexus wpe update-install <installId> --env staging
```

MCP tool: `wpe_update_install`

Supports changing the PHP version or environment type. At least one of `--php` or `--env` is required.

### Deleting an install (Tier 3)

```bash
nexus wpe delete-install <installId> --confirm-name <installName>
```

MCP tool: `wpe_delete_install`

Permanently deletes a WP Engine install. This is irreversible.

Safety behavior: when called without `--confirm-name`, the MCP tool (via an AI agent) first shows you what will be deleted — name, environment, domain — and checks for a recent backup. If the last backup is older than 7 days, or there are no backups at all, it warns you before asking for confirmation. The install name must be typed exactly to proceed.

**Always create a backup before deleting.** Use `wpe_backup_and_verify` to create and confirm completion.

### Deleting a site (Tier 3)

MCP tool: `wpe_delete_site`

Deletes the site container and all installs inside it. Requires confirmation.

---

## Domain Management

### Workflow for adding a domain

```bash
# 1. Add the domain
nexus wpe domain-add <installId> example.com
# Output: domain ID

# 2. Check DNS status (poll until resolved)
nexus wpe domain-check <installId> <domainId>

# 3. Request SSL (after DNS resolves)
nexus wpe ssl-request <installId> --domains <domainId>
```

For AI agents, `wpe_prepare_go_live` automates steps 1-3 in a single call — see Fleet Intelligence below.

### Domain tools

```bash
# List all domains on an install
nexus wpe domains <installId>

# Remove a domain (requires --confirm)
nexus wpe domain-remove <installId> <domainId> --confirm
```

MCP tools: `wpe_get_domains`, `wpe_get_domain`, `wpe_create_domain`, `wpe_create_domains_bulk`, `wpe_update_domain`, `wpe_delete_domain`, `wpe_check_domain_status`, `wpe_get_domain_status_report`

`wpe_create_domains_bulk` — add multiple domains to an install in one call.

`wpe_update_domain` — update domain properties, including setting a domain as the primary domain (`primary: true`).

`wpe_delete_domain` is Tier 3 (requires confirmation flag).

---

## SSL Certificates

DNS must resolve to WP Engine before SSL provisioning will succeed. Use `wpe_check_domain_status` first.

```bash
# List SSL certs with expiry info
nexus wpe ssl <installId>

# Request a Let's Encrypt certificate
nexus wpe ssl-request <installId> --domains <domainId1,domainId2>
```

MCP tools:

- `wpe_get_ssl_certificates` — list certificates with expiry dates and the domains they cover
- `wpe_request_ssl_certificate` — request a Let's Encrypt certificate for one or more domain IDs
- `wpe_import_ssl_certificate` — import a custom certificate in PEM format
- `wpe_get_domain_ssl_certificate` — get the certificate for a specific domain
- `wpe_account_ssl_status` — SSL health across all installs in an account

`wpe_account_ssl_status` is particularly useful for fleet-wide SSL audits — it shows which installs have no cert, expired certs, or certs expiring within 30 days.

---

## Backups

Backup creation requires API credentials (separate from OAuth). See the Authentication section for setup.

### Create a backup

```bash
nexus wpe backup <installId>
nexus wpe backup <installId> --description "Before plugin update"
```

MCP tool: `wpe_create_backup`

Fire-and-forget: creates the backup and returns a backup ID immediately without waiting for completion. Use `backup-status` to check progress.

### Create a backup and wait for completion

```bash
nexus wpe backup-verify <installId>
nexus wpe backup-verify <installId> --description "Pre-deployment snapshot"
```

MCP tool: `wpe_backup_and_verify`

Creates the backup and polls every 5 seconds (up to 5 minutes) until the backup status is `complete`. Returns confirmation including the backup ID and timestamp. If the backup does not complete within 5 minutes, it reports the backup ID and advises checking the WP Engine portal.

Use this before any Tier 3 operation (delete, promote).

### Check backup status

```bash
nexus wpe backup-status <installId> <backupId>
```

MCP tool: `wpe_get_backup`

---

## Environment Promotion

Promotion copies the content of one install to another (e.g., staging to production). This overwrites the destination.

```bash
# Without --confirm, shows what will happen and checks destination backup
nexus wpe promote <sourceInstallId> <destInstallId>

# With --confirm, executes the copy
nexus wpe promote <sourceInstallId> <destInstallId> --confirm

# Exclude database (files only)
nexus wpe promote <sourceInstallId> <destInstallId> --no-database --confirm
```

MCP tool: `wpe_promote_environment`

**Safety behavior:** without confirmation, the tool fetches both installs and shows you exactly what will be copied where. It checks the destination's most recent backup:

- No backups found: warns strongly
- Last backup older than 24 hours: shows the age and advises creating a fresh backup
- Recent backup found: confirms it exists

When promoting to a production environment, the tool adds an additional warning. The MCP tool uses a `_confirmationToken: "confirm"` parameter rather than a flag.

The copy is asynchronous — once initiated, check the WP Engine portal for progress. The operation typically takes several minutes.

---

## Usage and Performance

### Single install usage

```bash
nexus wpe usage <installId>
nexus wpe usage <installId> --month-offset 1   # previous month
```

MCP tool: `wpe_get_install_usage`

Shows visits, billable visits, bandwidth, file storage, and database storage for the current (or previous) month.

### Account-level usage

```bash
nexus wpe account-usage <accountId>
nexus wpe account-usage <accountId> --month-offset 1
```

MCP tools: `wpe_get_account_usage`, `wpe_get_account_usage_summary`, `wpe_get_account_usage_insights`

`wpe_get_account_usage_summary` — aggregated rollup for an account.

`wpe_get_account_usage_insights` — trend analysis and anomaly detection on usage data.

### Portfolio-level usage

MCP tool: `wpe_portfolio_usage`

Traffic, bandwidth, and storage for all installs across all accounts in a single call.

### Forcing disk recalculation

WP Engine caches disk usage figures. If you need current numbers after large file operations:

MCP tools: `wpe_refresh_install_disk_usage`, `wpe_refresh_account_disk_usage`

---

## Fleet Intelligence (Higher-Order Workflows)

These composite tools answer multi-dimensional questions by aggregating data across multiple CAPI calls internally. They are designed for AI agents but most have CLI equivalents.

| Goal | MCP tool | CLI command |
|------|----------|-------------|
| Full fleet overview | `wpe_portfolio_overview` | `nexus wpe portfolio` |
| Health of all installs | `wpe_fleet_health` | `nexus wpe fleet-health` |
| Diagnose one install | `wpe_diagnose_site` | `nexus wpe diagnose <installId>` |
| Compare staging vs production | `wpe_environment_diff` | — |
| Cross-account user audit | `wpe_user_audit` | `nexus wpe user-audit` |
| All domains in an account | `wpe_account_domains` | — |
| SSL cert health across account | `wpe_account_ssl_status` | — |
| Is this ready to go live? | `wpe_go_live_checklist` | `nexus wpe go-live-check <id> <domain>` |
| Set up domain + SSL automatically | `wpe_prepare_go_live` | — |
| Account + install summary | `wpe_account_overview` | — |
| Installs grouped by account | `wpe_installs_by_account` | — |

### wpe_fleet_health / nexus wpe fleet-health

Fetches all installs and their SSL certificates in parallel. Returns a table showing environment, PHP version, primary domain, and SSL status for each install. Flags production installs with missing or expiring SSL.

```bash
nexus wpe fleet-health
nexus wpe fleet-health --account <accountId>
```

### wpe_diagnose_site / nexus wpe diagnose

Runs four checks in parallel on a single install: domains, SSL certificates, most recent backup, and disk usage. Returns actionable findings for each check.

```bash
nexus wpe diagnose <installId>
```

### wpe_go_live_checklist / nexus wpe go-live-check

Pre-launch checklist for taking an install live with a specific domain. Checks:

1. Domain is added to the install
2. DNS is resolving to WP Engine
3. SSL certificate exists and is valid (not expired, not expiring within 30 days)
4. PHP version is 8.0 or above

```bash
nexus wpe go-live-check <installId> example.com
```

### wpe_prepare_go_live

MCP-only. Automates the go-live setup: adds the domain if not present, waits for DNS, requests SSL. Use `wpe_go_live_checklist` first to assess the current state, then `wpe_prepare_go_live` to take action.

### wpe_environment_diff

MCP-only. Compares two installs side-by-side (e.g., staging and production) — PHP version, WP version, domains, SSL status, and last backup age.

### wpe_portfolio_overview / nexus wpe portfolio

Cross-account summary: total accounts, total installs, aggregate bandwidth, storage, and visits. Includes per-account breakdowns.

```bash
nexus wpe portfolio
nexus wpe portfolio --month-offset 1   # previous month
```

---

## SSH Keys

```bash
# List SSH keys on your account
nexus wpe ssh-keys

# Add a new key
nexus wpe ssh-key-add --label "Work Laptop" --key "ssh-ed25519 AAAA..."

# Remove a key (requires --confirm)
nexus wpe ssh-key-remove <keyId> --confirm
```

MCP tools: `wpe_get_ssh_keys`, `wpe_create_ssh_key`, `wpe_delete_ssh_key`

`wpe_delete_ssh_key` is Tier 3 (requires confirmation).

---

## Offload / LargeFS

LargeFS is WP Engine's media offload and file storage system. These tools manage per-install offload configuration.

MCP tools:

- `wpe_get_offload_settings` — current offload settings for an install
- `wpe_update_offload_settings` — update offload configuration
- `wpe_configure_offload_settings` — full configuration helper
- `wpe_get_largefs_validation` — validate that LargeFS is configured correctly for an install

---

## Cache Purge

```bash
nexus wpe cache <installId> --purge
```

MCP tool: `wpe_purge_cache`

The `--purge` flag is required for the CLI command, acting as a confirmation step. Tier 2 (modifying but recoverable).

---

## Safety Tiers

All WPE tools are classified into tiers that govern how they behave, especially in AI agent contexts.

**Tier 1 — Read-only.** Execute immediately, no confirmation required. Examples: `wpe_get_installs`, `wpe_get_domains`, `wpe_fleet_health`, `wpe_user_audit`.

**Tier 2 — Modifying but recoverable.** Execute without a confirmation step, but the action is logged. Includes: creating installs and domains, updating install settings, requesting SSL, purging cache, creating backups, creating users.

**Tier 3 — Destructive or high-risk.** Require explicit confirmation before executing. In MCP tools, this means calling the tool once to get a summary/warning, then calling it again with `_confirmationToken: "confirm"`. In CLI commands, it means passing a `--confirm` or `--confirm-name` flag.

Tier 3 operations in the WPE module:

| Operation | Extra guard |
|-----------|-------------|
| `wpe_delete_install` | Must provide `confirm_install_name` matching the exact install name. Warns if no backup exists or last backup is over 7 days old. |
| `wpe_delete_site` | Requires confirmation. Deletes all installs. |
| `wpe_delete_domain` | Requires confirmation. |
| `wpe_delete_ssh_key` | Requires confirmation. |
| `wpe_delete_account_user` | Requires confirmation. |
| `wpe_promote_environment` | Checks destination backup recency before confirming. Adds extra warning if destination is production. |

---

## CLI Reference

All commands require Local to be running. Add `--json` where available for machine-readable output.

| Command | Description |
|---------|-------------|
| `nexus wpe status` | Auth status |
| `nexus wpe login` | OAuth login (opens browser) |
| `nexus wpe logout` | Logout |
| `nexus wpe accounts` | List accounts |
| `nexus wpe account <accountId>` | Account details |
| `nexus wpe limits <accountId>` | Plan limits |
| `nexus wpe users <accountId>` | List portal users for an account |
| `nexus wpe user <accountId> <userId>` | Single user details |
| `nexus wpe user-add <accountId> --email --first --last --role` | Add portal user |
| `nexus wpe user-update <accountId> <userId> --role <role>` | Update user role |
| `nexus wpe user-remove <accountId> <userId> --confirm` | Remove portal user |
| `nexus wpe user-audit [--account <id>]` | Cross-account user audit |
| `nexus wpe sites [--account <id>]` | List sites |
| `nexus wpe site <siteId>` | Site details |
| `nexus wpe create-site --name --account` | Create a site |
| `nexus wpe installs [accountId]` | List installs |
| `nexus wpe install <installId>` | Install details |
| `nexus wpe create-install --site --name --env --account` | Create install |
| `nexus wpe update-install <installId> [--php] [--env]` | Update PHP or env type |
| `nexus wpe delete-install <installId> --confirm-name <name>` | Delete install (irreversible) |
| `nexus wpe backup <installId> [--description]` | Create backup (fire-and-forget) |
| `nexus wpe backup-verify <installId> [--description]` | Create backup and poll to completion |
| `nexus wpe backup-status <installId> <backupId>` | Check backup status |
| `nexus wpe cache <installId> --purge` | Purge cache |
| `nexus wpe domains <installId>` | List domains |
| `nexus wpe domain-add <installId> <domain>` | Add domain |
| `nexus wpe domain-remove <installId> <domainId> --confirm` | Remove domain |
| `nexus wpe domain-check <installId> <domainId>` | Check DNS status |
| `nexus wpe ssl <installId>` | List SSL certs |
| `nexus wpe ssl-request <installId> --domains <id1,id2>` | Request SSL provisioning |
| `nexus wpe ssh-keys` | List SSH keys |
| `nexus wpe ssh-key-add --label <l> --key <pubkey>` | Add SSH key |
| `nexus wpe ssh-key-remove <keyId> --confirm` | Remove SSH key |
| `nexus wpe promote <sourceId> <destId> [--no-database] [--confirm]` | Promote environment |
| `nexus wpe diagnose <installId>` | Diagnose install |
| `nexus wpe go-live-check <installId> <domain>` | Go-live readiness checklist |
| `nexus wpe fleet-health [--account <id>]` | Fleet health overview |
| `nexus wpe portfolio [--month-offset <n>]` | Portfolio overview |
| `nexus wpe usage <installId> [--month-offset <n>]` | Install usage |
| `nexus wpe account-usage <accountId> [--month-offset <n>]` | Account usage |
| `nexus wpe set-credentials <username> <password>` | Store API credentials for backups |
| `nexus wpe credentials-status` | Check API credentials |
| `nexus wpe clear-credentials` | Remove API credentials |

---

## Troubleshooting

**"WP Engine authentication has expired"** — Run `nexus wpe login` or call `wpe_login`. The OAuth token has expired; this can happen after several hours of inactivity.

**Backup creation fails** — Backup creation requires API credentials, not just OAuth. Run `nexus wpe credentials-status` to check, and `nexus wpe set-credentials` to configure. Get credentials from `https://my.wpengine.com` under your user profile.

**"CAPI not available"** — Local is not authenticated with WP Engine, or the Local app is not running. Check `nexus wpe status`.

**SSL request fails** — DNS must point to WP Engine before SSL provisioning will succeed. Run `nexus wpe domain-check` first and wait for DNS to resolve. Propagation can take up to 48 hours.

**Local logs:** `~/Library/Logs/Local/main.log`
