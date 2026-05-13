# Eval Scorecard: M1-01-first-run-what-can-i-do (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 79.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,251 |
| Cache creation | 88,403 |
| Cache read | 146,763 |
| **Total cost** | **$0.3943** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M1-01-first-run-what-can-i-do-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what you've got and what you can do right now:

**Your fleet:** 8 local sites (3 running), 310 WPE environments

---

## What you can do right now

**1. Explore your WPE fleet**
With 310 WPE environments connected, you can query them immediately — no setup needed:
- "Show me all my WPE installs" → `nexus_list_sites`
- "Check SSL across my fleet" → `wpe_account_ssl_status`
- "Which installs are on old PHP?" → `find_outdated_sites`
- "How much bandwidth am I using?" → `wpe_portfolio_usage`

**2. Work with your running local sites**
Three local sites are up (`nexus-e2e-test`, `jpp0413p`, `local-copy-jpp`):
- Check plugin versions: "List plugins on jpp0413p"
- Run WP-CLI: "What WP version is jpp0413p running?"
- Pull from WPE: "Sync jpp0413p from production"
- Scan database health: "Scan jpp0413p's database"

**3. Index local sites for content search**
This requires one setup step per site, then you can ask things like "Which of my local sites has a post about checkout?":

> "Make n
```