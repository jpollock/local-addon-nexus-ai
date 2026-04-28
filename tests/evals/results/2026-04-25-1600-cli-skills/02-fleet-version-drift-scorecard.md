# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 135.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 3,302 |
| Cache creation | 82,038 |
| Cache read | 625,772 |
| **Total cost** | **$0.5449** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a clear summary of your **local sites** that need WordPress updates (current stable: **6.9.4**):

---

## Local Sites Needing WordPress Updates

| Site | Current Version | Updates Behind | Priority |
|------|----------------|----------------|----------|
| `e2e-test-fresh` | 6.2.2 | Major | 🔴 Very old |
| `jeremypollock.blog` | 6.8.1 | 3 minor | 🟡 |
| `nexus` | 6.8.1 | 3 minor | 🟡 |
| `mu-plugin` | 6.8.1 | 3 minor | 🟡 |
| `offload-media-clean` | 6.8.2 | 2 minor | 🟡 |
| `pm-toolkit-hub` | 6.8.3 | 1 minor | 🟢 |
| `wp-events-analyzer` | 6.8.3 | 1 minor | 🟢 |
| `nitropack-2` | 6.8.3 | 1 minor | 🟢 |
| `wp-archaeologist` | 6.9 | 1 patch | 🟢 |
| `migrate` | 6.9 | 1 patch | 🟢 |
| `cli-test` | 6.9 | 1 patch | 🟢 |
| `wp-migrate-receiver-new` | 6.9 | 1 patch | 🟢 |
| `wp-migrate-pusher` | 6.9 | 1 patch | 🟢 |

**13 of your 31 local sites need updating.** The rest are already on 6.9.4 or pre-release 7.0 builds.

**Notable:** `e2e-test-fresh` is on 6.2.2 — over 2 years old. Since i
```