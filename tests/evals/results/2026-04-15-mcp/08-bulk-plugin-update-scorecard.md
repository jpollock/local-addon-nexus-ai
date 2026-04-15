# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 30.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 1,111 |
| Cache creation | 43,411 |
| Cache read | 211,009 |
| **Total cost** | **$0.2428** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
It looks like you need to grant permission for the MCP tools. Could you approve `mcp__local-nexus-ai__nexus_plugin_audit`? That single call does a fleet-wide plugin audit across all your running local sites — showing current vs latest versions — which is exactly what we need to identify patch/minor updates before touching anything.

Once you approve that, I'll:
1. Parse the results and filter out any major version bumps
2. Show you the full before/after table
3. Wait for your go-ahead before running any updates
```