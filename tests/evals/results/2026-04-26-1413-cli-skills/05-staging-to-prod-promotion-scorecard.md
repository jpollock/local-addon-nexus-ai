# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 38.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,118 |
| Cache creation | 16,072 |
| Cache read | 640,923 |
| **Total cost** | **$0.2693** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
You need to authenticate with WP Engine first. This will open a browser window.

Should I run `nexus wpe login` to start the OAuth flow?
```