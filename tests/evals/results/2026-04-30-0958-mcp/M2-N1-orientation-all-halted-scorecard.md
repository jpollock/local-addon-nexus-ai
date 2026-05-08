# Eval Scorecard: M2-N1-orientation-all-halted (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Duration | 31.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 466 |
| Cache creation | 140,138 |
| Cache read | 0 |
| **Total cost** | **$0.5325** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M2-N1-orientation-all-halted-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
No local sites have WooCommerce installed based on the current index. This could mean either none of your sites actually have it, or the sites haven't been indexed yet (the search reads from the content index, not a live filesystem scan).

If you think WooCommerce should be there, you could start one or more sites and run a reindex to pick up their plugin data.
```