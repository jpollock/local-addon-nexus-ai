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
| Duration | 58.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 705 |
| Cache creation | 38,078 |
| Cache read | 37,157 |
| **Total cost** | **$0.3406** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1606-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP server isn't reachable right now. The most likely causes:

1. **Local isn't running** — The Nexus AI addon lives inside Local by WP Engine. Open Local first.
2. **Addon not active** — Check Local's addon manager and confirm Nexus AI is enabled.
3. **MCP server not started** — The server starts when Local launches. If Local is running but the server didn't come up, run `nexus doctor` from a terminal for a full health report with exact fix commands.
4. **MCP not registered** — Check that `local-nexus-ai` is present in your Claude Desktop MCP config (`~/.claude/claude_desktop_config.json` or equivalent).

Once Local is running and the addon is active, come back and I'll run the WooCommerce/e-commerce search across all your indexed sites.
```