# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 44.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,390 |
| Cache creation | 44,372 |
| Cache read | 200,356 |
| **Total cost** | **$0.2474** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1526-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found across your local indexed sites:

---

**Most relevant: "Faker Incorporated"** — this site has the most substantive e-commerce content:

- **"How to Get More Out of Your WooCommerce Store"** (post, score 0.52) — actual editorial content about WooCommerce optimization: "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores."
- **"Services"** (page, score 0.52) — digital strategy page mentioning e-commerce context
- **"Shop"** (page) — has an active WooCommerce shop

**Other local sites with WooCommerce installed** (Shop pages, but no unique content):
- **The Curated Shelf** — Shop page
- **nexus-test-site** — Shop page
- **nexustestsite1** — Shop page
- **faker-incorporated** (appears twice, likely two indexed versions) — Cart + Shop pages

The WPE-indexed sites (`wpe-*`) mostly have default WooCommerce pages (`[woocommerce_my
```