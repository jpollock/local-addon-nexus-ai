# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 10 |
| Error events | 0 |
| Duration | 67.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 2,435 |
| Cache creation | 41,996 |
| Cache read | 351,368 |
| **Total cost** | **$0.2995** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what's available across your running fleet:

**frostscape** (2 updates)

| Plugin | Current | Available | Type |
|--------|---------|-----------|------|
| AI | 0.6.0 | 0.7.0 | minor |
| WPGraphQL | 2.11.1 | 2.11.2 | **patch** |

**jppblank** (3 updates)

| Plugin | Current | Available | Type |
|--------|---------|-----------|------|
| Advanced Custom Fields | 6.7.0 | 6.8.0 | minor |
| AI | 0.6.0 | 0.7.0 | minor |
| Genesis Blocks | 3.1.7 | 3.1.8 | **patch** |

**Summary:** 5 updates across 2 sites — all are minor or patch bumps. No major version upgrades to skip.

Your other 28 sites are halted (not running), so they can't be updated right now without starting them first.

Ready to apply all 5? Or do you want to be selective about any of them?
```