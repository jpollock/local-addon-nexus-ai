# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 64.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 685 |
| Cache creation | 122,216 |
| Cache read | 74,213 |
| **Total cost** | **$0.6800** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1846-mcp/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP server (`local-nexus-ai`) isn't connected to this Claude session — the `wp_core_version` tool isn't available here. The MCP tools listed in your constraints don't appear to be registered in this environment.

To get the WordPress version for jppblank, you can run from the CLI:

```bash
nexus wp core version --site jppblank
```

Or check that the Nexus AI MCP server is running and connected (`nexus doctor` will confirm MCP server status).
```