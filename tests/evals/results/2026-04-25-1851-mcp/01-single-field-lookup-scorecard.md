# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 80.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 602 |
| Cache creation | 34,123 |
| Cache read | 236,889 |
| **Total cost** | **$0.4177** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1851-mcp/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP server isn't connected in this Claude Code session — none of its tools are reachable. This is expected since Claude Code doesn't automatically connect to the Nexus AI MCP server (that's a Claude Desktop / MCP client concern).

To get the WordPress version for jppblank, you have a couple of options:

1. **From the terminal:** `nexus wp jppblank -- core version`
2. **Run `nexus doctor`** to confirm the MCP server is healthy, then query from Claude Desktop where the `local-nexus-ai` MCP server is configured.
```