# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 52.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 1,870 |
| Cache creation | 41,749 |
| Cache read | 113,907 |
| **Total cost** | **$0.2188** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1534-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP tools aren't appearing as available in this session. The MCP server from the addon (which would expose tools like `search_site_content`, `list_sites`, etc.) doesn't seem to be connected.

A few things that could be causing this:

1. **The addon's MCP server isn't running** — the addon needs to be active in Local, with a site running, for the MCP server to be available. Run `nexus doctor` to check.

2. **Claude Desktop isn't configured to connect to it** — the Nexus AI MCP server needs to be registered in Claude Desktop's `claude_desktop_config.json`. The entry should point to the addon's MCP socket/port.

3. **The branch context** — you're on `testing-and-evals` which shows deleted skill files in git status, so the addon build may not be current.

**To verify the MCP server is reachable**, check your Claude Desktop config at `~/Library/Application Support/Claude/claude_desktop_config.json` and confirm there's a `nexus-ai` (or similar) entry under `mcpServers`.

Once co
```