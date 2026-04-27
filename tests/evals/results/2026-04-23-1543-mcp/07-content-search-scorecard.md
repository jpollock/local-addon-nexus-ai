# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 61.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 2,403 |
| Cache creation | 18,652 |
| Cache read | 195,534 |
| **Total cost** | **$0.1647** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1543-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The nexus-ai MCP server is not appearing in the available tools for this session. The listed MCP resources only include PubNub, Atlassian, wpe-pm-toolkit, and compound-engineering — no nexus-ai tools are connected.

For the nexus-ai search tools to be available in Claude Desktop (MCP-only mode), the MCP server needs to be:

1. **Running** — Local must be open with the nexus-ai addon active
2. **Connected to Claude Desktop** — the MCP server config in Claude Desktop's settings must point to the nexus-ai addon's MCP socket

To verify the addon is running, check:
```
nexus doctor
```

Then in Claude Desktop settings (`~/Library/Application Support/Claude/claude_desktop_config.json`), confirm there's an entry for the nexus-ai MCP server. It should look something like:

```json
{
  "mcpServers": {
    "nexus-ai": {
      "command": "...",
      "args": [...]
    }
  }
}
```

Once connected, you'd be able to run a search like "search for WooCommerce posts across all sites" and I'd call the `
```