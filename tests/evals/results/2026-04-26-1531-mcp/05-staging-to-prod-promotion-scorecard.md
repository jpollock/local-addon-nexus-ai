# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 91.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 1,793 |
| Cache creation | 37,664 |
| Cache read | 894,693 |
| **Total cost** | **$0.4366** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
All done. Here's a summary of what was done:

1. **Backup created** — Production (`jppwpeplugin`) was backed up and verified before any changes (backup ID: `b9633db9-4cb6-46af-8b11-c59e837d34d3`).
2. **Promotion initiated** — `jppwpeplugistg` (staging) → `jppwpeplugin` (production), including files and database.
3. **Cache purged** — Production cache cleared so visitors get fresh content immediately.

The copy typically takes a few minutes. You can monitor progress in the WP Engine portal. If anything looks wrong after the promote completes, the pre-promote backup is available for restore.
```