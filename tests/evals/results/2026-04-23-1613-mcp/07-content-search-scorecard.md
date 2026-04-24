# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 56.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 16 |
| Output tokens | 2,082 |
| Cache creation | 50,384 |
| Cache read | 302,503 |
| **Total cost** | **$0.3110** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1613-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP server hasn't connected in this session — it's not appearing in the available tools list at all (not just still loading, but absent).

This typically means one of:

1. **Local isn't running** — the Nexus AI addon only starts its MCP server when Local is active
2. **The addon isn't loaded** — check that the Nexus AI addon is enabled in Local's addon manager
3. **The MCP server failed to start** — you'd see this in `nexus doctor` output

**What to check:**
- Open Local and confirm it's running
- Run `nexus doctor` in your terminal — it checks MCP server status and prints the exact fix
- In Claude Desktop, check Settings → MCP Servers to confirm `local-nexus-ai` shows as connected (green)

Once the server is connected, I can run both the `search_across_sites` calls for "WooCommerce" and "e-commerce" in parallel and show you the matching posts right away.
```