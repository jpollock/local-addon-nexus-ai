# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 41.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 1,657 |
| Cache creation | 109,342 |
| Cache read | 106,327 |
| **Total cost** | **$0.4668** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a summary of your local WordPress sites and their update status:

## WordPress Version Summary

The tool found **364 local sites** in scope. The latest stable is **6.9.4** (7.0 is still in beta/RC).

### Sites on 7.0 Pre-release (10 sites)
These are ahead of stable — on beta/RC builds:
| Version | Sites |
|---|---|
| 7.0-RC2 | cli-target, nexus-e2e-test, testjpp1, testjppdev, jppblank (×2) |
| 7.0-RC1 | The Curated Shelf |
| 7.0-RC1-62112 | nexus-test-site |
| 7.0-RC2-62241 | another-test, nexustestsite1 |

### Sites Behind 6.9.4 (40 named sites, mostly test sites)
| Version | Count | Notable sites |
|---|---|---|
| 6.9.1 | 20 | newsroom-admin-columns-poc, nexus-e2e-crud-test, my-site, jppblankdev |
| 6.9 | 6 | wp-archaeologist, cli-test, migrate, wp-migrate-pusher/receiver, hello-wp-engine |
| 6.8.3 | 3 | nitropack-2, wp-events-analyzer, pm-toolkit-hub |
| 6.8.2 | 1 | offload-media-clean |
| 6.8.1 | 6 | nexus, jeremypollock.blog, mu-plugin, wave, spanishsummertrip, FamilyFourSp
```