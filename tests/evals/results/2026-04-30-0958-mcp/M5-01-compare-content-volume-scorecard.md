# Eval Scorecard: M5-01-compare-content-volume (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 27.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 772 |
| Cache creation | 12,271 |
| Cache read | 208,756 |
| **Total cost** | **$0.1202** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M5-01-compare-content-volume-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your sites ranked by content (indexed documents):

| Rank | Site | Docs | Chunks |
|------|------|------|--------|
| 1 | **nexus-e2e-test** | 528 | 528 |
| 2 | **local-copy-jpp** | 190 | 222 |
| 3 | **Newsroom Demo** | 121 | 151 |
| 4 | **ACF Auto Car Finder** | 63 | 71 |
| 5 | nexus | 3 | 3 |
| 6 | jeremypollockblog | 2 | 2 |
| 7 | jpp0413p | 2 | 2 |
| 8 | nitropack-1 | 2 | 2 |

**nexus-e2e-test** is the runaway winner with 528 docs — nearly 3× more than everything else combined. That's likely seeded test content. **local-copy-jpp** is the largest "real" site at 190 docs, and **Newsroom Demo** follows at 121.
```