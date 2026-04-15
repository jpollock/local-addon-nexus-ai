# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 38.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 1,373 |
| Cache creation | 82,578 |
| Cache read | 124,567 |
| **Total cost** | **$0.3677** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The MCP tools need permission approval before they can run. You should see permission prompts in your Claude Code UI — please approve them, or if you'd prefer, you can grant broader MCP permissions so they run automatically.

Once approved, I'll use:
- `find_outdated_sites` (component: wordpress, source: local) — to see which local sites are behind
- `fleet_summary` — to get the WP version distribution across your fleet

Would you like to approve those tools, or would you prefer I help you configure auto-approval for the `mcp__local-nexus-ai__*` tools?
```