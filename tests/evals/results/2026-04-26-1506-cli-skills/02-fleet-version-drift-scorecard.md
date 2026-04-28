# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 11 |
| Error events | 0 |
| Duration | 120.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 14 |
| Output tokens | 5,846 |
| Cache creation | 27,345 |
| Cache read | 929,334 |
| **Total cost** | **$0.4691** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have the full picture now. Here's the WP version summary across your 30 local sites:

---

## WordPress Version Summary — Local Sites

**Latest stable: 6.9.4**

### ✅ Up to date (6.9.4) — 5 sites
- `acflikebutton`, `heath.biz`, `local-copy-jpp`, `jpp0413p`, `nexus-e2e-cli-test-site`

### 🧪 Pre-release / test (7.0-beta/RC) — 6 sites
*(Likely intentional — test environments)*
- **7.0-RC2**: `cli-target`, `nexus-e2e-test`
- **7.0-RC1**: `The Curated Shelf`
- **7.0-beta6**: `nitropack-1`, `test-cli-poc`, `sync-test`

---

### ⚠️ Behind — 13 sites need updates

| WP Version | Sites | How far behind |
|---|---|---|
| **6.9** | `wp-archaeologist`, `migrate`, `cli-test`, `wp-migrate-receiver-new`, `wp-migrate-pusher` | 1 minor (6.9 → 6.9.4) |
| **6.8.3** | `pm-toolkit-hub`, `wp-events-analyzer`, `nitropack-2` | 2 minors |
| **6.8.2** | `offload-media-clean` | 2 minors |
| **6.8.1** | `jeremypollock.blog`, `nexus`, `mu-plugin` | 2 minors |
| **6.2.2** | `e2e-test-fresh` | Very old — 7 minor 
```