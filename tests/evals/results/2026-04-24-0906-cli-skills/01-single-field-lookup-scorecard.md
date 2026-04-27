# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 15 |
| Error events | 0 |
| Duration | 234.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 18 |
| Output tokens | 2,335 |
| Cache creation | 151,149 |
| Cache read | 1,093,239 |
| **Total cost** | **$0.9299** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0906-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `install` details don't include WP version and `diagnose` is returning 500 from the WPE API. Unfortunately, the nexus WPE commands don't expose WordPress version directly via the CAPI — it's not a field returned by the installs endpoint, and the `diagnose` API is currently erroring.

The WordPress version for **jppblank** isn't available through the WPE API right now. To get it, you could:
1. SSH into the environment: `ssh jppblank@jppblank.ssh.wpengine.net` and run `wp core version`
2. Start Local and run `nexus wp core version jppblank` once Local is running
```