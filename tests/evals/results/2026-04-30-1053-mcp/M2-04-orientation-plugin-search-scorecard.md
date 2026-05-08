# Eval Scorecard: M2-04-orientation-plugin-search

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 87.5/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 1 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 704 |
| Output tokens | 352 |
| Total tokens | 1,056 |
| Estimated cost | $0.0074 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 54 |
| Tool results | 123 |
| Skill prompts | 0 |
| Conversation | 879 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 80 | 20% |
| completeness | 75 | 30% |
| output clarity | 90 | 10% |
| **Weighted total** | **87.5** | |

## Reviewer Notes

Confirmed no WooCommerce locally from index. WPE heuristic honest, offered SSH verification.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M2-04-orientation-plugin-search
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 96.1s
Tool calls: 4
Cost: $0.2113

============================================================
TURN 1
============================================================
PROMPT: Which of my sites have WooCommerce installed? Include both local and WPE sites.

Using the `nexus-fleet` skill to guide this fleet-wide plugin query.

⏺ Skill({"skill":"nexus-fleet"})
  ⎿  Shell command failed for pattern "```!
nexus fleet health
```": [stderr]
(eval):1: command not found: nexus
Searching for WooCommerce across all indexed sites using the MCP tool directly.

⏺ mcp__local-nexus-ai__find_sites_with_plugin({"plugin":"woocommerce"})
  ⎿  No indexed sites have a plugin matching "woocommerce".
No results from the indexed store. Let me also check the twin cache (which covers halted sites too) and verify WPE sites are synced.

⏺ mcp__local-nexus-ai__nexus_fleet_plugins({"search":"woocommerce"})

⏺ mcp__local-nexus-ai__nexus_list_sites({})
  ⎿  No plugins found matching "woocommerce" across 8 sites (8 with full data).

Run `nexus fleet refresh` to populate twin data.
  ⎿  ## Fleet (8 local, 306 WPE)

Local sites = development copies. WP Engine installs = live environments.
↔ indicates a linked pair (same site, different environments).

### Local Sites
- **nexus-e2e-test** (nexus-e2e-test.local) [running]
- **jeremypollockblog** (jeremypollockblog.local) [running]
- **jpp0413p** (jpp0413p.local) [running]
- **nexus** (nexus.local) [running]
- **nitropack-1** (nitropack-1.local) [running]
- **ACF Auto Car Finder** (acf-auto-car-finder.local) [running]
- **local-cop
Here's what the data shows:

**Local sites (8 total):** None of your local sites have WooCommerce installed — confirmed across both the twin cache and the content index.

**WPE sites (306 total):** Plugin-level data for WPE installs isn't indexed locally (that would require SSH deep-refresh on each instal
... [truncated]
```