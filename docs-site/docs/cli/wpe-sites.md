---
title: WP Engine Site Management
description: Manage WP Engine accounts, installs, domains, SSL, backups, and syncing via the Nexus CLI
keywords: [wpe, wp engine, installs, sites, domains, ssl, backup, pull, push, promote]
---

# WP Engine Site Management

Manage WP Engine hosting from the CLI: list installs, create backups, manage domains and SSL, sync content to and from local sites, and promote between environments.

## Prerequisites

- Authenticated with WP Engine: `nexus wpe login`
- API credentials stored for backup creation: `nexus wpe set-credentials`

See [Authentication](./authentication.md) for setup details.

---

## Sites vs. Installs

WP Engine uses two levels of organization:

- **Site** — a logical grouping (e.g., "Acme Corp"). One site can have multiple installs.
- **Install** — a running WordPress environment. Each install has one environment type: `production`, `staging`, or `development`.

Most CLI commands operate on installs, not sites. When a command asks for an `installId`, use the install name (e.g., `acmecorp`, `acmecorp-staging`), not a UUID.

**Target syntax for WPE installs:**

```
wpe:account/install@environment
```

Example: `wpe:acmeco/myblog@production`

---

## Accounts

### `nexus wpe accounts`

List all WP Engine accounts you have access to.

```bash
nexus wpe accounts
```

**Flags:** `--json`

**Output:**

```
WP Engine Accounts:
  Acme Agency
    ID: a1b2c3d4-e5f6-...
  Personal
    ID: f9e8d7c6-b5a4-...
```

---

### `nexus wpe account <accountId>`

Get details about a specific account.

```bash
nexus wpe account a1b2c3d4-e5f6-...
```

**Flags:** `--json`

---

### `nexus wpe limits <accountId>`

Show plan limits for an account (bandwidth, storage, installs).

```bash
nexus wpe limits a1b2c3d4-e5f6-...
```

---

### `nexus wpe users <accountId>`

List all users on an account.

```bash
nexus wpe users a1b2c3d4-e5f6-...
```

---

### `nexus wpe user-audit`

Audit users across all accounts (or a specific account).

```bash
nexus wpe user-audit
nexus wpe user-audit --account a1b2c3d4-e5f6-...
```

**Flags:** `--account <accountId>`, `--json`

---

### `nexus wpe user-add <accountId>`

Add a user to an account.

```bash
nexus wpe user-add a1b2c3d4-e5f6-... \
  --email jane@example.com \
  --first Jane \
  --last Doe \
  --role owner
```

All four flags (`--email`, `--first`, `--last`, `--role`) are required.

---

### `nexus wpe user-update <accountId> <userId>`

Change a user's role.

```bash
nexus wpe user-update a1b2c3d4 u9f8e7d6 --role billing
```

**Required flag:** `--role <role>`

---

### `nexus wpe user-remove <accountId> <userId>`

Remove a user from an account. Requires `--confirm` to proceed.

```bash
nexus wpe user-remove a1b2c3d4 u9f8e7d6 --confirm
```

---

## Sites

### `nexus wpe sites`

List all WP Engine sites (the top-level grouping objects, not installs).

```bash
nexus wpe sites
nexus wpe sites --account a1b2c3d4-e5f6-...
```

**Flags:** `--account <accountId>`, `--json`

---

### `nexus wpe site <siteId>`

Get details about a specific WP Engine site.

```bash
nexus wpe site s3t4u5v6-w7x8-...
```

---

### `nexus wpe create-site`

Create a new WP Engine site (the logical grouping, not an install).

```bash
nexus wpe create-site --name "Acme Blog" --account a1b2c3d4-e5f6-...
```

Both `--name` and `--account` are required.

---

## Installs

### `nexus wpe installs [account]`

List installs, optionally filtered by account name.

```bash
# All installs across all accounts
nexus wpe installs

# Installs for a specific account
nexus wpe installs acmeco
```

**Flags:** `--json`

**Output:**

```
WP Engine Installs:
  myblog (production)
    Account: Acme Agency
    Domain:  myblog.wpengine.com
    Target:  wpe:acmeco/myblog@production

  myblog-staging (staging)
    Account: Acme Agency
    Domain:  myblogstaging.wpengine.com
    Target:  wpe:acmeco/myblog-staging@staging
```

Use the `Target` value when other commands ask for a WPE target string.

---

### `nexus wpe install <installId>`

Get details about a specific install.

```bash
nexus wpe install myblog
```

**Flags:** `--json`

**Output:**

```
myblog
────────────────────────────────────────
Environment:  production
Account:      Acme Agency
Domain:       myblog.wpengine.com
WordPress:    6.5.2
PHP:          8.2
Target:       wpe:acmeco/myblog@production
```

---

### `nexus wpe create-install`

Create a new install under an existing WP Engine site.

```bash
nexus wpe create-install \
  --site s3t4u5v6-... \
  --name myblog-dev \
  --env development \
  --account a1b2c3d4-...
```

All four flags are required. Valid environments: `production`, `staging`, `development`.

---

### `nexus wpe update-install <installId>`

Update install settings such as PHP version.

```bash
nexus wpe update-install myblog --php 8.3
nexus wpe update-install myblog --env staging
```

At least one of `--php` or `--env` is required.

---

### `nexus wpe delete-install <installId>`

Delete a WP Engine install. Requires the install name as confirmation.

```bash
nexus wpe delete-install myblog-dev --confirm-name myblog-dev
```

`--confirm-name` must match the install's name exactly. This is permanent.

---

## Usage Metrics

### `nexus wpe usage <installId>`

Show bandwidth, storage, and visitor counts for the current month.

```bash
nexus wpe usage myblog
nexus wpe usage myblog --month-offset 1  # last month
```

**Flags:** `--month-offset <n>` (0 = current, 1 = last), `--json`

**Output:**

```
Install: myblog — April 2026
──────────────────────────────────────────
  Visits (total):    48,231
  Billable visits:   46,890
  Bandwidth:         12.45 GB
  File storage:      2.34 GB
  DB storage:        456.78 MB
──────────────────────────────────────────
  Period:  2026-04-01 → 2026-04-13
```

---

### `nexus wpe account-usage <accountId>`

Show rolled-up usage for all installs under an account.

```bash
nexus wpe account-usage a1b2c3d4-e5f6-...
nexus wpe account-usage a1b2c3d4-e5f6-... --month-offset 1
```

---

### `nexus wpe portfolio`

Show a high-level overview of all accounts and their combined metrics.

```bash
nexus wpe portfolio
nexus wpe portfolio --month-offset 1
```

---

## Backups

Backup creation requires API credentials. See [Authentication](./authentication.md#api-credentials-for-backups).

### `nexus wpe backup <target>`

Create a backup for an install.

```bash
nexus wpe backup myblog
nexus wpe backup myblog --description "Before plugin update"
nexus wpe backup myblog --emails ops@example.com,dev@example.com
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--description <text>` | Description stored with the backup |
| `--emails <addresses>` | Comma-separated notification emails |

**Output:**

```
Creating backup for myblog...

Backup created
  ID: bk-abc123def456
```

---

### `nexus wpe backup-status <installId> <backupId>`

Check the status of a backup.

```bash
nexus wpe backup-status myblog bk-abc123def456
```

**Flags:** `--json`

---

### `nexus wpe backup-verify <installId>`

Create a backup and poll until it reaches a completed state (up to 6 minutes).

```bash
nexus wpe backup-verify myblog
nexus wpe backup-verify myblog --description "Pre-deploy snapshot"
```

**Flags:** `--description <text>`, `--json`

**Output:**

```
Backup complete
  ID: bk-xyz789
  Created: 2026-04-13T09:15:00Z
```

---

## Domains

### `nexus wpe domains <installId>`

List all domains on an install.

```bash
nexus wpe domains myblog
```

**Flags:** `--json`

**Output:**

```
Domains for install myblog:
──────────────────────────────────────────────────────────────────────
  Domain                                   Primary    Status
──────────────────────────────────────────────────────────────────────
  myblog.com                               yes        active
  www.myblog.com                           no         active
  myblog.wpengine.com                      no         active
```

---

### `nexus wpe domain-add <installId> <domain>`

Add a domain to an install.

```bash
nexus wpe domain-add myblog store.myblog.com
```

**Output:**

```
Domain added
  ID:   dom-abc123
  Name: store.myblog.com
```

---

### `nexus wpe domain-remove <installId> <domainId>`

Remove a domain from an install. Requires `--confirm`.

```bash
nexus wpe domain-remove myblog dom-abc123 --confirm
```

`--confirm` is required. This action cannot be undone.

---

### `nexus wpe domain-check <installId> <domainId>`

Check DNS propagation status for a domain.

```bash
nexus wpe domain-check myblog dom-abc123
```

**Flags:** `--json`

---

## SSL Certificates

### `nexus wpe ssl <installId>`

List SSL certificates on an install.

```bash
nexus wpe ssl myblog
```

**Flags:** `--json`

---

### `nexus wpe ssl-request <installId>`

Request SSL provisioning for one or more domain IDs.

```bash
nexus wpe ssl-request myblog --domains dom-abc123,dom-def456
```

`--domains` is required and accepts comma-separated domain IDs (as returned by `nexus wpe domains`).

---

## SSH Keys

### `nexus wpe ssh-keys`

List SSH public keys on your WP Engine account.

```bash
nexus wpe ssh-keys
```

**Flags:** `--json`

---

### `nexus wpe ssh-key-add`

Add an SSH public key to your WP Engine account.

```bash
nexus wpe ssh-key-add \
  --label "My MacBook" \
  --key "ssh-ed25519 AAAAC3Nza..."
```

Both `--label` and `--key` are required.

---

### `nexus wpe ssh-key-remove <keyId>`

Remove an SSH key. Requires `--confirm`.

```bash
nexus wpe ssh-key-remove k-abc123 --confirm
```

---

## Pull and Push

Pull and push sync content between local sites and WP Engine installs. These operations run in the background inside Local — the CLI queues the operation and displays progress in the Local app.

### `nexus sync pull <localSite>@local --from <wpeTarget>`

Pull files (and optionally database) from a WP Engine install to a local site.

```bash
# Pull everything (files only by default)
nexus sync pull mysite@local --from wpe:acmeco/myblog@production

# Pull database only
nexus sync pull mysite@local --from wpe:acmeco/myblog@production --db-only

# Pull files only (explicit)
nexus sync pull mysite@local --from wpe:acmeco/myblog@production --files-only
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--from <wpeTarget>` | WPE target to pull from (required) |
| `--db-only` | Pull database only |
| `--files-only` | Pull files only |

**Output:**

```
Pulling wpe:acmeco/myblog@production → mysite@local...

Pull operation queued successfully

Check the Local app for pull progress.
The pull operation runs in the background.

Do NOT run wp-cli commands on mysite until the pull completes.
Wait for Local to show "Pull complete" before using the site.
```

**Important:** Do not run WP-CLI commands on the local site while a pull is in progress.

---

### `nexus sync push <localSite>@local --to <wpeTarget>`

Push files (and optionally database) from a local site to a WP Engine install.

```bash
# Push files only (default)
nexus sync push mysite@local --to wpe:acmeco/myblog@staging

# Push files and database
nexus sync push mysite@local --to wpe:acmeco/myblog@staging --db

# Push database only
nexus sync push mysite@local --to wpe:acmeco/myblog@staging --db-only

# Create the install if it doesn't exist
nexus sync push mysite@local --to wpe:acmeco/myblog-new@staging --create
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--to <wpeTarget>` | WPE target to push to (required) |
| `--db` | Include database in push (requires confirmation) |
| `--db-only` | Push database only |
| `--files-only` | Push files only |
| `--create` | Create the WPE install if it doesn't exist |

**Database push confirmation:** When `--db` or `--db-only` is used, the CLI prompts: `Type 'yes' to confirm database push`. This prompt is doubled when pushing to a `production` environment.

---

### `nexus sync history <localSite>@local`

View the sync history for a local site.

```bash
nexus sync history mysite@local
```

**Flags:** `--json`

**Output:**

```
Sync History for mysite@local:
  ✅ 4/13/2026, 9:00:00 AM ← pull
     Files: 432
  ✅ 4/12/2026, 4:30:00 PM → push
     Files: 12
     Database: included
```

---

## Promote

### `nexus wpe promote <sourceInstallId> <destInstallId>`

Copy one WP Engine install to another (e.g., staging to production).

```bash
# Preview what would happen (no --confirm = dry run mode)
nexus wpe promote myblog-staging myblog

# Execute the promotion
nexus wpe promote myblog-staging myblog --confirm

# Promote files only (exclude database)
nexus wpe promote myblog-staging myblog --no-database --confirm
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--confirm` | Required to execute the promotion |
| `--no-database` | Exclude database from promotion |

Without `--confirm`, the command explains what would happen and exits. Re-run with `--confirm` to proceed.

---

## Diagnostics

### `nexus wpe diagnose <installId>`

Run a diagnostic check on a WP Engine install. Checks primary domain, SSL, and recent backups.

```bash
nexus wpe diagnose myblog
```

**Flags:** `--json`

**Output:**

```
Diagnostic: myblog
────────────────────────────────────────
  Domain:      myblog.wpengine.com
  Environment: production

  Has primary domain
  SSL certificate
  Recent backup
```

---

### `nexus wpe go-live-check <installId> <domain>`

Check whether a domain is ready to go live (domain added, SSL configured).

```bash
nexus wpe go-live-check myblog myblog.com
```

**Flags:** `--json`

---

### `nexus wpe fleet-health`

Show SSL status and environment for all WP Engine installs.

```bash
nexus wpe fleet-health
nexus wpe fleet-health --account a1b2c3d4-e5f6-...
```

**Flags:** `--account <accountId>`, `--json`

---

### `nexus wpe changes <localSite>@local`

View file differences between a local site and its linked WPE install.

```bash
nexus wpe changes mysite@local
nexus wpe changes mysite@local --since 2026-04-01
```

**Flags:** `--since <date>`

The local site must be linked to a WPE install. See `nexus wpe link`.

---

## Linking Sites

### `nexus wpe link <localSite>@local <wpeTarget>`

Link a local site to a WP Engine install. Required for `nexus wpe changes` and shorthand `@environment` targeting.

```bash
nexus wpe link mysite@local wpe:acmeco/myblog@production
```

After linking, `nexus sites list` shows the connection in the local site's output.

---

## Cache

### `nexus wpe cache <target> --purge`

Purge the WP Engine cache for an install.

```bash
nexus wpe cache myblog --purge
```

`--purge` is required to confirm the operation.

---

## Common Workflows

### Create a backup before deploying

```bash
nexus wpe backup-verify myblog-staging --description "Pre-deploy $(date)"
```

### Pull production to local for debugging

```bash
# Pull files and database from production
nexus sync pull mysite@local --from wpe:acmeco/myblog@production --db-only

# Wait for pull to complete in Local app, then inspect
nexus wp core version mysite@local
```

### Add a domain and provision SSL

```bash
# Add the domain
nexus wpe domain-add myblog store.myblog.com

# Get the new domain ID from the list
nexus wpe domains myblog

# Request SSL
nexus wpe ssl-request myblog --domains dom-newid

# Check go-live readiness
nexus wpe go-live-check myblog store.myblog.com
```

### Promote staging to production

```bash
# Backup production first
nexus wpe backup-verify myblog --description "Pre-promotion backup"

# Promote staging → production (files only)
nexus wpe promote myblog-staging myblog --no-database --confirm
```

---

## Troubleshooting

**"Not authenticated"** — Run `nexus wpe login` and complete the browser flow.

**Backup fails** — Run `nexus wpe credentials-status`. If credentials are not configured, run `nexus wpe set-credentials`.

**Pull/push hangs** — These operations run inside Local and may take 10+ minutes for large sites. Check the Local app for progress. Do not close Local during the operation.

**"Invalid target syntax"** — WPE targets require the full format `wpe:account/install@environment`. Use `nexus wpe installs` to see the exact target string for each install.

---

## Next Steps

- [Authentication](./authentication.md) — log in and set up API credentials
- [Local Site Management](./local-sites.md) — create and manage local sites
- [Command Reference](./commands.md) — full command tree
