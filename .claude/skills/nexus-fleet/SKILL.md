---
name: nexus-fleet
description: Get health, status, and analytics across all local WordPress sites. Shows plugin outdates, WP version drift, site issues, and bulk action opportunities. Use for fleet-wide monitoring and maintenance planning.
allowed-tools: Bash(nexus *)
---

# Fleet Health Overview

```!
nexus fleet health
```

Analyze the fleet report:

1. **Critical issues** — any ❌ failures that need immediate attention (name the sites)
2. **Plugin updates available** — how many sites, which plugins, bulk update opportunity
3. **WP version drift** — sites not on the latest version
4. **Inactive sites** — halted sites that may be stale
5. **WPE sync status** — sites with/without WPE connections

If `$ARGUMENTS` is provided, filter results to that specific concern (e.g., `/nexus-fleet plugins` or `/nexus-fleet outdated`).

## Suggested actions

Based on the health report, propose specific next steps:
- Bulk plugin updates: `nexus bulk plugin-update --all`
- Individual site fixes: `nexus wp health --site <name>`
- Sites to review: list by priority

Keep the response actionable — every finding should have a "fix it with" command.
