# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 21 |
| Error events | 0 |
| Duration | 101.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 332 |
| Output tokens | 1,469 |
| Cache creation | 13,696 |
| Cache read | 103,008 |
| **Total cost** | **$0.4339** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1616-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP tools are not registered in this Claude Code session — they're only connected to Claude Desktop, not here. Here's the situation:

**Why the tools aren't available:**
- The Nexus AI MCP server is running (connected to Claude Desktop), but Claude Code has a separate MCP config
- The tools like `mcp__local-nexus-ai__search_across_sites` don't appear in my available tool list

**To run this query from Claude Desktop**, ask me there — I'd execute:
1. `search_across_sites` with query `"WooCommerce"` 
2. `search_across_sites` with query `"e-commerce shop store"`
3. Then group results by site and surface the top posts

**To connect the MCP server to Claude Code**, add it to your config:
```bash
claude mcp add local-nexus-ai node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/mcp-stdio.js
```

Or run `nexus doctor` to verify the MCP server is healthy and see its connection status.

If you're testing this as an eval scenario for the MCP-only simulati
```