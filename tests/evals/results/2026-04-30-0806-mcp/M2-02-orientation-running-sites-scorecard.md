# Eval Scorecard: M2-02-orientation-running-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 39.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,096 |
| Cache creation | 10,691 |
| Cache read | 116,061 |
| **Total cost** | **$0.0914** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M2-02-orientation-running-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus MCP tools don't appear to be registered in this session — they're not showing up in my available tool list. This usually means either the MCP server isn't running, or this Claude Code session wasn't started with the Nexus MCP server configured.

A few things to check:

1. **Is Local running?** The Nexus MCP server only starts when Local is active and the addon is loaded.
2. **Is the MCP server configured?** In Claude Desktop (or Claude Code with MCP), the Nexus server needs to be in your `claude_desktop_config.json` or equivalent.

You can diagnose with `nexus doctor` in your terminal — it checks all of this and prints the exact fix for each failure. If you want me to run that for you, switch out of MCP-only mode and I can use the CLI directly.
```