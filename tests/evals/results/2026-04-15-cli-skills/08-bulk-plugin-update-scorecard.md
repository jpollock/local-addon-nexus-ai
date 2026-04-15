# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 22.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 663 |
| Cache creation | 39,524 |
| Cache read | 116,907 |
| **Total cost** | **$0.1933** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Please approve the `nexus_list_sites` tool call so I can discover your local fleet.
```