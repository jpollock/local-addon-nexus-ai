# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 9 |
| Error events | 0 |
| Duration | 125.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 2,668 |
| Cache creation | 17,346 |
| Cache read | 399,124 |
| **Total cost** | **$0.2248** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1842-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a full breakdown of your 37 sites running outdated WordPress versions (current stable: **6.9.4**):

---

## WordPress Version Drift Summary

### Minor behind — 6.9.x (21 sites)

| Version | Count | Sites |
|---------|-------|-------|
| **6.9.1** | 15 | `newsroom-admin-columns-poc` [local], `atlasshopify`, `atlasshopifstg`, `donaghtestsit1`, `foruxdemo`, `bulkserp06`, `newsroomdemstg`, `localcopyjpp`, `asaitkprod`, `ainewsroomstg`, `jsvectordbtest`, `aitoolkitdemo`, `nitropackio`, `kruchmireviews`, `dcxsn` [all WPE unless noted] |
| **6.9** | 6 | `wp-archaeologist`, `migrate`, `cli-test`, `wp-migrate-receiver-new`, `wp-migrate-pusher` [all local], `testblankjpp1` [WPE] |

### One major version behind — 6.8.x (8 sites)

| Version | Count | Sites |
|---------|-------|-------|
| **6.8.3** | 4 | `pm-toolkit-hub`, `wp-events-analyzer`, `nitropack-2` [local], `erinstestsite` [WPE] |
| **6.8.2** | 1 | `offload-media-clean` [local] |
| **6.8.1** | 3 | `jeremypollock.blog`, `nexus`, `mu-p
```