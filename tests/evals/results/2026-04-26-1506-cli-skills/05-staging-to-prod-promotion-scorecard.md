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
| Duration | 106.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 17 |
| Output tokens | 3,225 |
| Cache creation | 18,550 |
| Cache read | 1,182,465 |
| **Total cost** | **$0.4727** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Done. Here's what happened:

1. **Backup created** — production (`jppwpeplugin`) backed up as `7b8f0863-366e-447c-96e1-5f81186a353e` with description "Pre-promote backup before staging push"
2. **Promotion complete** — staging (`jppwpeplugistg`) pushed to production (`jppwpeplugin`)

WP Engine handles promotions asynchronously on their end, so the live site may take a minute to fully reflect the staging content.
```