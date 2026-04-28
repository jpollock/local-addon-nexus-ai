# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 33.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 452 |
| Cache creation | 209,532 |
| Cache read | 323,141 |
| **Total cost** | **$0.8895** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1348-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
**jppblank** is running **WordPress 6.9.4** (data synced 2 days ago).
```