# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 87.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 3,985 |
| Cache creation | 44,865 |
| Cache read | 209,755 |
| **Total cost** | **$0.2910** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Both fleet-scan tools (`nexus_plugin_audit`, `find_outdated_sites`) are being blocked by the permissions prompt — you'll need to approve them in the Local UI when prompted.

Here's where we stand:

**Running sites (2):**
- `jppblank` — 8 plugins, but I need the update-check tool approved to see what versions are available
- `eval-test-onboard` — no plugins

**Halted sites (28):** Can't check plugins without either starting each one or using `find_outdated_sites` (which reads the indexed graph DB without starting sites — much faster)

**Two options to unblock this:**

1. **Approve `find_outdated_sites` + `nexus_plugin_audit` in the Local permissions prompt** — this is the fast path, reads cached data from the graph DB for all indexed sites, no need to start any halted sites. Then I can build the full diff.

2. **Narrow scope to running sites only** — I'll use `wp_eval` on `jppblank` to check available update versions right now. Covers 1 site immediately, we skip the 28 halted ones (or t
```