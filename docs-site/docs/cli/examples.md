---
title: CLI Examples
description: Real-world usage examples and workflows for Nexus AI CLI
keywords: [cli, examples, workflows, automation, wordpress, local, wpe]
---

# CLI Examples

Real-world usage patterns and workflows for common WordPress management tasks.

## Quick Reference

| Task | Command |
|------|---------|
| List all sites | `nexus list` |
| Scan all sites | `nexus scan` |
| Search content | `nexus search "query"` |
| List plugins | `nexus plugin list mysite` |
| Update plugins | `nexus plugin update mysite --all` |
| Run WP-CLI | `nexus wp mysite core version` |
| Diagnose WPE site | `nexus wpe diagnose mysite-prod` |
| Start MCP server | `nexus mcp` |

---

## Daily Workflows

### Morning Site Check

Check the health of all your sites at the start of the day.

```bash
#!/bin/bash
# morning-check.sh

echo "=== Daily Site Health Check ==="
echo ""

# List all sites with status
nexus list

# Check for plugin updates
echo ""
echo "=== Plugin Updates Available ==="
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  updates=$(nexus plugin list $site --updates 2>/dev/null | wc -l)
  if [ $updates -gt 0 ]; then
    echo "$site: $updates updates available"
  fi
done

# Check WordPress core versions
echo ""
echo "=== WordPress Versions ==="
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  version=$(nexus wp $site core version 2>/dev/null)
  echo "$site: WordPress $version"
done

# Scan new content
echo ""
echo "=== Scanning for new content ==="
nexus scan --local-only

echo ""
echo "=== Check complete ==="
```

**Output:**

```
=== Daily Site Health Check ===

Local Sites (5 running, 2 halted)
mysite (running) - WP 6.4.3
blog (running) - WP 6.4.2
shop (running) - WP 6.3.1
...

=== Plugin Updates Available ===
mysite: 3 updates available
blog: 1 updates available

=== WordPress Versions ===
mysite: WordPress 6.4.3
blog: WordPress 6.4.2
shop: WordPress 6.3.1

=== Scanning for new content ===
Scanning 5 sites...
✓ mysite (5,432 posts)
✓ blog (1,234 posts)
...

=== Check complete ===
```

---

### Weekly Maintenance

Automated weekly maintenance script.

```bash
#!/bin/bash
# weekly-maintenance.sh

echo "=== Weekly Maintenance ==="
date

# Backup production sites
echo ""
echo "=== Creating Backups ==="
for install in $(nexus wpe installs --environment production --format json | jq -r '.[].name'); do
  echo "Backing up $install..."
  nexus wpe backup $install --description "Weekly maintenance backup"
done

# Update all plugins on staging sites
echo ""
echo "=== Updating Plugins (Staging) ==="
nexus bulk update-plugins --wpe --environment staging

# Update WordPress core on staging
echo ""
echo "=== Updating WordPress Core (Staging) ==="
nexus bulk update-core --wpe --environment staging

# Run diagnostics
echo ""
echo "=== Running Diagnostics ==="
for install in $(nexus wpe installs --environment staging --format json | jq -r '.[].name'); do
  nexus wpe diagnose $install
done

# Compare environments
echo ""
echo "=== Environment Comparison ==="
for site in $(nexus wpe installs --format json | jq -r '.[].name | split("-")[0]' | uniq); do
  nexus wpe diff $site
done

echo ""
echo "=== Maintenance complete ==="
```

---

## Content Management

### Find and Replace Content

Search for content and optionally update it.

```bash
# Find posts about a topic
nexus search "WordPress performance" --type post --limit 20

# Find products in a price range (using WP-CLI)
nexus wp shop post list \
  --post_type=product \
  --meta_key=_price \
  --meta_compare='>' \
  --meta_value=100 \
  --format=table

# Search and replace URLs (dry run first)
nexus wp mysite search-replace \
  'http://mysite.local' \
  'https://mysite.com' \
  --dry-run

# Actually perform the replacement
nexus wp mysite search-replace \
  'http://mysite.local' \
  'https://mysite.com' \
  --skip-columns=guid
```

---

### Content Migration

Migrate content between sites.

```bash
#!/bin/bash
# migrate-content.sh

SOURCE_SITE="blog-staging"
TARGET_SITE="blog-production"

echo "Migrating content: $SOURCE_SITE → $TARGET_SITE"

# Export posts from source
echo "Exporting posts..."
nexus wp $SOURCE_SITE export \
  --dir=/tmp/export \
  --post_type=post \
  --post_status=publish

# Import to target
echo "Importing posts..."
nexus wp $TARGET_SITE import \
  /tmp/export/*.xml \
  --authors=create

# Re-index target site
echo "Re-indexing target site..."
nexus scan $TARGET_SITE --force

echo "Migration complete"
```

---

## Plugin Management

### Audit Plugins Across Fleet

Find out which plugins are installed across all sites.

```bash
#!/bin/bash
# plugin-audit.sh

echo "=== Plugin Audit ==="
echo ""

# Create temporary file for results
TMPFILE=$(mktemp)

# Collect plugin data from all sites
for site in $(nexus list --local --format json | jq -r '.[].name'); do
  nexus plugin list $site --format json | jq -r ".[] | \"$site,\(.name),\(.version),\(.status)\"" >> $TMPFILE
done

# Analyze results
echo "Most common plugins:"
cat $TMPFILE | cut -d, -f2 | sort | uniq -c | sort -rn | head -10

echo ""
echo "Plugins with multiple versions:"
cat $TMPFILE | cut -d, -f2,3 | sort -u | cut -d, -f1 | uniq -d

echo ""
echo "Inactive plugins taking up space:"
cat $TMPFILE | grep ",inactive$" | cut -d, -f1,2 | sort

# Cleanup
rm $TMPFILE

echo ""
echo "=== Audit complete ==="
```

**Output:**

```
=== Plugin Audit ===

Most common plugins:
  15 akismet
  12 woocommerce
  10 yoast-seo
   8 contact-form-7
   8 wordfence

Plugins with multiple versions:
akismet (5.3, 5.3.1)
yoast-seo (21.8, 21.9)

Inactive plugins taking up space:
blog,classic-editor
shop,hello-dolly
mysite,jetpack

=== Audit complete ===
```

---

### Bulk Plugin Operations

Update or activate plugins across multiple sites.

```bash
# Update Akismet on all sites
for site in $(nexus list --local --running --format json | jq -r '.[].name'); do
  echo "Updating Akismet on $site..."
  nexus plugin update $site akismet
done

# Or use bulk operations (faster)
nexus bulk update-plugin akismet --local --running

# Activate Yoast SEO on all sites
nexus bulk activate-plugin yoast-seo --all

# Deactivate Hello Dolly everywhere
nexus bulk deactivate-plugin hello-dolly --all

# Install and activate WooCommerce on e-commerce sites
for site in shop shop2 shop3; do
  nexus plugin install $site woocommerce --activate
done
```

---

## WP Engine Management

### Staging to Production Workflow

Safe deployment workflow with rollback capability.

```bash
#!/bin/bash
# deploy.sh

SITE=$1

if [ -z "$SITE" ]; then
  echo "Usage: deploy.sh <site-name>"
  exit 1
fi

echo "=== Deployment Workflow: $SITE ==="
echo ""

# Step 1: Diagnose staging
echo "Step 1: Diagnosing staging environment..."
nexus wpe diagnose ${SITE}-staging
if [ $? -ne 0 ]; then
  echo "✗ Staging diagnostics failed"
  exit 1
fi

# Step 2: Compare environments
echo ""
echo "Step 2: Comparing environments..."
nexus wpe diff $SITE

# Step 3: Manual approval
echo ""
read -p "Continue with deployment? (y/N): " confirm
if [ "$confirm" != "y" ]; then
  echo "Deployment cancelled"
  exit 0
fi

# Step 4: Backup production
echo ""
echo "Step 3: Backing up production..."
BACKUP_ID=$(nexus wpe backup ${SITE}-production --description "Pre-deployment backup" --format json | jq -r '.id')
echo "Backup ID: $BACKUP_ID"

# Step 5: Promote staging
echo ""
echo "Step 4: Promoting staging to production..."
nexus wpe promote $SITE

# Step 6: Verify production
echo ""
echo "Step 5: Verifying production..."
sleep 30  # Wait for cache to clear
nexus wpe diagnose ${SITE}-production

# Step 7: Test production
echo ""
echo "Step 6: Testing production..."
PROD_URL=$(nexus wpe installs --environment production --format json | jq -r ".[] | select(.name==\"${SITE}-production\") | .primary_domain")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$PROD_URL")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Production is responding (HTTP $HTTP_CODE)"
else
  echo "✗ Production returned HTTP $HTTP_CODE"
  echo "Rollback available: nexus wpe rollback $SITE $BACKUP_ID"
  exit 1
fi

echo ""
echo "=== Deployment complete ==="
echo "Rollback ID: $BACKUP_ID"
```

---

### Multi-Site Diagnostics

Check the health of all WP Engine sites.

```bash
#!/bin/bash
# wpe-health-check.sh

echo "=== WP Engine Fleet Health Check ==="
echo ""

# Get all production installs
INSTALLS=$(nexus wpe installs --environment production --format json | jq -r '.[].name')

# Track results
HEALTHY=0
WARNINGS=0
ERRORS=0

# Check each install
for install in $INSTALLS; do
  echo "Checking $install..."

  # Run diagnostics
  RESULT=$(nexus wpe diagnose $install --format json)

  # Parse results
  STATUS=$(echo $RESULT | jq -r '.overall.status')

  if [ "$STATUS" = "healthy" ]; then
    echo "  ✓ Healthy"
    ((HEALTHY++))
  elif [ "$STATUS" = "warning" ]; then
    echo "  ⚠ Warnings detected"
    ((WARNINGS++))
    echo $RESULT | jq -r '.warnings[]' | sed 's/^/    - /'
  else
    echo "  ✗ Errors detected"
    ((ERRORS++))
    echo $RESULT | jq -r '.errors[]' | sed 's/^/    - /'
  fi

  echo ""
done

# Summary
echo "=== Summary ==="
echo "Healthy: $HEALTHY"
echo "Warnings: $WARNINGS"
echo "Errors: $ERRORS"

# Exit with error if any sites have issues
if [ $ERRORS -gt 0 ]; then
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  exit 2
else
  exit 0
fi
```

---

## Semantic Search

### Content Research

Find related content across all sites.

```bash
# Find all posts about image optimization
nexus search "optimize images" --type post

# Find products related to a topic
nexus search "blue widgets" --site shop --type product

# Cross-site content search
nexus search "WordPress security" --limit 50 --threshold 0.8

# Save search results to file
nexus search "WooCommerce" --format json > woocommerce-content.json
```

**Example: Building a content inventory**

```bash
#!/bin/bash
# content-inventory.sh

TOPIC=$1
OUTPUT_DIR="content-inventory"

mkdir -p $OUTPUT_DIR

echo "Building content inventory for: $TOPIC"

# Search across all sites
RESULTS=$(nexus search "$TOPIC" --limit 100 --format json)

# Extract unique sites
SITES=$(echo $RESULTS | jq -r '.[].site' | sort -u)

# Create per-site reports
for site in $SITES; do
  echo "Processing $site..."

  # Filter results for this site
  echo $RESULTS | jq "[.[] | select(.site==\"$site\")]" > "$OUTPUT_DIR/$site.json"

  # Create markdown summary
  cat > "$OUTPUT_DIR/$site.md" << EOF
# $TOPIC - $site

Found $(echo $RESULTS | jq "[.[] | select(.site==\"$site\")] | length") results

## Posts

EOF

  # Add post list
  echo $RESULTS | jq -r ".[] | select(.site==\"$site\") | \"- [\(.title)](\(.url)) (score: \(.score))\"" >> "$OUTPUT_DIR/$site.md"
done

echo "Inventory saved to $OUTPUT_DIR/"
```

---

### Competitive Analysis

Compare your content to competitors.

```bash
#!/bin/bash
# content-gap-analysis.sh

MY_SITE="blog"
COMPETITOR_TOPICS="content-strategy SEO WordPress-optimization"

echo "=== Content Gap Analysis ==="
echo ""

for topic in $COMPETITOR_TOPICS; do
  echo "Topic: $topic"

  # Count my content
  MY_COUNT=$(nexus search "$topic" --site $MY_SITE --format json | jq 'length')

  # Count competitor content (simulated - would be from scraping)
  COMPETITOR_COUNT=15  # Example

  echo "  My content: $MY_COUNT posts"
  echo "  Competitor: $COMPETITOR_COUNT posts"

  if [ $MY_COUNT -lt $COMPETITOR_COUNT ]; then
    GAP=$((COMPETITOR_COUNT - MY_COUNT))
    echo "  Gap: $GAP posts needed"
  else
    echo "  ✓ Ahead of competition"
  fi

  echo ""
done
```

---

## Database Operations

### Database Backup and Restore

```bash
# Export database
nexus wp mysite db export /tmp/mysite-backup.sql

# Export and compress
nexus wp mysite db export - | gzip > /tmp/mysite-backup.sql.gz

# Import database
nexus wp mysite db import /tmp/mysite-backup.sql

# Import compressed
gunzip < /tmp/mysite-backup.sql.gz | nexus wp mysite db import -

# Optimize database
nexus wp mysite db optimize

# Repair database
nexus wp mysite db repair

# Check database size
nexus wp mysite db size --human-readable
```

---

### Database Search and Replace

```bash
#!/bin/bash
# migrate-domain.sh

SITE=$1
OLD_DOMAIN=$2
NEW_DOMAIN=$3

echo "Migrating domain: $OLD_DOMAIN → $NEW_DOMAIN"

# Backup first
echo "Creating backup..."
nexus wp $SITE db export /tmp/${SITE}-pre-migration.sql

# Dry run to see what would change
echo ""
echo "Dry run results:"
nexus wp $SITE search-replace $OLD_DOMAIN $NEW_DOMAIN --dry-run

# Confirm
echo ""
read -p "Proceed with replacement? (y/N): " confirm
if [ "$confirm" != "y" ]; then
  echo "Migration cancelled"
  exit 0
fi

# Perform replacement
echo ""
echo "Performing replacement..."
nexus wp $SITE search-replace $OLD_DOMAIN $NEW_DOMAIN --skip-columns=guid

# Verify
echo ""
echo "Verifying..."
COUNT=$(nexus wp $SITE db query "SELECT COUNT(*) FROM wp_posts WHERE post_content LIKE '%$NEW_DOMAIN%'" --skip-column-names)
echo "Found $COUNT instances of new domain"

# Flush cache
echo ""
echo "Flushing cache..."
nexus wp $SITE cache flush

echo ""
echo "Migration complete"
echo "Backup: /tmp/${SITE}-pre-migration.sql"
```

---

## User Management

### Bulk User Operations

```bash
# List all users
nexus wp mysite user list --format=table

# Create admin user
nexus wp mysite user create johndoe john@example.com \
  --role=administrator \
  --user_pass=changeme \
  --first_name=John \
  --last_name=Doe

# Update user email
nexus wp mysite user update admin --user_email=newemail@example.com

# Delete spam users
nexus wp mysite user delete $(nexus wp mysite user list --role=subscriber --field=ID) --yes

# Reset password
nexus wp mysite user reset-password admin

# List users by role
nexus wp mysite user list --role=administrator --format=table
```

---

### User Audit

```bash
#!/bin/bash
# user-audit.sh

echo "=== User Audit ==="
echo ""

for site in $(nexus list --local --format json | jq -r '.[].name'); do
  echo "Site: $site"

  # Count users by role
  ADMINS=$(nexus wp $site user list --role=administrator --format=count)
  EDITORS=$(nexus wp $site user list --role=editor --format=count)
  AUTHORS=$(nexus wp $site user list --role=author --format=count)
  SUBSCRIBERS=$(nexus wp $site user list --role=subscriber --format=count)

  echo "  Administrators: $ADMINS"
  echo "  Editors: $EDITORS"
  echo "  Authors: $AUTHORS"
  echo "  Subscribers: $SUBSCRIBERS"

  # Check for old accounts
  OLD_USERS=$(nexus wp $site user list --format=json | jq '[.[] | select(.user_registered | fromdateiso8601 < (now - 31536000))] | length')
  echo "  Users inactive 1+ year: $OLD_USERS"

  echo ""
done
```

---

## Performance Optimization

### Cache Management

```bash
# Flush object cache
nexus wp mysite cache flush

# Purge page cache (WPE)
nexus wpe purge-cache mysite-production

# Clear transients
nexus wp mysite transient delete --all

# Clear expired transients
nexus wp mysite transient delete --expired

# Regenerate thumbnails
nexus wp mysite media regenerate --yes
```

---

### Performance Checks

```bash
#!/bin/bash
# performance-check.sh

SITE=$1

echo "=== Performance Check: $SITE ==="
echo ""

# Check database size
echo "Database size:"
nexus wp $SITE db size --human-readable

# Check for slow queries
echo ""
echo "Slow query check:"
nexus wp $SITE db query "SHOW PROCESSLIST" --skip-column-names

# Check autoload data
echo ""
echo "Autoload data size:"
AUTOLOAD=$(nexus wp $SITE db query "SELECT SUM(LENGTH(option_value)) FROM wp_options WHERE autoload='yes'" --skip-column-names)
echo "$((AUTOLOAD / 1024 / 1024)) MB"

# Check for large tables
echo ""
echo "Largest tables:"
nexus wp $SITE db query "
  SELECT table_name,
         ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
  FROM information_schema.TABLES
  WHERE table_schema = DATABASE()
  ORDER BY (data_length + index_length) DESC
  LIMIT 10
" --skip-column-names

# Check plugin count
echo ""
echo "Active plugins:"
nexus plugin list $SITE --status active --format=count

echo ""
echo "=== Check complete ==="
```

---

## Automation Scripts

### Scheduled Site Scans

Set up a cron job to scan sites nightly.

```bash
# Add to crontab
# crontab -e

# Scan all sites at 2 AM daily
0 2 * * * /usr/local/bin/nexus scan --quiet >> /var/log/nexus-scan.log 2>&1

# Update plugins on staging sites at 3 AM on Sundays
0 3 * * 0 /usr/local/bin/nexus bulk update-plugins --wpe --environment staging >> /var/log/nexus-update.log 2>&1

# Weekly health check on Mondays at 9 AM
0 9 * * 1 /home/user/scripts/weekly-maintenance.sh >> /var/log/nexus-maintenance.log 2>&1
```

---

### CI/CD Integration

Use Nexus in GitHub Actions or other CI/CD pipelines.

```yaml
# .github/workflows/deploy.yml
name: Deploy to WP Engine

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Install Nexus AI
        run: npm install -g @local-labs-jpollock/local-addon-nexus-ai

      - name: Configure WPE credentials
        run: |
          # Configure WPE auth (using secrets)
          echo "${{ secrets.WPE_SESSION }}" > ~/.wpe-session

      - name: Run tests on staging
        run: |
          nexus wp mysite-staging core verify-checksums
          nexus wp mysite-staging plugin verify-checksums --all

      - name: Deploy to production
        run: |
          nexus wpe backup mysite-production --description "CI deployment backup"
          nexus wpe promote mysite

      - name: Verify deployment
        run: |
          sleep 30
          nexus wpe diagnose mysite-production
```

---

## Troubleshooting

### Debug Mode

Enable debug output for troubleshooting.

```bash
# Enable debug logging
export NEXUS_DEBUG=true
nexus scan mysite

# Or inline
NEXUS_DEBUG=true nexus wp mysite plugin list

# Check logs
tail -f ~/.nexus/logs/nexus.log
```

---

### Connection Issues

Test connectivity to Local and WP Engine.

```bash
# Check Local connectivity
nexus list --local

# Check WPE authentication
nexus wpe accounts

# Test WP-CLI on specific site
nexus wp mysite cli info

# Test SSH to WPE (manual)
ssh -o ControlPath=~/.ssh/wpe-%r@%h:%p git@git.wpengine.com info
```

---

### Database Issues

Diagnose and fix database problems.

```bash
# Check database info
nexus db info

# Optimize database
nexus db optimize

# Check for corruption
nexus wp mysite db check

# Repair tables
nexus wp mysite db repair

# Re-index from scratch
nexus db reset --yes
nexus scan --force
```

---

## Integration Examples

### Using with Claude Desktop

Start the MCP server and ask Claude to perform tasks.

```bash
# Start MCP server
nexus mcp

# In Claude Desktop, you can now ask:
# "List all my WordPress sites"
# "Find posts about SEO on my blog"
# "Update plugins on mysite"
# "What version of WordPress is running on shop?"
```

---

### Using with Cursor

Configure Cursor to use Nexus AI MCP server.

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "nexus",
      "args": ["mcp"]
    }
  }
}
```

Then use natural language in Cursor:

- "Check which sites need WordPress updates"
- "Find all posts mentioning WooCommerce"
- "Show me the plugins installed on mysite"

---

## Next Steps

- [CLI Command Reference](../reference/cli-command-reference.md) - Complete command list
- [MCP Setup](mcp-setup.md) - Connect to AI assistants
- [Tool Reference](../mcp-tools/index.md) - All 90+ MCP tools
- [Troubleshooting](troubleshooting.md) - Common issues and solutions
