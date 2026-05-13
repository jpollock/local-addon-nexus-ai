# Eval Scorecard: M3-02-find-which-copy-is-real (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 61.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 2,276 |
| Cache creation | 12,366 |
| Cache read | 159,272 |
| **Total cost** | **$0.1283** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M3-02-find-which-copy-is-real-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus MCP tools aren't registering in this session — both skills are falling through to the CLI, which isn't available in MCP-only mode. This points to a setup issue: the Nexus MCP server either isn't connected to Claude Desktop, or its tools haven't been exposed to this session.

A few things to check:

1. **Is Local running?** The Nexus MCP server only starts when Local is active and the addon is loaded.
2. **Is the MCP server connected?** In Claude Desktop, open Settings → Developer → MCP Servers and verify `nexus-ai` shows as connected (green).
3. **Run the doctor** — if you have a terminal handy, `nexus doctor` will diagnose exactly what's broken and print the fix command.

Once the Nexus MCP server is connected, I'll be able to call tools like `list_sites` and `search_content` directly to compare your three `jpp-client` sites — looking at last-modified dates, post counts, and recent content to tell you which is the working copy.
```