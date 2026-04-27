# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 87.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 3,230 |
| Cache creation | 27,229 |
| Cache read | 200,743 |
| **Total cost** | **$0.2108** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a summary of your **local sites** (30 sites in Local) and their WordPress version status:

> **Note:** The content index is 53 days stale, so these versions may not reflect recent updates. The "latest" detected across the fleet is 7.0-beta6 (pre-release); latest **stable** is 6.9.4.

---

### RC / Pre-release sites (close to current)
| Site | Version | Gap |
|------|---------|-----|
| cli-target | 7.0-RC2 | 1 RC behind |
| another-test | 7.0-RC2-62241 | Build behind |
| nexustestsite1 | 7.0-RC2-62241 | Build behind |
| The Curated Shelf | 7.0-RC1 | 1 RC behind |
| nexus-test-site | 7.0-RC1-62112 | Build behind |

### On stable 6.9.x (current stable branch)
| Site | Version |
|------|---------|
| heath.biz | 6.9.4 |
| local-copy-jpp | 6.9.4 |
| jpp0413p | 6.9.4 |
| acflikebutton | 6.9.4 |
| frostscape | 6.9.4 |
| nexus-e2e-test | 6.9.4 / 6.9.1 (multiple snapshots) |
| newsroom-admin-columns-poc | 6.9.1 |
| wp-archaeologist | 6.9 |
| cli-test | 6.9 |
| migrate | 6.9 |
| wp-migrate
```