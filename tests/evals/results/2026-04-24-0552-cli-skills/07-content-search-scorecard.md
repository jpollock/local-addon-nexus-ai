# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 26.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 762 |
| Cache creation | 79,185 |
| Cache read | 76,638 |
| **Total cost** | **$0.3314** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found across your local sites:

## Sites with WooCommerce / E-commerce Content

### Most Relevant: **Faker Incorporated**
This is the richest hit — it has actual editorial content about WooCommerce:

- **"How to Get More Out of Your WooCommerce Store"** (post) — talks about WooCommerce as an e-commerce platform and optimization strategies
- **Services** (page) — mentions digital strategy and e-commerce
- **Shop** page — active WooCommerce store

### Other Local Sites with WooCommerce Active
These sites have WooCommerce installed (showing standard shortcode pages like `[woocommerce_my_account]`, `[woocommerce_cart]`), but no substantive written content about e-commerce:

- **faker-incorporated** — Shop + Cart pages
- **nexustestsite1** — Shop page
- **The Curated Shelf** — Shop page
- **nexus-test-site** — Shop page

### WPE-Connected Sites (many)
20+ WPE environment clones also have WooCommerce pages (`[woocommerce_my_account]`, `[woocommerce_cart]`) — these appear to be 
```