# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 12 |
| Error events | 0 |
| Duration | 155.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 1,746 |
| Cache creation | 80,128 |
| Cache read | 934,179 |
| **Total cost** | **$0.6070** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0911-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The WPE API doesn't expose the WordPress version directly, and Local isn't running so WP-CLI can't reach the site. The install details show PHP 8.2 but WP version isn't included in the CAPI response. To get the WordPress version for jppblank, you'd need to either:

1. **Start Local** and have jppblank pulled locally, then `nexus wp core version jppblank` would work
2. **SSH into the WPE environment** directly and run `wp core version`

The WP Engine CAPI doesn't return WordPress version in install metadata — it's only available via WP-CLI access to the running site.
```