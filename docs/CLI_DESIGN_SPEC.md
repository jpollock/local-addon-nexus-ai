# Nexus CLI - Complete Design Specification

**Date:** 2026-03-18 (Updated post-POC)
**Branch:** `mvp-v1`
**CLI Name:** `nexus`

**Status:** ✅ POC Complete - See `CLI_POC_RESULTS.md` for implementation details

**Post-POC Updates:**
- Added `@env` requirement everywhere (no exceptions)
- Simplified link management (using hostConnections)
- Services-based resolvers (not MCP tools)
- See `CLI_FEATURE_ROADMAP.md` for implementation plan

---

## TL;DR

**Philosophy:** Be explicit. `@env` everywhere. No ambiguity.

**Core Commands:**
```bash
nexus sites       # Site management (create, list, start, stop, delete, info)
nexus wp          # WordPress operations (plugins, themes, db, core, users)
nexus sync        # Push/Pull between local and WPE
nexus content     # Content search and indexing
nexus fleet       # Multi-site analysis and intelligence
```

**Targeting Syntax (REQUIRED @env):**
- Local: `mystore@local` (explicit environment required)
- WPE: `wpe:account/installid@environment`
- Linked shorthand: `mystore@production` (after linking)

**Key Decision (Post-POC):** `@env` required on ALL commands to eliminate ambiguity

**Linking Model:** Via hostConnections (Local's native linking)

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Site Targeting Syntax](#site-targeting-syntax)
3. [Command Reference](#command-reference)
4. [Link Management](#link-management)
5. [Error Handling](#error-handling)
6. [Use Case Scenarios](#use-case-scenarios)
7. [Implementation Notes](#implementation-notes)
8. [Testing Strategy](#testing-strategy)

---

## Core Concepts

### Site Types

**Local-Only Site:**
- Created with `nexus sites create`
- Lives in Local app
- Not connected to any WPE install
- Can work with wp-cli: `nexus wp mysite@local plugin list`

**WPE-Only Site:**
- Exists only in WP Engine
- Accessed via `wpe:account/installid@environment`
- Can work with wp-cli via SSH: `nexus wp wpe:myacct/abc123@production plugin list`
- Not pulled to local

**Linked Site:**
- Local site connected to one WPE install
- Created by first `sync pull` or `sync push`
- Enables shorthand syntax: `mysite@production` instead of `wpe:myacct/abc123@production`
- Link is 1:1 (one local ↔ one WPE install)

### Environment Types

WPE installs have environment types:
- `production`
- `staging`
- `development`

These are WPE API properties, NOT derived from install names.

### Linking Model

**1:1 Relationship:**
```
mystore-prod@local ↔ wpe:myaccount/prodinstall@production
mystore-stage@local ↔ wpe:myaccount/stageinstall@staging
```

**NOT supported:**
```
mystore@local ↔ wpe:myaccount/prodinstall@production
              ↔ wpe:myaccount/stageinstall@staging  ❌ No multi-linking
```

**Rationale:** Each local site has clear purpose. To work with multiple WPE environments, create multiple local sites.

---

## Site Targeting Syntax

### Local Sites

**Format:** `<site-name>@local`

**Examples:**
```bash
nexus wp mystore@local plugin list
nexus sites start mystore@local
nexus sync push mystore@local --to=wpe:myacct/abc@production
```

**Notes:**
- Site name is the Local site name (as shown in Local app)
- `@local` is REQUIRED for ALL commands (no exceptions)
- Clear error if `@env` is missing: "Must specify environment"

---

### WPE Sites (Full Syntax)

**Format:** `wpe:<account>/<installid>@<environment>`

**Examples:**
```bash
nexus wp wpe:myaccount/abc123@production plugin list
nexus sync pull mystore@local --from=wpe:myaccount/abc123@production
```

**Components:**
- `account` - WPE account name (from CAPI)
- `installid` - WPE install ID (unique identifier)
- `environment` - `production`, `staging`, or `development`

**Notes:**
- Full syntax works even if not linked
- Required for first sync operation
- Account and installid from WPE CAPI

---

### Linked Sites (Shorthand)

**Format:** `<site-name>@<environment>`

**Examples:**
```bash
# After linking mystore@local to wpe:myaccount/abc123@production:
nexus wp mystore@production plugin list
nexus sync pull mystore@local --from=production
```

**How linking works:**
1. First sync creates the link automatically
2. Link stored in addon database
3. Shorthand resolves to full WPE syntax internally

**Error if not linked:**
```bash
nexus wp mystore@production plugin list
# Error: mystore is not linked to any WPE environment 'production'.
# Use full syntax: nexus wp wpe:account/install@production
# Or create link: nexus sync pull mystore@local --from=wpe:account/install@production
```

---

## Command Reference

### `nexus sites` - Site Management

#### `nexus sites list`

List all sites (local + WPE).

**Usage:**
```bash
nexus sites list
nexus sites list --local-only
nexus sites list --wpe-only
nexus sites list --json
```

**Output:**
```
Local Sites:
  mystore-prod (running) → wpe:myaccount/prodid@production
  mystore-stage (stopped) → wpe:myaccount/stageid@staging
  blogsite (running) → not linked

WPE Sites:
  wpe:myaccount/prodid (production) → mystore-prod@local
  wpe:myaccount/stageid (staging) → mystore-stage@local
  wpe:myaccount/devid (development) → not linked
  wpe:anotheracct/xyz123 (production) → not linked
```

**Flags:**
- `--local-only` - Show only local sites
- `--wpe-only` - Show only WPE sites
- `--json` - Output as JSON

**JSON Format:**
```json
{
  "local": [
    {
      "name": "mystore-prod",
      "status": "running",
      "wpVersion": "6.4.2",
      "domain": "mystore-prod.local",
      "linkedTo": {
        "account": "myaccount",
        "installId": "prodid",
        "environment": "production"
      }
    }
  ],
  "wpe": [
    {
      "account": "myaccount",
      "installId": "prodid",
      "environment": "production",
      "name": "My Store Production",
      "domain": "mystore.com",
      "linkedTo": "mystore-prod@local"
    }
  ]
}
```

---

#### `nexus sites create`

Create a new local site.

**Usage:**
```bash
nexus sites create <target>
nexus sites create <target> --blueprint=<blueprint-name>
nexus sites create <target> --php=8.2 --wp=6.4
```

**Flags:**
- `--blueprint=<name>` - Create from Local blueprint
- `--php=<version>` - PHP version (e.g., 8.2, 8.1, 7.4)
- `--wp=<version>` - WordPress version (e.g., 6.4, 6.3)

**Examples:**
```bash
# Local site with defaults
nexus sites create mystore@local

# Local site from blueprint
nexus sites create mystore@local --blueprint=woocommerce

# Error if @local not specified
nexus sites create mystore
# Error: Sites can only be created locally. Use: nexus sites create mystore@local
```

**Errors:**
- Site name already exists locally
- Missing `@local`: "Sites can only be created locally"
- WPE target provided: "Cannot create WPE sites via CLI (use WPE Portal)"

**Note:** WPE site creation moved to Phase 2 roadmap (via CAPI)

---

#### `nexus sites start/stop/restart`

Manage local site lifecycle.

**Usage:**
```bash
nexus sites start <target>
nexus sites stop <target>
nexus sites restart <target>
```

**Examples:**
```bash
nexus sites start mystore@local
nexus sites stop mystore@local
nexus sites restart mystore@local
```

**Errors:**
- Site not found
- Site already running (for start)
- Site already stopped (for stop)
- WPE target provided: "Only local sites can be started. Pull to local first."

**Note:** These commands only work on local sites. WPE sites are always running.

---

#### `nexus sites delete`

Delete a local site.

**Usage:**
```bash
nexus sites delete <target>
nexus sites delete <target> --files
```

**Flags:**
- `--files` - Also delete site files (default: remove from Local only)

**Examples:**
```bash
# Remove from Local, keep files
nexus sites delete mystore@local

# Remove from Local and delete files
nexus sites delete mystore@local --files

# Error if WPE target
nexus sites delete mysite@production
# Error: WPE sites cannot be deleted via CLI. Use WPE Portal or CAPI.
```

**Confirmation:**
```
Delete site 'mystore'? (y/N): y
✓ Site removed from Local
Files preserved at: ~/Local Sites/mystore
```

**Errors:**
- Site not found
- Site is running (must stop first)
- WPE target provided: "WPE sites cannot be deleted via CLI"

---

#### `nexus sites info`

Show detailed site information and link status.

**Usage:**
```bash
nexus sites info <target>
```

**Examples:**
```bash
# Local site
nexus sites info mystore

# Output:
# Local Site: mystore
# Status: running
# WordPress: 6.4.2
# PHP: 8.2.10
# Domain: mystore.local
#
# Linked to:
#   production: wpe:myaccount/prodid
#   Domain: mystore.com
#   Last synced: 2 days ago

# WPE site
nexus sites info wpe:myaccount/prodid@production

# Output:
# WPE Install: prodid
# Account: myaccount
# Environment: production
# Name: My Store Production
# Domain: mystore.com
# WordPress: 6.4.2
# PHP: 8.2
#
# Linked to: mystore-prod@local
# Last synced: 2 days ago
```

---

### `nexus wp` - WordPress Operations

**Universal wp-cli wrapper** - works on local AND remote WPE sites.

**Syntax:**
```bash
nexus wp <target> <wp-cli-command> [args...]
```

**Target must include environment:**
- Local: `mysite@local`
- WPE full: `wpe:account/install@environment`
- WPE shorthand: `mysite@production` (if linked)

---

#### Plugin Commands

```bash
# List plugins
nexus wp <target> plugin list
nexus wp <target> plugin list --status=active
nexus wp <target> plugin list --format=json

# Install plugin
nexus wp <target> plugin install <slug>
nexus wp <target> plugin install woocommerce --activate

# Activate/deactivate
nexus wp <target> plugin activate <slug>
nexus wp <target> plugin deactivate <slug>

# Update
nexus wp <target> plugin update <slug>
nexus wp <target> plugin update --all
nexus wp <target> plugin update --all --dry-run

# Delete
nexus wp <target> plugin delete <slug>
```

**Examples:**
```bash
# Local
nexus wp mystore@local plugin list
nexus wp mystore@local plugin install woocommerce --activate

# Remote (full syntax)
nexus wp wpe:myaccount/abc123@production plugin list

# Remote (shorthand, if linked)
nexus wp mystore@production plugin update --all
```

---

#### Theme Commands

```bash
# List themes
nexus wp <target> theme list

# Activate
nexus wp <target> theme activate <slug>

# Install
nexus wp <target> theme install <slug>

# Update
nexus wp <target> theme update <slug>
nexus wp <target> theme update --all
```

---

#### Core Commands

```bash
# Version
nexus wp <target> core version

# Update
nexus wp <target> core update
nexus wp <target> core update --version=6.4.2

# Check for updates
nexus wp <target> core check-update
```

---

#### User Commands

```bash
# List users
nexus wp <target> user list

# Create user
nexus wp <target> user create <username> <email> --role=<role>

# Update user
nexus wp <target> user update <id> --role=<role>

# Delete user
nexus wp <target> user delete <id>
```

---

#### Database Commands

```bash
# Export (local only)
nexus wp <target> db export [--path=/path/to/file.sql]

# Query
nexus wp <target> db query "SELECT * FROM wp_posts LIMIT 10"

# Search/replace (local only)
nexus wp <target> db search-replace <old> <new> [--dry-run]
```

**Note:** Some db commands are local-only due to WPE SSH restrictions.

---

#### Option Commands

```bash
# Get option
nexus wp <target> option get <key>

# Update option
nexus wp <target> option update <key> <value>

# List options
nexus wp <target> option list
```

---

#### Post Commands

```bash
# Create post
nexus wp <target> post create --post_title="Hello" --post_status=publish

# Update post
nexus wp <target> post update <id> --post_title="New Title"

# Delete post
nexus wp <target> post delete <id>

# List posts
nexus wp <target> post list --post_type=page
```

---

#### Passthrough for Any WP-CLI Command

```bash
# Any wp-cli command works
nexus wp <target> <command> [args...]

# Examples:
nexus wp mystore@local cache flush
nexus wp mystore@local rewrite flush
nexus wp mystore@local eval "echo wp_get_environment_type();"
```

---

#### Error: Missing Environment

```bash
nexus wp mystore plugin list
# Error: Must specify environment.
#
# Local site:  nexus wp mystore@local plugin list
# WPE site:    nexus wp wpe:account/install@production plugin list
# Linked site: nexus wp mystore@production plugin list
```

---

### `nexus sync` - Push/Pull Operations

Sync database and files between local and WPE.

**Auto-linking:** First sync automatically creates link.

---

#### `nexus sync pull`

Pull from WPE to local.

**Syntax:**
```bash
nexus sync pull <local-target> --from=<wpe-target>
nexus sync pull <local-target> --from=<wpe-target> --db-only
nexus sync pull <local-target> --from=<wpe-target> --files-only
```

**Examples:**
```bash
# First time (creates link)
nexus sync pull mystore@local --from=wpe:myaccount/abc123@production
# ✓ Created link: mystore@local ↔ wpe:myaccount/abc123@production
# ✓ Pulling database (24.5 MB)
# ✓ Pulling files (156.2 MB)
# Done!

# After linking (shorthand)
nexus sync pull mystore@local --from=production
# ✓ Pulling mystore@production → mystore@local
# Done!

# Database only
nexus sync pull mystore@local --from=production --db-only

# Files only
nexus sync pull mystore@local --from=production --files-only
```

**Flags:**
- `--db-only` - Pull database only
- `--files-only` - Pull files only
- `--dry-run` - Show what would be pulled without doing it

**Errors:**
- Local site not found
- WPE install not accessible
- Local site already linked to different WPE install
- Disk space insufficient

---

#### `nexus sync push`

Push from local to WPE.

**Syntax:**
```bash
nexus sync push <local-target> --to=<wpe-target>
nexus sync push <local-target> --to=<wpe-target> --db
nexus sync push <local-target> --to=<wpe-target> --create
nexus sync push <local-target> --to=<wpe-target> --db-only
nexus sync push <local-target> --to=<wpe-target> --files-only
```

**Examples:**
```bash
# First time (creates link)
nexus sync push mystore@local --to=wpe:myaccount/stageid@staging
# ✓ Created link: mystore@local ↔ wpe:myaccount/stageid@staging
# ✓ Pushing files (156.2 MB)
# ✓ Database NOT pushed (use --db to include)
# Done!

# After linking (shorthand)
nexus sync push mystore@local --to=staging

# Include database (requires confirmation)
nexus sync push mystore@local --to=staging --db
# Warning: This will overwrite the database on wpe:myaccount/stageid@staging
# Continue? (y/N): y

# Create WPE install if doesn't exist
nexus sync push mystore@local --to=wpe:myaccount/newsite@staging --create
# ✓ Created WPE install: newsite (staging)
# ✓ Created link: mystore@local ↔ wpe:myaccount/newsite@staging
# ✓ Pushing files
# Done!
```

**Flags:**
- `--db` - Include database (requires confirmation for production)
- `--db-only` - Push database only
- `--files-only` - Push files only
- `--create` - Create WPE install if doesn't exist
- `--dry-run` - Show what would be pushed without doing it
- `--force` - Skip confirmation prompts

**Errors:**
- Local site not found
- WPE install not accessible
- Local site already linked to different WPE install
- No `--create` flag and WPE install doesn't exist

**Safety:**
- Pushing to production with `--db` requires explicit confirmation
- Database overwrites are destructive - always confirm

---

#### `nexus sync status`

Show sync status for a site.

**Syntax:**
```bash
nexus sync status <site-name>
```

**Example:**
```bash
nexus sync status mystore

# Output:
# Site: mystore
#
# Local:
#   Status: running
#   Last modified: 2 hours ago
#   Size: 180 MB
#
# Linked to:
#   wpe:myaccount/prodid@production
#   Last synced: 2 days ago (behind)
#   Size: 175 MB
#
# Recommendation: Pull from production to get latest changes
```

**Errors:**
- Site not found
- Site not linked

---

### `nexus content` - Content Search and Indexing

Semantic search across all indexed WordPress content.

---

#### `nexus content search`

Search indexed content.

**Syntax:**
```bash
nexus content search <query>
nexus content search <query> --limit=<n>
nexus content search <query> --json
```

**Examples:**
```bash
nexus content search "homepage design"

# Output:
# Found 12 results:
#
# 1. Homepage Hero Section (mystore@local)
#    The new homepage design features a bold hero section...
#    Post ID: 42, Type: page
#
# 2. Design System Documentation (blogsite@local)
#    Our homepage follows the design system guidelines...
#    Post ID: 15, Type: post

# JSON output
nexus content search "homepage" --json
```

**Flags:**
- `--limit=<n>` - Max results (default: 10)
- `--json` - Output as JSON

---

#### `nexus content index`

Index a site's content.

**Syntax:**
```bash
nexus content index <target>
nexus content index <target> --force
```

**Examples:**
```bash
# Index local site
nexus content index mystore@local
# ✓ Indexed 145 posts
# ✓ Indexed 12 pages
# ✓ Total: 157 documents

# Index remote site (via wp-cli)
nexus content index mystore@production

# Force reindex
nexus content index mystore@local --force
```

**Flags:**
- `--force` - Force reindex (even if already indexed)

---

#### `nexus content list`

List all indexed sites.

**Syntax:**
```bash
nexus content list
nexus content list --json
```

**Example:**
```bash
nexus content list

# Output:
# Indexed Sites:
#   mystore@local - 157 documents (2 hours ago)
#   mystore@production - 162 documents (1 day ago)
#   blogsite@local - 45 documents (3 days ago)
#
# Total: 364 documents across 3 sites
```

---

### `nexus fleet` - Multi-Site Analysis

AI-powered fleet analysis and intelligence.

---

#### `nexus fleet summary`

Cross-site summary statistics.

**Syntax:**
```bash
nexus fleet summary
nexus fleet summary --json
```

**Example:**
```bash
nexus fleet summary

# Output:
# Fleet Summary:
#   Total sites: 12 (8 local, 4 WPE)
#   WordPress versions: 6.4.2 (8), 6.3.1 (4)
#   PHP versions: 8.2 (10), 8.1 (2)
#   Total plugins: 145 unique
#   Total themes: 23 unique
#   Disk usage: 2.4 GB
```

---

#### `nexus fleet outdated`

Find sites with outdated WordPress, plugins, or themes.

**Syntax:**
```bash
nexus fleet outdated
nexus fleet outdated --severity=critical
```

**Example:**
```bash
nexus fleet outdated

# Output:
# Outdated Sites:
#
# Critical (security updates):
#   mystore@local - WP 6.3.1 (6.4.2 available)
#   blogsite@local - Plugin 'woocommerce' 8.0.0 (8.4.1 available, security fix)
#
# Minor updates:
#   store2@local - WP 6.4.1 (6.4.2 available)
```

---

#### `nexus fleet compare`

Compare plugins/themes across sites.

**Syntax:**
```bash
nexus fleet compare <site1> <site2> [<site3>...]
```

**Example:**
```bash
nexus fleet compare mystore@local blogsite@local

# Output:
# Plugin Comparison:
#   Both: woocommerce, akismet, jetpack
#   Only in mystore@local: woocommerce-gateway-stripe
#   Only in blogsite@local: contact-form-7
```

---

#### `nexus fleet drift`

Detect configuration drift.

**Syntax:**
```bash
nexus fleet drift
```

**Example:**
```bash
nexus fleet drift

# Output:
# Configuration Drift:
#   PHP versions: 8.2 (10 sites), 8.1 (2 sites) - 2 outliers
#   WP versions: 6.4.2 (8 sites), 6.3.1 (4 sites) - 4 behind
#   Plugin 'woocommerce': 5 different versions across 8 sites
```

---

#### AI-Powered Intelligence

```bash
# Analyze plugin usage patterns
nexus fleet analyze-plugins

# Recommend update strategy
nexus fleet recommend-updates

# Predict potential issues
nexus fleet predict-issues

# Suggest optimizations
nexus fleet suggest-optimizations

# Detect security risks
nexus fleet security-scan

# Calculate fleet health score
nexus fleet health-score
```

**Note:** These commands use AI models (via MCP backend) for analysis.

---

## Link Management

### How Links are Created

Links are created automatically on first sync:

```bash
# Before: No link exists
nexus sites list
# mystore (running) → not linked

# First sync creates link
nexus sync pull mystore@local --from=wpe:myaccount/abc123@production
# ✓ Created link: mystore@local ↔ wpe:myaccount/abc123@production

# After: Link exists
nexus sites list
# mystore (running) → wpe:myaccount/abc123@production
```

### Link Storage

Links stored in addon database:

```typescript
interface SiteLink {
  localSiteName: string;           // "mystore"
  wpeAccount: string;               // "myaccount"
  wpeInstallId: string;             // "abc123"
  wpeEnvironment: 'production' | 'staging' | 'development';
  createdAt: Date;
  lastSyncedAt: Date;
}
```

### Link Resolution

When user types `mystore@production`:
1. Look up link: `localSiteName = "mystore"` AND `wpeEnvironment = "production"`
2. Resolve to: `wpe:myaccount/abc123@production`
3. Execute command with resolved target

### Unlinking

**Manual unlink:**
```bash
nexus sites unlink mystore
# ✓ Removed link: mystore@local ↔ wpe:myaccount/abc123@production

# After unlinking, must use full syntax:
nexus wp wpe:myaccount/abc123@production plugin list
```

**Automatic unlink:**
- Deleting local site removes link
- Link becomes invalid if WPE install is deleted (shown in `sites list`)

---

## Error Handling

### Missing Environment

```bash
nexus wp mystore plugin list
```
**Error:**
```
Error: Must specify environment.

Local site:  nexus wp mystore@local plugin list
WPE site:    nexus wp wpe:account/install@production plugin list
Linked site: nexus wp mystore@production plugin list
```

---

### Site Not Found

```bash
nexus sites start nonexistent
```
**Error:**
```
Error: Local site 'nonexistent' not found.

Available sites:
  mystore (running)
  blogsite (stopped)

Create a site: nexus sites create <name>
```

---

### Not Linked

```bash
nexus wp mystore@production plugin list
```
**Error (if not linked):**
```
Error: Site 'mystore' is not linked to any WPE environment 'production'.

Use full syntax: nexus wp wpe:account/install@production plugin list

Or create link with sync:
  nexus sync pull mystore@local --from=wpe:account/install@production
```

---

### Already Linked to Different Install

```bash
nexus sync pull mystore@local --from=wpe:myaccount/different@production
```
**Error (if already linked to another install):**
```
Error: Site 'mystore' is already linked to wpe:myaccount/abc123@production.

Cannot link to wpe:myaccount/different@production.

Options:
  1. Unlink first: nexus sites unlink mystore
  2. Use a different local site name
  3. Use the existing link: nexus sync pull mystore@local --from=production
```

---

### WPE Authentication

```bash
nexus wp wpe:myaccount/abc123@production plugin list
```
**Error (if not authenticated):**
```
Error: Not authenticated with WP Engine account 'myaccount'.

Authenticate in Local:
  1. Open Local → Preferences → WP Engine
  2. Sign in with your WP Engine credentials

Or use: nexus wpe auth
```

---

### Confirmation Required

```bash
nexus sync push mystore@local --to=production --db
```
**Warning:**
```
⚠ Warning: This will overwrite the database on wpe:myaccount/prodid@production

This is a PRODUCTION environment. Data loss is permanent.

Continue? (y/N):
```

**If user types `n` or presses Enter:**
```
Cancelled. No changes made.

To push without database: nexus sync push mystore@local --to=production
To skip confirmation: nexus sync push mystore@local --to=production --db --force
```

---

## Use Case Scenarios

### Scenario 1: Remote-First Development

**Goal:** Create WPE site, work remotely, pull to local later.

```bash
# Create WPE staging site
nexus sites create --wpe myaccount/newstore@staging
# ✓ Created WPE install: newstore (staging environment)
# ✓ Install ID: xyz789
# ✓ Domain: newstore.staging.wpengine.com

# Work directly on remote via SSH
nexus wp wpe:myaccount/xyz789@staging plugin install woocommerce
nexus wp wpe:myaccount/xyz789@staging plugin activate woocommerce
nexus wp wpe:myaccount/xyz789@staging post create --post_title="Welcome"

# Pull to local for development
nexus sites create mystore-staging
nexus sync pull mystore-staging@local --from=wpe:myaccount/xyz789@staging
# ✓ Created link: mystore-staging@local ↔ wpe:myaccount/xyz789@staging

# Now can use shorthand
nexus wp mystore-staging@staging plugin list
nexus wp mystore-staging@local plugin list
```

---

### Scenario 2: Local-First Development

**Goal:** Create local site, develop, push to WPE.

```bash
# Create local site
nexus sites create mystore
nexus sites start mystore

# Develop locally
nexus wp mystore@local plugin install woocommerce --activate
nexus wp mystore@local theme install storefront --activate
nexus wp mystore@local post create --post_title="Homepage" --post_type=page

# Push to WPE staging (creates install and link)
nexus sync push mystore@local --to=wpe:myaccount/mystore-staging@staging --create
# ✓ Created WPE install: mystore-staging (staging environment)
# ✓ Created link: mystore@local ↔ wpe:myaccount/mystore-staging@staging
# ✓ Pushing files (156 MB)
# Done!

# Now linked
nexus sync push mystore@local --to=staging  # Shorthand works
```

---

### Scenario 3: Production Workflow

**Goal:** Pull prod, make changes, push to staging, test, push to prod.

```bash
# Create local for production work
nexus sites create mystore-prod
nexus sync pull mystore-prod@local --from=wpe:myaccount/prodid@production
# ✓ Created link: mystore-prod@local ↔ wpe:myaccount/prodid@production

# Make changes
nexus wp mystore-prod@local plugin update --all
nexus wp mystore-prod@local theme activate twentytwentyfour

# Test locally
nexus sites info mystore-prod
nexus wp mystore-prod@local core version

# Create staging site and push changes
nexus sites create mystore-staging
nexus sync push mystore-staging@local --to=wpe:myaccount/stageid@staging --create
# ✓ Created WPE install: stageid (staging)
# ✓ Created link: mystore-staging@local ↔ wpe:myaccount/stageid@staging

# Copy prod data to staging for testing
nexus sync pull mystore-staging@local --from=wpe:myaccount/prodid@production
nexus sync push mystore-staging@local --to=staging --db
# Warning: This will overwrite database on staging. Continue? (y/N): y

# Test on staging
nexus wp mystore-staging@staging option get siteurl
# https://mystore-staging.wpengine.com

# After testing, push to production
nexus sync push mystore-prod@local --to=production --db
# ⚠ Warning: This will overwrite PRODUCTION database. Continue? (y/N): y
# ✓ Pushed to production
```

---

### Scenario 4: Multi-Environment Setup

**Goal:** Manage site across dev, staging, and production.

```bash
# Create three local sites (one per environment)
nexus sites create mystore-dev
nexus sites create mystore-staging
nexus sites create mystore-prod

# Link to WPE environments
nexus sync pull mystore-dev@local --from=wpe:myaccount/devid@development
nexus sync pull mystore-staging@local --from=wpe:myaccount/stageid@staging
nexus sync pull mystore-prod@local --from=wpe:myaccount/prodid@production

# List shows all links
nexus sites list
# Local Sites:
#   mystore-dev (running) → wpe:myaccount/devid@development
#   mystore-staging (stopped) → wpe:myaccount/stageid@staging
#   mystore-prod (stopped) → wpe:myaccount/prodid@production

# Work on dev
nexus sites start mystore-dev
nexus wp mystore-dev@local plugin install new-feature --activate

# Push to dev environment
nexus sync push mystore-dev@local --to=development

# Promote dev to staging
nexus sync pull mystore-staging@local --from=development
nexus sync push mystore-staging@local --to=staging

# After testing, promote to production
nexus sync pull mystore-prod@local --from=staging
nexus sync push mystore-prod@local --to=production --db
```

---

## Implementation Notes

### GraphQL Mutations

Each CLI command maps to a GraphQL mutation:

```typescript
// nexus sites list
mutation ListSites {
  listSites {
    local {
      name
      status
      wpVersion
      linkedTo { account installId environment }
    }
    wpe {
      account
      installId
      environment
      linkedTo
    }
  }
}

// nexus wp <target> plugin list
mutation WpPluginList($target: String!) {
  wpPluginList(target: $target) {
    plugins {
      name
      status
      version
    }
  }
}

// nexus sync pull
mutation SyncPull($localSite: String!, $wpeTarget: String!, $dbOnly: Boolean, $filesOnly: Boolean) {
  syncPull(
    localSite: $localSite
    wpeTarget: $wpeTarget
    dbOnly: $dbOnly
    filesOnly: $filesOnly
  ) {
    success
    linkCreated
    bytesTransferred
  }
}
```

### Target Resolution

CLI handles target syntax internally:

```typescript
function resolveTarget(targetString: string): ResolvedTarget {
  // mystore@local
  if (targetString.includes('@local')) {
    return {
      type: 'local',
      siteName: targetString.replace('@local', '')
    };
  }

  // wpe:account/install@environment
  if (targetString.startsWith('wpe:')) {
    const match = targetString.match(/wpe:(.+)\/(.+)@(production|staging|development)/);
    return {
      type: 'wpe',
      account: match[1],
      installId: match[2],
      environment: match[3]
    };
  }

  // mystore@production (shorthand)
  if (targetString.includes('@')) {
    const [siteName, env] = targetString.split('@');
    const link = lookupLink(siteName, env);
    if (!link) {
      throw new Error(`Site '${siteName}' is not linked to environment '${env}'`);
    }
    return {
      type: 'wpe',
      account: link.wpeAccount,
      installId: link.wpeInstallId,
      environment: link.wpeEnvironment
    };
  }

  throw new Error('Invalid target syntax');
}
```

### Link Storage (GraphService)

Links stored in addon's SQLite database via GraphService:

```sql
CREATE TABLE site_links (
  id INTEGER PRIMARY KEY,
  local_site_name TEXT NOT NULL,
  wpe_account TEXT NOT NULL,
  wpe_install_id TEXT NOT NULL,
  wpe_environment TEXT CHECK(wpe_environment IN ('production', 'staging', 'development')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_synced_at DATETIME,
  UNIQUE(local_site_name)  -- 1:1 constraint
);
```

### Async Operations

Some operations are async (site creation, sync). CLI handles with:

```typescript
// Option 1: Polling
async function waitForCompletion(jobId: string) {
  while (true) {
    const status = await client.request(gql`
      query JobStatus($id: String!) {
        jobStatus(id: $id) {
          status  # pending | running | complete | failed
          progress
          message
        }
      }
    `, { id: jobId });

    if (status.jobStatus.status === 'complete') break;
    if (status.jobStatus.status === 'failed') throw new Error(status.jobStatus.message);

    console.log(status.jobStatus.message);
    await sleep(1000);
  }
}

// Option 2: Progress bar
const bar = new ProgressBar('Syncing [:bar] :percent :etas', {
  total: 100,
});

// Update from job status
```

---

## Testing Strategy

### Unit Tests

Test target resolution, argument parsing, error messages:

```typescript
describe('Target Resolution', () => {
  it('resolves local targets', () => {
    expect(resolveTarget('mystore@local')).toEqual({
      type: 'local',
      siteName: 'mystore'
    });
  });

  it('resolves WPE targets', () => {
    expect(resolveTarget('wpe:myacct/abc123@production')).toEqual({
      type: 'wpe',
      account: 'myacct',
      installId: 'abc123',
      environment: 'production'
    });
  });

  it('resolves linked shorthand', () => {
    // Mock link lookup
    mockLinkLookup('mystore', 'production', {
      wpeAccount: 'myacct',
      wpeInstallId: 'abc123'
    });

    expect(resolveTarget('mystore@production')).toEqual({
      type: 'wpe',
      account: 'myacct',
      installId: 'abc123',
      environment: 'production'
    });
  });

  it('throws error for invalid syntax', () => {
    expect(() => resolveTarget('invalid')).toThrow('Invalid target syntax');
  });

  it('throws error for unlinked shorthand', () => {
    expect(() => resolveTarget('mystore@production')).toThrow(
      "Site 'mystore' is not linked to environment 'production'"
    );
  });
});
```

### Integration Tests

Test CLI → GraphQL → MCP flow:

```typescript
describe('CLI Integration', () => {
  beforeAll(async () => {
    // Start Local with addon
    await startLocal();
    await loadAddon();
  });

  it('lists sites', async () => {
    const result = await exec('nexus sites list --json');
    const data = JSON.parse(result.stdout);

    expect(data.local).toBeArray();
    expect(data.wpe).toBeArray();
  });

  it('creates local site', async () => {
    const result = await exec('nexus sites create test-site');
    expect(result.stdout).toContain('Created site: test-site');

    const list = await exec('nexus sites list --json');
    const data = JSON.parse(list.stdout);
    expect(data.local.find(s => s.name === 'test-site')).toBeDefined();
  });

  it('runs wp-cli on local site', async () => {
    const result = await exec('nexus wp test-site@local core version');
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

### E2E Tests (Reference Implementation Pattern)

Check `local-addon-cli-mcp/packages/cli/tests/` for examples:

```typescript
describe('E2E: Sync Workflow', () => {
  it('creates local site and pushes to WPE', async () => {
    // Create local site
    await exec('nexus sites create e2e-test');
    await exec('nexus sites start e2e-test');

    // Install plugin
    await exec('nexus wp e2e-test@local plugin install hello-dolly --activate');

    // Push to WPE (mock or test account)
    const result = await exec(
      'nexus sync push e2e-test@local --to=wpe:testacct/e2etest@development --create'
    );

    expect(result.stdout).toContain('Created link');
    expect(result.stdout).toContain('Pushing files');

    // Verify on remote
    const plugins = await exec('nexus wp e2e-test@development plugin list --format=json');
    const data = JSON.parse(plugins.stdout);
    expect(data.find(p => p.name === 'hello-dolly')).toBeDefined();
  });
});
```

### Test Fixtures

Mock GraphQL responses for offline testing:

```typescript
const mockGraphQLServer = setupMockServer({
  listSites: {
    local: [
      { name: 'test-site', status: 'running', wpVersion: '6.4.2' }
    ],
    wpe: [
      { account: 'testacct', installId: 'test123', environment: 'production' }
    ]
  },

  wpPluginList: {
    plugins: [
      { name: 'akismet', status: 'active', version: '5.3' }
    ]
  }
});
```

### Manual Testing Checklist

- [ ] `nexus sites list` shows local + WPE sites
- [ ] `nexus sites create mytest` creates local site
- [ ] `nexus sites start mytest` starts site
- [ ] `nexus wp mytest@local plugin list` works
- [ ] `nexus wp mytest plugin list` errors with "must specify environment"
- [ ] `nexus sync pull mytest@local --from=wpe:account/install@production` creates link
- [ ] After linking, `nexus wp mytest@production plugin list` works
- [ ] `nexus sync push mytest@local --to=production --db` shows confirmation
- [ ] Error messages are clear and actionable
- [ ] `--json` flag works for all list commands
- [ ] `--help` shows usage for all commands

---

## POC Scope (Phase 1)

### Minimal Viable Commands

To validate architecture, implement these 5 commands:

1. **`nexus sites list`**
   - Shows local + WPE sites
   - Shows link status
   - Tests: GraphQL connection, data retrieval

2. **`nexus sites create <name>`**
   - Creates local site
   - Tests: Mutation execution, async handling

3. **`nexus wp <target> plugin list`**
   - Works on local and WPE
   - Tests: Target resolution, wp-cli integration

4. **`nexus sync pull <local> --from=<wpe>`**
   - Pulls from WPE to local
   - Creates link automatically
   - Tests: Link creation, file transfer, async operations

5. **`nexus sync push <local> --to=<wpe>`**
   - Pushes from local to WPE
   - Tests: Link lookup, confirmation prompts

### Success Criteria

POC validates:
- ✅ CLI → GraphQL → MCP flow works end-to-end
- ✅ Target resolution (local, WPE full, WPE shorthand) works
- ✅ Link creation and lookup works
- ✅ Error handling is clear
- ✅ Async operations (sync) show progress

---

## Next Steps

1. **Review this spec** - Validate command structure and syntax
2. **Implement POC** - Build 5 core commands
3. **Test POC** - Validate against success criteria
4. **Iterate** - Refine based on findings
5. **Expand** - Build remaining 66+ commands

---

## Appendix: Command Quick Reference

```bash
# Sites
nexus sites list [--local-only|--wpe-only] [--json]
nexus sites create <name> [--blueprint=<name>] [--php=<ver>] [--wp=<ver>]
nexus sites create --wpe <account>/<name>@<env>
nexus sites start <name>
nexus sites stop <name>
nexus sites restart <name>
nexus sites delete <name> [--files]
nexus sites info <target>

# WordPress
nexus wp <target> plugin list|install|activate|deactivate|update|delete
nexus wp <target> theme list|install|activate|update
nexus wp <target> core version|update|check-update
nexus wp <target> user list|create|update|delete
nexus wp <target> db export|query|search-replace
nexus wp <target> option get|update|list
nexus wp <target> post create|update|delete|list
nexus wp <target> <any-wp-cli-command>

# Sync
nexus sync pull <local> --from=<wpe> [--db-only|--files-only] [--dry-run]
nexus sync push <local> --to=<wpe> [--db] [--db-only|--files-only] [--create] [--force]
nexus sync status <site>

# Content
nexus content search <query> [--limit=<n>] [--json]
nexus content index <target> [--force]
nexus content list [--json]

# Fleet
nexus fleet summary [--json]
nexus fleet outdated [--severity=critical|minor]
nexus fleet compare <site1> <site2> [<site3>...]
nexus fleet drift
nexus fleet analyze-plugins
nexus fleet recommend-updates
nexus fleet predict-issues
nexus fleet suggest-optimizations
nexus fleet security-scan
nexus fleet health-score
```

**Targets:**
- Local: `<site>@local`
- WPE: `wpe:<account>/<install>@<environment>`
- Linked: `<site>@<environment>` (after linking)

**Environments:** `production`, `staging`, `development`
