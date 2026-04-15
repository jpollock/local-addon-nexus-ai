# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 15.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 308 |
| Cache creation | 38,448 |
| Cache read | 76,155 |
| **Total cost** | **$0.1717** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I need permission to list sites. Could you approve the `nexus_list_sites` tool call? Once I have the site ID for jppblank, I can check its WordPress version.
```