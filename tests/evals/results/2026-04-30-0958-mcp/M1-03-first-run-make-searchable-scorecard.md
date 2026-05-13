# Eval Scorecard: M1-03-first-run-make-searchable (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 9 |
| Error events | 0 |
| Duration | 107.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 2,223 |
| Cache creation | 80,741 |
| Cache read | 284,205 |
| **Total cost** | **$0.4214** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M1-03-first-run-make-searchable-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Reindexing is running in the background — all 8 sites are queued, processing 3 at a time.

**What's happening:**
- The indexer reads each site's WordPress database and builds a semantic search index from posts, pages, and custom post types
- Larger sites (Newsroom Demo has 121 docs, ACF Auto Car Finder has 63) will take longer than the smaller ones

**To check progress on any site:**
Just ask me to check a specific site's index status, or once it's done you can search across all of them with something like "find posts about [topic]."

The 3 sites that were already running with OK indexes (nexus-e2e-test, jpp0413p, local-copy-jpp) are also being refreshed in case your import brought in new content.
```