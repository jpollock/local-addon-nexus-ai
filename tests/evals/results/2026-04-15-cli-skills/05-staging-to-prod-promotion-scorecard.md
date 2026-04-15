# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 143.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 62 |
| Output tokens | 4,350 |
| Cache creation | 59,571 |
| Cache read | 763,742 |
| **Total cost** | **$0.5179** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The promotion failed because the GraphQL resolver in `resolvers.ts:3914` has a bug — it sends the wrong field names to CAPI (`source_install_id` instead of `source_environment_id`, and a flat `include_database` instead of the nested `custom_options` format that the CAPI `/install_copy` endpoint expects).

I found this by comparing against the MCP handler (`promote-environment.ts:129`) which has the correct field names.

The fix is a 3-line change in `resolvers.ts`. Once fixed, I'll rebuild and retry the promotion. The production backup is already done (ID: `7d3b805f-40d3-4e2f-8e78-3b1fc8f66aef`).

Do you want me to:
1. Fix the bug, rebuild, and complete the promotion?
2. Just fix the bug (and you'll test separately)?
```