# Eval Scorecard: M2-04-orientation-plugin-search (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 69.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 2,711 |
| Cache creation | 12,187 |
| Cache read | 158,829 |
| **Total cost** | **$0.1340** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M2-04-orientation-plugin-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP tools aren't surfacing in this session — they would appear as additional tools (like `mcp__nexus-ai__*`) when the MCP server is connected and Claude Desktop is reading them. Right now I only have the standard Claude Code tools and wpe-pm-toolkit.

This usually means one of:

1. **MCP server isn't running** — the Local addon may not be active or the `nexus` MCP server process isn't started
2. **Not configured in Claude Desktop** — the nexus server entry may be missing from `~/Library/Application Support/Claude/claude_desktop_config.json`

**To diagnose:** Open a terminal and run:
```
nexus doctor
```

This will check whether Local is running, the addon is active, and the MCP server is reachable — and print the exact fix command for any failure.

**Once the MCP server is connected**, I'd be able to answer your WooCommerce question by:
- Calling a fleet plugin tool to scan all local sites for the `woocommerce/woocommerce.php` slug
- Querying WPE installs for WooCommerce v
```