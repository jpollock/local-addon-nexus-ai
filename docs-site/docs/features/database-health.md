---
title: Database Health
description: Scan, score, and safely clean WordPress database bloat on local sites
keywords: [database, health, bloat, revisions, transients, postmeta, cleanup, scanner]
---

# Database Health

Nexus AI scans your local WordPress databases for bloat, scores them 0–100, and provides advisor-voice recommendations with safe, dry-run-first cleanup.

## What It Does

1. **Scan** — Runs a series of SQL queries against the site's database (via `wp eval` + `$wpdb`) to measure every major category of bloat.
2. **Score** — Combines the results into a single 0–100 health score using a penalty-based algorithm.
3. **Recommend** — Returns human-readable, advisor-voice recommendations with prevention tips and plugin attribution.
4. **Clean** — Deletes identified bloat via `nexus wp db clean`. Dry-run is the default; real deletion requires explicit confirmation.

## What Gets Scanned

| Category | Details |
|----------|---------|
| **Post revisions** | Count, estimated size, top posts by revision count |
| **Orphaned postmeta** | Rows with no matching post; meta keys attributed to known plugins |
| **Expired transients** | Expired and total count, estimated size |
| **Autoload bloat** | Total autoloaded option size; large entries identified by option name |
| **Ghost plugin tables** | Tables in the database not matching any active plugin — likely leftovers from deleted plugins |
| **Auto-drafts** | Posts stuck in `auto-draft` status |
| **Trash** | Posts in `trash` status |
| **WooCommerce (if active)** | Expired sessions, old log entries |

### Plugin Attribution

Orphaned postmeta rows are broken down by `meta_key` and attributed to likely source plugins (e.g., Yoast, WooCommerce, ACF) so you know which plugin left the data behind and whether it's safe to remove.

Ghost plugin tables are similarly attributed when a match can be identified.

## Health Score Algorithm

The score starts at 100 and penalties are subtracted (floor of 0):

| Condition | Penalty |
|-----------|---------|
| Post revisions > 500 | −10 |
| Post revisions > 2,000 | −20 (replaces −10) |
| Expired transients > 100 | −10 |
| Expired transients > 500 | −20 (replaces −10) |
| Orphaned postmeta > 500 | −5 |
| Orphaned commentmeta > 500 | −5 |
| Auto-drafts > 50 | −5 |
| Trashed posts > 50 | −5 |
| Ghost plugin tables | −5 per table, max −15 |
| WooCommerce sessions > 1,000 | −10 |
| Total DB size > 500 MB | −5 |
| Total DB size > 1,000 MB | −15 (replaces −5) |

Score bands: **green** ≥ 80 · **yellow** 50–79 · **red** < 50

## Advisor Voice

Recommendations are written in plain, advisor language — not raw numbers. For example:

> "Your database has 2,400 post revisions, which is inflating its size by roughly 40%. Most of these come from the page builder editing workflow. Consider enabling a revision limit (e.g., `define('WP_POST_REVISIONS', 10)` in `wp-config.php`) to prevent future accumulation."

Each recommendation includes:
- What the problem is and why it matters
- Which plugin or workflow caused it (when detectable)
- How to prevent it from recurring
- The WP-CLI command to clean it up

## CLI Usage

```bash
# Scan a site and display the health report
nexus wp db scan <site>

# Preview what would be deleted (dry-run, safe)
nexus wp db clean <site>

# Actually delete (prompts for confirmation)
nexus wp db clean <site> --no-dry-run

# Target specific item types
nexus wp db clean <site> --items post_revisions,expired_transients --no-dry-run

# Fleet report — scan all running sites, ranked by score
nexus wp db report

# Machine-readable output
nexus wp db scan <site> --json
```

## MCP Tool Usage

Four MCP tools cover the full workflow:

```
scan_database_health(site_id)
  → Scans the database and returns structured JSON + summary bullets.
  → Tier 1 (read-only, no confirmation needed).

get_database_recommendations(site_id)
  → Returns markdown recommendations with WP-CLI fix commands.
  → Uses cached scan result if available.
  → Tier 1.

clean_database_items(site_id, items?, dry_run?)
  → Cleans identified bloat. dry_run defaults to true.
  → Tier 3 — requires confirmation token for real deletion.

fleet_database_health()
  → Scans all running local sites, returns ranked list by score.
  → Tier 1.
```

Example conversation:

```
You: "Which of my local sites have the worst database health?"

Claude: [calls fleet_database_health]
        → Returns ranked list. Worst site: myshop (score 41).

You: "What's causing it?"

Claude: [calls get_database_recommendations(myshop)]
        → "Your main issue is 3,100 WooCommerce sessions..."

You: "Clean the safe stuff."

Claude: [calls clean_database_items(myshop, dry_run=true)]
        → Preview: would delete 3,100 WC sessions, 800 expired transients...
        → "Run again with dry_run=false to apply? (requires CONFIRM token)"
```

## UI — Site Card

The **Database Health** row appears in the Nexus section of every local site card:

```
Database Health   ● 85/100        [Re-scan]
Top DB issue      800 expired transients
```

- Color-coded score dot (green / yellow / red / gray if not yet scanned)
- Top issue shown inline
- Re-scan button triggers a fresh scan in the background

## Why Local Only

The database scanner runs raw SQL via `wp eval` + `$wpdb->get_results()`. This requires direct database access that is only available for local sites. Remote WP Engine installs cannot be scanned this way. The CLI and MCP tools will return a clear error if a remote site is targeted.

This is also the right environment for cleanup: local sites carry no production risk, and you can verify results before pushing changes upstream.

## What's NOT Included (Yet)

- **Media library** — Large or orphaned media files are not included in the scan. This is on the future roadmap.
- **Remote WPE sites** — Requires direct DB access; not available over SSH-restricted WP-CLI.

## Next Steps

- [Safety System](safety-system.md) — How `clean_database_items` Tier 3 protection works
- [WP-CLI Integration](wp-cli-integration.md) — How `nexus wp db` commands execute
- [CLI Commands](../cli/commands.md) — Full `nexus wp db` reference
