# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 16 |
| Error events | 0 |
| Duration | 329.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 18 |
| Output tokens | 4,105 |
| Cache creation | 85,803 |
| Cache read | 1,228,509 |
| **Total cost** | **$0.7519** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/05-staging-to-prod-promotion-transcript.txt

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

1. **Backup created** — `jppwpeplugin` (production) was backed up with ID `ccfa4c98-acf0-4d6c-8b11-5d5edc8288e6`. Waited for it to reach `completed` status before proceeding.

2. **Promotion complete** — `jppwpeplugistg` (staging) was promoted to `jppwpeplugin` (production). WPE has kicked off the copy; the promotion runs asynchronously on their end.

The production site at `jppwpeplugin.wpenginepowered.com` should reflect the staging content within a few minutes. If anything looks wrong, the pre-promotion backup is available to restore from.
```