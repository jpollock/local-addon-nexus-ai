# Eval Scorecard: M4-02-health-database (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 62.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,979 |
| Cache creation | 11,033 |
| Cache read | 116,182 |
| **Total cost** | **$0.1059** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M4-02-health-database-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP server doesn't appear to be connected to this Claude Code session — `ListMcpResourcesTool` returned nothing, and the nexus skills (`nexus-fleet`, `nexus-doctor`) depend on the `nexus` CLI which isn't available in this mode.

To get database health across your sites, you have two paths:

**In Claude Desktop** (where nexus MCP tools are connected), you'd use:
- `fleet_database_health` — scans all sites at once, returns scores + top issues per site
- `scan_database_health` (site name) — deep scan of a single site

**From your terminal**, run:
```bash
nexus wp db scan --all    # fleet scan
# or per-site:
nexus wp db scan <sitename>
```

**Or via the Local UI** — the "Database Health" row in each site's Nexus section shows the score and top issue, with a scan button.

To use me as Claude Desktop with nexus tools, you'd need to open the Claude Desktop app and ensure the Nexus AI addon is active in Local (it registers the MCP server when Local is running). Run `nexus doctor` 
```