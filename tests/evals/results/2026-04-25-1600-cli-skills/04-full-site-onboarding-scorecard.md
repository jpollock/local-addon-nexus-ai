# Eval Scorecard: 04-full-site-onboarding (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 157 |
| Error events | 0 |
| Duration | 1244.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,188 |
| Cache creation | 14,363 |
| Cache read | 218,544 |
| **Total cost** | **$0.1373** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/04-full-site-onboarding-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
All sites are halted — which site did you want to set up AI on? (You'll also need to start it first since `nexus setup-ai` requires the site to be running.)
```