# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 22.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 517 |
| Cache creation | 38,691 |
| Cache read | 114,638 |
| **Total cost** | **$0.1873** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I need permission to connect to your Local sites to check WordPress versions. Please approve the `nexus_list_sites` tool call when prompted, and then I'll check each site's WP version in parallel.
```