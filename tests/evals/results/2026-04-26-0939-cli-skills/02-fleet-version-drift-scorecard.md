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
| Duration | 146.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 14 |
| Output tokens | 2,917 |
| Cache creation | 81,024 |
| Cache read | 861,269 |
| **Total cost** | **$0.6060** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-0939-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Good — no local sites on 6.9.1. Here's your WP update summary:

---

## WordPress Update Summary — Local Sites

**Current latest stable: WordPress 6.9.4**

| Version | Gap | Sites |
|---------|-----|-------|
| 6.9 | 3 minor updates behind | `wp-archaeologist`, `migrate`, `cli-test`, `wp-migrate-receiver-new`, `wp-migrate-pusher` |
| 6.8.3 | 1 major behind | `pm-toolkit-hub`, `wp-events-analyzer`, `nitropack-2` |
| 6.8.2 | 1 major behind | `offload-media-clean` |
| 6.8.1 | 1 major behind | `jeremypollock.blog`, `nexus`, `mu-plugin` |
| 6.2.2 | Very old | `e2e-test-fresh` |

**13 of your local sites need updates.** The rest (21 sites) are already on 6.9.4.

**Priority order:**
1. **`e2e-test-fresh`** (6.2.2) — most out of date, 7 major versions behind
2. **6.8.x sites** (4 sites) — one full major release behind
3. **6.9 sites** (5 sites) — minor versions behind, lowest urgency

Note: The `e2e-test-fresh` site is likely a test fixture — you may intentionally keep it pinned. The others are
```