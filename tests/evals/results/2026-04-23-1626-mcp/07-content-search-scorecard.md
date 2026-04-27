# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 6 |
| Error events | 0 |
| Duration | 58.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,325 |
| Cache creation | 41,255 |
| Cache read | 75,458 |
| **Total cost** | **$0.3607** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1626-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `local-nexus-ai` MCP server isn't showing up as connected — its tools aren't available in this session. This means the Nexus AI addon is either not running or the MCP server failed to start.

**What's likely happening:**

- Local isn't running, or the Nexus AI addon isn't active in Local's addon manager
- The MCP server process failed to start (e.g., native module mismatch after a build)

**To fix it:**

1. Open **Local** and confirm the Nexus AI addon is enabled
2. From a terminal, run `nexus doctor` — it checks MCP server connectivity and prints the exact fix command for any failure
3. If you recently ran `npm install`, run `npm run rebuild` to recompile better-sqlite3 for Electron, then restart Local

Once the MCP server is back online and Claude Desktop reconnects to it, I can search across your sites for WooCommerce/e-commerce content using `search_across_sites` and show you the relevant posts.
```