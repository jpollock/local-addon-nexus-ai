# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 48.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 1,324 |
| Cache creation | 42,283 |
| Cache read | 324,197 |
| **Total cost** | **$0.2757** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1918-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The WPE API doesn't expose the WordPress version directly in these endpoints. The CAPI install data (PHP version, environment) doesn't include WP version — that would require SSH/SFTP access or a WP-CLI call on a local copy.

**jppblank** is a WP Engine hosted site. The WPE CAPI doesn't expose the WordPress version in the install metadata — it shows PHP 8.2 but not the WP version. To get the exact WP version, you'd need to either:

1. Pull the site locally with `nexus pull jppblank` and run `nexus wp core version jppblank`
2. Check the WP Engine dashboard directly for that install
```