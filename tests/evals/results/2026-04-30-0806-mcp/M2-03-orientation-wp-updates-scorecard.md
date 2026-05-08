# Eval Scorecard: M2-03-orientation-wp-updates (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 64.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 2,354 |
| Cache creation | 12,172 |
| Cache read | 159,226 |
| **Total cost** | **$0.1287** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M2-03-orientation-wp-updates-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Both skills rely on the `nexus` CLI, which requires a shell — unavailable in MCP-only mode. The Nexus MCP server tools (which would work in Claude Desktop) aren't registering in this Claude Code session either.

Here's the situation:

**What would work in Claude Desktop:**
The Nexus AI addon runs an MCP server that exposes tools like `get_sites`, `fleet_health`, and WPE queries directly — no CLI needed. In Claude Desktop with the nexus MCP server configured, I'd call those tools directly.

**What's blocked in this session:**
- `nexus fleet health` — requires shell
- `nexus sites list` — requires shell
- Nexus MCP tools — not registered in this Claude Code session

**To check WP updates right now, your options are:**

1. **In your terminal:** `nexus fleet health` — shows WP version drift, plugin outdates, and site issues across all local sites

2. **In Claude Desktop** (with nexus MCP configured): ask me the same question and I'll call the tools directly

3. **Local app UI:** the Nexus 
```