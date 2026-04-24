# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 51.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,226 |
| Cache creation | 38,430 |
| Cache read | 74,978 |
| **Total cost** | **$0.3552** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1620-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP server doesn't appear to be connected in the current session — neither the subagent nor ToolSearch can locate those tools, and the only available MCP server is `wpe-pm-toolkit`.

This can happen for a few reasons:

- **Local isn't running** — the Nexus AI addon only registers its MCP server while Local is active and the addon is loaded.
- **The MCP server hasn't finished initializing** — sometimes there's a delay on startup.
- **MCP config isn't wired up** — Claude Desktop needs an entry in its `claude_desktop_config.json` pointing to the Nexus AI MCP server.

**To diagnose, open Local and run:**
```
nexus doctor
```

That will tell you exactly what's wrong (MCP server not reachable, addon not active, etc.) and print the fix command.

Once Local is running with the addon active and the MCP server is healthy, the search would look like this conceptually:
- `search_across_sites("WooCommerce")` — finds posts/pages mentioning WooCommerce across all indexed local si
```