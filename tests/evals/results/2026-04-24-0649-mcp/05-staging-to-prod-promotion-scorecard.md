# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 6 |
| Error events | 0 |
| Duration | 107.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 2,011 |
| Cache creation | 121,983 |
| Cache read | 696,640 |
| **Total cost** | **$0.6966** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The promotion is underway. Here's a summary of what happened:

1. **Backup created** — production (`jppwpeplugin`) backed up before any changes, backup ID `ff04c56d-8e6b-4711-a664-5f51240f825c`
2. **Promotion initiated** — `jppwpeplugistg` → `jppwpeplugin`, files + database

The copy typically takes a few minutes. You can monitor progress in the WP Engine portal. Once complete, you may want to purge the production cache with `wpe_purge_cache` and verify with `wpe_diagnose_site`.
```