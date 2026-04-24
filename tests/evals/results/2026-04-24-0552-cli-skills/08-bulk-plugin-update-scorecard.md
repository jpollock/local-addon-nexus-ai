# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 9 |
| Error events | 0 |
| Duration | 73.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 2,561 |
| Cache creation | 15,917 |
| Cache read | 618,094 |
| **Total cost** | **$0.2836** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the situation across your fleet:

**Running site: `eval-test-onboard`**
- 2 plugins installed (both internal Nexus plugins, no updates available)
- `nexus-ai-connector` v1.0.0 — up to date
- `nexus-ai-connector-config` (mu-plugin) — no version/update

**29 halted sites** — no plugin data available. The fleet indexer only tracks running sites, so those show `0 plugins / 0 outdated`.

To do a proper fleet-wide plugin audit, each halted site would need to be started, scanned, then stopped again. That's doable but would mean spinning up ~29 sites sequentially.

A few options:

1. **Start + scan all sites one at a time** — thorough but slow (~29 starts/stops). I can do this automatically.
2. **Start a subset** — if you have sites you care about most (e.g. the linked WPE sites like `The Curated Shelf`, `frostscape`, `jpp0413p`), I can scan just those.
3. **Skip it** — if these are mostly dev/scratch sites, the effort may not be worth it.

Which would you prefer?
```