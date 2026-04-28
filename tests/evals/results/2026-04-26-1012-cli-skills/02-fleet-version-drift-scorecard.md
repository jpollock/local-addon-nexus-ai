# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 47.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,872 |
| Cache creation | 20,947 |
| Cache read | 365,176 |
| **Total cost** | **$0.2162** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1012-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the WordPress version summary across your fleet:

## WordPress Update Status

**Latest stable: 6.9.4** — 221 sites are current.

### Sites Needing Updates (35 sites on older stable releases)

| Version | Count | How Far Behind |
|---------|-------|----------------|
| 6.9.1 | 14 | Minor (3 patch versions) |
| 6.9 | 6 | Minor (4 patch versions) |
| 6.8.3 | 4 | Minor release behind |
| 6.8.1 | 3 | Minor release behind |
| 6.8.2 | 1 | Minor release behind |
| 6.7.5 | 1 | Full minor version behind |
| 6.7.1 | 1 | Full minor version behind |
| 6.6.5 | 1 | Two minor versions behind |
| 6.3 | 1 | Significantly out of date |
| 6.2.2 | 2 | **Very old — security risk** |
| 6.1.1 | 1 | **Very old — security risk** |

### Pre-release / RC Builds (11 sites — intentional dev work)
Sites running 7.0-beta6, 7.0-RC1, and 7.0-RC2 variants — these are presumably test sites.

### Unknown (104 sites)
These sites have never been scanned. Run `node /Users/jeremy.pollock/development/wpengine/local-addon
```