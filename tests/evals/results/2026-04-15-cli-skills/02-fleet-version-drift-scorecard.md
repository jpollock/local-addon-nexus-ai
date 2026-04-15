# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 83.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 19 |
| Output tokens | 2,924 |
| Cache creation | 41,360 |
| Cache read | 623,655 |
| **Total cost** | **$0.3861** |

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
Here's what I found. The nexus CLI can only run WP-CLI commands against **running** sites — all 28 halted sites can't be queried without starting them first.

**Running sites (2 of 30):**

| Site | WordPress Version | Status |
|------|------------------|--------|
| `jppblank` | 7.0-RC2 | Pre-release (not final) |
| `eval-test-onboard` | 6.9.4 | Behind — needs update |

**`eval-test-onboard` is definitively behind** — it's on 6.9.4 while 7.0 is in RC. You could update it with:

```bash
nexus wp core update eval-test-onboard@local
```

**`jppblank` is on 7.0-RC2** — technically behind the final 7.0 once it ships, but intentionally on a pre-release build.

**The 28 halted sites are a blind spot** — the fleet health index doesn't track WP versions for halted sites. To check them, you'd need to start each one. If you want a bulk WP version audit across all sites, starting a few at a time and running `nexus wp core version <site>@local` is the path forward. Want me to help script that or pri
```