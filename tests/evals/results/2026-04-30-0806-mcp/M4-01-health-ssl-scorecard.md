# Eval Scorecard: M4-01-health-ssl (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 57.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 2,093 |
| Cache creation | 11,087 |
| Cache read | 116,127 |
| **Total cost** | **$0.1078** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M4-01-health-ssl-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The nexus MCP tools don't appear to be connected in this session — no nexus-specific tools are showing up in my available tool set (only the wpe-pm-toolkit tools are visible).

This typically means the Nexus MCP server isn't running or isn't registered with this Claude instance. A few things to check:

1. **Is Local running?** The Nexus MCP server starts when Local is open with the Nexus AI addon active.

2. **Run the doctor** from a terminal:
   ```
   nexus doctor
   ```
   This will check whether the MCP server is up, the addon is active, and your WPE auth is configured — and print the exact fix command for any failure.

3. **For Claude Desktop specifically** — make sure the Nexus MCP server is registered in your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`). The entry should point to the `nexus mcp` command.

Once the MCP server is connected, I can query your WPE installs for SSL status directly. The SSL check pulls certificate expiry dat
```