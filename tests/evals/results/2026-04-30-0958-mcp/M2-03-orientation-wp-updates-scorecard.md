# Eval Scorecard: M2-03-orientation-wp-updates (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 45.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,691 |
| Cache creation | 13,992 |
| Cache read | 208,701 |
| **Total cost** | **$0.1405** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M2-03-orientation-wp-updates-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the summary, scoped to what actually needs attention (7.0-RC2 is a release candidate — I'll treat 6.9.4 as current stable):

---

## Local Sites Needing Updates

| Site | Version | Gap |
|------|---------|-----|
| Newsroom Demo | 6.9.1 | 1 minor behind |
| jeremypollockblog | 6.8.1 | 2 minors behind |
| jpp0413p, nexus, ACF Auto Car Finder, local-copy-jpp | 6.9.4 | Current stable ✓ |

---

## WP Engine Sites — Most Critically Outdated

| Site | Version | Gap |
|------|---------|-----|
| atlasshopifdev | 6.1.1 | Very old — ~3.5 years behind |
| atlasportfolio | 6.2.2 | Very old |
| benfischerstg | 6.3 | Very old |
| ezinnesproduct | 6.6.5 | 3 major versions behind |
| atlascommerce | 6.7.1 | Needs update |
| jsctransfer547 | 6.7.5 | Needs update |
| erinstestsite | 6.8.3 | Needs update |
| testblankjpp1 | 6.9 | One patch behind |
| **15 sites** | 6.9.1 | One patch behind |
| **225 sites** | 6.9.4 | Current stable ✓ |

---

**Bottom line:** Your local sites are mostly fine — `News
```