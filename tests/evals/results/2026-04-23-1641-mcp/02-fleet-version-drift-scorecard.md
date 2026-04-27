# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 41.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 1,836 |
| Cache creation | 17,749 |
| Cache read | 108,050 |
| **Total cost** | **$0.1265** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your WordPress version update summary across local sites:

---

## WordPress Version Summary — Local Sites

**Latest detected:** `7.0-beta6` (pre-release — 3 sites)
**Index freshness:** ⚠️ 52 days stale — numbers below reflect cached data, not current state

---

### Sites on 7.0 pre-release (but behind 7.0-beta6)
These are on beta/RC builds — likely dev/test sites:

| Version | Sites |
|---|---|
| 7.0-RC2 | cli-target, nexus-e2e-test, testjpp1, testjppdev, jppblank (×2) |
| 7.0-RC2-62241 | another-test, nexustestsite1 |
| 7.0-RC1 | The Curated Shelf |
| 7.0-RC1-62112 | nexus-test-site |

---

### Sites on stable 6.x — Significantly behind

| Version | Count | Notable sites |
|---|---|---|
| **6.9.4** | 64 | heath.biz, frostscape, benfischer, elasticapidev, Faker Incorporated, many test/eval sites |
| **6.9.1** | 20 | newsroom-admin-columns-poc, my-site, jppblankdev |
| **6.9** | 6 | wp-archaeologist, cli-test, hello-wp-engine |
| **6.8.3** | 3 | nitropack-2, wp-events-analyzer,
```