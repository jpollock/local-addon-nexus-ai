# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 15 |
| Error events | 0 |
| Duration | 136.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 18 |
| Output tokens | 6,546 |
| Cache creation | 44,325 |
| Cache read | 603,086 |
| **Total cost** | **$0.4454** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I can now map those together. Here's the full picture across your 29 sites with WordPress installed:

---

## WordPress Version Summary — 30 Local Sites

**Version files found:** 29 of 30 sites  
**No WP files:** `eval-test-onboard`, `raeinfo`, `test-site`, `wp-archaeologist-saas`

---

### By version group:

**7.0-RC2 / RC2-62197** (most current — 5 sites)
- `another-test`, `frostscape`, `jppblank` → 7.0-RC2-62197
- `cli-target`, `nexus-e2e-test` → 7.0-RC2

**7.0-RC1 / RC1-62112** (one version behind — 2 sites)
- `the-curated-shelf` → 7.0-RC1
- `nexus-test-site` → 7.0-RC1-62112

**7.0-beta6** (old beta — 4 sites)
- `e2e-test-fresh`, `nitropack-1`, `sync-test`, `test-cli-poc`

**6.9.4** (latest 6.9 stable — 5 sites)
- `acflikebutton`, `heathbiz`, `jpp0413p`, `local-copy-jpp`, `sprint1-test`

**6.9 / 6.9.1** (older 6.9 — 6 sites)
- `cli-test`, `migrate`, `wp-archaeologist`, `wp-events-analyzer`, `wp-migrate-pusher`, `wp-migrate-receiver-new` → 6.9
- `newsroom-admin-columns-poc` → 6.9.1

```