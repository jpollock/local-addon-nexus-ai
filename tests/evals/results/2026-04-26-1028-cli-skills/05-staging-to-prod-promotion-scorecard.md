# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 121.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 2,944 |
| Cache creation | 99,482 |
| Cache read | 945,830 |
| **Total cost** | **$0.7010** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1028-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Done. Here's a summary of what happened:

1. **Backup created** — Production (`jppwpeplugin`) backed up with ID `125a5160-be27-410c-9aed-2f4368a5f6df`. Polled until confirmed complete before proceeding.
2. **Promote completed** — `jppwpeplugistg` (staging) → `jppwpeplugin` (production) promoted successfully.

WP Engine handles the actual copy asynchronously on their end, but the promotion job has been initiated. The rollback point (that backup) is available if anything looks off on production.
```