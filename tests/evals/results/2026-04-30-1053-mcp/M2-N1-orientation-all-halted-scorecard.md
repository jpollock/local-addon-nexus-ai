# Eval Scorecard: M2-N1-orientation-all-halted

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 91.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 215 |
| Output tokens | 78 |
| Total tokens | 293 |
| Estimated cost | $0.0018 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 18 |
| Tool results | 82 |
| Skill prompts | 0 |
| Conversation | 193 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 85 | 20% |
| completeness | 80 | 20% |
| output clarity | 90 | 20% |
| **Weighted total** | **91.0** | |

## Reviewer Notes

Answered from index even with halted premise. Caveat about index freshness is exactly right.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M2-N1-orientation-all-halted
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 29.7s
Tool calls: 1
Cost: $0.1217

============================================================
TURN 1
============================================================
PROMPT: Which of my local sites have WooCommerce installed? All my sites are currently stopped.

Using `find_sites_with_plugin` to search for WooCommerce across your fleet — this works even with stopped sites.

⏺ mcp__local-nexus-ai__find_sites_with_plugin({"plugin":"woocommerce"})
  ⎿  No indexed sites have a plugin matching "woocommerce".
None of your indexed local sites have WooCommerce installed. This result comes from the content index, so it's only as current as the last time each site was indexed. If you've recently added WooCommerce to a site that hasn't been reindexed, it wouldn't show up here.

--- FINAL RESULT ---
None of your indexed local sites have WooCommerce installed. This result comes from the content index, so it's only as current as the last time each site was indexed. If you've recently added WooCommerce to a site that hasn't been reindexed, it wouldn't show up here.

```