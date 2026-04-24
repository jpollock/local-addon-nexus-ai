# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 24.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 552 |
| Cache creation | 22,762 |
| Cache read | 184,128 |
| **Total cost** | **$0.1489** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The audit only runs on currently running sites, and you only have **1 site running** (`eval-test-onboard`) — which already has **0 updates available**.

Here's the situation:

**Running sites audited:** 1 of 30
- `eval-test-onboard` — 2 plugins, **0 updates available**

**29 sites are halted** and can't be audited (WP-CLI requires the site to be running to check plugin versions).

**Your options:**

1. **Start sites selectively** — I can start specific halted sites you care about, audit them, apply safe minor/patch updates, then stop them again. Which sites do you want to target?

2. **Start all sites** — I can work through the fleet in batches (start → audit → update → stop), though that's 29 sites and will take a while.

3. **Accept the current result** — If `eval-test-onboard` is the only site you're actively using, you're already up to date.

Which approach would you like?
```