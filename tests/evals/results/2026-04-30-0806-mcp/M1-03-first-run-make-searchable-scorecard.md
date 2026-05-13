# Eval Scorecard: M1-03-first-run-make-searchable (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 57.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,961 |
| Cache creation | 17,961 |
| Cache read | 109,796 |
| **Total cost** | **$0.1297** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M1-03-first-run-make-searchable-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I can't reach the Nexus MCP tools directly in this session, but I can walk you through what's needed to make your sites searchable.

**To search across your Local WordPress sites, you need to index them first.** Here's the process:

1. **Make sure Local is running** with the Nexus AI addon active.

2. **Start the sites you want to search** — only running sites can be indexed.

3. **Index your sites** — this builds the searchable content database. You can trigger this from:
   - The **Nexus AI dashboard** in Local (look for an "Index" or "Make Searchable" button next to each site)
   - Or via the CLI: `nexus index <sitename>`

4. **Search** — once indexed, you can ask me things like "which site has a post about pricing?" or "find pages mentioning checkout errors" and I'll search across all indexed sites.

**Quick health check:** If you're not sure if Nexus is set up correctly, run `nexus doctor` in your terminal — it'll tell you exactly what's working and what needs fixing, with the exa
```