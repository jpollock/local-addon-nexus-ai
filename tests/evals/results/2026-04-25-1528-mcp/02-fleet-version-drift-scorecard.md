# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 85.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 3,779 |
| Cache creation | 34,243 |
| Cache read | 193,752 |
| **Total cost** | **$0.2432** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your local WordPress version summary across all 30 sites. Note: the index is **55 days stale** and all sites are currently halted, so treat this as a snapshot, not live state.

---

## WordPress Version Status — Local Sites

**Latest detected:** `7.0-beta6` (pre-release — none of your sites are on this yet)

### Pre-release / RC — Close to Current
These sites are already running WP 7.0 release candidates:

| Site | Version |
|------|---------|
| cli-target | 7.0-RC2 |
| another-test | 7.0-RC2-62241 |
| nexustestsite1 | 7.0-RC2-62241 |
| nexus-e2e-test | 7.0-RC2 |
| The Curated Shelf | 7.0-RC1 |
| nexus-test-site | 7.0-RC1-62112 |

### 6.9.x — One Major Behind (11 sites)
| Site | Version |
|------|---------|
| heath.biz | 6.9.4 |
| local-copy-jpp | 6.9.4 |
| jpp0413p | 6.9.4 |
| acflikebutton | 6.9.4 |
| frostscape | 6.9.4 |
| eval-test-onboard | 6.9.4 |
| wp-archaeologist | 6.9 |
| cli-test | 6.9 |
| migrate | 6.9 |
| wp-migrate-receiver-new | 6.9 |
| wp-migrate-pusher | 6.9 |


```