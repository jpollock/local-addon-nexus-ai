# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 12 |
| Error events | 0 |
| Duration | 70.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 2,706 |
| Cache creation | 40,843 |
| Cache read | 462,449 |
| **Total cost** | **$0.3325** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found:

---

**Fleet Overview: 29 local sites, 2 running, 27 halted**

## Running Sites (version-checked)

| Site | WordPress Version | Status |
|------|-------------------|--------|
| frostscape | **7.0-RC2-62197** | Pre-release |
| jppblank | **7.0-RC2-62197** | Pre-release |

Both running sites are on **7.0-RC2** — a release candidate, not a stable build. Once WordPress 7.0 goes GA, both will need updating to the stable release.

## Halted Sites (27 sites — versions unknown)

WP-CLI can't be run on halted sites, so their WordPress versions aren't checkable without starting them:

`jeremypollock.blog`, `nexus`, `mu-plugin`, `offload-media-clean`, `nitropack-1`, `pm-toolkit-hub`, `wp-events-analyzer`, `nitropack-2`, `wp-archaeologist`, `wp-archaeologist-saas`, `migrate`, `cli-test`, `cli-target`, `wp-migrate-receiver-new`, `wp-migrate-pusher`, `newsroom-admin-columns-poc`, `The Curated Shelf`, `nexus-test-site`, `acflikebutton`, `test-cli-poc`, `another-test`, `sync-test
```