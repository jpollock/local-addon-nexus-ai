# Eval Scorecard: M3-01-find-content-by-topic (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 50.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 1,394 |
| Cache creation | 12,969 |
| Cache read | 431,022 |
| **Total cost** | **$0.1989** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M3-01-find-content-by-topic-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what turned up across your fleet:

---

**Matches found: 1 result across 1 site**

| Site | Content | Type | Notes |
|---|---|---|---|
| Newsroom Demo | "Do you buy souvenirs on holiday?" | Poll | Tangentially shopping-related — not true e-commerce content |

---

**No e-commerce content found on:**
- `nexus-e2e-test` (528 docs — test content, not product/shop content)
- `local-copy-jpp` (190 docs)
- `ACF Auto Car Finder` (63 docs — car listings, not a shop)
- `jeremypollockblog`, `jpp0413p`, `nexus`, `nitropack-1` (minimal content, 2–3 docs each)

**Bottom line:** None of your indexed sites have meaningful e-commerce or online shopping content. The fleet doesn't appear to have a WooCommerce store or similar set up with real product/cart/checkout content.

If you were expecting to find something, a few possibilities:
1. A site hasn't been indexed yet — run `reindex_site` on it
2. The relevant site is halted and wasn't indexed with live DB access (halted sites get shallow indexes
```