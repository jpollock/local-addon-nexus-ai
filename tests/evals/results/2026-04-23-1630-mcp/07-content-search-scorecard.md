# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 16 |
| Error events | 0 |
| Duration | 59.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 303 |
| Output tokens | 851 |
| Cache creation | 38,232 |
| Cache read | 37,157 |
| **Total cost** | **$0.4512** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1630-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP server isn't reachable in this session — both searches came back with no registered tools. This means one of the following:

1. **Local isn't running** — the Nexus AI MCP server only starts when Local is open with the addon active.
2. **The addon isn't loaded** — it may need to be enabled in Local's addon manager.
3. **MCP server startup failed** — a crash or config issue prevented it from registering tools.

**To fix this:**

1. Open Local by WP Engine and make sure the Nexus AI addon is active.
2. Run `nexus doctor` in your terminal — it checks every dependency and prints the exact fix for each problem.
3. Once Local is running and the addon is healthy, re-open Claude Desktop (or reconnect the MCP server) so the tools register.

After that, I'll be able to search across your sites for WooCommerce/e-commerce content.
```