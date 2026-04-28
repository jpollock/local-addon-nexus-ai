# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Duration | 14.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 161 |
| Cache creation | 106,044 |
| Cache read | 105,858 |
| **Total cost** | **$0.4318** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
jppblank is running **WordPress 6.9.4**.
```