# Eval Scorecard: M2-02-orientation-running-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 18.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 378 |
| Cache creation | 42,950 |
| Cache read | 84,686 |
| **Total cost** | **$0.1922** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0621-cli-skills/M2-02-orientation-running-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
None of your local sites are currently running — all 8 are halted.

Your local sites:
- `nexus-e2e-test`
- `jeremypollockblog`
- `jpp0413p`
- `nexus`
- `nitropack-1`
- `ACF Auto Car Finder` (linked to WPE production)
- `local-copy-jpp` (linked to WPE production)
- `Newsroom Demo`

To start one, use Local's UI or run it from the app. Most nexus operations (WP-CLI, search, etc.) require the site to be running first.
```