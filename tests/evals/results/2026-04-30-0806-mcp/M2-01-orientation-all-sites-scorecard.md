# Eval Scorecard: M2-01-orientation-all-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 39.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,223 |
| Cache creation | 10,688 |
| Cache read | 116,074 |
| **Total cost** | **$0.0933** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M2-01-orientation-all-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP tools aren't loaded in this session — I can see the `wpe-pm-toolkit` MCP server but not the nexus-ai MCP server. This means either:

1. **The Nexus MCP server isn't running** — the addon needs to be active in Local and the MCP server started
2. **The MCP server isn't configured** in your Claude Desktop `claude_desktop_config.json`

To diagnose, run `nexus doctor` from a terminal — it checks all the pieces and prints the exact fix command for each failure.

If you're actively developing the addon and want to test this MCP-only flow, the nexus MCP server would need to be registered as an MCP server in your Claude config so its tools (like `list_sites`, `get_site_status`, etc.) show up here.
```