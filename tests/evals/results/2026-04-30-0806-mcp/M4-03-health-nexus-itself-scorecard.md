# Eval Scorecard: M4-03-health-nexus-itself (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 48.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 1,591 |
| Cache creation | 11,377 |
| Cache read | 158,613 |
| **Total cost** | **$0.1141** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M4-03-health-nexus-itself-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The diagnostic result itself is informative. Neither the CLI nor Nexus MCP tools are reachable from this session, which points to a connection issue. Here's what I can tell you:

**What I'm seeing:**
- No `nexus` CLI available (expected in MCP-only mode)
- No Nexus MCP tools registered in my available tool list (this is the actual problem signal)
- Only the `wpe-pm-toolkit` MCP server is connected

**What this means:**
The Nexus MCP server isn't connected to this Claude session. In a working Claude Desktop setup, the Nexus addon would expose tools like `list_sites`, `search_content`, `get_fleet_health`, etc. directly as callable tools — and they're not here.

**Likely causes:**
1. **Local isn't running** — the Nexus MCP server only starts when Local is open
2. **Addon isn't active** — the Nexus AI addon may not be enabled in Local
3. **MCP config not set up** — Claude Desktop's `claude_desktop_config.json` may not include the Nexus MCP server entry
4. **Port conflict** — the MCP server
```