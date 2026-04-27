# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 37.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,097 |
| Cache creation | 35,589 |
| Cache read | 109,649 |
| **Total cost** | **$0.1828** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1637-mcp/07-content-search-transcript.txt

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

---

## Sites with WooCommerce / E-Commerce Content

### Faker Incorporated — **Most relevant** (highest scores)
This is clearly your most WooCommerce-focused site with actual editorial content:

| Post | Type | Excerpt |
|------|------|---------|
| **How to Get More Out of Your WooCommerce Store** | Post | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze..." |
| **Custom WooCommerce Store Build** | Product | "A fully designed, custom WooCommerce storefront built on Astra — optimized for speed, mobile, and conv..." |
| **Cart** | Page | `[woocommerce_cart]` |
| **Checkout** | Page | `[woocommerce_checkout]` |
| **Shop** | Page | Standard WooCommerce shop page |

### The Curated Shelf — **Product catalog site**
Has actual product listings with prices (no editorial WooCommerce content):

| Post | Type | Details |
|------|------|---------|
|
```