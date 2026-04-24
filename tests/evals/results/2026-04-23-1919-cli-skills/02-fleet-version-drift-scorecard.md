# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 10 |
| Error events | 0 |
| Duration | 102.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 13 |
| Output tokens | 4,945 |
| Cache creation | 20,139 |
| Cache read | 445,821 |
| **Total cost** | **$0.2835** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1919-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a clear summary of WP version status across your 33 local sites (data from the twin cache):

---

## WordPress Version Summary

The current stable is **6.9.4**. Here's how your local sites break down:

### Behind on Stable (14 sites need updates)

**Mildly behind — 6.9.x**
| Site | Version | Gap |
|------|---------|-----|
| newsroom-admin-columns-poc | 6.9.1 | 1 patch |
| wp-archaeologist | 6.9 | 2 patches |
| migrate | 6.9 | 2 patches |
| cli-test | 6.9 | 2 patches |
| wp-migrate-receiver-new | 6.9 | 2 patches |
| wp-migrate-pusher | 6.9 | 2 patches |

**Moderately behind — 6.8.x**
| Site | Version | Gap |
|------|---------|-----|
| pm-toolkit-hub | 6.8.3 | ~1 minor |
| wp-events-analyzer | 6.8.3 | ~1 minor |
| nitropack-2 | 6.8.3 | ~1 minor |
| offload-media-clean | 6.8.2 | ~1 minor |
| jeremypollock.blog | 6.8.1 | ~1 minor |
| nexus | 6.8.1 | ~1 minor |
| mu-plugin | 6.8.1 | ~1 minor |

**Significantly behind**
| Site | Version | Gap |
|------|---------|-----|
| e2e-test-fres
```