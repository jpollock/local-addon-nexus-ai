# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 6 |
| Error events | 0 |
| Duration | 126.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 857 |
| Cache creation | 73,307 |
| Cache read | 110,340 |
| **Total cost** | **$0.3209** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Local isn't running, so nexus can't connect to it. You'll need to start **Local by WP Engine** first, then I can search across your sites.

Once Local is open and running, come back and I'll run:

```
nexus content search-all "WooCommerce" --limit 30
nexus content search-all "e-commerce" --limit 30
```

These search the indexed content across all your local sites and will show you which sites have matching posts, pages, or other content — along with the relevant excerpts.
```