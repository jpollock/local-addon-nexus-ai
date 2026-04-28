# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 69.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,886 |
| Cache creation | 26,272 |
| Cache read | 558,806 |
| **Total cost** | **$0.2945** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The promotion is underway. Here's what was done:

1. **Backup created & verified** — production `jppwpeplugin` backup ID `52976d2f` completed before anything was touched.
2. **Promotion initiated** — `jppwpeplugistg` (staging) → `jppwpeplugin` (production), files + database included.

The copy typically takes a few minutes. You can monitor progress in the WP Engine portal, and once it completes, it's worth running `wpe_purge_cache` on production to ensure visitors get fresh content.
```