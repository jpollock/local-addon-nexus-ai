# Eval Scorecard: M3-04-find-content-across-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 51.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 1,659 |
| Cache creation | 13,816 |
| Cache read | 356,694 |
| **Total cost** | **$0.1837** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M3-04-find-content-across-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
No dedicated pricing pages found across any of your 8 indexed sites. Here's what the searches turned up:

**local-copy-jpp** — Closest match is **"Pro for Everyone"** (page, score 0.20) — it's about Local 6.0 making premium features free, mentioning subscriptions and Pro tier. Not a traditional pricing page, but the most pricing-adjacent content in the fleet.

**ACF Auto Car Finder** — Has vehicle listings with a `Price` custom field (e.g. $54,338 for a Cadillac XT5), but these are individual car listings, not a pricing page.

**Newsroom Demo, jeremypollockblog, jpp0413p, nexus, nitropack-1** — Nothing relevant. Most of those sites have only 2–3 indexed documents total (likely just default pages).

**nexus-e2e-test** — 528 docs but the fleet-wide semantic search returned nothing pricing-related there either.

**Bottom line:** None of your sites have a dedicated pricing page or post. If you expected to find one, it may be on a site that isn't indexed yet — you'd need to run a reindex on
```